import mongoose from 'mongoose'

const inquirySchema = new mongoose.Schema({
  guestUserId: {
    type: String,
    default: '',
    trim: true
  },
  userId: {
    type: String,
    default: '',
    trim: true
  },
  inquiryId: {
    type: String,
    required: true,
    unique: true
  },
  orderGroupId: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  customerName: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  email: {
    type: String,
    default: '',
    trim: true
  },
  animalName: {
    type: String,
    required: true,
    trim: true
  },
  animalTag: {
    type: String,
    default: '',
    trim: true
  },
  animalId: {
    type: String,
    default: ''
  },
  breed: {
    type: String,
    default: '',
    trim: true
  },
  category: {
    type: String,
    default: '',
    trim: true
  },
  weight: {
    type: String,
    default: '',
    trim: true
  },
  price: {
    type: Number,
    required: true,
    default: 0
  },
  quantity: {
    type: Number,
    default: 1
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  deliveryAddress: {
    type: String,
    default: '',
    trim: true
  },
  city: {
    type: String,
    default: '',
    trim: true
  },
  deliveryDate: {
    type: String,
    default: ''
  },
  paymentMethod: {
    type: String,
    enum: ['cod', 'advance', 'full', 'whatsapp'],
    default: 'whatsapp'
  },
  orderSource: {
    type: String,
    enum: ['whatsapp', 'checkout', 'cart', 'direct'],
    default: 'whatsapp'
  },
  status: {
    type: String,
    enum: ['Pending', 'Contacted', 'Completed', 'Cancelled', 'Delivered', 'Shipped'],
    default: 'Pending'
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  animalCare: {
    type: Boolean,
    default: false
  },
  animalCarePrice: {
    type: Number,
    default: 0
  },
  advanceAmount: {
    type: Number,
    default: 0
  },
  remainingAmount: {
    type: Number,
    default: 0
  },
  butcher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Butcher',
    default: null
  },
  date: {
    type: Date,
    default: Date.now
  }
})

export default mongoose.model('Inquiry', inquirySchema)
