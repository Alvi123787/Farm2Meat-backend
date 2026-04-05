import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true },
  title: { type: String, default: '', trim: true },
  message: { type: String, default: '', trim: true },
  entityType: { type: String, default: '', trim: true },
  entityId: { type: String, default: '', trim: true },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model('Notification', notificationSchema)
