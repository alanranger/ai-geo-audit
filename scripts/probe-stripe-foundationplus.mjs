// Pull 2026 YTD Stripe charges that look like Foundation Plus / Premium
// Membership renewals (Squarespace Member Areas Connect app) and print
// enough metadata to decide how to deduplicate against the SQ Orders
// sync. We want to know:
//
//   1. application (== STRIPE_APP_SS_MEMBER_AREAS?)
//   2. metadata.orderId / metadata.websiteId  (used by looksLikeSquarespaceCommerce)
//   3. description (how the classifier sees the charge)
//   4. amount / refunded
//   5. invoice.subscription (rule #4 fallback)
//
// If MEMBER_AREAS charges DO have orderId metadata, then the existing
// looksLikeSquarespaceCommerce rule already skips them - meaning the
// 80 GBP we see in Stripe academy is NOT Foundation Plus and the
// reconciliation gap is something else entirely.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) { console.error('Missing STRIPE_SECRET_KEY'); process.exit(1); }
const APP_MEMBER_AREAS = 'ca_DaYAQ9N2WU8EUp7xz9Xa2cjhbar2kipH';

const FROM = Math.floor(new Date('2026-01-01T00:00:00Z').getTime() / 1000);
const TO   = Math.floor(new Date('2026-05-31T23:59:59Z').getTime() / 1000);

async function listCharges() {
  const out = [];
  let starting_after = '';
  for (let i = 0; i < 20; i += 1) {
    const params = new URLSearchParams({
      'created[gte]': String(FROM),
      'created[lte]': String(TO),
      limit: '100',
      'expand[]': 'data.invoice'
    });
    if (starting_after) params.set('starting_after', starting_after);
    const r = await fetch(`https://api.stripe.com/v1/charges?${params}`, {
      headers: { Authorization: `Bearer ${STRIPE_KEY}` }
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`http_${r.status}: ${t.slice(0, 300)}`);
    }
    const page = await r.json();
    for (const c of page.data || []) out.push(c);
    if (!page.has_more || !page.data.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return out;
}

const charges = await listCharges();
console.log(`Fetched ${charges.length} charges in 2026 YTD.`);

const memberAreas = charges.filter(c => c.application === APP_MEMBER_AREAS);
console.log(`\nMember Areas charges: ${memberAreas.length}`);
let academyFromMA = 0;
let fpFromMA = 0, pmFromMA = 0, otherFromMA = 0;
for (const c of memberAreas) {
  const amt = (c.amount || 0) / 100;
  const refunded = (c.amount_refunded || 0) / 100;
  const net = Math.max(0, amt - refunded);
  const desc = c.description || '';
  const orderId = c.metadata?.orderId || '';
  const websiteId = c.metadata?.websiteId || '';
  const subId = c.invoice?.subscription || '';
  const status = c.paid ? 'paid' : (c.status || 'unpaid');
  console.log(`  ${(c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : '')}  net=\u00a3${net.toFixed(2).padStart(6)}  status=${status}  orderId=${orderId || '-'}  websiteId=${websiteId || '-'}  subId=${subId || '-'}  desc='${desc}'`);
  if (status === 'paid' || c.paid) {
    academyFromMA += net;
    const dl = desc.toLowerCase();
    if (dl.includes('foundation')) fpFromMA += net;
    else if (dl.includes('premium')) pmFromMA += net;
    else otherFromMA += net;
  }
}
console.log(`\nMember Areas paid net total: \u00a3${academyFromMA.toFixed(2)}`);
console.log(`  Foundation Plus:    \u00a3${fpFromMA.toFixed(2)}`);
console.log(`  Premium Membership: \u00a3${pmFromMA.toFixed(2)}`);
console.log(`  Other:              \u00a3${otherFromMA.toFixed(2)}`);

// Also: any non-Member-Areas charge that mentions Foundation Plus?
const fpAny = charges.filter(c => /foundation plus/i.test(c.description || ''));
console.log(`\nCharges with 'Foundation Plus' in description: ${fpAny.length}`);
for (const c of fpAny) {
  const app = c.application || '-';
  console.log(`  ${new Date(c.created * 1000).toISOString().slice(0, 10)}  net=\u00a3${(((c.amount || 0) - (c.amount_refunded || 0)) / 100).toFixed(2)}  app=${app}  orderId=${c.metadata?.orderId || '-'}  desc='${c.description}'`);
}
