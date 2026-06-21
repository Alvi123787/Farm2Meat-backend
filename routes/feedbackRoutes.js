import express from 'express'
import { sendEmail } from '../utils/mailer.js'
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

const getFeedbackEmail = () => process.env.FEEDBACK_EMAIL || 'farm2meat@gmail.com'

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\n/g, '<br/>')

router.post('/', optionalAuthMiddleware, async (req, res) => {
  const fullName = String(req.body?.fullName || '').trim()
  const phone = String(req.body?.phone || '').trim()
  const feedback = String(req.body?.feedback || '').trim()
  const email = String(req.body?.email || '').trim()

  if (!fullName || !phone || !feedback) {
    return res.status(400).json({
      success: false,
      message: 'Name, phone, and feedback are required.'
    })
  }

  const to = getFeedbackEmail()

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
      <h2 style="color:#8B4513;">New Feedback Received</h2>
      <p><strong>Name:</strong> ${escapeHtml(fullName)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      ${email ? `<p><strong>Sender Email:</strong> ${escapeHtml(email)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <div style="padding:14px 18px;background:#f9f9f9;border-radius:12px;border:1px solid #ddd;white-space:pre-wrap;">${escapeHtml(feedback)}</div>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee;" />
      <p style="font-size:13px;color:#555;">This message was submitted from the website feedback form.</p>
    </div>
  `

  try {
    await sendEmail({
      to,
      subject: `New Feedback from ${fullName}`,
      html,
      replyTo: email || undefined
    })

    return res.status(200).json({
      success: true,
      message: 'Feedback sent successfully.'
    })
  } catch (error) {
    console.error('Feedback email error:', error?.message || error)
    return res.status(500).json({
      success: false,
      message: 'Unable to send your feedback right now. Please try again later.'
    })
  }
})

export default router
