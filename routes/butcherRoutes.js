import express from 'express'
import Butcher from '../models/Butcher.js'
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const router = express.Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fullPath = path.join(__dirname, '..', 'uploads', 'butchers')
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true })
    cb(null, fullPath)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, 'butcher-' + uniqueSuffix + path.extname(file.originalname))
  }
})

const fileFilter = (req, file, cb) => {
  if (allowedImageTypes.includes(file.mimetype)) return cb(null, true)
  return cb(new Error('Invalid image type. Only JPG, JPEG, PNG, WEBP are allowed.'), false)
}

const uploadButcherImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
})

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
router.post('/', authMiddleware, adminMiddleware, uploadButcherImage.single('image'), async (req, res) => {
  try {
    const { name, phone, location, isVerified, avatar } = req.body

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required' })
    }

    const image = req.file ? `/uploads/butchers/${req.file.filename}` : null

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

    const imagePath = butcher.image && butcher.image.startsWith('/uploads/')
      ? path.join(__dirname, '..', butcher.image.replace(/^\//, ''))
      : null

    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath)
      } catch (e) {
        console.error('Error removing butcher image:', e.message)
      }
    }

    res.json({ success: true, message: 'Butcher deleted successfully' })
  } catch (error) {
    console.error('Error deleting butcher:', error.message)
    res.status(500).json({ success: false, message: 'Server error' })
  }
})

export default router
