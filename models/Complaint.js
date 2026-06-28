import mongoose from 'mongoose'

const complaintSchema = new mongoose.Schema({
  complaintId: {
    type: String,
    required: true,
    unique: true
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
  orderNumber: {
    type: String,
    default: '',
    trim: true
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true
  },
  complaint: {
    type: String,
    required: [true, 'Complaint description is required'],
    trim: true
  },
  status: {
    type: String,
    enum: ['Pending', 'In Review', 'Resolved', 'Closed'],
    default: 'Pending'
  },
  date: {
    type: Date,
    default: Date.now
  }
})

export default mongoose.model('Complaint', complaintSchema)
