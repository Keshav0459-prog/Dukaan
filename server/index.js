import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import orderRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';
import sellerRoutes from './routes/seller.js';
import { seedDemoCatalog } from './seedCatalog.js';
import { noSqlSanitizer } from './middleware/sanitize.js';
import { apiLimiter } from './middleware/rateLimiter.js';

const app = express();

// Render terminates TLS and forwards requests through one trusted proxy hop.
// Set TRUST_PROXY_HOPS explicitly when the deployment topology changes.
const proxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || (process.env.NODE_ENV === 'production' ? '1' : '0'), 10);
if (Number.isInteger(proxyHops) && proxyHops >= 0 && proxyHops <= 5) app.set('trust proxy', proxyHops);
else throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');

// Disable Express fingerprinting
app.disable('x-powered-by');

// Security HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://images.unsplash.com', 'https://cdn.razorpay.com'],
      connectSrc: ["'self'", process.env.CLIENT_URL || 'http://localhost:5173', 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
      frameSrc: ["'self'", 'https://checkout.razorpay.com', 'https://api.razorpay.com']
    }
  }
}));

// CORS Configuration
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests or matching origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Cross-origin request blocked by security policy.'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature'],
  maxAge: 86400
}));

// Razorpay signs the exact raw webhook body; parse it before the JSON middleware.
app.use('/api/orders/webhook', express.raw({ type: 'application/json', limit: '100kb' }));

// Body parser with size limits to prevent payload bloat / buffer exhaustion DoS
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// NoSQL Injection sanitizer
app.use(noSqlSanitizer);

// Global API rate limiting
app.use('/api', apiLimiter);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'degraded',
    service: 'dukaan-api',
    database: databaseConnected ? 'connected' : 'disconnected'
  });
});

// Route handlers
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/seller', sellerRoutes);

// Centralized error handling & sanitization
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ message: 'Malformed JSON payload.' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid resource identifier format.' });
  }
  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message || 'Validation failed.' });
  }
  if (err.message && err.message.includes('blocked by security policy')) {
    return res.status(403).json({ message: err.message });
  }

  const statusCode = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  console.error(`[Security/Error] ${statusCode}:`, err.message);

  const clientMessage = statusCode >= 500
    ? (process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : (err.message || 'Server error'))
    : (err.message || 'Request failed.');

  res.status(statusCode).json({ message: clientMessage });
});

const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri && process.env.NODE_ENV === 'production') {
  console.error('FATAL: MONGODB_URI is required in production. Refusing to start.');
  process.exit(1);
}

try {
  await mongoose.connect(mongoUri || 'mongodb://127.0.0.1:27017/dukaan-market', {
    serverSelectionTimeoutMS: 10000
  });
  await seedDemoCatalog();
  console.log('MongoDB connected and catalog seeded.');
} catch (err) {
  const requiresConfiguredDatabase = process.env.NODE_ENV === 'production' || Boolean(mongoUri);
  console.warn('MongoDB connection failed:', err.message);
  if (requiresConfiguredDatabase) {
    console.error('FATAL: Configured database connection failed. Refusing to start in standalone mode.');
    process.exit(1);
  }
  console.log('Dukaan API starting in standalone/in-memory mode (development only).');
}

app.listen(port, () => console.log(`Dukaan API listening on http://localhost:${port}`));
