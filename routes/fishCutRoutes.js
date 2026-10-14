import express from 'express'
import FishCut from '../models/FishCut.js'

const router = express.Router()

const DEFAULT_CUTS = [
  'Slices / Steaks',
  'Boneless Cubes',
  'Finger Fish',
  'Whole Cleaned',
  'Fillet',
  'Curry Cut (With Bone)'
]

// GET /api/fish-cuts - Get all cuts
router.get('/', async (req, res) => {
  try {
    let cuts = await FishCut.find({ isActive: true }).sort({ usageCount: -1, name: 1 }).lean()

    // Seed defaults if collection is empty
    if (!cuts || cuts.length === 0) {
      const seedDocs = DEFAULT_CUTS.map(name => ({
        name,
        isCustom: false,
        usageCount: 1,
        isActive: true
      }))
      await FishCut.insertMany(seedDocs)
      cuts = await FishCut.find({ isActive: true }).sort({ usageCount: -1, name: 1 }).lean()
    }

    res.json({ success: true, cuts })
  } catch (err) {
    console.error('Error fetching fish cuts:', err)
    res.status(500).json({ success: false, message: 'Failed to fetch fish cuts' })
  }
})

// POST /api/fish-cuts - Add or increment cut
router.post('/', async (req, res) => {
  try {
    const { name, isCustom } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Cut name is required' })
    }

    const trimmedName = name.trim()

    // Check if exists (case-insensitive)
    let cut = await FishCut.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } })

    if (cut) {
      cut.usageCount += 1
      if (!cut.isActive) cut.isActive = true
      await cut.save()
      return res.json({ success: true, cut, message: 'Cut updated' })
    }

    cut = await FishCut.create({
      name: trimmedName,
      isCustom: Boolean(isCustom),
      usageCount: 1,
      isActive: true
    })

    res.status(201).json({ success: true, cut, message: 'Cut created' })
  } catch (err) {
    console.error('Error creating fish cut:', err)
    res.status(500).json({ success: false, message: 'Failed to save fish cut' })
  }
})

export default router
