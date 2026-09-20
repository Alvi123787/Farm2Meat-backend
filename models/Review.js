import mongoose from 'mongoose'

const reviewSchema = new mongoose.Schema({
  // Authenticated user's MongoDB ID
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  // Reviewed product ID (can be MeatItem or Animal)
  product: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'productModel',
    default: null,
    index: true
  },
  productModel: {
    type: String,
    enum: ['MeatItem', 'Animal'],
    default: 'MeatItem'
  },
  productName: {
    type: String,
    default: '',
    trim: true
  },
  // Eligible delivered order (Inquiry document ID)
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inquiry',
    default: null,
    index: true
  },
  /** Checkout / order group id from Inquiry bulk (e.g. ORD-xxx or INQ-xxx) */
  orderId: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  // Rating: 1 to 5
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5']
  },
  // Review text
  comment: {
    type: String,
    required: [true, 'Review comment is required'],
    trim: true,
    maxlength: [1000, 'Comment cannot exceed 1000 characters']
  },
  // Verified Purchase: assigned by backend only
  isVerifiedPurchase: {
    type: Boolean,
    default: false,
    index: true
  },

  // ── Backward-compatibility fields ──
  name: {
    type: String,
    default: '',
    trim: true
  },
  text: {
    type: String,
    default: '',
    trim: true
  },
  location: {
    type: String,
    default: '',
    trim: true
  },
  userId: {
    type: String,
    default: '',
    trim: true
  },
  email: {
    type: String,
    default: '',
    trim: true
  },
  selectedEmoji: {
    type: Number,
    min: 1,
    max: 5
  },
  reviewSource: {
    type: String,
    enum: ['verified_order', 'manual', 'emoji_post_order'],
    default: 'verified_order'
  },
  hidden: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
})

// Synchronize comment and text before saving
reviewSchema.pre('save', function () {
  if (this.comment && !this.text) {
    this.text = this.comment
  } else if (this.text && !this.comment) {
    this.comment = this.text
  }
})

// Database constraint: A customer cannot review the same product multiple times from the same order
reviewSchema.index(
  { order: 1, product: 1 },
  { unique: true, partialFilterExpression: { order: { $type: 'objectId' }, product: { $type: 'objectId' } } }
)

// Fast lookups for product reviews with filtering
reviewSchema.index({ product: 1, hidden: 1, isVerifiedPurchase: 1, createdAt: -1 })

export default mongoose.models.Review || mongoose.model('Review', reviewSchema)

