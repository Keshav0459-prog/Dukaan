import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { comparePrices } from './competitorPrices.js';

const CACHE_COLLECTION = 'price_comparison_cache';
const CACHE_TTL_HOURS = Math.min(168, Math.max(1, Number.parseInt(process.env.PRICE_COMPARISON_CACHE_HOURS || '6', 10) || 6));
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
const DAILY_AI_BUDGET = Math.max(1, Number.parseInt(process.env.DAILY_AI_BUDGET || '100', 10) || 100);
const localCache = new Map();
const inFlight = new Map();
let localDailyAiRequests = 0;
let localBudgetResetAt = Date.now() + 24 * 60 * 60 * 1000;
let indexPromise;

function comparisonKey(product) {
  const identity = [product.name, product.brand || '', product.category || '']
    .map(value => String(value).normalize('NFKC').trim().toLocaleLowerCase('en-IN').replace(/\s+/g, ' '));
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function getCollection() {
  if (mongoose.connection.readyState !== 1) return null;
  const collection = mongoose.connection.collection(CACHE_COLLECTION);
  if (!indexPromise) {
    indexPromise = collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch(error => {
        indexPromise = null;
        console.warn('[PriceCompare] Could not create cache expiry index:', error.message);
      });
  }
  await indexPromise;
  return collection;
}

function present(entry, product, cacheHit) {
  return {
    ...entry.result,
    product: { ...entry.result.product, ...product },
    cache: { hit: cacheHit, expiresAt: entry.expiresAt.toISOString() }
  };
}

async function readCache(key, product) {
  const now = Date.now();
  const local = localCache.get(key);
  if (local && local.expiresAt.getTime() > now) return present(local, product, true);
  if (local) localCache.delete(key);

  const collection = await getCollection();
  if (!collection) return null;
  const record = await collection.findOne({ _id: key, expiresAt: { $gt: new Date(now) } });
  if (!record || !record.result || !(record.expiresAt instanceof Date)) return null;
  const entry = { result: record.result, expiresAt: record.expiresAt };
  remember(key, entry);
  return present(entry, product, true);
}

export async function findCachedPriceComparison(product) {
  return readCache(comparisonKey(product), product);
}

function remember(key, entry) {
  localCache.delete(key);
  localCache.set(key, entry);
  if (localCache.size > 200) localCache.delete(localCache.keys().next().value);
}

async function consumeAiBudget() {
  if (mongoose.connection.readyState !== 1) {
    if (process.env.NODE_ENV === 'production') {
      const error = new Error('Price comparison is temporarily unavailable while the database reconnects.');
      error.status = 503;
      throw error;
    }
    if (Date.now() >= localBudgetResetAt) {
      localDailyAiRequests = 0;
      localBudgetResetAt = Date.now() + 24 * 60 * 60 * 1000;
    }
    if (localDailyAiRequests >= DAILY_AI_BUDGET) throw quotaError();
    localDailyAiRequests++;
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  const collection = mongoose.connection.collection('price_compare_usage');
  const result = await collection.findOneAndUpdate(
    { _id: day },
    { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  const count = result?.value?.count ?? result?.count;
  if (Number(count) > DAILY_AI_BUDGET) throw quotaError();
}

function quotaError() {
  const error = new Error('Daily AI price check quota reached. Please view our store catalog or check back tomorrow.');
  error.status = 429;
  return error;
}

export async function getPriceComparison(product, { cacheChecked = false } = {}) {
  const key = comparisonKey(product);
  const cached = cacheChecked ? null : await readCache(key, product);
  if (cached) return cached;

  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      await consumeAiBudget();
      const result = await comparePrices(product);
      const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
      const entry = { result, expiresAt };
      remember(key, entry);
      try {
        const collection = await getCollection();
        if (collection) await collection.updateOne(
          { _id: key },
          { $set: { result, expiresAt, updatedAt: new Date() } },
          { upsert: true }
        );
      } catch (error) {
        console.warn('[PriceCompare] Could not persist comparison cache:', error.message);
      }
      return entry;
    })();
    inFlight.set(key, pending);
  }

  try {
    const entry = await pending;
    return present(entry, product, false);
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}
