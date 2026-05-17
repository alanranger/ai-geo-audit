// Revenue Funnel summary aggregator
//
// Powers the "Revenue Funnel" dashboard tab. One call returns the four KPI
// tile values, the funnel stages, top leak pages, the AI Overview map,
// priorities (with live status from optimisation cycles), top earning vs
// traffic pages, and the latest revenue snapshot.
//
// Method: GET
// Query:  ?propertyUrl=https://www.alanranger.com

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

// ----------------------------------------------------------------------
// Money-page tiers
//
// These are the 5 commercial product groups the business actually sells.
// Each tier has:
//   - id          stable key used in API responses + UI filters
//   - label       human-readable
//   - hubUrl      the primary money page the user wants to convert on
//   - prefixes    path prefixes that count as part of this tier
//   - monthlyTarget  £ per month target from Booking Sheet 2026 ("flat")
//
// Order matters: more-specific tiers come first so a URL like
//   /photography-courses-coventry-online
// resolves to "courses", not "workshops".
// ----------------------------------------------------------------------
const MONEY_PAGE_TIERS = [
  {
    id: 'courses',
    label: 'Courses',
    hubUrl: '/photography-courses-coventry',
    prefixes: ['/photography-courses', '/beginners-photography-class', '/beginners-photography-course', '/photography-classes', '/photography-lessons'],
    monthlyTarget: 667
  },
  {
    id: 'workshops',
    label: 'Workshops',
    hubUrl: '/photography-workshops',
    prefixes: ['/photography-workshops', '/landscape-photography-workshops', '/2-5hr-workshops', '/2.5hr-4hr-workshops', '/one-day-workshops', '/residential-workshops', '/workshops-calendar'],
    monthlyTarget: 2500
  },
  {
    id: 'services',
    label: '1-2-1 & Services',
    hubUrl: '/photography-tuition-services',
    prefixes: ['/photography-tuition-services', '/photography-services', '/1-2-1-photography-tuition', '/1-2-1-private-photography-tuition', '/photography-lessons-online-1-2-1', '/private-photography-lessons', '/mentoring', '/rps-mentoring', '/gift-vouchers', '/pick-n-mix'],
    monthlyTarget: 863
  },
  {
    id: 'hire',
    label: 'Hire / Commercial',
    hubUrl: '/hire-a-professional-photographer-in-coventry',
    prefixes: ['/hire-a-professional-photographer', '/products-services-property-photography', '/portrait-photography', '/staff-training-on-photography', '/commercial-photography', '/headshots'],
    monthlyTarget: 350
  },
  {
    id: 'academy',
    label: 'Academy',
    hubUrl: '/free-photography-course',
    prefixes: ['/free-photography-course', '/academy', '/free-online-photography-course', '/online-photography-course'],
    monthlyTarget: 667
  }
];

// Seasonal monthly TOTAL targets (sum across all tiers) from Booking Sheet 2026.
// Index 0 = January … 11 = December. Annual total = £60,556.
const SEASONAL_MONTHLY_TARGETS = [4555, 3674, 2422, 4985, 5833, 6277, 4725, 3592, 5633, 7352, 6050, 5457];
const ANNUAL_REVENUE_TARGET = SEASONAL_MONTHLY_TARGETS.reduce((a, b) => a + b, 0);
const FLAT_MONTHLY_TIER_TOTAL = MONEY_PAGE_TIERS.reduce((s, t) => s + t.monthlyTarget, 0);

// Industry baselines used for the funnel KPI RAG indicators.
// These were chosen to align with the existing top-leak-page benchmark
// (1.5% CTR target for informational queries) and the user's existing
// money_page_click_share_pct target of ~3pp in the seeded priorities.
const KPI_BASELINES = {
  ctr_28d_pct: { target: 1.5, warn: 1 },              // last 28d CTR
  money_page_click_share_pct: { target: 3, warn: 2 },
  click_to_sale_pct: { target: 0.5, warn: 0.25 },
  revenue_per_1k_impressions: { target: 1, warn: 0.5 }
};

function tierOf(pageUrl) {
  const p = pathOf(pageUrl);
  if (!p) return null;
  for (const tier of MONEY_PAGE_TIERS) {
    if (tier.prefixes.some(pref => p.startsWith(pref))) return tier.id;
  }
  return null;
}

function tierLabel(id) {
  const t = MONEY_PAGE_TIERS.find(x => x.id === id);
  return t ? t.label : 'Other';
}

// Clean a URL for display: strip tracking junk (?srsltid, utm_*, etc) so the
// AI Overview map and earning tables show readable page paths.
const TRACKING_PARAM_PREFIXES = ['srsltid', 'utm_', 'gclid', 'fbclid', 'mc_eid', '_gl'];
function cleanUrlForDisplay(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl, 'https://www.alanranger.com');
    const keys = Array.from(u.searchParams.keys());
    keys.forEach(k => {
      const lk = k.toLowerCase();
      if (TRACKING_PARAM_PREFIXES.some(p => lk === p || lk.startsWith(p))) u.searchParams.delete(k);
    });
    u.hash = '';
    const search = u.searchParams.toString();
    return `${u.pathname}${search ? '?' + search : ''}`;
  } catch {
    return String(rawUrl).replace(/[?&](srsltid|utm_[^=]+|gclid|fbclid)=[^&]*/gi, '').replace(/^https?:\/\/[^/]+/i, '');
  }
}

// Generate a short, friendly label for a path, e.g.
//   "/photography-courses-coventry" -> "Photography courses coventry"
//   "/blog-on-photography/jpeg-vs-raw-the-key-differences" -> "Blog – Jpeg vs raw the key differences"
function labelForUrl(rawUrl) {
  const path = cleanUrlForDisplay(rawUrl).split('?')[0];
  if (!path || path === '/') return 'Home';
  const segs = path.replace(/^\/+|\/+$/g, '').split('/');
  const last = segs.at(-1) || '';
  const friendly = last.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
  if (segs[0] === 'blog-on-photography') return `Blog – ${friendly}`;
  return friendly;
}

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

function pathOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://x/');
    return (u.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  } catch {
    return String(url).toLowerCase();
  }
}

function isMoneyPage(pageUrl) {
  return tierOf(pageUrl) !== null;
}

function pct(numer, denom) {
  if (!denom || !Number.isFinite(numer)) return null;
  return (numer / denom) * 100;
}

async function fetchLatestAudit(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position')
    .eq('property_url', propertyUrl)
    .eq('is_partial', false)
    .order('audit_date', { ascending: false })
    .limit(2);
  if (error) throw error;
  return data || [];
}

async function fetchPageMetrics(supabase, propertyUrl) {
  // gsc_page_metrics_28d holds one row per (page_url, date_end). We want the
  // pages from the most recent snapshot only — find latest date_end first,
  // then fetch all pages for that date.
  const latestRow = await supabase
    .from('gsc_page_metrics_28d')
    .select('date_end')
    .eq('site_url', propertyUrl)
    .order('date_end', { ascending: false })
    .limit(1);
  const latestEnd = latestRow.data && latestRow.data[0] ? latestRow.data[0].date_end : null;
  if (!latestEnd) return { rows: [], dateEnd: null };
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, ctr_28d, position_28d, date_end')
    .eq('site_url', propertyUrl)
    .eq('date_end', latestEnd)
    .limit(2000);
  if (error) throw error;
  return { rows: data || [], dateEnd: latestEnd };
}

function computeKpis(pageRows, auditLatest, auditPrior, revenueSnap) {
  const totals = pageRows.reduce((acc, r) => {
    const clicks = Number(r.clicks_28d) || 0;
    const impr = Number(r.impressions_28d) || 0;
    acc.clicks += clicks;
    acc.impressions += impr;
    if (isMoneyPage(r.page_url)) acc.moneyClicks += clicks;
    return acc;
  }, { clicks: 0, impressions: 0, moneyClicks: 0 });

  const ctr = pct(totals.clicks, totals.impressions);
  const moneyShare = pct(totals.moneyClicks, totals.clicks);
  const ctrPrior = auditPrior ? Number(auditPrior.gsc_ctr) || null : null;
  const revenue = revenueSnap ? Number(revenueSnap.revenue_amount) || 0 : 0;
  const txns = revenueSnap ? Number(revenueSnap.transactions) || 0 : 0;
  const revPer1k = totals.impressions > 0 ? (revenue / totals.impressions) * 1000 : null;
  const clickToSale = pct(txns, totals.clicks);

  return {
    ctr_28d_pct: ctr,
    ctr_prior_pct: ctrPrior,
    money_page_click_share_pct: moneyShare,
    click_to_sale_pct: clickToSale,
    revenue_per_1k_impressions: revPer1k,
    revenue_currency: revenueSnap ? revenueSnap.currency : 'GBP',
    total_clicks_28d: totals.clicks,
    total_impressions_28d: totals.impressions,
    total_money_clicks_28d: totals.moneyClicks,
    audit_date_latest: auditLatest ? auditLatest.audit_date : null,
    audit_date_prior: auditPrior ? auditPrior.audit_date : null
  };
}

function computeFunnel(kpis, revenueSnap) {
  // Six-stage funnel. Industry benchmark targets are conservative defaults;
  // tweak in dashboard if needed.
  const clicks = kpis.total_clicks_28d;
  const impr = kpis.total_impressions_28d;
  const moneyClicks = kpis.total_money_clicks_28d;
  const txns = revenueSnap ? Number(revenueSnap.transactions) || 0 : 0;
  const revenue = revenueSnap ? Number(revenueSnap.revenue_amount) || 0 : 0;
  return [
    { stage: 'Impressions', value: impr, target_pct_next: 1.5 },
    { stage: 'Clicks', value: clicks, target_pct_next: 25 },
    { stage: 'Money-page clicks', value: moneyClicks, target_pct_next: 8 },
    { stage: 'Add-to-cart / enquiry', value: null, target_pct_next: 35 },
    { stage: 'Transactions', value: txns || null, target_pct_next: null },
    { stage: 'Revenue', value: revenue || null, target_pct_next: null }
  ];
}

function pickLeakPages(pageRows) {
  // Pages with high impressions AND low CTR. Score = impressions * (1 - ctr).
  // Filter out money pages (those are handled in the earning table).
  const scored = pageRows
    .filter((r) => !isMoneyPage(r.page_url))
    .filter((r) => (Number(r.impressions_28d) || 0) >= 500)
    .map((r) => {
      const impr = Number(r.impressions_28d) || 0;
      const clicks = Number(r.clicks_28d) || 0;
      const ctr = Number(r.ctr_28d) || 0;
      const leakScore = impr * Math.max(0, 1 - ctr);
      const target = Math.max(0.015, ctr * 1.6);
      const recoverable = Math.max(0, Math.round((target - ctr) * impr));
      return {
        page_url: r.page_url,
        clicks_28d: clicks,
        impressions_28d: impr,
        ctr_28d_pct: ctr * 100,
        position_28d: Number(r.position_28d) || null,
        leak_score: leakScore,
        recoverable_clicks_28d: recoverable
      };
    })
    .sort((a, b) => b.recoverable_clicks_28d - a.recoverable_clicks_28d);
  return scored.slice(0, 5);
}

function pickEarningPages(pageRows) {
  // Top 10 by clicks; flag money vs free.
  return [...pageRows]
    .filter((r) => (Number(r.clicks_28d) || 0) > 0)
    .sort((a, b) => (Number(b.clicks_28d) || 0) - (Number(a.clicks_28d) || 0))
    .slice(0, 10)
    .map((r) => ({
      page_url: r.page_url,
      clicks_28d: Number(r.clicks_28d) || 0,
      impressions_28d: Number(r.impressions_28d) || 0,
      ctr_28d_pct: (Number(r.ctr_28d) || 0) * 100,
      is_money_page: isMoneyPage(r.page_url)
    }));
}

function classifyAiMapRow(row) {
  const cited = (Number(row.ai_alan_citations_count) || 0) > 0;
  const overview = !!row.has_ai_overview;
  let bucket = 'no_overview';
  if (overview && cited) bucket = 'overview_cited';
  else if (overview && !cited) bucket = 'overview_uncited';
  const segment = row.segment || 'other';
  const tier = tierOf(row.best_url || '');
  const isMoney = !!tier || segment === 'money';
  return {
    keyword: row.keyword,
    rank: row.best_rank_group != null ? Number(row.best_rank_group) : null,
    search_volume: Number(row.search_volume) || 0,
    has_ai_overview: overview,
    cited,
    bucket,
    best_url: row.best_url || null,
    clean_url: cleanUrlForDisplay(row.best_url || ''),
    url_label: labelForUrl(row.best_url || ''),
    segment,
    tier: tier || null,
    tier_label: tier ? tierLabel(tier) : null,
    page_type: row.page_type || 'Other',
    is_money_page: isMoney
  };
}

async function fetchAiOverviewMap(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select('audit_date, keyword, best_rank_group, search_volume, has_ai_overview, ai_alan_citations_count, segment, page_type, best_url')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const latest = new Map();
  for (let i = 0; i < (data || []).length; i += 1) {
    const row = data[i];
    if (!latest.has(row.keyword)) latest.set(row.keyword, row);
  }
  const out = [];
  for (const row of latest.values()) out.push(classifyAiMapRow(row));
  out.sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
  return out.slice(0, 200);
}

// Returns up to the most recent 12 calendar-month-anchored revenue rows,
// oldest first. A row qualifies if:
//   - length is 25-35 days
//   - period_start day-of-month is <= 5 (i.e. starts on the 1st-ish)
//   - period_end day-of-month is >= 25 (i.e. ends near month-end)
// This filters out rolling-28d rows like 2026-04-20 -> 2026-05-17 which
// otherwise collide with the real April calendar month.
function dayOfMonth(dateStr) {
  return Number(String(dateStr).slice(8, 10)) || 1;
}
function isCalendarMonthRow(row) {
  const days = daysBetween(row.period_start, row.period_end);
  if (days < 25 || days > 35) return false;
  return dayOfMonth(row.period_start) <= 5 && dayOfMonth(row.period_end) >= 25;
}

async function fetchRevenueHistory(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, period_end, revenue_amount, currency, source, transactions, tier_revenue, tier_transactions')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(60);
  if (error) throw error;
  const monthly = (data || []).filter(isCalendarMonthRow);
  const dedupedByMonth = new Map();
  for (const row of monthly) {
    const key = row.period_start.slice(0, 7); // YYYY-MM
    if (!dedupedByMonth.has(key)) dedupedByMonth.set(key, row);
  }
  const sorted = Array.from(dedupedByMonth.values())
    .sort((a, b) => a.period_end.localeCompare(b.period_end));
  return sorted.slice(-12);
}

function targetForMonth(periodStart) {
  const monthIdx = Number(periodStart.slice(5, 7)) - 1;
  return SEASONAL_MONTHLY_TARGETS[monthIdx] || null;
}

function variancePct(revenue, target) {
  if (!target || target <= 0) return null;
  return ((revenue - target) / target) * 100;
}

// Attach per-month seasonal targets + variance % to the history rows.
function decorateHistoryWithTargets(history) {
  const todayIso = new Date().toISOString().slice(0, 10);
  return history.map(row => {
    const target = targetForMonth(row.period_start);
    const revenue = Number(row.revenue_amount) || 0;
    return {
      ...row,
      target,
      variance_pct: variancePct(revenue, target),
      is_partial: row.period_end > todayIso
    };
  });
}

// Build a per-tier history series the dashboard can render as a mini
// sparkline. For each commercial tier we return:
//   { tier_id, tier_label, monthly_target, monthly_total_28d, points: [
//       { month, revenue, target, variance_pct, is_partial }
//     ] }
// The `revenue` value is read from `revenue_snapshots.tier_revenue[tier_id]`
// when present, falling back to null (UI shows "no data" for that point).
function emptyTierSeries() {
  return MONEY_PAGE_TIERS.map(t => ({
    tier_id: t.id,
    tier_label: t.label,
    monthly_target: t.monthlyTarget,
    points: []
  }));
}

function tierMapOf(row) {
  if (row.tier_revenue && typeof row.tier_revenue === 'object') return row.tier_revenue;
  return null;
}

function tierPoint(row, tierMap, series) {
  const revenue = tierMap ? Number(tierMap[series.tier_id]) : null;
  const isNum = Number.isFinite(revenue);
  return {
    month: row.period_start.slice(0, 7),
    revenue: isNum ? revenue : null,
    target: series.monthly_target,
    variance_pct: isNum ? variancePct(revenue, series.monthly_target) : null,
    is_partial: row.is_partial,
    has_tier_breakdown: tierMap !== null
  };
}

function buildTierHistory(history) {
  const out = emptyTierSeries();
  for (const row of history || []) {
    const tierMap = tierMapOf(row);
    for (const series of out) series.points.push(tierPoint(row, tierMap, series));
  }
  return out;
}

// -----------------------------------------------------------------
// Money-page performance per tier — broken into small helpers to
// stay under the 15-complexity rule. Each helper does ONE thing.
// -----------------------------------------------------------------
const AOV_BY_TIER = { workshops: 250, courses: 200, services: 100, hire: 200, academy: 79 };
const TARGET_CONVERSION = 0.01; // 1% click-to-sale on a money page (industry baseline)

function initTierBucket(tier) {
  return {
    tier_id: tier.id,
    tier_label: tier.label,
    hub_url: tier.hubUrl,
    monthly_target: tier.monthlyTarget,
    pages: [],
    clicks_28d: 0,
    impressions_28d: 0,
    best_rank: null,
    total_search_volume: 0,
    ai_keywords_total: 0,
    ai_keywords_cited: 0,
    ai_keywords_uncited: 0
  };
}

function accumulatePageIntoBucket(bucket, row) {
  const clicks = Number(row.clicks_28d) || 0;
  const impr = Number(row.impressions_28d) || 0;
  bucket.pages.push({
    page_url: row.page_url,
    clean_url: cleanUrlForDisplay(row.page_url),
    clicks_28d: clicks,
    impressions_28d: impr,
    ctr_28d_pct: row.ctr_28d != null ? Number(row.ctr_28d) * 100 : null,
    position_28d: row.position_28d != null ? Number(row.position_28d) : null
  });
  bucket.clicks_28d += clicks;
  bucket.impressions_28d += impr;
}

function accumulateKeywordIntoBucket(bucket, kw) {
  bucket.total_search_volume += Number(kw.search_volume) || 0;
  bucket.ai_keywords_total += 1;
  if (kw.bucket === 'overview_cited') bucket.ai_keywords_cited += 1;
  if (kw.bucket === 'overview_uncited') bucket.ai_keywords_uncited += 1;
  const r = kw.rank;
  if (r != null && (bucket.best_rank == null || r < bucket.best_rank)) {
    bucket.best_rank = r;
  }
}

function finaliseTierBucket(bucket) {
  bucket.pages.sort((a, b) => b.clicks_28d - a.clicks_28d);
  bucket.top_page = bucket.pages[0] || null;
  bucket.page_count = bucket.pages.length;
  bucket.ctr_28d_pct = bucket.impressions_28d > 0
    ? (bucket.clicks_28d / bucket.impressions_28d) * 100
    : null;
  const aov = AOV_BY_TIER[bucket.tier_id] || 150;
  bucket.aov_assumed = aov;
  bucket.revenue_potential_28d = Math.round(bucket.clicks_28d * TARGET_CONVERSION * aov);
  bucket.pages = bucket.pages.slice(0, 5);
  return bucket;
}

function pickMoneyPagePerformance(pageRows, aiMap) {
  const byTier = new Map();
  for (const tier of MONEY_PAGE_TIERS) byTier.set(tier.id, initTierBucket(tier));
  for (const row of (pageRows || [])) {
    const tierId = tierOf(row.page_url);
    if (tierId) accumulatePageIntoBucket(byTier.get(tierId), row);
  }
  for (const kw of (aiMap || [])) {
    const tierId = tierOf(kw.best_url || '');
    if (tierId) accumulateKeywordIntoBucket(byTier.get(tierId), kw);
  }
  return MONEY_PAGE_TIERS.map(t => finaliseTierBucket(byTier.get(t.id)));
}

// Decide RAG status for a KPI based on baseline thresholds.
function ragFor(value, baseline) {
  if (value == null || baseline == null) return 'unknown';
  if (value >= baseline.target) return 'green';
  if (value >= baseline.warn) return 'amber';
  return 'red';
}

function revenueRagFor(actual, target) {
  if (actual >= target) return 'green';
  if (actual >= target * 0.7) return 'amber';
  return 'red';
}

function computeKpiTargets(kpis, revenueSnap) {
  // The 28-day revenue target: slice ANNUAL_REVENUE_TARGET to 28 days.
  // (≈ £4,646 — a reasonable benchmark to compare against the rolling 28d
  // actual.) The seasonal monthly figures are surfaced separately in the
  // revenue history table.
  const annual28d = ANNUAL_REVENUE_TARGET * (28 / 365);
  const revenueActual = (revenueSnap && Number(revenueSnap.revenue_amount)) || 0;
  const revenueRag = revenueRagFor(revenueActual, annual28d);
  return {
    annual_target: ANNUAL_REVENUE_TARGET,
    rolling_28d_target: Math.round(annual28d),
    rolling_28d_actual: Math.round(revenueActual),
    rolling_28d_rag: revenueRag,
    ctr_28d_pct: { value: kpis.ctr_28d_pct, target: KPI_BASELINES.ctr_28d_pct.target, rag: ragFor(kpis.ctr_28d_pct, KPI_BASELINES.ctr_28d_pct) },
    money_page_click_share_pct: { value: kpis.money_page_click_share_pct, target: KPI_BASELINES.money_page_click_share_pct.target, rag: ragFor(kpis.money_page_click_share_pct, KPI_BASELINES.money_page_click_share_pct) },
    click_to_sale_pct: { value: kpis.click_to_sale_pct, target: KPI_BASELINES.click_to_sale_pct.target, rag: ragFor(kpis.click_to_sale_pct, KPI_BASELINES.click_to_sale_pct) },
    revenue_per_1k_impressions: { value: kpis.revenue_per_1k_impressions, target: KPI_BASELINES.revenue_per_1k_impressions.target, rag: ragFor(kpis.revenue_per_1k_impressions, KPI_BASELINES.revenue_per_1k_impressions) }
  };
}

async function fetchPrioritiesWithCycle(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .select('id, sort_order, title, description, pages_affected, primary_kpi, kpi_target_value, kpi_target_direction, kpi_baseline_value, estimated_lift, status, optimisation_task_id, notes, created_at, updated_at, done_at')
    .eq('property_url', propertyUrl)
    .order('sort_order');
  if (error) throw error;
  const rows = data || [];
  const taskIds = rows.map((r) => r.optimisation_task_id).filter(Boolean);
  let cycleByTask = new Map();
  if (taskIds.length) {
    const { data: tasks } = await supabase
      .from('optimisation_tasks')
      .select('id, active_cycle_id, status')
      .in('id', taskIds);
    const cycleIds = (tasks || []).map((t) => t.active_cycle_id).filter(Boolean);
    if (cycleIds.length) {
      const { data: cycles } = await supabase
        .from('optimisation_task_cycles')
        .select('id, task_id, objective_status, primary_kpi, baseline_value, target_value, due_at')
        .in('id', cycleIds);
      (cycles || []).forEach((c) => cycleByTask.set(c.task_id, c));
    }
  }
  return rows.map((r) => ({
    ...r,
    cycle: r.optimisation_task_id ? (cycleByTask.get(r.optimisation_task_id) || null) : null
  }));
}

// Rolling-window revenue picker.
// The funnel KPI tiles divide revenue by GSC 28-day clicks, so we must use a
// revenue snapshot whose window matches the GSC window length. We prefer
// rolling-window rows (period length 25-35 days, ending on or before today)
// over partial calendar months (which would understate revenue) and over
// future-dated month-bucket rows.
const ROLLING_MIN_DAYS = 25;
const ROLLING_MAX_DAYS = 35;

function daysBetween(startStr, endStr) {
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function pickBestRevenueRow(rows) {
  if (!rows.length) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const isClosed = (row) => row.period_end <= todayIso;
  const inRolling = (row) => {
    const len = daysBetween(row.period_start, row.period_end);
    return len >= ROLLING_MIN_DAYS && len <= ROLLING_MAX_DAYS;
  };
  const closedRolling = rows.filter(isClosed).filter(inRolling);
  if (closedRolling.length) return closedRolling[0];
  const closedAny = rows.filter(isClosed);
  if (closedAny.length) return closedAny[0];
  return rows[0];
}

async function fetchLatestRevenue(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, period_end, revenue_amount, currency, source, transactions, notes')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(12);
  if (error) throw error;
  return pickBestRevenueRow(data || []);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const [audits, pageMetrics, revenueSnap, aiMap, priorities, revenueHistory] = await Promise.all([
      fetchLatestAudit(supabase, propertyUrl),
      fetchPageMetrics(supabase, propertyUrl),
      fetchLatestRevenue(supabase, propertyUrl),
      fetchAiOverviewMap(supabase, propertyUrl),
      fetchPrioritiesWithCycle(supabase, propertyUrl),
      fetchRevenueHistory(supabase, propertyUrl)
    ]);
    const pageRows = pageMetrics.rows;
    const auditLatest = audits[0] || null;
    const auditPrior = audits[1] || null;
    const kpis = computeKpis(pageRows, auditLatest, auditPrior, revenueSnap);
    const funnel = computeFunnel(kpis, revenueSnap);
    const leakPages = pickLeakPages(pageRows);
    const earningPages = pickEarningPages(pageRows);
    const moneyPagePerformance = pickMoneyPagePerformance(pageRows, aiMap);
    const kpiTargets = computeKpiTargets(kpis, revenueSnap);
    const revenueHistoryDecorated = decorateHistoryWithTargets(revenueHistory);
    const tierHistory = buildTierHistory(revenueHistoryDecorated);
    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      page_metrics_date_end: pageMetrics.dateEnd,
      kpis,
      kpi_targets: kpiTargets,
      funnel,
      top_leak_pages: leakPages,
      ai_overview_map: aiMap,
      priorities,
      earning_pages: earningPages,
      money_page_performance: moneyPagePerformance,
      latest_revenue: revenueSnap,
      revenue_history: revenueHistoryDecorated,
      tier_history: tierHistory,
      tiers: MONEY_PAGE_TIERS.map(t => ({ id: t.id, label: t.label, hub_url: t.hubUrl, monthly_target: t.monthlyTarget }))
    });
  } catch (err) {
    return send(res, 500, { error: 'summary_failed', message: err?.message || String(err) });
  }
}
