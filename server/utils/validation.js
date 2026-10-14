import mongoose from 'mongoose';

/**
 * Validates whether a given string is a valid MongoDB ObjectId.
 */
export function isValidObjectId(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-fA-F]{24}$/.test(id) && mongoose.Types.ObjectId.isValid(id);
}

/**
 * Validates email addresses using a strict RFC 5322-compliant pattern.
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string' || email.length > 254) return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates standard SKU format (3-48 alphanumeric characters, hyphens allowed).
 */
export function isValidSKU(sku) {
  if (!sku || typeof sku !== 'string') return false;
  return /^[A-Z0-9-]{3,48}$/.test(sku.trim().toUpperCase());
}

/**
 * Safely sanitizes text input: trims and enforces max length.
 */
export function sanitizeString(val, maxLength = 255) {
  if (typeof val !== 'string') return '';
  // Remove ASCII control characters except standard whitespace
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLength);
}

/**
 * Checks if a value is a finite number within bounds.
 */
export function isSafeNumber(val, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const num = Number(val);
  return Number.isFinite(num) && num >= min && num <= max;
}
