import sanitizeHtml from 'sanitize-html'
import mongoose from 'mongoose'
import MeatItem from '../models/MeatItem.js'
import Animal from '../models/Animal.js'
import Review from '../models/Review.js'

// ── In-Memory Rate Limiter for Review Submissions ──
const rateLimitStore = new Map()

/**
 * Checks sliding window rate limit for review submissions.
 * Default: 5 submissions per 60 minutes per user/IP.
 */
export const checkReviewRateLimit = (key, maxRequests = 5, windowMs = 60 * 60 * 1000) => {
  if (!key) return { allowed: true }
  const now = Date.now()
  const record = rateLimitStore.get(key)

  // Cleanup old records periodically
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now > v.resetTime) {
        rateLimitStore.delete(k)
      }
    }
  }

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs })
    return { allowed: true }
  }

  if (record.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000))
    return { allowed: false, retryAfterSeconds }
  }

  record.count += 1
  return { allowed: true }
}

/**
 * Sanitizes review text to prevent XSS attacks while keeping text clean.
 */
export const sanitizeReviewText = (text) => {
  if (!text || typeof text !== 'string') return ''
  const clean = sanitizeHtml(text, {
    allowedTags: [], // Strip all HTML tags entirely for review comments
    allowedAttributes: {}
  })
  return clean.trim()
}

/**
 * Recalculates average rating and review count for a product.
 * Excludes hidden and unverified reviews from verified-only rating calculations.
 */
export const recalculateProductRating = async (productId, productModelHint = '') => {
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    return { averageRating: 0, reviewCount: 0 }
  }

  const pId = new mongoose.Types.ObjectId(productId)

  try {
    // Aggregate only verified, non-hidden reviews
    const stats = await Review.aggregate([
      {
        $match: {
          product: pId,
          hidden: false,
          isVerifiedPurchase: true
        }
      },
      {
        $group: {
          _id: '$product',
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 }
        }
      }
    ])

    const reviewCount = stats.length > 0 ? stats[0].reviewCount : 0
    const rawAverage = stats.length > 0 ? stats[0].averageRating : 0
    const averageRating = reviewCount > 0 ? Math.round(rawAverage * 10) / 10 : 0

    // Update MeatItem if it exists
    if (productModelHint === 'MeatItem' || !productModelHint) {
      const updatedMeat = await MeatItem.findByIdAndUpdate(
        pId,
        { averageRating, reviewCount },
        { returnDocument: 'after' }
      ).lean()
      if (updatedMeat) {
        return { averageRating, reviewCount, productModel: 'MeatItem' }
      }
    }

    // Update Animal if MeatItem wasn't found or hint is Animal
    if (productModelHint === 'Animal' || !productModelHint) {
      const updatedAnimal = await Animal.findByIdAndUpdate(
        pId,
        { averageRating, reviewCount },
        { returnDocument: 'after' }
      ).lean()
      if (updatedAnimal) {
        return { averageRating, reviewCount, productModel: 'Animal' }
      }
    }

    return { averageRating, reviewCount }
  } catch (error) {
    console.error(`Error recalculating rating for product ${productId}:`, error.message)
    return { averageRating: 0, reviewCount: 0 }
  }
}
