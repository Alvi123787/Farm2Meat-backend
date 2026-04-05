import mongoose from 'mongoose'

const guestUserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  sessionId: { type: String, default: '', trim: true },
  lastActivity: { type: Date, default: Date.now },
  lastReengagementEmailSent: { type: Date, default: null },
  isSubscribed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('GuestUser', guestUserSchema)
