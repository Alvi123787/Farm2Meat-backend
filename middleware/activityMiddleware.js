import User from '../models/User.js'
import GuestUser from '../models/GuestUser.js'
import mongoose from 'mongoose'

/**
 * Middleware to track last activity of logged-in and guest users.
 * To avoid excessive DB writes, we only update if the last update was more than 1 hour ago.
 */
export const activityMiddleware = async (req, res, next) => {
  try {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    // 1. Logged-in User
    if (req.user?.id) {
      // Check if ID is a valid MongoDB ObjectId (e.g. not "built-in-admin")
      if (mongoose.Types.ObjectId.isValid(req.user.id)) {
        await User.updateOne(
          { _id: req.user.id, lastActivity: { $lt: oneHourAgo } },
          { $set: { lastActivity: now } }
        )
      } else if (req.user.id === 'built-in-admin') {
        // Built-in admin is a virtual user, no DB update needed
        // We can skip or log if desired, but skip is safest for performance
      }
    } 
    // 2. Guest User (using sessionId)
    else if (req.guestUserId) {
      // We only update GuestUser if it already exists (i.e., they've purchased)
      await GuestUser.updateOne(
        { sessionId: req.guestUserId, lastActivity: { $lt: oneHourAgo } },
        { $set: { lastActivity: now } }
      )
    }
  } catch (error) {
    console.error('Activity tracking error:', error.message)
  }
  next()
}
