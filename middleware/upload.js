import multer from 'multer';

const storage = multer.memoryStorage();

const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      const allowedImages = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedImages.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid image format. Only JPG, PNG, and WebP are allowed.'), false);
      }
    } else if (file.mimetype.startsWith('video/')) {
      if (file.mimetype === 'video/mp4') {
        cb(null, true);
      } else {
        cb(new Error('Invalid video format. Only MP4 is allowed.'), false);
      }
    } else {
      cb(new Error('Unsupported file type.'), false);
    }
  }
});

export default upload;
