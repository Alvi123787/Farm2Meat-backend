import connectDB from '../utils/db.js'

/**
 * Middleware to ensure MongoDB is connected before proceeding to the route.
 * Essential for serverless environments (Vercel) to avoid "buffering timed out" errors.
 */
export const dbMiddleware = async (req, res, next) => {
  try {
    await connectDB()
    next()
  } catch (error) {
    console.error('❌ Database connection middleware error:', error.message)
    res.status(503).json({
      success: false,
      message: 'Service Temporarily Unavailable: Database connection failed.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
