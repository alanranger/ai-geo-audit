// Smoke test: pull last 365 days of Stripe charges, classify with the
// production classifier, print a tier+source summary.
//
// Usage:
//   node scripts/smoke-stripe-classify.mjs [days]
//
// Defaults to 365 days. Reads STRIPE_SECRET_KEY from .env.local.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotEnv(resolve(__dirname, '..', '.env.local'));

const days = Number(process.argv[2] || 365);
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) { console.error('STRIPE_SECRET_KEY missing in .env.local'); process.exit(1); }

const STRIPE_APP_ACUITY = 'ca_4ql8gN64L2WdUGmp8trq7lG5gwpnSQNd';
const STRIPE_APP_SS_COMMERCE = 'ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM';
const STRIPE_APP_SS_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';

function looksLikeSsCommerce(c) {
  if (c.application === STRIPE_APP_SS_COMMERCE) return true;
  if (c?.metadata?.orderId) return true;
  if (c?.metadata?.websiteId) return true;
  return false;
}

function classify(charge) {
  const meta = String(charge?.metadata?.source || '').toLowerCase();
  if (charge.application === STRIPE_APP_ACUITY || meta === 'acuity scheduling') {
    return { skip: false, tier: 'services', source: 'acuity' };
  }
  if (looksLikeSsCommerce(charge)) return { skip: true, reason: 'ss_commerce' };
  if (charge.application === STRIPE_APP_SS_MEMBER_AREAS) {
    return { skip: false, tier: 'academy', source: 'squarespace_member_areas' };
  }
  if (charge?.invoice?.subscription) {
    return { skip: false, tier: 'academy', source: 'stripe_subscription' };
  }
  return { skip: false, tier: 'other', source: 'stripe_other' };
}

async function fetchPage(startingAfter, gte, lte) {
  const params = new URLSearchParams();
  params.set('limit', '100');
  params.set('created[gte]', String(gte));
  params.set('created[lte]', String(lte));
  params.append('expand[]', 'data.invoice');
  if (startingAfter) params.set('starting_after', startingAfter);
  const r = await fetch(`https://api.stripe.com/v1/charges?${params.toString()}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` }
  });
  if (!r.ok) throw new Error(`stripe_http_${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchAll(days) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - days * 86400;
  const out = [];
  let cursor = null;
  for (let i = 0; i < 100; i += 1) {
    const page = await fetchPage(cursor, start, now);
    const items = Array.isArray(page.data) ? page.data : [];
    for (const c of items) out.push(c);
    if (!page.has_more || !items.length) break;
    cursor = items[items.length - 1].id;
  }
  return out;
}

function monthOf(unix) { return new Date(unix * 1000).toISOString().slice(0, 7); }

function netAmount(c) {
  return Math.max(0, (Number(c.amount) || 0) - (Number(c.amount_refunded) || 0)) / 100;
}

function isUsable(c) {
  if (c.status !== 'succeeded' || c.paid !== true) return false;
  if (c.refunded === true) return false;
  if (c.livemode === false) return false;
  return true;
}

console.log(`Fetching last ${days} days of Stripe charges...`);
const charges = await fetchAll(days);
console.log(`Got ${charges.length} charges.\n`);

const bySource = {};
const byTier = {};
const byMonth = {};
let totalGbp = 0;
let skipped = 0;
const skipReasons = {};
let sampleByClassifier = {};

function whyNotUsable(c) {
  if (c.paid !== true) return `paid=${c.paid}`;
  if (c.captured !== true) return `captured=${c.captured}`;
  if (c.refunded === true) return 'refunded';
  if (c.livemode === false) return 'livemode=false';
  return null;
}

for (const c of charges) {
  const reason = whyNotUsable(c);
  if (reason) { skipped += 1; skipReasons[reason] = (skipReasons[reason] || 0) + 1; continue; }
  const cls = classify(c);
  if (cls.skip) { skipped += 1; skipReasons[cls.reason] = (skipReasons[cls.reason] || 0) + 1; continue; }
  const amt = netAmount(c);
  if (amt <= 0) continue;
  totalGbp += amt;
  bySource[cls.source] = (bySource[cls.source] || 0) + amt;
  byTier[cls.tier] = (byTier[cls.tier] || 0) + amt;
  const m = monthOf(c.created);
  byMonth[m] = byMonth[m] || { workshops: 0, courses: 0, services: 0, hire: 0, academy: 0, other: 0, total: 0 };
  byMonth[m][cls.tier] += amt;
  byMonth[m].total += amt;
  if (!sampleByClassifier[cls.source]) {
    sampleByClassifier[cls.source] = { amount: amt, desc: c.description, app: c.application, created: new Date(c.created * 1000).toISOString().slice(0, 10) };
  }
}

console.log('Skipped:', skipped);
console.log('  Skip reasons:');
for (const [k, v] of Object.entries(skipReasons)) console.log(`    ${k.padEnd(40)} ${v}`);
console.log('Classified count:', charges.length - skipped);
console.log('Total GBP (classified, supplemental only): £' + totalGbp.toFixed(2));
console.log('\nBy classifier source:');
for (const [k, v] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} £${v.toFixed(2)}`);
}
console.log('\nBy commercial tier:');
for (const [k, v] of Object.entries(byTier).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} £${v.toFixed(2)}`);
}
console.log('\nSamples per classifier:');
for (const [src, sample] of Object.entries(sampleByClassifier)) {
  console.log(`  ${src}: £${sample.amount.toFixed(2)}  ${sample.created}  app=${sample.app || '<none>'}  "${sample.desc || ''}"`);
}
console.log('\nBy month (UTC):');
const months = Object.keys(byMonth).sort();
console.log('  month     | workshops | courses  | services | hire     | academy  | other    | total');
console.log('  ---------- + --------- + -------- + -------- + -------- + -------- + -------- + ---------');
for (const m of months) {
  const b = byMonth[m];
  const f = (n) => `£${n.toFixed(2)}`.padStart(8);
  console.log(`  ${m}    | ${f(b.workshops).padStart(9)} | ${f(b.courses)} | ${f(b.services)} | ${f(b.hire)} | ${f(b.academy)} | ${f(b.other)} | £${b.total.toFixed(2)}`);
}
