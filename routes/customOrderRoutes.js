import express from 'express';
import { createCustomOrder, uploadFields, getCustomOrders, getCustomOrderById } from '../controller/CustomOrderController.js';
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', uploadFields, createCustomOrder);

// Admin routes
router.get('/all', authMiddleware, adminMiddleware, getCustomOrders);
router.get('/:id', authMiddleware, adminMiddleware, getCustomOrderById);

export default router;
