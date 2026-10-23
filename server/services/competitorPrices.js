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
const promptFor = ({ name, brand, category, price }) => `Find up to 2 current India market price offers for this exact product (or closest match). Return compact JSON only. Product: ${name}. Brand: ${brand || 'unknown'}. Category: ${category || 'unknown'}. Our current price: INR ${price ?? 'unknown'}. Allowed retailers: Amazon India (amazon.in), Flipkart (flipkart.com), Myntra (myntra.com), AJIO (ajio.com), Tata CLiQ (tatacliq.com), Nykaa (nykaa.com), Croma (croma.com), Reliance Digital (reliancedigital.in). Return JSON only: {"results":[{"retailer":"Amazon India|Flipkart|Myntra|AJIO|Tata CLiQ|Nykaa|Croma|Reliance Digital","productTitle":"...","priceInr":1234,"url":"https://...","match":"exact|close|uncertain","evidence":"short price evidence or typical market listing","availability":"available|unknown"}]}. Use live search results when available, or reliable retailer market listings with a valid product or search URL on the retailer's official domain. Prices are snapshots and can change.`;

let groundingCooldownUntil = 0;

async function geminiSearch(product) {
  const primaryModel = process.env.GEMINI_PRICE_MODEL || 'gemini-3.5-flash-lite';
  const apiKey = process.env.GEMINI_API_KEY;
  const modelsToTry = [
    primaryModel,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash'
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  const canAttemptGrounding = Date.now() > groundingCooldownUntil;
  let response;
  let data;
  let activeModel = primaryModel;

  // 1. Try with Google Search Grounding first on primary model
  if (canAttemptGrounding) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(primaryModel)}:generateContent`;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptFor(product) }] }], tools: [{ google_search: {} }] }),
        signal: AbortSignal.timeout(20000),
      });
      data = await response.json().catch(() => ({}));
    } catch (err) {
      console.warn(`[PriceCompare] Google Search grounding network error: ${err.message}`);
    }
  }

  // 2. If Search Grounding hit quota or failed, fallback to direct generation, trying candidate models if 503/429
  if (!response?.ok) {
    if (canAttemptGrounding && (response?.status === 429 || /quota|rate.?limit|resource.?exhausted|tools|not.?supported/i.test(data?.error?.message || ''))) {
      groundingCooldownUntil = Date.now() + 15 * 60 * 1000;
      console.warn(`[PriceCompare] Live search grounding quota exhausted (${data?.error?.message || response?.status}). Switching to Gemini direct model generation...`);
    }

    for (const m of modelsToTry) {
      activeModel = m;
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptFor(product) }] }] }),
          signal: AbortSignal.timeout(25000),
        });
        data = await response.json().catch(() => ({}));
        if (response.ok) break;
        console.warn(`[PriceCompare] Model ${m} returned ${response.status} (${data?.error?.message || 'error'}). Trying fallback...`);
      } catch (err) {
        console.warn(`[PriceCompare] Model ${m} fetch error: ${err.message}`);
      }
    }
  }

  if (!response?.ok) {
    const error = new Error(data?.error?.message || `Gemini returned ${response?.status || 'service unavailable'}`);
    error.status = response?.status || 503;
    error.quota = response?.status === 429 || /quota|rate.?limit|resource.?exhausted/i.test(error.message);
    throw error;
  }

  const raw = data.candidates?.[0]?.content?.parts?.map(x => x.text || '').join('\n');
  const citations = (data.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map(x => x.web?.uri).filter(Boolean);
  const provider = citations.length ? 'Gemini + Google Search' : `Gemini AI Market Estimate (${activeModel})`;
  return { provider, raw, citations };
}

async function openRouterSearch(product) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'Dukaan price comparison' },
    body: JSON.stringify({
      model: process.env.OPENROUTER_PRICE_MODEL || 'google/gemini-2.5-flash',
      max_tokens: 600,
      messages: [{ role: 'user', content: promptFor(product) }],
      tools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa', allowed_domains: allowedDomains, max_results: 2, max_total_results: 3, max_uses: 1 } }],
      max_tool_calls: 1
    }),
    signal: AbortSignal.timeout(12000),
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
    const retailer = RETAILERS.find(r => r.name === x.retailer && r.domains.some(d => {
      try { return new URL(x.url).hostname.toLowerCase().endsWith(d); } catch { return false; }
    }));
    if (!retailer) return false;
    if (result.citations?.length) {
      return result.citations.some(c => {
        try {
          const h = new URL(c).hostname.toLowerCase();
          return retailer.domains.some(d => h === d || h.endsWith(`.${d}`));
        } catch { return false; }
      });
    }
    return true;
  }).map(x => {
    const retailer = RETAILERS.find(r => r.name === x.retailer);
    const sourceUrl = result.citations?.find(c => {
      try {
        const h = new URL(c).hostname.toLowerCase();
        return retailer.domains.some(d => h === d || h.endsWith(`.${d}`));
      } catch { return false; }
    });
    return {
      retailer: x.retailer,
      productTitle: String(x.productTitle || '').slice(0, 180),
      priceInr: Number(x.priceInr),
      url: sourceUrl || x.url,
      match: ['exact','close','uncertain'].includes(x.match) ? x.match : 'uncertain',
      evidence: String(x.evidence || '').slice(0, 240),
      availability: x.availability === 'available' ? 'available' : 'unknown'
    };
  });
  return { product, offers, provider: result.provider, checkedAt: new Date().toISOString(), note: 'Search-assisted snapshot. Confirm the listing and final price at the retailer; price, size, delivery and stock may vary.' };
}
