import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

// Fix __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Routes
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

// Middleware
import { guestSessionMiddleware } from './middleware/guestSessionMiddleware.js'
import { optionalAuthMiddleware } from './middleware/authMiddleware.js'
import { activityMiddleware } from './middleware/activityMiddleware.js'

// Load env (only for local)
dotenv.config()

const app = express()

// ─────────────────────────────────────────────
// ✅ CORS FIX
// ─────────────────────────────────────────────
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}))

// ─────────────────────────────────────────────
// ✅ Body Parsers
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// ✅ Custom Middleware
// ─────────────────────────────────────────────
app.use(guestSessionMiddleware)
app.use(optionalAuthMiddleware)
app.use(activityMiddleware)

// ─────────────────────────────────────────────
// ⚠️ Upload folders (safe on Vercel but ephemeral)
// ─────────────────────────────────────────────
const uploadDirs = ['uploads/images', 'uploads/videos', 'uploads/butchers']

uploadDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir)
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
    console.log(`📁 Created directory: ${dir}`)
  }
})

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// ─────────────────────────────────────────────
// ✅ Routes
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// ✅ Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (!err) return next()
  if (res.headersSent) return next(err)

  console.error("❌ ERROR:", err)

  const message = err.message || 'Server Error'
  const status =
    typeof err.statusCode === 'number'
      ? err.statusCode
      : typeof err.status === 'number'
        ? err.status
        : 500

  return res.status(status).json({
    success: false,
    message
  })
})

// ─────────────────────────────────────────────
// ✅ MongoDB Connection (Vercel FIX)
// ─────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  throw new Error("❌ MONGO_URI is not defined")
}

console.log("ENV CHECK:", MONGO_URI)

// Cache connection (important for serverless)
let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null }
}

async function connectDB() {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGO_URI).then((mongoose) => {
      console.log("✅ MongoDB connected")
      return mongoose
    })
  }

  cached.conn = await cached.promise
  return cached.conn
}

// Connect DB per request
app.use(async (req, res, next) => {
  await connectDB()
  next()
})

// ─────────────────────────────────────────────
// ❌ REMOVE app.listen (Vercel handles this)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// ✅ Export for Vercel
// ─────────────────────────────────────────────
export default app