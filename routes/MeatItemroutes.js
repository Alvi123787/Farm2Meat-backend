// routes/meatItemRoutes.js

import express from 'express'
const router  = express.Router()
import {
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
} from '../controller/Meatitemcontroller.js'

import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js'

// ── Public routes ─────────────────────────────────────────────────────────────

// GET /api/meat-items                  — all items (filtered/paginated)
router.get('/', getAllItems)

// GET /api/meat-items/bestsellers      — bestsellers only (homepage section)
router.get('/bestsellers', getBestsellers)

// GET /api/meat-items/by-category      — grouped by category (menu page)
router.get('/by-category', getByCategory)

// GET /api/meat-items/:id              — single item
router.get('/:id', getItemById)

// ── Admin routes (protected) ──────────────────────────────────────────────────

// PATCH /api/meat-items/reorder        — bulk sort order update (admin)
router.patch('/reorder', authMiddleware, adminMiddleware, reorderItems)

// POST   /api/meat-items               — create new item
router.post('/', authMiddleware, adminMiddleware, createItem)

// PUT    /api/meat-items/:id           — full/partial update
router.put('/:id', authMiddleware, adminMiddleware, updateItem)

// PATCH  /api/meat-items/:id/toggle-availability
router.patch('/:id/toggle-availability', authMiddleware, adminMiddleware, toggleAvailability)

// PATCH  /api/meat-items/:id/toggle-bestseller
router.patch('/:id/toggle-bestseller', authMiddleware, adminMiddleware, toggleBestseller)

// DELETE /api/meat-items/:id           — delete item
router.delete('/:id', authMiddleware, adminMiddleware, deleteItem)

export default router
