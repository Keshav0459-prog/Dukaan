import mongoose from 'mongoose';
const productSchema = new mongoose.Schema({
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true }, brand: String, description: String,
  category: { type: String, enum: ['Electronics','Fashion','Beauty','Home','Kitchen','Sports','Accessories','Books'], required: true, index: true },
  price: { type: Number, required: true, min: 0 }, images: [String], stock: { type: Number, default: 0, min: 0 }, tags: [String],
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  legalReview: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  active: { type: Boolean, default: false }, embedding: [Number]
}, { timestamps: true });
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
export default mongoose.model('Product', productSchema);
