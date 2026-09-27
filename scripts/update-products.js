#!/usr/bin/env node
/**
 * Discovers discounted AliExpress affiliate products and updates products.json.
 * Required secrets: ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET,
 * ALIEXPRESS_APP_SIGNATURE, ALIEXPRESS_TRACKING_ID.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

const root = process.cwd();
const sourcePath = `${root}/products-source.json`;
const productsPath = `${root}/products.json`;
const imageDir = `${root}/assets/products`;
const apiUrl = process.env.ALIEXPRESS_API_URL || 'https://api-sg.aliexpress.com/sync';
const appKey = process.env.ALIEXPRESS_APP_KEY;
const appSecret = process.env.ALIEXPRESS_APP_SECRET;
const appSignature = process.env.ALIEXPRESS_APP_SIGNATURE;
const trackingId = process.env.ALIEXPRESS_TRACKING_ID;

const missingSecrets = [
  ['ALIEXPRESS_APP_KEY', appKey],
  ['ALIEXPRESS_APP_SECRET', appSecret],
  ['ALIEXPRESS_TRACKING_ID', trackingId]
].filter(([, value]) => !value).map(([name]) => name);
if (missingSecrets.length) throw new Error(`Missing secret(s): ${missingSecrets.join(', ')}`);

const configFile = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const settings = Array.isArray(configFile) ? {
  maxProducts: 20,
  maxPerCategory: 15,
  enabledStores: ['علي إكسبريس'],
  minDiscountPercent: 20,
  minRating: 4.5,
  minOrders: 100,
  highSalesOrders: 1000,
  queries: configFile
} : {
  maxProducts: 20,
  maxPerCategory: 15,
  enabledStores: ['علي إكسبريس'],
  minDiscountPercent: 20,
  minRating: 4.5,
  minOrders: 100,
  highSalesOrders: 1000,
  ...configFile
};
// Preserve every previously published product. Unlinked stores can be hidden in the UI,
// but their records must remain available for a future store connection.
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
const now = new Date().toISOString();

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return undefined;
}

function sign(params) {
  const canonical = Object.keys(params).sort().map(key => key + params[key]).join('');
  return crypto.createHmac('sha256', appSecret).update(canonical).digest('hex').toUpperCase();
}

function collectProductObjects(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    for (const item of value) collectProductObjects(item, output);
    return output;
  }
  const id = firstValue(value, ['product_id', 'productId', 'item_id', 'itemId']);
  const title = firstValue(value, ['product_title', 'productTitle', 'title', 'name']);
  if (id && title) output.push(value);
  for (const child of Object.values(value)) collectProductObjects(child, output);
  return output;
}

function collectLink(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = collectLink(item); if (found) return found; }
    return undefined;
  }
  const direct = firstValue(value, ['promotion_link', 'promotionLink', 'promotion_url', 'promotionUrl', 'affiliate_url', 'affiliateUrl']);
  if (direct && String(direct).includes('aliexpress')) return direct;
  for (const child of Object.values(value)) { const found = collectLink(child); if (found) return found; }
  return undefined;
}

async function callApi(method, businessParams = {}) {
  const params = {
    app_key: appKey,
    timestamp: String(Date.now()),
    sign_method: 'sha256',
    method,
    ...(appSignature ? { app_signature: appSignature } : {}),
    ...businessParams
  };
  params.sign = sign(params);
  const response = await fetch(`${apiUrl}?${new URLSearchParams(params)}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('AliExpress returned a non-JSON response'); }
  if (payload.error_response) throw new Error(JSON.stringify(payload.error_response).slice(0, 500));
  return payload;
}

async function searchProducts(query) {
  const payload = await callApi('aliexpress.affiliate.product.query', {
    keywords: query.keywords,
    tracking_id: trackingId,
    target_currency: query.currency || 'USD',
    target_language: 'EN',
    ship_to_country: query.country || 'SA',
    page_no: '1',
    page_size: String(query.pageSize || 20),
    sort: 'SALE_PRICE_ASC'
  });
  return collectProductObjects(payload);
}

async function createAffiliateLink(product) {
  const sourceUrl = firstValue(product, ['product_detail_url', 'productDetailUrl', 'product_url', 'productUrl', 'url']);
  if (!sourceUrl) return undefined;
  const payload = await callApi('aliexpress.affiliate.link.generate', {
    tracking_id: trackingId,
    promotion_link_type: '0',
    source_values: String(sourceUrl)
  });
  const link = collectLink(payload);
  if (!link || !/^https:\/\/s\.click\.aliexpress\.com\/e\//i.test(link)) {
    throw new Error('AliExpress did not return a valid s.click affiliate link');
  }
  return link;
}

async function downloadProductImage(productId, imageUrl) {
  if (!imageUrl) throw new Error('Product image was not returned');
  fs.mkdirSync(imageDir, { recursive: true });
  const safeId = String(productId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const relativePath = `assets/products/${safeId}.webp`;
  const absolutePath = `${root}/${relativePath}`;
  if (!fs.existsSync(absolutePath)) {
    const response = await fetch(imageUrl, { headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Product image download failed with HTTP ${response.status}`);
    fs.writeFileSync(absolutePath, Buffer.from(await response.arrayBuffer()));
  }
  return relativePath;
}

function numeric(product, keys) {
  const value = Number(firstValue(product, keys));
  return Number.isFinite(value) ? value : 0;
}

function normalizeCandidate(product, query) {
  const id = String(firstValue(product, ['product_id', 'productId', 'item_id', 'itemId']) || '');
  const price = numeric(product, ['target_sale_price', 'targetSalePrice', 'sale_price', 'salePrice', 'price']);
  const old = numeric(product, ['target_original_price', 'targetOriginalPrice', 'original_price', 'originalPrice']);
  const rating = numeric(product, ['evaluate_rate', 'evaluateRate', 'rating']);
  const orders = numeric(product, ['volume', 'orders', 'order_count', 'orderCount', 'sale_count']);
  const shippingValue = firstValue(product, ['is_free_shipping', 'isFreeShipping', 'free_shipping', 'freeShipping', 'shipping_fee', 'shippingFee', 'shipping_cost', 'shippingCost']);
  const freeShipping = ['true', '1', 'yes', 'free', '0', '0.0'].includes(String(shippingValue).toLowerCase());
  const discount = old > price && price > 0 ? Math.round((1 - price / old) * 100) : 0;
  return {
    id, product, price, old, rating, orders, discount, freeShipping,
    category: query.category,
    currency: query.currency || 'USD'
  };
}

function toSiteProduct(candidate, affiliateUrl, query) {
  const product = candidate.product;
  return {
    sourceId: `auto:${candidate.id}`,
    name: firstValue(product, ['product_title', 'productTitle', 'title', 'name']),
    url: affiliateUrl,
    affiliateVerified: true,
    store: 'علي إكسبريس',
    price: candidate.price,
    old: candidate.old,
    cur: '$',
    cat: query.category,
    img: firstValue(product, ['product_main_image_url', 'productMainImageUrl', 'image_url', 'imageUrl', 'img_url']),
    rating: candidate.rating,
    sold: candidate.orders ? String(candidate.orders) : 'جديد',
    discount: candidate.discount,
    updatedAt: now
  };
}

(async () => {
  const failures = [];
  let updated = 0;
  let added = 0;
  let activeCount = products.filter(product => (settings.enabledStores || ['علي إكسبريس']).includes(product.store)).length;
  const existingIds = new Set(products.map(product => product.sourceId).filter(Boolean));
  const existingNames = new Set(products.map(product => String(product.name || '').toLowerCase()));

  for (const query of settings.queries || []) {
    try {
      let categoryCount = products.filter(product => product.store === 'علي إكسبريس' && product.cat === query.category).length;
      const validProducts = (await searchProducts(query))
        .map(product => normalizeCandidate(product, query))
        .filter(item => item.id && item.price > 0);
      const preferredProducts = validProducts.filter(item =>
        (item.rating === 0 || item.rating >= Number(settings.minRating)) &&
        (item.discount >= Number(settings.minDiscountPercent) || item.freeShipping || item.orders >= Number(settings.highSalesOrders || 1000))
      );
      const candidates = (preferredProducts.length ? preferredProducts : validProducts)
        .sort((a, b) => (b.discount * 3 + (b.freeShipping ? 20 : 0) + b.orders / 100) - (a.discount * 3 + (a.freeShipping ? 20 : 0) + a.orders / 100));

      for (const candidate of candidates) {
        if (activeCount >= Number(settings.maxProducts) && !existingIds.has(`auto:${candidate.id}`)) continue;
        const sourceId = `auto:${candidate.id}`;
        if (categoryCount >= Number(settings.maxPerCategory || 15) && !existingIds.has(sourceId)) continue;
        const existingIndex = products.findIndex(item => item.sourceId === sourceId);
        try {
          const affiliateUrl = await createAffiliateLink(candidate.product);
          if (!affiliateUrl) throw new Error('Affiliate link was not returned');
          const next = toSiteProduct(candidate, affiliateUrl, query);
          next.img = await downloadProductImage(candidate.id, next.img);
          if (existingIndex >= 0) {
            products[existingIndex] = { ...products[existingIndex], ...next };
            updated++;
          } else if (!existingNames.has(next.name.toLowerCase())) {
            products.push(next);
            existingIds.add(sourceId);
            existingNames.add(next.name.toLowerCase());
            activeCount++;
            categoryCount++;
            added++;
          }
        } catch (error) {
          failures.push(`${query.id || query.keywords}: ${error.message}`);
        }
      }
      console.log(`Scanned ${query.id || query.keywords}: ${candidates.length} qualifying discounted candidates`);
    } catch (error) {
      failures.push(`${query.id || query.keywords}: ${error.message}`);
      console.error(`Search failed for ${query.id || query.keywords}: ${error.message}`);
    }
  }

  if (!updated && !added) {
    console.log('No qualifying offers found in this scan; keeping the existing catalog.');
    return;
  }
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
  console.log(`Added ${added} new product(s), updated ${updated} product(s), total ${products.length}.`);
  if (failures.length) console.warn(`${failures.length} candidate operation(s) failed; existing data was preserved.`);
})();
