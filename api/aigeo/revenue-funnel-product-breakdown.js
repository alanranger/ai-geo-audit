// Revenue Funnel - Per-Product Breakdown (Phase C / C2 part 2)
//
// Lazy-loaded drilldown endpoint for the Revenue Funnel Diagnosis UI card.
// Returns the per-product list for a given service_page_url, each row
// enriched with its OWN seasonality_type / event_months from canonical_products
// and its booked revenue from booking_sheet_transactions -- shown both
// lifetime and restricted to the same 17-month GSC window the page-level
// verdict reads. The card UI calls this on "expand" so the main diagnosis
// payload stays compact.
//
// REQ-2 (Cursor instruction 2026-05-27): pages where event_bound coexists
// with year_round / season_bound products MUST be drillable in the UI so
// event-bound product problems are not hidden inside season_bound page
// verdicts. This endpoint feeds that drilldown.
//
// Method: GET
// Query:
//   page         REQUIRED. Page slug (e.g. 'private-photography-lessons')
//                or full URL ('https://www.alanranger.com/...'). Slug-only
//                is the canonical form.
//   includeJlr   'true' to include JLR revenue in totals (default false).
//   windowMonths integer (default 17). The same window the page-level
//                verdict uses. Window starts at TODAY - windowMonths.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_WINDOW_MONTHS = 17;
const DEFAULT_PROPERTY = 'https://www.alanranger.com';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    const opts = parseQuery(req);
    if (!opts.pageSlug) {
      res.status(400).json({ error: 'query param "page" is required (slug or full URL)' });
      return;
    }
    const supabase = createSupabase();
    const payload = await buildPayload(supabase, opts);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  } catch (err) {
    console.error('[revenue-funnel-product-breakdown] failed:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
}

function parseQuery(req) {
  const q = req.query || {};
  const rawPage = String(q.page || '').trim();
  return {
    propertyUrl: String(q.propertyUrl || DEFAULT_PROPERTY).trim(),
    pageSlug: slugFromTargetUrl(rawPage),
    pageInput: rawPage,
    windowMonths: clampInt(q.windowMonths, 1, 36, DEFAULT_WINDOW_MONTHS),
    includeJlr: q.includeJlr === 'true'
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function createSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function slugFromTargetUrl(targetUrl) {
  if (!targetUrl) return null;
  const v = String(targetUrl).toLowerCase().trim();
  const noProtocol = v.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const noQuery = noProtocol.split('?')[0].split('#')[0];
  const path = noQuery.includes('/') ? noQuery.slice(noQuery.indexOf('/') + 1) : noQuery;
  return path.replace(/^\/+/, '').replace(/\/+$/, '') || null;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

async function buildPayload(supabase, opts) {
  const products = await fetchProductsForSlug(supabase, opts.pageSlug);
  if (!products.length) {
    return emptyPayload(opts, 'no canonical_products matched this page slug');
  }
  const productTitles = products.map(p => p.product_title);
  const txns = await fetchTxnsForProducts(supabase, productTitles);
  const windowStart = computeWindowStartIso(opts.windowMonths);
  const breakdown = buildProductBreakdown(products, txns, { windowStart, includeJlr: opts.includeJlr });
  return {
    asOf: new Date().toISOString(),
    propertyUrl: opts.propertyUrl,
    page_slug: opts.pageSlug,
    windowMonths: opts.windowMonths,
    window_start: windowStart,
    includeJlr: opts.includeJlr,
    revenue_basis: opts.includeJlr ? 'JLR-inclusive' : 'JLR-excluded',
    page_seasonality_class: derivePageSeasonalityClass(products),
    products_on_page: products.length,
    products: breakdown,
    totals: rollupTotals(breakdown)
  };
}

function emptyPayload(opts, note) {
  return {
    asOf: new Date().toISOString(),
    propertyUrl: opts.propertyUrl,
    page_slug: opts.pageSlug,
    windowMonths: opts.windowMonths,
    includeJlr: opts.includeJlr,
    page_seasonality_class: null,
    products_on_page: 0,
    products: [],
    totals: emptyTotals(),
    note
  };
}

async function fetchProductsForSlug(supabase, pageSlug) {
  const { data: candidates, error } = await supabase
    .from('canonical_products')
    .select('product_title, category, typical_price_gbp, service_page_url, seasonality_type, event_months, is_retired, is_redemption');
  if (error) throw error;
  return (candidates || []).filter(p => slugFromTargetUrl(p.service_page_url) === pageSlug);
}

async function fetchTxnsForProducts(supabase, productTitles) {
  if (!productTitles.length) return [];
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('canonical_product, amount, txn_date, is_jlr')
    .in('canonical_product', productTitles);
  if (error) throw error;
  return data || [];
}

function computeWindowStartIso(windowMonths) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (windowMonths - 1));
  return d.toISOString().slice(0, 10);
}

function buildProductBreakdown(products, txns, ctx) {
  const byProduct = groupTxnsByProduct(txns);
  return products
    .map(p => productRow(p, byProduct.get(p.product_title) || [], ctx))
    .sort((a, b) => b.lifetime_revenue_active - a.lifetime_revenue_active);
}

function groupTxnsByProduct(txns) {
  const out = new Map();
  for (const t of txns) {
    if (!t.canonical_product) continue;
    let arr = out.get(t.canonical_product);
    if (!arr) { arr = []; out.set(t.canonical_product, arr); }
    arr.push(t);
  }
  return out;
}

function productRow(product, productTxns, ctx) {
  const lifetime = aggTxns(productTxns, null, ctx.includeJlr);
  const windowed = aggTxns(productTxns, ctx.windowStart, ctx.includeJlr);
  return {
    product_title: product.product_title,
    category: product.category,
    typical_price_gbp: product.typical_price_gbp == null ? null : Number(product.typical_price_gbp),
    seasonality_type: product.seasonality_type,
    event_months: product.event_months,
    is_retired: product.is_retired === true,
    is_redemption: product.is_redemption === true,
    lifetime_revenue_active: lifetime.active,
    lifetime_revenue_nonjlr: lifetime.nonjlr,
    lifetime_revenue_total: lifetime.total,
    lifetime_txn_count: lifetime.count,
    lifetime_first_txn: lifetime.first,
    lifetime_last_txn: lifetime.last,
    window_revenue_active: windowed.active,
    window_revenue_nonjlr: windowed.nonjlr,
    window_revenue_total: windowed.total,
    window_txn_count: windowed.count,
    extends_before_window: !!(lifetime.first && ctx.windowStart && lifetime.first < ctx.windowStart)
  };
}

function aggTxns(txns, sinceIso, includeJlr) {
  let nonjlr = 0, jlr = 0, total = 0, count = 0, first = null, last = null;
  for (const t of txns) {
    if (sinceIso && t.txn_date && t.txn_date < sinceIso) continue;
    const amt = Number(t.amount) || 0;
    total += amt;
    if (t.is_jlr) { jlr += amt; } else { nonjlr += amt; }
    count += 1;
    if (t.txn_date && (first === null || t.txn_date < first)) first = t.txn_date;
    if (t.txn_date && (last  === null || t.txn_date > last))  last  = t.txn_date;
  }
  return {
    nonjlr: round2(nonjlr),
    jlr: round2(jlr),
    total: round2(total),
    active: round2(includeJlr ? total : nonjlr),
    count,
    first,
    last
  };
}

function rollupTotals(breakdown) {
  let life = 0, win = 0, lifeNon = 0, winNon = 0, lifeTot = 0, winTot = 0;
  for (const r of breakdown) {
    life     += r.lifetime_revenue_active || 0;
    win      += r.window_revenue_active   || 0;
    lifeNon  += r.lifetime_revenue_nonjlr || 0;
    winNon   += r.window_revenue_nonjlr   || 0;
    lifeTot  += r.lifetime_revenue_total  || 0;
    winTot   += r.window_revenue_total    || 0;
  }
  return {
    lifetime_revenue_active: round2(life),
    window_revenue_active: round2(win),
    lifetime_revenue_nonjlr: round2(lifeNon),
    window_revenue_nonjlr: round2(winNon),
    lifetime_revenue_total: round2(lifeTot),
    window_revenue_total: round2(winTot),
    products_with_zero_lifetime: breakdown.filter(r => (r.lifetime_revenue_total || 0) === 0).length
  };
}

function emptyTotals() {
  return {
    lifetime_revenue_active: 0,
    window_revenue_active: 0,
    lifetime_revenue_nonjlr: 0,
    window_revenue_nonjlr: 0,
    lifetime_revenue_total: 0,
    window_revenue_total: 0,
    products_with_zero_lifetime: 0
  };
}

function derivePageSeasonalityClass(products) {
  const counts = { yr: 0, sb: 0, eb: 0, none: 0, unclassified: 0 };
  const eventMonths = new Set();
  for (const p of products) {
    const t = p.seasonality_type;
    if (t === 'year_round') counts.yr += 1;
    else if (t === 'season_bound') counts.sb += 1;
    else if (t === 'event_bound') {
      counts.eb += 1;
      addEventMonths(eventMonths, p.event_months);
    }
    else if (t === 'none') counts.none += 1;
    else counts.unclassified += 1;
  }
  return {
    type: classifyByCounts(counts),
    counts,
    event_months: [...eventMonths].sort((a, b) => a - b),
    is_mixed_seasonality: counts.eb > 0 && (counts.yr + counts.sb) > 0
  };
}

function addEventMonths(set, raw) {
  if (!raw) return;
  for (const m of String(raw).split(',')) {
    const n = Number(m);
    if (Number.isInteger(n) && n >= 1 && n <= 12) set.add(n);
  }
}

function classifyByCounts(c) {
  if ((c.yr + c.sb) > 0) return 'season_bound';
  if (c.eb > 0) return 'event_bound';
  if (c.none === (c.yr + c.sb + c.eb + c.none + c.unclassified)) return 'none';
  return 'unknown';
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
