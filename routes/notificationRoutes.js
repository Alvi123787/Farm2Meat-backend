import express from 'express'
import Notification from '../models/Notification.js'
import { adminMiddleware, authMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

router.use(authMiddleware, adminMiddleware)

router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ isRead: false })
    return res.json({ success: true, count })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load notifications' })
  }
})

router.get('/', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit || '10', 10) || 10))
    const items = await Notification.find()
      .sort({ isRead: 1, createdAt: -1 })
      .limit(limit)
      .lean()
    return res.json({ success: true, data: items })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load notifications' })
  }
})

router.patch('/:id/read', async (req, res) => {
  try {
    const item = await Notification.findByIdAndUpdate(req.params.id, { isRead: true }, { returnDocument: 'after' })
    if (!item) return res.status(404).json({ success: false, message: 'Notification not found' })
    return res.json({ success: true, data: item })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update notification' })
  }
})

router.patch('/read-all', async (req, res) => {
  try {
    const result = await Notification.updateMany({ isRead: false }, { $set: { isRead: true } })
    return res.json({ success: true, updated: result.modifiedCount || 0 })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update notifications' })
  }
})

export default router
