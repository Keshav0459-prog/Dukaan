import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/rateLimiter.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import mongoose from 'mongoose';
import { isValidEmail, isValidObjectId, isValidSKU, sanitizeString } from '../utils/validation.js';

const router = Router();
const inMemoryOrders = [];

const fallbackCatalog = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../catalog.json', import.meta.url)), 'utf8')
).map((p, index) => ({
  _id: 'prod_' + (p.id || index),
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  category: p.category,
  description: p.detail || '',
  price: p.price,
  images: [p.img?.startsWith('http') || p.img?.startsWith('/') ? p.img : `https://images.unsplash.com/${p.img}`],
  stock: 10,
  tags: [p.tag, p.brand].filter(Boolean),
  active: true,
  legalReview: 'approved'
}));

router.post('/webhook', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  if (!secret || !Buffer.isBuffer(req.body) || !signature) return res.status(503).send('Razorpay webhook is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  const received = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !crypto.timingSafeEqual(received, expectedBuffer)) {
    return res.status(400).send('Invalid webhook signature.');
  }
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); }
  catch { return res.status(400).send('Malformed webhook payload.'); }
  if (event.event !== 'payment.captured') return res.json({ received: true });
  const payment = event.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id || payment.currency !== 'INR' || payment.status !== 'captured') {
    return res.status(400).send('Invalid captured payment payload.');
  }
  const order = await Order.findOne({ razorpayOrderId: payment.order_id }).catch(() => null);
  if (!order) return res.json({ received: true });
  if (payment.amount !== Math.round(order.amount * 100)) return res.status(400).send('Payment amount does not match the order.');
  if (order.status === 'paid') return res.json({ received: true });
  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending', razorpayOrderId: payment.order_id },
    { $set: { status: 'processing', razorpayPaymentId: payment.id } },
    { new: true }
  );
  if (!claimed) return res.json({ received: true });
  const adjusted = [];
  try {
    for (const item of claimed.items) {
      if (!item.product) continue;
      const result = await Product.updateOne({ _id: item.product, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } });
      if (result.modifiedCount !== 1) throw new Error(`Insufficient inventory for SKU ${item.sku}.`);
      adjusted.push(item);
    }
    await Order.updateOne({ _id: claimed._id, status: 'processing' }, {
      $set: { status: 'paid' },
      $push: { statusHistory: { status: 'paid', at: new Date(), note: 'Payment captured by Razorpay' } }
    });
    return res.json({ received: true });
  } catch (error) {
    for (const item of adjusted) await Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } }).catch(() => {});
    await Order.updateOne({ _id: claimed._id, status: 'processing' }, { $set: { status: 'pending' } }).catch(() => {});
    console.error('Razorpay webhook inventory reconciliation failed:', error.message);
    return res.status(500).send('Order inventory reconciliation failed.');
  }
});

// Checkout Route with Rate Limiting & Strict Input Sanitization
router.post('/checkout', requireAuth, checkoutLimiter, async (req, res, next) => {
  try {
    const lines = req.body?.items;
    if (!Array.isArray(lines) || !lines.length || lines.length > 50) {
      return res.status(400).json({ message: 'Your bag is empty or contains too many different products.' });
    }

    if (lines.some(line => !isValidSKU(line?.sku))) {
      return res.status(400).json({ message: 'A product in your bag is invalid. Refresh the catalog and try again.' });
    }

    const shippingRaw = req.body?.shipping || {};
    const cleanShipping = {
      name: sanitizeString(shippingRaw.name, 100),
      email: String(shippingRaw.email || '').toLowerCase().trim().slice(0, 120),
      phone: sanitizeString(shippingRaw.phone, 20),
      addressLine1: sanitizeString(shippingRaw.addressLine1, 150),
      addressLine2: sanitizeString(shippingRaw.addressLine2, 150),
      city: sanitizeString(shippingRaw.city, 60),
      state: sanitizeString(shippingRaw.state, 60),
      pincode: sanitizeString(shippingRaw.pincode, 10)
    };

    if (
      !cleanShipping.name ||
      !cleanShipping.email ||
      !isValidEmail(cleanShipping.email) ||
      !cleanShipping.phone ||
      !/^[0-9+\s-]{8,20}$/.test(cleanShipping.phone) ||
      !cleanShipping.addressLine1 ||
      !cleanShipping.city ||
      !cleanShipping.state ||
      !/^\d{6}$/.test(cleanShipping.pincode)
    ) {
      return res.status(400).json({ message: 'Please complete all required delivery details with a valid phone, email and 6-digit PIN code.' });
    }

    const skus = lines.map(line => String(line.sku).toUpperCase());
    if (new Set(skus).size !== skus.length) {
      return res.status(400).json({ message: 'Duplicate products found in your bag. Refresh and try again.' });
    }

    let products;
    if (mongoose.connection.readyState === 1) {
      products = await Product.find({ sku: { $in: skus }, active: true, legalReview: 'approved' });
    } else if (process.env.NODE_ENV !== 'production') {
      products = fallbackCatalog.filter(p => skus.includes(p.sku) && p.active);
    } else {
      return res.status(503).json({ message: 'Order service is unavailable until MongoDB is connected. No payment has been started.' });
    }

    if (products.length !== lines.length) {
      return res.status(400).json({ message: 'A product in your bag is no longer available.' });
    }

    const items = lines.map(line => {
      const product = products.find(p => p.sku === String(line.sku).toUpperCase());
      const quantity = Math.floor(Number(line.quantity));
      if (!quantity || quantity < 1 || quantity > 10 || quantity > product.stock) {
        throw Object.assign(new Error(`Please check the available quantity for ${product.name}.`), { status: 409 });
      }
      return { product: product._id, sku: product.sku, name: product.name, quantity, unitPrice: product.price };
    });

    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const promoCode = sanitizeString(req.body.promoCode, 20).toUpperCase();
    if (promoCode && promoCode !== 'DUKAAN10') {
      return res.status(400).json({ message: 'That discount code is not valid.' });
    }

    const shippingFee = subtotal >= 5000 ? 0 : 99;
    const discountAmount = promoCode ? Math.round(subtotal * 0.1) : 0;
    const amount = subtotal - discountAmount + shippingFee;
    const isRazorpayConfigured = Boolean(
      process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      !process.env.RAZORPAY_KEY_ID.includes('your_key')
    );
    if (!isRazorpayConfigured) {
      return res.status(503).json({ message: 'Razorpay test keys are not configured on the server. No payment has been started.' });
    }
    if (process.env.NODE_ENV !== 'production' && !process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
      return res.status(503).json({ message: 'Development checkout only accepts Razorpay test keys. No payment has been started.' });
    }

    {
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });

      let order;
      let orderId;
      if (mongoose.connection.readyState === 1) {
        order = await Order.create({
          user: req.user.sub,
          items,
          subtotal,
          discountAmount,
          shippingFee,
          promoCode: promoCode || undefined,
          amount,
          currency: 'inr',
          paymentGateway: 'razorpay',
          status: 'pending',
          statusHistory: [{ status: 'pending', at: new Date(), note: 'Order created; awaiting payment' }],
          shipping: { ...cleanShipping, country: 'IN' }
        });
        orderId = String(order._id);
      } else {
        orderId = new mongoose.Types.ObjectId().toHexString();
        order = {
          _id: orderId,
          user: req.user.sub,
          items,
          subtotal,
          discountAmount,
          shippingFee,
          promoCode: promoCode || undefined,
          amount,
          currency: 'inr',
          paymentGateway: 'razorpay',
          status: 'pending',
          statusHistory: [{ status: 'pending', at: new Date(), note: 'Order created; awaiting payment' }],
          shipping: { ...cleanShipping, country: 'IN' },
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }

      let rzpOrder;
      try {
        rzpOrder = await razorpay.orders.create({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: `rcpt_${orderId.slice(-20)}`,
          notes: { dukaanOrderId: orderId }
        });
        order.razorpayOrderId = rzpOrder.id;
        if (mongoose.connection.readyState === 1) {
          await order.save();
        } else {
          inMemoryOrders.unshift(order);
        }
      } catch (gatewayError) {
        if (mongoose.connection.readyState === 1) {
          await Order.updateOne({ _id: orderId, status: 'pending' }, { $set: { status: 'cancelled' } });
        }
        throw gatewayError;
      }

      return res.json({
        gateway: 'razorpay',
        keyId: process.env.RAZORPAY_KEY_ID,
        razorpayOrderId: rzpOrder.id,
        dukaanOrderId: orderId,
        amount: rzpOrder.amount,
        currency: 'INR',
        customer: {
          name: cleanShipping.name,
          email: cleanShipping.email,
          phone: cleanShipping.phone
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

// Razorpay Payment Verification Endpoint
router.post('/verify-payment', requireAuth, async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, dukaan_order_id } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !dukaan_order_id) {
      return res.status(400).json({ message: 'Missing transaction details for payment verification.' });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).json({ message: 'Razorpay secret key not configured on server.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const receivedSignature = Buffer.from(String(razorpay_signature));
    const expected = Buffer.from(expectedSignature);
    if (receivedSignature.length !== expected.length || !crypto.timingSafeEqual(receivedSignature, expected)) {
      return res.status(400).json({ message: 'Invalid payment signature. Transaction verification failed.' });
    }

    let order;
    if (mongoose.connection.readyState === 1) {
      if (!isValidObjectId(dukaan_order_id)) {
        return res.status(400).json({ message: 'Invalid order identifier format.' });
      }
      order = await Order.findOne({ _id: dukaan_order_id, user: req.user.sub });
    } else if (process.env.NODE_ENV !== 'production') {
      order = inMemoryOrders.find(o => String(o._id) === String(dukaan_order_id) && String(o.user) === String(req.user.sub));
    } else {
      return res.status(503).json({ message: 'Order database is unavailable. Payment confirmation could not be completed.' });
    }
    if (!order) return res.status(404).json({ message: 'Order record not found for this account.' });
    if (order.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ message: 'Payment does not match this order.' });
    }
    if (order.status === 'paid') {
      if (order.razorpayPaymentId === razorpay_payment_id) return res.json({ success: true, orderId: order._id, status: 'paid' });
      return res.status(409).json({ message: 'This order has already been paid with a different transaction.' });
    }
    if (order.status !== 'pending') return res.status(409).json({ message: 'This order is no longer awaiting payment.' });

    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: secret });
    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    if (payment.order_id !== order.razorpayOrderId || payment.currency !== 'INR' || payment.amount !== Math.round(order.amount * 100) || payment.status !== 'captured') {
      return res.status(400).json({ message: 'Razorpay has not confirmed a captured payment for the full order amount.' });
    }

    if (mongoose.connection.readyState === 1) {
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, user: req.user.sub, razorpayOrderId: razorpay_order_id, status: 'pending' },
        { $set: { status: 'processing', razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature } },
        { new: true }
      );
      if (!claimed) {
        const latest = await Order.findById(order._id);
        if (latest?.status === 'paid' && latest.razorpayPaymentId === razorpay_payment_id) return res.json({ success: true, orderId: order._id, status: 'paid' });
        return res.status(409).json({ message: 'This order is already being confirmed.' });
      }

      for (const item of claimed.items) {
        if (!item.product) continue;
        const result = await Product.updateOne({ _id: item.product, stock: { $gte: item.quantity } }, { $inc: { stock: -item.quantity } });
        if (result.modifiedCount !== 1) {
          await Order.updateOne({ _id: claimed._id, status: 'processing' }, { $set: { status: 'paid' } });
          console.error(`Paid order ${claimed._id} needs inventory review for SKU ${item.sku}.`);
          return res.json({ success: true, orderId: claimed._id, status: 'paid', inventoryReview: true });
        }
      }
      await Order.updateOne({ _id: claimed._id, status: 'processing' }, {
        $set: { status: 'paid' },
        $push: { statusHistory: { status: 'paid', at: new Date(), note: 'Payment captured by Razorpay' } }
      });
      return res.json({ success: true, orderId: claimed._id, status: 'paid' });
    } else {
      order.status = 'paid';
      order.razorpayPaymentId = razorpay_payment_id;
      order.razorpaySignature = razorpay_signature;
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({ status: 'paid', at: new Date(), note: 'Payment captured by Razorpay' });
      return res.json({ success: true, orderId: order._id, status: 'paid' });
    }
  } catch (error) {
    next(error);
  }
});

// View My Orders
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    if (mongoose.connection.readyState === 1) {
      if (!isValidObjectId(req.user.sub)) {
        return res.json([]);
      }
      const orders = await Order.find({ user: req.user.sub }).sort({ createdAt: -1 }).lean();
      return res.json(orders);
    }
    return res.json(inMemoryOrders.filter(o => String(o.user) === String(req.user.sub)));
  } catch (error) {
    next(error);
  }
});

router.get('/:id/status', requireAuth, async (req, res, next) => {
  try {
    if (mongoose.connection.readyState === 1) {
      if (!isValidObjectId(req.params.id)) {
        return res.status(404).json({ message: 'Order status is unavailable.' });
      }
      const order = await Order.findOne({ _id: req.params.id, user: req.user.sub }).select('status statusHistory createdAt updatedAt').lean();
      if (!order) return res.status(404).json({ message: 'Order status is unavailable.' });
      return res.json({ status: order.status });
    }
    const order = inMemoryOrders.find(o => String(o._id) === String(req.params.id) && String(o.user) === String(req.user.sub));
    if (!order) return res.status(404).json({ message: 'Order status is unavailable.' });
    return res.json({ status: order.status });
  } catch (error) {
    next(error);
  }
});

export default router;
