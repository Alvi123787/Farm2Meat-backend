// routes/meatItemRoutes.js

const express = require('express')
const router  = express.Router()
const {
  getAllItems,
  getBestsellers,
  getByCategory,
  getItemById,
  createItem,
  updateItem,
  toggleAvailability,
  toggleBestseller,
  deleteItem,
  reorderItems,
} = require('../controllers/meatItemController')

const { protect } = require('../middleware/authMiddleware')

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/meat-items                  — all items (filtered/paginated)
// GET /api/meat-items?category=mutton  — filter by category
// GET /api/meat-items?isBestseller=true
// GET /api/meat-items?isAvailable=true
// GET /api/meat-items?search=chops
// GET /api/meat-items?sort=price&page=1&limit=10
router.get('/', getAllItems)

// GET /api/meat-items/bestsellers      — bestsellers only (homepage section)
router.get('/bestsellers', getBestsellers)

// GET /api/meat-items/by-category      — grouped by category (menu page)
router.get('/by-category', getByCategory)

// PATCH /api/meat-items/reorder        — bulk sort order update (admin)
router.patch('/reorder', protect, reorderItems)

// GET /api/meat-items/:id              — single item
router.get('/:id', getItemById)

// ── Admin routes (protected) ──────────────────────────────────────────────────

// POST   /api/meat-items               — create new item
router.post('/', protect, createItem)

// PUT    /api/meat-items/:id           — full/partial update
router.put('/:id', protect, updateItem)

// PATCH  /api/meat-items/:id/toggle-availability
router.patch('/:id/toggle-availability', protect, toggleAvailability)

// PATCH  /api/meat-items/:id/toggle-bestseller
router.patch('/:id/toggle-bestseller', protect, toggleBestseller)

// DELETE /api/meat-items/:id           — delete item
router.delete('/:id', protect, deleteItem)

module.exports = router