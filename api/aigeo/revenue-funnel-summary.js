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
    monthlyTarget: 667,
    grossProfitPct: 90
  },
  {
    // Non-Residential = "2. Workshops Non Residential" in the Booking Sheet
    // = the bigger of the two splits (half-day + one-day workshops).
    id: 'workshops_nonres',
    label: 'Workshops (Non-Res)',
    hubUrl: '/photography-workshops',
    prefixes: ['/photography-workshops', '/landscape-photography-workshops', '/2-5hr-workshops', '/2.5hr-4hr-workshops', '/one-day-workshops', '/workshops-calendar'],
    monthlyTarget: 1667,
    grossProfitPct: 75
  },
  {
    // Residential = "3. Workshops Residential" in the Booking Sheet
    // = weekend/multi-day workshops with hotel accommodation included.
    // Slug list is in commercial-tier.js WORKSHOP_RESIDENTIAL_PATHS.
    id: 'workshops_residential',
    label: 'Workshops (Residential)',
    hubUrl: '/photography-workshops-near-me',
    prefixes: ['/photography-workshops-near-me', '/residential-workshops'],
    monthlyTarget: 833,
    grossProfitPct: 35
  },
  {
    id: 'services',
    label: '1-2-1 & Services',
    hubUrl: '/photography-tuition-services',
    prefixes: ['/photography-tuition-services', '/photography-services', '/1-2-1-photography-tuition', '/1-2-1-private-photography-tuition', '/photography-lessons-online-1-2-1', '/private-photography-lessons', '/mentoring', '/rps-mentoring', '/gift-vouchers', '/pick-n-mix'],
    monthlyTarget: 863,
    // Weighted blend of: 1-2-1 95% + Mentoring 95% + PicknMix Inc 50% +
    // Gift Vouchers Inc 60% (ignoring the negative debit/credit "Out"
    // entries which are reallocation, not real margin). Per 2026 YTD
    // proportions this lands at ~78% effective GP.
    grossProfitPct: 78
  },
  {
    id: 'hire',
    label: 'Hire / Commercial',
    hubUrl: '/hire-a-professional-photographer-in-coventry',
    prefixes: ['/hire-a-professional-photographer', '/products-services-property-photography', '/portrait-photography', '/staff-training-on-photography', '/commercial-photography', '/headshots'],
    monthlyTarget: 350,
    // Weighted blend of Prints & Royalties 99% + Commissions 90%.
    // Commissions dominate revenue so the effective blend lands at ~92%.
    grossProfitPct: 92
  },
  {
    id: 'academy',
    label: 'Academy',
    hubUrl: '/free-photography-course',
    prefixes: ['/free-photography-course', '/academy', '/free-online-photography-course', '/online-photography-course'],
    monthlyTarget: 667,
    grossProfitPct: 99
  },
  {
    // Safety-net bucket. Anything the classifier can't confidently tier
    // lands here. Target 0 so any value > 0 shows as an over-target red
    // signal on the dashboard - prompts a review and a name-token update
    // in api/aigeo/commercial-tier.js.
    id: 'unidentified',
    label: 'Unidentified (needs review)',
    hubUrl: '',
    prefixes: [],
    monthlyTarget: 0,
    grossProfitPct: null
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

// Gross-profit RAG thresholds. Numbers are gross-profit-margin percentages
// taken from Alan's 2026 Booking Sheet (per category): 99% Academy & Prints
// at the top, 35% Residential Workshops at the bottom (travel + hotel +
// meals consume two thirds of the gross fee). Green = sit-back margin,
// Amber = decent but not passive, Red = revenue is doing all the work
// and you're keeping very little. Used by tile chips + the new
// profit-pyramid panel.
const GROSS_PROFIT_RAG = { green: 80, amber: 50 };

function gpRagBucket(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 'unknown';
  if (pct >= GROSS_PROFIT_RAG.green) return 'green';
  if (pct >= GROSS_PROFIT_RAG.amber) return 'amber';
  return 'red';
}

function grossProfitAmount(revenue, pct) {
  const r = Number(revenue) || 0;
  const p = Number(pct);
  if (!Number.isFinite(p)) return null;
  return Number((r * (p / 100)).toFixed(2));
}

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

// Merge tier breakdowns from multiple revenue rows that cover the same
// period. The Squarespace sync writes one row (source=squarespace_api), the
// Stripe sync writes another (source=stripe_supplemental) with only the
// non-overlapping streams (Acuity + subscriptions). Summing them gives the
// true total without double counting.
function addTierMaps(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const [k, v] of Object.entries(source)) {
    target[k] = (Number(target[k]) || 0) + (Number(v) || 0);
  }
  return target;
}

function mergeRevenueRows(base, others) {
  const baseRev = Number(base.revenue_amount) || 0;
  const baseTxn = Number(base.transactions) || 0;
  const sourceBreakdown = { [base.source]: { revenue: baseRev, transactions: baseTxn } };
  const merged = {
    ...base,
    revenue_amount: baseRev,
    transactions: baseTxn,
    tier_revenue: { ...(base.tier_revenue || {}) },
    tier_transactions: { ...(base.tier_transactions || {}) },
    sources: [base.source],
    source_breakdown: sourceBreakdown
  };
  for (const row of others || []) {
    const rev = Number(row.revenue_amount) || 0;
    const txn = Number(row.transactions) || 0;
    merged.revenue_amount += rev;
    merged.transactions += txn;
    addTierMaps(merged.tier_revenue, row.tier_revenue);
    addTierMaps(merged.tier_transactions, row.tier_transactions);
    merged.sources.push(row.source);
    const slot = sourceBreakdown[row.source] || { revenue: 0, transactions: 0 };
    slot.revenue += rev;
    slot.transactions += txn;
    sourceBreakdown[row.source] = slot;
  }
  return merged;
}

// Prefer the Squarespace row as "base" because it carries the richest tier
// breakdown (full line-item split). If absent, pick whichever row has the
// most revenue so we don't accidentally use an empty Stripe-supplemental row.
function pickHistoryBaseRow(rows) {
  if (!rows.length) return null;
  const ss = rows.find(r => String(r.source || '').startsWith('squarespace'));
  if (ss) return ss;
  return rows.reduce(
    (best, cur) => ((Number(cur.revenue_amount) || 0) > (Number(best.revenue_amount) || 0) ? cur : best),
    rows[0]
  );
}

function mergeRowsByMonth(rows) {
  const byMonth = new Map();
  for (const row of rows) {
    const key = row.period_start.slice(0, 7);
    const arr = byMonth.get(key) || [];
    arr.push(row);
    byMonth.set(key, arr);
  }
  const merged = [];
  for (const [, group] of byMonth) {
    const base = pickHistoryBaseRow(group);
    if (!base) continue;
    const others = group.filter(r => r !== base);
    merged.push(mergeRevenueRows(base, others));
  }
  return merged;
}

async function fetchRevenueHistory(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, period_end, revenue_amount, currency, source, transactions, tier_revenue, tier_transactions')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(120);
  if (error) throw error;
  const monthly = (data || []).filter(isCalendarMonthRow);
  const merged = mergeRowsByMonth(monthly);
  const sorted = merged.toSorted((a, b) => a.period_end.localeCompare(b.period_end));
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
    gross_profit_pct: t.grossProfitPct ?? null,
    gross_profit_rag: gpRagBucket(t.grossProfitPct ?? null),
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
  for (const series of out) {
    series.current_month = computeTierCurrentMonth(series);
    series.ytd = computeTierYtd(series);
  }
  return out;
}

// Profit pyramid: re-rank tiers by annualised gross profit so the UI
// can answer "where is profit actually coming from?" — which is NOT the
// same as "where is revenue coming from?". Residential workshops top
// revenue but bottom GP, while Academy and Hire (Prints + Commissions)
// punch above their revenue weight. We also expose the share-of-profit
// vs share-of-revenue gap so the UI can highlight the imbalance.
function buildProfitPyramid(tierHistory) {
  const rows = (tierHistory || [])
    .filter(s => s.tier_id !== 'unidentified' && s.gross_profit_pct != null)
    .map(s => {
      const annualGp = s.ytd?.run_rate_annual_gp_gbp || 0;
      const annualRev = s.ytd?.run_rate_annual_revenue_gbp || 0;
      return {
        tier_id: s.tier_id,
        tier_label: s.tier_label,
        gross_profit_pct: s.gross_profit_pct,
        gross_profit_rag: s.gross_profit_rag,
        ytd_revenue_gbp: s.ytd?.revenue_gbp || 0,
        ytd_gp_gbp: s.ytd?.gross_profit_ytd_gbp || 0,
        annualised_revenue_gbp: annualRev,
        annualised_gp_gbp: annualGp
      };
    });
  const totalAnnualGp = rows.reduce((a, b) => a + (b.annualised_gp_gbp || 0), 0);
  const totalAnnualRev = rows.reduce((a, b) => a + (b.annualised_revenue_gbp || 0), 0);
  const totalYtdGp = rows.reduce((a, b) => a + (b.ytd_gp_gbp || 0), 0);
  const totalYtdRev = rows.reduce((a, b) => a + (b.ytd_revenue_gbp || 0), 0);
  for (const r of rows) {
    r.share_of_gp_pct = totalAnnualGp > 0 ? Number(((r.annualised_gp_gbp / totalAnnualGp) * 100).toFixed(1)) : 0;
    r.share_of_revenue_pct = totalAnnualRev > 0 ? Number(((r.annualised_revenue_gbp / totalAnnualRev) * 100).toFixed(1)) : 0;
    r.share_gap_pp = Number((r.share_of_gp_pct - r.share_of_revenue_pct).toFixed(1));
  }
  rows.sort((a, b) => b.annualised_gp_gbp - a.annualised_gp_gbp);
  // GP target = £2.5k–£4k/month (£30k–£48k/yr) — the actual cash-profit
  // floor and ceiling Alan needs to live off, after costs.
  // Revenue target = £4k–£5k/month (£48k–£60k/yr) — the gross turnover
  // that should deliver the GP target at the current product mix.
  const MONTHLY_GP_MIN = 2500;
  const MONTHLY_GP_MAX = 4000;
  const ANNUAL_GP_MIN = MONTHLY_GP_MIN * 12;
  const ANNUAL_GP_MAX = MONTHLY_GP_MAX * 12;
  const MONTHLY_REV_MIN = 4000;
  const MONTHLY_REV_MAX = 5000;
  const ANNUAL_REV_MIN = MONTHLY_REV_MIN * 12;
  const ANNUAL_REV_MAX = MONTHLY_REV_MAX * 12;
  return {
    rows,
    annualised_gp_total_gbp: Number(totalAnnualGp.toFixed(2)),
    annualised_revenue_total_gbp: Number(totalAnnualRev.toFixed(2)),
    ytd_gp_total_gbp: Number(totalYtdGp.toFixed(2)),
    ytd_revenue_total_gbp: Number(totalYtdRev.toFixed(2)),
    projected_remainder_gp_gbp: Number(Math.max(0, totalAnnualGp - totalYtdGp).toFixed(2)),
    projected_remainder_revenue_gbp: Number(Math.max(0, totalAnnualRev - totalYtdRev).toFixed(2)),
    monthly_gp_target_low_gbp: MONTHLY_GP_MIN,
    monthly_gp_target_high_gbp: MONTHLY_GP_MAX,
    annual_gp_target_low_gbp: ANNUAL_GP_MIN,
    annual_gp_target_high_gbp: ANNUAL_GP_MAX,
    monthly_revenue_target_low_gbp: MONTHLY_REV_MIN,
    monthly_revenue_target_high_gbp: MONTHLY_REV_MAX,
    annual_revenue_target_low_gbp: ANNUAL_REV_MIN,
    annual_revenue_target_high_gbp: ANNUAL_REV_MAX,
    gp_gap_to_min_annual_gbp: Number(Math.max(0, ANNUAL_GP_MIN - totalAnnualGp).toFixed(2)),
    revenue_gap_to_min_annual_gbp: Number(Math.max(0, ANNUAL_REV_MIN - totalAnnualRev).toFixed(2)),
    profit_goal_progress_pct: Number(((totalAnnualGp / ANNUAL_GP_MIN) * 100).toFixed(1))
  };
}

// Per-tier "current month" tile data:
//   - the most recent point that has revenue (partial month is fine —
//     that's literally "month-to-date so far")
//   - target is pro-rated by days-elapsed so variance is fair
function computeTierCurrentMonth(series) {
  const points = Array.isArray(series.points) ? series.points : [];
  let latest = null;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(Number(points[i].revenue))) { latest = points[i]; break; }
  }
  if (!latest) return null;
  const revenue = Number(latest.revenue) || 0;
  const monthFull = series.monthly_target || 0;
  const now = new Date();
  let target = monthFull;
  if (latest.is_partial) {
    const dim = daysInMonth(now.getUTCFullYear(), now.getUTCMonth());
    target = monthFull * (now.getUTCDate() / dim);
  }
  const variance = target > 0 ? ((revenue - target) / target) * 100 : null;
  return {
    month: latest.month,
    is_partial: !!latest.is_partial,
    revenue_gbp: revenue,
    target_gbp: target,
    target_full_gbp: monthFull,
    variance_pct: variance
  };
}

// Per-tier YTD tile data:
//   - sum revenue across all current-year points
//   - target = monthly_target × months_elapsed_prorata
//   - gross_profit_ytd_gbp = revenue × tier GP%
//   - run_rate_annual_gp_gbp = simple ×(12/months_with_data) projection
//     so a partial YTD still gives a reasonable "if you stayed on this
//     pace" annual profit estimate for the profit-pyramid view.
function computeTierYtd(series) {
  const points = Array.isArray(series.points) ? series.points : [];
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIdx = now.getUTCMonth();
  const dim = daysInMonth(year, monthIdx);
  const dayInMonth = now.getUTCDate();
  let revenue = 0;
  let monthsWithData = 0;
  for (const p of points) {
    if (!p.month || !p.month.startsWith(String(year))) continue;
    const v = Number(p.revenue);
    if (Number.isFinite(v)) { revenue += v; monthsWithData += 1; }
  }
  const flat = series.monthly_target || 0;
  const target = flat * (monthIdx + (dayInMonth / dim));
  const variance = target > 0 ? ((revenue - target) / target) * 100 : null;
  const gpYtd = grossProfitAmount(revenue, series.gross_profit_pct);
  const monthsElapsed = monthIdx + (dayInMonth / dim);
  const annualisedRevenue = monthsElapsed > 0 ? (revenue / monthsElapsed) * 12 : null;
  return {
    year,
    months_with_data: monthsWithData,
    revenue_gbp: revenue,
    target_prorata_gbp: target,
    target_full_year_gbp: flat * 12,
    variance_pct: variance,
    gross_profit_ytd_gbp: gpYtd,
    run_rate_annual_revenue_gbp: annualisedRevenue == null ? null : Number(annualisedRevenue.toFixed(2)),
    run_rate_annual_gp_gbp: grossProfitAmount(annualisedRevenue || 0, series.gross_profit_pct)
  };
}

// ---------------------------------------------------------------
// Year-to-date summary (Jan -> today of the CURRENT calendar year)
//
// Separate from the rolling 12-month view because the user wants to
// see "am I on track for this financial year (Jan-Dec) so far?".
// Returns:
//   {
//     year,                         // 2026
//     months_complete,              // 0-11 (full months that have ended)
//     days_through_year,            // 1-365 (today's day-of-year)
//     days_in_year,                 // 365 or 366
//     ytd_revenue_gbp,              // sum of revenue for months in current year
//     ytd_target_full_gbp,          // sum of full seasonal targets, Jan..current month
//     ytd_target_prorata_gbp,       // same but prorate current month by days-elapsed
//     variance_pct,                 // (rev - target_prorata) / target_prorata * 100
//     annual_target_gbp,            // full-year target (always £60,556)
//     run_rate_annual_gbp,          // straight-line projection if today's pace holds
//     pace_variance_pct             // run_rate_annual vs annual_target_gbp
//   }
// ---------------------------------------------------------------
function daysInMonth(year, monthIdx) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

function daysInYear(year) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  return isLeap ? 366 : 365;
}

function dayOfYear(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function sumYtdRevenue(history, year) {
  let total = 0;
  for (const row of history || []) {
    if (!row?.period_start) continue;
    if (row.period_start.slice(0, 4) !== String(year)) continue;
    total += Number(row.revenue_amount) || 0;
  }
  return total;
}

// Build the two YTD target totals.
//   - full: sum of seasonal targets Jan..currentMonth (assumes current
//           month finishes at full target). Useful as "end-of-month goal".
//   - prorata: sum of completed months in full, plus current month
//              pro-rated by days-elapsed-in-month. Use this for variance %.
function ytdTargets(year, today) {
  const currentMonthIdx = today.getUTCMonth();
  const dim = daysInMonth(year, currentMonthIdx);
  const dayInMonth = today.getUTCDate();
  const currentMonthTarget = SEASONAL_MONTHLY_TARGETS[currentMonthIdx] || 0;

  let full = 0;
  let prorata = 0;
  for (let i = 0; i < currentMonthIdx; i++) {
    const t = SEASONAL_MONTHLY_TARGETS[i] || 0;
    full += t;
    prorata += t;
  }
  full += currentMonthTarget;
  prorata += currentMonthTarget * (dayInMonth / dim);
  return { full, prorata, currentMonthIdx };
}

function buildYtdSummary(history) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const daysThrough = dayOfYear(now);
  const diy = daysInYear(year);
  const revenue = sumYtdRevenue(history, year);
  const { full, prorata, currentMonthIdx } = ytdTargets(year, now);
  const variancePctVal = prorata > 0 ? ((revenue - prorata) / prorata) * 100 : null;
  const runRateAnnual = daysThrough > 0 ? revenue * (diy / daysThrough) : 0;
  const paceVariancePct = ANNUAL_REVENUE_TARGET > 0
    ? ((runRateAnnual - ANNUAL_REVENUE_TARGET) / ANNUAL_REVENUE_TARGET) * 100
    : null;
  return {
    year,
    months_complete: currentMonthIdx,    // Jan=0, so months fully complete
    current_month_idx: currentMonthIdx,  // current (in-progress) month
    days_through_year: daysThrough,
    days_in_year: diy,
    ytd_revenue_gbp: Math.round(revenue * 100) / 100,
    ytd_target_full_gbp: Math.round(full * 100) / 100,
    ytd_target_prorata_gbp: Math.round(prorata * 100) / 100,
    variance_pct: variancePctVal == null ? null : Math.round(variancePctVal * 10) / 10,
    annual_target_gbp: ANNUAL_REVENUE_TARGET,
    run_rate_annual_gbp: Math.round(runRateAnnual * 100) / 100,
    pace_variance_pct: paceVariancePct == null ? null : Math.round(paceVariancePct * 10) / 10
  };
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
    gross_profit_pct: tier.grossProfitPct ?? null,
    gross_profit_rag: gpRagBucket(tier.grossProfitPct ?? null),
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
  // GP-weighted potential: how much PROFIT (not revenue) is on the table
  // if we capture the 1%-of-clicks "industry baseline" conversion. This
  // is the metric the smart-priorities engine + UI should sort on, not
  // raw revenue, because £1k revenue at 35% GP buys less than £600
  // revenue at 99% GP.
  bucket.gross_profit_potential_28d = bucket.gross_profit_pct != null
    ? Math.round(bucket.revenue_potential_28d * (bucket.gross_profit_pct / 100))
    : null;
  bucket.pages = bucket.pages.slice(0, 5);
  return bucket;
}

// Attach the ACTUAL revenue numbers per tier (from the merged revenue rows).
//   - revenue_actual_28d: from the latest rolling-window snapshot
//   - revenue_actual_12m: sum across all monthly history rows
//   - actual_vs_potential_pct: 28d actual / 28d potential
//   - actual_vs_target_pct: 28d actual / 28d-pro-rated monthly target
function tierRevenueFromRow(row, tierId) {
  const map = row?.tier_revenue;
  if (!map || typeof map !== 'object') return 0;
  return Number(map[tierId]) || 0;
}
function attachActualRevenueToTier(bucket, latestSnap, monthlyHistory) {
  bucket.revenue_actual_28d = Math.round(tierRevenueFromRow(latestSnap, bucket.tier_id) * 100) / 100;
  let twelve = 0;
  for (const row of monthlyHistory || []) twelve += tierRevenueFromRow(row, bucket.tier_id);
  bucket.revenue_actual_12m = Math.round(twelve * 100) / 100;
  const potential = bucket.revenue_potential_28d || 0;
  bucket.actual_vs_potential_pct = potential > 0
    ? Math.round((bucket.revenue_actual_28d / potential) * 1000) / 10
    : null;
  const target28d = (bucket.monthly_target || 0) * (28 / 30);
  bucket.actual_vs_target_28d_pct = target28d > 0
    ? Math.round((bucket.revenue_actual_28d / target28d) * 1000) / 10
    : null;
  bucket.gross_profit_28d = grossProfitAmount(bucket.revenue_actual_28d, bucket.gross_profit_pct);
  bucket.gross_profit_12m = grossProfitAmount(bucket.revenue_actual_12m, bucket.gross_profit_pct);
  return bucket;
}

function pickMoneyPagePerformance(pageRows, aiMap, latestSnap, monthlyHistory) {
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
  return MONEY_PAGE_TIERS.map(t => {
    const bucket = finaliseTierBucket(byTier.get(t.id));
    return attachActualRevenueToTier(bucket, latestSnap, monthlyHistory);
  });
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
    .select('period_start, period_end, revenue_amount, currency, source, transactions, tier_revenue, tier_transactions, notes')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(36);
  if (error) throw error;
  const allRows = data || [];
  const base = pickBestRevenueRow(allRows);
  if (!base) return null;
  // Merge any other rows that cover the EXACT same window (different source).
  const siblings = allRows.filter(r =>
    r !== base && r.period_start === base.period_start && r.period_end === base.period_end
  );
  return mergeRevenueRows(base, siblings);
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
    const revenueHistoryDecorated = decorateHistoryWithTargets(revenueHistory);
    const moneyPagePerformance = pickMoneyPagePerformance(pageRows, aiMap, revenueSnap, revenueHistoryDecorated);
    const kpiTargets = computeKpiTargets(kpis, revenueSnap);
    const tierHistory = buildTierHistory(revenueHistoryDecorated);
    const ytdSummary = buildYtdSummary(revenueHistoryDecorated);
    const profitPyramid = buildProfitPyramid(tierHistory);
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
      ytd_summary: ytdSummary,
      profit_pyramid: profitPyramid,
      tiers: MONEY_PAGE_TIERS.map(t => ({
        id: t.id,
        label: t.label,
        hub_url: t.hubUrl,
        monthly_target: t.monthlyTarget,
        gross_profit_pct: t.grossProfitPct ?? null,
        gross_profit_rag: gpRagBucket(t.grossProfitPct ?? null)
      }))
    });
  } catch (err) {
    return send(res, 500, { error: 'summary_failed', message: err?.message || String(err) });
  }
}
