import mongoose from 'mongoose'

const fishCutSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Cut name is required'],
      unique: true,
      trim: true,
    },
    isCustom: {
      type: Boolean,
      default: false,
    },
    usageCount: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
)

const FishCut = mongoose.models.FishCut || mongoose.model('FishCut', fishCutSchema)

export default FishCut
