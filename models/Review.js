import mongoose from 'mongoose'

const reviewSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  location: { type: String, default: '', trim: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, default: '', trim: true },
  /** Checkout / order group id from Inquiry bulk (e.g. ORD-xxx) */
  orderId: { type: String, default: '', trim: true },
  userId: { type: String, default: '', trim: true },
  email: { type: String, default: '', trim: true },
  selectedEmoji: { type: Number, min: 1, max: 5 },
  reviewSource: {
    type: String,
    enum: ['manual', 'emoji_post_order'],
    default: 'manual'
  },
  createdAt: { type: Date, default: Date.now }
})

reviewSchema.index(
  { orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: 'string', $ne: '' } } }
)

export default mongoose.model('Review', reviewSchema)
