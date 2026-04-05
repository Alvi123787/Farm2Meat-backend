import jwt from 'jsonwebtoken'

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-jwt-secret'

export const optionalAuthMiddleware = (req, res, next) => {
  const header = String(req.headers?.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return next()
  try {
    const payload = jwt.verify(token, getJwtSecret())
    req.user = {
      id: payload?.sub || payload?.id || '',
      email: payload?.email || '',
      role: payload?.role || 'user'
    }
  } catch (error) {
    req.user = undefined
  }
  return next()
}

export const authMiddleware = (req, res, next) => {
  const header = String(req.headers?.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' })

  try {
    const payload = jwt.verify(token, getJwtSecret())
    req.user = {
      id: payload?.sub || payload?.id || '',
      email: payload?.email || '',
      role: payload?.role || 'user'
    }
    return next()
  } catch (error) {
    console.error('JWT verification error:', error.message)
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
}

export const adminMiddleware = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' })
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' })
  return next()
}
