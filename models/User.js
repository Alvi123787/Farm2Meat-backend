import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  fullName: { type: String, trim: true },
  phone: { type: String, trim: true },
  city: { type: String, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  resetTokenHash: { type: String, default: '', index: true },
  resetTokenExpiresAt: { type: Date, default: null },
  passwordResetLastSentAt: { type: Date, default: null },
  isVerified: { type: Boolean, default: false },
  verificationTokenHash: { type: String, default: '', index: true },
  verificationTokenExpiresAt: { type: Date, default: null },
  verificationEmailLastSentAt: { type: Date, default: null },
  lastActivity: { type: Date, default: Date.now },
  isSubscribed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('User', userSchema)
