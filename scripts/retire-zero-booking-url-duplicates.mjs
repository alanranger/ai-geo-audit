/**
 * Retire active canonical_products that duplicate another name on the same
 * product_url where the sibling has Booking Sheet revenue and this row has none.
 *
 *   node scripts/retire-zero-booking-url-duplicates.mjs          # dry-run
 *   node scripts/retire-zero-booking-url-duplicates.mjs --apply  # write DB
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { slugFromCanonicalUrl } from '../lib/revenue-stream-gsc-roles.js';

const apply = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: products, error: pe } = await sb.from('canonical_products')
  .select('product_title, product_url, is_retired');
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

const byUrl = new Map();
for (const p of products || []) {
  if (p.is_retired) continue;
  const slug = slugFromCanonicalUrl(p.product_url);
  if (!slug) continue;
  if (!byUrl.has(slug)) byUrl.set(slug, []);
  byUrl.get(slug).push({
    title: p.product_title,
    txns: txnCount.get(p.product_title) || 0,
    rev: revByTitle.get(p.product_title) || 0
  });
}

const toRetire = [];
for (const [, rows] of byUrl) {
  if (rows.length < 2) continue;
  const withBookings = rows.filter((r) => r.txns > 0 || r.rev > 0);
  if (!withBookings.length) continue;
  for (const r of rows) {
    if (r.txns === 0 && r.rev === 0) toRetire.push(r.title);
  }
}

console.log(apply ? 'APPLY mode' : 'DRY-RUN');
console.log('Products to retire:', toRetire.length);
for (const title of toRetire) console.log(' -', title);

if (!toRetire.length) {
  console.log('Nothing to do.');
  process.exit(0);
}

if (!apply) {
  console.log('\nRe-run with --apply to set is_retired=true');
  process.exit(0);
}

for (const title of toRetire) {
  const { error } = await sb.from('canonical_products')
    .update({ is_retired: true })
    .eq('product_title', title);
  if (error) throw error;
  console.log('Retired:', title);
}

console.log('Done.');
