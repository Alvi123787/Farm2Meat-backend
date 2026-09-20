import express from 'express'
import mongoose from 'mongoose'
import Review from '../models/Review.js'
import Inquiry from '../models/Inquiry.js'
import MeatItem from '../models/MeatItem.js'
import Animal from '../models/Animal.js'
import User from '../models/User.js'
import { adminMiddleware, authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'
import { 
  sanitizeReviewText, 
  recalculateProductRating, 
  checkReviewRateLimit 
} from '../utils/reviewUtils.js'

const router = express.Router()

const RATING_MESSAGES = {
  1: 'Very Bad Experience',
  2: 'Bad Experience',
  3: 'Average Experience',
  4: 'Good Experience',
  5: 'Excellent Experience'
}

const DELIVERED_STATUSES = ['delivered', 'completed']

const isDeliveredStatus = (status) => {
  return DELIVERED_STATUSES.includes(String(status || '').trim().toLowerCase())
}

const normalize = (v) => String(v || '').trim().toLowerCase()

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/reviews — Public website reviews
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.headers['x-admin'] === 'true'
    const { productId, verifiedOnly, limit } = req.query

    const query = isAdmin ? {} : { hidden: false }

    if (productId && mongoose.Types.ObjectId.isValid(productId)) {
      query.product = new mongoose.Types.ObjectId(productId)
    }

    if (verifiedOnly === 'true') {
      query.isVerifiedPurchase = true
    }

    const maxLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))

    const reviews = await Review.find(query)
      .sort({ createdAt: -1 })
      .limit(maxLimit)
      .lean()

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/reviews/product/:productId — Reviews for a specific product
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid product ID is required' })
    }

    const pId = new mongoose.Types.ObjectId(productId)
    const reviews = await Review.find({ product: pId, hidden: false })
      .sort({ isVerifiedPurchase: -1, createdAt: -1 })
      .lean()

    // Calculate rating distribution & breakdown
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    let ratingSum = 0
    let verifiedCount = 0

    reviews.forEach((r) => {
      const star = Math.min(5, Math.max(1, Math.round(r.rating || 5)))
      distribution[star] = (distribution[star] || 0) + 1
      ratingSum += Number(r.rating || 0)
      if (r.isVerifiedPurchase) verifiedCount++
    })

    const reviewCount = reviews.length
    const averageRating = reviewCount > 0 ? Math.round((ratingSum / reviewCount) * 10) / 10 : 0

    return res.json({
      success: true,
      data: reviews,
      stats: {
        averageRating,
        reviewCount,
        verifiedCount,
        distribution
      }
    })
  } catch (error) {
    console.error('GET /api/reviews/product/:productId error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Failed to load product reviews' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/reviews/eligibility — Check if user can review this product
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/eligibility', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.query
    const userId = String(req.user?.id || '')
    const userEmail = normalize(req.user?.email)

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Valid product ID is required' })
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' })
    }

    // Look for all inquiries/orders for this user containing this product
    const orderQuery = {
      $and: [
        {
          $or: [
            { userId: userId },
            ...(mongoose.Types.ObjectId.isValid(userId) ? [{ userId: new mongoose.Types.ObjectId(userId) }] : []),
            ...(userEmail ? [{ email: userEmail }] : [])
          ]
        },
        { animalId: String(productId) }
      ]
    }

    const customerOrders = await Inquiry.find(orderQuery).sort({ createdAt: -1 }).lean()

    if (!customerOrders || customerOrders.length === 0) {
      return res.json({
        success: true,
        canReview: false,
        reason: 'not_purchased',
        message: 'Only verified customers who have purchased this product can leave a review.'
      })
    }

    // Filter for delivered orders
    const deliveredOrders = customerOrders.filter((order) => isDeliveredStatus(order.status))

    if (deliveredOrders.length === 0) {
      return res.json({
        success: true,
        canReview: false,
        reason: 'not_delivered',
        message: 'Your order for this product is currently being processed. You can review it once delivered.'
      })
    }

    // Check which delivered orders have already been reviewed
    const deliveredOrderIds = deliveredOrders.map((o) => o._id)
    const deliveredOrderGroupIds = deliveredOrders.map((o) => o.inquiryId).filter(Boolean)

    const existingReviews = await Review.find({
      product: new mongoose.Types.ObjectId(productId),
      $or: [
        { order: { $in: deliveredOrderIds } },
        { orderId: { $in: deliveredOrderGroupIds } }
      ]
    }).lean()

    const reviewedOrderIds = new Set([
      ...existingReviews.map((r) => String(r.order || '')),
      ...existingReviews.map((r) => String(r.orderId || ''))
    ])

    const availableOrders = deliveredOrders.filter(
      (o) => !reviewedOrderIds.has(String(o._id)) && !reviewedOrderIds.has(String(o.inquiryId))
    )

    if (availableOrders.length === 0) {
      return res.json({
        success: true,
        canReview: false,
        alreadyReviewed: true,
        reason: 'already_reviewed',
        message: 'You have already submitted a review for your delivered order of this product.'
      })
    }

    // Customer is eligible to review
    return res.json({
      success: true,
      canReview: true,
      eligibleOrders: availableOrders.map((o) => ({
        _id: o._id,
        inquiryId: o.inquiryId,
        orderGroupId: o.orderGroupId,
        status: o.status,
        date: o.createdAt || o.date,
        animalName: o.animalName
      })),
      message: 'You are eligible to review this verified purchase.'
    })
  } catch (error) {
    console.error('GET /api/reviews/eligibility error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Failed to check review eligibility' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/reviews — Submit verified purchase review
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.id || '').trim()
    const userEmail = normalize(req.user?.email)

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required to submit review' })
    }

    // Rate limiting: max 5 reviews per hour per user
    const rateCheck = checkReviewRateLimit(`user_${userId}`, 5, 60 * 60 * 1000)
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Too many reviews submitted. Please try again in ${rateCheck.retryAfterSeconds} seconds.`
      })
    }

    // Extract input from body (DO NOT trust isVerifiedPurchase, role, or user from body!)
    const { productId, orderId, rating, comment } = req.body || {}

    // Input Validation
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'A valid product ID is required' })
    }

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'An eligible order ID is required' })
    }

    const r = Number(rating)
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' })
    }

    const cleanComment = sanitizeReviewText(comment || req.body?.text)
    if (!cleanComment || cleanComment.length < 3) {
      return res.status(400).json({ success: false, message: 'Review comment must be at least 3 characters long' })
    }
    if (cleanComment.length > 1000) {
      return res.status(400).json({ success: false, message: 'Review comment cannot exceed 1000 characters' })
    }

    // ── Backend Order Verification ──
    const orderLookup = mongoose.Types.ObjectId.isValid(orderId)
      ? { $or: [{ _id: new mongoose.Types.ObjectId(orderId) }, { inquiryId: String(orderId).trim() }] }
      : { inquiryId: String(orderId).trim() }

    const order = await Inquiry.findOne(orderLookup).lean()

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order record not found' })
    }

    // 1. Verify order ownership
    const isOwner =
      String(order.userId || '') === userId ||
      (userEmail && normalize(order.email) === userEmail)

    if (!isOwner) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only submit reviews for your own orders.'
      })
    }

    // 2. Verify order delivery status
    if (!isDeliveredStatus(order.status)) {
      return res.status(403).json({
        success: false,
        message: `Reviews can only be submitted for delivered orders. Current status: ${order.status}`
      })
    }

    // 3. Verify product belongs to this order
    const orderProductId = String(order.animalId || '').trim()
    const targetProductId = String(productId).trim()

    if (orderProductId !== targetProductId) {
      return res.status(403).json({
        success: false,
        message: 'This order does not contain the specified product.'
      })
    }

    // 4. Prevent duplicate review for the same product from the same order
    const existingReview = await Review.findOne({
      product: new mongoose.Types.ObjectId(productId),
      $or: [
        { order: order._id },
        { orderId: order.inquiryId }
      ]
    }).lean()

    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: 'You have already submitted a review for this product from this order.'
      })
    }

    // Find product details for metadata
    let productModel = 'MeatItem'
    let productName = order.animalName || 'Product'

    const meatItem = await MeatItem.findById(productId).select('name').lean()
    if (meatItem) {
      productModel = 'MeatItem'
      productName = meatItem.name
    } else {
      const animal = await Animal.findById(productId).select('name').lean()
      if (animal) {
        productModel = 'Animal'
        productName = animal.name
      }
    }

    // Fetch user details for reviewer name
    const userDoc = await User.findById(userId).select('fullName email city').lean()
    const reviewerName = userDoc?.fullName || order.customerName || userEmail?.split('@')[0] || 'Customer'
    const reviewerLocation = userDoc?.city || order.city || ''

    // Create verified review (strictly backend-controlled isVerifiedPurchase!)
    const newReview = await Review.create({
      user: new mongoose.Types.ObjectId(userId),
      product: new mongoose.Types.ObjectId(productId),
      productModel,
      productName,
      order: order._id,
      orderId: order.inquiryId,
      rating: Math.round(r),
      comment: cleanComment,
      text: cleanComment,
      isVerifiedPurchase: true, // Only assigned by backend after passing all checks
      name: reviewerName,
      email: userEmail || order.email || '',
      location: reviewerLocation,
      reviewSource: 'verified_order',
      hidden: false
    })

    // Recalculate dynamic rating and review counts for the product
    await recalculateProductRating(productId, productModel)

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your verified purchase review has been submitted.',
      data: newReview
    })
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate review rejected: You already reviewed this product for this order.'
      })
    }
    console.error('POST /api/reviews error:', error)
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit review'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/reviews/post-order — Post-checkout feedback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/post-order', optionalAuthMiddleware, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim()
    const rating = Number(req.body?.rating)
    const extraMessage = sanitizeReviewText(req.body?.message || '')
    const name = String(req.body?.name || '').trim()
    const email = normalize(req.body?.email)
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

    const existing = await Review.findOne({ orderId, reviewSource: 'emoji_post_order' }).lean()
    if (existing) {
      return res.status(409).json({ success: false, message: 'You already submitted feedback for this order' })
    }

    // Verify if order exists and is delivered
    const matchedOrder = await Inquiry.findOne({
      $or: [{ orderGroupId: orderId }, { inquiryId: orderId }]
    }).lean()

    const isDelivered = matchedOrder && isDeliveredStatus(matchedOrder.status)

    const baseText = RATING_MESSAGES[Math.round(rating)] || 'Order feedback'
    const text = extraMessage ? `${baseText}. ${extraMessage}` : baseText

    const created = await Review.create({
      name,
      rating: Math.round(rating),
      comment: text,
      text,
      orderId,
      order: matchedOrder ? matchedOrder._id : null,
      user: userId && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null,
      userId: userId || '',
      email,
      selectedEmoji: Math.round(rating),
      reviewSource: 'emoji_post_order',
      isVerifiedPurchase: Boolean(isDelivered),
      location: matchedOrder?.city || ''
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/reviews/admin — Admin reviews management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { verifiedOnly, hidden, search } = req.query
    const query = {}

    if (verifiedOnly === 'true') {
      query.isVerifiedPurchase = true
    } else if (verifiedOnly === 'false') {
      query.isVerifiedPurchase = false
    }

    if (hidden === 'true') {
      query.hidden = true
    } else if (hidden === 'false') {
      query.hidden = false
    }

    if (search && typeof search === 'string') {
      const s = search.trim()
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { text: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { orderId: { $regex: s, $options: 'i' } },
        { productName: { $regex: s, $options: 'i' } }
      ]
    }

    const reviews = await Review.find(query)
      .populate('user', 'fullName email')
      .populate('order', 'inquiryId status deliveryDate totalAmount')
      .sort({ createdAt: -1 })
      .lean()

    return res.json({
      success: true,
      total: reviews.length,
      data: reviews
    })
  } catch (error) {
    console.error('GET /api/reviews/admin error:', error)
    return res.status(500).json({ success: false, message: error.message || 'Failed to load admin reviews' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/reviews/:id — Admin delete review
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const removed = await Review.findByIdAndDelete(req.params.id)
    if (!removed) return res.status(404).json({ success: false, message: 'Review not found' })

    // Recalculate product rating if review was linked to a product
    if (removed.product) {
      await recalculateProductRating(removed.product, removed.productModel)
    }

    return res.json({ success: true, message: 'Review deleted successfully' })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to delete review' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATCH /api/reviews/:id/toggle-hidden — Admin toggle hidden status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.patch('/:id/toggle-hidden', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id)
    if (!review) return res.status(404).json({ success: false, message: 'Review not found' })

    review.hidden = !review.hidden
    const updated = await review.save()

    // Recalculate product rating since hidden status affects active ratings
    if (updated.product) {
      await recalculateProductRating(updated.product, updated.productModel)
    }

    return res.json({
      success: true,
      message: `Review ${updated.hidden ? 'hidden' : 'unhidden'} successfully`,
      data: updated
    })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to update review' })
  }
})

export default router
