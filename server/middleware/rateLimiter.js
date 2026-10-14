import rateLimit from 'express-rate-limit';

/**
 * General API Rate Limiter
 * Restricts excessive traffic across all API endpoints.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests from this network, please try again in a few minutes.' }
});

/**
 * Strict Rate Limiter for Authentication endpoints
 * Protects login and registration against brute force and credential stuffing attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please wait 15 minutes before trying again.' }
});

/**
 * Checkout & Order Submission Limiter
 * Prevents checkout spam and automated stock lock-up attempts.
 */
export const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many checkout requests. Please wait a few moments before trying again.' }
});

/**
 * Seller Application Limiter
 * Restricts frequent application spam.
 */
export const sellerApplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many seller applications submitted. Please try again later.' }
});

/**
 * Competitor Price Search Limiter
 * Protects AI search quotas and prevents API abuse.
 */
export const competitorPriceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Please wait a minute before checking more product prices.' }
});

/** Public marketplace price checks are quota-backed; keep lookup volume modest. */
export const publicPriceCompareLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Please wait before checking more product prices.' }
});
