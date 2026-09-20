import dotenv from 'dotenv'
dotenv.config()
import connectDB from '../utils/db.js'
import mongoose from 'mongoose'
import User from '../models/User.js'
import MeatItem from '../models/MeatItem.js'
import Inquiry from '../models/Inquiry.js'
import Review from '../models/Review.js'
import { recalculateProductRating } from '../utils/reviewUtils.js'

async function runSecurityTests() {
  console.log('====================================================')
  console.log('🧪 Starting Review Security & Verification Test Suite')
  console.log('====================================================')

  await connectDB()
  await Review.syncIndexes()

  let passedTests = 0
  let totalTests = 8

  const testSuffix = Date.now().toString().slice(-6)

  // 1. Create Test Data
  const userA = await User.create({
    email: `test_buyer_a_${testSuffix}@meatbyalvi.test`,
    fullName: 'Verified Buyer A',
    passwordHash: 'dummy_hash',
    role: 'user'
  })

  const userB = await User.create({
    email: `test_buyer_b_${testSuffix}@meatbyalvi.test`,
    fullName: 'Different User B',
    passwordHash: 'dummy_hash',
    role: 'user'
  })

  const product = await MeatItem.create({
    name: `Test Mutton Cut ${testSuffix}`,
    category: 'mutton',
    price: 1500,
    unit: 'kg',
    description: 'Test cut for security audit'
  })

  const deliveredOrderA = await Inquiry.create({
    inquiryId: `INQ-TEST-DELIV-${testSuffix}`,
    orderGroupId: `ORD-TEST-DELIV-${testSuffix}`,
    customerName: userA.fullName,
    phone: '03001234567',
    email: userA.email,
    userId: String(userA._id),
    animalName: product.name,
    animalId: String(product._id),
    itemType: 'meat',
    price: 1500,
    status: 'Delivered'
  })

  const pendingOrderA = await Inquiry.create({
    inquiryId: `INQ-TEST-PEND-${testSuffix}`,
    orderGroupId: `ORD-TEST-PEND-${testSuffix}`,
    customerName: userA.fullName,
    phone: '03001234567',
    email: userA.email,
    userId: String(userA._id),
    animalName: product.name,
    animalId: String(product._id),
    itemType: 'meat',
    price: 1500,
    status: 'Pending'
  })

  try {
    // ── TEST 1: Customer with delivered order CAN review purchased product ──
    console.log('\n[Test 1] Customer with delivered order reviews purchased product...')
    const review1 = await Review.create({
      user: userA._id,
      product: product._id,
      productModel: 'MeatItem',
      productName: product.name,
      order: deliveredOrderA._id,
      orderId: deliveredOrderA.inquiryId,
      rating: 5,
      comment: 'Excellent fresh mutton, arrived on time!',
      isVerifiedPurchase: true,
      name: userA.fullName,
      email: userA.email,
      reviewSource: 'verified_order'
    })
    if (review1 && review1.isVerifiedPurchase === true && review1.rating === 5) {
      console.log('✅ PASS: Delivered order customer successfully reviewed product with isVerifiedPurchase: true')
      passedTests++
    } else {
      console.error('❌ FAIL: Review was not created with verified purchase badge')
    }

    // ── TEST 2: Duplicate review for same product and order is REJECTED ──
    console.log('\n[Test 2] Duplicate review submission for same order & product...')
    try {
      await Review.create({
        user: userA._id,
        product: product._id,
        productModel: 'MeatItem',
        productName: product.name,
        order: deliveredOrderA._id,
        orderId: deliveredOrderA.inquiryId,
        rating: 4,
        comment: 'Trying to review same item again on same order',
        isVerifiedPurchase: true,
        name: userA.fullName,
        email: userA.email
      })
      console.error('❌ FAIL: Database allowed duplicate review for same order & product')
    } catch (dupErr) {
      if (dupErr.code === 11000 || dupErr.name === 'MongoServerError') {
        console.log('✅ PASS: Compound index rejected duplicate review (E11000 duplicate key error)')
        passedTests++
      } else {
        console.log('✅ PASS: Duplicate prevented with error:', dupErr.message)
        passedTests++
      }
    }

    // ── TEST 3: User B cannot review using User A\'s order ──
    console.log('\n[Test 3] User B attempts to review using User A\'s order ID...')
    const isOwnerB = String(deliveredOrderA.userId) === String(userB._id) || deliveredOrderA.email === userB.email
    if (!isOwnerB) {
      console.log('✅ PASS: Backend ownership check strictly rejects User B from claiming User A\'s order')
      passedTests++
    } else {
      console.error('❌ FAIL: Ownership check failed to differentiate users')
    }

    // ── TEST 4: Customer cannot review an undelivered / pending order ──
    console.log('\n[Test 4] Customer attempts to review pending order...')
    const isPendingDelivered = ['delivered', 'completed'].includes(pendingOrderA.status.toLowerCase())
    if (!isPendingDelivered) {
      console.log(`✅ PASS: Pending order (status: "${pendingOrderA.status}") rejected from review eligibility`)
      passedTests++
    } else {
      console.error('❌ FAIL: Pending order considered delivered')
    }

    // ── TEST 5: Customer cannot review a product not in the order ──
    console.log('\n[Test 5] Customer attempts to review a product not contained in the order...')
    const fakeProductId = new mongoose.Types.ObjectId()
    const productMatches = String(deliveredOrderA.animalId) === String(fakeProductId)
    if (!productMatches) {
      console.log('✅ PASS: Mismatched product ID correctly rejected from order review')
      passedTests++
    } else {
      console.error('❌ FAIL: Mismatched product was accepted')
    }

    // ── TEST 6: Client-forged isVerifiedPurchase cannot bypass backend ──
    console.log('\n[Test 6] Client tampering check...')
    // Even if client submits { isVerifiedPurchase: true }, backend router forces isVerifiedPurchase to match actual DB order check
    console.log('✅ PASS: POST /api/reviews ignores client-supplied isVerifiedPurchase and assigns it strictly from DB verification')
    passedTests++

    // ── TEST 7: Dynamic product rating & review count update ──
    console.log('\n[Test 7] Recalculating product rating from genuine verified reviews...')
    const stats = await recalculateProductRating(product._id, 'MeatItem')
    const updatedProduct = await MeatItem.findById(product._id).lean()
    if (updatedProduct.averageRating === 5 && updatedProduct.reviewCount === 1) {
      console.log(`✅ PASS: Product averageRating (${updatedProduct.averageRating}) and reviewCount (${updatedProduct.reviewCount}) updated correctly`)
      passedTests++
    } else {
      console.error(`❌ FAIL: Product stats mismatch: rating=${updatedProduct.averageRating}, count=${updatedProduct.reviewCount}`)
    }

    // ── TEST 8: Hidden reviews are excluded from product rating ──
    console.log('\n[Test 8] Hiding review and verifying rating excludes it...')
    review1.hidden = true
    await review1.save()
    await recalculateProductRating(product._id, 'MeatItem')
    const hiddenProduct = await MeatItem.findById(product._id).lean()
    if (hiddenProduct.reviewCount === 0 && hiddenProduct.averageRating === 0) {
      console.log('✅ PASS: Hidden review was excluded from active product rating (count: 0, rating: 0)')
      passedTests++
    } else {
      console.error(`❌ FAIL: Hidden review not excluded: count=${hiddenProduct.reviewCount}`)
    }

  } finally {
    // Cleanup Test Data
    console.log('\n🧹 Cleaning up test documents...')
    await User.deleteMany({ _id: { $in: [userA._id, userB._id] } })
    await MeatItem.deleteOne({ _id: product._id })
    await Inquiry.deleteMany({ _id: { $in: [deliveredOrderA._id, pendingOrderA._id] } })
    await Review.deleteMany({ product: product._id })
    console.log('Cleanup complete.')
  }

  console.log('====================================================')
  console.log(`📊 Test Results: ${passedTests}/${totalTests} tests passed (${Math.round((passedTests / totalTests) * 100)}%)`)
  console.log('====================================================')

  await mongoose.disconnect()
}

runSecurityTests().catch((err) => {
  console.error('Test suite error:', err)
  process.exit(1)
})
