import express from 'express'
import Animal from '../models/Animal.js'
import User from '../models/User.js'
import { authMiddleware, adminMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'
import upload from '../middleware/upload.js'
import { sendEmail } from '../utils/mailer.js'
import { buildNewAnimalNotificationHtml } from '../utils/orderEmailTemplates.js'
import cloudinary from '../config/cloudinary.js'
import sanitizeHtml from 'sanitize-html'

const router = express.Router()

// ── Helper: Upload Buffer to Cloudinary ──
const uploadToCloudinary = (fileBuffer, resourceType = 'auto', folder = 'animals') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: folder,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      }
    );
    uploadStream.end(fileBuffer);
  });
};

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
  { name: 'video', maxCount: 1 }
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
    
    // Handle images upload to Cloudinary
    let uploadedImages = []
    if (req.files?.images) {
      const uploadPromises = req.files.images.map(file => 
        uploadToCloudinary(file.buffer, 'image', 'animals/images')
      )
      uploadedImages = await Promise.all(uploadPromises)
    }
    animalData.images = [...uploadedImages, ...urlImages]

    // Backward compatibility single image field
    animalData.imageUrl = animalData.images[0] || ''

    // Handle video upload to Cloudinary
    let uploadedVideos = []
    if (req.files?.video) {
      const uploadPromises = req.files.video.map(file => 
        uploadToCloudinary(file.buffer, 'video', 'animals/videos')
      )
      uploadedVideos = await Promise.all(uploadPromises)
    }
    animalData.videos = [...uploadedVideos, ...urlVideos]

    // Clean up non-schema fields
    delete animalData.urlImages
    delete animalData.urlVideos

    // Rich Description Sanitization
    if (animalData.fullDescription) {
      animalData.fullDescription = sanitizeHtml(animalData.fullDescription, {
        allowedTags: ['br', 'ul', 'ol', 'li', 'strong', 'em', 'h1', 'h2', 'h3', 'p', 'span'],
        allowedAttributes: {
          '*': ['style', 'class']
        }
      })
    }

    // Data cleaning
    if (animalData.teeth !== undefined) {
      if (animalData.teeth === '' || animalData.teeth === null) {
        animalData.teeth = null
      } else {
        animalData.teeth = parseInt(animalData.teeth)
      }
    }
    
    // Age and Unit
    if (animalData.age) animalData.age = parseInt(animalData.age)
    
    if (animalData.visibility !== undefined) animalData.visibility = String(animalData.visibility) === 'true'
    if (animalData.deliveryAvailable !== undefined) animalData.deliveryAvailable = String(animalData.deliveryAvailable) === 'true'
    if (animalData.negotiable !== undefined) animalData.negotiable = String(animalData.negotiable) === 'true'

    if (!animalData.type) animalData.type = 'animal'

    const animal = new Animal(animalData)
    await animal.save()

    // ── New Animal Notification ──
    if (animal.visibility !== false) {
      try {
        const admins = await User.find({ role: 'admin' }).select('email').lean()
        const adminEmails = admins.map(a => a.email).filter(e => e)

        if (adminEmails.length > 0) {
          const emailHtml = buildNewAnimalNotificationHtml(animal)
          await sendEmail({
            to: adminEmails,
            subject: `New Animal Added: ${animal.name} (${animal.category})`,
            html: emailHtml
          })
        }
      } catch (err) {
        console.error('Failed to send admin notification email:', err.message)
      }
    }

    res.status(201).json({
      success: true,
      message: 'Animal created successfully',
      data: animal
    })
  } catch (error) {
    console.error('Error creating animal:', error.message)
    res.status(400).json({ success: false, message: error.message || 'Error creating animal' })
  }
})

// PUT /api/animals/:id - Update animal
router.put('/:id', authMiddleware, adminMiddleware, upload.fields([
  { name: 'images', maxCount: 10 },
  { name: 'video', maxCount: 1 }
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

    // Upload new images to Cloudinary
    if (req.files?.images) {
      const uploadPromises = req.files.images.map(file => 
        uploadToCloudinary(file.buffer, 'image', 'animals/images')
      )
      const newUploadedImages = await Promise.all(uploadPromises)
      finalImages = [...finalImages, ...newUploadedImages]
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

    // Upload new video to Cloudinary
    if (req.files?.video) {
      const uploadPromises = req.files.video.map(file => 
        uploadToCloudinary(file.buffer, 'video', 'animals/videos')
      )
      const newUploadedVideos = await Promise.all(uploadPromises)
      finalVideos = [...finalVideos, ...newUploadedVideos]
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

    // Rich Description Sanitization
    if (updateData.fullDescription) {
      updateData.fullDescription = sanitizeHtml(updateData.fullDescription, {
        allowedTags: ['br', 'ul', 'ol', 'li', 'strong', 'em', 'h1', 'h2', 'h3', 'p', 'span'],
        allowedAttributes: {
          '*': ['style', 'class']
        }
      })
    }

    // Data cleaning
    if (updateData.teeth !== undefined) {
      if (updateData.teeth === '' || updateData.teeth === null) {
        updateData.teeth = null
      } else {
        updateData.teeth = parseInt(updateData.teeth)
      }
    }
    
    // Age and Unit
    if (updateData.age) updateData.age = parseInt(updateData.age)

    if (updateData.visibility !== undefined) updateData.visibility = String(updateData.visibility) === 'true'
    if (updateData.deliveryAvailable !== undefined) updateData.deliveryAvailable = String(updateData.deliveryAvailable) === 'true'
    if (updateData.negotiable !== undefined) updateData.negotiable = String(updateData.negotiable) === 'true'

    const updatedAnimal = await Animal.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    )

    res.json({
      success: true,
      message: 'Animal updated successfully',
      data: updatedAnimal
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
