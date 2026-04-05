import express from 'express'
import CartSession from '../models/CartSession.js'
import GuestUser from '../models/GuestUser.js'
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

const normalize = (v) => String(v || '').trim()

const getTtlMs = () => {
  const minutes = parseInt(process.env.CART_TTL_MINUTES || '30', 10)
  const safe = Number.isFinite(minutes) ? Math.max(1, Math.min(24 * 60, minutes)) : 30
  return safe * 60 * 1000
}

router.post('/session', optionalAuthMiddleware, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const cleanItems = items
      .map((it) => ({
        id: normalize(it?._id || it?.id || it?.itemId || ''),
        name: normalize(it?.name || ''),
        itemType: normalize(it?.itemType || 'livestock') || 'livestock',
        purchaseMode: normalize(it?.purchaseMode || 'single') || 'single'
      }))
      .filter((it) => Boolean(it.id))
      .slice(0, 80)

    const ttlMs = getTtlMs()
    const now = Date.now()
    const clientExpiresAt = Number(req.body?.expiresAt) || 0
    const targetExpiresAt = clientExpiresAt > now ? new Date(Math.min(clientExpiresAt, now + ttlMs)) : new Date(now + ttlMs)

    const userId = normalize(req.user?.id || '')
    let userEmail = normalize(req.user?.email || '')
    const guestUserId = normalize(req.guestUserId || '')

    // ── If guest, try to find previously stored email ──
    if (!userId && !userEmail && guestUserId) {
      const guest = await GuestUser.findOne({ sessionId: guestUserId }).lean()
      if (guest && guest.email) {
        userEmail = guest.email
      }
    }

    const hasIdentity = Boolean(userId || guestUserId)
    if (!hasIdentity) return res.status(400).json({ success: false, message: 'Missing session identity' })

    const filter = userId ? { userId } : { guestUserId }

    if (cleanItems.length === 0) {
      await CartSession.deleteOne(filter)
      return res.json({ success: true, message: 'Session cleared' })
    }

    await CartSession.findOneAndUpdate(
      filter,
      {
        $set: {
          guestUserId,
          userId,
          userEmail,
          items: cleanItems,
          expiresAt: targetExpiresAt
        },
        $setOnInsert: { reminderSentAt: null }
      },
      { upsert: true, returnDocument: 'after' }
    )

    return res.json({ success: true, message: 'Session saved', expiresAt: targetExpiresAt.getTime() })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to save cart session' })
  }
})

export default router

