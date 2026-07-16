import mongoose from 'mongoose';

const CustomOrderSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required']
  },
  description: {
    type: String
  },
  unit: {
    type: String,
    required: [true, 'Unit is required'],
    enum: {
      values: ['kg', 'piece'],
      message: 'Unit must be either kg or piece'
    }
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0.01, 'Quantity must be greater than zero']
  },
  voiceUrl: {
    type: String
  },
  images: [{
    type: String
  }],
  additionalNotes: {
    type: String
  },
  inquiryId: {
    type: String
  },
  // Customer Information
  fullName: {
    type: String,
    required: [true, 'Full name is required']
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required']
  },
  whatsappNumber: {
    type: String
  },
  email: {
    type: String
  },
  // Delivery Address
  address: {
    houseNoStreet: {
      type: String,
      required: [true, 'House no./street is required']
    },
    areaColony: {
      type: String,
      required: [true, 'Area/colony is required']
    },
    city: {
      type: String,
      default: 'Rahim Yar Khan'
    }
  },
  // Delivery Preferences
  preferredDeliveryDate: {
    type: Date
  },
  preferredDeliveryTime: {
    type: String
  },
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Completed', 'Cancelled', 'Refunded'],
    default: 'Pending'
  }
}, {
  timestamps: true
});

export default mongoose.model('CustomOrder', CustomOrderSchema);
