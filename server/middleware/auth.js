import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { isValidObjectId } from '../utils/validation.js';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const isDevFallback = secret === 'dukaan-dev-super-secret-key-at-least-32-chars-long';
  if (!secret || isDevFallback) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: A strong, unique JWT_SECRET environment variable is required in production (development fallback secret is prohibited)!');
    }
    return secret || 'dukaan-dev-super-secret-key-at-least-32-chars-long';
  }
  if (secret.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters long in production!');
  }
  return secret;
}

export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });

    if (!decoded || typeof decoded !== 'object' || !decoded.sub || typeof decoded.sub !== 'string') {
      return res.status(401).json({ message: 'Invalid session payload. Please sign in again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }
    return res.status(401).json({ message: 'Invalid authentication token. Please sign in again.' });
  }
}

export async function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  // Real-time revocation check against live database
  if (mongoose.connection.readyState === 1 && isValidObjectId(req.user.sub)) {
    try {
      const user = await User.findById(req.user.sub).select('role').lean();
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access revoked or account no longer active.' });
      }
    } catch {
      return res.status(500).json({ message: 'Error verifying permissions.' });
    }
  }

  next();
}

export async function requireSeller(req, res, next) {
  const isApprovedSeller = req.user?.role === 'seller' && req.user?.sellerStatus === 'approved';
  const isAdmin = req.user?.role === 'admin';

  if (!isApprovedSeller && !isAdmin) {
    return res.status(403).json({ message: 'An approved seller account is required.' });
  }

  // Real-time revocation check against live database
  if (mongoose.connection.readyState === 1 && isValidObjectId(req.user.sub)) {
    try {
      const user = await User.findById(req.user.sub).select('role sellerStatus').lean();
      if (!user) {
        return res.status(403).json({ message: 'Account no longer exists.' });
      }
      const liveApproved = user.role === 'seller' && user.sellerStatus === 'approved';
      const liveAdmin = user.role === 'admin';
      if (!liveApproved && !liveAdmin) {
        return res.status(403).json({ message: 'Seller privileges have been revoked or are no longer active.' });
      }
    } catch {
      return res.status(500).json({ message: 'Error verifying seller status.' });
    }
  }

  next();
}
