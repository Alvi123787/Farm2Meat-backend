import express from 'express';
import { createCustomOrder, uploadFields } from '../controller/CustomOrderController.js';

const router = express.Router();

router.post('/', uploadFields, createCustomOrder);

export default router;
