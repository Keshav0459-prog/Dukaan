import { createWriteStream, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

const items = [
  {
    sku: "APPLE-IP16-128",
    file: "apple-iphone-16.png",
    url: "https://cdsassets.apple.com/live/7WUAS350/images/tech-specs/iphone-16.png"
  },
  {
    sku: "SAMSUNG-A56-128",
    file: "samsung-galaxy-a56.jpg",
    url: "https://images.samsung.com/is/image/samsung/p6pim/in/feature/165109871/in-feature-galaxy-a55-5g-sm-a556-498926-540539395?$FB_TYPE_A_MO_JPG$"
  },
  {
    sku: "XIAOMI-R14C-128",
    file: "xiaomi-redmi-14c.png",
    url: "https://i02.appmifile.com/822_operator_sg/20/08/2024/906a27f2be1d5f366e92536a39feeeaa.png"
  },
  {
    sku: "LENOVO-IDEAPAD-R5",
    file: "lenovo-ideapad-slim-3.png",
    url: "https://p3-ofp.static.pub//fes/cms/2024/04/29/09bkal2ihkgzk5u7ztpfx54w8xeitl660072.png"
  },
  {
    sku: "SONY-WHCH520",
    file: "sony-wh-ch520.jpg",
    url: "https://sony.scene7.com/is/image/sonyglobalsolutions/wh-ch520_Primary_image?$primaryshotPreset$&fmt=pjpeg&resMode=bisharp&wid=600"
  },
  {
    sku: "BOAT-AIRDOPES141",
    file: "boat-airdopes-141.jpg",
    url: "https://www.boat-lifestyle.com/cdn/shop/files/AD141-FI_Black06_600x.jpg?v=1722247855"
  },
  {
    sku: "APPLE-WATCHSE40",
    file: "apple-watch-se.png",
    url: "https://cdsassets.apple.com/live/SZLF0YNV/images/sp/111853_apple-watch-se-2nd-gen.png"
  },
  {
    sku: "ROADSTER-COTTON-TEE",
    file: "roadster-cotton-tshirt.jpg",
    url: "https://assets.myntassets.com/assets/images/31410745/2025/3/11/1191d150-e28c-42a0-a225-4c4ed8ae6ccb1741669684144-Roadster-Men-Tshirts-1871741669683513-1.jpg"
  },
  {
    sku: "LEVIS-STRAIGHT-DENIM",
    file: "levis-straight-jeans.jpg",
    url: "https://levi.in/cdn/shop/files/006BB0001_01_Styleshot_3ec52fbb-beb8-4d50-955b-57b40dca3dde.jpg?v=1791539619&width=720"
  },
  {
    sku: "PUMA-COURT-CLASSIC",
    file: "puma-court-classic.png",
    url: "https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,w_600,h_600/global/395018/05/sv01/fnd/IND/fmt/png/Court-Classic-Sneakers"
  },
  {
    sku: "FOSSIL-QUARTZ-WATCH",
    file: "fossil-minimalist-watch.png",
    url: "https://img.fossil.in/uploads/fsin/dealimages/26/2/detailimages/fs5304_1.png"
  },
  {
    sku: "NIVEA-LIP-BALM",
    file: "nivea-lip-balm.jpg",
    url: "https://assets.beiersdorf.com/-/media/images/1/b/7/e/74e58b7fbc9e41f4938d5c6796fb18f3-print.jpg?ctx=IN"
  },
  {
    sku: "MINIMALIST-SPF50",
    file: "minimalist-sunscreen-spf50.jpg",
    url: "https://beminimalist.co/cdn/shop/files/SPF50New.jpg"
  },
  {
    sku: "PLUM-SKIN-SET",
    file: "plum-green-tea-skincare-set.webp",
    url: "https://plumgoodness.com/cdn/shop/files/Combo-SKUs-GT-CTM-Routine-1st-Tile-1001x1001-px_c78878f1-b05f-480f-9352-fbff0023da43.webp?v=1780061126&width=1024"
  },
  {
    sku: "AARA-STONEWARE-VASE",
    file: "aara-stoneware-vase.jpg",
    url: "https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?auto=format&fit=crop&w=800&q=85"
  },
  {
    sku: "AARA-LINEN-THROW",
    file: "aara-linen-throw.jpg",
    url: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?auto=format&fit=crop&w=800&q=85"
  },
  {
    sku: "AARA-ARC-CHAIR",
    file: "aara-arc-lounge-chair.jpg",
    url: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=800&q=85"
  },
  {
    sku: "AARA-COFFEE-SET",
    file: "aara-handthrown-coffee-set.jpg",
    url: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=800&q=85"
  },
  {
    sku: "PRESTIGE-COOKER-3L",
    file: "prestige-pressure-cooker-3l.png",
    url: "https://rukminim3.flixcart.com/image/800/800/xif0q/pressure-cooker/o/g/2/-enriched-transparent-original-imahggfeydefbgke.png"
  },
  {
    sku: "PHILIPS-DRIP-COFFEE",
    file: "philips-drip-coffee-maker.png",
    url: "https://images.philips.com/is/image/philipsconsumer/vrs_9d1ce243_4fe3_41d8_b2c62916c717fc45?$png$&wid=600&hei=600&fit=constrain"
  },
  {
    sku: "BOLDFIT-YOGA-MAT",
    file: "boldfit-yoga-mat.jpg",
    url: "https://www.boldfit.com/cdn/shop/files/Artboard_1_5801af58-839c-4ed9-b3a1-07551303fa2c.jpg?v=1746598679"
  },
  {
    sku: "STRAUSS-RESISTANCE-BANDS",
    file: "strauss-resistance-bands.jpg",
    url: "https://strausssport.com/cdn/shop/files/71EmM6yelVL.jpg?v=1738392747"
  },
  {
    sku: "SKYBAGS-COMMUTER-28L",
    file: "skybags-commuter-backpack.webp",
    url: "https://vipbags.com/cdn/shop/files/1_b15e37e0-1df4-4100-8501-fe6627fd1697.webp?v=1783957318&width=800"
  },
  {
    sku: "ANKER-USBC-BRAIDED-1M",
    file: "anker-braided-usbc-cable.png",
    url: "https://cdn.shopify.com/s/files/1/0493/9834/9974/files/SKU-06-3ft_Black.png?v=1768185584"
  },
  {
    sku: "HARPER-ALMANACK-PB",
    file: "almanack-naval-ravikant.jpg",
    url: "https://images.squarespace-cdn.com/content/v1/5d23ae6c3b89290001fe3cdb/f70611c8-672f-410c-8f63-738aecc7acb1/almanack-Banner-Update.jpg"
  },
  {
    sku: "AARA-QUIET-CANDLE",
    file: "aara-quiet-candle.jpg",
    url: "https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=800&q=85"
  }
];

const targetDir = resolve('public/products');

async function download(item) {
  const dest = resolve(targetDir, item.file);
  try {
    const res = await fetch(item.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stream = createWriteStream(dest);
    await pipeline(res.body, stream);
    console.log(`✓ [${item.sku}] -> ${item.file}`);
    return { sku: item.sku, file: `/products/${item.file}`, success: true };
  } catch (err) {
    console.error(`✗ [${item.sku}] Error:`, err.message);
    return { sku: item.sku, file: null, success: false, error: err.message };
  }
}

async function main() {
  console.log(`Downloading ${items.length} authentic product images...`);
  const results = [];
  for (const item of items) {
    const r = await download(item);
    results.push(r);
  }
  console.log(`Done! ${results.filter(r => r.success).length}/${items.length} downloaded successfully.`);
}

main();
