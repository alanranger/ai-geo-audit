// Squarespace revenue sync
//
// Fetches orders from the Squarespace Commerce Orders API for a date range,
// aggregates by period(s), and upserts rows into `revenue_snapshots`. The
// Revenue Funnel summary endpoint reads from that table, so KPIs/funnel
// update automatically once this runs.
//
// Method:  POST | GET (GET only when invoked by Vercel cron with x-vercel-cron)
// Body / query:
//   propertyUrl     - default https://www.alanranger.com
//   period_start    - YYYY-MM-DD (defaults to today - 27 days, UTC)
//   period_end      - YYYY-MM-DD (defaults to today, UTC)
//   modes           - "single,monthly" (default "single,monthly")
//                       single   = one row for [period_start, period_end]
//                       monthly  = one row per calendar month touched by the
//                                  range (uses fulfilled-month buckets)
//   includeCancelled - "0" (default) | "1"  whether to include CANCELED orders
//
// Env:
//   SQUARESPACE_API_KEY                Squarespace OAuth/API key (REQUIRED).
//                                      Set in Vercel Project > Settings > Env.
//   SQUARESPACE_USER_AGENT             Optional override, default below.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { classifyCommercialTier, emptyTierAccumulator, setProductTierMap } from './commercial-tier.js';
import { loadProductTierMap } from '../../lib/product-tier-map.js';

const SQS_BASE = 'https://api.squarespace.com/1.0/commerce/orders';
const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const DEFAULT_USER_AGENT = 'AlanRanger-AIGEOAudit/1.0 (revenue-funnel-sync)';
const MAX_PAGES = 200; // hard safety: 200 * 50 = 10,000 orders per sync

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function parseBody(req) {
  if (req.method === 'GET') {
    const out = {};
    for (const [k, v] of Object.entries(req.query || {})) out[k] = v;
    return out;
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function toIsoStart(dateStr) {
  // YYYY-MM-DD -> YYYY-MM-DDT00:00:00.000Z
  return `${dateStr}T00:00:00.000Z`;
}

function toIsoEnd(dateStr) {
  // YYYY-MM-DD inclusive -> end-of-day Z
  return `${dateStr}T23:59:59.999Z`;
}

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 27 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function validateRange(body) {
  const fallback = defaultDateRange();
  const start = String(body.period_start || fallback.start).trim();
  const end = String(body.period_end || fallback.end).trim();
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ok(start) || !ok(end)) throw Object.assign(new Error('invalid_date_format'), { statusCode: 400 });
  if (start > end) throw Object.assign(new Error('period_start_after_period_end'), { statusCode: 400 });
  return { start, end };
}

async function fetchOrdersPage(apiKey, userAgent, queryString) {
  const url = `${SQS_BASE}${queryString}`;
  const r = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': userAgent,
      Accept: 'application/json'
    }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw Object.assign(
      new Error(`squarespace_http_${r.status}`),
      { statusCode: r.status === 401 ? 401 : 502, body: text.slice(0, 500) }
    );
  }
  return r.json();
}

async function fetchAllOrders(apiKey, userAgent, range) {
  // First page: use modifiedAfter / modifiedBefore. Subsequent pages: cursor.
  const qsFirst = `?modifiedAfter=${encodeURIComponent(toIsoStart(range.start))}` +
                  `&modifiedBefore=${encodeURIComponent(toIsoEnd(range.end))}`;
  const orders = [];
  let qs = qsFirst;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await fetchOrdersPage(apiKey, userAgent, qs);
    const results = Array.isArray(page.result) ? page.result : [];
    for (const o of results) orders.push(o);
    if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
    qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
  }
  return orders;
}

function orderAttribution(order) {
  // We bucket on `createdOn` (when the customer placed the order) — that's the
  // semantically correct "revenue" date even though the API filters on
  // `modifiedOn`. Filtering on modifiedOn just makes sure we pick up
  // late-edited orders, then we attribute them by createdOn.
  const createdOn = String(order.createdOn || order.modifiedOn || '').slice(0, 10);
  return createdOn || null;
}

function orderNetValue(order) {
  const gross = Number(order?.grandTotal?.value) || 0;
  const refunded = Number(order?.refundedTotal?.value) || 0;
  return Math.max(0, gross - refunded);
}

function isUsableOrder(order, includeCancelled) {
  if (order.testmode === true) return false;
  if (!includeCancelled && String(order.fulfillmentStatus || '').toUpperCase() === 'CANCELED') return false;
  return true;
}

// Per-line-item net value: unitPrice * qty, with a proportional share of the
// order-level discount and refund applied so the per-tier total adds up to
// the order net value within rounding.
function lineNetValue(item) {
  const unit = Number(item?.unitPricePaid?.value) || Number(item?.unitPrice?.value) || 0;
  const qty = Number(item?.quantity) || 1;
  return Math.max(0, unit * qty);
}

function lineProductInfo(item) {
  return {
    productName: item?.productName || item?.lineItemType || '',
    productUrl: item?.productUrl || item?.product_url || ''
  };
}

// Pick n Mix is a pre-paid plan: customer buys £X of credit (counted in
// the `services` tier when sold) and later draws down individual workshop
// bookings, which Squarespace records as 100%-discount orders with promo
// code PICKNMIX (grandTotal = £0). The spreadsheet handles draw-downs by
// debiting "Pick n Mix Out" and crediting the actual workshop tier, net
// zero. We mirror that here so the dashboard's per-tier split matches.
function isPickNMixRedemption(order) {
  if (Number(order?.grandTotal?.value || 0) !== 0) return false;
  const discounts = Array.isArray(order?.discountLines) ? order.discountLines : [];
  return discounts.some(d => /picknmix/i.test(String(d?.promoCode || d?.name || '')));
}

function splitPickNMixRedemption(lines, grossPerLine) {
  const revenue = emptyTierAccumulator();
  const transactions = emptyTierAccumulator();
  const tiersHit = new Set();
  let totalDebit = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const gross = grossPerLine[i];
    if (gross <= 0) continue;
    const tier = classifyCommercialTier(lineProductInfo(lines[i]));
    revenue[tier] = (revenue[tier] || 0) + gross;
    tiersHit.add(tier);
    totalDebit += gross;
  }
  if (totalDebit > 0) {
    revenue.services = (revenue.services || 0) - totalDebit;
    tiersHit.add('services');
  }
  for (const tier of tiersHit) transactions[tier] = 1;
  return { revenue, transactions };
}

// Split an order's net value across its line items by tier. Returns
// { workshops_residential: 0, ..., services: 0, hire: 0, academy: 0,
// unidentified: 0 } and matching transactions ({ workshops_residential:
// 0|1, ... } using "any line in tier" as the rule so an order with
// mixed tiers counts in each tier it touched).
function splitOrderByTier(order) {
  const lines = Array.isArray(order?.lineItems) ? order.lineItems : [];
  const orderNet = orderNetValue(order);
  const grossPerLine = lines.map(lineNetValue);
  const grossTotal = grossPerLine.reduce((a, b) => a + b, 0);
  if (isPickNMixRedemption(order) && grossTotal > 0) {
    return splitPickNMixRedemption(lines, grossPerLine);
  }
  const revenue = emptyTierAccumulator();
  const transactions = emptyTierAccumulator();
  if (!lines.length || grossTotal <= 0) {
    revenue.other = (revenue.other || 0) + orderNet;
    if (orderNet > 0) transactions.other = 1;
    return { revenue, transactions };
  }
  const tiersHit = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const item = lines[i];
    const gross = grossPerLine[i];
    if (gross <= 0) continue;
    const share = gross / grossTotal;
    const net = orderNet * share;
    const tier = classifyCommercialTier(lineProductInfo(item));
    revenue[tier] = (revenue[tier] || 0) + net;
    tiersHit.add(tier);
  }
  for (const tier of tiersHit) transactions[tier] = 1;
  return { revenue, transactions };
}

function addToTierAccum(target, source) {
  for (const key of Object.keys(source || {})) {
    target[key] = (target[key] || 0) + (source[key] || 0);
  }
}

function roundTierAccum(accum) {
  const out = {};
  for (const k of Object.keys(accum || {})) out[k] = Number((accum[k] || 0).toFixed(2));
  return out;
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

function monthOf(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null; // YYYY-MM
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthKey}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

function newBucket(currency) {
  return {
    revenue: 0,
    transactions: 0,
    currency,
    tierRevenue: emptyTierAccumulator(),
    tierTransactions: emptyTierAccumulator()
  };
}

function applyOrderToBucket(bucket, value, tierSplit) {
  bucket.revenue += value;
  bucket.transactions += 1;
  addToTierAccum(bucket.tierRevenue, tierSplit.revenue);
  addToTierAccum(bucket.tierTransactions, tierSplit.transactions);
}

function aggregateOrders(orders, range, includeCancelled) {
  const summary = {
    inWindow: newBucket(null),
    byMonth: {} // { 'YYYY-MM': bucket }
  };
  for (const order of orders) {
    if (!isUsableOrder(order, includeCancelled)) continue;
    const day = orderAttribution(order);
    if (!day) continue;
    const value = orderNetValue(order);
    const currency = order?.grandTotal?.currency || 'GBP';
    const tierSplit = splitOrderByTier(order);
    if (inRange(day, range)) {
      summary.inWindow.currency = summary.inWindow.currency || currency;
      applyOrderToBucket(summary.inWindow, value, tierSplit);
    }
    const mKey = monthOf(day);
    if (mKey) {
      const bucket = summary.byMonth[mKey] || newBucket(currency);
      bucket.currency = bucket.currency || currency;
      applyOrderToBucket(bucket, value, tierSplit);
      summary.byMonth[mKey] = bucket;
    }
  }
  return summary;
}

function bucketToRow(propertyUrl, bucket, periodStart, periodEnd, notes) {
  return {
    property_url: propertyUrl,
    period_start: periodStart,
    period_end: periodEnd,
    revenue_amount: Number(bucket.revenue.toFixed(2)),
    currency: bucket.currency || 'GBP',
    source: 'squarespace_api',
    transactions: bucket.transactions,
    tier_revenue: roundTierAccum(bucket.tierRevenue),
    tier_transactions: roundTierAccum(bucket.tierTransactions),
    notes
  };
}

function buildRowsToSave(propertyUrl, summary, range, modes) {
  const rows = [];
  if (modes.has('single')) {
    rows.push(bucketToRow(propertyUrl, summary.inWindow, range.start, range.end, 'Synced from Squarespace Orders API'));
  }
  if (modes.has('monthly')) {
    const monthKeys = Object.keys(summary.byMonth).sort((a, b) => a.localeCompare(b));
    for (const mKey of monthKeys) {
      const bucket = summary.byMonth[mKey];
      const bounds = monthBounds(mKey);
      if (bounds.end < range.start || bounds.start > range.end) continue;
      rows.push(bucketToRow(propertyUrl, bucket, bounds.start, bounds.end, 'Auto-synced calendar month'));
    }
  }
  return rows;
}

async function upsertRows(supabase, rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .upsert(rows, { onConflict: 'property_url,period_start,period_end,source' })
    .select();
  if (error) throw error;
  return data || [];
}

function parseModes(raw) {
  const input = String(raw || 'single,monthly').toLowerCase();
  const set = new Set();
  for (const part of input.split(',')) {
    const t = part.trim();
    if (t === 'single' || t === 'monthly') set.add(t);
  }
  if (!set.size) set.add('single');
  return set;
}

function authoriseRequest(req) {
  // GET is only allowed when invoked by Vercel cron (`x-vercel-cron: 1`) OR
  // when a shared admin token is provided via ?token=. POST is unrestricted
  // because the UI already runs inside the admin shell.
  if (req.method === 'POST' || req.method === 'OPTIONS') return true;
  const isCron = String(req.headers['x-vercel-cron'] || '') === '1';
  if (isCron) return true;
  const token = String(req.query?.token || '').trim();
  const expected = String(process.env.SQUARESPACE_SYNC_TOKEN || '').trim();
  return !!expected && token === expected;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }
  if (!authoriseRequest(req)) return send(res, 401, { error: 'unauthorised' });

  const body = parseBody(req);
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY).trim();
  const includeCancelled = String(body.includeCancelled || '0') === '1';
  const modes = parseModes(body.modes);
  let range;
  try { range = validateRange(body); } catch (e) { return send(res, e.statusCode || 400, { error: e.message }); }

  try {
    const apiKey = need('SQUARESPACE_API_KEY');
    const userAgent = (process.env.SQUARESPACE_USER_AGENT || DEFAULT_USER_AGENT).trim();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    setProductTierMap(await loadProductTierMap(supabase));

    const orders = await fetchAllOrders(apiKey, userAgent, range);
    const summary = aggregateOrders(orders, range, includeCancelled);
    const rows = buildRowsToSave(propertyUrl, summary, range, modes);
    const saved = await upsertRows(supabase, rows);

    return send(res, 200, {
      ok: true,
      range,
      orders_fetched: orders.length,
      orders_in_window: summary.inWindow.transactions,
      revenue_in_window: Number(summary.inWindow.revenue.toFixed(2)),
      currency: summary.inWindow.currency || 'GBP',
      months_synced: Object.keys(summary.byMonth).length,
      tier_revenue_in_window: roundTierAccum(summary.inWindow.tierRevenue),
      tier_transactions_in_window: roundTierAccum(summary.inWindow.tierTransactions),
      saved
    });
  } catch (err) {
    const status = err?.statusCode || 500;
    const message = err?.message || String(err);
    if (message.startsWith('missing_env:')) {
      return send(res, 500, { error: 'configuration_error', missing: message.replace('missing_env:', '') });
    }
    return send(res, status, { error: 'squarespace_sync_failed', message, body: err?.body || null });
  }
}
