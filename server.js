import express from 'express'
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
import { dbMiddleware } from './middleware/dbMiddleware.js'

dotenv.config()

if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not defined.')
  process.exit(1)
}

const app = express()

// ── Middleware ──
const allowedOrigins = [
  'http://localhost:5173', 
  'https://farm2meat.netlify.app', 
  'https://your-site.netlify.app'
]

// Add custom origins from env
if (process.env.FRONTEND_ORIGIN) {
  process.env.FRONTEND_ORIGIN.split(',').forEach(o => {
    const origin = o.trim().replace(/\/$/, '')
    if (origin && !allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin)
    }
  })
}

app.use(cors({ 
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`))
    }
  },
  credentials: true 
}))

const jsonParser = express.json({ limit: '50mb' })
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
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ── Root Route (Health Check) ──
app.get('/', (req, res) => {
  res.json({ success: true, message: 'Farm2Meat API is running 🚀' })
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
app.use('/api/analytics', analyticsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/search', searchRoutes)
app.use('/api/reviews', reviewRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/butchers', butcherRoutes)
app.use('/api/upload', uploadRoutes)

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

// ── Server Start (Development Only) ──
const PORT = process.env.PORT || 5000

if (process.env.NODE_ENV !== 'production') {
  import('./utils/db.js').then(({ default: connectDB }) => {
    connectDB().then(() => {
      app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`)
      })
    })
  })
}

export default app
