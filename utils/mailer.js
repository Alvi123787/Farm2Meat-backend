import { Resend } from 'resend'

// ✅ TOP PE MAT BANAO - file load hote hi crash karta hai
// const resend = new Resend(process.env.RESEND_API_KEY)  ← REMOVE THIS

export const isEmailTransportConfigured = () => {
  return Boolean(process.env.RESEND_API_KEY)
}

export const sendEmail = async ({ to, subject, html, attachments = [] }) => {
  const apiKey = process.env.RESEND_API_KEY  // ✅ Andar se lo

  if (!apiKey) {
    const err = new Error('Email service is not configured.')
    err.code = 'MAIL_NOT_CONFIGURED'
    throw err
  }

  const resend = new Resend(apiKey)  // ✅ Andar banao

  console.log(`[MAILER] Sending email to: ${to} | Subject: ${subject}`)

  const { data, error } = await resend.emails.send({
    from: 'MeatByAlvi <onboarding@resend.dev>',
    to,
    subject,
    html
  })

  if (error) {
    console.error(`[MAILER] Failed to send to ${to}:`, error)
    throw new Error(error.message || 'Failed to send email')
  }

  console.log(`[MAILER] Email sent successfully to ${to}. ID: ${data?.id}`)
  return data
}