import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { requireAuth, getJwtSecret } from '../middleware/auth.js';
import { authLimiter, sellerApplyLimiter } from '../middleware/rateLimiter.js';
import { isValidEmail, sanitizeString, isValidObjectId } from '../utils/validation.js';

const router = Router();
const inMemoryUsers = [];
if (process.env.NODE_ENV !== 'production') {
  const demoAccounts = [
    { id: 'customer_demo_1', name: 'Demo Customer', email: process.env.DEV_DEMO_CUSTOMER_EMAIL, password: process.env.DEV_DEMO_CUSTOMER_PASSWORD, role: 'customer' },
    { id: 'admin_demo_1', name: 'Demo Admin', email: process.env.DEV_DEMO_ADMIN_EMAIL, password: process.env.DEV_DEMO_ADMIN_PASSWORD, role: 'admin' }
  ];
  for (const account of demoAccounts) {
    if (account.email && account.password && account.password.length >= 8) {
      inMemoryUsers.push({
        _id: account.id,
        name: account.name,
        email: account.email.toLowerCase().trim(),
        passwordHash: bcrypt.hashSync(account.password, 10),
        role: account.role,
        sellerStatus: 'none'
      });
    }
  }
}

const safeUser = user => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  sellerStatus: user.sellerStatus || 'none',
  storeName: user.storeName || ''
});

const issue = user => jwt.sign(
  { sub: String(user._id), role: user.role, sellerStatus: user.sellerStatus || 'none' },
  getJwtSecret(),
  { expiresIn: '24h', algorithm: 'HS256' }
);

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email, and password must be provided as text.' });
    }

    const cleanName = sanitizeString(name, 100);
    const cleanEmail = email.toLowerCase().trim();

    if (cleanName.length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters long.' });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({ message: 'Please provide a valid email address.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    if (password.length > 128) {
      return res.status(400).json({ message: 'Password is too long (maximum 128 characters).' });
    }

    if (mongoose.connection.readyState === 1) {
      const existing = await User.findOne({ email: cleanEmail }).lean();
      if (existing) {
        return res.status(409).json({ message: 'An account with this email already exists.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({
        name: cleanName,
        email: cleanEmail,
        passwordHash,
        role: 'customer'
      });
      return res.status(201).json({ token: issue(user), user: safeUser(user) });
    }

    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ message: 'Registration is currently unavailable. Database connection is required.' });
    }

    if (inMemoryUsers.some(u => u.email === cleanEmail)) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      _id: 'user_' + Date.now(),
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      role: 'customer',
      sellerStatus: 'none'
    };
    inMemoryUsers.push(user);
    return res.status(201).json({ token: issue(user), user: safeUser(user) });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    next(e);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail || !password || password.length > 128) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    let user;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: cleanEmail });
    } else {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ message: 'Authentication is currently unavailable. Database connection is required.' });
      }
      user = inMemoryUsers.find(u => u.email === cleanEmail);
    }

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' });
    }

    return res.json({ token: issue(user), user: safeUser(user) });
  } catch (e) {
    next(e);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    let user;
    if (mongoose.connection.readyState === 1) {
      if (!isValidObjectId(req.user.sub)) {
        return res.status(400).json({ message: 'Invalid user identifier in token.' });
      }
      user = await User.findById(req.user.sub);
    } else {
      if (process.env.NODE_ENV === 'production') {
        return res.status(503).json({ message: 'Account service is currently unavailable.' });
      }
      user = inMemoryUsers.find(u => u._id === req.user.sub);
    }

    if (!user) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    return res.json({ user: safeUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/seller/apply', requireAuth, sellerApplyLimiter, async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Seller applications need the connected database.' });
    }

    if (!isValidObjectId(req.user.sub)) {
      return res.status(400).json({ message: 'Invalid user identifier.' });
    }

    const storeName = sanitizeString(req.body.storeName, 80);
    if (storeName.length < 2) {
      return res.status(400).json({ message: 'Enter a store name with at least 2 characters.' });
    }

    const user = await User.findById(req.user.sub);
    if (!user || user.role === 'admin') {
      return res.status(403).json({ message: 'This account cannot apply as a seller.' });
    }

    if (user.sellerStatus === 'approved') {
      return res.status(409).json({ message: 'This seller account is already approved.' });
    }

    user.storeName = storeName;
    user.sellerStatus = 'pending';
    await user.save();
    return res.json({ user: safeUser(user), message: 'Application sent for review.' });
  } catch (e) {
    next(e);
  }
});

export default router;
