#!/usr/bin/env node
/**
 * Updates products.json from AliExpress Affiliate API.
 * Required GitHub Actions secrets:
 *   ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_TRACKING_ID
 * Optional variables: ALIEXPRESS_API_URL, ALIEXPRESS_API_METHOD
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = process.cwd();
const sourcePath = `${root}/products-source.json`;
const productsPath = `${root}/products.json`;
const apiUrl = process.env.ALIEXPRESS_API_URL || 'https://api-sg.aliexpress.com/sync';
const apiMethod = process.env.ALIEXPRESS_API_METHOD || 'aliexpress.affiliate.product.query';
const appKey = process.env.ALIEXPRESS_APP_KEY;
const appSecret = process.env.ALIEXPRESS_APP_SECRET;
const trackingId = process.env.ALIEXPRESS_TRACKING_ID;

if (!appKey || !appSecret || !trackingId) {
  throw new Error('Missing ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, or ALIEXPRESS_TRACKING_ID');
}

const sources = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
const now = new Date().toISOString();

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function sign(params) {
  const canonical = Object.keys(params).sort().map(key => key + params[key]).join('');
  return crypto.createHash('md5').update(appSecret + canonical + appSecret).digest('hex').toUpperCase();
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function findProduct(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProduct(item);
      if (found) return found;
    }
    return undefined;
  }
  const id = firstValue(value, ['product_id', 'productId', 'item_id', 'itemId']);
  const url = firstValue(value, ['promotion_link', 'promotionLink', 'promotion_url', 'promotionUrl', 'affiliate_url', 'affiliateUrl']);
  if (id || url) return value;
  for (const child of Object.values(value)) {
    const found = findProduct(child);
    if (found) return found;
  }
  return undefined;
}

async function queryAliExpress(source) {
  const params = {
    app_key: appKey,
    method: apiMethod,
    timestamp: timestamp(),
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    simplify: 'true',
    target_currency: source.currency || 'USD',
    target_language: 'EN',
    tracking_id: trackingId,
    page_no: '1',
    page_size: '1'
  };
  if (source.itemId) params.item_ids = source.itemId;
  else if (source.keywords) params.keywords = source.keywords;
  else throw new Error(`${source.id}: itemId or keywords is required`);
  params.sign = sign(params);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status} ${text.slice(0, 300)}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`${source.id}: API returned non-JSON response`); }
  const error = findProduct(payload?.error_response) || payload?.error_response;
  if (error) throw new Error(`${source.id}: ${JSON.stringify(error).slice(0, 400)}`);
  const product = findProduct(payload);
  if (!product) throw new Error(`${source.id}: no product returned`);
  return product;
}

function updateProduct(existing, source, remote) {
  const title = firstValue(remote, ['product_title', 'productTitle', 'title', 'name']);
  const image = firstValue(remote, ['product_main_image_url', 'productMainImageUrl', 'image_url', 'imageUrl', 'img_url']);
  const url = firstValue(remote, ['promotion_link', 'promotionLink', 'promotion_url', 'promotionUrl', 'affiliate_url', 'affiliateUrl']);
  const price = Number(firstValue(remote, ['target_sale_price', 'targetSalePrice', 'sale_price', 'salePrice', 'price']));
  const old = Number(firstValue(remote, ['target_original_price', 'targetOriginalPrice', 'original_price', 'originalPrice', 'original_price_currency']));
  const rating = Number(firstValue(remote, [' 평가', 'evaluate_rate', 'evaluateRate', 'rating']));
  return {
    ...existing,
    sourceId: source.id,
    ...(title ? { name: title } : {}),
    ...(image ? { img: image } : {}),
    ...(url ? { url } : {}),
    ...(Number.isFinite(price) && price > 0 ? { price } : {}),
    ...(Number.isFinite(old) && old > 0 ? { old } : {}),
    ...(Number.isFinite(rating) && rating > 0 ? { rating } : {}),
    cur: existing.cur || '$',
    cat: source.category || existing.cat,
    updatedAt: now
  };
}

(async () => {
  let updated = 0;
  const failures = [];
  for (const source of sources) {
    try {
      const remote = await queryAliExpress(source);
      const index = products.findIndex(product => product.sourceId === source.id || product.name === source.name);
      if (index < 0) throw new Error(`${source.id}: add a matching product to products.json first`);
      products[index] = updateProduct(products[index], source, remote);
      updated++;
      console.log(`Updated ${source.id}`);
    } catch (error) {
      failures.push(error.message);
      console.error(error.message);
    }
  }
  if (!updated) throw new Error('No products were updated. Check API access, source configuration, and credentials.');
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
  console.log(`Updated ${updated}/${sources.length} products.`);
  if (failures.length) {
    console.warn(`${failures.length} product(s) failed; existing data was preserved.`);
    if (process.env.FAIL_ON_PARTIAL_UPDATE === 'true') process.exitCode = 1;
  }
})();
