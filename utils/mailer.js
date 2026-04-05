import nodemailer from 'nodemailer'

const getGmailUser = () => process.env.GMAIL_USER || process.env.ADMIN_EMAIL || ''
const getGmailPass = () => process.env.GMAIL_APP_PASSWORD || ''

/** Used by scheduled jobs to skip work when mail cannot send (avoids noisy per-recipient errors). */
export const isEmailTransportConfigured = () => {
  const user = String(getGmailUser() || '').trim()
  const pass = String(getGmailPass() || '').trim()
  return Boolean(user && pass)
}

export const sendEmail = async ({ to, subject, html, attachments = [] }) => {
  const user = getGmailUser()
  const pass = getGmailPass()

  if (!user || !pass) {
    console.error('MAIL_NOT_CONFIGURED: Email service credentials (GMAIL_USER, GMAIL_APP_PASSWORD) are not set in .env file.')
    const err = new Error('Email service is not configured.')
    err.code = 'MAIL_NOT_CONFIGURED'
    throw err
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    logger: true, // Enable detailed logging
    debug: true // Show debug output
  })

  try {
    const info = await transporter.sendMail({
      from: `"Farm2Meat" <${user}>`,
      to,
      subject,
      html,
      attachments
    })
    console.log(`Email sent successfully to ${to}. Message ID: ${info.messageId}`)
    return info
  } catch (error) {
    console.error(`Failed to send email to ${to}. Subject: "${subject}"`, {
      error: error.message,
      code: error.code,
      stack: error.stack.split('\n').slice(0, 5).join('\n')
    })
    throw error
  }
}
