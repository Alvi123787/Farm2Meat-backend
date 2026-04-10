const formatCurrency = (value) => {
  const n = Number(value || 0)
  const safe = Number.isFinite(n) ? n : 0
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(safe)
  return `Rs. ${formatted}`
}

const escapeHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')

/**
 * Base Email Wrapper
 */
const baseTemplate = ({ siteName, title, message, content, supportEmail, supportPhone }) => {
  const safeSupportEmail = supportEmail ? escapeHtml(supportEmail) : ''
  const safeSupportPhone = supportPhone ? escapeHtml(supportPhone) : ''

  const supportLine = (safeSupportEmail || safeSupportPhone)
    ? `<p style="margin:14px 0 0;color:#666;font-size:13px">Support: ${safeSupportEmail ? `<a href="mailto:${safeSupportEmail}" style="color:#8B4513;text-decoration:none;font-weight:700">${safeSupportEmail}</a>` : ''}${safeSupportEmail && safeSupportPhone ? ' • ' : ''}${safeSupportPhone ? `<span style="font-weight:700">${safeSupportPhone}</span>` : ''}</p>`
    : ''

  return `
  <div style="background:#f6f7f9;padding:24px 10px;font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #eee">
      <!-- Header -->
      <div style="padding:24px 20px;background:linear-gradient(135deg,#8B4513,#5D2E0C);color:#fff">
        <div style="font-size:14px;letter-spacing:2px;text-transform:uppercase;opacity:0.9;font-weight:bold">${escapeHtml(siteName)}</div>
        <h1 style="margin:12px 0 0;font-size:26px;line-height:1.2">${escapeHtml(title)}</h1>
        <p style="margin:12px 0 0;opacity:0.95;font-size:15px;line-height:1.5">${message}</p>
      </div>

      <!-- Main Content -->
      <div style="padding:24px 20px">
        ${content}
        
        <div style="height:24px"></div>
        ${supportLine}
        <p style="margin:18px 0 0;color:#999;font-size:12px;border-top:1px solid #eee;padding-top:16px">
          This is an automated email from ${escapeHtml(siteName)}. Please do not reply directly to this email.
        </p>
      </div>
    </div>
  </div>
  `
}

/**
 * Order Confirmation Email Template
 */
export const buildOrderConfirmationEmailHtml = ({
  siteName = 'Farm2Meat',
  orderId,
  orderDate,
  paymentMethod,
  customer,
  items,
  pricing,
  supportEmail = 'farm2meat@gmail.com',
  supportPhone = '03089880479',
  ctaUrl,
  butcher, // new
  statusNote = 'Pending. Our team will contact you shortly to confirm your order.'
}) => {
  const safeOrderId = escapeHtml(orderId)
  const safeDate = escapeHtml(orderDate)
  const safePay = escapeHtml(paymentMethod || 'Cash on Delivery')
  const safeName = escapeHtml(customer?.name)
  const safeEmail = escapeHtml(customer?.email)
  const safePhone = escapeHtml(customer?.phone)
  const safeAddress = escapeHtml(customer?.address)
  const safeCity = escapeHtml(customer?.city)

  const itemsRows = (items || []).map((it) => {
    const qty = Number(it.quantity || 1)
    const price = Number(it.unitPrice || 0)
    const subtotal = Number(it.subtotal || price * qty)
    return `
      <tr>
        <td style="padding:12px 10px;border-top:1px solid #eee;color:#222;font-weight:600">${escapeHtml(it.name)}</td>
        <td style="padding:12px 10px;border-top:1px solid #eee;color:#555;text-align:center">${qty}</td>
        <td style="padding:12px 10px;border-top:1px solid #eee;color:#555;text-align:right">${formatCurrency(price)}</td>
        <td style="padding:12px 10px;border-top:1px solid #eee;color:#222;text-align:right;font-weight:700">${formatCurrency(subtotal)}</td>
      </tr>
    `
  }).join('')

  const subtotal = Number(pricing?.subtotal || 0)
  const delivery = Number(pricing?.deliveryCharge || 0)
  const total = Number(pricing?.total || subtotal + delivery)

  const butcherSection = butcher
    ? `
    <!-- Butcher Service Section -->
    <h2 style="margin:32px 0 16px;font-size:18px;color:#222">
      <span style="margin-right:8px">🥩</span> Butcher Service Details
    </h2>
    <div style="background:#f9f9f9;padding:20px;border-radius:12px;border:1px solid #eee">
      <p style="margin:0 0 16px;color:#333;font-size:15px;line-height:1.5">
        We’ve arranged a professional butcher for your order. Below are the details:
      </p>
      <table role="presentation" style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px;width:100px">Name</td>
          <td style="padding:6px 0;color:#222;font-weight:700">${escapeHtml(butcher.name)}</td>
        </tr>
        ${butcher.experience ? `
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px">Experience</td>
          <td style="padding:6px 0;color:#222;font-weight:600">${escapeHtml(butcher.experience)}</td>
        </tr>
        ` : ''}
        ${butcher.phone ? `
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px">Contact</td>
          <td style="padding:6px 0;color:#222;font-weight:600">${escapeHtml(butcher.phone)}</td>
        </tr>
        ` : ''}
      </table>
    </div>
    `
    : ''

  const safeCtaUrl = escapeHtml(ctaUrl || '')
  const cta = safeCtaUrl
    ? `<div style="text-align:center;margin:30px 0">
        <a href="${safeCtaUrl}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:800;box-shadow:0 4px 6px rgba(139,69,19,0.2)">
          View Order Status
        </a>
      </div>`
    : ''

  const orderContent = `
    <!-- Order Summary Section -->
    <h2 style="margin:0 0 16px;font-size:18px;color:#222;display:flex;align-items:center">
      <span style="margin-right:8px">🧾</span> Order Details
    </h2>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:10px 0;color:#666;font-size:14px">Order ID</td>
        <td style="padding:10px 0;color:#222;font-weight:700;text-align:right;font-family:monospace;font-size:15px">${safeOrderId}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#666;font-size:14px">Order Date</td>
        <td style="padding:10px 0;color:#222;font-weight:600;text-align:right">${safeDate}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#666;font-size:14px">Payment Method</td>
        <td style="padding:10px 0;color:#222;font-weight:600;text-align:right;text-transform:capitalize">${safePay}</td>
      </tr>
    </table>

    <!-- Items Section -->
    <h2 style="margin:0 0 16px;font-size:18px;color:#222">
      <span style="margin-right:8px">🛒</span> Items Ordered
    </h2>
    <div style="overflow-x:auto;border:1px solid #eee;border-radius:12px;margin-bottom:24px">
      <table role="presentation" style="width:100%;border-collapse:collapse;min-width:500px">
        <thead>
          <tr>
            <th style="text-align:left;padding:12px 10px;background:#fafafa;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px">Item</th>
            <th style="text-align:center;padding:12px 10px;background:#fafafa;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px">Qty</th>
            <th style="text-align:right;padding:12px 10px;background:#fafafa;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px">Price</th>
            <th style="text-align:right;padding:12px 10px;background:#fafafa;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:1px">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows}
        </tbody>
      </table>
    </div>

    <!-- Totals Section -->
    <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr>
        <td style="padding:8px 0;color:#666;font-size:14px">Subtotal</td>
        <td style="padding:8px 0;color:#222;font-weight:600;text-align:right">${formatCurrency(subtotal)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#666;font-size:14px">Delivery</td>
        <td style="padding:8px 0;color:#2e7d32;font-weight:700;text-align:right">FREE</td>
      </tr>
      <tr>
        <td style="padding:16px 0;color:#222;font-weight:800;font-size:18px;border-top:2px solid #8B4513">Total Amount</td>
        <td style="padding:16px 0;color:#8B4513;font-weight:800;font-size:22px;text-align:right;border-top:2px solid #8B4513">${formatCurrency(total)}</td>
      </tr>
    </table>

    <!-- Customer Info Section -->
    <h2 style="margin:32px 0 16px;font-size:18px;color:#222">
      <span style="margin-right:8px">👤</span> Customer Information
    </h2>
    <div style="background:#f9f9f9;padding:20px;border-radius:12px;border:1px solid #eee">
      <table role="presentation" style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px;width:100px">Name</td>
          <td style="padding:6px 0;color:#222;font-weight:700">${safeName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px">Email</td>
          <td style="padding:6px 0;color:#222;font-weight:600">${safeEmail}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px">Phone</td>
          <td style="padding:6px 0;color:#222;font-weight:600">${safePhone}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;font-size:13px;vertical-align:top">Shipping</td>
          <td style="padding:6px 0;color:#222;font-weight:600;line-height:1.4">${safeAddress}${safeCity ? `, ${safeCity}` : ''}</td>
        </tr>
      </table>
    </div>

    ${butcherSection}

    ${cta}
    <p style="margin:24px 0 0;color:#8B4513;font-size:14px;font-weight:600;background:rgba(139,69,19,0.05);padding:12px;border-radius:8px;text-align:center">
      Order status: ${escapeHtml(statusNote)}
    </p>
  `

  return baseTemplate({
    siteName,
    title: 'Order Confirmation',
    message: '👉 Thank you for your order. We are preparing your items and will contact you soon.',
    content: orderContent,
    supportEmail,
    supportPhone
  })
}

/**
 * Future support: Order Status Update Template
 */
export const buildOrderStatusEmailHtml = ({
  siteName = 'Farm2Meat',
  orderId,
  status, // 'Shipped', 'Delivered', etc.
  customerName,
  supportEmail = 'farm2meat@gmail.com',
  supportPhone = '03089880479'
}) => {
  const safeName = escapeHtml(customerName)
  const safeOrderId = escapeHtml(orderId)
  const safeStatus = escapeHtml(status)

  const content = `
    <div style="text-align:center;padding:20px 0">
      <p style="font-size:16px;color:#333">Hi ${safeName},</p>
      <p style="font-size:16px;color:#333">Your order <strong>${safeOrderId}</strong> status has been updated to:</p>
      <div style="display:inline-block;background:#8B4513;color:#fff;padding:10px 20px;border-radius:20px;font-weight:bold;font-size:18px;margin:20px 0">
        ${safeStatus}
      </div>
      <p style="font-size:14px;color:#666">We'll send you another update once there's more news!</p>
    </div>
  `

  return baseTemplate({
    siteName,
    title: `Order Status Update: ${safeStatus}`,
    message: `Your order #${safeOrderId} is now ${safeStatus.toLowerCase()}.`,
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * New Animal Notification Template
 */
export const buildNewAnimalNotificationHtml = ({
  siteName = 'Farm2Meat',
  animalName,
  animalPrice,
  animalDescription,
  animalImageUrl,
  animalUrl,
  supportEmail = 'farm2meat@gmail.com',
  supportPhone = '03089880479'
}) => {
  const safeAnimalName = escapeHtml(animalName)
  const safePrice = formatCurrency(animalPrice)
  const safeDescription = escapeHtml(animalDescription || 'A beautiful new addition to our marketplace.')
  const safeAnimalUrl = escapeHtml(animalUrl)
  const safeImageUrl = escapeHtml(animalImageUrl ? `http://localhost:5000${animalImageUrl}` : '')

  const imageTag = safeImageUrl 
    ? `<div style="margin-bottom:20px;text-align:center">
        <img src="${safeImageUrl}" alt="${safeAnimalName}" style="max-width:100%;height:auto;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
      </div>`
    : ''

  const content = `
    <div style="background:#f9f9f9;border-radius:12px;padding:24px;border:1px solid #eee">
      ${imageTag}
      <h2 style="margin:0 0 10px;color:#222;font-size:22px;font-weight:800">${safeAnimalName}</h2>
      <div style="display:inline-block;background:#8B4513;color:#fff;padding:4px 12px;border-radius:6px;font-weight:700;font-size:18px;margin-bottom:16px">
        ${safePrice}
      </div>
      <p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.6">${safeDescription}</p>
      
      <div style="text-align:center;margin:30px 0 10px">
        <a href="${safeAnimalUrl}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:800;font-size:16px;box-shadow:0 4px 10px rgba(139,69,19,0.3)">
          View Animal Now
        </a>
      </div>
    </div>
    <p style="margin:20px 0 0;text-align:center;color:#666;font-size:14px">
      Hurry up! High-quality livestock like this doesn't stay available for long.
    </p>
  `

  return baseTemplate({
     siteName,
     title: 'New Livestock Added! 🐐',
     message: 'A new livestock animal has just been added to our platform. Check it out before it gets sold.',
     content,
     supportEmail,
     supportPhone
   })
 }

/**
 * Admin: New Order Notification
 */
export const buildAdminOrderNotificationEmailHtml = ({
  siteName = 'Farm2Meat',
  orderId,
  customerName,
  items,
  totalAmount,
  deliveryAddress,
  supportEmail,
  supportPhone
}) => {
  const itemsList = (items || []).map(it => `<li>${escapeHtml(it.name)} (x${it.quantity})</li>`).join('')
  
  const content = `
    <div style="background:#fff3e0;border:1px solid #ffe0b2;padding:20px;border-radius:12px">
      <h2 style="color:#e65100;margin:0 0 16px">New Order Received! 🛒</h2>
      <p><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
      <p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
      <p><strong>Total Amount:</strong> ${formatCurrency(totalAmount)}</p>
      <p><strong>Delivery Address:</strong> ${escapeHtml(deliveryAddress)}</p>
      <div style="margin-top:16px">
        <p><strong>Items:</strong></p>
        <ul style="margin:0;padding-left:20px">${itemsList}</ul>
      </div>
      <div style="margin-top:24px;text-align:center">
        <a href="http://localhost:5173/admin/orders" style="display:inline-block;background:#e65100;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Manage Orders</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'New Order Alert',
    message: 'A new order has been placed on the platform.',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Admin: New User Registration Notification
 */
export const buildAdminUserRegistrationNotificationEmailHtml = ({
  siteName = 'Farm2Meat',
  userName,
  userEmail,
  registrationDate,
  supportEmail,
  supportPhone
}) => {
  const content = `
    <div style="background:#e3f2fd;border:1px solid #bbdefb;padding:20px;border-radius:12px">
      <h2 style="color:#0d47a1;margin:0 0 16px">New User Registered! 👤</h2>
      <p><strong>Name:</strong> ${escapeHtml(userName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(userEmail)}</p>
      <p><strong>Date:</strong> ${escapeHtml(registrationDate)}</p>
      <div style="margin-top:24px;text-align:center">
        <a href="http://localhost:5173/admin/users" style="display:inline-block;background:#0d47a1;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">View Users</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'New User Alert',
    message: 'A new user has joined the platform.',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Sold Out Notification
 */
export const buildSoldOutNotificationEmailHtml = ({
  siteName = 'Farm2Meat',
  animalName,
  animalPrice,
  supportEmail,
  supportPhone,
  websiteUrl = 'http://localhost:5173'
}) => {
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333">We're sorry! The animal you were interested in has been sold.</p>
      <div style="background:#fff5f5;border:1px solid #feb2b2;padding:20px;border-radius:12px;margin:20px 0">
        <h3 style="margin:0;color:#c53030">${escapeHtml(animalName)}</h3>
        <p style="margin:10px 0 0;font-weight:bold;color:#222">${formatCurrency(animalPrice)}</p>
      </div>
      <p style="color:#666">Don't worry, we have many other high-quality livestock available. Check them out before they are gone too!</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${websiteUrl}/shop" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:800">View Available Animals</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'Item Sold Out 🏷️',
    message: `The animal "${escapeHtml(animalName)}" is no longer available.`,
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Multiple Items Sold Summary
 */
export const buildAllItemsSoldNotificationEmailHtml = ({
  siteName = 'Farm2Meat',
  supportEmail,
  supportPhone,
  websiteUrl = 'http://localhost:5173'
}) => {
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333;line-height:1.6">All items you added to cart have been purchased by other customers.</p>
      <p style="color:#666">Don't worry, we have many other high-quality livestock available. Check them out before they are gone too!</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${websiteUrl}/shop" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:800">View Available Animals</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'Items Sold Out 🏷️',
    message: 'The items in your cart are no longer available.',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Promotional / Marketing Email
 */
export const buildPromotionalEmailHtml = ({
  siteName = 'Farm2Meat',
  title,
  offerMessage,
  imageUrl,
  ctaText = 'Shop Now',
  ctaUrl = 'http://localhost:5173/shop',
  supportEmail,
  supportPhone
}) => {
  const imagePart = imageUrl 
    ? `<div style="margin-bottom:24px"><img src="${escapeHtml(imageUrl)}" style="width:100%;border-radius:12px;display:block"></div>`
    : ''

  const content = `
    <div style="text-align:center;padding:10px 0">
      ${imagePart}
      <div style="font-size:18px;color:#333;line-height:1.6;margin-bottom:30px">
        ${offerMessage}
      </div>
      <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:16px 40px;border-radius:50px;font-weight:800;font-size:18px;box-shadow:0 4px 15px rgba(139,69,19,0.3)">
        ${escapeHtml(ctaText)}
      </a>
    </div>
  `
  return baseTemplate({
    siteName,
    title: escapeHtml(title),
    message: 'Special offer just for you!',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Order Feedback / Review Request
 */
export const buildOrderFeedbackEmailHtml = ({
  siteName = 'Farm2Meat',
  customerName,
  orderId,
  items,
  reviewUrl,
  supportEmail,
  supportPhone
}) => {
  const itemsText = (items || []).map(it => it.name).join(', ')
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333">Hi ${escapeHtml(customerName)},</p>
      <p style="font-size:16px;color:#333">Thank you for your purchase of <strong>${escapeHtml(itemsText)}</strong> (Order #${escapeHtml(orderId)}). We hope you're happy with your new livestock!</p>
      <p style="font-size:16px;color:#333;margin-top:20px">Please share your experience and help others make informed choices.</p>
      <div style="text-align:center;margin:40px 0">
        <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:800">Leave a Review</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'How was your experience? ⭐',
    message: 'We value your feedback!',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Signup / resend — email verification link (time-limited on server)
 */
export const buildWelcomeVerificationEmailHtml = ({
  siteName = 'Farm2Meat',
  customerName,
  verificationUrl,
  supportEmail,
  supportPhone
}) => {
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333">Hi ${escapeHtml(customerName)},</p>
      <p style="font-size:18px;color:#333;font-weight:700">Welcome to ${escapeHtml(siteName)}!</p>
      <p style="font-size:16px;color:#333">Thanks for registering.</p>
      <p style="font-size:16px;color:#333;margin-top:12px">Click the button below to verify your account and start using our platform.</p>
      <div style="text-align:center;margin:40px 0">
        <a href="${escapeHtml(verificationUrl)}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:800">Verify Your Account</a>
      </div>
      <p style="font-size:14px;color:#666">This link expires in <strong>24 hours</strong> for your security. If you did not create an account, you can ignore this email.</p>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'Verify your email',
    message: 'One quick step to activate your account.',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Expired Cart / Removed Animal Notification
 */
export const buildExpiredCartRemovalEmailHtml = ({
  siteName = 'Farm2Meat',
  animalName,
  reason = 'it has been sold or your cart expired',
  supportEmail,
  supportPhone,
  websiteUrl = 'http://localhost:5173'
}) => {
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333">An item has been removed from your cart.</p>
      <div style="background:#fff5f5;border:1px solid #feb2b2;padding:20px;border-radius:12px;margin:20px 0">
        <p style="margin:0;color:#c53030"><strong>${escapeHtml(animalName)}</strong> was removed because ${escapeHtml(reason)}.</p>
      </div>
      <p style="color:#666">Don't miss out on other great options! Check our current inventory to find your next match.</p>
      <div style="text-align:center;margin:30px 0">
        <a href="${websiteUrl}/shop" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:800">View Other Animals</a>
      </div>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'Cart Update 🛒',
    message: 'Your cart has been updated.',
    content,
    supportEmail,
    supportPhone
  })
}

/**
 * Password Reset Template
 */
export const buildPasswordResetEmailHtml = ({
  siteName = 'Farm2Meat',
  customerName,
  resetUrl,
  supportEmail,
  supportPhone
}) => {
  const content = `
    <div style="padding:10px 0">
      <p style="font-size:16px;color:#333">Hi ${escapeHtml(customerName)},</p>
      <p style="font-size:16px;color:#333">We received a request to reset your password. If you didn't make this request, you can safely ignore this email.</p>
      <p style="font-size:16px;color:#333;margin-top:20px">Click the button below to choose a new password. This link is only valid for 30 minutes.</p>
      <div style="text-align:center;margin:40px 0">
        <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#8B4513;color:#fff;text-decoration:none;padding:16px 32px;border-radius:12px;font-weight:800">Reset My Password</a>
      </div>
      <p style="font-size:13px;color:#999;text-align:center">If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${escapeHtml(resetUrl)}" style="color:#8B4513;word-break:break-all">${escapeHtml(resetUrl)}</a>
      </p>
    </div>
  `
  return baseTemplate({
    siteName,
    title: 'Password Reset Request',
    message: 'Need to reset your password? No problem.',
    content,
    supportEmail,
    supportPhone
  })
}
