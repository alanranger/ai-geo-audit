// commercial-tier-products.js
//
// Returns every product known to Supabase with the commercial-tier
// classification applied. Used for the Revenue Funnel "tier review" table
// so the user can spot misclassifications before the per-tier sparklines
// lock onto them.
//
// Method: GET
// Query:  none
// Source: v_products_unified_open  (chat AI bot products with kind_resolved)

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { classifyCommercialTier, COMMERCIAL_TIERS, tierLabel } from './commercial-tier.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function dedupeProducts(rows) {
  // v_products_unified_open has one row per (product_url, variant) so each
  // product appears up to 2-3 times. Keep the row with the highest price
  // (richest variant) since the classifier only needs URL + title and
  // higher price = more representative.
  const byUrl = new Map();
  for (const row of rows || []) {
    const key = row.product_url || '';
    if (!key) continue;
    const existing = byUrl.get(key);
    const price = Number(row.display_price_gbp) || 0;
    if (!existing || price > (Number(existing.display_price_gbp) || 0)) {
      byUrl.set(key, row);
    }
  }
  return Array.from(byUrl.values());
}

function buildTierBuckets() {
  const buckets = {};
  for (const t of COMMERCIAL_TIERS) buckets[t.id] = { tier_id: t.id, tier_label: t.label, products: [] };
  buckets.other = { tier_id: 'other', tier_label: 'Other', products: [] };
  return buckets;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await supabase
      .from('v_products_unified_open')
      .select('product_url, product_title, product_kind_resolved, display_price_gbp, availability_status, last_seen');
    if (error) throw error;

    const products = dedupeProducts(data).map(row => {
      const tier = classifyCommercialTier({
        productUrl: row.product_url,
        productName: row.product_title
      });
      return {
        product_url: row.product_url,
        product_title: row.product_title,
        product_kind_resolved: row.product_kind_resolved,
        price_gbp: Number(row.display_price_gbp) || null,
        availability_status: row.availability_status,
        last_seen: row.last_seen,
        commercial_tier: tier,
        commercial_tier_label: tierLabel(tier)
      };
    });
    products.sort((a, b) => {
      if (a.commercial_tier !== b.commercial_tier) return a.commercial_tier.localeCompare(b.commercial_tier);
      return (b.price_gbp || 0) - (a.price_gbp || 0);
    });

    const buckets = buildTierBuckets();
    const summary = { totals: {} };
    for (const p of products) {
      const id = p.commercial_tier;
      if (buckets[id]) buckets[id].products.push(p);
      else buckets.other.products.push(p);
      summary.totals[id] = (summary.totals[id] || 0) + 1;
    }

    return send(res, 200, {
      generated_at: new Date().toISOString(),
      product_count: products.length,
      summary,
      tiers: Object.values(buckets),
      products
    });
  } catch (err) {
    return send(res, 500, { error: 'tier_products_failed', message: err?.message || String(err) });
  }
}
