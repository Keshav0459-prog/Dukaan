import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { competitorPriceLimiter } from '../middleware/rateLimiter.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import User from '../models/User.js';
import { findCachedPriceComparison, getPriceComparison } from '../services/priceComparisonCache.js';
import mongoose from 'mongoose';
import { isValidObjectId, isValidSKU, sanitizeString, isSafeNumber } from '../utils/validation.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const ALLOWED_CATEGORIES = ['Electronics', 'Fashion', 'Beauty', 'Home', 'Kitchen', 'Sports', 'Accessories', 'Books'];

// Competitor Price Comparison with Rate Limiting
router.post('/competitor-prices', async (req, res, next) => {
  try {
    const name = sanitizeString(req.body.productName, 180);
    if (!name) {
      return res.status(400).json({ message: 'Product name is required.' });
    }

    const category = sanitizeString(req.body.category, 80);
    const brand = sanitizeString(req.body.brand, 100);
    const price = isSafeNumber(req.body.price, 0) ? Number(req.body.price) : undefined;

    const product = { name, brand, category, price };
    const cached = await findCachedPriceComparison(product);
    if (cached) return res.json(cached);

    return competitorPriceLimiter(req, res, () => {
      getPriceComparison(product, { cacheChecked: true })
        .then(result => res.json(result))
        .catch(err => {
          const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 503;
          const message = err.message || 'Live price comparison is temporarily unavailable. Please try again.';
          res.status(status).json({ message });
        });
    });
  } catch (e) {
    next(e);
  }
});

// Admin Metrics Overview
router.get('/overview', async (_req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ products: 26, orders: 38, revenue: 248600 });
    }
    const [products, orders, revenue] = await Promise.all([
      Product.countDocuments({ active: true }),
      Order.countDocuments(),
      Order.aggregate([
        { $match: { status: { $in: ['paid', 'processing', 'shipped', 'delivered'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);
    res.json({ products, orders, revenue: revenue[0]?.total || 0 });
  } catch (e) {
    next(e);
  }
});

// Create Product (Guarded against Mass Assignment)
router.post('/products', async (req, res, next) => {
  try {
    const { sku, name, brand, description, category, price, stock, images, tags } = req.body || {};

    if (!sku || !isValidSKU(sku)) {
      return res.status(400).json({ message: 'A valid alphanumeric SKU (3-48 chars) is required.' });
    }

    const cleanName = sanitizeString(name, 200);
    if (!cleanName) {
      return res.status(400).json({ message: 'Product name is required.' });
    }

    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ message: 'Invalid product category.' });
    }

    if (!isSafeNumber(price, 1, 10_000_000)) {
      return res.status(400).json({ message: 'Price must be a valid number between ₹1 and ₹10,000,000.' });
    }

    const product = await Product.create({
      sku: sku.trim().toUpperCase(),
      name: cleanName,
      brand: sanitizeString(brand, 100),
      description: sanitizeString(description, 5000),
      category,
      price: Number(price),
      stock: isSafeNumber(stock, 0, 1_000_000) ? Math.floor(Number(stock)) : 0,
      images: Array.isArray(images) ? images.filter(url => typeof url === 'string').slice(0, 5) : [],
      tags: Array.isArray(tags) ? tags.filter(t => typeof t === 'string').map(t => sanitizeString(t, 40)).slice(0, 12) : [],
      active: false,
      legalReview: 'pending'
    });

    res.status(201).json(product);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'A product with this SKU already exists.' });
    }
    next(e);
  }
});

// Update Product
router.patch('/products/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product identifier.' });
    }

    const allowed = ['name', 'brand', 'description', 'category', 'price', 'stock', 'images', 'tags'];
    const raw = req.body || {};
    const updates = {};

    if (raw.name) updates.name = sanitizeString(raw.name, 200);
    if (raw.brand) updates.brand = sanitizeString(raw.brand, 100);
    if (raw.description) updates.description = sanitizeString(raw.description, 5000);
    if (raw.category && ALLOWED_CATEGORIES.includes(raw.category)) updates.category = raw.category;
    if (isSafeNumber(raw.price, 1, 10_000_000)) updates.price = Number(raw.price);
    if (isSafeNumber(raw.stock, 0, 1_000_000)) updates.stock = Math.floor(Number(raw.stock));
    if (Array.isArray(raw.images)) updates.images = raw.images.filter(x => typeof x === 'string').slice(0, 5);
    if (Array.isArray(raw.tags)) updates.tags = raw.tags.filter(x => typeof x === 'string').slice(0, 12);

    const product = await Product.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    res.json(product);
  } catch (e) {
    next(e);
  }
});

// Legal Review of Product
router.patch('/products/:id/legal-review', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product identifier.' });
    }

    const decision = req.body.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be approved or rejected.' });
    }

    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { legalReview: decision, active: decision === 'approved' },
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    res.json(product);
  } catch (e) {
    next(e);
  }
});

// Delete Product
router.delete('/products/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product identifier.' });
    }

    const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
    if (!product) return res.status(404).json({ message: 'Product not found.' });
    res.json({ message: 'Product archived.' });
  } catch (e) {
    next(e);
  }
});

// List Admin Orders
router.get('/orders', async (_req, res, next) => {
  try {
    res.json(
      await Order.find()
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    );
  } catch (e) {
    next(e);
  }
});

// Update Order Status
router.patch('/orders/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order identifier.' });
    }

    const transitions = { paid: ['processing'], processing: ['shipped'], shipped: ['delivered'] };
    const current = await Order.findById(req.params.id).select('status');
    if (!current) return res.status(404).json({ message: 'Order not found.' });
    if (!(transitions[current.status] || []).includes(req.body.status)) {
      return res.status(409).json({ message: `Order cannot move from ${current.status} to ${req.body.status}.` });
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, status: current.status },
      { $set: { status: req.body.status }, $push: { statusHistory: { status: req.body.status, at: new Date(), note: 'Updated by store admin' } } },
      { new: true }
    );
    if (!order) return res.status(409).json({ message: 'Order changed while you were updating it. Refresh and try again.' });
    res.json(order);
  } catch (e) {
    next(e);
  }
});

// List Admin Products
router.get('/products', async (_req, res, next) => {
  try {
    res.json(
      await Product.find()
        .populate('seller', 'name email storeName')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean()
    );
  } catch (e) {
    next(e);
  }
});

// List Pending Sellers
router.get('/sellers', async (_req, res, next) => {
  try {
    res.json(
      await User.find({ sellerStatus: 'pending' })
        .select('name email storeName sellerStatus createdAt')
        .sort({ createdAt: 1 })
        .lean()
    );
  } catch (e) {
    next(e);
  }
});

// Review Seller Application
router.patch('/sellers/:id/review', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid seller identifier.' });
    }

    const decision = req.body.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be approved or rejected.' });
    }

    const user = await User.findOneAndUpdate(
      { _id: req.params.id, sellerStatus: 'pending' },
      { $set: { sellerStatus: decision, role: decision === 'approved' ? 'seller' : 'customer' } },
      { new: true }
    ).select('name email storeName role sellerStatus');

    if (!user) return res.status(404).json({ message: 'Pending seller application not found.' });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

export default router;
