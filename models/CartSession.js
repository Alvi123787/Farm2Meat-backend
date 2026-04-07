import mongoose from 'mongoose'

const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, default: '', trim: true },
    itemType: { type: String, default: 'livestock', trim: true },
    purchaseMode: { type: String, default: 'single', trim: true }
  },
  { _id: false }
)

const cartSessionSchema = new mongoose.Schema(
  {
    guestUserId: { type: String, default: '', trim: true, index: true },
    userId: { type: String, default: '', trim: true, index: true },
    userEmail: { type: String, default: '', trim: true },
    items: { type: [itemSchema], default: [] },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
)

cartSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('CartSession', cartSessionSchema)

