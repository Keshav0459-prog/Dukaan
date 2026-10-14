import React from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Check, ExternalLink, Minus, Plus, RefreshCw, ShoppingBag } from 'lucide-react';

const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const imageUrl = image => !image ? '' : image.startsWith('/') || image.startsWith('http') ? image : `https://images.unsplash.com/${image}?auto=format&fit=crop&w=1100&q=85`;

function descriptionFor(product) {
  const savedDescription = String(product.description || product.detail || '').trim();
  if (savedDescription.length > 85) return savedDescription;
  const details = String(product.detail || '').trim();
  return `${product.name} by ${product.brand || 'Dukaan'} is part of our ${String(product.category || 'marketplace').toLowerCase()} collection.${details ? ` ${details}.` : ''} This listing brings the key product details and current marketplace pricing together so you can make a more informed choice. Check the selected variant, seller information and final delivery details before placing your order.`;
}

function PriceBars({ product, comparison }) {
  const entries = [
    { retailer: 'Dukaan', productTitle: product.name, priceInr: Number(product.price), match: 'exact', own: true },
    ...(comparison?.offers || []).map(offer => ({ ...offer, own: false }))
  ].sort((a, b) => a.priceInr - b.priceInr);
  const minPrice = Math.min(...entries.map(item => item.priceInr));
  const maxPrice = Math.max(...entries.map(item => item.priceInr));
  const scale = value => maxPrice === minPrice ? 100 : Math.max(8, Math.round((value / maxPrice) * 100));

  return <div className="comparison-chart" role="img" aria-label="Horizontal bar chart comparing Dukaan's price with live retailer listing prices">
    {entries.map((entry, index) => <div className={`comparison-row ${entry.own ? 'comparison-own' : ''} ${entry.priceInr === minPrice ? 'comparison-lowest' : ''}`} key={`${entry.retailer}-${index}`}>
      <div className="comparison-row-label"><span>{entry.retailer}{entry.priceInr === minPrice && <i>Lowest</i>}</span><b>{money(entry.priceInr)}</b></div>
      <div className="comparison-track"><span style={{ width: `${scale(entry.priceInr)}%` }} /></div>
      {!entry.own && <small>{entry.match || 'uncertain'} match{entry.availability === 'available' ? ' · available' : ''}</small>}
    </div>)}
  </div>;
}

export default function ProductDetailPage({ product, count, onBack, onAdd, onQty, onCompare, comparison, comparing, comparisonError }) {
  if (!product) return <main className="product-page"><button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to all products</button><div className="product-not-found"><span className="eyebrow">PRODUCT NOT FOUND</span><h1>This product may have moved.</h1><button className="dark-cta" onClick={onBack}>Return to the marketplace <ArrowRight size={15}/></button></div></main>;
  const image = product.img || product.images?.[0] || '';
  const details = String(product.detail || product.description || '').split(/[·•|,]/).map(item => item.trim()).filter(Boolean);

  return <main className="product-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> Back to all products</button>
    <section className="product-detail-layout">
      <div className={`product-detail-visual ${product.color || ''}`} style={{ backgroundImage: `url(${imageUrl(image)})` }}>
        {product.tag && <span className="product-detail-tag">{product.tag}</span>}
        <span className="product-detail-image-note">DUKAAN MARKET · PRODUCT VIEW</span>
      </div>
      <div className="product-detail-copy">
        <span className="eyebrow">{product.brand || 'DUKAAN'} · {product.category || 'MARKETPLACE'}</span>
        <h1>{product.name}</h1>
        <div className="product-detail-price">{money(product.price)}{product.old && <del>{money(product.old)}</del>}</div>
        <p className="product-detail-description">{descriptionFor(product)}</p>
        {!!details.length && <div className="spec-list"><span className="eyebrow">PRODUCT DETAILS</span><ul>{details.map((item, index) => <li key={`${item}-${index}`}><Check size={14}/>{item}</li>)}</ul></div>}
        <div className="detail-actions">
          {count > 0 ? <div className="detail-counter"><button aria-label={`Remove one ${product.name}`} onClick={() => onQty(product.id, -1)}><Minus size={16}/></button><span>{count} in your bag</span><button aria-label={`Add one ${product.name}`} onClick={() => onQty(product.id, 1)}><Plus size={16}/></button></div> : <button className="dark-cta detail-add" onClick={() => onAdd(product.id)}>Add to bag <ShoppingBag size={16}/></button>}
          <span className="detail-delivery-note">Delivery and final availability are confirmed at checkout.</span>
        </div>
      </div>
    </section>

    <section className="price-comparison-section" aria-labelledby="comparison-title">
      <div className="comparison-heading"><div><span className="eyebrow">A LIVE MARKET CHECK</span><h2 id="comparison-title">Compare the <em>price.</em></h2><p>See Dukaan beside current listings from major Indian retailers.</p></div><button className="compare-refresh" onClick={onCompare} disabled={comparing}><RefreshCw size={14} className={comparing ? 'spin' : ''}/>{comparing ? 'Checking listings…' : comparison ? 'Refresh prices' : 'Check live prices'}</button></div>
      {comparing && <div className="comparison-loading"><span className="loading-pulse"/> Searching current public listings. This can take a few seconds.</div>}
      {!comparing && comparisonError && <div className="comparison-message"><p>{comparisonError}</p><button onClick={onCompare}>Try again <ArrowRight size={14}/></button></div>}
      {!comparing && comparison && <>
        {comparison.offers?.length ? <>
          <div className="comparison-summary"><span><BarChart3 size={16}/>{comparison.offers.length} retailer listing{comparison.offers.length === 1 ? '' : 's'} found</span><small>Snapshot checked {new Date(comparison.checkedAt).toLocaleString()}</small></div>
          <PriceBars product={product} comparison={comparison}/>
          <div className="comparison-offers">{comparison.offers.map((offer, index) => <a className="comparison-offer" href={offer.url} target="_blank" rel="noreferrer" key={`${offer.retailer}-${index}`}><span><b>{offer.retailer}</b><small>{offer.productTitle} · {offer.match || 'unverified'} match</small></span><strong>{money(offer.priceInr)}</strong><ExternalLink size={14}/></a>)}</div>
        </> : <div className="comparison-message"><p>No verified retailer prices were found this time. You can still compare Dukaan’s current price and check again later.</p></div>}
        <small className="comparison-disclaimer">{comparison.note} Search results may use a close product match. Confirm model, size, seller, delivery fees and final price on the retailer’s page.</small>
      </>}
      {!comparison && !comparing && !comparisonError && <div className="comparison-intro"><p>We’ll look for current listings on Amazon India, Flipkart, Myntra and other major retailers. Only sourced results are shown.</p><button className="text-link" onClick={onCompare}>Find current prices <ArrowRight size={14}/></button></div>}
    </section>
  </main>;
}
