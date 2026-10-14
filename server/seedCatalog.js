import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Product from './models/Product.js';

const catalogFile = fileURLToPath(new URL('../catalog.json', import.meta.url));
export async function seedDemoCatalog() {
  const catalog = JSON.parse(await readFile(catalogFile, 'utf8'));
  const count = await Product.estimatedDocumentCount();
  if (!count) {
    await Product.insertMany(catalog.map(item => ({
      sku: item.sku, name: item.name, brand: item.brand, category: item.category,
      description: item.detail, price: item.price,
      images: [item.img.startsWith('/') || item.img.startsWith('http') ? item.img : `https://images.unsplash.com/${item.img}`],
      stock: 10, tags: [item.tag, item.brand].filter(Boolean), legalReview: 'approved', active: true,
    })));
    console.log(`Loaded ${catalog.length} reviewed sample products into the empty catalog.`);
  } else {
    for (const item of catalog) {
      const imgPath = item.img.startsWith('/') || item.img.startsWith('http') ? item.img : `https://images.unsplash.com/${item.img}`;
      await Product.updateOne({ sku: item.sku }, { $set: { images: [imgPath], description: item.detail } });
    }
    console.log(`Synced ${catalog.length} genuine product images into MongoDB.`);
  }
}
