import mongoose from 'mongoose';
const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    sku: String,
    name: String,
    quantity: Number,
    unitPrice: Number
  }],
  shipping: {
    name: String,
    email: String,
    phone: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'IN' }
  },
  subtotal: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 0 },
  promoCode: String,
  amount: { type: Number, required: true },
  currency: { type: String, default: 'inr' },
  status: { type: String, enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  statusHistory: [{
    status: { type: String, enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'], required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, maxlength: 180 }
  }],
  paymentGateway: { type: String, enum: ['razorpay', 'stripe', 'demo'], default: 'razorpay' },
  stripeSessionId: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String
}, { timestamps: true });
export default mongoose.model('Order', orderSchema);
