import mongoose from 'mongoose'

const butcherSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Butcher name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true
  },
  location: {
    type: String,
    default: 'Rahim Yar Khan',
    trim: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  image: {
    type: String,
    default: null
  },
  avatar: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

export default mongoose.model('Butcher', butcherSchema)
