import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import validator from 'validator'
import { sendEmail } from '../utils/mailer.js'
import User from '../models/User.js'
import {
  buildAdminUserRegistrationNotificationEmailHtml,
  buildPasswordResetEmailHtml
} from '../utils/orderEmailTemplates.js'

import CartSession from '../models/CartSession.js'
import Inquiry from '../models/Inquiry.js'

const router = express.Router()

const getAdminEmail = () => {
  const email = process.env.ADMIN_EMAIL
  if (!email) throw new Error('ADMIN_EMAIL is not defined in environment variables')
  return email
}
const getAdminPassword = () => {
  const password = process.env.ADMIN_PASSWORD
  if (!password) throw new Error('ADMIN_PASSWORD is not defined in environment variables')
  return password
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not defined in environment variables')
  return secret
}

const buildToken = ({ sub, email, role }) =>
  jwt.sign({ sub, email, role }, getJwtSecret(), { expiresIn: '30d' })

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()

const isValidEmailFormat = (email) =>
  validator.isEmail(email, {
    allow_utf8_local_part: false,
    allow_ip_domain: false
  })

const isValidPassword = (password) => {
  return (
    password.length >= 6 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  )
}

router.post('/signup', async (req, res) => {
  console.log(`[SIGNUP] New signup request received for email: ${normalizeEmail(req.body?.email)}`)
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    const fullName = String(req.body?.fullName || '').trim()
    const phone = String(req.body?.phone || '').trim()
    const city = String(req.body?.city || '').trim()

    if (!email || !isValidEmailFormat(email)) {
      console.log(`[SIGNUP] Failed: Invalid email format for ${email}`)
      return res.status(400).json({ success: false, message: 'Invalid email format' })
    }
    if (!isValidPassword(password)) {
      console.log(`[SIGNUP] Failed: Invalid password for ${email}`)
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters and include at least one uppercase letter and one number'
      })
    }

    const existing = await User.findOne({ email })
    if (existing) {
      console.log(`[SIGNUP] Failed: Email already exists for ${email}`)
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' })
    }

    const passwordHash = await bcrypt.hash(password, 10)

    const user = await User.create({
      email,
      fullName,
      phone,
      city,
      passwordHash,
      role: 'user',
      isVerified: true
    })

    console.log(`[SIGNUP] User ${email} created successfully, sending admin notification`)
    const adminHtml = buildAdminUserRegistrationNotificationEmailHtml({
      userName: email.split('@')[0],
      userEmail: user.email,
      registrationDate: user.createdAt.toLocaleDateString()
    })

    await sendEmail({
      to: getAdminEmail(),
      subject: `New User Registration: ${user.email} 👤`,
      html: adminHtml
    }).catch((err) => console.error('Failed to send admin notification:', err.message))

    const token = buildToken({ sub: String(user._id), email: user.email, role: user.role })
    return res.status(201).json({ success: true, token, role: user.role })
  } catch (error) {
    console.error(`[SIGNUP] Unexpected error during signup:`, error)
    return res.status(500).json({ success: false, message: error.message || 'Signup failed' })
  }
})

router.post('/login', async (req, res) => {
  console.log(`[LOGIN] Login attempt for email: ${req.body?.email}`)
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')

    if (!isValidEmailFormat(email)) {
      console.log(`[LOGIN] Failed: Invalid email format for ${email}`)
      return res.status(400).json({ success: false, message: "This email doesn't exist." })
    }
    if (!password) {
      console.log(`[LOGIN] Failed: No password provided for ${email}`)
      return res.status(400).json({ success: false, message: 'Password is required' })
    }

    const isAdminEmail = email === getAdminEmail().toLowerCase()
    if (isAdminEmail) {
      if (password === getAdminPassword()) {
        console.log(`[LOGIN] Admin login successful for ${email}`)
        const token = buildToken({ sub: 'built-in-admin', email: getAdminEmail(), role: 'admin' })
        return res.json({ success: true, token, role: 'admin' })
      }
      console.log(`[LOGIN] Failed: Incorrect password for admin ${email}`)
      return res.status(401).json({ success: false, message: 'Incorrect password for admin.' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      console.log(`[LOGIN] Failed: No user found for ${email}`)
      return res.status(401).json({ success: false, message: 'This email is not registered.' })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      console.log(`[LOGIN] Failed: Incorrect password for ${email}`)
      return res.status(401).json({ success: false, message: 'Incorrect password.' })
    }

    console.log(`[LOGIN] Login successful for ${email}`)
    const token = buildToken({ sub: String(user._id), email: user.email, role: user.role })

    const guestUserId = req.headers['x-guest-user-id']
    if (guestUserId) {
      await CartSession.findOneAndUpdate(
        { guestUserId },
        { $set: { userId: String(user._id), userEmail: user.email } },
        { upsert: false }
      )
    }

    return res.json({ success: true, token, role: user.role })
  } catch (error) {
    console.error(`[LOGIN] Unexpected error:`, error)
    return res.status(500).json({ success: false, message: error.message || 'Login failed' })
  }
})

router.get('/me', async (req, res) => {
  const header = String(req.headers?.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' })
  try {
    const payload = jwt.verify(token, getJwtSecret())
    const sub = payload?.sub
    let isVerified = true
    if (sub && sub !== 'built-in-admin' && mongoose.Types.ObjectId.isValid(sub)) {
      const u = await User.findById(sub).select('isVerified').lean()
      isVerified = Boolean(u?.isVerified)
    }
    return res.json({
      success: true,
      user: { email: payload?.email || '', role: payload?.role || 'user', isVerified }
    })
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
})

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const genericMessage = 'If this email exists, a reset link has been sent.'

    if (!isValidEmailFormat(email)) return res.status(400).json({ success: false, message: 'Invalid email format' })
    if (email === getAdminEmail().toLowerCase()) return res.status(400).json({ success: false, message: 'Reset not supported for built-in admin' })

    const user = await User.findOne({ email })
    if (!user) return res.json({ success: true, message: genericMessage })

    const now = new Date()
    const COOLDOWN_MS = 60 * 1000
    
    if (user.passwordResetLastSentAt && (now.getTime() - user.passwordResetLastSentAt.getTime() < COOLDOWN_MS)) {
        const waitSec = Math.ceil((COOLDOWN_MS - (now.getTime() - user.passwordResetLastSentAt.getTime())) / 1000)
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec}s before requesting another reset email.`
        })
    }

    const gmailPass = process.env.GMAIL_APP_PASSWORD || ''
    if (!gmailPass) return res.status(500).json({ success: false, message: 'Email service not configured' })

    const crypto = (await import('crypto')).default
    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenHash = crypto.createHash('sha256').update(String(resetToken)).digest('hex')
    const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000)

    user.resetTokenHash = resetTokenHash
    user.resetTokenExpiresAt = resetTokenExpiresAt
    user.passwordResetLastSentAt = now
    await user.save()

    const getFrontendOrigin = () => process.env.FRONTEND_ORIGIN || 'http://localhost:3000'
    const resetLink = `${getFrontendOrigin()}/reset-password/${resetToken}?email=${encodeURIComponent(email)}`

    const resetHtml = buildPasswordResetEmailHtml({
      customerName: user.fullName || user.email.split('@')[0],
      resetUrl: resetLink
    })

    await sendEmail({
      to: user.email,
      subject: 'Password Reset - MeatByAlvi',
      html: resetHtml
    })

    return res.json({ success: true, message: genericMessage })
  } catch (error) {
    console.error(`Failed to send password reset email to ${req.body?.email}:`, error.message)
    return res.status(500).json({ success: false, message: 'Something went wrong' })
  }
})

router.post('/reset-password/:token', async (req, res) => {
  try {
    const crypto = (await import('crypto')).default
    const token = String(req.params?.token || '')
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ success: false, message: 'Invalid request' })
    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters and include at least one uppercase letter and one number'
      })
    }

    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex')
    const user = await User.findOne({ resetTokenHash: tokenHash })
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired link' })
    if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired link' })
    }

    user.passwordHash = await bcrypt.hash(password, 10)
    user.resetTokenHash = ''
    user.resetTokenExpiresAt = null
    user.passwordResetLastSentAt = null
    await user.save()

    const tokenJwt = buildToken({ sub: String(user._id), email: user.email, role: user.role })
    return res.json({ success: true, token: tokenJwt, role: user.role })
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Something went wrong' })
  }
})

export default router
