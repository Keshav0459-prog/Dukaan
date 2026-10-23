import { Router } from 'express';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Product from '../models/Product.js';
import { publicPriceCompareLimiter } from '../middleware/rateLimiter.js';
import { findCachedPriceComparison, getPriceComparison } from '../services/priceComparisonCache.js';
import { isValidObjectId, sanitizeString, isSafeNumber } from '../utils/validation.js';

const router = Router();
const ALLOWED_CATEGORIES = ['Electronics', 'Fashion', 'Beauty', 'Home', 'Kitchen', 'Sports', 'Accessories', 'Books'];
const ALLOWED_SORTS = ['newest', 'price-asc', 'price-desc'];
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

router.get('/', async (req, res, next) => {
  try {
    const q = sanitizeString(String(req.query.q || ''), 100);
    const category = typeof req.query.category === 'string' && ALLOWED_CATEGORIES.includes(req.query.category)
      ? req.query.category
      : null;

    const minPrice = isSafeNumber(req.query.minPrice, 0) ? Number(req.query.minPrice) : null;
    const maxPrice = isSafeNumber(req.query.maxPrice, 0) ? Number(req.query.maxPrice) : null;

    const sort = ALLOWED_SORTS.includes(req.query.sort) ? req.query.sort : 'newest';
    const page = Math.max(1, Math.min(1000, parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 24));

    if (mongoose.connection.readyState !== 1) {
      let filtered = fallbackCatalog.filter(p => p.active);
      if (category) filtered = filtered.filter(p => p.category === category);
      if (q) {
        const lowerQ = q.toLowerCase();
        filtered = filtered.filter(p => p.name.toLowerCase().includes(lowerQ) || p.description.toLowerCase().includes(lowerQ));
      }
      if (minPrice !== null) filtered = filtered.filter(p => p.price >= minPrice);
      if (maxPrice !== null) filtered = filtered.filter(p => p.price <= maxPrice);

      if (sort === 'price-asc') filtered.sort((a, b) => a.price - b.price);
      else if (sort === 'price-desc') filtered.sort((a, b) => b.price - a.price);

      const total = filtered.length;
      const items = filtered.slice((page - 1) * limit, page * limit);
      return res.json({ items, total, page });
    }

    const filter = { active: true, legalReview: 'approved' };
    if (category) filter.category = category;
    if (q) filter.$text = { $search: q };

    if (minPrice !== null || maxPrice !== null) {
      filter.price = {};
      if (minPrice !== null) filter.price.$gte = minPrice;
      if (maxPrice !== null) filter.price.$lte = maxPrice;
    }

    const sortBy = sort === 'price-asc' ? { price: 1 } : sort === 'price-desc' ? { price: -1 } : { createdAt: -1 };

    const [items, total] = await Promise.all([
      Product.find(filter)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter)
    ]);

    res.json({ items, total, page });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (mongoose.connection.readyState !== 1) {
      const item = fallbackCatalog.find(p => p._id === id || p.sku === id);
      if (!item) return res.status(404).json({ message: 'Product not found.' });
      return res.json(item);
    }

    if (!isValidObjectId(id)) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const item = await Product.findOne({ _id: id, active: true, legalReview: 'approved' });
    if (!item) return res.status(404).json({ message: 'Product not found.' });
    res.json(item);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/recommendations', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (mongoose.connection.readyState !== 1) {
      const source = fallbackCatalog.find(p => p._id === id || p.sku === id);
      if (!source) return res.json([]);
      const related = fallbackCatalog
        .filter(p => p._id !== source._id && (p.category === source.category || p.tags.some(t => source.tags.includes(t))))
        .slice(0, 8);
      return res.json(related);
    }

    if (!isValidObjectId(id)) {
      return res.json([]);
    }

    const source = await Product.findOne({ _id: id, active: true, legalReview: 'approved' });
    if (!source) return res.json([]);

    const related = await Product.find({
      _id: { $ne: source._id },
      active: true,
      legalReview: 'approved',
      $or: [{ category: source.category }, { tags: { $in: source.tags || [] } }]
    }).limit(8).lean();

    res.json(related);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/price-comparison', async (req, res, next) => {
  try {
    const { id } = req.params;
    let product;

    if (mongoose.connection.readyState !== 1) {
      product = fallbackCatalog.find(item => item._id === id || item.sku === id);
    } else if (isValidObjectId(id)) {
      product = await Product.findOne({ _id: id, active: true, legalReview: 'approved' }).select('name brand category price sku').lean();
    }

    if (!product) return res.status(404).json({ message: 'Product not found.' });

    const comparisonProduct = {
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price
    };
    const cached = await findCachedPriceComparison(comparisonProduct);
    if (cached) return res.json(cached);

    return publicPriceCompareLimiter(req, res, () => {
      getPriceComparison(comparisonProduct, { cacheChecked: true })
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

export default router;
