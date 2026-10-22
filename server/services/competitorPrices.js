const RETAILERS = [
  { name: 'Amazon India', domains: ['amazon.in'] },
  { name: 'Flipkart', domains: ['flipkart.com'] },
  { name: 'Myntra', domains: ['myntra.com'] },
  { name: 'AJIO', domains: ['ajio.com'] },
  { name: 'Tata CLiQ', domains: ['tatacliq.com'] },
  { name: 'Nykaa', domains: ['nykaa.com'] },
  { name: 'Croma', domains: ['croma.com'] },
  { name: 'Reliance Digital', domains: ['reliancedigital.in'] },
];
const allowedDomains = RETAILERS.flatMap(x => x.domains);
const hostAllowed = raw => {
  try { const host = new URL(raw).hostname.toLowerCase(); return allowedDomains.some(d => host === d || host.endsWith(`.${d}`)); }
  catch { return false; }
};
const trimJson = raw => {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const first = text.indexOf('{'), last = text.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Price search returned no structured result.');
  return JSON.parse(text.slice(first, last + 1));
};
const promptFor = ({ name, brand, category, price }) => `Find current public listing offers for the exact or closest matching product in India. Product: ${name}. Brand: ${brand || 'unknown'}. Category: ${category || 'unknown'}. Our current price: INR ${price ?? 'unknown'}. Search only these retailers: Amazon India (amazon.in), Flipkart (flipkart.com), Myntra (myntra.com), AJIO (ajio.com), Tata CLiQ (tatacliq.com), Nykaa (nykaa.com), Croma (croma.com), Reliance Digital (reliancedigital.in). Return JSON only: {"results":[{"retailer":"Amazon India|Flipkart|Myntra|AJIO|Tata CLiQ|Nykaa|Croma|Reliance Digital","productTitle":"...","priceInr":1234,"url":"https://...","match":"exact|close|uncertain","evidence":"short price evidence from search result","availability":"available|unknown"}]}. Include only prices you can see in live search results, do not infer or invent a price. Include a direct product page URL on that retailer's domain. If there is no verifiable offer, omit it. Prices are search snapshots and can change.`;

async function geminiSearch(product) {
  const model = process.env.GEMINI_PRICE_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptFor(product) }] }], tools: [{ google_search: {} }] }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `Gemini returned ${response.status}`); error.status = response.status; error.quota = response.status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(error.message); throw error; }
  return { provider: 'Gemini + Google Search', raw: data.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n'), citations: (data.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(x => x.web?.uri).filter(Boolean) };
}

async function openRouterSearch(product) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'Dukaan price comparison' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_PRICE_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 1000,
      messages: [{ role: 'user', content: promptFor(product) }],
      tools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa', allowed_domains: allowedDomains, max_results: 3, max_total_results: 5, max_uses: 1 } }],
      max_tool_calls: 2
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `OpenRouter returned ${response.status}`); error.status = response.status; throw error; }
  const msg = data.choices?.[0]?.message;
  const citations = (msg?.annotations || []).map(x => x.url_citation?.url || x.url).filter(Boolean);
  return { provider: 'OpenRouter web search', raw: msg?.content, citations };
}

export async function comparePrices(product) {
  let result, primaryError;
  if (process.env.GEMINI_API_KEY) {
    try { result = await geminiSearch(product); }
    catch (error) {
      primaryError = error;
      console.warn(`[PriceCompare] Gemini search failed (${error.message}). Falling back to OpenRouter...`);
    }
  }
  if (!result && process.env.OPENROUTER_API_KEY) {
    try { result = await openRouterSearch(product); }
    catch (error) {
      console.warn(`[PriceCompare] OpenRouter search failed (${error.message}).`);
      if (!primaryError) primaryError = error;
    }
  }
  if (!result) {
    const error = new Error(primaryError?.message || 'Price search service is temporarily unavailable.');
    error.status = 503; throw error;
  }
  let parsed;
  try { parsed = trimJson(result.raw); }
  catch { if (result.provider.startsWith('Gemini') && process.env.OPENROUTER_API_KEY) { result = await openRouterSearch(product); parsed = trimJson(result.raw); } else throw new Error('Could not safely read the search results. Please try again.'); }
  const offers = (Array.isArray(parsed.results) ? parsed.results : []).filter(x => {
    if (!x || !hostAllowed(x.url) || !Number.isFinite(Number(x.priceInr)) || Number(x.priceInr) <= 0) return false;
    const retailer = RETAILERS.find(r => r.name === x.retailer && r.domains.some(d => new URL(x.url).hostname.toLowerCase().endsWith(d)));
    return Boolean(retailer && result.citations.some(c => { try { const h = new URL(c).hostname.toLowerCase(); return retailer.domains.some(d => h === d || h.endsWith(`.${d}`)); } catch { return false; } }));
  }).map(x => { const retailer = RETAILERS.find(r => r.name === x.retailer); const sourceUrl = result.citations.find(c => { try { const h = new URL(c).hostname.toLowerCase(); return retailer.domains.some(d => h === d || h.endsWith(`.${d}`)); } catch { return false; } }); return { retailer: x.retailer, productTitle: String(x.productTitle || '').slice(0, 180), priceInr: Number(x.priceInr), url: sourceUrl || x.url, match: ['exact','close','uncertain'].includes(x.match) ? x.match : 'uncertain', evidence: String(x.evidence || '').slice(0, 240), availability: x.availability === 'available' ? 'available' : 'unknown' }; });
  return { product, offers, provider: result.provider, checkedAt: new Date().toISOString(), note: 'Search-assisted snapshot. Confirm the listing and final price at the retailer; price, size, delivery and stock may vary.' };
}
