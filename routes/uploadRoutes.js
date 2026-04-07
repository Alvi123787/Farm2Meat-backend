import express from 'express';
import upload from '../middleware/upload.js';
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Single Image Upload
router.post('/single', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }
  res.json({ 
    success: true, 
    url: req.file.path,
    public_id: req.file.filename 
  });
});

// Multiple Images Upload (max 5)
router.post('/multiple', authMiddleware, upload.array('images', 5), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }
  const urls = req.files.map(file => file.path);
  res.json({ 
    success: true, 
    urls,
    files: req.files.map(f => ({ url: f.path, public_id: f.filename }))
  });
});

export default router;
