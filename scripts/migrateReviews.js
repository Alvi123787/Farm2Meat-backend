import dotenv from 'dotenv'
dotenv.config()
import connectDB from '../utils/db.js'
import mongoose from 'mongoose'
import Review from '../models/Review.js'
import Inquiry from '../models/Inquiry.js'
import { recalculateProductRating } from '../utils/reviewUtils.js'

async function migrate() {
  console.log('--- Starting Reviews Data Audit & Migration ---')
  await connectDB()

  const reviews = await Review.find({})
  console.log(`Found ${reviews.length} total reviews to audit.`)

  let verifiedCount = 0
  let unverifiedCount = 0
  const touchedProductIds = new Set()

  for (const review of reviews) {
    let isVerified = false
    let linkedOrder = null

    // If review already has an orderId or order reference, check against database
    const orderIdToSearch = review.orderId || (review.order ? String(review.order) : '')

    if (orderIdToSearch) {
      const inquiry = await Inquiry.findOne({
        $or: [
          ...(mongoose.Types.ObjectId.isValid(orderIdToSearch) ? [{ _id: new mongoose.Types.ObjectId(orderIdToSearch) }] : []),
          { inquiryId: orderIdToSearch },
          { orderGroupId: orderIdToSearch }
        ]
      }).lean()

      if (inquiry && ['delivered', 'completed'].includes(String(inquiry.status || '').trim().toLowerCase())) {
        isVerified = true
        linkedOrder = inquiry._id
      }
    }

    // Never fabricate verified status: only mark verified if genuine delivered order exists
    review.isVerifiedPurchase = Boolean(isVerified)
    if (linkedOrder && !review.order) {
      review.order = linkedOrder
    }

    // Ensure comment and text are synchronized
    if (!review.comment && review.text) {
      review.comment = review.text
    } else if (!review.text && review.comment) {
      review.text = review.comment
    }

    await review.save()

    if (isVerified) {
      verifiedCount++
      if (review.product) touchedProductIds.add(String(review.product))
    } else {
      unverifiedCount++
    }
  }

  // Recalculate ratings for any touched products
  for (const pId of touchedProductIds) {
    await recalculateProductRating(pId)
  }

  console.log('--- Migration & Audit Summary ---')
  console.log(`Total Reviews: ${reviews.length}`)
  console.log(`Verified Purchases: ${verifiedCount}`)
  console.log(`Unverified Reviews: ${unverifiedCount}`)
  console.log('Data audit complete. No fake verification was applied.')

  await mongoose.disconnect()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
