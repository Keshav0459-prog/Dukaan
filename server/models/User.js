import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'seller', 'admin'], default: 'customer' },
  sellerStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
  storeName: { type: String, trim: true, maxlength: 80 },
}, { timestamps: true });
export default mongoose.model('User', userSchema);
