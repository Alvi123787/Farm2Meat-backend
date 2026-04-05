import express from 'express'
import Review from '../models/Review.js'
import { adminMiddleware, authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

const RATING_MESSAGES = {
  1: 'Very Bad Experience',
  2: 'Bad Experience',
  3: 'Average Experience',
  4: 'Good Experience',
  5: 'Excellent Experience'
}

router.get('/', async (req, res) => {
  try {
    // Return all reviews, sorted by newest first
    const reviews = await Review.find().sort({ createdAt: -1 }).lean()
    
    // Ensure data is always an array
    return res.json({ 
      success: true, 
      data: Array.isArray(reviews) ? reviews : [] 
    })
  } catch (error) {
    console.error('GET /api/reviews error:', error)
    return res.status(500).json({ 
      success: false,
      data: [], 
      message: error.message || 'Failed to load reviews' 
    })
  }
})

/** Public website reviews (legacy + manual form) */
router.post('/', async (req, res) => {
  try {
    const { name, rating, text } = req.body || {}

    const cleanName = String(name || '').trim()
    const cleanText = String(text || '').trim()
    const r = Number(rating)

    if (!cleanName || !cleanText) {
      return res.status(400).json({ success: false, message: 'Name and review message are required' })
    }

    if (!Number.isFinite(r) || r < 1 || r > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' })
    }

    const created = await Review.create({
      name: cleanName,
      rating: r,
      text: cleanText,
      reviewSource: 'manual',
      location: ''
    })

    return res.status(201).json({ success: true, message: 'Review submitted', data: created })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to submit review' })
  }
})

/**
 * Post-checkout emoji rating (one per orderId).
 * optionalAuthMiddleware attaches req.user when Bearer token present.
 */
router.post('/post-order', optionalAuthMiddleware, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim()
    const rating = Number(req.body?.rating)
    const extraMessage = String(req.body?.message || '').trim()
    const name = String(req.body?.name || '').trim()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const userId = String(req.user?.id || req.body?.userId || '').trim()

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' })
    }

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' })
    }

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' })
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' })
    }

    const existing = await Review.findOne({ orderId }).lean()
    if (existing) {
      return res.status(409).json({ success: false, message: 'You already submitted feedback for this order' })
    }

    const baseText = RATING_MESSAGES[Math.round(rating)] || 'Order feedback'
    const text = extraMessage ? `${baseText}. ${extraMessage}` : baseText

    const created = await Review.create({
      name,
      rating: Math.round(rating),
      text,
      orderId,
      userId: userId || '',
      email,
      selectedEmoji: Math.round(rating),
      reviewSource: 'emoji_post_order',
      location: ''
    })

    return res.status(201).json({
      success: true,
      message: 'Thank you for your feedback!',
      data: created
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: 'Feedback already submitted for this order' })
    }
    console.error('POST /reviews/post-order:', error)
    return res.status(500).json({ success: false, message: error.message || 'Failed to save review' })
  }
})

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const removed = await Review.findByIdAndDelete(req.params.id)
    if (!removed) return res.status(404).json({ success: false, message: 'Review not found' })
    return res.json({ success: true, message: 'Review deleted' })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete review' })
  }
})

export default router
