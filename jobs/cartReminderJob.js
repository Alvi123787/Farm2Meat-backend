import CartSession from '../models/CartSession.js'
import { sendEmail, isEmailTransportConfigured } from '../utils/mailer.js'
import { buildCartReminderEmailHtml } from '../utils/orderEmailTemplates.js'

const LOG = '[cart-reminder]'
let loggedMailSkip = false

const normalize = (v) => String(v || '').trim()

const getFrontendOrigin = () => process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

/**
 * Minutes of cart inactivity (no sync/update) before we send one reminder.
 * Env: CART_REMINDER_MINUTES (default 10)
 */
const getReminderIdleMs = () => {
  const minutes = parseInt(process.env.CART_REMINDER_MINUTES || '10', 10)
  const safe = Number.isFinite(minutes) ? Math.max(1, Math.min(24 * 60, minutes)) : 10
  return safe * 60 * 1000
}

/**
 * Previously this job used: expiresAt between now and now+window — i.e. only carts
 * expiring *within the next* N minutes. That is the wrong semantics for “remind after
 * 10 minutes” and rarely matched (e.g. 30m TTL → only in the last 10m before expiry).
 *
 * Correct rule: last activity (updatedAt) was at least N minutes ago, cart still valid
 * (expiresAt > now), has items, has email, reminder not sent yet.
 */
export const runCartReminderJob = async () => {
  const nowMs = Date.now()
  const now = new Date(nowMs)
  const idleMs = getReminderIdleMs()
  const idleCutoff = new Date(nowMs - idleMs)
  const cartUrl = `${getFrontendOrigin().replace(/\/$/, '')}/cart`

  try {
    if (!isEmailTransportConfigured()) {
      if (!loggedMailSkip) {
        console.warn(
          `${LOG} skipped: set GMAIL_USER (or ADMIN_EMAIL) and GMAIL_APP_PASSWORD to send cart reminders`
        )
        loggedMailSkip = true
      }
      return
    }
    loggedMailSkip = false

    console.log(
      `${LOG} job run at ${now.toISOString()} | idle≥${idleMs / 60000}min → updatedAt ≤ ${idleCutoff.toISOString()}`
    )

    const sessions = await CartSession.find({
      userEmail: { $nin: [null, ''], $exists: true },
      reminderSentAt: null,
      expiresAt: { $gt: now },
      $expr: { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
      updatedAt: { $lte: idleCutoff }
    })
      .select({ userEmail: 1, items: 1, expiresAt: 1, updatedAt: 1 })
      .lean()

    console.log(`${LOG} eligible sessions: ${sessions.length}`)

    const sendReminder = async (s) => {
      const email = normalize(s.userEmail)
      if (!email) return

      const minsLeft = Math.max(1, Math.round((new Date(s.expiresAt).getTime() - nowMs) / 60000))
      const html = buildCartReminderEmailHtml({
        items: s.items || [],
        expiryMinutes: minsLeft,
        cartUrl
      })

      console.log(`${LOG} sending email to: ${email} (session ${String(s._id)}, ~${minsLeft}m until cart expiry)`)

      try {
        await sendEmail({ to: email, subject: 'Cart reminder - Complete your order', html })
        await CartSession.updateOne({ _id: s._id }, { $set: { reminderSentAt: new Date() } })
        console.log(`${LOG} ✓ reminder sent to ${email}`)
        return true
      } catch (e) {
        console.error(`${LOG} Mail error for ${email}:`, e?.message || e)
        return false
      }
    }

    const results = await Promise.all(sessions.map(s => sendReminder(s)))
    const sent = results.filter(Boolean).length

    if (sessions.length > 0) {
      console.log(`${LOG} finished: ${sent}/${sessions.length} sent successfully`)
    }
  } catch (error) {
    console.error(`${LOG} job failed:`, error?.message || error)
    if (error?.stack) console.error(error.stack)
  }
}
