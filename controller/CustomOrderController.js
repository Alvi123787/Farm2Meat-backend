import CustomOrder from '../models/CustomOrder.js';
import Inquiry from '../models/Inquiry.js';
import Notification from '../models/Notification.js';
import cloudinary from '../config/cloudinary.js';
import { sendEmail } from '../utils/mailer.js';
import multer from 'multer';

// Helper functions (copied from inquiryRoutes)
const generateInquiryId = () => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return `INQ-${timestamp}${random}`;
};

const normalize = (v) => String(v || '').trim().toLowerCase();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'voice') {
      // Accept more audio types for wider browser compatibility
      const allowedTypes = [
        'audio/webm',
        'audio/webm;codecs=opus',
        'audio/ogg',
        'audio/ogg;codecs=opus',
        'audio/mp3',
        'audio/mpeg', // mp3
        'audio/wav',
        'audio/wave',
        'audio/x-wav',
        'audio/m4a',
        'audio/mp4'
      ];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        // Still accept even if we don't recognize exact mime type as long as it's audio
        if (file.mimetype.startsWith('audio/')) {
          cb(null, true);
        } else {
          cb(new Error('Invalid voice format. Please upload an audio file.'), false);
        }
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
    const {
      title, description, unit, quantity, additionalNotes,
      fullName, phoneNumber, whatsappNumber, email,
      houseNoStreet, areaColony, city,
      preferredDeliveryDate, preferredDeliveryTime
    } = req.body;

    // Validate required fields
    if (!title || !unit || !quantity || !fullName || !phoneNumber || !houseNoStreet || !areaColony) {
      return res.status(400).json({
        success: false,
        message: 'Title, unit, quantity, full name, phone number, house no./street, and area/colony are required.'
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
      additionalNotes,
      fullName,
      phoneNumber,
      whatsappNumber,
      email,
      address: {
        houseNoStreet,
        areaColony,
        city: city || 'Rahim Yar Khan'
      },
      preferredDeliveryDate: preferredDeliveryDate ? new Date(preferredDeliveryDate) : undefined,
      preferredDeliveryTime
    });

    const savedOrder = await customOrder.save();

    // Create an Inquiry for this custom order
    const nameParts = fullName.trim().split(' ');
    const avatar = nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[1][0]).toUpperCase()
      : fullName.slice(0, 2).toUpperCase();

    const inquiry = new Inquiry({
      guestUserId: req.guestUserId || '',
      userId: req.user?.id || '',
      userType: req.user?.id ? 'registered' : 'guest',
      inquiryId: generateInquiryId(),
      customerName: fullName,
      phone: phoneNumber,
      email: email || '',
      animalName: title, // Use custom order title as "animalName"
      animalId: savedOrder._id, // Link inquiry to custom order ID
      itemType: 'meat', // Default custom order to "meat" type
      category: 'Custom Order',
      unit: unit,
      price: 0, // Custom order price to be determined later
      quantity: parseFloat(quantity),
      totalAmount: 0,
      deliveryAddress: `${houseNoStreet}, ${areaColony}`,
      city: city || 'Rahim Yar Khan',
      deliveryDate: preferredDeliveryDate ? new Date(preferredDeliveryDate).toLocaleDateString() : '',
      paymentMethod: 'whatsapp',
      orderSource: 'custom-order',
      status: 'Pending',
      notes: [
        description || '',
        additionalNotes || '',
        preferredDeliveryTime ? `Preferred Time: ${preferredDeliveryTime}` : ''
      ].filter(Boolean).join(' | '),
      avatar: avatar
    });

    const savedInquiry = await inquiry.save();

    // Update custom order with the inquiry ID
    savedOrder.inquiryId = savedInquiry.inquiryId;
    await savedOrder.save();

    // Create admin notification
    await Notification.create({
      type: 'inquiry_created',
      title: 'New Custom Order',
      message: `${savedOrder.fullName} requested a custom order: ${savedOrder.title}`,
      entityType: 'inquiry',
      entityId: String(savedInquiry._id)
    });

    try {
      const adminEmail = process.env.ADMIN_EMAIL;
      
      // Build email HTML
      const emailHtml = `
        <h2>New Custom Order Received</h2>
        <h3>Customer Information</h3>
        <p><strong>Full Name:</strong> ${fullName}</p>
        <p><strong>Phone Number:</strong> ${phoneNumber}</p>
        ${whatsappNumber ? `<p><strong>WhatsApp Number:</strong> ${whatsappNumber}</p>` : ''}
        ${email ? `<p><strong>Email:</strong> ${email}</p>` : ''}
        <h3>Delivery Address</h3>
        <p><strong>House No./Street:</strong> ${houseNoStreet}</p>
        <p><strong>Area/Colony:</strong> ${areaColony}</p>
        <p><strong>City:</strong> ${city || 'Rahim Yar Khan'}</p>
        <h3>Order Details</h3>
        <p><strong>Product Title:</strong> ${title}</p>
        <p><strong>Description:</strong> ${description || 'Not provided'}</p>
        <p><strong>Unit:</strong> ${unit}</p>
        <p><strong>Quantity:</strong> ${quantity}</p>
        ${preferredDeliveryDate ? `<p><strong>Preferred Delivery Date:</strong> ${new Date(preferredDeliveryDate).toLocaleDateString()}</p>` : ''}
        ${preferredDeliveryTime ? `<p><strong>Preferred Delivery Time:</strong> ${preferredDeliveryTime}</p>` : ''}
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

      // Send email to admin
      if (adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: 'New Custom Order Received',
          html: emailHtml
        });
      }

      // Send email to user if email is provided
      if (email) {
        const userEmailHtml = `
          <h2>Thank You for Your Custom Order!</h2>
          <p>Dear ${fullName},</p>
          <p>Thank you for your custom order request. We've received your order and our team will review it and contact you shortly.</p>
          <h3>Order Summary</h3>
          <p><strong>Order ID:</strong> ${savedOrder._id}</p>
          <p><strong>Product Title:</strong> ${title}</p>
          <p><strong>Quantity:</strong> ${quantity} ${unit}</p>
          <p><strong>Status:</strong> ${savedOrder.status}</p>
          <p>We'll be in touch soon!</p>
          <br>
          <p>Best regards,</p>
          <p>MeatByAlvi Team</p>
        `;
        
        await sendEmail({
          to: email,
          subject: 'Thank You for Your Custom Order',
          html: userEmailHtml
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

// Get all custom orders (admin only)
const getCustomOrders = async (req, res) => {
  try {
    const customOrders = await CustomOrder.find().sort({ createdAt: -1 });
    res.status(200).json({
      success: true,
      count: customOrders.length,
      data: customOrders
    });
  } catch (error) {
    console.error('Error fetching custom orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch custom orders'
    });
  }
};

// Get a single custom order by ID (admin only)
const getCustomOrderById = async (req, res) => {
  try {
    const customOrder = await CustomOrder.findById(req.params.id);
    if (!customOrder) {
      return res.status(404).json({
        success: false,
        message: 'Custom order not found'
      });
    }
    res.status(200).json({
      success: true,
      data: customOrder
    });
  } catch (error) {
    console.error('Error fetching custom order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch custom order'
    });
  }
};

export { createCustomOrder, uploadFields, getCustomOrders, getCustomOrderById };
