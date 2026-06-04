// models/MeatItem.js

const mongoose = require('mongoose')

const meatItemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      enum: {
        values: ['mutton', 'beef', 'chicken', 'fish'],
        message: 'Category must be one of: mutton, beef, chicken, fish',
      },
      lowercase: true,
    },
    badge: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [1, 'Price must be at least 1'],
    },
    unit: {
      type: String,
      enum: ['kg', '500g', 'piece'],
      default: 'kg',
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [120, 'Description cannot exceed 120 characters'],
    },
    imageUrl: {
      type: String,
      default: '',
    },
    isBestseller: {
      type: Boolean,
      default: false,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // Sort order for manual reordering (lower = first)
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// ── Indexes ──────────────────────────────────────
meatItemSchema.index({ category: 1, sortOrder: 1 })
meatItemSchema.index({ isBestseller: 1 })
meatItemSchema.index({ isAvailable: 1 })
meatItemSchema.index({ name: 'text', description: 'text' }) // full-text search

// ── Virtual: formatted price ──────────────────────
meatItemSchema.virtual('formattedPrice').get(function () {
  return `Rs. ${this.price.toLocaleString('en-PK')}`
})

// ── Virtual: price label (Rs. 850 /kg) ───────────
meatItemSchema.virtual('priceLabel').get(function () {
  const unitMap = { kg: '/kg', '500g': '/500g', piece: '/piece' }
  return `Rs. ${this.price.toLocaleString('en-PK')} ${unitMap[this.unit] || '/kg'}`
})

const MeatItem = mongoose.model('MeatItem', meatItemSchema)

module.exports = MeatItem