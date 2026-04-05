import User from '../models/User.js'
import GuestUser from '../models/GuestUser.js'
import Animal from '../models/Animal.js'
import { sendEmail, isEmailTransportConfigured } from '../utils/mailer.js'
import { buildReengagementEmailHtml } from '../utils/orderEmailTemplates.js'

const LOG = '[reengagement]'
let loggedMailSkip = false

const getFrontendOrigin = () => String(process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/$/, '')
const getApiPublicUrl = () => String(process.env.API_PUBLIC_URL || 'http://localhost:5000').replace(/\/$/, '')

const normalizeEmail = (v) => String(v || '').trim().toLowerCase()

/**
 * Periodic job: re-engage inactive users / guests (last activity > 10 days,
 * no re-engagement email in last 10 days, subscribed).
 */
export const runReengagementJob = async () => {
  try {
    if (!isEmailTransportConfigured()) {
      if (!loggedMailSkip) {
        console.warn(
          `${LOG} skipped: set GMAIL_USER (or ADMIN_EMAIL) and GMAIL_APP_PASSWORD to send re-engagement emails`
        )
        loggedMailSkip = true
      }
      return
    }
    loggedMailSkip = false

    console.log(`${LOG} job starting`)

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)

    const featuredAnimals = await Animal.find({ visibility: true, status: 'available' })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean()

    const featuredData = featuredAnimals.map((a) => ({
      name: a.name,
      price: a.price,
      imageUrl: a.imageUrl,
      id: String(a._id)
    }))

    const inactiveUsers = await User.find({
      role: { $ne: 'admin' },
      isSubscribed: true,
      lastActivity: { $lt: tenDaysAgo },
      $or: [
        { lastReengagementEmailSent: { $exists: false } },
        { lastReengagementEmailSent: null },
        { lastReengagementEmailSent: { $lt: tenDaysAgo } }
      ]
    })
      .select({ email: 1 })
      .lean()

    const inactiveGuests = await GuestUser.find({
      isSubscribed: true,
      lastActivity: { $lt: tenDaysAgo },
      $or: [
        { lastReengagementEmailSent: { $exists: false } },
        { lastReengagementEmailSent: null },
        { lastReengagementEmailSent: { $lt: tenDaysAgo } }
      ]
    })
      .select({ email: 1 })
      .lean()

    /** One send per email per run (avoid duplicate if same address exists as user + guest). */
    const byEmail = new Map()
    for (const u of inactiveUsers) {
      const e = normalizeEmail(u.email)
      if (e) byEmail.set(e, { email: e, id: u._id, type: 'user' })
    }
    for (const g of inactiveGuests) {
      const e = normalizeEmail(g.email)
      if (!e) continue
      if (!byEmail.has(e)) byEmail.set(e, { email: e, id: g._id, type: 'guest' })
    }

    const recipients = [...byEmail.values()]
    console.log(`${LOG} eligible recipients: ${recipients.length}`)

    const sendReengagement = async (recipient) => {
      try {
        const html = buildReengagementEmailHtml({
          customerName: 'Valued Customer',
          featuredAnimals: featuredData,
          websiteUrl: getFrontendOrigin(),
          apiPublicUrl: getApiPublicUrl()
        })

        console.log(`${LOG} sending email to: ${recipient.email}`)
        await sendEmail({
          to: recipient.email,
          subject: 'We miss you! Check out our new arrivals 🐐',
          html
        })

        if (recipient.type === 'user') {
          await User.updateOne({ _id: recipient.id }, { $set: { lastReengagementEmailSent: new Date() } })
        } else {
          await GuestUser.updateOne({ _id: recipient.id }, { $set: { lastReengagementEmailSent: new Date() } })
        }
        console.log(`${LOG} ✓ re-engagement sent to ${recipient.email}`)
        return true
      } catch (e) {
        console.error(`${LOG} Mail error for ${recipient.email}:`, e?.message || e)
        return false
      }
    }

    const results = await Promise.all(recipients.map(r => sendReengagement(r)))
    const sent = results.filter(Boolean).length

    if (recipients.length > 0) {
      console.log(`${LOG} finished: ${sent}/${recipients.length} sent successfully`)
    }
  } catch (error) {
    console.error(`${LOG} job failed:`, error?.message || error)
    if (error?.stack) console.error(error.stack)
  }
}
