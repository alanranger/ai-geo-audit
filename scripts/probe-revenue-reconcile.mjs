// Row-by-row revenue reconciliation for 2026 YTD.
//
// Pulls raw transactions from THREE sources:
//   1. Squarespace Commerce Orders API   (orders + line items)
//   2. Stripe Charges API                (Acuity-funded + Subscription)
//   3. Booking Sheet (Sales 2026 tab)    (Bank/PayPal/Voucher manual rows)
//
// Classifies each row using the SAME logic the live pipeline uses
// (api/aigeo/commercial-tier.js for SQ/Stripe, classifyCategory for BS).
//
// Output: tier-by-tier breakdown so we can manually compare against the
// spreadsheet. Investigation only - does not modify any DB row.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import xlsx from 'xlsx';
import { classifyCommercialTier } from '../api/aigeo/commercial-tier.js';
import { classifyCategory } from '../lib/booking-sheet-parser.mjs';

const MONTH_TOKEN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function parseExcelDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86400000));
  }
  const s = String(value || '').trim();
  if (!s) return null;
  // 17-May-26 / 17 May 2026
  const ddMmm = /^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/-]+(\d{2,4})/.exec(s);
  if (ddMmm) {
    const mNum = MONTH_TOKEN[ddMmm[2].toLowerCase().slice(0, 4)] || MONTH_TOKEN[ddMmm[2].toLowerCase().slice(0, 3)];
    if (mNum) {
      const y = ddMmm[3].length === 2 ? `20${ddMmm[3]}` : ddMmm[3];
      return new Date(`${y}-${String(mNum).padStart(2, '0')}-${String(ddMmm[1]).padStart(2, '0')}T12:00:00Z`);
    }
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00Z`);
  const uk = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (uk) {
    const y = uk[3].length === 2 ? `20${uk[3]}` : uk[3];
    return new Date(`${y}-${String(uk[2]).padStart(2, '0')}-${String(uk[1]).padStart(2, '0')}T12:00:00Z`);
  }
  return null;
}

function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  const s = String(raw).replace(/[£$,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadDotEnv(path) {
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv(resolve(__dirname, '..', '.env.local'));

const YTD_START = '2026-01-01';
const YTD_END = '2026-05-31';
const PROP = 'https://www.alanranger.com';

// ---- Squarespace -----------------------------------------------------------

async function sqPage(qs) {
  const r = await fetch(`https://api.squarespace.com/1.0/commerce/orders${qs}`, {
    headers: {
      Authorization: `Bearer ${process.env.SQUARESPACE_API_KEY}`,
      'User-Agent': 'AlanRanger-AIGEOAudit/1.0 (probe-reconcile)',
      Accept: 'application/json'
    }
  });
  if (!r.ok) throw new Error(`sqs_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function sqFetchOrders(startDate, endDate) {
  const startIso = `${startDate}T00:00:00.000Z`;
  const endIso = `${endDate}T23:59:59.999Z`;
  const out = [];
  let qs = `?modifiedAfter=${encodeURIComponent(startIso)}&modifiedBefore=${encodeURIComponent(endIso)}`;
  for (let i = 0; i < 100; i += 1) {
    const page = await sqPage(qs);
    for (const o of page.result || []) out.push(o);
    if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
    qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
  }
  return out;
}

function sqOrderRow(order) {
  const created = String(order.createdOn || '').slice(0, 10);
  const gross = Number(order?.grandTotal?.value) || 0;
  const refunded = Number(order?.refundedTotal?.value) || 0;
  const net = Math.max(0, gross - refunded);
  const customer = `${order.billingAddress?.firstName || ''} ${order.billingAddress?.lastName || ''}`.trim();
  const email = order.customerEmail || '';
  const lines = (order.lineItems || []).map(li => ({
    name: li.productName || li.lineItemType || '',
    url: li.productUrl || '',
    qty: Number(li.quantity) || 1,
    unit: Number(li.unitPricePaid?.value || li.unitPrice?.value) || 0,
    tier: classifyCommercialTier({ productName: li.productName, productUrl: li.productUrl })
  }));
  return { source: 'squarespace', date: created, customer, email, gross, refunded, net, lines, raw_id: order.id };
}

// Split each order's net across its lines by gross proportion (same as live).
function sqRowsByTier(orders) {
  const byTier = {};
  for (const o of orders.map(sqOrderRow)) {
    if (o.net <= 0) continue;
    if (o.date < YTD_START || o.date > YTD_END) continue;
    const grossSum = o.lines.reduce((a, l) => a + l.unit * l.qty, 0);
    for (const l of o.lines) {
      const share = grossSum > 0 ? (l.unit * l.qty) / grossSum : (1 / Math.max(o.lines.length, 1));
      const lineNet = Number((o.net * share).toFixed(2));
      const row = { date: o.date, customer: o.customer, email: o.email, name: l.name, url: l.url, qty: l.qty, amount: lineNet, source: 'SQ', funding: 'squarespace' };
      const tier = l.tier;
      (byTier[tier] ||= []).push(row);
    }
  }
  return byTier;
}

// ---- Stripe ----------------------------------------------------------------

const STRIPE_APP_ACUITY = 'ca_4ql8gN64L2WdUGmp8trq7lG5gwpnSQNd';
const STRIPE_APP_SS_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';
const STRIPE_APP_SS_COMMERCE = 'ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM';

function isStripeUsable(c) {
  if (c.paid !== true || c.captured !== true) return false;
  if (c.refunded === true) return false;
  if (c.livemode === false) return false;
  return true;
}

function stripeClassify(c) {
  const meta = String(c?.metadata?.source || '').toLowerCase();
  if (c.application === STRIPE_APP_ACUITY || meta === 'acuity scheduling') {
    return { skip: false, source: 'acuity', tier: classifyCommercialTier({ productName: c.description || '' }) };
  }
  if (c.application === STRIPE_APP_SS_COMMERCE || c?.metadata?.orderId || c?.metadata?.websiteId) {
    return { skip: true, reason: 'ss_commerce_already_in_sq' };
  }
  if (c.application === STRIPE_APP_SS_MEMBER_AREAS) return { skip: false, source: 'ss_member_areas', tier: 'academy' };
  if (c?.invoice?.subscription) return { skip: false, source: 'stripe_subscription', tier: 'academy' };
  return { skip: false, source: 'stripe_other', tier: 'other' };
}

async function stripeFetchPage(starting, gte, lte) {
  const p = new URLSearchParams();
  p.set('limit', '100');
  p.set('created[gte]', String(gte));
  p.set('created[lte]', String(lte));
  p.append('expand[]', 'data.invoice');
  if (starting) p.set('starting_after', starting);
  const r = await fetch(`https://api.stripe.com/v1/charges?${p.toString()}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }
  });
  if (!r.ok) throw new Error(`stripe_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function stripeFetchAll(startDate, endDate) {
  const gte = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const lte = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
  const out = [];
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const page = await stripeFetchPage(cursor, gte, lte);
    const items = page.data || [];
    for (const c of items) out.push(c);
    if (!page.has_more || !items.length) break;
    cursor = items[items.length - 1].id;
  }
  return out;
}

function stripeRowsByTier(charges) {
  const byTier = {};
  for (const c of charges) {
    if (!isStripeUsable(c)) continue;
    const cls = stripeClassify(c);
    if (cls.skip) continue;
    const date = new Date(c.created * 1000).toISOString().slice(0, 10);
    if (date < YTD_START || date > YTD_END) continue;
    const amt = Math.max(0, (Number(c.amount) || 0) - (Number(c.amount_refunded) || 0)) / 100;
    if (amt <= 0) continue;
    const row = {
      date,
      customer: c.billing_details?.name || '',
      email: c.billing_details?.email || c.receipt_email || '',
      name: c.description || '',
      url: '',
      qty: 1,
      amount: amt,
      source: 'Stripe',
      funding: cls.source
    };
    (byTier[cls.tier] ||= []).push(row);
  }
  return byTier;
}

// ---- Booking Sheet ---------------------------------------------------------

function bsFindFile() {
  for (let y = 2026; y >= 2024; y -= 1) {
    const p = `G:\\Dropbox\\1. Bookings\\Booking Sheet ${y} - Alan Ranger Photography.xlsm`;
    if (existsSync(p)) return p;
  }
  return null;
}

function bsFindHeader(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map(c => String(c || '').trim().toLowerCase());
    if (cells.includes('date') && cells.includes('client') && cells.includes('category') && cells.includes('funding')) {
      return i;
    }
  }
  return -1;
}

function bsRowToObj(row, headers) {
  const obj = {};
  for (let j = 0; j < headers.length; j += 1) if (headers[j]) obj[headers[j]] = row[j];
  return obj;
}

function bsParseRow(obj) {
  const d = parseExcelDate(obj.Date);
  if (!d) return null;
  const date = d.toISOString().slice(0, 10);
  const amt = parseAmount(obj.Amount);
  if (!Number.isFinite(amt) || amt === 0) return null;
  const cat = String(obj.Category || '').trim();
  const tier = classifyCategory(cat);
  return {
    date,
    customer: String(obj.Client || '').trim(),
    name: String(obj.Event || obj.Description || '').trim(),
    category: cat,
    amount: amt,
    source: 'BookingSheet',
    funding: String(obj.Funding || '').replace(/\s+/g, ' ').trim(),
    tier
  };
}

function bsReadAll() {
  const path = bsFindFile();
  if (!path) throw new Error('Booking Sheet not found');
  const wb = xlsx.readFile(path, { cellDates: true });
  const ws = wb.Sheets['Sales 2026'];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const hi = bsFindHeader(rows);
  if (hi < 0) throw new Error('header not found');
  const headers = rows[hi].map(h => String(h || '').trim());
  console.log(`  BS headers: ${headers.filter(Boolean).join(' | ')}`);
  const objs = rows.slice(hi + 1).map(r => bsRowToObj(r, headers));
  const usable = objs.filter(o => o.Date && (o.Amount !== '' && o.Amount != null));
  console.log(`  BS body rows: ${objs.length}  usable: ${usable.length}`);
  if (usable[0]) console.log(`  BS sample[0]:`, JSON.stringify(usable[0]));
  return objs.map(bsParseRow).filter(Boolean);
}

function bsRowsByTier(rows) {
  const byTier = {};
  for (const r of rows) {
    if (r.date < YTD_START || r.date > YTD_END) continue;
    (byTier[r.tier || 'other'] ||= []).push(r);
  }
  return byTier;
}

// ---- Output ----------------------------------------------------------------

// Dump full row-level detail to a per-tier CSV (avoid huge stdout dumps).
function writeRowsCsv(label, rows, file) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['source,date,funding,amount,customer,description,category,url'];
  for (const r of rows) {
    lines.push([r._src, r.date, esc(r.funding), r.amount.toFixed(2), esc(r.customer), esc(r.name), esc(r.category), esc(r.url)].join(','));
  }
  writeFileSync(file, lines.join('\n'));
  console.log(`  Detail CSV: ${file}`);
}

// BS rows where funding is Stripe or Squarespace are DUPLICATES of API rows.
// The production pipeline correctly skips them. For investigation we keep
// them visible but mark them so we can sanity-check the API-side numbers.
function bsBucketOf(funding) {
  const f = String(funding || '').toLowerCase();
  if (f === 'squarespace' || f.startsWith('squarespace')) return 'BS:duplicate-Squarespace';
  if (f === 'stripe' || f.startsWith('stripe')) return 'BS:duplicate-Stripe';
  if (f === 'bank' || f === 'bacs') return 'BS:Bank';
  if (f === 'paypal') return 'BS:PayPal';
  if (f === 'cash') return 'BS:Cash';
  if (f.includes('voucher') || f.includes('pick')) return 'BS:Voucher/PnM';
  if (!f) return 'BS:<empty>';
  return `BS:${funding}`;
}

function bucketKey(r) {
  if (r._src === 'BS') return bsBucketOf(r.funding);
  if (r._src === 'Stripe') return `Stripe:${r.funding}`;
  return 'SQ:Squarespace';
}

function dumpTier(tierId, label, sources) {
  const rows = [];
  for (const [src, byTier] of Object.entries(sources)) {
    for (const r of (byTier[tierId] || [])) rows.push({ ...r, _src: src });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer));
  const totalsByBucket = {};
  let total = 0;
  let pipelineTotal = 0; // SQ + Stripe + BS (excluding duplicates) - this is what the dashboard sees
  for (const r of rows) {
    const k = bucketKey(r);
    totalsByBucket[k] = (totalsByBucket[k] || 0) + r.amount;
    total += r.amount;
    if (!k.startsWith('BS:duplicate-')) pipelineTotal += r.amount;
  }
  console.log(`\n========== ${label} (${tierId}) ==========`);
  console.log(`  Grand total (all sources): GBP ${total.toFixed(2)}    Pipeline total (excl BS dupes): GBP ${pipelineTotal.toFixed(2)}`);
  console.log(`  Per-source breakdown:`);
  for (const [k, v] of Object.entries(totalsByBucket).sort((a, b) => b[1] - a[1])) {
    const flag = k.startsWith('BS:duplicate-') ? ' (excluded from pipeline)' : '';
    console.log(`    ${k.padEnd(28)} GBP ${v.toFixed(2).padStart(9)}${flag}`);
  }
  const csvFile = resolve(__dirname, '..', 'tmp', `reconcile-${tierId}.csv`);
  writeRowsCsv(label, rows, csvFile);
  return { rows, total, pipelineTotal, totalsByBucket };
}

function exportCsv(allRows, file) {
  const header = 'tier,date,source,funding,amount,customer,name,url,email';
  const lines = [header];
  for (const r of allRows) {
    const escape = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    lines.push([r.tier, r.date, r.source, r.funding, r.amount.toFixed(2), escape(r.customer), escape(r.name), escape(r.url), escape(r.email)].join(','));
  }
  writeFileSync(file, lines.join('\n'));
}

// ---- Main ------------------------------------------------------------------

console.log(`Pulling Squarespace orders ${YTD_START} -> ${YTD_END}...`);
const sqOrders = await sqFetchOrders(YTD_START, YTD_END);
console.log(`  ${sqOrders.length} orders.`);

console.log(`Pulling Stripe charges...`);
const stripeCharges = await stripeFetchAll(YTD_START, YTD_END);
console.log(`  ${stripeCharges.length} charges.`);

console.log(`Reading Booking Sheet (Sales 2026)...`);
const bsRows = bsReadAll();
console.log(`  ${bsRows.length} parsed rows.`);

const sources = {
  SQ: sqRowsByTier(sqOrders),
  Stripe: stripeRowsByTier(stripeCharges),
  BS: bsRowsByTier(bsRows)
};

const allRowsForCsv = [];
for (const [src, byTier] of Object.entries(sources)) {
  for (const [tier, rows] of Object.entries(byTier)) {
    for (const r of rows) allRowsForCsv.push({ ...r, source: src, tier });
  }
}

const TARGETS = [
  ['workshops_residential', 'WORKSHOPS RESIDENTIAL'],
  ['workshops_nonres', 'WORKSHOPS NON-RESIDENTIAL'],
  ['services', 'SERVICES (1-2-1 / mentoring / vouchers / pick n mix)'],
  ['hire', 'HIRE / COMMERCIAL (prints / royalties / commissions)']
];

const summary = [];
for (const [id, label] of TARGETS) summary.push([label, dumpTier(id, label, sources)]);

const SHEET_2026 = { workshops_residential: 7310, workshops_nonres: 4678, services: 741, hire: 2656 };

console.log(`\n\n==================================================================================`);
console.log(`SUMMARY  (2026 YTD, ${YTD_START} -> ${YTD_END})`);
console.log(`==================================================================================`);
console.log(`  Tier                                              Pipeline    Spreadsheet   Gap`);
console.log(`  ------------------------------------------------- ----------- ------------ -----`);
for (const [label, s] of summary) {
  const tierId = TARGETS.find(t => t[1] === label)[0];
  const sheet = SHEET_2026[tierId];
  if (sheet === undefined) continue;
  const gap = s.pipelineTotal - sheet;
  const status = Math.abs(gap) < 150 ? '  PASS' : '  GAP ';
  console.log(`  ${label.padEnd(50)}£${s.pipelineTotal.toFixed(0).padStart(7)}     £${String(sheet).padStart(6)}     £${gap.toFixed(0).padStart(7)} ${status}`);
}

const csvPath = resolve(__dirname, '..', 'tmp', `reconcile-ytd-${YTD_END}.csv`);
try { writeFileSync(resolve(__dirname, '..', 'tmp', '.gitignore'), '*\n'); } catch { /* ok */ }
try { exportCsv(allRowsForCsv, csvPath); console.log(`\nCSV: ${csvPath}`); } catch (e) { console.log('csv skip:', e.message); }
