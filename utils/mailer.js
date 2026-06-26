import nodemailer from 'nodemailer'

const getGmailUser = () => process.env.GMAIL_USER || ''
const getGmailPass = () => process.env.GMAIL_APP_PASSWORD || ''
const getAdminEmail = () => process.env.ADMIN_EMAIL || ''

export const isEmailTransportConfigured = () => {
  const user = String(getGmailUser() || '').trim()
  const pass = String(getGmailPass() || '').trim()
  return Boolean(user && pass)
}

export const sendEmail = async ({ to, subject, html, attachments = [] }) => {
  const user = getGmailUser()
  const pass = getGmailPass()
  const adminEmail = getAdminEmail()

  console.log(`[MAILER] sendEmail called with:`, { to, subject, user: user ? '***' : 'NOT SET', pass: pass ? '***' : 'NOT SET' })

  if (!user || !pass) {
    console.error('MAIL_NOT_CONFIGURED: Email service credentials (GMAIL_USER, GMAIL_APP_PASSWORD) are not set in .env file.')
    const err = new Error('Email service is not configured.')
    err.code = 'MAIL_NOT_CONFIGURED'
    throw err
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    logger: true,
    debug: true
  })

  try {
    const info = await transporter.sendMail({
      from: `"MeatByAlvi" <${user}>`,
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

    if (adminEmail && adminEmail !== to) {
      try {
        await transporter.sendMail({
          from: `"MeatByAlvi" <${user}>`,
          to: adminEmail,
          subject: `ALERT: Email Delivery Failure`,
          html: `<p>Failed to send an email to <strong>${to}</strong>.</p>
                 <p><strong>Subject:</strong> ${subject}</p>
                 <p><strong>Error:</strong> ${error.message}</p>
                 <pre style="background: #f5f5f5; padding: 10px;">${error.stack}</pre>`
        })
        console.log(`Admin alert sent to ${adminEmail} about email failure to ${to}`)
      } catch (adminErr) {
        console.error(`Failed to send admin alert:`, adminErr.message)
      }
    }

    throw error
  }
}
