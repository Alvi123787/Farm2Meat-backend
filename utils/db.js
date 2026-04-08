import mongoose from 'mongoose'

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  throw new Error('Please define the MONGO_URI environment variable inside .env')
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null }
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // Disable buffering to fail fast if connection is not ready
      serverSelectionTimeoutMS: 5000, // Fail fast if MongoDB is unreachable (5s)
    }

    console.log('🔄 Connecting to MongoDB...')
    cached.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
      console.log('✅ MongoDB connected successfully')
      return mongoose
    }).catch((err) => {
      console.error('❌ MongoDB connection failed:', err.message)
      cached.promise = null
      throw err
    })
  }

  try {
    cached.conn = await cached.promise
  } catch (e) {
    cached.promise = null
    throw e
  }

  return cached.conn
}

export default connectDB
