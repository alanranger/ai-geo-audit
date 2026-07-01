// Revenue Funnel Diagnosis - Phase C / C2 part 1 (analyser, data-only)
//
// Reads `revenue_gsc_joined` (Phase C / C1 view) and classifies each page
// into one of seven diagnostic states by comparing the most recent N months
// against the prior N months, then ranks the result by severity.
//
// Method:  GET
// Query:
//   propertyUrl     (default https://www.alanranger.com)
//   windowMonths    (default 6; clamped 3..12) -- comparison half-window
//   minImpressions  (default 1000) -- pages below this skip classification
//   pages           comma-separated slugs to restrict output (optional)
//   includeAllPages 'true' to include insufficient_data rows in response
//
// Apply order (per existing workspace conventions):
//   1. Per-product seasonality classification (canonical_products.seasonality_type
//      + event_months, loaded by scripts/load-product-seasonality.mjs) rolls up to
//      a per-page class via:
//        a) ANY year_round OR season_bound product -> page = 'season_bound'
//           -> use tier-level blended factor (70% observed booking sheet + 30%
//              stated activity calendar) and SUBTRACT the expected delta from
//              the observed period-over-period impressions delta.
//        b) ALL products are event_bound -> page = 'event_bound'
//           -> ignore tier-level seasonality; compare ONLY the months in the
//              union of event_months for the most recent calendar year vs the
//              same months in the prior calendar year. If fewer than 2 years of
//              data for those months: state = 'insufficient_history' (visibility
//              loss + narrowing query footprint rules skipped; zero_conv +
//              funnel_bypass still fire).
//        c) ALL products are 'none' (voucher / redemption plumbing) -> page is
//           skipped entirely (state = 'skipped_none').
//      Pages with no canonical_products entries default to 'season_bound'.
//   2. Suppression is loaded from `optimisation_tasks` rows where status
//      IN ('monitoring','planned'). Best-effort: if the table query fails
//      the diagnosis still runs, with an empty suppression block.
//
// No UI. No Vercel deploy planned in this change. Phase C / C2 part 2
// (UI integration) is a separate, separately-approved sub-phase.

export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';
import { diagnosisCacheKey, resolveWithCache } from '../../lib/revenue-truth-cache.mjs';
import {
  loadBlendedSeasonality,
  factorFromBlend
} from '../../lib/revenue-funnel-seasonality-blend.js';
import {
  fetchTierSegmentationEntries,
  buildTierLookupFromEntries,
  getTierForUrlFromLookup
} from './tier-segmentation.js';
import {
  TIER_ORDER,
  TIER_DEFINITIONS,
  BOOKING_SHEET_NON_JLR_TARGETS,
  tierFromProductCategory,
  tierFromBookingCategory,
  shouldKeepByPageTier,
  isAcademyCommercialSlug,
  normalizePageSlug
} from '../../lib/revenue-tier-mapping.js';
import { loadRevenueStreamGscRoles } from '../../lib/revenue-stream-gsc-roles.js';
import { applyPageVisibilityLossPolicyGuard } from '../../lib/page-indexability-policy.js';
import { parseIncludeJlr } from '../../lib/parse-include-jlr.mjs';

const SITE_ORIGIN = 'https://www.alanranger.com';
const GSC_FIRST_DAY = '2025-01-13';
const TIER_GSC_TREND_WINDOW_MONTHS = 3;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const DEFAULT_WINDOW_MONTHS = 12;
const DEFAULT_MIN_IMPRESSIONS = 1000;
const ACTIVE_CYCLE_STATUSES = ['monitoring', 'planned'];

// Classifier thresholds (tune here, not inline). Numbers are deliberately
// conservative -- false negatives are cheaper than false positives in a
// "this page is broken" surface, because every false positive that ships
// to the dashboard erodes the user's trust in the next signal.
const THRESHOLDS = {
  zero_conv_min_clicks: 50,
  funnel_bypass_min_revenue_gbp: 5000,
  funnel_bypass_max_clicks_per_pound: 0.05,
  visibility_loss_imp_delta_pct: -30,
  visibility_loss_min_pos_drop: 2,
  low_ctr_baseline_pct: 0.5,
  traffic_rich_min_clicks: 500,
  traffic_rich_min_revenue_gbp: 1000,
  traffic_rich_max_revenue_gbp: 10000
};

// Rank scores for sorting: lower = more concerning, surfaces first.
const RANK_SCORES = {
  traffic_with_zero_conversion: -100,
  visibility_loss_with_low_ctr_baseline: -85,
  visibility_loss_normal_ctr: -70,
  funnel_bypass_revenue_with_minimal_organic: -60,
  traffic_rich_modest_conversion: -20,
  matched_healthy: 0,
  insufficient_data: 50,
  // event_bound page with <2 years of same-month coverage: we KNOW we cannot
  // compare seasonally, which is different from "we don't have enough data".
  insufficient_history: 55,
  // 'none' product page (voucher plumbing / royalty / redemption): not a
  // user-facing surface to diagnose. Filtered from default output.
  skipped_none: 100
};

const PAGE_CLASS_DEFAULT = 'season_bound';

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
    const supabase = createSupabase();
    // Param-specific requests (explicit page list / include-all) are never
    // cached; the normal dashboard load is served from the precomputed cache
    // with a live build + write-through fallback.
    const cacheable = !opts.pages && !opts.includeAllPages;
    const payload = await resolveWithCache(
      supabase,
      opts.propertyUrl,
      diagnosisCacheKey(opts),
      () => buildPayload(supabase, opts),
      { cacheable }
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(payload);
  } catch (err) {
    console.error('[revenue-funnel-diagnosis] failed:', err);
    res.status(500).json({ error: err.message || 'internal error' });
  }
}

// Build the opts object the warming cron uses (mirrors parseQuery defaults).
export function buildDiagnosisOpts(overrides = {}) {
  return {
    propertyUrl: overrides.propertyUrl || DEFAULT_PROPERTY,
    windowMonths: overrides.windowMonths || DEFAULT_WINDOW_MONTHS,
    minImpressions: overrides.minImpressions == null ? DEFAULT_MIN_IMPRESSIONS : overrides.minImpressions,
    pages: null,
    includeAllPages: false,
    includeJlr: !!overrides.includeJlr,
    includeEvent: !!overrides.includeEvent
  };
}

export { buildPayload as buildDiagnosisPayload, createSupabase as createDiagnosisSupabase };

function parseQuery(req) {
  const q = req.query || {};
  const pagesParam = String(q.pages || '').trim();
  return {
    propertyUrl: String(q.propertyUrl || DEFAULT_PROPERTY).trim(),
    windowMonths: clampInt(q.windowMonths, 3, 18, DEFAULT_WINDOW_MONTHS),
    minImpressions: clampInt(q.minImpressions, 0, 1000000, DEFAULT_MIN_IMPRESSIONS),
    pages: pagesParam
      ? pagesParam.split(',').map(s => s.trim()).filter(Boolean)
      : null,
    includeAllPages: q.includeAllPages === 'true',
    // Phase C / C2 part 2 -- when true, classify using JLR-inclusive revenue
    // (revenue_gbp_total). Default true matches Booking Sheet headline; set
    // includeJlr=false to use the non-JLR view.
    includeJlr: parseIncludeJlr(q.includeJlr),
    // Phase C / C2 part 3 -- page-type tier filter. Default = Tier A landing
    // + Tier B product + Tier E academy (sellable surfaces only). Set
    // includeEvent=true to also include Tier C event-instance pages. Tier D
    // blog + Tier F unmapped are always excluded from the diagnosis view.
    includeEvent: q.includeEvent === 'true'
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

// ---------------------------------------------------------------------------
// Payload orchestrator
// ---------------------------------------------------------------------------

const HIDDEN_STATES_DEFAULT = new Set(['insufficient_data', 'skipped_none']);

async function buildPayload(supabase, opts) {
  const [rows, seasonality, suppression, pageSeasonality, lifetimeRevenue, productTierMap, bookingRevenue, pageTierLookup, gscRoleLookup] = await Promise.all([
    fetchJoinedRows(supabase, opts),
    loadBlendedSeasonality(supabase, opts.propertyUrl),
    fetchActiveSuppression(supabase),
    fetchPageSeasonality(supabase),
    fetchLifetimePageRevenue(supabase),
    fetchProductTierMap(supabase),
    fetchBookingRevenueByTier(supabase, opts.propertyUrl),
    loadPageTierLookup(),
    loadRevenueStreamGscRoles(supabase)
  ]);
  const gscBySlug = await fetchGscTotalsBySlug(
    supabase,
    opts.propertyUrl,
    collectRoleGscSlugs(gscRoleLookup)
  );
  const pages = aggregateByPage(rows, opts.windowMonths, opts.includeJlr);
  const ctx = { seasonality, suppression, opts, pageSeasonality, lifetimeRevenue };
  const allDiagnostics = pages.map(page => classifyPage(page, ctx));
  assignTiersToDiagnostics(allDiagnostics, productTierMap, pageTierLookup);
  const filteredDiagnostics = applyTierFilters(allDiagnostics, opts);
  const diagnostics = filteredDiagnostics
    .filter(d => opts.includeAllPages || !HIDDEN_STATES_DEFAULT.has(d.state))
    .sort((a, b) => a.rank_score - b.rank_score);
  const gscWindow = computeGscWindow(rows);
  const tierRollup = buildTierRollup({
    diagnostics: filteredDiagnostics,
    bookingRevenue,
    gscWindow,
    includeJlr: opts.includeJlr,
    gscRoleLookup,
    gscBySlug
  });
  return {
    asOf: new Date().toISOString(),
    propertyUrl: opts.propertyUrl,
    windowMonths: opts.windowMonths,
    includeJlr: opts.includeJlr,
    includeEvent: opts.includeEvent,
    revenue_basis: opts.includeJlr ? 'JLR-inclusive (revenue_gbp_total)' : 'JLR-excluded (revenue_gbp_nonjlr)',
    gsc_window: gscWindow,
    thresholds: THRESHOLDS,
    seasonality: {
      calibration_note: seasonality.calibration_note,
      byTier: seasonality.byTier
    },
    page_seasonality: {
      pages_classified: pageSeasonality.size,
      breakdown_by_class: pageClassCounts(pageSeasonality)
    },
    suppression: {
      active_cycles_count: suppression.cyclesCount,
      urls_in_monitoring: suppression.urlsCount
    },
    tier_filter_meta: buildTierFilterMeta(allDiagnostics, filteredDiagnostics, opts),
    tier_rollup: tierRollup,
    tier_reconciliation: buildTierReconciliation(tierRollup, bookingRevenue),
    workshops_residential_attribution: buildWorkshopsResidentialAttribution(
      allDiagnostics,
      opts.includeEvent
    ),
    unmapped_product_categories: productTierMap.unmappedCategories,
    pages_diagnosed: diagnostics.length,
    diagnostics
  };
}

function pageClassCounts(pageSeasonality) {
  const counts = { season_bound: 0, event_bound: 0, none: 0 };
  for (const entry of pageSeasonality.values()) {
    counts[entry.type] = (counts[entry.type] || 0) + 1;
  }
  return counts;
}

async function fetchJoinedRows(supabase, opts) {
  const pageSize = 1000;
  const all = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from('revenue_gsc_joined_with_policy')
      .select('page_slug, year, month, period_start, revenue_gbp_nonjlr, revenue_gbp_total, revenue_gbp_jlr, clicks, impressions, ctr_pct, avg_position_imp_weighted, days_with_data, join_state, policy_value, policy_effective_date, policy_url_or_prefix, policy_match_type, policy_redirect_target, policy_note')
      .eq('property_url', opts.propertyUrl);
    if (opts.pages?.length) q = q.in('page_slug', opts.pages);
    const { data, error } = await q
      .order('page_slug', { ascending: true })
      .order('period_start', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

// Phase C / C2 part 2 -- per-page lifetime revenue (back to first txn in the
// Booking Sheet, may extend before GSC window). Used by the UI to surface
// "revenue history extends earlier" warnings on diagnosis cards. Keyed by
// the normalized page_slug to match the diagnostics output.
async function fetchLifetimePageRevenue(supabase) {
  try {
    const { data, error } = await supabase
      .from('canonical_products')
      .select('service_page_url, product_title')
      .not('service_page_url', 'is', null);
    if (error) throw error;
    const productToSlug = buildProductToSlugMap(data || []);
    if (!productToSlug.size) return new Map();
    const txns = await fetchTxnsForProducts(supabase, [...productToSlug.keys()]);
    return rollupLifetimePerSlug(txns, productToSlug);
  } catch (err) {
    console.warn('[diagnosis] lifetime page revenue query failed (continuing):', err.message);
    return new Map();
  }
}

function buildProductToSlugMap(products) {
  const out = new Map();
  for (const p of products) {
    const slug = slugFromTargetUrl(p.service_page_url);
    if (!slug || !p.product_title) continue;
    out.set(p.product_title, slug);
  }
  return out;
}

async function fetchTxnsForProducts(supabase, productTitles) {
  if (!productTitles.length) return [];
  const pageSize = 1000;
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('booking_sheet_transactions')
      .select('canonical_product, amount, txn_date, is_jlr')
      .in('canonical_product', productTitles)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function rollupLifetimePerSlug(txns, productToSlug) {
  const out = new Map();
  for (const t of txns) {
    const slug = productToSlug.get(t.canonical_product);
    if (!slug) continue;
    let agg = out.get(slug);
    if (!agg) {
      agg = { lifetime_nonjlr: 0, lifetime_jlr: 0, lifetime_total: 0, first_txn_date: null, last_txn_date: null, txn_count: 0 };
      out.set(slug, agg);
    }
    const amt = Number(t.amount) || 0;
    agg.lifetime_total += amt;
    if (t.is_jlr) agg.lifetime_jlr += amt; else agg.lifetime_nonjlr += amt;
    agg.txn_count += 1;
    if (t.txn_date && (!agg.first_txn_date || t.txn_date < agg.first_txn_date)) agg.first_txn_date = t.txn_date;
    if (t.txn_date && (!agg.last_txn_date  || t.txn_date > agg.last_txn_date))  agg.last_txn_date  = t.txn_date;
  }
  for (const v of out.values()) {
    v.lifetime_nonjlr = round2(v.lifetime_nonjlr);
    v.lifetime_jlr    = round2(v.lifetime_jlr);
    v.lifetime_total  = round2(v.lifetime_total);
  }
  return out;
}

async function fetchActiveSuppression(supabase) {
  // Best-effort: if the table or columns change, return empty rather than
  // failing the whole endpoint. Aligns with the "fail-soft on suppression"
  // pattern in revenue-funnel-smart-priorities.js.
  try {
    const { data, error } = await supabase
      .from('optimisation_tasks')
      .select('target_url_clean, status, cycle_started_at, objective_title, objective_kpi')
      .in('status', ACTIVE_CYCLE_STATUSES);
    if (error) throw error;
    return buildSuppressionMap(data || []);
  } catch (err) {
    console.warn('[diagnosis] suppression query failed (continuing):', err.message);
    return { byUrl: new Map(), cyclesCount: 0, urlsCount: 0 };
  }
}

function buildSuppressionMap(rows) {
  const byUrl = new Map();
  for (const r of rows) {
    const slug = slugFromTargetUrl(r.target_url_clean);
    if (!slug) continue;
    if (!byUrl.has(slug)) byUrl.set(slug, []);
    byUrl.get(slug).push({
      status: r.status,
      cycle_started_at: r.cycle_started_at,
      objective_title: r.objective_title,
      objective_kpi: r.objective_kpi
    });
  }
  return { byUrl, cyclesCount: rows.length, urlsCount: byUrl.size };
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
// Per-page seasonality classification (Phase C / C2 product-level)
// ---------------------------------------------------------------------------

async function fetchPageSeasonality(supabase) {
  try {
    const { data, error } = await supabase
      .from('canonical_products')
      .select('service_page_url, seasonality_type, event_months')
      .not('service_page_url', 'is', null)
      .not('seasonality_type', 'is', null);
    if (error) throw error;
    return buildPageSeasonalityMap(data || []);
  } catch (err) {
    console.warn('[diagnosis] page seasonality query failed (defaulting all pages to season_bound):', err.message);
    return new Map();
  }
}

function buildPageSeasonalityMap(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const slug = slugFromTargetUrl(r.service_page_url);
    if (!slug) continue;
    let b = buckets.get(slug);
    if (!b) { b = newBucket(); buckets.set(slug, b); }
    tallyProduct(b, r);
  }
  const out = new Map();
  for (const [slug, b] of buckets) {
    const type = pageClassFromBucket(b);
    out.set(slug, {
      type,
      eventMonths: type === 'event_bound' ? [...b.ev].sort((a, c) => a - c) : null,
      counts: { yr: b.yr, sb: b.sb, eb: b.eb, none: b.n }
    });
  }
  return out;
}

function newBucket() {
  return { yr: 0, sb: 0, eb: 0, n: 0, ev: new Set() };
}

function tallyProduct(b, r) {
  if (r.seasonality_type === 'year_round') { b.yr += 1; return; }
  if (r.seasonality_type === 'season_bound') { b.sb += 1; return; }
  if (r.seasonality_type === 'none') { b.n += 1; return; }
  if (r.seasonality_type === 'event_bound') {
    b.eb += 1;
    addEventMonths(b.ev, r.event_months);
  }
}

function addEventMonths(set, raw) {
  if (!raw) return;
  for (const m of String(raw).split(',')) {
    const n = Number(m);
    if (Number.isInteger(n) && n >= 1 && n <= 12) set.add(n);
  }
}

function pageClassFromBucket(b) {
  if ((b.yr + b.sb) > 0) return 'season_bound';
  if (b.eb > 0) return 'event_bound';
  return 'none';
}

// ---------------------------------------------------------------------------
// Per-page aggregation
// ---------------------------------------------------------------------------

function aggregateByPage(rows, windowMonths, includeJlr) {
  const byPage = new Map();
  for (const r of rows) {
    if (!byPage.has(r.page_slug)) byPage.set(r.page_slug, []);
    byPage.get(r.page_slug).push(r);
  }
  return [...byPage.values()].map(pageRows => buildPageMetrics(pageRows, windowMonths, includeJlr));
}

function buildPageMetrics(pageRows, windowMonths, includeJlr) {
  const rows = pageRows.slice().sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const n = rows.length;
  const recentStart = Math.max(0, n - windowMonths);
  const priorStart = Math.max(0, n - 2 * windowMonths);
  const recent = rows.slice(recentStart, n);
  const prior = rows.slice(priorStart, recentStart);
  return {
    page_slug: rows[0]?.page_slug || '',
    policy_effective_date: policyEffectiveDateFromRows(rows),
    months_in_window: n,
    first_period: rows[0]?.period_start || null,
    last_period: rows[n - 1]?.period_start || null,
    recent_period_starts: recent.map(r => r.period_start),
    prior_period_starts: prior.map(r => r.period_start),
    full: summariseWindow(rows, includeJlr),
    recent: summariseWindow(recent, includeJlr),
    prior: summariseWindow(prior, includeJlr),
    first_month_position: firstMonthPositionWithImpressions(rows),
    last_month_position: lastMonthPositionWithImpressions(rows),
    monthly_rows: rows,
    monthly_series: buildMonthlySeries(rows, includeJlr),
    include_jlr: includeJlr === true
  };
}

function pickRevenueField(r, includeJlr) {
  return includeJlr ? (Number(r.revenue_gbp_total) || 0) : (Number(r.revenue_gbp_nonjlr) || 0);
}

function policyEffectiveDateFromRows(rows) {
  for (const r of rows) {
    if (r.policy_effective_date) return String(r.policy_effective_date).slice(0, 10);
  }
  return null;
}

function summariseWindow(rows, includeJlr) {
  let clicks = 0, imp = 0, rev = 0, monthsRev = 0, monthsGsc = 0, weightedPosSum = 0;
  for (const r of rows) {
    const c = Number(r.clicks) || 0;
    const i = Number(r.impressions) || 0;
    const p = Number(r.avg_position_imp_weighted) || 0;
    const v = pickRevenueField(r, includeJlr);
    clicks += c;
    imp += i;
    rev += v;
    if (v > 0) monthsRev += 1;
    if (i > 0) { monthsGsc += 1; weightedPosSum += p * i; }
  }
  return {
    clicks,
    impressions: imp,
    revenue_gbp_nonjlr: round2(rev),
    months_with_revenue: monthsRev,
    months_with_gsc_data: monthsGsc,
    ctr_pct: imp > 0 ? round3(100 * clicks / imp) : null,
    avg_position_imp_weighted: imp > 0 ? round2(weightedPosSum / imp) : null
  };
}

// Compact per-month series for the UI sparkline. Always includes both
// revenue slices so the front-end can toggle without re-fetching.
function buildMonthlySeries(rows, includeJlr) {
  return rows.map(r => ({
    period_start: r.period_start,
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    revenue_active: pickRevenueField(r, includeJlr),
    revenue_nonjlr: Number(r.revenue_gbp_nonjlr) || 0,
    revenue_total: Number(r.revenue_gbp_total) || 0
  }));
}

function firstMonthPositionWithImpressions(rows) {
  for (const r of rows) {
    if ((Number(r.impressions) || 0) > 0) {
      return { period_start: r.period_start, position: Number(r.avg_position_imp_weighted) || null };
    }
  }
  return null;
}

function lastMonthPositionWithImpressions(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if ((Number(r.impressions) || 0) > 0) {
      return { period_start: r.period_start, position: Number(r.avg_position_imp_weighted) || null };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Seasonality adjustment
// ---------------------------------------------------------------------------

function seasonalityTierKeyFor(pageSlug) {
  // Map slug -> seasonality tier key. Only four tiers have non-flat
  // seasonality (courses / workshops_nonres / workshops_residential /
  // academy); services / hire / prints return null (no adjustment).
  const s = String(pageSlug || '').toLowerCase();
  if (s.includes('residential')) return 'workshops_residential';
  if (s.includes('workshop')) return 'workshops_nonres';
  if (s.includes('course') || s.includes('class') || s.includes('lightroom')) return 'courses';
  if (s.includes('academy') || s.includes('free-online-photography-course')) return 'academy';
  return null;
}

function seasonallyAdjustImpressionDelta(metrics, ctx) {
  const observed = pctChange(metrics.recent.impressions, metrics.prior.impressions);
  const tierKey = seasonalityTierKeyFor(metrics.page_slug);
  if (observed == null) {
    return { observed: null, expected: null, adjusted: null, tier_key: tierKey, note: 'prior period had zero impressions; delta undefined' };
  }
  if (!tierKey) {
    return { observed: round1(observed), expected: 0, adjusted: round1(observed), tier_key: null, note: 'page tier has no seasonal adjustment (services / hire / prints / unidentified)' };
  }
  const recentFactor = avgSeasonalityFactor(ctx.seasonality.byTier, tierKey, metrics.recent_period_starts);
  const priorFactor = avgSeasonalityFactor(ctx.seasonality.byTier, tierKey, metrics.prior_period_starts);
  if (!priorFactor) {
    return { observed: round1(observed), expected: 0, adjusted: round1(observed), tier_key: tierKey, note: 'no prior-period seasonality factor available' };
  }
  const expectedPct = 100 * (recentFactor - priorFactor) / priorFactor;
  return {
    observed: round1(observed),
    expected: round1(expectedPct),
    adjusted: round1(observed - expectedPct),
    tier_key: tierKey,
    recent_factor_avg: round2(recentFactor),
    prior_factor_avg: round2(priorFactor)
  };
}

function avgSeasonalityFactor(byTier, tierKey, periodStarts) {
  if (!periodStarts.length) return null;
  let s = 0;
  for (const ps of periodStarts) {
    const monthIdx = monthIdxFromPeriodStart(ps);
    s += factorFromBlend(byTier, tierKey, monthIdx);
  }
  return s / periodStarts.length;
}

function monthIdxFromPeriodStart(ps) {
  const d = new Date(ps);
  return Number.isFinite(d.getTime()) ? d.getUTCMonth() : 0;
}

// Event-bound delta: compare ONLY the months in event_months for the most
// recent calendar year present in the data vs the same months in the prior
// calendar year. No tier-level seasonality factor is applied.
function eventBoundImpressionDelta(page, eventMonths) {
  if (!eventMonths?.length) {
    return insufficientHistorySignal('event_bound page has no event_months defined');
  }
  const rows = page.monthly_rows || [];
  if (!rows.length) {
    return insufficientHistorySignal('no GSC monthly rows available for same-month comparison');
  }
  const months = new Set(eventMonths);
  const impByYear = sumImpressionsByYearInMonths(rows, months);
  const years = [...impByYear.keys()].sort((a, b) => a - b);
  if (years.length < 2) {
    return insufficientHistorySignal(`only ${years.length} calendar year(s) of data for months [${eventMonths.join(',')}]; need >=2 for same-month YoY comparison`);
  }
  const recentYear = years.at(-1);
  const priorYear = years.at(-2);
  const recentImp = impByYear.get(recentYear) || 0;
  const priorImp = impByYear.get(priorYear) || 0;
  if (priorImp === 0) {
    return insufficientHistorySignal(`prior year ${priorYear} had zero impressions in months [${eventMonths.join(',')}]; delta undefined`);
  }
  const observed = round1(100 * (recentImp - priorImp) / priorImp);
  return {
    observed,
    expected: 0,
    adjusted: observed,
    mode: 'event_bound_same_months_yoy',
    event_months: eventMonths,
    recent_year: recentYear,
    prior_year: priorYear,
    recent_impressions: recentImp,
    prior_impressions: priorImp,
    tier_key: null,
    note: `same-month YoY: ${recentYear} vs ${priorYear} for months [${eventMonths.join(',')}]`
  };
}

function sumImpressionsByYearInMonths(rows, monthsSet) {
  const byYear = new Map();
  for (const r of rows) {
    const d = new Date(r.period_start);
    if (!Number.isFinite(d.getTime())) continue;
    const m = d.getUTCMonth() + 1;
    if (!monthsSet.has(m)) continue;
    const y = d.getUTCFullYear();
    byYear.set(y, (byYear.get(y) || 0) + (Number(r.impressions) || 0));
  }
  return byYear;
}

function insufficientHistorySignal(note) {
  return {
    observed: null,
    expected: null,
    adjusted: null,
    mode: 'event_bound_same_months_yoy',
    tier_key: null,
    insufficient_history: true,
    note
  };
}

function emptySeasonalImp(mode, note) {
  return { observed: null, expected: null, adjusted: null, mode, tier_key: null, note };
}

// ---------------------------------------------------------------------------
// Classifier (cyclomatic complexity intentionally low; rules are individual
// predicates that the orchestrator chains)
// ---------------------------------------------------------------------------

function classifyPage(page, ctx) {
  const pageClass = ctx.pageSeasonality.get(page.page_slug) || defaultPageClass();
  if (pageClass.type === 'none') {
    return buildVerdict('skipped_none', enrichForVerdict(page, pageClass, emptySeasonalImp('skipped_none', "page's products are all classified as 'none' (voucher / redemption / royalty); not a user-facing surface"), null, ctx));
  }
  const seasonalImp = computeImpressionDelta(page, pageClass, ctx);
  const positionDelta = computePositionDelta(page);
  const computed = enrichForVerdict(page, pageClass, seasonalImp, positionDelta, ctx);
  return runClassifiers(computed, ctx);
}

function defaultPageClass() {
  return { type: PAGE_CLASS_DEFAULT, eventMonths: null, counts: null, default_applied: true };
}

function computeImpressionDelta(page, pageClass, ctx) {
  if (pageClass.type === 'event_bound') return eventBoundImpressionDelta(page, pageClass.eventMonths);
  return seasonallyAdjustImpressionDelta(page, ctx);
}

function enrichForVerdict(page, pageClass, seasonalImp, positionDelta, ctx) {
  const supp = ctx?.suppression ? (ctx.suppression.byUrl.get(page.page_slug) || null) : null;
  const lifetime = ctx?.lifetimeRevenue ? (ctx.lifetimeRevenue.get(page.page_slug) || null) : null;
  return {
    ...page,
    seasonalImp: seasonalImp || emptySeasonalImp('skipped', 'no seasonal delta computed'),
    positionDelta: positionDelta || { positions: null, recent: null, prior: null },
    suppression_cycles: supp,
    page_class: pageClass,
    lifetime
  };
}

function runClassifiers(computed, ctx) {
  if (isInsufficientData(computed, ctx)) return buildVerdict('insufficient_data', computed);
  if (isZeroConversion(computed)) return buildVerdict('traffic_with_zero_conversion', computed);
  if (isFunnelBypass(computed)) return buildVerdict('funnel_bypass_revenue_with_minimal_organic', computed);
  if (computed.seasonalImp?.insufficient_history) return buildVerdict('insufficient_history', computed);
  const vl = classifyVisibilityLoss(computed);
  if (vl) {
    const guard = applyPageVisibilityLossPolicyGuard(computed, vl);
    if (guard.state) return buildVerdict(guard.state, computed, guard.policy_suppression_reason);
    if (isTrafficRich(computed)) return buildVerdict('traffic_rich_modest_conversion', computed, guard.policy_suppression_reason);
    return buildVerdict('matched_healthy', computed, guard.policy_suppression_reason);
  }
  if (isTrafficRich(computed)) return buildVerdict('traffic_rich_modest_conversion', computed);
  return buildVerdict('matched_healthy', computed);
}

function isInsufficientData(c, ctx) {
  if ((c.full.impressions || 0) < ctx.opts.minImpressions) return true;
  if ((c.full.months_with_gsc_data || 0) < 6) return true;
  return false;
}

function isZeroConversion(c) {
  return (c.full.clicks || 0) >= THRESHOLDS.zero_conv_min_clicks
      && (c.full.revenue_gbp_nonjlr || 0) === 0;
}

function isFunnelBypass(c) {
  const rev = c.full.revenue_gbp_nonjlr || 0;
  if (rev < THRESHOLDS.funnel_bypass_min_revenue_gbp) return false;
  const clicksPerPound = (c.full.clicks || 0) / Math.max(1, rev);
  return clicksPerPound < THRESHOLDS.funnel_bypass_max_clicks_per_pound;
}

function classifyVisibilityLoss(c) {
  const adj = c.seasonalImp.adjusted;
  if (adj == null || adj > THRESHOLDS.visibility_loss_imp_delta_pct) return null;
  if ((c.positionDelta.positions || 0) < THRESHOLDS.visibility_loss_min_pos_drop) return null;
  const ctrBaseline = c.full.ctr_pct || 0;
  if (ctrBaseline < THRESHOLDS.low_ctr_baseline_pct) return 'visibility_loss_with_low_ctr_baseline';
  return 'visibility_loss_normal_ctr';
}

function isTrafficRich(c) {
  const clicks = c.full.clicks || 0;
  const rev = c.full.revenue_gbp_nonjlr || 0;
  if (clicks < THRESHOLDS.traffic_rich_min_clicks) return false;
  if (rev < THRESHOLDS.traffic_rich_min_revenue_gbp) return false;
  if (rev > THRESHOLDS.traffic_rich_max_revenue_gbp) return false;
  return true;
}

function computePositionDelta(page) {
  const r = page.recent.avg_position_imp_weighted;
  const p = page.prior.avg_position_imp_weighted;
  if (r == null || p == null) {
    return { positions: null, recent: r, prior: p };
  }
  return { positions: round2(r - p), recent: round2(r), prior: round2(p) };
}

// ---------------------------------------------------------------------------
// Verdict builder
// ---------------------------------------------------------------------------

function buildVerdict(state, c, policySuppressionReason = null) {
  return {
    page_slug: c.page_slug,
    state,
    rank_score: RANK_SCORES[state] ?? 0,
    policy_suppression_reason: policySuppressionReason,
    page_seasonality: buildPageSeasonalityBlock(c.page_class),
    seasonality_tier_key: c.seasonalImp?.tier_key ?? null,
    suppression: c.suppression_cycles
      ? { active_cycles: c.suppression_cycles, note: 'page is under active rewrite/monitoring; treat verdict as informational' }
      : null,
    metrics: {
      full_window: c.full,
      recent_window: c.recent,
      prior_window: c.prior,
      first_month_position: c.first_month_position,
      last_month_position: c.last_month_position,
      first_period: c.first_period,
      last_period: c.last_period,
      recent_period_starts: c.recent_period_starts,
      prior_period_starts: c.prior_period_starts,
      monthly_row_count: (c.monthly_rows || []).length,
      monthly_series: c.monthly_series || [],
      gsc_overlay_window: buildGscOverlayWindow(c),
      lifetime: buildLifetimeBlock(c)
    },
    deltas: {
      impressions: c.seasonalImp,
      clicks_pct: pctChange(c.recent.clicks, c.prior.clicks),
      revenue_pct: pctChange(c.recent.revenue_gbp_nonjlr, c.prior.revenue_gbp_nonjlr),
      position: c.positionDelta
    },
    rules_evaluated: rulesEvaluatedFor(state, c),
    verdict_text: verdictText(state, c)
  };
}

function buildPageSeasonalityBlock(pageClass) {
  if (!pageClass) return null;
  const counts = pageClass.counts;
  const eb = counts ? (counts.eb || 0) : 0;
  const yrsb = counts ? ((counts.yr || 0) + (counts.sb || 0)) : 0;
  return {
    type: pageClass.type,
    event_months: pageClass.eventMonths || null,
    product_counts: counts || null,
    default_applied: pageClass.default_applied === true,
    // REQ-2 trigger: page mixes event_bound with year_round/season_bound
    // products. When true the UI should offer the per-product drilldown,
    // because the page-level verdict masks per-product seasonality reality.
    is_mixed_seasonality: eb > 0 && yrsb > 0
  };
}

function buildGscOverlayWindow(c) {
  return {
    first_period: c.first_period,
    last_period: c.last_period,
    months_covered: (c.monthly_rows || []).length,
    label: c.first_period && c.last_period
      ? `${c.first_period} to ${c.last_period} (${(c.monthly_rows || []).length} months)`
      : 'no GSC overlay'
  };
}

function buildLifetimeBlock(c) {
  if (!c.lifetime) {
    return { available: false, note: 'no canonical_products mapping found for this page' };
  }
  const lt = c.lifetime;
  const firstTxn = lt.first_txn_date;
  const firstPeriod = c.first_period;
  const extendsBefore = !!(firstTxn && firstPeriod && firstTxn < firstPeriod);
  return {
    available: true,
    lifetime_nonjlr: lt.lifetime_nonjlr,
    lifetime_jlr: lt.lifetime_jlr,
    lifetime_total: lt.lifetime_total,
    first_txn_date: firstTxn,
    last_txn_date: lt.last_txn_date,
    txn_count: lt.txn_count,
    // REQ-1 trigger: revenue history extends before GSC overlay window.
    // The UI should display a warning so the user knows the GSC correlation
    // is bounded by GSC retention (~16 months).
    extends_before_gsc_window: extendsBefore,
    pre_window_warning_text: extendsBefore
      ? `Revenue history starts ${firstTxn}, before the GSC overlay window opens at ${firstPeriod}. GSC cannot correlate pre-${firstPeriod} bookings on this page.`
      : null
  };
}

function rulesEvaluatedFor(state, c) {
  const cls = c.page_class || { type: 'unknown' };
  const clsEv = cls.eventMonths?.length ? `, event_months=[${cls.eventMonths.join(',')}]` : '';
  const clsDef = cls.default_applied ? ' (default; no canonical_products entries for this slug)' : '';
  return [
    {
      rule: 'page_seasonality_class',
      threshold: 'per-product: ANY yr|sb -> season_bound (tier-level factor); all event_bound -> event_bound (same-month YoY); all none -> skipped_none',
      observed: `page_class=${cls.type}${clsEv}${clsDef}`,
      fired: true
    },
    {
      rule: 'is_skipped_none',
      threshold: 'page_class == none',
      observed: `page_class=${cls.type}`,
      fired: state === 'skipped_none'
    },
    {
      rule: 'is_insufficient_history',
      threshold: 'page_class == event_bound AND <2 calendar years of GSC data for the event_months window',
      observed: c.seasonalImp?.insufficient_history ? `insufficient_history=true (${c.seasonalImp.note})` : 'sufficient history or non event_bound',
      fired: state === 'insufficient_history'
    },
    {
      rule: 'is_insufficient_data',
      threshold: `full_window.impressions >= ${THRESHOLDS.zero_conv_min_clicks} AND full_window.months_with_gsc_data >= 6`,
      observed: `impressions=${c.full.impressions}, months_with_gsc_data=${c.full.months_with_gsc_data}`,
      fired: state === 'insufficient_data'
    },
    {
      rule: 'is_traffic_with_zero_conversion',
      threshold: `full_window.clicks >= ${THRESHOLDS.zero_conv_min_clicks} AND full_window.revenue == 0`,
      observed: `clicks=${c.full.clicks}, revenue=£${c.full.revenue_gbp_nonjlr}`,
      fired: state === 'traffic_with_zero_conversion'
    },
    {
      rule: 'is_funnel_bypass',
      threshold: `full_window.revenue >= £${THRESHOLDS.funnel_bypass_min_revenue_gbp} AND clicks_per_pound < ${THRESHOLDS.funnel_bypass_max_clicks_per_pound}`,
      observed: `revenue=£${c.full.revenue_gbp_nonjlr}, clicks_per_pound=${((c.full.clicks || 0) / Math.max(1, c.full.revenue_gbp_nonjlr || 0)).toFixed(4)}`,
      fired: state === 'funnel_bypass_revenue_with_minimal_organic'
    },
    {
      rule: 'is_visibility_loss',
      threshold: `seasonally-adjusted impressions delta <= ${THRESHOLDS.visibility_loss_imp_delta_pct}% AND position deteriorates by >= ${THRESHOLDS.visibility_loss_min_pos_drop} positions`,
      observed: `imp_delta_adjusted=${c.seasonalImp.adjusted ?? 'null'}%, position_delta=${c.positionDelta.positions ?? 'null'}`,
      fired: state === 'visibility_loss_with_low_ctr_baseline' || state === 'visibility_loss_normal_ctr'
    },
    {
      rule: 'is_low_ctr_baseline',
      threshold: `full_window CTR < ${THRESHOLDS.low_ctr_baseline_pct}%`,
      observed: `ctr_baseline=${c.full.ctr_pct ?? 'null'}%`,
      fired: state === 'visibility_loss_with_low_ctr_baseline'
    },
    {
      rule: 'is_traffic_rich_modest_conversion',
      threshold: `full_window.clicks >= ${THRESHOLDS.traffic_rich_min_clicks} AND £${THRESHOLDS.traffic_rich_min_revenue_gbp} <= revenue <= £${THRESHOLDS.traffic_rich_max_revenue_gbp}`,
      observed: `clicks=${c.full.clicks}, revenue=£${c.full.revenue_gbp_nonjlr}`,
      fired: state === 'traffic_rich_modest_conversion'
    }
  ];
}

function verdictText(state, c) {
  if (state === 'skipped_none') {
    return `Skipped: all products mapped to this URL are classified as 'none' (voucher / redemption / royalty plumbing). Not a user-facing surface to diagnose.`;
  }
  if (state === 'insufficient_history') {
    return `Event-bound page: ${c.seasonalImp?.note || 'insufficient same-month history'}. Visibility-loss and narrowing-query-footprint rules skipped (cannot reliably distinguish off-season silence from decline); zero-conversion and funnel-bypass rules still apply and did not fire.`;
  }
  if (state === 'insufficient_data') {
    return `Insufficient signal: ${c.full.impressions} impressions across ${c.full.months_with_gsc_data} months in the full window does not meet the minimum bar for classification.`;
  }
  if (state === 'traffic_with_zero_conversion') {
    return verdictZeroConv(c);
  }
  if (state === 'funnel_bypass_revenue_with_minimal_organic') {
    return verdictFunnelBypass(c);
  }
  if (state === 'visibility_loss_with_low_ctr_baseline') {
    return verdictVisLossLowCtr(c);
  }
  if (state === 'visibility_loss_normal_ctr') {
    return verdictVisLossNormalCtr(c);
  }
  if (state === 'traffic_rich_modest_conversion') {
    return verdictTrafficRich(c);
  }
  return verdictHealthy(c);
}

function verdictZeroConv(c) {
  return `Received ${fmt(c.full.clicks)} clicks and ${fmt(c.full.impressions)} impressions across ${c.full.months_with_gsc_data} months but never booked any revenue mapped to this URL; the page draws search traffic but does not appear to be in the conversion funnel for any product.`;
}

function verdictFunnelBypass(c) {
  const perClick = Math.round(c.full.revenue_gbp_nonjlr / Math.max(1, c.full.clicks));
  return `Booked £${fmt(c.full.revenue_gbp_nonjlr)} across the window while GSC contributed only ${fmt(c.full.clicks)} clicks (≈ £${fmt(perClick)} of booked revenue per organic click); the revenue:click ratio is too high for an organic-led funnel and most bookings reach this page via non-GSC routes.`;
}

function verdictVisLossLowCtr(c) {
  const adj = Math.abs(c.seasonalImp.adjusted);
  const recentPos = c.last_month_position?.position;
  const earlyPos = c.first_month_position?.position;
  return `Impressions fell ${adj.toFixed(0)}% comparing the recent vs prior half-window (seasonally adjusted) while average position deteriorated from #${fmtPos(earlyPos)} (${c.first_month_position?.period_start || '?'}) to #${fmtPos(recentPos)} (${c.last_month_position?.period_start || '?'}); lifetime CTR of ${c.full.ctr_pct?.toFixed(2) ?? '?'}% was already below ${THRESHOLDS.low_ctr_baseline_pct}% before the impression decline, so even at the pre-decline impression level the page converted few visitors.`;
}

function verdictVisLossNormalCtr(c) {
  const adj = Math.abs(c.seasonalImp.adjusted);
  return `Impressions fell ${adj.toFixed(0)}% comparing the recent vs prior half-window (seasonally adjusted) while average position deteriorated by ${c.positionDelta.positions?.toFixed(1)} positions; lifetime CTR of ${c.full.ctr_pct?.toFixed(2) ?? '?'}% suggests restoring impressions would correlate with restored conversions.`;
}

function verdictTrafficRich(c) {
  const perClick = (c.full.revenue_gbp_nonjlr / Math.max(1, c.full.clicks)).toFixed(2);
  return `Received ${fmt(c.full.clicks)} clicks and ${fmt(c.full.impressions)} impressions while booking £${fmt(c.full.revenue_gbp_nonjlr)} across ${c.full.months_with_revenue} months (≈ £${perClick} of booked revenue per organic click); within the expected band for a money-page at this AOV and conversion rate.`;
}

function verdictHealthy(c) {
  return `Page is in a steady-state band: ${fmt(c.full.clicks)} clicks, ${fmt(c.full.impressions)} impressions, £${fmt(c.full.revenue_gbp_nonjlr)} booked across ${c.full.months_with_revenue} months. No diagnostic rule fired.`;
}

// ---------------------------------------------------------------------------
// Tier resolution + rollup (Phase C / C2 part 3 restructure)
// ---------------------------------------------------------------------------

// canonical_products -> { slug -> tier_key } map. Pages with multiple
// products spanning multiple tiers resolve to the tier holding the MOST
// products on that page (deterministic; ties break by TIER_ORDER index).
async function fetchProductTierMap(supabase) {
  const empty = { bySlug: new Map(), unmappedCategories: [] };
  try {
    const { data, error } = await supabase
      .from('canonical_products')
      .select('service_page_url, category')
      .not('service_page_url', 'is', null)
      .not('category', 'is', null);
    if (error) throw error;
    return buildProductTierMap(data || []);
  } catch (err) {
    console.warn('[diagnosis] product tier map failed (continuing without):', err.message);
    return empty;
  }
}

function buildProductTierMap(rows) {
  const tiersBySlug = new Map();
  const unmapped = new Map();
  for (const r of rows) {
    const slug = slugFromTargetUrl(r.service_page_url);
    if (!slug) continue;
    const tier = tierFromProductCategory(r.category);
    if (tier === '__excluded__') continue;
    if (!tier) {
      const k = String(r.category || '').trim();
      unmapped.set(k, (unmapped.get(k) || 0) + 1);
      continue;
    }
    if (!tiersBySlug.has(slug)) tiersBySlug.set(slug, new Map());
    const m = tiersBySlug.get(slug);
    m.set(tier, (m.get(tier) || 0) + 1);
  }
  const bySlug = new Map();
  for (const [slug, m] of tiersBySlug) bySlug.set(slug, pickTopTier(m));
  return {
    bySlug,
    unmappedCategories: [...unmapped.entries()].map(([category, product_count]) => ({ category, product_count }))
  };
}

function pickTopTier(countsByTier) {
  let bestKey = null;
  let bestCount = -1;
  let bestOrder = 999;
  for (const [tier, count] of countsByTier) {
    const order = TIER_ORDER.indexOf(tier);
    const beats = count > bestCount || (count === bestCount && order < bestOrder);
    if (beats) { bestKey = tier; bestCount = count; bestOrder = order; }
  }
  return bestKey;
}

async function fetchBookingRevenueByTier(supabase, propertyUrl) {
  const empty = { byTier: new Map(), unmapped: [] };
  try {
    const { data, error } = await supabase
      .from('booking_sheet_transactions')
      .select('category_label, year, amount, is_jlr')
      .eq('property_url', propertyUrl);
    if (error) throw error;
    return aggregateBookingRevenue(data || []);
  } catch (err) {
    console.warn('[diagnosis] booking revenue rollup failed (continuing):', err.message);
    return empty;
  }
}

function aggregateBookingRevenue(rows) {
  const byTier = new Map();
  const unmapped = new Map();
  for (const r of rows) {
    const tier = tierFromBookingCategory(r.category_label);
    if (!tier) {
      const k = String(r.category_label || '').trim();
      if (k) unmapped.set(k, (unmapped.get(k) || 0) + 1);
      continue;
    }
    addBookingRow(byTier, tier, r);
  }
  return {
    byTier,
    unmapped: [...unmapped.entries()].map(([category_label, txn_count]) => ({ category_label, txn_count }))
  };
}

function addBookingRow(byTier, tier, r) {
  if (!byTier.has(tier)) byTier.set(tier, new Map());
  const yearMap = byTier.get(tier);
  const y = Number(r.year);
  if (!Number.isFinite(y)) return;
  if (!yearMap.has(y)) yearMap.set(y, { non_jlr: 0, jlr: 0, total: 0, txns: 0 });
  const cell = yearMap.get(y);
  const amt = Number(r.amount) || 0;
  cell.total += amt;
  if (r.is_jlr) cell.jlr += amt; else cell.non_jlr += amt;
  cell.txns += 1;
}

async function loadPageTierLookup() {
  try {
    const entries = await fetchTierSegmentationEntries({ cacheTtlMs: 5 * 60 * 1000 });
    return buildTierLookupFromEntries(entries);
  } catch (err) {
    console.warn('[diagnosis] page-tier CSV load failed; falling back to URL heuristic only:', err.message);
    return null;
  }
}

function pageTierForSlug(slug, lookup) {
  const url = `${SITE_ORIGIN}/${String(slug || '').replace(/^\//, '')}`;
  return getTierForUrlFromLookup(url, lookup);
}

function assignTiersToDiagnostics(diagnostics, productTierMap, pageTierLookup) {
  for (const d of diagnostics) {
    const pageTier = pageTierForSlug(d.page_slug, pageTierLookup);
    const revTier = isAcademyCommercialSlug(d.page_slug)
      ? 'academy'
      : (productTierMap.bySlug.get(d.page_slug) || null);
    d.page_tier = pageTier;
    d.tier_key = revTier;
  }
}

function applyTierFilters(diagnostics, opts) {
  // If the caller explicitly requested specific page slugs (?pages=), do
  // not apply the default page-type filter -- they're asking for those
  // pages specifically (canary verification, drilldown, etc.).
  if (opts.pages?.length) return diagnostics;
  return diagnostics.filter(d =>
    shouldKeepByPageTier(d.page_tier, opts.includeEvent, d.page_slug));
}

function buildTierFilterMeta(allDiagnostics, filteredDiagnostics, opts) {
  const before = pageTierCounts(allDiagnostics);
  const after = pageTierCounts(filteredDiagnostics);
  return {
    page_type_filter_applied: !opts.pages?.length,
    include_event_pages: opts.includeEvent === true,
    counts_before_filter: before,
    counts_after_filter: after,
    excluded_states_default: [...HIDDEN_STATES_DEFAULT]
  };
}

function pageTierCounts(diagnostics) {
  const c = { landing: 0, product: 0, event: 0, blog: 0, academy: 0, unmapped: 0 };
  for (const d of diagnostics) {
    const t = String(d.page_tier || 'unmapped');
    c[t] = (c[t] || 0) + 1;
  }
  return c;
}

function computeGscWindow(rows) {
  if (!rows?.length) return { first_period: null, last_period: null, gsc_first_day: GSC_FIRST_DAY, note: 'no rows' };
  let lo = rows[0].period_start;
  let hi = rows[0].period_start;
  for (const r of rows) {
    if (r.period_start < lo) lo = r.period_start;
    if (r.period_start > hi) hi = r.period_start;
  }
  return { first_period: lo, last_period: hi, gsc_first_day: GSC_FIRST_DAY };
}

// ---------------------------------------------------------------------------
// Tier rollup (10 sellable tiers) + booking-sheet reconciliation
// ---------------------------------------------------------------------------

const RESIDENTIAL_SATELLITE_SLUG_RE =
  /(?:lake-district|devon|hartland|norfolk|snowdonia|gower|anglesey|yorkshire|northumberland|exmoor|dorset|suffolk|somerset|glencoe|kerry|dartmoor|wales|residential)/i;

function buildTierReconciliation(tierRollup, bookingRevenue) {
  const perTier = {};
  const sums = sumBookingNonJlrByYear(bookingRevenue?.byTier);
  for (const key of TIER_ORDER) {
    const def = TIER_DEFINITIONS[key];
    const yearMap = bookingRevenue?.byTier?.get(key);
    perTier[key] = {
      label: def.label,
      y2024: pickYear(yearMap, 2024).non_jlr,
      y2025: pickYear(yearMap, 2025).non_jlr,
      y2026_ytd: pickYear(yearMap, 2026).non_jlr
    };
  }
  const delta = {
    y2024: round2(sums.y2024 - BOOKING_SHEET_NON_JLR_TARGETS.y2024),
    y2025: round2(sums.y2025 - BOOKING_SHEET_NON_JLR_TARGETS.y2025),
    y2026_ytd: round2(sums.y2026_ytd - BOOKING_SHEET_NON_JLR_TARGETS.y2026_ytd)
  };
  const stated = { y2024: 42791, y2025: 27027, y2026_ytd: 19233 };
  const deltaStated = {
    y2024: round2(sums.y2024 - stated.y2024),
    y2025: round2(sums.y2025 - stated.y2025),
    y2026_ytd: round2(sums.y2026_ytd - stated.y2026_ytd)
  };
  return {
    targets_non_jlr: BOOKING_SHEET_NON_JLR_TARGETS,
    stated_targets_rounded_gbp: stated,
    tier_sum_non_jlr: sums,
    delta_vs_targets: delta,
    delta_vs_stated_rounded: deltaStated,
    passes: pennyMatch(sums.y2024, BOOKING_SHEET_NON_JLR_TARGETS.y2024)
      && pennyMatch(sums.y2025, BOOKING_SHEET_NON_JLR_TARGETS.y2025)
      && pennyMatch(sums.y2026_ytd, BOOKING_SHEET_NON_JLR_TARGETS.y2026_ytd),
    passes_stated_rounded: Math.round(sums.y2024) === stated.y2024
      && Math.round(sums.y2025) === stated.y2025
      && Math.round(sums.y2026_ytd) === stated.y2026_ytd,
    per_tier: perTier,
    unmapped_booking_categories: bookingRevenue?.unmapped || [],
    note: 'Tier revenue is net of paired voucher Out lines (Pick n Mix, Gift Vouchers). '
      + '12. Other rolls into Commissions. Sum equals all non-JLR booking_sheet_transactions.'
  };
}

function pennyMatch(actual, expected) {
  return Math.abs(round2(actual) - round2(expected)) < 0.01;
}

function sumBookingNonJlrByYear(byTier) {
  const sums = { y2024: 0, y2025: 0, y2026_ytd: 0 };
  if (!byTier) return sums;
  for (const yearMap of byTier.values()) {
    for (const [y, cell] of yearMap) {
      if (y === 2024) sums.y2024 += cell.non_jlr || 0;
      else if (y === 2025) sums.y2025 += cell.non_jlr || 0;
      else if (y === 2026) sums.y2026_ytd += cell.non_jlr || 0;
    }
  }
  sums.y2024 = round2(sums.y2024);
  sums.y2025 = round2(sums.y2025);
  sums.y2026_ytd = round2(sums.y2026_ytd);
  return sums;
}

function buildWorkshopsResidentialAttribution(allDiagnostics, includeEvent) {
  const hubSlug = 'photography-workshops';
  const hub = allDiagnostics.find(d => normalizePageSlug(d.page_slug) === hubSlug) || null;
  const satellites = (allDiagnostics || []).filter(d => {
    const slug = normalizePageSlug(d.page_slug);
    if (slug === hubSlug) return false;
    if (!RESIDENTIAL_SATELLITE_SLUG_RE.test(slug)) return false;
    return d.page_tier === 'event' || d.page_tier === 'product' || d.page_tier === 'landing';
  });
  const inDefaultView = satellites.filter(d =>
    shouldKeepByPageTier(d.page_tier, includeEvent, d.page_slug));
  return {
    model: 'hub_page',
    explanation: 'All 18 canonical_products with category workshop (residential) use '
      + 'service_page_url = /photography-workshops. Location-specific URLs '
      + '(Lake District, Devon, etc.) are separate SEO/event instances; they do not '
      + 'carry residential product rows in canonical_products.',
    hub_page: hub
      ? { page_slug: hub.page_slug, page_tier: hub.page_tier, tier_key: hub.tier_key, state: hub.state }
      : null,
    default_view_pages: [hubSlug],
    event_toggle_required_for_satellites: false,
    satellite_note: 'Most location URLs are Tier A landing pages (visible in default view) '
      + 'but tier_key stays null because canonical_products only links residential '
      + 'bookings to /photography-workshops. Tier C event URLs under '
      + 'photographic-workshops-near-me/* need the event toggle.',
    satellite_pages: satellites.map(d => ({
      page_slug: d.page_slug,
      page_tier: d.page_tier,
      tier_key: d.tier_key,
      state: d.state,
      in_default_view: shouldKeepByPageTier(d.page_tier, includeEvent, d.page_slug),
      reason_not_in_residential_tier: d.tier_key
        ? 'product-tier map assigns a different revenue tier'
        : (d.page_tier === 'event'
          ? 'Tier C event page (excluded unless Include event toggle is on)'
          : 'no canonical_products row points at this slug with workshop (residential)')
    })),
    satellite_count: satellites.length,
    satellite_in_default_view_count: inDefaultView.length
  };
}

function buildTierRollup({ diagnostics, bookingRevenue, gscWindow, includeJlr, gscRoleLookup, gscBySlug }) {
  return TIER_ORDER.map(tierKey => buildTierRow({
    tierKey,
    diagnostics,
    bookingRevenue,
    gscWindow,
    includeJlr,
    gscRoleLookup,
    gscBySlug
  }));
}

function buildTierRow({ tierKey, diagnostics, bookingRevenue, gscWindow, includeJlr, gscRoleLookup, gscBySlug }) {
  const def = TIER_DEFINITIONS[tierKey];
  const pagesInTier = diagnostics.filter(d => d.tier_key === tierKey);
  const roleStream = gscRoleLookup?.streams?.find(s => s.tier_key === tierKey) || null;
  return {
    tier_key: tierKey,
    label: def.label,
    booking_category: def.bookingCategory,
    revenue_trend: tierRevenueTrend(bookingRevenue.byTier.get(tierKey)),
    gsc_trend: tierGscTrend(pagesInTier, gscWindow),
    hub_gsc_trend: buildRoleGscOverlay('nav_hub', roleStream?.nav_hub_slugs || [], gscBySlug, gscWindow),
    product_gsc_trend: buildRoleGscOverlay('product', roleStream?.product_slugs || [], gscBySlug, gscWindow),
    page_state_counts: tierPageStateCounts(pagesInTier),
    severity: tierSeverity(pagesInTier),
    page_count: pagesInTier.length,
    pages_at_risk_gbp: tierAtRiskRevenue(pagesInTier),
    revenue_basis: includeJlr ? 'JLR-inclusive' : 'JLR-excluded',
    page_slugs: pagesInTier.map(d => d.page_slug),
    gsc_honesty_note: 'GSC overlay covers Jan 2025 onward; revenue trend before that has no GSC correlation.'
  };
}

function tierRevenueTrend(yearMap) {
  const empty = { y2024: zeroRev(), y2025: zeroRev(), y2026_ytd: zeroRev() };
  if (!yearMap) return empty;
  return {
    y2024:     pickYear(yearMap, 2024),
    y2025:     pickYear(yearMap, 2025),
    y2026_ytd: pickYear(yearMap, 2026)
  };
}

function pickYear(yearMap, y) {
  const c = yearMap.get(y);
  if (!c) return zeroRev();
  return { non_jlr: round2(c.non_jlr), jlr: round2(c.jlr), total: round2(c.total), txn_count: c.txns };
}

function zeroRev() { return { non_jlr: 0, jlr: 0, total: 0, txn_count: 0 }; }

function tierGscTrend(pages, gscWindow) {
  if (!pages.length || !gscWindow.first_period) {
    return { first_3mo: emptyGsc(), last_3mo: emptyGsc(), pct_change_impressions: null, pct_change_clicks: null };
  }
  const firstCutoff = addMonthsIso(gscWindow.first_period, TIER_GSC_TREND_WINDOW_MONTHS);
  const lastCutoff = subMonthsIso(gscWindow.last_period, TIER_GSC_TREND_WINDOW_MONTHS - 1);
  const first = aggregateMonthlySeries(pages, ps => ps < firstCutoff);
  const last  = aggregateMonthlySeries(pages, ps => ps >= lastCutoff);
  return {
    first_3mo: first,
    last_3mo: last,
    first_window_label: `${gscWindow.first_period} -> ${addMonthsIso(gscWindow.first_period, TIER_GSC_TREND_WINDOW_MONTHS - 1)}`,
    last_window_label:  `${lastCutoff} -> ${gscWindow.last_period}`,
    pct_change_impressions: pctChange(last.impressions, first.impressions),
    pct_change_clicks:      pctChange(last.clicks,      first.clicks)
  };
}

function emptyGsc() { return { impressions: 0, clicks: 0 }; }

function aggregateMonthlySeries(pages, periodPredicate) {
  let imp = 0, clicks = 0;
  for (const p of pages) {
    for (const m of (p.metrics?.monthly_series || [])) {
      if (!periodPredicate(m.period_start)) continue;
      imp += Number(m.impressions) || 0;
      clicks += Number(m.clicks) || 0;
    }
  }
  return { impressions: imp, clicks };
}

function addMonthsIso(iso, n) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function subMonthsIso(iso, n) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function tierPageStateCounts(pages) {
  const out = {};
  for (const p of pages) out[p.state] = (out[p.state] || 0) + 1;
  return out;
}

const TIER_STATE_SEVERITY = {
  traffic_with_zero_conversion: 'critical',
  visibility_loss_with_low_ctr_baseline: 'critical',
  visibility_loss_normal_ctr: 'high',
  funnel_bypass_revenue_with_minimal_organic: 'medium',
  traffic_rich_modest_conversion: 'low',
  matched_healthy: 'healthy',
  insufficient_history: 'info',
  insufficient_data: 'info',
  skipped_none: 'info'
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4, info: 5, unknown: 6 };

function tierSeverity(pages) {
  if (!pages.length) return 'info';
  let best = 'unknown';
  for (const p of pages) {
    const s = TIER_STATE_SEVERITY[p.state] || 'info';
    if (SEVERITY_ORDER[s] < SEVERITY_ORDER[best]) best = s;
  }
  return best === 'unknown' ? 'info' : best;
}

// £ at risk = sum of full-window booked revenue across pages whose state
// indicates broken conversion (zero-conv / visibility loss / funnel bypass).
// Note: metrics.full_window.revenue_gbp_nonjlr stores the JLR-AWARE total
// (includeJlr=true => JLR-inclusive, false => JLR-excluded) because
// summariseWindow uses pickRevenueField. The field name is pre-existing.
const TIER_AT_RISK_STATES = new Set([
  'traffic_with_zero_conversion',
  'visibility_loss_with_low_ctr_baseline',
  'visibility_loss_normal_ctr',
  'funnel_bypass_revenue_with_minimal_organic'
]);

function tierAtRiskRevenue(pages /* includeJlr handled upstream */) {
  let s = 0;
  for (const p of pages) {
    if (!TIER_AT_RISK_STATES.has(p.state)) continue;
    s += Number(p.metrics?.full_window?.revenue_gbp_nonjlr) || 0;
  }
  return round2(s);
}

// ---------------------------------------------------------------------------
// Phase 2 — role-aware GSC overlay (hub vs product, metadata only)
// ---------------------------------------------------------------------------

function collectRoleGscSlugs(gscRoleLookup) {
  const slugs = new Set();
  for (const stream of gscRoleLookup?.streams || []) {
    for (const slug of stream.nav_hub_slugs || []) slugs.add(normalizePageSlug(slug));
    for (const slug of stream.product_slugs || []) slugs.add(normalizePageSlug(slug));
  }
  return [...slugs].filter(Boolean);
}

async function fetchGscTotalsBySlug(supabase, propertyUrl, slugs) {
  const out = new Map();
  if (!slugs?.length) return out;
  const pageSize = 1000;
  for (let i = 0; i < slugs.length; i += 150) {
    const chunk = slugs.slice(i, i + 150);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('gsc_page_timeseries')
        .select('page_url, date, impressions, clicks, position')
        .eq('property_url', propertyUrl)
        .gte('date', GSC_FIRST_DAY)
        .in('page_url', chunk)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = data || [];
      for (const row of batch) {
        const slug = normalizePageSlug(row.page_url);
        if (!slug) continue;
        let cell = out.get(slug);
        if (!cell) {
          cell = { impressions: 0, clicks: 0, weightedPosSum: 0, monthly: new Map() };
          out.set(slug, cell);
        }
        const imp = Number(row.impressions) || 0;
        const clicks = Number(row.clicks) || 0;
        const pos = Number(row.position) || 0;
        cell.impressions += imp;
        cell.clicks += clicks;
        if (imp > 0) cell.weightedPosSum += pos * imp;
        const periodStart = String(row.date || row.period_start || '').slice(0, 7) + '-01';
        let month = cell.monthly.get(periodStart);
        if (!month) {
          month = { period_start: periodStart, impressions: 0, clicks: 0 };
          cell.monthly.set(periodStart, month);
        }
        month.impressions += imp;
        month.clicks += clicks;
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }
  for (const cell of out.values()) {
    cell.best_avg_position = cell.impressions > 0
      ? round2(cell.weightedPosSum / cell.impressions)
      : null;
    cell.monthly_series = [...(cell.monthly?.values() || [])]
      .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    delete cell.monthly;
    delete cell.weightedPosSum;
  }
  return out;
}

function buildRoleGscOverlay(role, slugs, gscBySlug, gscWindow) {
  const rows = (slugs || []).map((slug) => gscMetricsForSlug(slug, gscBySlug));
  return {
    role,
    slugs: rows,
    totals: sumRoleGscRows(rows),
    trend: roleGscTrend(slugs, gscBySlug, gscWindow)
  };
}

function roleGscTrend(slugs, gscBySlug, gscWindow) {
  if (!slugs?.length || !gscWindow?.first_period) {
    return { pct_change_impressions: null, pct_change_clicks: null };
  }
  const byPeriod = new Map();
  for (const slug of slugs) {
    const cell = gscBySlug?.get(normalizePageSlug(slug));
    for (const m of cell?.monthly_series || []) {
      const key = m.period_start;
      let agg = byPeriod.get(key);
      if (!agg) {
        agg = { period_start: key, impressions: 0, clicks: 0 };
        byPeriod.set(key, agg);
      }
      agg.impressions += Number(m.impressions) || 0;
      agg.clicks += Number(m.clicks) || 0;
    }
  }
  const pages = [{ metrics: { monthly_series: [...byPeriod.values()].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start))) } }];
  const trend = tierGscTrend(pages, gscWindow);
  return {
    pct_change_impressions: trend.pct_change_impressions,
    pct_change_clicks: trend.pct_change_clicks
  };
}

function gscMetricsForSlug(slug, gscBySlug) {
  const key = normalizePageSlug(slug);
  const cell = gscBySlug?.get(key);
  return {
    slug: key,
    impressions: cell?.impressions || 0,
    clicks: cell?.clicks || 0,
    best_avg_position: cell?.best_avg_position ?? null,
    monthly_series: cell?.monthly_series || []
  };
}

function sumRoleGscRows(rows) {
  let impressions = 0;
  let clicks = 0;
  let weightedPosSum = 0;
  for (const row of rows) {
    impressions += row.impressions || 0;
    clicks += row.clicks || 0;
    if (row.impressions > 0 && row.best_avg_position != null) {
      weightedPosSum += row.best_avg_position * row.impressions;
    }
  }
  return {
    impressions,
    clicks,
    best_avg_position: impressions > 0 ? round2(weightedPosSum / impressions) : null
  };
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function pctChange(recent, prior) {
  const p = Number(prior) || 0;
  if (p === 0) return null;
  return round1(100 * ((Number(recent) || 0) - p) / p);
}

function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-GB');
}

function fmtPos(p) {
  if (p == null || !Number.isFinite(p)) return '?';
  return Math.round(p).toString();
}
