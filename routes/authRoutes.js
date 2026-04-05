import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import validator from 'validator'
import { sendEmail } from '../utils/mailer.js'
import User from '../models/User.js'
import {
  buildWelcomeVerificationEmailHtml,
  buildAdminUserRegistrationNotificationEmailHtml,
  buildPasswordResetEmailHtml
} from '../utils/orderEmailTemplates.js'

import CartSession from '../models/CartSession.js'

const router = express.Router()

const getAdminEmail = () => process.env.ADMIN_EMAIL || 'rebalalvi123@gmail.com'
const ADMIN_PASSWORD = 'Alvi@123'

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-jwt-secret'
const getFrontendOrigin = () => process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

const buildToken = ({ sub, email, role }) =>
  jwt.sign({ sub, email, role }, getJwtSecret(), { expiresIn: '30d' })

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()

const isValidEmailFormat = (email) =>
  validator.isEmail(email, {
    allow_utf8_local_part: false,
    allow_ip_domain: false
  })

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000

const sendVerificationEmail = async (email, verificationToken) => {
  const verificationLink = `${getFrontendOrigin()}/verify-email/${verificationToken}?email=${encodeURIComponent(email)}`
  const html = buildWelcomeVerificationEmailHtml({
    customerName: email.split('@')[0],
    verificationUrl: verificationLink
  })
  await sendEmail({
    to: email,
    subject: 'Verify your Farm2Meat account',
    html
  })
}

/**
 * Register: creates unverified user and sends email link (24h).
 * If email exists but unverified, refreshes password + token and resends.
 */
router.post('/signup', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')

    if (!email) {
      return res.status(400).json({ success: false, message: 'Invalid email format' })
    }
    if (!isValidEmailFormat(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' })
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenHash = sha256(verificationToken)
    const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS)
    const now = new Date()

    const existing = await User.findOne({ email })

    if (existing) {
      if (existing.isVerified) {
        return res.status(409).json({ success: false, message: 'Email already registered' })
      }

      if (
        existing.verificationEmailLastSentAt &&
        now.getTime() - existing.verificationEmailLastSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
      ) {
        const waitSec = Math.ceil(
          (VERIFICATION_RESEND_COOLDOWN_MS -
            (now.getTime() - existing.verificationEmailLastSentAt.getTime())) /
            1000
        )
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec}s before requesting another verification email.`
        })
      }

      existing.passwordHash = passwordHash
      existing.verificationTokenHash = verificationTokenHash
      existing.verificationTokenExpiresAt = verificationTokenExpiresAt
      existing.verificationEmailLastSentAt = now
      await existing.save()

      try {
        await sendVerificationEmail(email, verificationToken)
      } catch (mailErr) {
        if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
          return res.status(503).json({ success: false, message: 'Email service is not configured' })
        }
        console.error('signup resend mail:', mailErr?.message)
        return res.status(502).json({
          success: false,
          message: 'Could not send verification email. Try again later.'
        })
      }

      return res.status(200).json({
        success: true,
        message: 'We sent a new verification link. Please check your inbox.'
      })
    }

    const user = await User.create({
      email,
      passwordHash,
      role: 'user',
      isVerified: false,
      verificationTokenHash,
      verificationTokenExpiresAt,
      verificationEmailLastSentAt: now
    })

    try {
      await sendVerificationEmail(email, verificationToken)
    } catch (mailErr) {
      await User.deleteOne({ _id: user._id })
      if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Email service is not configured' })
      }
      console.error('signup mail:', mailErr?.message)
      return res.status(502).json({
        success: false,
        message: 'Could not send verification email. Check the address or try again later.'
      })
    }

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

    return res.status(201).json({
      success: true,
      message: 'Account created. Check your email and click the link to verify your account.'
    })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Signup failed' })
  }
})

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')

    if (!isValidEmailFormat(email)) return res.status(400).json({ success: false, message: 'Invalid email format' })
    if (!password) return res.status(400).json({ success: false, message: 'Password is required' })

    if (email === getAdminEmail().toLowerCase() && password === ADMIN_PASSWORD) {
      const token = buildToken({ sub: 'built-in-admin', email: getAdminEmail(), role: 'admin' })
      return res.json({ success: true, token, role: 'admin' })
    }

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email to continue.'
      })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid credentials' })

    const token = buildToken({ sub: String(user._id), email: user.email, role: user.role })

    // Update cart session with user ID and email
    const guestUserId = req.headers['x-guest-user-id']
    if (guestUserId) {
      await CartSession.findOneAndUpdate(
        { guestUserId },
        { $set: { userId: String(user._id), userEmail: user.email } },
        { upsert: true }
      )
    } else {
      await CartSession.findOneAndUpdate(
        { userId: String(user._id) },
        { $set: { userEmail: user.email } },
        { upsert: true }
      )
    }

    return res.json({ success: true, token, role: user.role })
  } catch (error) {
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
    if (!isValidEmailFormat(email)) return res.status(400).json({ success: false, message: 'Invalid email format' })
    if (email === getAdminEmail().toLowerCase()) return res.status(400).json({ success: false, message: 'Reset not supported for built-in admin' })

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ success: false, message: 'Email not found' })

    const gmailUser = process.env.GMAIL_USER || getAdminEmail()
    const gmailPass = process.env.GMAIL_APP_PASSWORD || ''
    if (!gmailPass) return res.status(500).json({ success: false, message: 'Email service not configured' })

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenHash = sha256(resetToken)
    const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000)

    user.resetTokenHash = resetTokenHash
    user.resetTokenExpiresAt = resetTokenExpiresAt
    await user.save()

    const resetLink = `${getFrontendOrigin()}/reset-password/${resetToken}`

    const resetHtml = buildPasswordResetEmailHtml({
      customerName: user.email.split('@')[0],
      resetUrl: resetLink
    })

    await sendEmail({
      to: user.email,
      subject: 'Password Reset - Farm2Meat',
      html: resetHtml
    })

    return res.json({ success: true, message: 'Reset email sent' })
  } catch (error) {
    console.error(`Failed to send password reset email to ${req.body?.email}:`, error.message)
    return res.status(500).json({ success: false, message: error.message || 'Failed to send reset email' })
  }
})

router.post('/reset-password/:token', async (req, res) => {
  try {
    const token = String(req.params?.token || '')
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ success: false, message: 'Invalid token' })
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' })

    const tokenHash = sha256(token)
    const user = await User.findOne({ resetTokenHash: tokenHash })
    if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired token' })
    if (!user.resetTokenExpiresAt || user.resetTokenExpiresAt.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' })
    }

    user.passwordHash = await bcrypt.hash(password, 10)
    user.resetTokenHash = ''
    user.resetTokenExpiresAt = null
    await user.save()

    const tokenJwt = buildToken({ sub: String(user._id), email: user.email, role: user.role })
    return res.json({ success: true, token: tokenJwt, role: user.role })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Reset failed' })
  }
})

router.get('/verify-email/:token', async (req, res) => {
  try {
    const token = String(req.params?.token || '')
    const email = normalizeEmail(req.query?.email)
    
    if (!token) return res.status(400).json({ success: false, message: 'Invalid token' })

    const tokenHash = sha256(token)
    const userByToken = await User.findOne({ verificationTokenHash: tokenHash })

    if (userByToken) {
      if (userByToken.isVerified) {
        return res.json({
          success: true,
          message: 'Account already verified'
        })
      }

      if (userByToken.verificationTokenExpiresAt && userByToken.verificationTokenExpiresAt.getTime() < Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'This link has expired. Request a new verification email.'
        })
      }

      userByToken.isVerified = true
      userByToken.verificationTokenHash = ''
      userByToken.verificationTokenExpiresAt = null
      userByToken.verificationEmailLastSentAt = null
      await userByToken.save()

      return res.json({
        success: true,
        message: 'Email verified successfully'
      })
    }

    // If token not found, check if the email is already verified
    if (email) {
      const userByEmail = await User.findOne({ email })
      if (userByEmail && userByEmail.isVerified) {
        return res.json({
          success: true,
          message: 'Account already verified'
        })
      }
    }

    return res.status(400).json({
      success: false,
      message: 'Invalid or expired verification link'
    })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Verification failed' })
  }
})

router.post('/resend-verification', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!isValidEmailFormat(email)) return res.status(400).json({ success: false, message: 'Invalid email format' })

    const user = await User.findOne({ email })
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })
    if (user.isVerified) return res.status(400).json({ success: false, message: 'Account is already verified' })

    const now = new Date()
    if (
      user.verificationEmailLastSentAt &&
      now.getTime() - user.verificationEmailLastSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      const waitSec = Math.ceil(
        (VERIFICATION_RESEND_COOLDOWN_MS - (now.getTime() - user.verificationEmailLastSentAt.getTime())) / 1000
      )
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSec}s before requesting another verification email.`
      })
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenHash = sha256(verificationToken)
    const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS)

    user.verificationTokenHash = verificationTokenHash
    user.verificationTokenExpiresAt = verificationTokenExpiresAt
    user.verificationEmailLastSentAt = now
    await user.save()

    try {
      await sendVerificationEmail(email, verificationToken)
    } catch (mailErr) {
      if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Email service is not configured' })
      }
      console.error('resend-verification mail:', mailErr?.message)
      return res.status(502).json({
        success: false,
        message: 'Could not send verification email. Try again later.'
      })
    }

    return res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    })
  } catch (error) {
    console.error('Failed to resend verification email:', error.message)
    return res.status(500).json({ success: false, message: error.message || 'Failed to resend verification email' })
  }
})

export default router
