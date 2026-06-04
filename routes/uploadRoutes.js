import express from 'express';
import upload from '../middleware/upload.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import cloudinary from '../config/cloudinary.js';

const router = express.Router();

// ── Helper: Upload Buffer to Cloudinary ──
const uploadToCloudinary = (fileBuffer, resourceType = 'auto', folder = 'general') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: resourceType,
        folder: folder,
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    uploadStream.end(fileBuffer);
  });
};

// Single Image Upload
router.post('/single', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'image', 'uploads');
    
    res.json({ 
      success: true, 
      url: result.secure_url,
      public_id: result.public_id 
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
});

// Multiple Images Upload (max 5)
router.post('/multiple', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }

    const uploadPromises = req.files.map(file => uploadToCloudinary(file.buffer, 'image', 'uploads'));
    const results = await Promise.all(uploadPromises);
    
    res.json({ 
      success: true, 
      urls: results.map(r => r.secure_url),
      files: results.map(r => ({ url: r.secure_url, public_id: r.public_id }))
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ success: false, message: 'Failed to upload images' });
  }
});

export default router;
