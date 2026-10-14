import { Router } from 'express';
import { requireAuth, requireSeller } from '../middleware/auth.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import { isValidObjectId, isValidSKU, sanitizeString, isSafeNumber } from '../utils/validation.js';

const router = Router();
router.use(requireAuth, requireSeller);

const ALLOWED_CATEGORIES = ['Electronics', 'Fashion', 'Beauty', 'Home', 'Kitchen', 'Sports', 'Accessories', 'Books'];

// Get Seller Products
router.get('/products', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.user.sub)) {
      return res.json([]);
    }
    res.json(await Product.find({ seller: req.user.sub }).sort({ createdAt: -1 }).lean());
  } catch (e) {
    next(e);
  }
});

// Create Seller Product (Requires Admin Approval)
router.post('/products', async (req, res, next) => {
  try {
    const body = req.body || {};
    const sku = String(body.sku || '').trim().toUpperCase();
    const name = sanitizeString(body.name, 200);

    if (!name || name.length < 2) {
      return res.status(400).json({ message: 'Product name must have at least 2 characters.' });
    }

    if (!isValidSKU(sku)) {
      return res.status(400).json({ message: 'A valid alphanumeric SKU (3-48 characters) is required.' });
    }

    if (!ALLOWED_CATEGORIES.includes(body.category)) {
      return res.status(400).json({ message: 'Please select a valid product category.' });
    }

    if (!isSafeNumber(body.price, 1, 10_000_000)) {
      return res.status(400).json({ message: 'Price must be a valid number between ₹1 and ₹10,000,000.' });
    }

    const stock = isSafeNumber(body.stock, 0, 1_000_000) ? Math.floor(Number(body.stock)) : 0;
    const images = Array.isArray(body.images)
      ? body.images.filter(x => typeof x === 'string' && x.length < 500).slice(0, 5)
      : [];
    const tags = Array.isArray(body.tags)
      ? body.tags.filter(x => typeof x === 'string').map(t => sanitizeString(t, 40)).slice(0, 12)
      : [];

    const product = await Product.create({
      sku,
      name,
      brand: sanitizeString(body.brand, 100),
      category: body.category,
      description: sanitizeString(body.description, 5000),
      price: Number(body.price),
      stock,
      images,
      tags,
      seller: req.user.sub,
      active: false,
      legalReview: 'pending'
    });

    res.status(201).json(product);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'That SKU is already used. Please choose a unique SKU.' });
    }
    next(e);
  }
});

// Update Seller Product
router.patch('/products/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product identifier.' });
    }

    const body = req.body || {};
    const updates = {};

    if (body.name) updates.name = sanitizeString(body.name, 200);
    if (body.brand) updates.brand = sanitizeString(body.brand, 100);
    if (body.description) updates.description = sanitizeString(body.description, 5000);
    if (body.category && ALLOWED_CATEGORIES.includes(body.category)) updates.category = body.category;
    if (isSafeNumber(body.price, 1, 10_000_000)) updates.price = Number(body.price);
    if (isSafeNumber(body.stock, 0, 1_000_000)) updates.stock = Math.floor(Number(body.stock));
    if (Array.isArray(body.images)) {
      updates.images = body.images.filter(x => typeof x === 'string' && x.length < 500).slice(0, 5);
    }
    if (Array.isArray(body.tags)) {
      updates.tags = body.tags.filter(x => typeof x === 'string').map(t => sanitizeString(t, 40)).slice(0, 12);
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, seller: req.user.sub },
      { $set: { ...updates, active: false, legalReview: 'pending' } },
      { new: true, runValidators: true }
    );

    if (!product) {
      return res.status(404).json({ message: 'Your product was not found.' });
    }

    res.json(product);
  } catch (e) {
    next(e);
  }
});

// Get Seller Orders
router.get('/orders', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.user.sub)) {
      return res.json([]);
    }

    const owned = await Product.find({ seller: req.user.sub }).select('_id').lean();
    const ids = owned.map(p => p._id);
    if (!ids.length) return res.json([]);

    const orders = await Order.find({ 'items.product': { $in: ids } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json(orders.map(order => ({
      id: order._id,
      createdAt: order.createdAt,
      status: order.status,
      currency: order.currency,
      items: order.items
        .filter(item => ids.some(id => String(id) === String(item.product)))
        .map(({ sku, name, quantity, unitPrice }) => ({ sku, name, quantity, unitPrice }))
    })));
  } catch (e) {
    next(e);
  }
});

router.patch('/orders/:id/status', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id) || req.body?.status !== 'shipped') {
      return res.status(400).json({ message: 'Invalid order status update.' });
    }
    const products = await Product.find({ seller: req.user.sub }).select('_id').lean();
    const productIds = products.map(product => product._id);
    if (!productIds.length) return res.status(404).json({ message: 'Order not found for your store.' });
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: 'processing', 'items.product': { $in: productIds } },
      { $set: { status: 'shipped' }, $push: { statusHistory: { status: 'shipped', at: new Date(), note: 'Seller marked the order as shipped' } } },
      { new: true }
    );
    if (!order) return res.status(404).json({ message: 'Only paid, processing orders containing your products can be marked shipped.' });
    return res.json({ id: order._id, status: order.status });
  } catch (error) {
    next(error);
  }
});

export default router;
