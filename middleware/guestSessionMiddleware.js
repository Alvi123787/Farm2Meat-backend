import crypto from 'crypto'

const parseCookies = (cookieHeader) => {
  const raw = String(cookieHeader || '')
  if (!raw) return {}
  const out = {}
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=')
    if (idx === -1) return
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (!key) return
    out[key] = decodeURIComponent(val)
  })
  return out
}

export const guestSessionMiddleware = (req, res, next) => {
  const cookieName = 'guestSessionId'
  const cookies = req.cookies || parseCookies(req.headers?.cookie)
  let guestSessionId = cookies?.[cookieName] || ''
  if (!guestSessionId) {
    guestSessionId = crypto.randomBytes(18).toString('hex')
    res.cookie(cookieName, guestSessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 30 * 24 * 60 * 60 * 1000
    })
  }
  req.guestUserId = guestSessionId
  next()
}

