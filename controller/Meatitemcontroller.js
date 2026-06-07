// controllers/meatItemController.js

import MeatItem from '../models/MeatItem.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wraps async route handlers so we don't repeat try/catch everywhere.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)

/**
 * Sends a consistent success response.
 */
const sendSuccess = (res, data, statusCode = 200, meta = {}) => {
  res.status(statusCode).json({ success: true, ...meta, data })
}

/**
 * Builds a MongoDB query filter from req.query params.
 */
const buildFilter = (query) => {
  const filter = {}

  if (query.category && query.category !== 'all') {
    filter.category = query.category.toLowerCase()
  }

  if (query.isBestseller !== undefined) {
    filter.isBestseller = query.isBestseller === 'true'
  }

  if (query.isAvailable !== undefined) {
    filter.isAvailable = query.isAvailable === 'true'
  }

  if (query.showInHeader !== undefined) {
    filter.showInHeader = query.showInHeader === 'true'
  }

  if (query.search) {
    filter.$text = { $search: query.search }
  }

  return filter
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * @desc    Get all meat items (with filtering, sorting, pagination)
 * @route   GET /api/meat-items
 * @access  Public
 */
export const getAllItems = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query)

  const page  = Math.max(1, parseInt(req.query.page)  || 1)
  const limit = Math.min(100, parseInt(req.query.limit) || 20)
  const skip  = (page - 1) * limit

  const sortMap = {
    sortOrder:   { sortOrder: 1 },
    '-sortOrder':{ sortOrder: -1 },
    price:       { price: 1 },
    '-price':    { price: -1 },
    newest:      { createdAt: -1 },
    oldest:      { createdAt: 1 },
  }
  const sort = sortMap[req.query.sort] || { sortOrder: 1, createdAt: -1 }

  const [items, total] = await Promise.all([
    MeatItem.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    MeatItem.countDocuments(filter),
  ])

  sendSuccess(res, items, 200, {
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
})

/**
 * @desc    Get bestseller items only
 * @route   GET /api/meat-items/bestsellers
 * @access  Public
 */
export const getBestsellers = asyncHandler(async (req, res) => {
  const limit = Math.min(20, parseInt(req.query.limit) || 6)

  const items = await MeatItem.find({ isBestseller: true, isAvailable: true })
    .sort({ sortOrder: 1, createdAt: -1 })
    .limit(limit)
    .lean()

  sendSuccess(res, items)
})

/**
 * @desc    Get items grouped by category (for the full menu page)
 * @route   GET /api/meat-items/by-category
 * @access  Public
 */
export const getByCategory = asyncHandler(async (req, res) => {
  const onlyAvailable = req.query.isAvailable !== 'false'

  const filter = onlyAvailable ? { isAvailable: true } : {}

  const items = await MeatItem.find(filter)
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean()

  // Group into { mutton: [...], beef: [...], ... }
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {})

  // Preserve category display order
  const ordered = {}
  for (const cat of ['mutton', 'beef', 'chicken', 'fish']) {
    if (grouped[cat]) ordered[cat] = grouped[cat]
  }

  sendSuccess(res, ordered)
})

/**
 * @desc    Get single meat item by ID
 * @route   GET /api/meat-items/:id
 * @access  Public
 */
export const getItemById = asyncHandler(async (req, res) => {
  const item = await MeatItem.findById(req.params.id).lean()

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' })
  }

  sendSuccess(res, item)
})

/**
 * @desc    Create a new meat item
 * @route   POST /api/meat-items
 * @access  Admin
 */
export const createItem = asyncHandler(async (req, res) => {
  console.log('📦 Create Meat Item request received:', req.body)

  const {
    name, category, badge, price, unit,
    description, imageUrl, isBestseller, isAvailable, showInHeader, sortOrder,
    stock, expirationDate,
  } = req.body

  if (!MeatItem) {
    console.error('❌ MeatItem model is undefined in controller!')
    throw new Error('Server configuration error: MeatItem model not found')
  }

  try {
    const itemData = {
      name,
      category,
      badge,
      price: Number(price),
      unit,
      description,
      imageUrl,
      isBestseller: isBestseller === true || isBestseller === 'true',
      isAvailable:  isAvailable  === undefined ? true : (isAvailable === true || isAvailable === 'true'),
      showInHeader: showInHeader === true || showInHeader === 'true',
      sortOrder:    Number(sortOrder) || 0,
      stock:        Number(stock) || 0,
      expirationDate: expirationDate || null,
      type:         'meat', // Always set to meat
    }

    console.log('🛠️ Attempting to create MeatItem with data:', itemData)
    const item = await MeatItem.create(itemData)
    console.log('✅ MeatItem created successfully:', item._id)

    sendSuccess(res, item, 201)
  } catch (error) {
    console.error('❌ Error in MeatItem.create:', error)
    throw error // Re-throw to be caught by asyncHandler and global error handler
  }
})

/**
 * @desc    Update a meat item (full or partial)
 * @route   PUT /api/meat-items/:id
 * @access  Admin
 */
export const updateItem = asyncHandler(async (req, res) => {
  const allowed = [
    'name', 'category', 'badge', 'price', 'unit',
    'description', 'imageUrl', 'isBestseller', 'isAvailable', 'showInHeader', 'sortOrder',
    'stock', 'expirationDate',
  ]

  // Only pick allowed fields from the body
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  if (updates.price !== undefined) updates.price = Number(updates.price)
  if (updates.sortOrder !== undefined) updates.sortOrder = Number(updates.sortOrder)
  if (updates.stock !== undefined) updates.stock = Number(updates.stock)

  const item = await MeatItem.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean()

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' })
  }

  sendSuccess(res, item)
})

/**
 * @desc    Toggle availability of an item
 * @route   PATCH /api/meat-items/:id/toggle-availability
 * @access  Admin
 */
export const toggleAvailability = asyncHandler(async (req, res) => {
  const item = await MeatItem.findById(req.params.id)

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' })
  }

  item.isAvailable = !item.isAvailable
  await item.save()

  sendSuccess(res, { id: item._id, isAvailable: item.isAvailable })
})

/**
 * @desc    Toggle bestseller status of an item
 * @route   PATCH /api/meat-items/:id/toggle-bestseller
 * @access  Admin
 */
export const toggleBestseller = asyncHandler(async (req, res) => {
  const item = await MeatItem.findById(req.params.id)

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' })
  }

  item.isBestseller = !item.isBestseller
  await item.save()

  sendSuccess(res, { id: item._id, isBestseller: item.isBestseller })
})

/**
 * @desc    Delete a meat item
 * @route   DELETE /api/meat-items/:id
 * @access  Admin
 */
export const deleteItem = asyncHandler(async (req, res) => {
  const item = await MeatItem.findByIdAndDelete(req.params.id).lean()

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' })
  }

  sendSuccess(res, { id: item._id, deleted: true })
})

/**
 * @desc    Bulk update sort order (drag-to-reorder)
 * @route   PATCH /api/meat-items/reorder
 * @access  Admin
 */
export const reorderItems = asyncHandler(async (req, res) => {
  const { items } = req.body

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'items array is required' })
  }

  const bulkOps = items.map(({ id, sortOrder }) => ({
    updateOne: {
      filter: { _id: id },
      update: { $set: { sortOrder: Number(sortOrder) } },
    },
  }))

  await MeatItem.bulkWrite(bulkOps)

  sendSuccess(res, { updated: items.length })
})
