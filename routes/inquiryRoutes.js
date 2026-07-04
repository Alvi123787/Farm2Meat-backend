import express from 'express'
import mongoose from 'mongoose'
import Inquiry from '../models/Inquiry.js'
import Animal from '../models/Animal.js'
import MeatItem from '../models/MeatItem.js'
import User from '../models/User.js'
import GuestUser from '../models/GuestUser.js'
import CartSession from '../models/CartSession.js'
import Notification from '../models/Notification.js'
import { authMiddleware, adminMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'
import { sendEmail } from '../utils/mailer.js'
import { getFrontendOrigin } from '../utils/config.js'
import { 
  buildOrderConfirmationEmailHtml, 
  buildAdminOrderNotificationEmailHtml,
  buildOrderFeedbackEmailHtml,
  buildSoldOutNotificationEmailHtml,
  buildExpiredCartRemovalEmailHtml,
  buildAllItemsSoldNotificationEmailHtml,
  buildOrderStatusEmailHtml
} from '../utils/orderEmailTemplates.js'

const router = express.Router()

const getAdminEmail = () => process.env.ADMIN_EMAIL || 'rebalalvi123@gmail.com'

// ── Helper: Generate unique inquiry ID ──
const generateInquiryId = () => {
  const timestamp = Date.now().toString().slice(-6)
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0')
  return `INQ-${timestamp}${random}`
}

// ── Helper: Parse price string to number ──
const parsePrice = (price) => {
  if (!price) return 0
  if (typeof price === 'number') return price
  return parseInt(price.replace(/,/g, ''), 10) || 0
}

const generateOrderGroupId = () => {
  const ts = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `ORD-${ts}${random}`
}

const formatOrderDate = (d = new Date()) =>
  d.toLocaleString('en-PK', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const normalize = (v) => String(v || '').trim().toLowerCase()

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/inquiries/create — Create new inquiry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/create', optionalAuthMiddleware, async (req, res) => {
  try {
    const {
      customerName,
      phone,
      email,
      animalName,
      animalId,
      breed,
      weight,
      price,
      quantity,
      totalAmount,
      deliveryAddress,
      city,
      deliveryDate,
      paymentMethod,
      orderSource,
      notes,
      animalCare
    } = req.body

    // Basic validation
    if (!customerName || !phone || !animalName) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and animal name are required'
      })
    }

    // Build avatar from customer name initials
    const nameParts = customerName.trim().split(' ')
    const avatar = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
      : customerName.slice(0, 2).toUpperCase()

    const parsedPrice = parsePrice(price)
    const qty = quantity || 1

    const userId = String(req.user?.id || '')
    const isMeat = normalize(req.body.itemType) === 'meat'
    
    let category = req.body.category || ''
    let animalCarePrice = 0
    let advanceAmount = 0
    let remainingAmount = 0
    let unit = req.body.unit || ''
    
    // Check meat item availability and get unit and category if needed
    if (isMeat && req.body.animalId) {
      try {
        const meatItem = await MeatItem.findById(req.body.animalId).lean()
        if (meatItem) {
          if (!meatItem.isAvailable) {
            return res.status(409).json({
              success: false,
              message: `Sorry, ${meatItem.name} is currently unavailable. Please check back later.`
            })
          }
          unit = meatItem.unit || 'kg'
          category = meatItem.category || category
        }
      } catch (e) {
        console.warn('Could not fetch meat item:', e.message)
      }
    }

    if (animalId && !isMeat) {
      // ── ATOMIC AVAILABILITY CHECK & RESERVE ──
      // Only for livestock, not meat items
      const animal = await Animal.findOneAndUpdate(
        { 
          _id: animalId, 
          status: { $in: ['available', 'new'] },
          visibility: true
        },
        { 
          $set: { status: 'reserved', visibility: false } 
        },
        { new: true }
      )

      if (!animal) {
        return res.status(409).json({ 
          success: false, 
          message: 'This animal has just been purchased by another user. Please select another animal.' 
        })
      }
      category = animal.category || category
    }

    // Calculate Care Service Price if selected
    if (animalCare) {
      animalCarePrice = 100 // Example: Rs. 100 per day or fixed
    }

    // Calculate Total with Service
    const finalTotal = (totalAmount || (parsedPrice * qty)) + animalCarePrice

    // 20% Advance Calculation (Only for Livestock)
    if (!isMeat) {
      advanceAmount = Math.round(finalTotal * 0.20)
    }
    remainingAmount = finalTotal - advanceAmount

    const newInquiry = new Inquiry({
      guestUserId: req.guestUserId || '',
      userId,
      userType: userId ? 'registered' : 'guest',
      inquiryId: generateInquiryId(),
      customerName,
      phone,
      email: email || '',
      animalName,
      animalId: animalId || '',
      itemType: isMeat ? 'meat' : 'livestock',
      breed: breed || '',
      category,
      weight: weight || '',
      ...(isMeat ? { unit: unit || 'kg' } : {}), // Only set unit for meat items, default to kg if needed
      price: parsedPrice,
      quantity: qty,
      totalAmount: finalTotal,
      deliveryAddress: deliveryAddress || '',
      city: city || '',
      deliveryDate: deliveryDate || '',
      paymentMethod: paymentMethod || 'whatsapp',
      orderSource: orderSource || 'checkout',
      status: 'Pending',
      notes: notes || '',
      animalCare: animalCare || false,
      animalCarePrice,
      advanceAmount,
      remainingAmount,
      butcher: req.body.butcher || null,
      avatar: avatar || ''
    })

    const saved = await newInquiry.save()

    if (saved.butcher) {
      await saved.populate('butcher')
    }

    // ── Record user activity and associate email with session ──
    const cleanEmail = normalize(email).toLowerCase()
    if (validateEmail(cleanEmail)) {
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        // Logged-in user: Update last activity
        await User.findByIdAndUpdate(userId, { lastActivity: new Date() })
        // Also update CartSession email if it's missing
        await CartSession.updateMany({ userId }, { $set: { userEmail: cleanEmail } })
      } else if (userId === 'built-in-admin') {
        // Built-in admin, skip DB user update
      } else {
        // Guest user: Save/Update in GuestUser collection with all provided details
        await GuestUser.findOneAndUpdate(
          { email: cleanEmail },
          { 
            $set: {
              name: customerName,
              email: cleanEmail,
              phone: phone,
              deliveryAddress: deliveryAddress,
              city: city,
              lastOrderId: saved.inquiryId,
              sessionId: req.guestUserId || '',
              lastActivity: new Date()
            },
            $inc: { 
              orderCount: 1,
              totalSpent: saved.totalAmount
            }
          },
          { upsert: true, new: true }
        )
        // Also update CartSession email if it's missing for this guest
        if (req.guestUserId) {
          await CartSession.updateMany({ guestUserId: req.guestUserId }, { $set: { userEmail: cleanEmail } })
        }
      }
    }

    // No longer need a separate findByIdAndUpdate here since we did it atomically above
    
    // Create admin notification
    await Notification.create({
      type: 'inquiry_created',
      title: 'New inquiry',
      message: `${saved.customerName} requested ${saved.animalName}`,
      entityType: 'inquiry',
      entityId: String(saved._id)
    })
    
    // Create user notification if userId exists
    if (userId) {
      await Notification.create({
        userId,
        type: 'order_placed',
        title: 'Order Placed!',
        message: `Your order for ${saved.animalName} has been placed successfully.`,
        entityType: 'inquiry',
        entityId: String(saved._id)
      })
    }

    // ── Send Confirmation Email ──
    let emailSent = false
    try {
      // Always send admin notification
      const adminHtml = buildAdminOrderNotificationEmailHtml({
        orderId: saved.inquiryId,
        customerName: saved.customerName,
        items: [{ name: saved.animalName, quantity: saved.quantity }],
        totalAmount: saved.totalAmount,
        deliveryCharge: 49,
        deliveryAddress: `${saved.deliveryAddress}, ${saved.city}`
      })

      await sendEmail({
        to: getAdminEmail(),
        subject: `New Order Received: ${saved.inquiryId} 🛒`,
        html: adminHtml
      }).catch(err => console.error('Failed to send admin order notification:', err.message))

      // Only send to customer if valid email provided
      if (validateEmail(cleanEmail)) {
        const html = buildOrderConfirmationEmailHtml({
          orderId: saved.inquiryId,
          orderDate: formatOrderDate(new Date()),
          paymentMethod: paymentMethod || 'whatsapp',
          customer: {
            name: customerName,
            email: cleanEmail,
            phone,
            address: deliveryAddress,
            city
          },
          items: [{
            name: animalName,
            quantity: qty,
            unitPrice: parsedPrice,
            subtotal: saved.totalAmount
          }],
          pricing: {
            subtotal: saved.totalAmount,
            deliveryCharge: 49,
            total: saved.totalAmount + 49
          },
          butcher: saved.butcher,
          ctaUrl: `${getFrontendOrigin()}/shop`
        })

        await sendEmail({
          to: cleanEmail,
          subject: `Order Confirmation (${saved.inquiryId}) - MeatByAlvi`,
          html
        })
        emailSent = true
      }
    } catch (e) {
      console.error('Email handling error (single):', e.message)
      emailSent = false
    }

    res.status(201).json({
      success: true,
      message: 'Inquiry created successfully',
      data: saved,
      emailSent
    })
  } catch (error) {
    console.error('Error creating inquiry:', error.message)
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create inquiry'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/inquiries/bulk — Create multiple inquiries
// (For cart orders with multiple animals)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/bulk', optionalAuthMiddleware, async (req, res) => {
  try {
    if (req.user?.id && req.user.role !== 'admin' && mongoose.isValidObjectId(req.user.id)) {
      const account = await User.findById(req.user.id).select('isVerified').lean()
      if (account && !account.isVerified) {
        return res.status(403).json({
          success: false,
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email to continue.'
        })
      }
    }

    const { customerName, phone, email, items, deliveryAddress,
            city, deliveryDate, paymentMethod, orderSource, notes, deliveryCharge, animalCare } = req.body

    if (!customerName || !phone || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer info and at least one item required'
      })
    }

    // Build avatar
    const nameParts = customerName.trim().split(' ')
    const avatar = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
      : customerName.slice(0, 2).toUpperCase()

    // Create one inquiry per cart item
    const inquiries = []
    const orderGroupId = generateOrderGroupId()

    const livestockItems = (items || []).filter(it => normalize(it.itemType) !== 'meat')
    const meatItems = (items || []).filter(it => normalize(it.itemType) === 'meat')

    const animalIds = livestockItems
      .map((item) => String(item?._id || item?.id || '').trim())
      .filter(Boolean)

    const animalMap = new Map()

    if (animalIds.length > 0) {
      const reservedAnimals = []
      
      try {
        // Parallel atomic reservation for all animals
        const reservationResults = await Promise.all(
          animalIds.map(id => 
            Animal.findOneAndUpdate(
              { 
                _id: id, 
                status: { $in: ['available', 'new'] },
                visibility: true
              },
              { 
                $set: { status: 'reserved', visibility: false } 
              },
              { new: true }
            ).lean()
          )
        )

        const unavailable = []
        reservationResults.forEach((animal, index) => {
          if (!animal) {
            unavailable.push(animalIds[index])
          } else {
            reservedAnimals.push(animal)
          }
        })

        if (unavailable.length > 0) {
          // Rollback all reserved animals if ANY fail
          if (reservedAnimals.length > 0) {
            await Animal.updateMany(
              { _id: { $in: reservedAnimals.map(a => a._id) } },
              { $set: { status: 'available', visibility: true } }
            )
          }
          return res.status(409).json({
            success: false,
            message: 'Some animals have just been purchased by another user. Please refresh your cart.',
            unavailable
          })
        }

        // Create inquiries for all reserved animals
        reservedAnimals.forEach(a => animalMap.set(String(a._id), a))
      } catch (err) {
        // Generic rollback on unexpected error
        if (reservedAnimals.length > 0) {
          await Animal.updateMany(
            { _id: { $in: reservedAnimals.map(a => a._id) } },
            { $set: { status: 'available', visibility: true } }
          )
        }
        throw err
      }
    }

    // Now process ALL items (livestock + meat) to create inquiries
    const totalItemsInBulk = items.length
    const totalProductSubtotal = items.reduce((sum, item) => sum + (parsePrice(item.price) * (item.quantity || 1)), 0)
    const bulkAnimalCarePrice = animalCare ? (totalItemsInBulk * 100) : 0 // Rs. 100 per item if care enabled
    const bulkGrandTotal = totalProductSubtotal + bulkAnimalCarePrice
    
    // First, pre-fetch all meat items to check availability and get units
    const meatItemIds = items
      .filter(item => normalize(item.itemType) === 'meat')
      .map(item => String(item?._id || item?.id || ''))
      .filter(id => id)
    
    const meatItemMap = new Map()
    if (meatItemIds.length > 0) {
      try {
        const meatItems = await MeatItem.find({ _id: { $in: meatItemIds } }).lean()
        meatItems.forEach(mi => meatItemMap.set(String(mi._id), mi))
        
        // Check if any meat items are unavailable
        const unavailableMeatItems = meatItems.filter(mi => !mi.isAvailable)
        if (unavailableMeatItems.length > 0) {
          const unavailableNames = unavailableMeatItems.map(mi => mi.name).join(', ')
          return res.status(409).json({
            success: false,
            message: `Sorry, the following items are currently unavailable: ${unavailableNames}. Please check back later.`
          })
        }
      } catch (e) {
        console.warn('Could not fetch meat items:', e.message)
      }
    }
    
    const inquiryPromises = items.map(async (item) => {
      const parsedPrice = parsePrice(item.price)
      const qty = item.quantity || 1
      const itemSubtotal = parsedPrice * qty
      
      const itemAnimalCarePrice = animalCare ? 100 : 0
      const itemTotalWithCare = itemSubtotal + itemAnimalCarePrice
      
      const isItemMeat = normalize(item.itemType) === 'meat'

      let unit = item.unit || ''
      let category = item.category || ''
      
      if (isItemMeat) {
        const itemId = String(item?._id || item?.id || '')
        if (itemId && meatItemMap.has(itemId)) {
          const meatItem = meatItemMap.get(itemId)
          unit = meatItem.unit || 'kg'
          category = meatItem.category || category
        }
        // If still no unit, default to kg
        if (!unit) {
          unit = 'kg'
        }
      }

      // Calculate individual advance (approx 20%) - Only for Livestock
      const itemAdvance = !isItemMeat ? Math.round(itemTotalWithCare * 0.20) : 0
      const itemRemaining = itemTotalWithCare - itemAdvance

      const userId = String(req.user?.id || '')
      const animalData = animalMap.get(String(item?._id || item?.id || ''))
      if (animalData) {
        category = animalData.category || category
      }

      const inquiry = new Inquiry({
        guestUserId: req.guestUserId || '',
        userId,
        userType: userId ? 'registered' : 'guest',
        orderGroupId,
        inquiryId: generateInquiryId(),
        customerName,
        phone,
        email: email || '',
        animalName: item.name || item.animalName || 'Unknown',
        animalId: item._id || item.id || '',
        itemType: isItemMeat ? 'meat' : 'livestock', // FIX: set itemType!
        breed: item.breed || '',
        category: category,
        weight: item.weight || '',
        ...(isItemMeat ? { unit: unit } : {}), // Only set unit for meat items!
        price: parsedPrice,
        quantity: qty,
        totalAmount: itemTotalWithCare,
        deliveryAddress: deliveryAddress || '',
        city: city || '',
        deliveryDate: deliveryDate || '',
        paymentMethod: paymentMethod || 'whatsapp',
        orderSource: orderSource || 'cart',
        status: 'Pending',
        notes: notes || '',
        animalCare: animalCare || false,
        animalCarePrice: itemAnimalCarePrice,
        advanceAmount: itemAdvance,
        remainingAmount: itemRemaining,
        butcher: req.body.butcher || null,
        avatar: avatar || ''
      })

      const saved = await inquiry.save()
      // Create admin notification
      await Notification.create({
        type: 'inquiry_created',
        title: 'New inquiry',
        message: `${saved.customerName} requested ${saved.animalName}`,
        entityType: 'inquiry',
        entityId: String(saved._id)
      })
      
      // Create user notification if userId exists
      if (userId) {
        await Notification.create({
          userId,
          type: 'order_placed',
          title: 'Order Placed!',
          message: `Your order for ${saved.animalName} has been placed successfully.`,
          entityType: 'inquiry',
          entityId: String(saved._id)
        })
      }
      
      return saved
    })

    const savedInquiries = await Promise.all(inquiryPromises)
    inquiries.push(...savedInquiries)

    // ── Record user activity and associate email with session ──
    const cleanEmail = normalize(email).toLowerCase()
    if (validateEmail(cleanEmail)) {
      const userId = String(req.user?.id || '')
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        await User.findByIdAndUpdate(userId, { lastActivity: new Date() })
        // Also update CartSession email if it's missing
        await CartSession.updateMany({ userId }, { $set: { userEmail: cleanEmail } })
      } else if (userId === 'built-in-admin') {
        // Built-in admin, skip DB user update
      } else {
        const totalSpentInBulk = inquiries.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0)
        await GuestUser.findOneAndUpdate(
          { email: cleanEmail },
          { 
            $set: {
              name: customerName,
              email: cleanEmail,
              phone: phone,
              deliveryAddress: deliveryAddress,
              city: city,
              lastOrderId: orderGroupId,
              sessionId: req.guestUserId || '',
              lastActivity: new Date()
            },
            $inc: { 
              orderCount: 1,
              totalSpent: totalSpentInBulk
            }
          },
          { upsert: true, new: true }
        )
        // Also update CartSession email if it's missing for this guest
        if (req.guestUserId) {
          await CartSession.updateMany({ guestUserId: req.guestUserId }, { $set: { userEmail: cleanEmail } })
        }
      }
    }

    // ── Send Confirmation Email ──
    let emailSent = false
    try {
      // Always send admin notification
      const sub = inquiries.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0)
      const itemsForEmail = inquiries.map((i) => ({
        name: i.animalName,
        quantity: i.quantity || 1,
        unitPrice: i.price || 0,
        subtotal: i.totalAmount || 0
      }))

      const adminHtml = buildAdminOrderNotificationEmailHtml({
        orderId: orderGroupId,
        customerName,
        items: itemsForEmail,
        totalAmount: sub,
        deliveryCharge: 49,
        deliveryAddress: `${deliveryAddress}, ${city}`
      })

      await sendEmail({
        to: getAdminEmail(),
        subject: `New Order Received: ${orderGroupId} 🛒`,
        html: adminHtml
      }).catch(err => console.error('Failed to send admin order notification:', err.message))

      // Only send to customer if valid email provided
      if (validateEmail(cleanEmail)) {
        let butcherDetails = null
        if (req.body.butcher) {
          const firstInquiryWithButcher = inquiries.find(i => i.butcher)
          if (firstInquiryWithButcher) {
            await firstInquiryWithButcher.populate('butcher')
            butcherDetails = firstInquiryWithButcher.butcher
          }
        }

        const html = buildOrderConfirmationEmailHtml({
          orderId: orderGroupId,
          orderDate: formatOrderDate(new Date()),
          paymentMethod: paymentMethod || (orderSource === 'checkout' ? 'cod' : 'whatsapp'),
          customer: {
            name: customerName,
            email: cleanEmail,
            phone,
            address: deliveryAddress,
            city
          },
          items: itemsForEmail,
          pricing: { subtotal: sub, deliveryCharge: 49, total: sub + 49 },
          butcher: butcherDetails,
          ctaUrl: `${getFrontendOrigin()}/shop`
        })

        await sendEmail({
          to: cleanEmail,
          subject: `Order Confirmation (${orderGroupId}) - MeatByAlvi`,
          html
        })
        emailSent = true
      }
    } catch (e) {
      console.error(`Failed to handle order emails for ${orderGroupId}:`, e.message)
      emailSent = false
    }

    res.status(201).json({
      success: true,
      message: `${inquiries.length} inquiries created successfully`,
      data: {
        count: inquiries.length,
        orderId: orderGroupId,
        emailSent,
        inquiries
      }
    })
  } catch (error) {
    console.error('Error creating bulk inquiries:', error.message)
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create inquiries'
    })
  }
})

// Helper function to create userId query that matches both string and ObjectId
const createUserIdQuery = (userId) => {
  const query = { $or: [{ userId }] }
  // If userId is a valid ObjectId string, also match ObjectId type
  if (mongoose.Types.ObjectId.isValid(userId)) {
    query.$or.push({ userId: new mongoose.Types.ObjectId(userId) })
  }
  return query
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/me — Fetch orders for current user
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.id || '')
    const userEmail = String(req.user?.email || '')
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    // Find inquiries where userId matches OR email matches (in case some haven't been linked yet, though they should be)
    const userQuery = {
      $or: [
        createUserIdQuery(userId),
        { email: normalize(userEmail) }
      ]
    }

    const inquiries = await Inquiry.find(userQuery).sort({ createdAt: -1 })

    res.status(200).json({
      success: true,
      data: inquiries
    })
  } catch (error) {
    console.error('Error fetching my inquiries:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your orders'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/me/overview — Fetch user overview stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/me/overview', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.id || '')
    const userEmail = String(req.user?.email || '')
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(now.getDate() - 30)

    const userQuery = {
      $or: [
        createUserIdQuery(userId),
        { email: normalize(userEmail) }
      ]
    }

    const [
      totalOrders,
      totalRevenue,
      recentOrders,
      ordersLast30Days,
      revenueLast30Days,
      recommendedLivestock,
      recommendedMeat
    ] = await Promise.all([
      Inquiry.countDocuments(userQuery),
      Inquiry.aggregate([
        { $match: { ...userQuery, status: { $in: ['Completed', 'Delivered'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Inquiry.find(userQuery).sort({ createdAt: -1 }).limit(4),
      Inquiry.countDocuments({ ...userQuery, createdAt: { $gte: thirtyDaysAgo } }),
      Inquiry.aggregate([
        { $match: { ...userQuery, status: { $in: ['Completed', 'Delivered'] }, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Animal.find({ visibility: true, status: { $in: ['available', 'new'] } }).limit(3).lean(),
      MeatItem.find({ isAvailable: true }).limit(3).lean()
    ])

    const revenue = totalRevenue[0]?.total || 0
    const revenue30d = revenueLast30Days[0]?.total || 0
    const recommended = [...recommendedLivestock, ...recommendedMeat].slice(0, 3).map(item => {
      const isMeat = item.category && item.category !== '' && !item.breed; // simple heuristic
      return {
        id: item._id,
        name: item.name,
        price: item.price,
        image: item.imageUrl || item.images?.[0] || '',
        tag: isMeat ? 'Meat' : 'Featured',
        tagIcon: isMeat ? 'fa-solid fa-drumstick-bite' : 'fa-solid fa-star'
      }
    })

    const stats = [
      { id: 1, label: 'Total Orders', value: totalOrders.toString(), icon: 'fa-solid fa-box', delta: null },
      { id: 2, label: 'Total Spent', value: `Rs. ${revenue.toLocaleString()}`, icon: 'fa-solid fa-indian-rupee-sign', delta: null },
      { id: 3, label: 'Orders (Last 30 Days)', value: ordersLast30Days.toString(), icon: 'fa-solid fa-clock', delta: null },
      { id: 4, label: 'Spent (Last 30 Days)', value: `Rs. ${revenue30d.toLocaleString()}`, icon: 'fa-solid fa-wallet', delta: null }
    ]

    res.status(200).json({
      success: true,
      data: { stats, recentOrders, recommended }
    })
  } catch (error) {
    console.error('Error fetching user overview:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch overview'
    })
  }
})

// GET /api/inquiries/meat — Fetch only meat inquiries
router.get('/meat', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const inquiries = await Inquiry.find({ itemType: 'meat' }).sort({ createdAt: -1 })
    res.status(200).json({
      success: true,
      count: inquiries.length,
      data: inquiries
    })
  } catch (error) {
    console.error('Error fetching meat inquiries:', error.message)
    res.status(500).json({ success: false, message: 'Failed to fetch meat inquiries' })
  }
})

// GET /api/inquiries/livestock — Fetch only livestock inquiries
router.get('/livestock', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const inquiries = await Inquiry.find({ itemType: 'livestock' }).sort({ createdAt: -1 })
    res.status(200).json({
      success: true,
      count: inquiries.length,
      data: inquiries
    })
  } catch (error) {
    console.error('Error fetching livestock inquiries:', error.message)
    res.status(500).json({ success: false, message: 'Failed to fetch livestock inquiries' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/all — Fetch all inquiries (with optional domain filter)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { domain } = req.query
    let query = {}
    if (domain === 'meat') {
      query.itemType = 'meat'
    } else if (domain === 'animal' || domain === 'livestock') {
      query.itemType = 'livestock'
    }
    const inquiries = await Inquiry.find(query).sort({ createdAt: -1 })

    res.status(200).json({
      success: true,
      count: inquiries.length,
      data: inquiries
    })
  } catch (error) {
    console.error('Error fetching inquiries:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch inquiries'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/grouped — Fetch orders grouped by orderGroupId (with domain filter)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/grouped', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { domain } = req.query
    let itemType = null
    if (domain === 'meat') {
      itemType = 'meat'
    } else if (domain === 'animal' || domain === 'livestock') {
      itemType = 'livestock'
    }

    let query = {}
    if (itemType) {
      query.itemType = itemType
    }

    const inquiries = await Inquiry.find(query).sort({ createdAt: -1 })

    // Group inquiries by orderGroupId or inquiryId (if no orderGroupId)
    const orderGroups = {}
    inquiries.forEach(inquiry => {
      const groupId = inquiry.orderGroupId || inquiry.inquiryId
      if (!orderGroups[groupId]) {
        // Create a new order group with the first inquiry
        orderGroups[groupId] = {
          orderId: groupId,
          customerName: inquiry.customerName,
          phone: inquiry.phone,
          email: inquiry.email,
          deliveryAddress: inquiry.deliveryAddress,
          city: inquiry.city,
          deliveryDate: inquiry.deliveryDate,
          status: inquiry.status,
          createdAt: inquiry.createdAt,
          totalAmount: 0,
          items: []
        }
      }
      // Add the inquiry to the group
      orderGroups[groupId].items.push({
        id: inquiry._id,
        inquiryId: inquiry.inquiryId,
        animalName: inquiry.animalName,
        category: inquiry.category,
        breed: inquiry.breed,
        weight: inquiry.weight,
        unit: inquiry.unit,
        price: inquiry.price,
        quantity: inquiry.quantity,
        totalAmount: inquiry.totalAmount,
        itemType: inquiry.itemType,
        animalCare: inquiry.animalCare,
        animalCarePrice: inquiry.animalCarePrice,
        notes: inquiry.notes
      })
      orderGroups[groupId].totalAmount += inquiry.totalAmount
    })

    // Convert to array and sort by createdAt descending
    const orders = Object.values(orderGroups).sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    )

    res.status(200).json({
      success: true,
      count: orders.length,
      data: orders
    })
  } catch (error) {
    console.error('Error fetching grouped orders:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/group/:orderGroupId — Fetch order details by orderGroupId (with domain filter)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/group/:orderGroupId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { orderGroupId } = req.params
    const { domain } = req.query
    let itemType = null
    if (domain === 'meat') {
      itemType = 'meat'
    } else if (domain === 'animal' || domain === 'livestock') {
      itemType = 'livestock'
    }

    // Find all inquiries with this orderGroupId, or just the one with this inquiryId
    let inquiries = await Inquiry.find({
      $or: [
        { orderGroupId: orderGroupId },
        { inquiryId: orderGroupId }
      ]
    }).sort({ createdAt: -1 })

    // Filter by itemType if domain is specified
    if (itemType) {
      inquiries = inquiries.filter(inq => inq.itemType === itemType)
    }

    if (!inquiries || inquiries.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      })
    }

    // Create the order object
    const order = {
      orderId: orderGroupId,
      customerName: inquiries[0].customerName,
      phone: inquiries[0].phone,
      email: inquiries[0].email,
      deliveryAddress: inquiries[0].deliveryAddress,
      city: inquiries[0].city,
      deliveryDate: inquiries[0].deliveryDate,
      status: inquiries[0].status,
      createdAt: inquiries[0].createdAt,
      totalAmount: 0,
      items: []
    }

    inquiries.forEach(inquiry => {
      order.items.push({
        id: inquiry._id,
        inquiryId: inquiry.inquiryId,
        animalName: inquiry.animalName,
        category: inquiry.category,
        breed: inquiry.breed,
        weight: inquiry.weight,
        unit: inquiry.unit,
        price: inquiry.price,
        quantity: inquiry.quantity,
        totalAmount: inquiry.totalAmount,
        itemType: inquiry.itemType,
        animalCare: inquiry.animalCare,
        animalCarePrice: inquiry.animalCarePrice,
        notes: inquiry.notes
      })
      order.totalAmount += inquiry.totalAmount
    })

    res.status(200).json({
      success: true,
      data: order
    })
  } catch (error) {
    console.error('Error fetching order details:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PATCH /api/inquiries/:id/status — Update status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.patch('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['Pending', 'Contacted', 'Completed', 'Cancelled', 'Shipped', 'Delivered', 'Refunded']

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      })
    }

    const inquiry = await Inquiry.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: 'after' }
    )

    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      })
    }

    // ── Send Order Status Update Email ──
    if (['Shipped', 'Delivered'].includes(status) && validateEmail(inquiry.email)) {
      try {
        const statusHtml = buildOrderStatusEmailHtml({
          orderId: inquiry.inquiryId,
          status,
          customerName: inquiry.customerName
        })
        await sendEmail({
          to: inquiry.email,
          subject: `Order Status Update: ${status} (${inquiry.inquiryId})`,
          html: statusHtml
        })
      } catch (err) {
        console.error(`Failed to send ${status} email:`, err.message)
      }
    }

    if (status === 'Completed') {
      // Automatically mark the animal as sold for single livestock items
      if (inquiry.animalId && inquiry.itemType === 'livestock') {
        // We only mark as sold if it's a single purchase livestock
        // (Meat/Multi-quantity products would typically not have a specific animalId or would be handled differently)
        const updatedAnimal = await Animal.findByIdAndUpdate(
          inquiry.animalId,
          { status: 'sold', visibility: false },
          { returnDocument: 'after' }
        )

        // ── Sold-Out Notification for users who have this animal in cart ──
        (async () => {
          try {
            const sessions = await CartSession.find({ "items.id": String(inquiry.animalId) })
            for (const session of sessions) {
              const email = session.userEmail || (session.userId ? (await User.findById(session.userId))?.email : '')
              if (email && validateEmail(email) && email !== inquiry.email) {
                const totalItemsInCart = session.items.length
                const remainingItems = session.items.filter(it => String(it.id) !== String(inquiry.animalId))
                
                if (totalItemsInCart === 1) {
                  // Case 1: Only ONE item and it's sold
                  const soldOutHtml = buildSoldOutNotificationEmailHtml({
                    animalName: inquiry.animalName,
                    animalPrice: inquiry.price
                  })
                  await sendEmail({
                    to: email,
                    subject: `Sold Out: ${inquiry.animalName} 🏷️`,
                    html: soldOutHtml
                  })
                } else if (remainingItems.length > 0) {
                  // Case 2: Multiple items, one sold
                  const soldOutHtml = buildSoldOutNotificationEmailHtml({
                    animalName: inquiry.animalName,
                    animalPrice: inquiry.price
                  })
                  await sendEmail({
                    to: email,
                    subject: `Sold Out: ${inquiry.animalName} 🏷️`,
                    html: soldOutHtml
                  })
                } else {
                  // Case 3: All items sold (shouldn't happen here normally but for safety)
                  const allSoldHtml = buildAllItemsSoldNotificationEmailHtml({})
                  await sendEmail({
                    to: email,
                    subject: 'Items Sold Out 🏷️',
                    html: allSoldHtml
                  })
                }
              }
              // Remove the sold item from their cart
              await CartSession.updateOne(
                { _id: session._id },
                { $pull: { items: { id: String(inquiry.animalId) } } }
              )
            }
          } catch (err) {
            console.error('Failed to send sold-out notifications:', err.message)
          }
        })()
      }

      await Notification.create({
        type: 'inquiry_completed',
        title: 'Sale completed',
        message: `Order ${inquiry.inquiryId} marked completed`,
        entityType: 'inquiry',
        entityId: String(inquiry._id)
      })

      // ── Send Feedback/Review Request Email ──
      if (validateEmail(inquiry.email)) {
        const feedbackHtml = buildOrderFeedbackEmailHtml({
          customerName: inquiry.customerName,
          orderId: inquiry.inquiryId,
          items: [{ name: inquiry.animalName }],
          reviewUrl: `${getFrontendOrigin()}/shop` // Or a specific review page
        })
        await sendEmail({
          to: inquiry.email,
          subject: 'We value your feedback! ⭐',
          html: feedbackHtml
        }).catch(err => console.error('Failed to send feedback email:', err.message))
      }
    } else if (status === 'Cancelled') {
      // Unreserve the animal if it's a livestock order
      if (inquiry.animalId && inquiry.itemType === 'livestock') {
        await Animal.findByIdAndUpdate(
          inquiry.animalId,
          { status: 'available', visibility: true },
          { returnDocument: 'after' }
        )
      }

      await Notification.create({
        type: 'inquiry_cancelled',
        title: 'Order cancelled',
        message: `Order ${inquiry.inquiryId} was cancelled`,
        entityType: 'inquiry',
        entityId: String(inquiry._id)
      })

      // Send cancellation email to customer
      if (validateEmail(inquiry.email)) {
        const statusHtml = buildOrderStatusEmailHtml({
          orderId: inquiry.inquiryId,
          status,
          customerName: inquiry.customerName
        })
        await sendEmail({
          to: inquiry.email,
          subject: `Order Cancelled: ${inquiry.inquiryId}`,
          html: statusHtml
        }).catch(err => console.error('Failed to send cancellation email:', err.message))
      }
    }

    res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      data: inquiry
    })
  } catch (error) {
    console.error('Error updating status:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/inquiries/:id — Delete inquiry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const inquiry = await Inquiry.findByIdAndDelete(req.params.id)

    if (!inquiry) {
      return res.status(404).json({
        success: false,
        message: 'Inquiry not found'
      })
    }

    res.status(200).json({
      success: true,
      message: 'Inquiry deleted successfully'
    })
  } catch (error) {
    console.error('Error deleting inquiry:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to delete inquiry'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/inquiries/bulk/delete — Delete multiple
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/bulk/delete', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { ids } = req.body

    if (!ids || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No IDs provided'
      })
    }

    const result = await Inquiry.deleteMany({ _id: { $in: ids } })

    res.status(200).json({
      success: true,
      message: `${result.deletedCount} inquiries deleted`,
      deletedCount: result.deletedCount
    })
  } catch (error) {
    console.error('Error bulk deleting:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to delete inquiries'
    })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/inquiries/fix-item-type — Fix existing inquiries without itemType (Admin only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/fix-item-type', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    console.log('🔧 Starting to fix itemType (and unit) for existing inquiries...')
    const inquiries = await Inquiry.find({
      $or: [
        { itemType: { $exists: false } },
        { itemType: null },
        { itemType: '' }
      ]
    })

    console.log(`📋 Found ${inquiries.length} inquiries without itemType`)

    let fixedCount = 0
    let errorCount = 0

    for (const inquiry of inquiries) {
      try {
        // First check if animalId exists in MeatItem collection
        const meatItem = await MeatItem.findOne({ _id: inquiry.animalId })
        if (meatItem) {
          inquiry.itemType = 'meat'
          inquiry.unit = meatItem.unit || ''
          await inquiry.save()
          fixedCount++
          console.log(`✅ Fixed inquiry ${inquiry.inquiryId} (meat item, unit: ${inquiry.unit})`)
          continue
        }

        // Then check if animalId exists in Animal collection
        const isAnimal = await Animal.exists({ _id: inquiry.animalId })
        if (isAnimal) {
          inquiry.itemType = 'livestock'
          await inquiry.save()
          fixedCount++
          console.log(`✅ Fixed inquiry ${inquiry.inquiryId} (livestock)`)
          continue
        }

        // If neither, check category/breed/name for clues
        const nameLower = (inquiry.animalName || '').toLowerCase()
        const categoryLower = (inquiry.category || '').toLowerCase()
        const meatKeywords = ['mutton', 'beef', 'chicken', 'fish', 'meat', 'kg', '500g', 'piece']
        const isProbablyMeat = meatKeywords.some(keyword => 
          nameLower.includes(keyword) || categoryLower.includes(keyword)
        )

        if (isProbablyMeat) {
          inquiry.itemType = 'meat'
          if (nameLower.includes('kg') || categoryLower.includes('kg')) inquiry.unit = 'kg'
          else if (nameLower.includes('500g')) inquiry.unit = '500g'
          else if (nameLower.includes('piece')) inquiry.unit = 'piece'
        } else {
          inquiry.itemType = 'livestock'
        }

        await inquiry.save()
        fixedCount++
        console.log(`✅ Fixed inquiry ${inquiry.inquiryId} to itemType: ${inquiry.itemType}`)
      } catch (err) {
        console.error(`❌ Failed to fix inquiry ${inquiry.inquiryId}:`, err.message)
        errorCount++
      }
    }

    res.status(200).json({
      success: true,
      message: `Fixed ${fixedCount} inquiries, ${errorCount} errors`,
      data: {
        totalInquiries: inquiries.length,
        fixedCount,
        errorCount
      }
    })
  } catch (error) {
    console.error('Error fixing itemType:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fix itemType',
      error: error.message
    })
  }
})

export default router
