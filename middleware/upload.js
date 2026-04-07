import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let resource_type = 'auto';
    let folder = 'general';

    if (file.mimetype.startsWith('image/')) {
      folder = 'images';
      resource_type = 'image';
    } else if (file.mimetype.startsWith('video/')) {
      folder = 'videos';
      resource_type = 'video';
    }

    return {
      folder: folder,
      resource_type: resource_type,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'mp4', 'webm', 'mov'],
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  },
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max file size
  }
});

export default upload;
