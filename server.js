import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'

import animalRoutes from './routes/animalRoutes.js'
import inquiryRoutes from './routes/inquiryRoutes.js'
import analyticsRoutes from './routes/analyticsRoutes.js'
import notificationRoutes from './routes/notificationRoutes.js'
import searchRoutes from './routes/searchRoutes.js'
import authRoutes from './routes/authRoutes.js'
import reviewRoutes from './routes/reviewRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import userRoutes from './routes/userRoutes.js'
import butcherRoutes from './routes/butcherRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import { guestSessionMiddleware } from './middleware/guestSessionMiddleware.js'
import { optionalAuthMiddleware } from './middleware/authMiddleware.js'
import { activityMiddleware } from './middleware/activityMiddleware.js'

dotenv.config()
const app = express()

// ── Middleware ──
const rawOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'
const allowedOrigins = rawOrigin.split(',').map(o => o.trim().replace(/\/$/, ''))

app.use(cors({ 
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true)
    
    const isAllowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*')
    
    if (isAllowed) {
      // Must return the specific origin (not '*') for credentials: true
      callback(null, true)
    } else {
      console.warn(`CORS blocked for origin: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true 
}))

const jsonParser = express.json()
app.use((req, res, next) => {
  jsonParser(req, res, (err) => {
    if (!err) return next()
    const code = err.statusCode || err.status
    if (code === 400 && err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, message: 'Invalid JSON body' })
    }
    return next(err)
  })
})
app.use(express.urlencoded({ extended: true }))
app.use(guestSessionMiddleware)
app.use(optionalAuthMiddleware)
app.use(activityMiddleware)

// ── Routes ──
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/animals', animalRoutes)
app.use('/api/inquiries', inquiryRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/butchers', butcherRoutes)
app.use('/api/upload', uploadRoutes)

// ── Root Route ──
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Farm2Meat API is running 🚀' })
})

// ── JSON / multer / upload errors → JSON (avoid HTML + huge stacks for client mistakes) ──
app.use((err, req, res, next) => {
  if (!err) return next()
  if (res.headersSent) return next(err)

  const message = err.message || 'Request failed'
  const code = err.code
  const isClient =
    code === 'LIMIT_FILE_SIZE' ||
    /^Invalid (image|video) type\.|^Only images and videos|^Invalid JSON/i.test(message)

  if (isClient) {
    console.warn(`[${req.method} ${req.path}] ${message}`)
  } else {
    console.error(err)
  }

  if (code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File too large (max 50MB per file)' })
  }
  const status =
    typeof err.statusCode === 'number'
      ? err.statusCode
      : typeof err.status === 'number'
        ? err.status
        : isClient
          ? 400
          : 500
  return res.status(status >= 400 && status < 600 ? status : 400).json({ success: false, message })
})

// ── MongoDB Connection ──
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error("MONGO_URI is not defined");
}

const PORT = process.env.PORT || 5000

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully')
    if (process.env.NODE_ENV !== 'production') {
      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`)
      })
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message)
  })

export default app
