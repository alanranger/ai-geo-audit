// Stripe revenue sync (supplements Squarespace Commerce data)
//
// Captures the revenue streams that the Squarespace Orders API does NOT see:
//   - Acuity Scheduling charges (1-2-1 lessons, mentoring)  -> commercial tier `services`
//   - Squarespace Member Areas subscriptions                -> commercial tier `academy`
//   - Direct Stripe subscriptions (£59/£79 Subscription creation) -> `academy`
//   - Everything else (manual invoices, ad-hoc) -> `other`
//
// We deliberately SKIP Squarespace Commerce charges
// (application = ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM) because those are already
// captured (with full line-item tier split) by squarespace-revenue-sync.js.
// Summing the two `source` rows per period therefore reflects the real
// total revenue without double counting.
//
// Method:  POST | GET (GET only when invoked by Vercel cron with x-vercel-cron)
// Body / query:
//   propertyUrl    - default https://www.alanranger.com
//   period_start   - YYYY-MM-DD (defaults to today - 27 days, UTC)
//   period_end     - YYYY-MM-DD (defaults to today, UTC)
//   modes          - "single,monthly" (default "single,monthly")
//
// Env:
//   STRIPE_SECRET_KEY                  Stripe API key (REQUIRED).
//                                      Restricted (rk_live_...) is fine,
//                                      needs Read on charges + invoices.
//   STRIPE_SYNC_TOKEN                  Optional shared token for cron GET.
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { emptyTierAccumulator, classifyCommercialTier, setProductTierMap } from './commercial-tier.js';
import { loadProductTierMap } from '../../lib/product-tier-map.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';
const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const STRIPE_SOURCE = 'stripe_supplemental';
const MAX_PAGES = 100; // 100 * 100 = 10,000 charges per sync (safety bound)

// Stripe Connect application IDs we have learned from probing live data.
// Used to attribute a charge to a source even when description / metadata
// is empty.
const STRIPE_APP_ACUITY = 'ca_4ql8gN64L2WdUGmp8trq7lG5gwpnSQNd';
const STRIPE_APP_SS_COMMERCE = 'ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM';
const STRIPE_APP_SS_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';

// --------------------------------------------------------------------------
// HTTP helpers
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Date helpers (UTC throughout)
// --------------------------------------------------------------------------

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

function dateToUnixStart(dateStr) {
  return Math.floor(Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)), 0, 0, 0
  ) / 1000);
}

function dateToUnixEnd(dateStr) {
  return Math.floor(Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)), 23, 59, 59
  ) / 1000);
}

function inRange(dateStr, range) {
  if (!dateStr) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

function monthOf(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : null;
}

function monthBounds(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthKey}-${String(last).padStart(2, '0')}`;
  return { start, end };
}

function chargeDay(charge) {
  if (!charge.created) return null;
  return new Date(charge.created * 1000).toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------
// Stripe REST: list charges (paginated)
// --------------------------------------------------------------------------

function buildChargeParams(range, startingAfter) {
  const params = new URLSearchParams();
  params.set('limit', '100');
  params.set('created[gte]', String(dateToUnixStart(range.start)));
  params.set('created[lte]', String(dateToUnixEnd(range.end)));
  params.append('expand[]', 'data.invoice');
  params.append('expand[]', 'data.balance_transaction');
  if (startingAfter) params.set('starting_after', startingAfter);
  return params;
}

async function fetchChargesPage(apiKey, params) {
  const r = await fetch(`${STRIPE_BASE}/charges?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw Object.assign(
      new Error(`stripe_http_${r.status}`),
      { statusCode: r.status === 401 ? 401 : 502, body: text.slice(0, 500) }
    );
  }
  return r.json();
}

async function fetchAllCharges(apiKey, range) {
  const all = [];
  let startingAfter = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const params = buildChargeParams(range, startingAfter);
    const page = await fetchChargesPage(apiKey, params);
    const items = Array.isArray(page.data) ? page.data : [];
    for (const c of items) all.push(c);
    if (!page.has_more || !items.length) break;
    startingAfter = items[items.length - 1].id;
  }
  return all;
}

// --------------------------------------------------------------------------
// Charge classification
// --------------------------------------------------------------------------

function chargeHasSubscription(charge) {
  const inv = charge?.invoice;
  if (!inv || typeof inv !== 'object') return false;
  return !!inv.subscription;
}

function chargeMetaSourceIs(charge, expected) {
  const src = String(charge?.metadata?.source || '').toLowerCase();
  return src === expected;
}

// Defence-in-depth: Squarespace stamps `application`, `metadata.orderId` AND
// `metadata.websiteId` on every charge it routes. Any of the three is enough
// to identify a Squarespace Commerce charge that the squarespace-revenue-sync
// already counts, so we MUST skip it here to avoid double counting.
function looksLikeSquarespaceCommerce(charge) {
  if (charge.application === STRIPE_APP_SS_COMMERCE) return true;
  if (charge?.metadata?.orderId) return true;
  if (charge?.metadata?.websiteId) return true;
  return false;
}

// Pass an Acuity / ad-hoc Stripe charge through the shared product-name
// classifier so commercial bookings (e.g. "Staff - Photography Training",
// "Author Photos") reach the Hire tier instead of being lumped under
// services / unidentified. Falls back to a default if the classifier
// can't tier the description.
function classifyByDescription(charge, fallbackTier) {
  const desc = String(charge?.description || '').trim();
  if (!desc) return fallbackTier;
  const tier = classifyCommercialTier({ productName: desc });
  if (tier === 'unidentified') return fallbackTier;
  return tier;
}

// Returns { skip: true, reason } OR { skip: false, tier, source }
function classifyStripeCharge(charge) {
  // 1. Acuity must win BEFORE the Squarespace-Commerce check — historically
  //    safe (Acuity has its own application ID and never sets websiteId),
  //    but defensively explicit. Acuity charges default to `services`
  //    (typical 1-2-1 session) but commercial bookings (Staff Training,
  //    Author Photos, Sculpture Photos etc.) are routed to Hire via the
  //    shared classifier.
  if (charge.application === STRIPE_APP_ACUITY || chargeMetaSourceIs(charge, 'acuity scheduling')) {
    return { skip: false, tier: classifyByDescription(charge, 'services'), source: 'acuity' };
  }
  // 2. Anything that smells like a Squarespace Commerce charge is skipped —
  //    those are already in the Squarespace Orders sync (which sees orders
  //    paid by Stripe AND PayPal AND in-store, with full line-item tier
  //    breakdown).
  if (looksLikeSquarespaceCommerce(charge)) {
    return { skip: true, reason: 'squarespace_commerce_handled_elsewhere' };
  }
  // 3. Squarespace Member Areas (Academy) subscription via the SS Connect app.
  if (charge.application === STRIPE_APP_SS_MEMBER_AREAS) {
    return { skip: false, tier: 'academy', source: 'squarespace_member_areas' };
  }
  // 4. Direct Stripe subscriptions (no Connect app) — also Academy / Pick & Mix.
  if (chargeHasSubscription(charge)) {
    return { skip: false, tier: 'academy', source: 'stripe_subscription' };
  }
  // 5. Anything left = ad-hoc / manual charges (e.g. direct invoice payments
  //    for commissions). Try the shared classifier first; if it can't tier
  //    the description, surface in the Unidentified bucket for review.
  return { skip: false, tier: classifyByDescription(charge, 'unidentified'), source: 'stripe_other' };
}

function chargeNetAmount(charge) {
  const gross = (Number(charge.amount) || 0) / 100;
  const refunded = (Number(charge.amount_refunded) || 0) / 100;
  return Math.max(0, gross - refunded);
}

function chargeCurrency(charge) {
  return String(charge.currency || 'gbp').toUpperCase();
}

function isUsableCharge(charge) {
  // Stripe's `status` is API-version-dependent ("succeeded" on older versions,
  // "paid" on newer). The reliable signals are paid===true and captured===true,
  // and that the charge has not been fully refunded.
  if (charge.paid !== true) return false;
  if (charge.captured !== true) return false;
  if (charge.refunded === true) return false;
  if (charge.livemode === false) return false;
  return true;
}

// --------------------------------------------------------------------------
// Aggregation
// --------------------------------------------------------------------------

function newBucket(currency) {
  return {
    revenue: 0,
    transactions: 0,
    currency,
    tierRevenue: emptyTierAccumulator(),
    tierTransactions: emptyTierAccumulator()
  };
}

function applyChargeToBucket(bucket, value, tier, currency) {
  bucket.revenue += value;
  bucket.transactions += 1;
  bucket.currency = bucket.currency || currency;
  bucket.tierRevenue[tier] = (bucket.tierRevenue[tier] || 0) + value;
  bucket.tierTransactions[tier] = (bucket.tierTransactions[tier] || 0) + 1;
}

function applyClassifiedCharge(summary, classified, charge, range) {
  const day = chargeDay(charge);
  const value = chargeNetAmount(charge);
  if (!day || value <= 0) return;
  summary.classified += 1;
  summary.byClassifier[classified.source] = (summary.byClassifier[classified.source] || 0) + 1;
  const currency = chargeCurrency(charge);
  if (inRange(day, range)) {
    applyChargeToBucket(summary.inWindow, value, classified.tier, currency);
  }
  const mKey = monthOf(day);
  if (!mKey) return;
  const bucket = summary.byMonth[mKey] || newBucket(currency);
  applyChargeToBucket(bucket, value, classified.tier, currency);
  summary.byMonth[mKey] = bucket;
}

function aggregateCharges(charges, range) {
  const summary = {
    inWindow: newBucket('GBP'),
    byMonth: {},
    classified: 0,
    skipped: 0,
    byClassifier: {}
  };
  for (const c of charges) {
    if (!isUsableCharge(c)) { summary.skipped += 1; continue; }
    const cls = classifyStripeCharge(c);
    if (cls.skip) { summary.skipped += 1; continue; }
    applyClassifiedCharge(summary, cls, c, range);
  }
  return summary;
}

// --------------------------------------------------------------------------
// DB row construction & upsert
// --------------------------------------------------------------------------

function roundTierAccum(accum) {
  const out = {};
  for (const k of Object.keys(accum || {})) out[k] = Number((accum[k] || 0).toFixed(2));
  return out;
}

function bucketToRow(propertyUrl, bucket, periodStart, periodEnd, notes) {
  return {
    property_url: propertyUrl,
    period_start: periodStart,
    period_end: periodEnd,
    revenue_amount: Number(bucket.revenue.toFixed(2)),
    currency: bucket.currency || 'GBP',
    source: STRIPE_SOURCE,
    transactions: bucket.transactions,
    tier_revenue: roundTierAccum(bucket.tierRevenue),
    tier_transactions: roundTierAccum(bucket.tierTransactions),
    notes
  };
}

function buildRowsToSave(propertyUrl, summary, range, modes) {
  const rows = [];
  if (modes.has('single')) {
    rows.push(bucketToRow(propertyUrl, summary.inWindow, range.start, range.end, 'Synced from Stripe API (Acuity + Subscriptions)'));
  }
  if (modes.has('monthly')) {
    const monthKeys = Object.keys(summary.byMonth).sort((a, b) => a.localeCompare(b));
    for (const mKey of monthKeys) {
      const bucket = summary.byMonth[mKey];
      const bounds = monthBounds(mKey);
      if (bounds.end < range.start || bounds.start > range.end) continue;
      rows.push(bucketToRow(propertyUrl, bucket, bounds.start, bounds.end, 'Auto-synced from Stripe API (Acuity + Subscriptions)'));
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

// --------------------------------------------------------------------------
// Request handling
// --------------------------------------------------------------------------

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
  if (req.method === 'POST' || req.method === 'OPTIONS') return true;
  const isCron = String(req.headers['x-vercel-cron'] || '') === '1';
  if (isCron) return true;
  const token = String(req.query?.token || '').trim();
  const expected = String(process.env.STRIPE_SYNC_TOKEN || '').trim();
  return !!expected && token === expected;
}

function handleSyncError(res, err) {
  const status = err?.statusCode || 500;
  const message = err?.message || String(err);
  if (message.startsWith('missing_env:')) {
    return send(res, 500, { error: 'configuration_error', missing: message.replace('missing_env:', '') });
  }
  return send(res, status, { error: 'stripe_sync_failed', message, body: err?.body || null });
}

async function runSync(propertyUrl, modes, range) {
  const apiKey = need('STRIPE_SECRET_KEY');
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  setProductTierMap(await loadProductTierMap(supabase));
  const charges = await fetchAllCharges(apiKey, range);
  const summary = aggregateCharges(charges, range);
  const rows = buildRowsToSave(propertyUrl, summary, range, modes);
  const saved = await upsertRows(supabase, rows);
  return { charges, summary, saved };
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
  const modes = parseModes(body.modes);
  let range;
  try { range = validateRange(body); } catch (e) { return send(res, e.statusCode || 400, { error: e.message }); }

  try {
    const { charges, summary, saved } = await runSync(propertyUrl, modes, range);
    return send(res, 200, {
      ok: true,
      range,
      charges_fetched: charges.length,
      charges_classified: summary.classified,
      charges_skipped: summary.skipped,
      classifier_counts: summary.byClassifier,
      transactions_in_window: summary.inWindow.transactions,
      revenue_in_window: Number(summary.inWindow.revenue.toFixed(2)),
      currency: summary.inWindow.currency || 'GBP',
      months_synced: Object.keys(summary.byMonth).length,
      tier_revenue_in_window: roundTierAccum(summary.inWindow.tierRevenue),
      tier_transactions_in_window: roundTierAccum(summary.inWindow.tierTransactions),
      saved
    });
  } catch (err) {
    return handleSyncError(res, err);
  }
}
