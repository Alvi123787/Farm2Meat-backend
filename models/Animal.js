import mongoose from 'mongoose'
import slugify from 'slugify'

const animalSchema = new mongoose.Schema({

  // ── Basic Information ──
  name: {
    type: String,
    required: [true, 'Animal name is required'],
    trim: true
  },
  type: {
    type: String,
    enum: ['animal', 'meat'],
    default: 'animal'
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['Bakra', 'Patth', 'Bakri'],
  },
  breed: {
    type: String,
    required: [true, 'Breed is required'],
    trim: true
  },
  gender: {
    type: String,
    enum: ['male', 'female'],
    default: 'male'
  },
  age: {
    type: Number,
    required: [true, 'Age is required']
  },
  ageUnit: {
    type: String,
    enum: ['months', 'years'],
    default: 'months'
  },
  weight: {
    type: String,
    required: [true, 'Weight is required'],
    trim: true
  },

  // ── Pricing & Status ──
  purchasePrice: {
    type: Number,
    default: 0
  },
  price: {
    type: Number,
    required: [true, 'Price is required']
  },
  discountPrice: {
    type: Number,
    default: 0
  },
  // ── Meat Integration ──
  isForMeat: {
    type: Boolean,
    default: false
  },
  slaughterWeight: {
    type: Number,
    default: 0
  },
  meatYieldEstimate: {
    type: String,
    default: '',
    trim: true
  },
  // ── SEO ──
  slug: {
    type: String,
    unique: true,
    lowercase: true,
    trim: true
  },
  seoTitle: {
    type: String,
    trim: true
  },
  seoDescription: {
    type: String,
    trim: true
  },
  listingType: {
    type: String,
    enum: ['normal', 'featured'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['available', 'sold', 'reserved', 'new'],
    default: 'available'
  },
  visibility: {
    type: Boolean,
    default: true
  },

  // ── Physical Details ──
  color: {
    type: String,
    default: '',
    trim: true
  },
  teeth: {
    type: Number,
    default: null
  },
  healthStatus: {
    type: String,
    enum: ['excellent', 'good', 'average'],
    default: 'good'
  },
  farmLocation: {
    type: String,
    required: [true, 'Farm location is required'],
    trim: true
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },

  // ── Media ──
  images: {
    type: [String],
    default: []
  },
  videos: {
    type: [String],
    default: []
  },

  // Backward compatible single image field
  imageUrl: {
    type: String,
    default: ''
  },

  // ── Description & Extras ──
  shortDescription: {
    type: String,
    default: '',
    trim: true
  },
  fullDescription: {
    type: String,
    default: '',
    trim: true
  },
  specialNotes: {
    type: String,
    default: '',
    trim: true
  },
  deliveryAvailable: {
    type: Boolean,
    default: false
  },
  negotiable: {
    type: Boolean,
    default: false
  },

  // ── Auto-generated ──
  whatsappMsg: {
    type: String,
    default: '',
    trim: true
  },

  // Keep old field for backward compatibility
  oldPrice: {
    type: String,
    default: '',
    trim: true
  },
  location: {
    type: String,
    default: '',
    trim: true
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
})

// ── Middlewares ──

// Auto-generate slug before save
animalSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true })
  }
  next()
})

export default mongoose.model('Animal', animalSchema)
