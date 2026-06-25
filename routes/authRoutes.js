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
import Inquiry from '../models/Inquiry.js'

import { getFrontendOrigin } from '../utils/config.js'

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
  // Min 6 characters, at least one uppercase letter and one number
  return (
    password.length >= 6 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  )
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000
const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000

const sendVerificationEmail = async (email, verificationToken) => {
  console.log(`[EMAIL] Preparing verification email for ${email}`)
  const verificationLink = `${getFrontendOrigin()}/verify-email/${verificationToken}?email=${encodeURIComponent(email)}`
  const html = buildWelcomeVerificationEmailHtml({
    customerName: email.split('@')[0],
    verificationUrl: verificationLink
  })
  console.log(`[EMAIL] Sending verification email to ${email} with link: ${verificationLink}`)
  await sendEmail({
    to: email,
    subject: 'Verify your MeatByAlvi account',
    html
  })
  console.log(`[EMAIL] Verification email successfully sent to ${email}`)
}

/**
 * Register: creates unverified user and sends email link (24h).
 * If email exists but unverified, refreshes password + token and resends.
 */
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

    const passwordHash = await bcrypt.hash(password, 10)
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationTokenHash = sha256(verificationToken)
    const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS)
    const now = new Date()

    const existing = await User.findOne({ email })

    if (existing) {
      if (existing.isVerified) {
        console.log(`[SIGNUP] Existing verified user found for ${email}, returning generic message`)
        // Return generic message to prevent enumeration
        return res.status(201).json({
          success: true,
          message: 'Account created. Check your email and click the link to verify your account.'
        })
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
        console.log(`[SIGNUP] Cooldown active for ${email}, wait ${waitSec}s`)
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec}s before requesting another verification email.`
        })
      }

      console.log(`[SIGNUP] Updating existing unverified user ${email}`)
      existing.fullName = fullName
      existing.phone = phone
      existing.city = city
      existing.passwordHash = passwordHash
      existing.verificationTokenHash = verificationTokenHash
      existing.verificationTokenExpiresAt = verificationTokenExpiresAt
      existing.verificationEmailLastSentAt = now
      await existing.save()

      try {
        await sendVerificationEmail(email, verificationToken)
      } catch (mailErr) {
        console.error(`[SIGNUP] Failed to send verification email to ${email} (resend):`, mailErr?.message)
        if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
          return res.status(503).json({ success: false, message: 'Email service is not configured' })
        }
        return res.status(502).json({
          success: false,
          message: 'Could not send verification email. Try again later.'
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Account created. Check your email and click the link to verify your account.'
      })
    }

    console.log(`[SIGNUP] Creating new user ${email}`)
    const user = await User.create({
      email,
      fullName,
      phone,
      city,
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
      console.error(`[SIGNUP] Failed to send verification email to ${email}, deleting user:`, mailErr?.message)
      await User.deleteOne({ _id: user._id })
      if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Email service is not configured' })
      }
      return res.status(502).json({
        success: false,
        message: 'Could not send verification email. Check the address or try again later.'
      })
    }

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

    return res.status(201).json({
      success: true,
      message: 'Account created. Check your email and click the link to verify your account.'
    })
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
      // If password was wrong for the admin email
      return res.status(401).json({ success: false, message: 'Incorrect password for admin.' })
    }

    const user = await User.findOne({ email })
    if (!user) {
      console.log(`[LOGIN] Failed: No user found for ${email}`)
      return res.status(401).json({ success: false, message: 'This email is not registered.' })
    }

    if (!user.isVerified) {
      console.log(`[LOGIN] Failed: User ${email} is not verified`)
      return res.status(403).json({
        success: false,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email to continue.'
      })
    }

    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      console.log(`[LOGIN] Failed: Incorrect password for ${email}`)
      return res.status(401).json({ success: false, message: 'Incorrect password.' })
    }

    console.log(`[LOGIN] Login successful for ${email}`)
    const token = buildToken({ sub: String(user._id), email: user.email, role: user.role })

    // Update cart session only if guestUserId is provided
    const guestUserId = req.headers['x-guest-user-id']
    if (guestUserId) {
      await CartSession.findOneAndUpdate(
        { guestUserId },
        { $set: { userId: String(user._id), userEmail: user.email } },
        { upsert: false } // Only update if it exists
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
    // Anti-enumeration: if user not found, still return success
    if (!user) return res.json({ success: true, message: genericMessage })

    // Cooldown check
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

    const resetToken = crypto.randomBytes(32).toString('hex')
    const resetTokenHash = sha256(resetToken)
    const resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000)

    user.resetTokenHash = resetTokenHash
    user.resetTokenExpiresAt = resetTokenExpiresAt
    user.passwordResetLastSentAt = now
    await user.save()

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
    const token = String(req.params?.token || '')
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ success: false, message: 'Invalid request' })
    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters and include at least one uppercase letter and one number'
      })
    }

    const tokenHash = sha256(token)
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

router.get('/verify-email/:token', async (req, res) => {
  console.log(`[VERIFY-EMAIL] Verification attempt with token: ${req.params?.token?.substring(0, 10)}... and email: ${normalizeEmail(req.query?.email)}`)
  try {
    const token = String(req.params?.token || '')
    const email = normalizeEmail(req.query?.email)
    
    if (!token) {
      console.log(`[VERIFY-EMAIL] Failed: No token provided`)
      return res.status(400).json({ success: false, message: 'Invalid request' })
    }

    const tokenHash = sha256(token)
    const userByToken = await User.findOne({ verificationTokenHash: tokenHash })

    if (userByToken) {
      if (userByToken.isVerified) {
        console.log(`[VERIFY-EMAIL] Account already verified for user: ${userByToken.email}`)
        return res.json({
          success: true,
          message: 'Account already verified'
        })
      }

      if (userByToken.verificationTokenExpiresAt && userByToken.verificationTokenExpiresAt.getTime() < Date.now()) {
        console.log(`[VERIFY-EMAIL] Failed: Token expired for user: ${userByToken.email}`)
        return res.status(400).json({
          success: false,
          message: 'This link has expired. Request a new verification email.'
        })
      }

      console.log(`[VERIFY-EMAIL] Verifying user: ${userByToken.email}`)
      userByToken.isVerified = true
      userByToken.verificationTokenHash = ''
      userByToken.verificationTokenExpiresAt = null
      userByToken.verificationEmailLastSentAt = null
      await userByToken.save()

      // Link all guest orders with this email to the new user
      await Inquiry.updateMany(
        { email: normalizeEmail(email), userType: 'guest' },
        { 
          $set: { 
            userId: String(userByToken._id), 
            userType: 'registered' 
          } 
        }
      )

      console.log(`[VERIFY-EMAIL] Successfully verified user: ${userByToken.email}`)
      return res.json({
        success: true,
        message: 'Email verified successfully'
      })
    }

    // If token not found, check if the email is already verified (optional fallback)
    if (email) {
      const userByEmail = await User.findOne({ email })
      if (userByEmail && userByEmail.isVerified) {
        console.log(`[VERIFY-EMAIL] Account already verified (by email) for: ${email}`)
        return res.json({
          success: true,
          message: 'Account already verified'
        })
      }
    }

    console.log(`[VERIFY-EMAIL] Failed: Invalid or expired token for email: ${email}`)
    return res.status(400).json({
      success: false,
      message: 'Invalid or expired verification link'
    })
  } catch (error) {
    console.error(`[VERIFY-EMAIL] Unexpected error:`, error)
    return res.status(500).json({ success: false, message: 'Something went wrong' })
  }
})

router.post('/resend-verification', async (req, res) => {
  console.log(`[RESEND-VERIFICATION] Resend request received for email: ${req.body?.email}`)
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!isValidEmailFormat(email)) {
      console.log(`[RESEND-VERIFICATION] Failed: Invalid email format for ${email}`)
      return res.status(400).json({ success: false, message: 'Invalid email format' })
    }

    const user = await User.findOne({ email })
    // Anti-enumeration: if user not found, return generic success
    if (!user) {
      console.log(`[RESEND-VERIFICATION] No user found for ${email}, returning generic success`)
      return res.json({ success: true, message: 'Verification email sent. Please check your inbox.' })
    }
    if (user.isVerified) {
      console.log(`[RESEND-VERIFICATION] User ${email} is already verified`)
      return res.json({ success: true, message: 'Account is already verified' })
    }

    const now = new Date()
    if (
      user.verificationEmailLastSentAt &&
      now.getTime() - user.verificationEmailLastSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS
    ) {
      const waitSec = Math.ceil(
        (VERIFICATION_RESEND_COOLDOWN_MS - (now.getTime() - user.verificationEmailLastSentAt.getTime())) / 1000
      )
      console.log(`[RESEND-VERIFICATION] Cooldown active for ${email}, wait ${waitSec}s`)
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
      console.error(`[RESEND-VERIFICATION] Failed to send email to ${email}:`, mailErr?.message)
      if (mailErr?.code === 'MAIL_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Email service is not configured' })
      }
      return res.status(502).json({
        success: false,
        message: 'Could not send verification email. Try again later.'
      })
    }

    console.log(`[RESEND-VERIFICATION] Verification email resent successfully to ${email}`)
    return res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    })
  } catch (error) {
    console.error(`[RESEND-VERIFICATION] Unexpected error:`, error)
    return res.status(500).json({ success: false, message: 'Something went wrong' })
  }
})

export default router
