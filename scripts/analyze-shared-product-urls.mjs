import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { slugFromCanonicalUrl } from '../lib/revenue-stream-gsc-roles.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: products, error: pe } = await sb.from('canonical_products')
  .select('product_title, product_url, service_page_url, is_retired, typical_price_gbp');
if (pe) throw pe;

const { data: txns, error: te } = await sb.from('booking_sheet_transactions')
  .select('canonical_product, amount, is_jlr');
if (te) throw te;

const revByTitle = new Map();
const txnCount = new Map();
for (const t of txns || []) {
  const k = t.canonical_product;
  if (!k) continue;
  txnCount.set(k, (txnCount.get(k) || 0) + 1);
  const amt = t.is_jlr ? 0 : (Number(t.amount) || 0);
  revByTitle.set(k, (revByTitle.get(k) || 0) + amt);
}

function hubSlug(url) {
  if (!url) return '(no hub)';
  return String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '') || '(no hub)';
}

const byUrl = new Map();
for (const p of products || []) {
  if (p.is_retired) continue;
  const slug = slugFromCanonicalUrl(p.product_url);
  if (!slug) continue;
  if (!byUrl.has(slug)) byUrl.set(slug, []);
  byUrl.get(slug).push({
    title: p.product_title,
    hub: hubSlug(p.service_page_url),
    slug,
    txns: txnCount.get(p.product_title) || 0,
    rev: revByTitle.get(p.product_title) || 0
  });
}

const dupGroups = [...byUrl.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([slug, rows]) => {
    const hubs = [...new Set(rows.map((r) => r.hub))];
    const withRev = rows.filter((r) => r.rev > 0 || r.txns > 0);
    const zeroOnly = rows.filter((r) => r.rev === 0 && r.txns === 0);
    const retireCandidates = zeroOnly.length > 0 && withRev.length > 0 ? zeroOnly : [];
    return { slug, hubs, rows, retireCandidates };
  })
  .sort((a, b) => b.rows.length - a.rows.length);

console.log('=== Shared product_url groups (active, URL set) ===');
console.log('Total groups with 2+ names on same URL:', dupGroups.length);
console.log('Groups with zero-booking duplicate + revenue sibling:', dupGroups.filter((g) => g.retireCandidates.length).length);

const byHub = new Map();
for (const g of dupGroups) {
  for (const h of g.hubs) {
    if (!byHub.has(h)) byHub.set(h, []);
    byHub.get(h).push(g);
  }
}
console.log('\n=== Hubs affected ===');
for (const [hub, groups] of [...byHub.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const retireN = groups.filter((g) => g.retireCandidates.length).length;
  console.log(`${hub}: ${groups.length} shared-URL group(s), ${retireN} retire-candidate`);
}

console.log('\n=== Retire candidates ===');
for (const g of dupGroups.filter((x) => x.retireCandidates.length)) {
  console.log(`\nURL: ${g.slug}`);
  console.log(`Hub(s): ${g.hubs.join(', ')}`);
  for (const r of g.rows) {
    console.log(`  ${String(r.txns).padStart(3)} txns £${r.rev.toFixed(0).padStart(6)} | ${r.title}`);
  }
  for (const r of g.retireCandidates) {
    console.log(`  -> RETIRE: ${r.title}`);
  }
}

console.log('\n=== Ambiguous (no auto-retire) ===');
for (const g of dupGroups.filter((x) => !x.retireCandidates.length)) {
  console.log(`${g.slug} | ${g.rows.length} names | ${g.rows.map((r) => `${r.txns}tx/${r.title.slice(0, 40)}`).join(' ;; ')}`);
}
