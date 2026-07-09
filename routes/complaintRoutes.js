import express from 'express'
import Complaint from '../models/Complaint.js'
import { sendEmail } from '../utils/mailer.js'
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js'

const router = express.Router()

const getFeedbackEmail = () => process.env.FEEDBACK_EMAIL || 'meatbyalvi1@gmail.com'

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\n/g, '<br/>')

// Generate unique complaint ID
const generateComplaintId = () => {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000)
  return `COMP-${timestamp}-${random}`
}

// Submit complaint
router.post('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const customerName = String(req.body?.name || '').trim()
    const phone = String(req.body?.phone || '').trim()
    const email = String(req.body?.email || '').trim()
    const orderNumber = String(req.body?.orderNumber || '').trim()
    const subject = String(req.body?.subject || '').trim()
    const complaint = String(req.body?.complaint || '').trim()

    // Validate
    if (!customerName || !phone || !subject || !complaint) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, subject, and complaint description are required.'
      })
    }

    const complaintId = generateComplaintId()

    // Save to database
    const newComplaint = new Complaint({
      complaintId,
      customerName,
      phone,
      email,
      orderNumber,
      subject,
      complaint
    })

    await newComplaint.save()

    // Send admin notification email (with error handling)
    try {
      const adminTo = getFeedbackEmail()
      const adminHtml = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
          <h2 style="color:#8B0000;">⚠️ New Complaint Received</h2>
          <div style="padding:16px;background:#fff4f4;border-left:4px solid #8B0000;border-radius:8px;">
            <p><strong>Complaint ID:</strong> ${escapeHtml(complaintId)}</p>
            <p><strong>Customer Name:</strong> ${escapeHtml(customerName)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
            ${email ? `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` : ''}
            ${orderNumber ? `<p><strong>Order Number:</strong> ${escapeHtml(orderNumber)}</p>` : ''}
            <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
          </div>
          <p><strong>Complaint Details:</strong></p>
          <div style="padding:14px 18px;background:#f9f9f9;border-radius:12px;border:1px solid #ddd;white-space:pre-wrap;">${escapeHtml(complaint)}</div>
          <hr style="margin:24px 0;border:none;border-top:1px solid #eee;" />
          <p style="font-size:13px;color:#555;">Please review this complaint and respond to the customer promptly.</p>
        </div>
      `

      await sendEmail({
        to: adminTo,
        subject: `New Complaint: ${subject} (${complaintId})`,
        html: adminHtml,
        replyTo: email || undefined
      })
    } catch (emailError) {
      console.warn('Failed to send admin email for complaint:', emailError?.message || emailError)
    }

    // Send user confirmation email if email provided (with error handling)
    if (email) {
      try {
        const userHtml = `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
            <h2 style="color:#8B4513;">Thank You for Your Complaint</h2>
            <div style="padding:16px;background:#f0f7ff;border-left:4px solid #3b82f6;border-radius:8px;">
              <p><strong>Complaint ID:</strong> ${escapeHtml(complaintId)}</p>
            </div>
            <p>Dear ${escapeHtml(customerName)},</p>
            <p>We have received your complaint and our team will review it within 24 hours. We will contact you soon to address your concerns.</p>
            <h4 style="margin-top:24px;">Complaint Summary:</h4>
            <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
            <div style="padding:14px 18px;background:#f9f9f9;border-radius:12px;border:1px solid #ddd;white-space:pre-wrap;">${escapeHtml(complaint)}</div>
            <p style="margin-top:24px;">Best regards,<br/>MeatByAlvi Team</p>
          </div>
        `

        await sendEmail({
          to: email,
          subject: `We Received Your Complaint (${complaintId})`,
          html: userHtml
        })
      } catch (userEmailError) {
        console.warn('Failed to send user confirmation email for complaint:', userEmailError?.message || userEmailError)
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Your complaint has been submitted successfully.',
      complaintId
    })
  } catch (error) {
    console.error('Complaint submission error:', error?.message || error)
    return res.status(500).json({
      success: false,
      message: 'Unable to submit your complaint right now. Please try again later.'
    })
  }
})

// Get all complaints (for admin)
router.get('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ date: -1 })
    return res.status(200).json({
      success: true,
      data: complaints
    })
  } catch (error) {
    console.error('Get complaints error:', error?.message || error)
    return res.status(500).json({
      success: false,
      message: 'Unable to retrieve complaints.'
    })
  }
})

// Update complaint status (for admin)
router.patch('/:id/status', optionalAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    // First find the complaint to check previous state and email
    const existingComplaint = await Complaint.findOne({ complaintId: id })
    if (!existingComplaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found.'
      })
    }

    // Update the complaint
    const complaint = await Complaint.findOneAndUpdate(
      { complaintId: id },
      { status },
      { new: true }
    )

    // If status changed to Resolved and we have an email, send notification
    if (status === 'Resolved' && existingComplaint.email && existingComplaint.status !== 'Resolved') {
      try {
        const userHtml = `
          <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.6;">
            <h2 style="color:#10b981;">Your Complaint Has Been Resolved</h2>
            <div style="padding:16px;background:#f0fff4;border-left:4px solid #10b981;border-radius:8px;">
              <p><strong>Complaint ID:</strong> ${escapeHtml(id)}</p>
            </div>
            <p>Dear ${escapeHtml(existingComplaint.customerName)},</p>
            <p>Great news! Your complaint has been reviewed and resolved by our team. Thank you for your patience and for helping us improve our services.</p>
            <h4 style="margin-top:24px;">Complaint Summary:</h4>
            <p><strong>Subject:</strong> ${escapeHtml(existingComplaint.subject)}</p>
            <div style="padding:14px 18px;background:#f9f9f9;border-radius:12px;border:1px solid #ddd;white-space:pre-wrap;">${escapeHtml(existingComplaint.complaint)}</div>
            <p style="margin-top:24px;">If you have any further issues or questions, feel free to reach out to us.</p>
            <p style="margin-top:24px;">Best regards,<br/>MeatByAlvi Team</p>
          </div>
        `

        await sendEmail({
          to: existingComplaint.email,
          subject: `Your Complaint Has Been Resolved (${id})`,
          html: userHtml
        })
      } catch (emailError) {
        console.warn('Failed to send complaint resolved email to user:', emailError?.message || emailError)
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Complaint status updated.',
      data: complaint
    })
  } catch (error) {
    console.error('Update complaint status error:', error?.message || error)
    return res.status(500).json({
      success: false,
      message: 'Unable to update complaint status.'
    })
  }
})

export default router
