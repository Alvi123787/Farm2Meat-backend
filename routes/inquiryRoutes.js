import express from 'express'
import mongoose from 'mongoose'
import Inquiry from '../models/Inquiry.js'
import Animal from '../models/Animal.js'
import User from '../models/User.js'
import GuestUser from '../models/GuestUser.js'
import CartSession from '../models/CartSession.js'
import Notification from '../models/Notification.js'
import { authMiddleware, adminMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js'
import { sendEmail } from '../utils/mailer.js'
import { 
  buildOrderConfirmationEmailHtml, 
  buildAdminOrderNotificationEmailHtml,
  buildOrderFeedbackEmailHtml,
  buildSoldOutNotificationEmailHtml,
  buildExpiredCartRemovalEmailHtml,
  buildCartReminderEmailHtml,
  buildAllItemsSoldNotificationEmailHtml
} from '../utils/orderEmailTemplates.js'

const router = express.Router()

const getAdminEmail = () => process.env.ADMIN_EMAIL || 'farm2meat@gmail.com'

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

const normalize = (v) => String(v || '').trim()

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
      animalTag,
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
      notes
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
    // animalId already declared in destructured req.body above
    let category = ''
    if (animalId) {
      // ── ATOMIC AVAILABILITY CHECK & RESERVE ──
      // Using findOneAndUpdate ensures only one request can claim the animal
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
      category = animal.category || ''
    }

    const newInquiry = new Inquiry({
      guestUserId: req.guestUserId || '',
      userId,
      inquiryId: generateInquiryId(),
      customerName,
      phone,
      email: email || '',
      animalName,
      animalTag: animalTag || '',
      animalId: animalId || '',
      breed: breed || '',
      category,
      weight: weight || '',
      price: parsedPrice,
      quantity: qty,
      totalAmount: totalAmount || parsedPrice * qty,
      deliveryAddress: deliveryAddress || '',
      city: city || '',
      deliveryDate: deliveryDate || '',
      paymentMethod: paymentMethod || 'whatsapp',
      orderSource: orderSource || 'checkout',
      status: 'Pending',
      notes: notes || '',
      butcher: req.body.butcher || null,
      avatar: avatar || ''
    })

    const saved = await newInquiry.save()

    if (saved.butcher) {
      await saved.populate('butcher')
    }

    // ── Record email for Re-engagement ──
    const cleanEmail = normalize(email).toLowerCase()
    if (validateEmail(cleanEmail)) {
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        // Logged-in user: ensure isSubscribed is active (optional, could just leave as is)
        await User.findByIdAndUpdate(userId, { lastActivity: new Date() })
        // Also update CartSession email if it's missing
        await CartSession.updateMany({ userId }, { $set: { userEmail: cleanEmail } })
      } else if (userId === 'built-in-admin') {
        // Built-in admin, skip DB user update
      } else {
        // Guest user: Save/Update in GuestUser collection
        await GuestUser.findOneAndUpdate(
          { email: cleanEmail },
          { 
            email: cleanEmail, 
            sessionId: req.guestUserId || '',
            lastActivity: new Date() 
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
    
    await Notification.create({
      type: 'inquiry_created',
      title: 'New inquiry',
      message: `${saved.customerName} requested ${saved.animalName}`,
      entityType: 'inquiry',
      entityId: String(saved._id)
    })

    // ── Send Confirmation Email ──
    let emailSent = false
    if (validateEmail(cleanEmail)) {
      try {
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
            deliveryCharge: 0,
            total: saved.totalAmount
          },
          butcher: saved.butcher,
          ctaUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/shop`
        })

        await sendEmail({
          to: cleanEmail,
          subject: `Order Confirmation (${saved.inquiryId}) - Farm2Meat`,
          html
        })
        emailSent = true

        // ── Send Admin Notification ──
        const adminHtml = buildAdminOrderNotificationEmailHtml({
          orderId: saved.inquiryId,
          customerName: saved.customerName,
          items: [{ name: saved.animalName, quantity: saved.quantity }],
          totalAmount: saved.totalAmount,
          deliveryAddress: `${saved.deliveryAddress}, ${saved.city}`
        })

        sendEmail({
          to: getAdminEmail(),
          subject: `New Order Received: ${saved.inquiryId} 🛒`,
          html: adminHtml
        }).catch(err => console.error('Failed to send admin order notification:', err.message))
      } catch (e) {
        console.error('Email send error (single):', e.message)
        emailSent = false
      }
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
            city, deliveryDate, paymentMethod, orderSource, notes, deliveryCharge } = req.body

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

    const animalIds = (items || [])
      .map((item) => String(item?._id || item?.id || '').trim())
      .filter(Boolean)

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
        const animalMap = new Map(reservedAnimals.map(a => [String(a._id), a]))
        
        const inquiryPromises = items.map(async (item) => {
          const parsedPrice = parsePrice(item.price)
          const qty = item.quantity || 1
          const userId = String(req.user?.id || '')
          const animalData = animalMap.get(String(item?._id || item?.id || ''))

          const inquiry = new Inquiry({
            guestUserId: req.guestUserId || '',
            userId,
            orderGroupId,
            inquiryId: generateInquiryId(),
            customerName,
            phone,
            email: email || '',
            animalName: item.name || item.animalName || 'Unknown',
            animalTag: item.tagId || item.animalTag || item._id || '',
            animalId: item._id || item.id || '',
            breed: item.breed || '',
            category: animalData?.category || '',
            weight: item.weight || '',
            price: parsedPrice,
            quantity: qty,
            totalAmount: parsedPrice * qty,
            deliveryAddress: deliveryAddress || '',
            city: city || '',
            deliveryDate: deliveryDate || '',
            paymentMethod: paymentMethod || 'whatsapp',
            orderSource: orderSource || 'cart',
            status: 'Pending',
            notes: notes || '',
            butcher: req.body.butcher || null,
            avatar: avatar || ''
          })

          const saved = await inquiry.save()
          await Notification.create({
            type: 'inquiry_created',
            title: 'New inquiry',
            message: `${saved.customerName} requested ${saved.animalName}`,
            entityType: 'inquiry',
            entityId: String(saved._id)
          })
          return saved
        })

        const savedInquiries = await Promise.all(inquiryPromises)
        inquiries.push(...savedInquiries)
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

    // ── Record email for Re-engagement ──
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
        await GuestUser.findOneAndUpdate(
          { email: cleanEmail },
          { 
            email: cleanEmail, 
            sessionId: req.guestUserId || '',
            lastActivity: new Date() 
          },
          { upsert: true, new: true }
        )
        // Also update CartSession email if it's missing for this guest
        if (req.guestUserId) {
          await CartSession.updateMany({ guestUserId: req.guestUserId }, { $set: { userEmail: cleanEmail } })
        }
      }
    }

    let emailSent = false
    if (orderSource === 'checkout' && !validateEmail(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' })
    }

    if (validateEmail(cleanEmail)) {
      try {
        const sub = inquiries.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0)
        const itemsForEmail = inquiries.map((i) => ({
          name: i.animalName,
          quantity: i.quantity || 1,
          unitPrice: i.price || 0,
          subtotal: i.totalAmount || 0
        }))

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
          pricing: { subtotal: sub, deliveryCharge: 0, total: sub },
          butcher: butcherDetails,
          ctaUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/shop`
        })

        await sendEmail({
          to: cleanEmail,
          subject: `Order Confirmation (${orderGroupId}) - Farm2Meat`,
          html
        })
        emailSent = true

        // ── Send Admin Notification ──
        const adminHtml = buildAdminOrderNotificationEmailHtml({
          orderId: orderGroupId,
          customerName,
          items: itemsForEmail,
          totalAmount: sub,
          deliveryAddress: `${deliveryAddress}, ${city}`
        })

        await sendEmail({
          to: getAdminEmail(),
          subject: `New Order Received: ${orderGroupId} 🛒`,
          html: adminHtml
        }).catch(err => console.error('Failed to send admin order notification:', err.message))
      } catch (e) {
        console.error(`Failed to send bulk order confirmation email to ${cleanEmail}:`, e.message)
        emailSent = false
      }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/inquiries/me — Fetch orders for current user
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = String(req.user?.id || '')
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const inquiries = await Inquiry.find({ userId }).sort({ date: -1 })

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
// GET /api/inquiries/all — Fetch all inquiries
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get('/all', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const inquiries = await Inquiry.find().sort({ date: -1 })

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
// PATCH /api/inquiries/:id/status — Update status
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.patch('/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body
    const validStatuses = ['Pending', 'Contacted', 'Completed', 'Cancelled']

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

    if (status === 'Completed') {
      // Automatically mark the animal as sold for single livestock items
      if (inquiry.animalId) {
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
                  // IMPORTANT: Prevent reminder email by setting reminderSentAt
                  await CartSession.updateOne({ _id: session._id }, { $set: { reminderSentAt: new Date() } })
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

                  // Also send cart reminder for remaining items
                  const minsLeft = Math.max(1, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60000))
                  const reminderHtml = buildCartReminderEmailHtml({
                    items: remainingItems,
                    expiryMinutes: minsLeft
                  })
                  await sendEmail({
                    to: email,
                    subject: 'Cart reminder - Complete your order',
                    html: reminderHtml
                  })
                  // Mark reminder as sent so job doesn't send it again
                  await CartSession.updateOne({ _id: session._id }, { $set: { reminderSentAt: new Date() } })
                } else {
                  // Case 3: All items sold (shouldn't happen here normally but for safety)
                  const allSoldHtml = buildAllItemsSoldNotificationEmailHtml({})
                  await sendEmail({
                    to: email,
                    subject: 'Items Sold Out 🏷️',
                    html: allSoldHtml
                  })
                  await CartSession.updateOne({ _id: session._id }, { $set: { reminderSentAt: new Date() } })
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
          reviewUrl: `${process.env.FRONTEND_ORIGIN || 'http://localhost:5173'}/shop` // Or a specific review page
        })
        await sendEmail({
          to: inquiry.email,
          subject: 'We value your feedback! ⭐',
          html: feedbackHtml
        }).catch(err => console.error('Failed to send feedback email:', err.message))
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

export default router
