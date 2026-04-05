import express from 'express'
import Animal from '../models/Animal.js'
import Inquiry from '../models/Inquiry.js'
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware, adminMiddleware)

const safeRegex = (q) => {
  const escaped = String(q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'i')
}

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json({ success: true, q: '', results: { animals: [], inquiries: [] } })

    const limit = Math.max(1, Math.min(10, parseInt(req.query.limit || '8', 10) || 8))
    const rx = safeRegex(q)

    const [animals, inquiries] = await Promise.all([
      Animal.find({
        $or: [
          { name: rx },
          { breed: rx },
          { category: rx },
          { city: rx }
        ]
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select({ name: 1, breed: 1, city: 1, status: 1, price: 1, createdAt: 1 })
        .lean(),
      Inquiry.find({
        $or: [
          { inquiryId: rx },
          { customerName: rx },
          { phone: rx },
          { animalName: rx },
          { animalTag: rx },
          { city: rx }
        ]
      })
        .sort({ date: -1 })
        .limit(limit)
        .select({ inquiryId: 1, customerName: 1, phone: 1, animalName: 1, status: 1, totalAmount: 1, date: 1 })
        .lean()
    ])

    return res.json({ success: true, q, results: { animals, inquiries } })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Search failed' })
  }
})

export default router
