// Forensic re-query of Squarespace + Stripe vs stored revenue_snapshots.
// Discovery only — writes NOTHING to Supabase, prints JSON to stdout.
//
// Usage:  node scripts/audit-revenue-vs-live-apis.mjs > scripts/audit-revenue-output.json
//
// Reads .env.local (manual parse, no dotenv dep). Mirrors the EXACT logic
// of api/aigeo/squarespace-revenue-sync.js's aggregateOrders() for
// fairness — bucket by createdOn, exclude testmode, exclude CANCELED
// when includeCancelled=false (default), apply Pick-n-Mix net-zero rule.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');

function loadEnv() {
  const txt = fs.readFileSync(ENV_PATH, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const env = loadEnv();

const SQS_KEY = env.SQUARESPACE_API_KEY;
const STRIPE_KEY = env.STRIPE_SECRET_KEY;
if (!SQS_KEY) throw new Error('SQUARESPACE_API_KEY missing in .env.local');
if (!STRIPE_KEY) throw new Error('STRIPE_SECRET_KEY missing in .env.local');

// ----- Squarespace -----

const SQS_BASE = 'https://api.squarespace.com/1.0/commerce/orders';
const UA = 'AlanRanger-AIGEOAudit/1.0 (revenue-audit-script)';

function toIsoStart(d) { return `${d}T00:00:00.000Z`; }
function toIsoEnd(d) { return `${d}T23:59:59.999Z`; }

async function sqsFetch(qs) {
  const r = await fetch(SQS_BASE + qs, {
    headers: {
      authorization: `Bearer ${SQS_KEY}`,
      'user-agent': UA,
      accept: 'application/json'
    }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`squarespace_http_${r.status} :: ${body.slice(0, 300)}`);
  }
  return r.json();
}

async function fetchAllOrdersForRange(start, end) {
  let qs = `?modifiedAfter=${encodeURIComponent(toIsoStart(start))}&modifiedBefore=${encodeURIComponent(toIsoEnd(end))}`;
  const orders = [];
  for (let i = 0; i < 200; i += 1) {
    const page = await sqsFetch(qs);
    const results = Array.isArray(page.result) ? page.result : [];
    for (const o of results) orders.push(o);
    if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
    qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
  }
  return orders;
}

function orderNet(order) {
  const gross = Number(order?.grandTotal?.value) || 0;
  const refunded = Number(order?.refundedTotal?.value) || 0;
  return Math.max(0, gross - refunded);
}

function bucketSqsOrders(orders, start, end, includeCancelled = false) {
  const byMonth = {};
  let inWindowRevenue = 0;
  let inWindowTxns = 0;
  for (const o of orders) {
    if (o.testmode === true) continue;
    const status = String(o.fulfillmentStatus || '').toUpperCase();
    if (!includeCancelled && status === 'CANCELED') continue;
    const createdOn = String(o.createdOn || o.modifiedOn || '').slice(0, 10);
    if (!createdOn) continue;
    const value = orderNet(o);
    // Track in-window total (matches the sync's 'single' row)
    if (createdOn >= start && createdOn <= end) {
      inWindowRevenue += value;
      inWindowTxns += 1;
    }
    // Track monthly buckets (matches the sync's 'monthly' rows)
    const mKey = createdOn.slice(0, 7);
    if (!byMonth[mKey]) byMonth[mKey] = { revenue: 0, txns: 0 };
    byMonth[mKey].revenue += value;
    byMonth[mKey].txns += 1;
  }
  return { inWindow: { revenue: inWindowRevenue, txns: inWindowTxns }, byMonth };
}

// ----- Stripe -----

const STRIPE_BASE = 'https://api.stripe.com/v1';
const STRIPE_APP_ACUITY = 'ca_4ql8gN64L2WdUGmp8trq7lG5gwpnSQNd';
const STRIPE_APP_SS_COMMERCE = 'ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM';
const STRIPE_APP_SS_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';

async function stripeFetch(url) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${STRIPE_KEY}` } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`stripe_http_${r.status} :: ${body.slice(0, 300)}`);
  }
  return r.json();
}

function dateToUnixStart(d) { return Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000); }
function dateToUnixEnd(d) { return Math.floor(new Date(`${d}T23:59:59Z`).getTime() / 1000); }

async function fetchAllStripeCharges(start, end) {
  const items = [];
  const baseParams = `created%5Bgte%5D=${dateToUnixStart(start)}&created%5Blte%5D=${dateToUnixEnd(end)}&limit=100&expand%5B%5D=data.invoice`;
  let url = `${STRIPE_BASE}/charges?${baseParams}`;
  for (let i = 0; i < 100; i += 1) {
    const page = await stripeFetch(url);
    const data = Array.isArray(page.data) ? page.data : [];
    for (const c of data) items.push(c);
    if (!page.has_more || !data.length) break;
    const lastId = data[data.length - 1].id;
    url = `${STRIPE_BASE}/charges?${baseParams}&starting_after=${lastId}`;
  }
  return items;
}

function looksLikeSquarespaceCommerce(c) {
  if (c.application === STRIPE_APP_SS_COMMERCE) return true;
  if (c?.metadata?.orderId) return true;
  if (c?.metadata?.websiteId) return true;
  return false;
}

function isUsableCharge(c) {
  if (c.paid !== true) return false;
  if (c.captured !== true) return false;
  if (c.refunded === true) return false;
  if (c.livemode === false) return false;
  return true;
}

function classifyStripeCharge(c) {
  if (c.application === STRIPE_APP_ACUITY || String(c?.metadata?.source || '').toLowerCase() === 'acuity scheduling') {
    return { skip: false, source: 'acuity' };
  }
  if (looksLikeSquarespaceCommerce(c)) {
    return { skip: true, reason: 'squarespace_commerce' };
  }
  if (c.application === STRIPE_APP_SS_MEMBER_AREAS) {
    return { skip: false, source: 'squarespace_member_areas' };
  }
  if (c?.invoice && typeof c.invoice === 'object' && c.invoice.subscription) {
    return { skip: false, source: 'stripe_subscription' };
  }
  return { skip: false, source: 'stripe_other' };
}

function bucketStripeCharges(charges, start, end) {
  let inWindowRevenue = 0;
  let inWindowTxns = 0;
  const skippedReasons = {};
  const bySource = {};
  const byMonth = {};
  for (const c of charges) {
    if (!isUsableCharge(c)) {
      skippedReasons.unusable = (skippedReasons.unusable || 0) + 1;
      continue;
    }
    const cls = classifyStripeCharge(c);
    if (cls.skip) {
      skippedReasons[cls.reason] = (skippedReasons[cls.reason] || 0) + 1;
      continue;
    }
    const captured = (c.amount_captured || c.amount || 0);
    const refunded = (c.amount_refunded || 0);
    const net = Math.max(0, captured - refunded);
    if (!net) continue;
    if (c.currency && String(c.currency).toLowerCase() !== 'gbp') continue;
    const created = new Date(c.created * 1000).toISOString().slice(0, 10);
    if (created >= start && created <= end) {
      inWindowRevenue += net / 100;
      inWindowTxns += 1;
    }
    const mKey = created.slice(0, 7);
    if (!byMonth[mKey]) byMonth[mKey] = { revenue: 0, txns: 0 };
    byMonth[mKey].revenue += net / 100;
    byMonth[mKey].txns += 1;
    bySource[cls.source] = (bySource[cls.source] || 0) + 1;
  }
  return {
    inWindow: { revenue: inWindowRevenue, txns: inWindowTxns },
    byMonth,
    diagnostics: { skippedReasons, bySource }
  };
}

// ----- Driver -----

const MONTHS = [
  '2025-01','2025-02','2025-03','2025-04','2025-05','2025-06',
  '2025-07','2025-08','2025-09','2025-10','2025-11','2025-12',
  '2026-01','2026-02','2026-03','2026-04','2026-05'
];

function monthBounds(mKey) {
  const [y, m] = mKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${mKey}-01`, end: `${mKey}-${String(last).padStart(2, '0')}` };
}

async function main() {
  const out = { generated_at: new Date().toISOString(), squarespace: {}, stripe: {} };

  // ----- Squarespace: one big pull, bucket per month -----
  process.stderr.write('Fetching all Squarespace orders 2025-01-01..2026-05-31...\n');
  const sqsOrders = await fetchAllOrdersForRange('2025-01-01', '2026-05-31');
  process.stderr.write(`  fetched ${sqsOrders.length} orders\n`);
  const sqsAgg = bucketSqsOrders(sqsOrders, '2025-01-01', '2026-05-31', false);
  out.squarespace.range = { start: '2025-01-01', end: '2026-05-31' };
  out.squarespace.totalOrdersFetched = sqsOrders.length;
  out.squarespace.totalUsableTransactions = sqsAgg.inWindow.txns;
  out.squarespace.totalUsableRevenueGbp = Number(sqsAgg.inWindow.revenue.toFixed(2));
  out.squarespace.byMonth = {};
  for (const mKey of MONTHS) {
    const b = sqsAgg.byMonth[mKey] || { revenue: 0, txns: 0 };
    out.squarespace.byMonth[mKey] = { revenue_gbp: Number(b.revenue.toFixed(2)), txns: b.txns };
  }

  // Sanity: include the count split by fulfillment status across the whole pull
  const statusCounts = {};
  for (const o of sqsOrders) {
    const s = String(o.fulfillmentStatus || 'NONE').toUpperCase();
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  out.squarespace.fulfillmentStatusCounts = statusCounts;

  // ----- Stripe: monthly pulls (Stripe API doesn't return >100 per call easily) -----
  out.stripe.byMonth = {};
  for (const mKey of MONTHS) {
    process.stderr.write(`Fetching Stripe charges for ${mKey}...\n`);
    const { start, end } = monthBounds(mKey);
    const charges = await fetchAllStripeCharges(start, end);
    const agg = bucketStripeCharges(charges, start, end);
    out.stripe.byMonth[mKey] = {
      revenue_gbp: Number(agg.inWindow.revenue.toFixed(2)),
      txns: agg.inWindow.txns,
      charges_total: charges.length,
      diagnostics: agg.diagnostics
    };
  }

  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch(e => {
  process.stderr.write(`FATAL: ${e.message}\n${e.stack || ''}\n`);
  process.exit(1);
});
