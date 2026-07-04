import CustomOrder from '../models/CustomOrder.js';
import cloudinary from '../config/cloudinary.js';
import { sendEmail } from '../utils/mailer.js';
import multer from 'multer';

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'voice') {
      const allowedTypes = ['audio/webm', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/mp4'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid voice format. Only webm, mp3, wav, and m4a are allowed.'), false);
      }
    } else if (file.fieldname === 'images') {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid image format. Only jpg, jpeg, png, and webp are allowed.'), false);
      }
    } else {
      cb(new Error('Unsupported field name.'), false);
    }
  }
});

const uploadFields = upload.fields([
  { name: 'voice', maxCount: 1 },
  { name: 'images', maxCount: 5 }
]);

const uploadToCloudinary = async (buffer, folder, resourceType = 'auto') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result.secure_url);
        }
      }
    );
    uploadStream.end(buffer);
  });
};

const createCustomOrder = async (req, res) => {
  try {
    const { title, description, unit, quantity, additionalNotes } = req.body;

    if (!title || !unit || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Title, unit, and quantity are required.'
      });
    }

    if (!description && !req.files?.voice) {
      return res.status(400).json({
        success: false,
        message: 'Either description or voice recording is required.'
      });
    }

    if (parseFloat(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than zero.'
      });
    }

    if (!['kg', 'piece'].includes(unit)) {
      return res.status(400).json({
        success: false,
        message: 'Unit must be either kg or piece.'
      });
    }

    let voiceUrl = null;
    let images = [];

    if (req.files?.voice && req.files.voice.length > 0) {
      voiceUrl = await uploadToCloudinary(
        req.files.voice[0].buffer,
        'meatbyalvi/custom-orders/voices',
        'video'
      );
    }

    if (req.files?.images && req.files.images.length > 0) {
      const imagePromises = req.files.images.map(file =>
        uploadToCloudinary(
          file.buffer,
          'meatbyalvi/custom-orders/images',
          'image'
        )
      );
      images = await Promise.all(imagePromises);
    }

    const customOrder = new CustomOrder({
      title,
      description,
      unit,
      quantity: parseFloat(quantity),
      voiceUrl,
      images,
      additionalNotes
    });

    const savedOrder = await customOrder.save();

    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        const emailHtml = `
          <h2>New Custom Order Received</h2>
          <p><strong>Product Title:</strong> ${title}</p>
          <p><strong>Description:</strong> ${description || 'Not provided'}</p>
          <p><strong>Unit:</strong> ${unit}</p>
          <p><strong>Quantity:</strong> ${quantity}</p>
          <p><strong>Additional Notes:</strong> ${additionalNotes || 'Not provided'}</p>
          <p><strong>Created Date:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Status:</strong> ${savedOrder.status}</p>
          ${voiceUrl ? `<p><strong>Voice Recording:</strong> <a href="${voiceUrl}" target="_blank">${voiceUrl}</a></p>` : ''}
          ${images.length > 0 ? `
            <p><strong>Uploaded Images:</strong></p>
            <ul>
              ${images.map(img => `<li><a href="${img}" target="_blank">${img}</a></li>`).join('')}
            </ul>
          ` : ''}
        `;

        await sendEmail({
          to: adminEmail,
          subject: 'New Custom Order Received',
          html: emailHtml
        });
      }
    } catch (emailErr) {
      console.error('Failed to send email notification:', emailErr);
    }

    res.status(201).json({
      success: true,
      message: 'Custom order submitted successfully.',
      data: {
        id: savedOrder._id,
        title: savedOrder.title,
        quantity: savedOrder.quantity,
        unit: savedOrder.unit,
        voiceUrl: savedOrder.voiceUrl,
        images: savedOrder.images,
        status: savedOrder.status
      }
    });
  } catch (error) {
    console.error('Error creating custom order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create custom order. Please try again later.'
    });
  }
};

export { createCustomOrder, uploadFields };
