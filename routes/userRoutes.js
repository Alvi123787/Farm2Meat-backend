import express from 'express'
import User from '../models/User.js'
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js'
import { sendEmail } from '../utils/mailer.js'
import { buildPromotionalEmailHtml, buildAdminCustomEmailHtml } from '../utils/orderEmailTemplates.js'

const router = express.Router()

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const toPublicUser = (doc) => {
  if (!doc) return null
  const email = String(doc.email || '')
  return {
    _id: doc._id,
    email,
    displayName: email.split('@')[0] || email,
    role: doc.role,
    isVerified: Boolean(doc.isVerified),
    isSubscribed: Boolean(doc.isSubscribed),
    joinedAt: doc.createdAt,
    lastActivity: doc.lastActivity
  }
}

router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20))
    const search = String(req.query.search || '').trim()
    const roleFilter = String(req.query.role || '').trim().toLowerCase()

    const query = {}

    if (roleFilter === 'admin' || roleFilter === 'user') {
      query.role = roleFilter
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), 'i')
      query.email = re
    }

    const skip = (page - 1) * limit

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-passwordHash -resetTokenHash -verificationTokenHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query)
    ])

    res.json({
      success: true,
      data: users.map((u) => toPublicUser(u)),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit))
    })
  } catch (error) {
    console.error('GET /api/users:', error.message)
    res.status(500).json({ success: false, message: 'Failed to fetch users' })
  }
})

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' })
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the last database admin account'
        })
      }
    }

    await User.findByIdAndDelete(req.params.id)
    res.json({ success: true, message: 'User deleted successfully' })
  } catch (error) {
    console.error('DELETE /api/users/:id:', error.message)
    res.status(500).json({ success: false, message: 'Failed to delete user' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/users/promote — Admin: Send promotional email to all users
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/promote', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { title, offerMessage, ctaText, ctaUrl, imageUrl } = req.body

    if (!title || !offerMessage) {
      return res.status(400).json({ success: false, message: 'Title and offer message are required' })
    }

    const users = await User.find({ isSubscribed: true, isVerified: true }).select('email').lean()
    const emails = users.map(u => u.email).filter(Boolean)

    if (emails.length === 0) {
      return res.status(404).json({ success: false, message: 'No subscribed users found' })
    }

    const html = buildPromotionalEmailHtml({
      title,
      offerMessage,
      ctaText,
      ctaUrl,
      imageUrl
    })

    // Async send (background)
    (async () => {
      for (const email of emails) {
        await sendEmail({
          to: email,
          subject: `${title} - Farm2Meat 📢`,
          html
        }).catch(err => console.error(`Failed to send promotional email to ${email}:`, err.message))
      }
    })()

    res.json({
      success: true,
      message: `Promotional email campaign started for ${emails.length} users.`,
      count: emails.length
    })
  } catch (error) {
    console.error('POST /api/users/promote:', error.message)
    res.status(500).json({ success: false, message: 'Failed to send promotional emails' })
  }
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/users/send-email — Admin: Send custom email to all or selected users
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/send-email', authMiddleware, adminMiddleware, async (req, res) => {
  console.log('[EmailRoute] Request received:', { 
    subject: req.body?.subject, 
    sendToAll: req.body?.sendToAll,
    selectedCount: req.body?.selectedUsers?.length 
  });

  try {
    const { subject, message, sendToAll, selectedUsers } = req.body

    if (!subject || !message) {
      console.log('[EmailRoute] Validation failed: Missing subject or message');
      return res.status(400).json({ success: false, message: 'Subject and message are required' })
    }

    let recipientEmails = []

    try {
      if (sendToAll) {
        console.log('[EmailRoute] Fetching all verified users...');
        const users = await User.find({ isVerified: true }).select('email').lean()
        recipientEmails = users.map(u => u.email).filter(Boolean)
        console.log(`[EmailRoute] Found ${recipientEmails.length} verified users`);
      } else {
        if (!selectedUsers || !Array.isArray(selectedUsers) || selectedUsers.length === 0) {
          console.log('[EmailRoute] Validation failed: No users selected');
          return res.status(400).json({ success: false, message: 'At least one user must be selected' })
        }
        recipientEmails = selectedUsers.filter(Boolean)
        console.log(`[EmailRoute] Using ${recipientEmails.length} selected users`);
      }
    } catch (dbErr) {
      console.error('[EmailRoute] Database error:', dbErr);
      return res.status(500).json({ success: false, message: 'Database error while fetching users' });
    }

    if (recipientEmails.length === 0) {
      console.log('[EmailRoute] No recipients found');
      return res.status(404).json({ success: false, message: 'No recipients found' })
    }

    let html = '';
    try {
      html = buildAdminCustomEmailHtml({
        title: subject,
        message: message
      })
      console.log('[EmailRoute] Template built successfully');
    } catch (tmplErr) {
      console.error('[EmailRoute] Template error:', tmplErr);
      return res.status(500).json({ success: false, message: 'Error generating email template' });
    }

    // For Vercel/Serverless: We might need to await to ensure emails are sent
    // But to keep it responsive, we'll try background first with better error catching
    const processEmails = async () => {
      console.log('[EmailRoute] Starting background process for', recipientEmails.length, 'emails');
      for (const email of recipientEmails) {
        try {
          await sendEmail({
            to: email,
            subject: `${subject} - Farm2Meat`,
            html
          });
          console.log(`[EmailRoute] Sent to ${email}`);
        } catch (mailErr) {
          console.error(`[EmailRoute] Failed to send to ${email}:`, mailErr.message);
        }
      }
      console.log('[EmailRoute] Background process completed');
    };
    
    // Start background process without await
    processEmails().catch(err => {
      console.error('[EmailRoute] Background process fatal error:', err);
    });

    console.log('[EmailRoute] Sending success response to client');
    return res.status(200).json({
      success: true,
      message: `Emails are being processed for ${recipientEmails.length} recipients.`,
      count: recipientEmails.length
    })
  } catch (error) {
    console.error('[EmailRoute] UNEXPECTED CRITICAL ERROR:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error',
      error: error.message,
      type: error.name
    })
  }
})

router.patch('/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const nextRole = String(req.body?.role || '')
    if (!['admin', 'user'].includes(nextRole)) {
      return res.status(400).json({ success: false, message: 'Invalid role' })
    }

    const user = await User.findById(req.params.id)
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' })
    }

    if (user.role === 'admin' && nextRole === 'user') {
      const adminCount = await User.countDocuments({ role: 'admin' })
      if (adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last database admin'
        })
      }
    }

    user.role = nextRole
    await user.save()

    const fresh = await User.findById(user._id)
      .select('-passwordHash -resetTokenHash -verificationTokenHash')
      .lean()

    res.json({
      success: true,
      message: 'Role updated',
      data: toPublicUser(fresh)
    })
  } catch (error) {
    console.error('PATCH /api/users/:id/role:', error.message)
    res.status(500).json({ success: false, message: 'Failed to update role' })
  }
})

export default router
