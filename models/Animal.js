import mongoose from 'mongoose'

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
    type: String,
    required: [true, 'Age is required'],
    trim: true
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
    type: String,
    default: '',
    trim: true
  },
  price: {
    type: String,
    required: [true, 'Price is required'],
    trim: true
  },
  discountPrice: {
    type: String,
    default: '',
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
  vaccinated: {
    type: Boolean,
    default: false
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

export default mongoose.model('Animal', animalSchema)
