import mongoose from 'mongoose'

const guestUserSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  phone: { type: String, trim: true, index: true },
  deliveryAddress: { type: String, trim: true },
  city: { type: String, trim: true },
  lastOrderId: { type: String, trim: true },
  orderCount: { type: Number, default: 1 },
  totalSpent: { type: Number, default: 0 },
  sessionId: { type: String, default: '', trim: true },
  lastActivity: { type: Date, default: Date.now },
  isSubscribed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true })

// Index for search
guestUserSchema.index({ name: 'text', email: 'text', phone: 'text' })

export default mongoose.model('GuestUser', guestUserSchema)
