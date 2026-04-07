import express from 'express'
import Animal from '../models/Animal.js'
import User from '../models/User.js'
import { authMiddleware, adminMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'
import upload from '../middleware/upload.js'
import { sendEmail } from '../utils/mailer.js'
import { buildNewAnimalNotificationHtml } from '../utils/orderEmailTemplates.js'

const router = express.Router()

// ── Public Routes ──

// GET /api/animals - Get all available animals (with filtering)
router.get('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const { category, breed, city, status, gender, minPrice, maxPrice, sort, page = 1, limit = 12 } = req.query
    const query = {}

    // Filtering
    if (category) query.category = category
    if (breed) query.breed = new RegExp(breed, 'i')
    if (city) query.city = new RegExp(city, 'i')
    if (gender) query.gender = gender
    
    // Only show available/visible animals to non-admins
    const isAdmin = req.user?.role === 'admin'
    if (!isAdmin) {
      query.visibility = true
      // Typically we only show available or new animals to public
      query.status = status || { $in: ['available', 'new'] }
    } else if (status) {
      query.status = status
    }

    if (minPrice || maxPrice) {
      query.price = {}
      if (minPrice) query.price.$gte = Number(minPrice)
      if (maxPrice) query.price.$lte = Number(maxPrice)
    }

    // Sorting
    let sortOptions = { createdAt: -1 }
    if (sort === 'price_asc') sortOptions = { price: 1 }
    if (sort === 'price_desc') sortOptions = { price: -1 }
    if (sort === 'oldest') sortOptions = { createdAt: 1 }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit)
    
    const animals = await Animal.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean()

    const total = await Animal.countDocuments(query)

    res.json({
      success: true,
      data: animals,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Error fetching animals:', error.message)
    res.status(500).json({ success: false, message: 'Server error while fetching animals' })
  }
})

// POST /api/animals/availability - Check which animals are unavailable
router.post('/availability', async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Animal IDs must be a non-empty array' })
    }

    const animals = await Animal.find({
      _id: { $in: ids },
      $or: [
        { status: { $in: ['sold', 'reserved'] } },
        { visibility: false }
      ]
    }).select('_id').lean()

    const unavailableIds = animals.map(animal => animal._id.toString())

    res.json({ 
      success: true, 
      unavailable: unavailableIds 
    })
  } catch (error) {
    console.error('Error checking animal availability:', error.message)
    res.status(500).json({ success: false, message: 'Server error while checking availability' })
  }
})

// GET /api/animals/:id - Get single animal
router.get('/:id', optionalAuthMiddleware, async (req, res) => {
  try {
    const animal = await Animal.findById(req.params.id).lean()
    if (!animal) {
      return res.status(404).json({ success: false, message: 'Animal not found' })
    }

    // Non-admins cannot see hidden animals
    const isAdmin = req.user?.role === 'admin'
    if (!isAdmin && animal.visibility === false) {
      return res.status(403).json({ success: false, message: 'This animal is no longer available' })
    }

    res.json({ success: true, data: animal })
  } catch (error) {
    console.error('Error fetching animal:', error.message)
    res.status(500).json({ success: false, message: 'Server error while fetching animal' })
  }
})

// ── Admin Routes ──

// POST /api/animals - Create new animal
router.post('/', authMiddleware, adminMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'videos', maxCount: 3 }
]), async (req, res) => {
  try {
    const animalData = { ...req.body }

    // Parse URL media early for validation
    let urlImages = []
    let urlVideos = []
    try {
      if (animalData.urlImages) urlImages = JSON.parse(animalData.urlImages)
      if (animalData.urlVideos) urlVideos = JSON.parse(animalData.urlVideos)
    } catch (e) {
      console.error('Error parsing URL media strings:', e.message)
    }

    const hasUploadedImages = req.files?.images?.length > 0
    const hasUrlImages = urlImages.length > 0

    if (!hasUploadedImages && !hasUrlImages) {
      return res.status(400).json({
        success: false,
        message: 'At least one image is required (upload or link)'
      })
    }
    
    // Handle images
    if (req.files?.images) {
      animalData.images = req.files.images.map((file) => file.path)
    } else {
      animalData.images = []
    }

    // Add URL images
    if (hasUrlImages) {
      animalData.images = [...animalData.images, ...urlImages]
    }

    // Backward compatibility single image field
    animalData.imageUrl = animalData.images[0] || ''

    // Handle videos
    if (req.files?.videos) {
      animalData.videos = req.files.videos.map((file) => file.path)
    } else {
      animalData.videos = []
    }

    // Add URL videos
    if (urlVideos.length > 0) {
      animalData.videos = [...animalData.videos, ...urlVideos]
    }

    // Clean up non-schema fields
    delete animalData.urlImages
    delete animalData.urlVideos

    // Data cleaning
    if (animalData.teeth !== undefined) {
      if (animalData.teeth === '' || animalData.teeth === null) {
        animalData.teeth = null
      } else {
        animalData.teeth = parseInt(animalData.teeth)
      }
    }
    if (animalData.vaccinated !== undefined) animalData.vaccinated = String(animalData.vaccinated) === 'true'
    if (animalData.visibility !== undefined) animalData.visibility = String(animalData.visibility) === 'true'
    if (animalData.deliveryAvailable !== undefined) animalData.deliveryAvailable = String(animalData.deliveryAvailable) === 'true'
    if (animalData.negotiable !== undefined) animalData.negotiable = String(animalData.negotiable) === 'true'

    if (!animalData.type) animalData.type = 'animal'

    const animal = new Animal(animalData)
    await animal.save()

    // ── New Animal Notification ──
    if (animal.visibility !== false) {
      (async () => {
        try {
          const users = await User.find({ isSubscribed: true, isVerified: true }).select('email').lean()
          const emails = users.map(u => u.email).filter(Boolean)
          
          if (emails.length > 0) {
            const html = buildNewAnimalNotificationHtml({
              animalName: animal.name,
              animalPrice: animal.price,
              animalDescription: animal.shortDescription || animal.fullDescription || '',
              animalImageUrl: animal.imageUrl,
              animalUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/shop/${animal._id}`
            })

            // Send to all users using Promise.all for better performance
            await Promise.all(
              emails.map((email) =>
                sendEmail({
                  to: email,
                  subject: `New Arrival: ${animal.name} 🐐`,
                  html
                }).catch((err) =>
                  console.error(`Failed to send new animal notification to ${email}:`, err.message)
                )
              )
            )
          }
        } catch (err) {
          console.error('Error sending new animal notifications:', err.message)
        }
      })()
    }

    const payload = animal.toObject ? animal.toObject() : animal
    res.status(201).json({
      success: true,
      message: 'Animal added successfully',
      data: payload
    })
  } catch (error) {
    console.error('Error creating animal:', error.message)
    res.status(400).json({ success: false, message: error.message || 'Error creating animal' })
  }
})

// PUT /api/animals/:id - Update animal
router.put('/:id', authMiddleware, adminMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'videos', maxCount: 3 }
]), async (req, res) => {
  try {
    const animal = await Animal.findById(req.params.id)
    if (!animal) {
      return res.status(404).json({ success: false, message: 'Animal not found' })
    }

    const updateData = { ...req.body }

    // Handle media updates (images)
    let finalImages = []
    if (updateData.keepImages) {
      try {
        finalImages = JSON.parse(updateData.keepImages)
      } catch (e) {
        finalImages = []
      }
    }

    if (req.files?.images) {
      const newImages = req.files.images.map((file) => file.path)
      finalImages = [...finalImages, ...newImages]
    }

    // Handle URL images
    if (updateData.urlImages) {
      try {
        const urlImgs = JSON.parse(updateData.urlImages)
        finalImages = [...finalImages, ...urlImgs]
      } catch (e) {
        console.error('Error parsing urlImages:', e.message)
      }
    }

    updateData.images = finalImages
    updateData.imageUrl = finalImages[0] || ''

    // Handle media updates (videos)
    let finalVideos = []
    if (updateData.keepVideos) {
      try {
        finalVideos = JSON.parse(updateData.keepVideos)
      } catch (e) {
        finalVideos = []
      }
    }

    if (req.files?.videos) {
      const newVideos = req.files.videos.map((file) => file.path)
      finalVideos = [...finalVideos, ...newVideos]
    }

    // Handle URL videos
    if (updateData.urlVideos) {
      try {
        const urlVids = JSON.parse(updateData.urlVideos)
        finalVideos = [...finalVideos, ...urlVids]
      } catch (e) {
        console.error('Error parsing urlVideos:', e.message)
      }
    }

    updateData.videos = finalVideos

    // Clean up non-schema fields
    delete updateData.urlImages
    delete updateData.urlVideos
    delete updateData.keepImages
    delete updateData.keepVideos
    delete updateData.removedImages
    delete updateData.removedVideos

    // Data cleaning
    if (updateData.teeth !== undefined) {
      if (updateData.teeth === '' || updateData.teeth === null) {
        updateData.teeth = null
      } else {
        updateData.teeth = parseInt(updateData.teeth)
      }
    }
    if (updateData.vaccinated !== undefined) updateData.vaccinated = String(updateData.vaccinated) === 'true'
    if (updateData.visibility !== undefined) updateData.visibility = String(updateData.visibility) === 'true'
    if (updateData.deliveryAvailable !== undefined) updateData.deliveryAvailable = String(updateData.deliveryAvailable) === 'true'
    if (updateData.negotiable !== undefined) updateData.negotiable = String(updateData.negotiable) === 'true'

    const updatedAnimal = await Animal.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    )

    const payload = updatedAnimal?.toObject ? updatedAnimal.toObject() : updatedAnimal
    res.json({
      success: true,
      message: 'Animal updated successfully',
      data: payload
    })
  } catch (error) {
    console.error('Error updating animal:', error.message)
    res.status(400).json({ success: false, message: error.message || 'Error updating animal' })
  }
})

// DELETE /api/animals/:id - Delete animal
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const animal = await Animal.findById(req.params.id)
    if (!animal) {
      return res.status(404).json({ success: false, message: 'Animal not found' })
    }

    await Animal.findByIdAndDelete(req.params.id)

    res.json({ success: true, message: 'Animal deleted successfully' })
  } catch (error) {
    console.error('Error deleting animal:', error.message)
    res.status(500).json({ success: false, message: 'Server error while deleting animal' })
  }
})

// PATCH /api/animals/:id/visibility - Toggle visibility
router.patch('/:id/visibility', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const animal = await Animal.findById(req.params.id)
    if (!animal) {
      return res.status(404).json({ success: false, message: 'Animal not found' })
    }

    animal.visibility = !animal.visibility
    await animal.save()

    res.json({ success: true, visibility: animal.visibility, message: `Animal is now ${animal.visibility ? 'visible' : 'hidden'}` })
  } catch (error) {
    console.error('Error toggling visibility:', error.message)
    res.status(500).json({ success: false, message: 'Server error while toggling visibility' })
  }
})

// PATCH /api/animals/:id/status - Update status
router.patch('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['available', 'sold', 'reserved', 'new']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' })
    }

    const animal = await Animal.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    )

    if (!animal) {
      return res.status(404).json({ success: false, message: 'Animal not found' })
    }

    res.json({ success: true, animal, message: 'Status updated successfully' })
  } catch (error) {
    console.error('Error updating status:', error.message)
    res.status(500).json({ success: false, message: 'Server error while updating status' })
  }
})

export default router
