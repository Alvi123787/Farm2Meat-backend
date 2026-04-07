import express from 'express'
import Butcher from '../models/Butcher.js'
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js'
import upload from '../middleware/upload.js'

const router = express.Router()

// GET /api/butchers - Get all butchers
router.get('/', async (req, res) => {
  try {
    const butchers = await Butcher.find().sort({ createdAt: -1 })
    res.json({ success: true, data: butchers })
  } catch (error) {
    console.error('Error fetching butchers:', error.message)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

// POST /api/butchers - Create a new butcher (Admin only)
router.post('/', authMiddleware, adminMiddleware, upload.single('image'), async (req, res) => {
  try {
    const { name, phone, location, isVerified, avatar } = req.body

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required' })
    }

    const image = req.file ? req.file.path : null

    const butcher = new Butcher({
      name,
      phone,
      location,
      isVerified: isVerified === true || isVerified === 'true',
      avatar,
      image
    })

    await butcher.save()
    res.status(201).json({ success: true, data: butcher })
  } catch (error) {
    console.error('Error creating butcher:', error.message)
    res.status(400).json({ success: false, message: error.message })
  }
})

// DELETE /api/butchers/:id - Delete a butcher (Admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const butcher = await Butcher.findByIdAndDelete(req.params.id)
    if (!butcher) {
      return res.status(404).json({ success: false, message: 'Butcher not found' })
    }

    res.json({ success: true, message: 'Butcher deleted successfully' })
  } catch (error) {
    console.error('Error deleting butcher:', error.message)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
