/**
 * Deeply sanitizes an object or array by stripping out keys that begin with '$'
 * or contain '.' to prevent MongoDB / NoSQL query injection attacks.
 */
function cleanNoSqlInjection(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => cleanNoSqlInjection(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    // Block MongoDB query operators ($gt, $ne, $where, etc.) and dotted path injection
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }
    cleaned[key] = cleanNoSqlInjection(value);
  }
  return cleaned;
}

/**
 * Express middleware to sanitize req.body, req.query, and req.params against NoSQL injection.
 */
export function noSqlSanitizer(req, _res, next) {
  // Signed payment webhooks must retain the original bytes for HMAC checks.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = cleanNoSqlInjection(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = cleanNoSqlInjection(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = cleanNoSqlInjection(req.params);
  }
  next();
}
