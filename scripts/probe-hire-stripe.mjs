// Investigation: find Hire/Commercial customer names in Stripe charges directly.
// Pull Stripe 2026 YTD and search by customer name + description.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadEnv(p) { const t = readFileSync(p,'utf8'); for (const l of t.split(/\r?\n/)) { if(!l||l.startsWith('#')||!l.includes('='))continue; const i=l.indexOf('='); const k=l.slice(0,i).trim(); const v=l.slice(i+1).trim(); if(!process.env[k]) process.env[k]=v; } }
loadEnv(resolve(__dirname, '..', '.env.local'));

const STRIPE_APP_ACUITY = 'ca_4ql8gN64L2WdUGmp8trq7lG5gwpnSQNd';
const STRIPE_APP_SS_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';
const STRIPE_APP_SS_COMMERCE = 'ca_mkRFitTSIk45FHQiB17BHY6ZjeIEmLwM';

async function stripeFetchPage(starting, gte, lte) {
  const p = new URLSearchParams();
  p.set('limit', '100');
  p.set('created[gte]', String(gte));
  p.set('created[lte]', String(lte));
  p.append('expand[]', 'data.invoice');
  p.append('expand[]', 'data.customer');
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

function appName(c) {
  if (c.application === STRIPE_APP_ACUITY) return 'Acuity';
  if (c.application === STRIPE_APP_SS_MEMBER_AREAS) return 'SS-Members';
  if (c.application === STRIPE_APP_SS_COMMERCE) return 'SS-Commerce';
  if (c?.metadata?.orderId || c?.metadata?.websiteId) return 'SS-Commerce(meta)';
  return c.application ? `app:${c.application.slice(0,12)}` : 'none';
}

function chargeRow(c) {
  const date = new Date(c.created * 1000).toISOString().slice(0, 10);
  const amt = Math.max(0, (Number(c.amount) || 0) - (Number(c.amount_refunded) || 0)) / 100;
  const customer = c.billing_details?.name || c.customer?.name || '';
  const email = c.billing_details?.email || c.receipt_email || c.customer?.email || '';
  return {
    date,
    amount: amt,
    customer,
    email,
    description: c.description || '',
    app: appName(c),
    status: c.status,
    refunded: c.refunded,
    paid: c.paid
  };
}

console.log('Fetching Stripe charges 2026-01-01 -> 2026-05-31 ...');
const charges = await stripeFetchAll('2026-01-01', '2026-05-31');
console.log(`Got ${charges.length} charges.\n`);

const NEEDLES = ['Grace Brown', 'Heidi Gibbs', 'Francisca', 'Brooklyn Brow', 'Penelope Ulander'];

for (const needle of NEEDLES) {
  const hits = [];
  for (const c of charges) {
    const r = chargeRow(c);
    const blob = `${r.customer} ${r.email} ${r.description}`.toLowerCase();
    if (blob.includes(needle.toLowerCase())) hits.push(r);
  }
  console.log(`--- "${needle}" : ${hits.length} matching Stripe charges ---`);
  for (const h of hits) {
    console.log(`  ${h.date}  GBP ${h.amount.toFixed(2).padStart(7)}  app=${h.app.padEnd(8)}  paid=${h.paid} refunded=${h.refunded}  "${h.customer}" / "${h.email}"`);
    console.log(`     desc: ${h.description}`);
  }
}
