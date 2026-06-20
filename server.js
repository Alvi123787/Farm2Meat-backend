import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

import animalRoutes from './routes/animalRoutes.js'
import inquiryRoutes from './routes/inquiryRoutes.js'
import feedbackRoutes from './routes/feedbackRoutes.js'
import analyticsRoutes from './routes/analyticsRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import searchRoutes from './routes/searchRoutes.js'
import authRoutes from './routes/authRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import userRoutes from './routes/userRoutes.js'
import butcherRoutes from './routes/butcherRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import meatItemRoutes from './routes/MeatItemroutes.js'
import { guestSessionMiddleware } from './middleware/guestSessionMiddleware.js'
import { optionalAuthMiddleware } from './middleware/authMiddleware.js'
import { activityMiddleware } from './middleware/activityMiddleware.js'
import { dbMiddleware } from './middleware/dbMiddleware.js'

if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined.')
  process.exit(1)
}

const app = express()

// ── Middleware ──
const allowedOrigins = process.env.FRONTEND_ORIGIN 
  ? process.env.FRONTEND_ORIGIN.split(',').map(o => o.trim().replace(/\/$/, '')) 
  : ['http://localhost:5173', 'https://meatbyalvi.netlify.app']

app.use(cors({ 
  origin: allowedOrigins,
  credentials: true 
}))

const jsonParser = express.json({ limit: '100mb' })
app.use((req, res, next) => {
  // Skip JSON parsing if Content-Type is multipart/form-data!
  if (req.headers['content-type']?.startsWith('multipart/form-data')) {
    return next()
  }
  jsonParser(req, res, (err) => {
    if (!err) return next()
    const code = err.statusCode || err.status
    if (code === 400 && err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, message: 'Invalid JSON body' })
    }
    return next(err)
  })
})
app.use(express.urlencoded({ extended: true, limit: '100mb' }))

// ── Root Route (Health Check) ──
app.get('/', (req, res) => {
  res.json({ success: true, message: 'MeatByAlvi API is running 🚀' })
})

app.use(dbMiddleware) // Ensure DB is connected before any middleware that uses it
app.use(guestSessionMiddleware)
app.use(optionalAuthMiddleware)
app.use(activityMiddleware)

// ── Routes ──
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/animals', animalRoutes)
app.use('/api/inquiries', inquiryRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/butchers', butcherRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/meat-items', meatItemRoutes)

// ── JSON / multer / upload errors → JSON (avoid HTML + huge stacks for client mistakes) ──
app.use((err, req, res, next) => {
  if (!err) return next()
  if (res.headersSent) return next(err)

  const message = err.message || 'Request failed'
  const code = err.code
  const isClient =
    code === 'LIMIT_FILE_SIZE' ||
    err.name === 'ValidationError' ||
    err.name === 'CastError' ||
    err.code === 11000 ||
    /^Invalid (image|video) type\.|^Only images and videos|^Invalid JSON/i.test(message)

  if (isClient) {
    console.warn(`[${req.method} ${req.path}] Client error: ${message}`)
  } else {
    console.error(`🔥 SERVER ERROR [${req.method} ${req.path}]:`, err.stack || err)
  }

  if (code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File too large (max 100MB per file)' })
  }

  if (err.name === 'ValidationError') {
    // Collect all mongoose validation errors
    const messages = err.errors ? Object.values(err.errors).map(e => e.message) : [err.message]
    return res.status(400).json({ 
      success: false, 
      message: messages.join(', ') || 'Validation failed' 
    })
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid ${err.path}: ${err.value}` })
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {}).join(', ')
    return res.status(400).json({
      success: false,
      message: fields ? `${fields} already exists` : 'Duplicate field value entered'
    })
  }

  const status =
    typeof err.statusCode === 'number'
      ? err.statusCode
      : typeof err.status === 'number'
        ? err.status
        : isClient
          ? 400
          : 500

  return res.status(status >= 400 && status < 600 ? status : 400).json({ 
    success: false, 
    message: process.env.NODE_ENV === 'development' ? message : (isClient ? message : 'Internal server error')
  })
})

// ── Server Start (Development Only) ──
const PORT = process.env.PORT || 5000

if (process.env.NODE_ENV !== 'production') {
  import('./utils/db.js').then(({ default: connectDB }) => {
    connectDB().then(() => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`)
      })
    })
  })
}

export default app
