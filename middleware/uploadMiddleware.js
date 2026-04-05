import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let sub = 'images'
    if (file.mimetype.startsWith('image/')) {
      sub = 'images'
    } else if (file.mimetype.startsWith('video/')) {
      sub = 'videos'
    }

    const fullPath = path.join(__dirname, '..', 'uploads', sub)
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true })
    }
    cb(null, fullPath)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
})

// File filter
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
  const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime']
  
  if (file.mimetype.startsWith('image/')) {
    if (allowedImageTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid image type. Only JPEG, PNG, WebP, and GIF are allowed.'), false)
    }
  } else if (file.mimetype.startsWith('video/')) {
    if (allowedVideoTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Invalid video type. Only MP4, WebM, QuickTime are allowed.'), false)
    }
  } else {
    cb(new Error('Only images and videos are allowed.'), false)
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max total file size
  }
})

export default upload
