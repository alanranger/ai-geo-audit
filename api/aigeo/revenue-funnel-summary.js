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
import { readLatestGa4Metrics, ga4AttributedView } from './ga4-data.js';
import { buildTxnCountMap, applyTxnCount, txnWindowFor } from '../../lib/revenue-funnel-txn-counts.js';
import { isRowIndexable, resolvePolicy } from '../../lib/page-indexability-policy.js';
import { parseIncludeJlr } from '../../lib/parse-include-jlr.mjs';
import {
  applyJlrToFunnelWideRow,
  buildJlrByMonth,
  buildJlrTierByMonth
} from '../../lib/revenue-truth-jlr-filter.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

// ----------------------------------------------------------------------
// Money-page tiers
//
// These are the 5 commercial product groups the business actually sells.
// Each tier has:
//   - id          stable key used in API responses + UI filters
//   - label       human-readable
//   - hubUrl      the primary money page the user wants to convert on
//   - prefixes    path prefixes that count as part of this tier (drives the
//                 PAGE-aggregation columns: clicks_28d, impressions_28d,
//                 revenue_actual_28d, page_count etc.)
//   - keywords    CURATED commercial-intent queries that DEFINE the tier
//                 for the keyword-aggregation columns (best_rank,
//                 best_rank_non_brand, ai_keywords_total, total_search_volume,
//                 ai_keywords_uncited). Stored lowercase, matched
//                 case-insensitively against `keyword_rankings.keyword`.
//                 Edit this list when you want to change which queries the
//                 "Best rank" / "Search vol" / "AIO miss" columns score
//                 against. Keep them commercial-intent only (no brand-prefix
//                 variants — those always rank #1 and drown out real gaps).
//   - categories     Booking Sheet category orders the tier's targets come from (Targets panel, lib/targets-master.mjs)
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
    keywords: ['photography courses', 'beginner photography courses'],
    categories: [1]
  },
  {
    // Non-Residential = "2. Workshops Non Residential" in the Booking Sheet
    // = the bigger of the two splits (half-day + one-day workshops).
    id: 'workshops_nonres',
    label: 'Workshops (Non-Res)',
    hubUrl: '/photography-workshops',
    prefixes: ['/photography-workshops', '/landscape-photography-workshops', '/2-5hr-workshops', '/2.5hr-4hr-workshops', '/one-day-workshops', '/workshops-calendar'],
    keywords: ['landscape photography workshops', 'one-day photography workshops'],
    categories: [2]
  },
  {
    // Residential = "3. Workshops Residential" in the Booking Sheet
    // = weekend/multi-day workshops with hotel accommodation included.
    // Slug list is in commercial-tier.js WORKSHOP_RESIDENTIAL_PATHS.
    id: 'workshops_residential',
    label: 'Workshops (Residential)',
    hubUrl: '/photography-workshops-near-me',
    prefixes: ['/photography-workshops-near-me', '/residential-workshops'],
    keywords: ['photography workshops', 'photography workshops near me'],
    categories: [3]
  },
  {
    id: 'services',
    label: '1-2-1 & Services',
    hubUrl: '/photography-tuition-services',
    prefixes: ['/photography-tuition-services', '/photography-services', '/1-2-1-photography-tuition', '/1-2-1-private-photography-tuition', '/photography-lessons-online-1-2-1', '/private-photography-lessons', '/mentoring', '/rps-mentoring', '/gift-vouchers', '/pick-n-mix'],
    keywords: ['private photography lessons', 'private photography lessons online', 'photography gift vouchers'],
    // Mentoring + 1-2-1; Pick n Mix and Gift Voucher in/out lines are adjustments, not GP.
    categories: [6, 7]
  },
  {
    id: 'hire',
    label: 'Hire / Commercial',
    hubUrl: '/hire-a-professional-photographer-in-coventry',
    prefixes: ['/hire-a-professional-photographer', '/products-services-property-photography', '/portrait-photography', '/staff-training-on-photography', '/commercial-photography', '/headshots'],
    keywords: ['photographer in coventry', 'commercial photography coventry', 'professional photographer near me', 'corporate photography training'],
    // Prints & Royalties + Commissions.
    categories: [10, 11]
  },
  {
    id: 'academy',
    label: 'Academy',
    hubUrl: '/free-photography-course',
    prefixes: ['/free-photography-course', '/academy', '/free-online-photography-course', '/online-photography-course'],
    keywords: ['online photography course', 'free online photography course'],
    categories: [12]
  },
  {
    // Safety-net bucket. Anything the classifier can't confidently tier
    // lands here. No categories, so target 0: any value > 0 shows as an over-target red
    // signal on the dashboard - prompts a review and a name-token update
    // in api/aigeo/commercial-tier.js.
    id: 'unidentified',
    label: 'Unidentified (needs review)',
    hubUrl: '',
    prefixes: [],
    keywords: [],
    categories: []
  }
];

// Every target here comes from the Targets panel (Strategy & Actions) via lib/targets-master.mjs,
// set once at the start of each request: per-tier monthly targets, the revenue each month needs for
// survival GP, the funnel KPI targets and the Profit Pyramid band. Tier GP % = Booking Sheet category rates.
import { loadTargetsMaster } from '../../lib/targets-master.mjs';
import { funnelTargetsFrom, windowSurvival } from '../../lib/funnel-targets.mjs';

let FT = null;
const tierTarget = (t) => FT?.tiers?.[t.id]?.monthly_target ?? 0;
const tierGpPct = (t) => FT?.tiers?.[t.id]?.gross_profit_pct ?? null;
const seasonalRevenue = (monthIdx) => FT?.seasonal_revenue?.[monthIdx] || 0;
const annualRevenueTarget = () => FT?.annual_revenue || 0;
/** A tier's seasonal YTD (closed months + this month pro rata) and full-year revenue targets. */
const tierTargetsFor = (tierId) => ({ ytd: FT?.tiers?.[tierId]?.ytd_target || 0, year: FT?.tiers?.[tierId]?.year_target || 0 });
const targetsBlock = () => ({
  seasonal_revenue: FT?.seasonal_revenue || [],
  target_mix_margin: FT?.target_mix_margin ?? null,
  source: FT?.source || null
});
const gpTargets = () => ({ ytd: FT?.gp_ytd || 0, annual: FT?.gp_annual || 0 });

// Industry baselines used for the funnel KPI RAG indicators.
// These were chosen to align with the existing top-leak-page benchmark
// (1.5% CTR target for informational queries) and the user's existing
// money_page_click_share_pct target of ~3pp in the seeded priorities.
const KPI_BASELINES = {
  ctr_28d_pct: { target: 1.5, warn: 1 },              // last 28d CTR
  money_page_click_share_pct: { target: 3, warn: 2 },
  click_to_sale_pct: { target: 0.5, warn: 0.25 },
  enquiry_to_sale_pct: { target: 2, warn: 1 },        // GA4 money-page enquiries → transactions
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

/** Funnel GSC and GA4 windows end on the same date: use the GSC snapshot ending on GA4's end date when one exists. */
async function alignPageMetricsToGa4(supabase, propertyUrl, pageMetrics, ga4Snap) {
  const end = ga4Snap?.date_end;
  if (!end || end === pageMetrics.dateEnd) return pageMetrics;
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, ctr_28d, position_28d, date_end')
    .eq('site_url', propertyUrl)
    .eq('date_end', end)
    .limit(2000);
  if (error || !data?.length) return pageMetrics;
  return { rows: data, dateEnd: end };
}

/** The GA4 28-day snapshot ending on the GSC end date (daily GA4 sync keeps one per day); else the latest. */
async function ga4SnapForEnd(supabase, propertyUrl, ga4Snap, endDate) {
  if (!endDate || ga4Snap?.date_end === endDate) return ga4Snap;
  const { data, error } = await supabase.from('ga4_site_metrics_28d').select('*')
    .eq('property_url', propertyUrl).eq('date_end', endDate).limit(1);
  if (error || !data?.length) return ga4Snap;
  return data[0];
}

/** Small rules table — avoid scanning revenue_gsc_joined_with_policy (LATERAL join timeout). */
async function fetchIndexabilityPolicies(supabase) {
  const { data, error } = await supabase
    .from('page_indexability_policy')
    .select('url_or_prefix, match_type, policy, redirect_target, effective_date, note');
  if (error) throw error;
  return data || [];
}

function buildPolicyBySlug(pageRows, policies) {
  const map = new Map();
  const slugs = new Set();
  for (const row of pageRows || []) {
    const slug = slugFromPageUrl(row.page_url);
    if (slug) slugs.add(slug);
  }
  for (const slug of slugs) {
    const path = slug.startsWith('/') ? slug : `/${slug}`;
    const match = resolvePolicy(path, policies);
    if (!match) continue;
    map.set(slug, {
      policy_value: match.policy ?? null,
      policy_effective_date: match.effective_date ?? null
    });
  }
  return map;
}

function slugFromPageUrl(pageUrl) {
  const p = pathOf(pageUrl);
  if (!p || p === '/') return '';
  return p.replace(/^\/+/, '');
}

function enrichPageRowsWithPolicy(pageRows, policyBySlug, periodStart) {
  return (pageRows || []).map((row) => {
    const slug = slugFromPageUrl(row.page_url);
    const pol = policyBySlug.get(slug) || {};
    return {
      ...row,
      period_start: periodStart,
      policy_value: pol.policy_value ?? null,
      policy_effective_date: pol.policy_effective_date ?? null
    };
  });
}

/**
 * Sales over the same 28 days as the clicks/enquiries the rates divide by.
 * Falls back to the monthly snapshot count only when that aligned window is
 * unavailable, since a month of sales over 28 days of traffic is not a rate.
 */
function saleCount(txns28d, revenueSnap) {
  if (txns28d != null) return Number(txns28d) || 0;
  return revenueSnap ? Number(revenueSnap.transactions) || 0 : 0;
}

function computeKpisCore(pageRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d) {
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
  // audit_results.gsc_ctr is stored as a percentage already (0.31 = 0.31%),
  // on the same basis as pct() above. Do not rescale.
  const ctrPrior = auditPrior ? Number(auditPrior.gsc_ctr) || null : null;
  const ctrLatestAudit = auditLatest ? Number(auditLatest.gsc_ctr) || null : null;
  const revenue = revenueSnap ? Number(revenueSnap.revenue_amount) || 0 : 0;
  const txns = saleCount(txns28d, revenueSnap);
  const revPer1k = totals.impressions > 0 ? (revenue / totals.impressions) * 1000 : null;
  const clickToSale = pct(txns, totals.clicks);
  const moneyEnquiry = ga4View != null ? Number(ga4View.money_page_enquiry_events) : null;
  const enquiryToSale = moneyEnquiry > 0 ? pct(txns, moneyEnquiry) : null;

  return {
    ctr_28d_pct: ctr,
    ctr_prior_pct: ctrPrior,
    // Same-source CTR pair, so the prior comparison can be checked like-for-like
    // against the page-aggregated headline above.
    ctr_latest_audit_pct: ctrLatestAudit,
    money_page_click_share_pct: moneyShare,
    click_to_sale_pct: clickToSale,
    enquiry_to_sale_pct: enquiryToSale,
    revenue_per_1k_impressions: revPer1k,
    revenue_currency: revenueSnap ? revenueSnap.currency : 'GBP',
    total_clicks_28d: totals.clicks,
    total_impressions_28d: totals.impressions,
    total_money_clicks_28d: totals.moneyClicks,
    money_page_enquiry_events_28d: moneyEnquiry,
    site_enquiry_events_28d: ga4View != null ? Number(ga4View.enquiry_events) : null,
    ga4_sessions_28d: ga4View != null ? Number(ga4View.sessions) : null,
    ga4_excluded_sessions_28d: ga4View != null ? Number(ga4View.excluded_sessions) : null,
    transactions_28d: txns,
    audit_date_latest: auditLatest ? auditLatest.audit_date : null,
    audit_date_prior: auditPrior ? auditPrior.audit_date : null
  };
}

function appendIndexableKpis(kpis, pageRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d) {
  const indexableRows = pageRows.filter(isRowIndexable);
  const indexable = computeKpisCore(indexableRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d);
  const out = { ...kpis };
  for (const key of Object.keys(kpis)) out[`${key}_indexable`] = indexable[key];
  return out;
}

function computeKpis(pageRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d) {
  const base = computeKpisCore(pageRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d);
  return appendIndexableKpis(base, pageRows, auditLatest, auditPrior, revenueSnap, ga4View, txns28d);
}

/** Revenue snapshot for the 28-day KPIs: the same 28 days as the search figures when the window is known. */
function windowRevenueSnap(revenueSnap, money28) {
  return money28 ? { ...(revenueSnap || {}), revenue_amount: money28.revenue } : revenueSnap;
}

function funnelRevenue(revenueSnap, money28) {
  if (money28) return money28.revenue;
  return revenueSnap ? Number(revenueSnap.revenue_amount) || 0 : 0;
}

function computeFunnel(kpis, revenueSnap, ga4View, money28 = null) {
  // Six-stage funnel. Industry benchmark targets are conservative defaults;
  // tweak in dashboard if needed.
  const clicks = kpis.total_clicks_28d;
  const impr = kpis.total_impressions_28d;
  const moneyClicks = kpis.total_money_clicks_28d;
  const txns = Number(kpis.transactions_28d) || 0;
  // Revenue booked in the same 28 days as the search and GA4 steps (not the last closed month).
  const revenue = funnelRevenue(revenueSnap, money28);
  const moneyEnquiry = ga4View != null ? Number(ga4View.money_page_enquiry_events) : null;
  const enquiry = moneyEnquiry != null && moneyEnquiry > 0
    ? moneyEnquiry
    : (ga4View != null ? Number(ga4View.enquiry_events) : null);
  return [
    { stage: 'Impressions', value: impr, target_pct_next: 1.5 },
    { stage: 'Clicks', value: clicks, target_pct_next: 25 },
    { stage: 'Money-page clicks', value: moneyClicks, target_pct_next: 8 },
    { stage: 'Add-to-cart / enquiry', value: enquiry, target_pct_next: 35, source: moneyEnquiry > 0 ? 'ga4_money_pages' : 'ga4_site' },
    { stage: 'Transactions', value: txns || null, target_pct_next: null },
    { stage: 'Revenue', value: revenue || null, target_pct_next: null }
  ];
}

/** Extra clicks in 28 days if CTR rose to max(1.5%, 1.6 × today's) — the leak table's "recoverable" basis. */
function recoverableClicks(impr, ctr) {
  return Math.max(0, Math.round((Math.max(0.015, ctr * 1.6) - ctr) * impr));
}

/** "Pages by search traffic" (P5): top 100 pages by clicks, money / info tagged, with recoverable clicks. */
function pickPagesByTraffic(pageRows) {
  return pageRows
    .map((r) => {
      const impr = Number(r.impressions_28d) || 0;
      const ctr = Number(r.ctr_28d) || 0;
      return {
        page_url: r.page_url,
        is_money_page: isMoneyPage(r.page_url),
        impressions_28d: impr,
        clicks_28d: Number(r.clicks_28d) || 0,
        ctr_28d_pct: ctr * 100,
        position_28d: Number(r.position_28d) || null,
        recoverable_clicks_28d: recoverableClicks(impr, ctr)
      };
    })
    .filter((r) => r.impressions_28d > 0)
    .sort((a, b) => b.clicks_28d - a.clicks_28d)
    .slice(0, 100);
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
  const { data: latestRows, error: latestErr } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1);
  if (latestErr) throw latestErr;
  const auditDate = latestRows?.[0]?.audit_date;
  if (!auditDate) return [];
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select('audit_date, keyword, best_rank_group, search_volume, has_ai_overview, ai_alan_citations_count, segment, page_type, best_url')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .limit(600);
  if (error) throw error;
  const out = (data || []).map((row) => classifyAiMapRow(row));
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

// Back-compat: synthesize the legacy `tier_revenue` jsonb shape the UI
// still consumes (per-tier sparklines, money-page performance tiles).
// Phase L1 originally only mapped 4 verbatim categories and nullled hire/
// services — that hid B2B Commissions/Prints and D2C Mentoring/1-2-1 etc.
// Now aggregate all 12 categories via classifyCategory() in booking-sheet-parser.
/**
 * Tier revenue = the sum of each money-page tier's Booking Sheet categories (MONEY_PAGE_TIERS.categories), the same
 * categories the Revenue tab and the Targets panel use. Voucher / Pick n Mix in-out lines (4, 5, 8, 9) stay out.
 */
function synthesiseLegacyTierRevenueFromRow(row) {
  const out = {};
  for (const t of MONEY_PAGE_TIERS) {
    if (!t.categories?.length) continue;
    out[t.id] = 0;
  }
  for (const [label, amount] of Object.entries(row.category_revenue || {})) {
    const tier = MONEY_PAGE_TIERS.find((t) => t.categories?.includes(parseInt(label, 10)));
    if (tier) out[tier.id] += Number(amount) || 0;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Math.round(v * 100) / 100]));
}

function shapeWideViewRow(row, jlrCtx) {
  const shaped = {
    period_start: row.period_start,
    period_end: row.period_end,
    revenue_amount: Number(row.revenue_amount) || 0,
    currency: row.currency,
    source: row.source,
    transactions: row.transactions,
    tier_revenue: synthesiseLegacyTierRevenueFromRow(row),
    tier_transactions: row.tier_transactions,
    operational_revenue: Number(row.operational_revenue) || 0,
    adjustment_net: Number(row.adjustment_net) || 0,
    market_revenue: row.market_revenue || null,
    category_revenue: row.category_revenue || null
  };
  if (!jlrCtx) return shaped;
  return applyJlrToFunnelWideRow(shaped, jlrCtx.jlrByMonth, jlrCtx.jlrTierByMonth);
}

function monthOfTxnIso(iso) {
  return Number(String(iso || '').slice(5, 7));
}

async function fetchBookingTransactions(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('year, txn_date, category_label, amount, is_jlr')
    .eq('property_url', propertyUrl)
    .eq('is_jlr', true)
    .order('txn_date', { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({
    ...r,
    month: monthOfTxnIso(r.txn_date),
    amount: Number(r.amount),
    is_jlr: true
  }));
}

async function buildJlrSubtractCtx(supabase, propertyUrl) {
  const txns = await fetchBookingTransactions(supabase, propertyUrl);
  return {
    jlrByMonth: buildJlrByMonth(txns),
    jlrTierByMonth: buildJlrTierByMonth(txns)
  };
}

// Sale count over the same 28-day window as the GSC/GA4 denominators. A sale is
// amount > 0 and not a voucher redemption offset, matching the monthly view.
async function fetchTxnCountForWindow(supabase, propertyUrl, dateEndIso, includeJlr) {
  const window = txnWindowFor(dateEndIso);
  if (!window) return { count: null, window: null };
  let query = supabase
    .from('booking_sheet_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('property_url', propertyUrl)
    .eq('is_redemption', false)
    .gt('amount', 0)
    .gte('txn_date', window.start)
    .lte('txn_date', window.end);
  if (!includeJlr) query = query.eq('is_jlr', false);
  const { count, error } = await query;
  if (error) throw error;
  return { count: Number(count) || 0, window };
}

/** Revenue and GP (category rates) booked in the KPI window, against survival for exactly those days. */
async function fetchWindowMoney(supabase, propertyUrl, window, includeJlr) {
  if (!window) return null;
  let query = supabase.from('booking_sheet_transactions').select('amount, category_order')
    .eq('property_url', propertyUrl).eq('is_redemption', false)
    .gte('txn_date', window.start).lte('txn_date', window.end).limit(5000);
  if (!includeJlr) query = query.eq('is_jlr', false);
  const { data, error } = await query;
  if (error) throw error;
  const rates = FT?.gp_rates || {};
  const revenue = (data || []).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const gp = (data || []).reduce((a, r) => a + (Number(r.amount) || 0) * (rates[r.category_order] || 0), 0);
  const target = windowSurvival(FT, window.start, window.end);
  return {
    start: window.start, end: window.end, revenue: Math.round(revenue), gp: Math.round(gp),
    target_revenue: target.revenue, target_gp: target.gp, rag: revenueRagFor(gp, target.gp)
  };
}

async function fetchMonthlyTxnCounts(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_monthly_txn_counts')
    .select('period_start, transactions_all, transactions_nonjlr, transactions_jlr, redemptions_excluded')
    .eq('property_url', propertyUrl);
  if (error) throw error;
  return buildTxnCountMap(data || []);
}

const BOOKING_WIDE_SELECT = 'period_start, period_end, revenue_amount, currency, source, transactions, tier_transactions, operational_revenue, adjustment_net, market_revenue, category_revenue, notes';

async function fetchBookingSheetWideRows(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('booking_sheet_monthly_wide')
    .select(BOOKING_WIDE_SELECT)
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(120);
  if (error) throw error;
  return data || [];
}

function buildRevenueSnapsFromShaped(allShaped) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const tierSnap = mergeRevenuePick(allShaped, pickLatestBookingMonthRow(allShaped));
  const kpiSnap = mergeRevenuePick(allShaped, pickBestRevenueRow(allShaped));
  if (tierSnap) tierSnap.is_partial = tierSnap.period_end > todayIso;
  if (kpiSnap) kpiSnap.is_partial = kpiSnap.period_end > todayIso;
  return { kpiSnap, tierSnap };
}

function buildRevenueHistoryFromShaped(allShaped) {
  const monthly = allShaped.filter(isCalendarMonthRow);
  const merged = mergeRowsByMonth(monthly);
  return merged.toSorted((a, b) => a.period_end.localeCompare(b.period_end)).slice(-12);
}

async function fetchBookingSheetBundle(supabase, propertyUrl, includeJlr) {
  const [jlrCtx, wideRows, txnCounts] = await Promise.all([
    includeJlr ? Promise.resolve(null) : buildJlrSubtractCtx(supabase, propertyUrl),
    fetchBookingSheetWideRows(supabase, propertyUrl),
    fetchMonthlyTxnCounts(supabase, propertyUrl)
  ]);
  const allShaped = wideRows.map((r) => ({
    ...applyTxnCount(shapeWideViewRow(r, jlrCtx), txnCounts, includeJlr),
    notes: r.notes
  }));
  return {
    revenueSnaps: buildRevenueSnapsFromShaped(allShaped),
    revenueHistory: buildRevenueHistoryFromShaped(allShaped)
  };
}

function targetForMonth(periodStart) {
  const monthIdx = Number(periodStart.slice(5, 7)) - 1;
  return seasonalRevenue(monthIdx) || null;
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
// The `revenue` value comes from the back-compat `tier_revenue` jsonb
// synthesised by `synthesiseLegacyTierRevenue` from `booking_sheet_monthly_wide`
// (4 valid 1-to-1 mappings: courses, workshops_nonres, workshops_residential,
// academy; services + hire = null). Falls back to null where the synthesis is
// null (UI shows "no data" for that point). Will be removed when the UI is
// rebuilt to consume `category_revenue` and `market_revenue` directly.
function emptyTierSeries() {
  return MONEY_PAGE_TIERS.map(t => ({
    tier_id: t.id,
    tier_label: t.label,
    monthly_target: tierTarget(t),
    gross_profit_pct: tierGpPct(t),
    gross_profit_rag: gpRagBucket(tierGpPct(t)),
    points: []
  }));
}

function tierMapOf(row) {
  if (row.tier_revenue && typeof row.tier_revenue === 'object') return row.tier_revenue;
  return null;
}

/** This month's GP margin for a tier: its categories' revenue × each category's GP rate (the one GP method). */
function tierMonthMargin(row, tierId) {
  const cats = MONEY_PAGE_TIERS.find((t) => t.id === tierId)?.categories || [];
  const rates = FT?.gp_rates || {};
  let rev = 0;
  let gp = 0;
  for (const [label, amount] of Object.entries(row?.category_revenue || {})) {
    const order = parseInt(label, 10);
    if (!cats.includes(order)) continue;
    rev += Number(amount) || 0;
    gp += (Number(amount) || 0) * (rates[order] || 0);
  }
  return rev > 0 ? gp / rev : (tierGpPct({ id: tierId }) || 0) / 100;
}

function tierPoint(row, tierMap, series) {
  const revenue = tierMap ? Number(tierMap[series.tier_id]) : null;
  const isNum = Number.isFinite(revenue);
  return {
    month: row.period_start.slice(0, 7),
    revenue: isNum ? revenue : null,
    gp: isNum ? revenue * tierMonthMargin(row, series.tier_id) : null,
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
  const t = pyramidTargets();
  const fc = yearForecast(tierHistory, new Date());
  const fcGp = fc.gp ?? totalAnnualGp;
  const fcRev = fc.revenue ?? totalAnnualRev;
  return {
    ...t,
    rows,
    annualised_gp_total_gbp: Number(fcGp.toFixed(2)),
    annualised_revenue_total_gbp: Number(fcRev.toFixed(2)),
    forecast_basis: fc.basis,
    ytd_gp_total_gbp: Number(totalYtdGp.toFixed(2)),
    ytd_revenue_total_gbp: Number(totalYtdRev.toFixed(2)),
    projected_remainder_gp_gbp: Number(Math.max(0, fcGp - totalYtdGp).toFixed(2)),
    projected_remainder_revenue_gbp: Number(Math.max(0, fcRev - totalYtdRev).toFixed(2)),
    gp_gap_to_min_annual_gbp: Number(Math.max(0, t.annual_gp_target_low_gbp - fcGp).toFixed(2)),
    revenue_gap_to_min_annual_gbp: Number(Math.max(0, t.annual_revenue_target_low_gbp - fcRev).toFixed(2)),
    profit_goal_progress_pct: Number(((fcGp / t.annual_gp_target_low_gbp) * 100).toFixed(1))
  };
}

/**
 * The Revenue tab's one forecast method: closed months this year + this month at its daily pace + the trailing
 * 3-closed-month average for each month left. Summed over the money-page tiers (Unidentified excluded).
 */
function yearForecast(tierHistory, now) {
  const year = now.getUTCFullYear();
  const cur = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const byMonth = new Map();
  for (const s of tierHistory || []) {
    if (s.tier_id === 'unidentified') continue;
    for (const p of s.points || []) {
      const m = byMonth.get(p.month) || { gp: 0, revenue: 0 };
      m.gp += Number(p.gp) || 0;
      m.revenue += Number(p.revenue) || 0;
      byMonth.set(p.month, m);
    }
  }
  const closed = [...byMonth.keys()].filter((k) => k < cur).sort();
  if (closed.length < 3 || !byMonth.has(cur)) return { gp: null, revenue: null, basis: 'tier run-rate (not enough months for the forecast)' };
  const dim = new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = (dim / Math.max(1, now.getUTCDate()));
  const left = 11 - now.getUTCMonth();
  const sum = (key, list) => list.reduce((a, k) => a + byMonth.get(k)[key], 0);
  const t3 = closed.slice(-3);
  const one = (key) => sum(key, closed.filter((k) => k.startsWith(String(year)))) + byMonth.get(cur)[key] * pace + (sum(key, t3) / 3) * left;
  return { gp: one('gp'), revenue: one('revenue'), basis: 'closed months + this month at its daily pace + trailing 3-closed-month average for each month left (same as Revenue)' };
}

/**
 * Monthly band = this month's seasonal survival → stretch 2 (Targets panel); yearly band = full-year targets;
 * revenue = the turnover that delivers it at the Booking Sheet target category mix; flat panel value = bills line.
 */
function pyramidTargets() {
  const b = FT?.pyramid || {};
  const n = (v) => v || 0;
  return {
    bills_line_gp_monthly_gbp: n(b.bills_line_gp_monthly),
    bills_line_revenue_monthly_gbp: n(b.bills_line_revenue_monthly),
    monthly_gp_target_low_gbp: n(b.gp_low_monthly),
    monthly_gp_target_high_gbp: n(b.gp_high_monthly),
    annual_gp_target_low_gbp: n(b.gp_low_annual),
    annual_gp_target_high_gbp: n(b.gp_high_annual),
    monthly_revenue_target_low_gbp: n(b.revenue_low_monthly),
    monthly_revenue_target_high_gbp: n(b.revenue_high_monthly),
    annual_revenue_target_low_gbp: n(b.revenue_low_annual),
    annual_revenue_target_high_gbp: n(b.revenue_high_annual)
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
  const ytdPoints = points.filter((p) => p.month && p.month.startsWith(String(year)) && Number.isFinite(Number(p.revenue)));
  const revenue = ytdPoints.reduce((a, p) => a + Number(p.revenue), 0);
  const monthsWithData = ytdPoints.length;
  const tt = tierTargetsFor(series.tier_id);
  const target = tt.ytd;
  const variance = target > 0 ? ((revenue - target) / target) * 100 : null;
  const gpYtd = Number(ytdPoints.reduce((a, p) => a + (Number(p.gp) || 0), 0).toFixed(2));
  const monthsElapsed = monthIdx + (dayInMonth / dim);
  const annualisedRevenue = monthsElapsed > 0 ? (revenue / monthsElapsed) * 12 : null;
  return {
    year,
    months_with_data: monthsWithData,
    revenue_gbp: revenue,
    target_prorata_gbp: target,
    target_full_year_gbp: tt.year,
    variance_pct: variance,
    gross_profit_ytd_gbp: gpYtd,
    run_rate_annual_revenue_gbp: annualisedRevenue == null ? null : Number(annualisedRevenue.toFixed(2)),
    run_rate_annual_gp_gbp: revenue > 0 ? Number(((annualisedRevenue || 0) * (gpYtd / revenue)).toFixed(2)) : 0
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
    // D2C + B2B: the voucher / Pick n Mix timing line (adjustment_net) is not revenue for the year (as Revenue tab).
    total += (Number(row.revenue_amount) || 0) - (Number(row.adjustment_net) || 0);
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
  const currentMonthTarget = seasonalRevenue(currentMonthIdx);

  let full = 0;
  let prorata = 0;
  for (let i = 0; i < currentMonthIdx; i++) {
    const t = seasonalRevenue(i);
    full += t;
    prorata += t;
  }
  full += currentMonthTarget;
  prorata += currentMonthTarget * (dayInMonth / dim);
  return { full, prorata, currentMonthIdx };
}

/** The year projection on the Profit Goal bars = the one forecast method (same as Revenue), not a straight line. */
function alignYtdPace(ytd, pyramid) {
  const fc = Number(pyramid?.annualised_revenue_total_gbp);
  if (!ytd || !Number.isFinite(fc) || !pyramid.forecast_basis?.startsWith('closed months')) return;
  ytd.run_rate_annual_gbp = Math.round(fc * 100) / 100;
  ytd.pace_variance_pct = ytd.annual_target_gbp ? Math.round(((fc - ytd.annual_target_gbp) / ytd.annual_target_gbp) * 1000) / 10 : null;
  ytd.run_rate_basis = pyramid.forecast_basis;
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
  const annualTarget = annualRevenueTarget();
  const paceVariancePct = annualTarget > 0
    ? ((runRateAnnual - annualTarget) / annualTarget) * 100
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
    annual_target_gbp: annualTarget,
    gp_ytd_target_gbp: gpTargets().ytd,
    gp_annual_target_gbp: gpTargets().annual,
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
    monthly_target: tierTarget(tier),
    gross_profit_pct: tierGpPct(tier),
    gross_profit_rag: gpRagBucket(tierGpPct(tier)),
    pages: [],
    clicks_28d: 0,
    impressions_28d: 0,
    // Legacy: MIN rank across ALL curated tier keywords (brand included).
    // Kept for back-compat — UI now prefers best_rank_non_brand.
    best_rank: null,
    // MIN rank across NON-brand curated tier keywords. With the curated list
    // approach (added 2026-05-20 v2), brand variants are excluded by curation
    // rather than by string filter, so best_rank === best_rank_non_brand in
    // practice — but the brand-exclusion safety net is kept just in case.
    best_rank_non_brand: null,
    best_rank_keyword: null,
    tier_keyword_ranks: [],
    median_rank: null,
    total_search_volume: 0,
    ai_keywords_total: 0,
    ai_keywords_cited: 0,
    ai_keywords_uncited: 0,
    // NEW (2026-05-20 v2): how many of the tier's curated keywords are
    // actually in keyword_rankings. Surfaces tracking gaps in the tooltip.
    curated_keywords_total: 0,
    curated_keywords_missing: [],
    curated_keywords_not_ranking: []
  };
}

// A keyword counts as "brand" if it mentions Alan Ranger. Brand-prefixed head
// terms reliably hit #1 and drag the tier's MIN rank to 1, which makes the
// money-pages table useless for spotting real commercial-intent gaps.
function isBrandKeyword(keyword) {
  if (!keyword) return false;
  const k = String(keyword).toLowerCase();
  return k.includes('alan ranger') || k.includes('alanranger');
}

function medianOf(arr) {
  if (!arr || !arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
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
  if (r == null) {
    bucket.curated_keywords_not_ranking.push(kw.keyword);
    return;
  }
  bucket.tier_keyword_ranks.push(r);
  if (bucket.best_rank == null || r < bucket.best_rank) {
    bucket.best_rank = r;
  }
  if (!isBrandKeyword(kw.keyword)) {
    if (bucket.best_rank_non_brand == null || r < bucket.best_rank_non_brand) {
      bucket.best_rank_non_brand = r;
      bucket.best_rank_keyword = kw.keyword;
    }
  }
}

function finaliseTierBucket(bucket) {
  bucket.pages.sort((a, b) => b.clicks_28d - a.clicks_28d);
  bucket.top_page = bucket.pages[0] || null;
  bucket.page_count = bucket.pages.length;
  bucket.median_rank = medianOf(bucket.tier_keyword_ranks);
  delete bucket.tier_keyword_ranks;
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

// Build a case-insensitive {keyword -> aiMap row} index so curated-keyword
// matching is one hash lookup per query, not a linear scan.
function indexAiMapByKeyword(aiMap) {
  const byName = new Map();
  for (const kw of (aiMap || [])) {
    if (kw && kw.keyword) {
      const key = String(kw.keyword).toLowerCase();
      if (!byName.has(key)) byName.set(key, kw);
    }
  }
  return byName;
}

// For each tier, walk its curated keyword list and accumulate the matching
// aiMap row. Curated-but-not-found queries get pushed onto
// curated_keywords_missing so the UI tooltip can prompt the user to add
// them to keyword_rankings.
function accumulateCuratedKeywords(bucket, tier, kwByName) {
  const curated = tier.keywords || [];
  bucket.curated_keywords_total = curated.length;
  for (const name of curated) {
    const kw = kwByName.get(String(name).toLowerCase());
    if (kw) accumulateKeywordIntoBucket(bucket, kw);
    else bucket.curated_keywords_missing.push(name);
  }
}

function pickMoneyPagePerformance(pageRows, aiMap, latestSnap, monthlyHistory) {
  const byTier = new Map();
  for (const tier of MONEY_PAGE_TIERS) byTier.set(tier.id, initTierBucket(tier));
  // PAGE aggregation by URL prefix (drives clicks/impr/revenue columns).
  for (const row of (pageRows || [])) {
    const tierId = tierOf(row.page_url);
    if (tierId) accumulatePageIntoBucket(byTier.get(tierId), row);
  }
  // KEYWORD aggregation by curated list (drives best rank / SV / AIO miss).
  // Previous URL-prefix-based keyword bucketing produced a misleading
  // "#1 everywhere" column because brand-prefixed head terms drowned out
  // the commercial-intent gaps — see CHANGELOG 2026-05-20 v1.
  const kwByName = indexAiMapByKeyword(aiMap);
  for (const tier of MONEY_PAGE_TIERS) {
    accumulateCuratedKeywords(byTier.get(tier.id), tier, kwByName);
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

/** A funnel KPI's target from the Targets panel; amber starts at the same fraction of target as before. */
function kpiBaseline(key) {
  const base = KPI_BASELINES[key];
  const target = Number(FT?.kpi?.[key] ?? base.target);
  return { target, warn: target * (base.warn / base.target) };
}

function kpiTile(kpis, key) {
  const b = kpiBaseline(key);
  return { value: kpis[key], target: b.target, rag: ragFor(kpis[key], b) };
}

function computeKpiTargets(kpis, revenueSnap) {
  // The 28-day revenue target: the revenue survival GP needs for the year (Targets panel), sliced to 28 days.
  const annual = annualRevenueTarget();
  const annual28d = annual * (28 / 365);
  const revenueActual = (revenueSnap && Number(revenueSnap.revenue_amount)) || 0;
  const revenueRag = revenueRagFor(revenueActual, annual28d);
  return {
    annual_target: annual,
    rolling_28d_target: Math.round(annual28d),
    rolling_28d_actual: Math.round(revenueActual),
    rolling_28d_rag: revenueRag,
    ctr_28d_pct: kpiTile(kpis, 'ctr_28d_pct'),
    money_page_click_share_pct: kpiTile(kpis, 'money_page_click_share_pct'),
    click_to_sale_pct: kpiTile(kpis, 'click_to_sale_pct'),
    enquiry_to_sale_pct: kpiTile(kpis, 'enquiry_to_sale_pct'),
    revenue_per_1k_impressions: kpiTile(kpis, 'revenue_per_1k_impressions')
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

// Money-page tier actuals: use the latest Booking Sheet month Alan is editing,
// including the in-progress calendar month (partial). Closed-month-only pickers
// hide June commissions/workshops while May can be a sparse voucher-timing month.
function pickLatestBookingMonthRow(rows) {
  if (!rows.length) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const eligible = rows.filter((r) => r.period_start <= todayIso);
  const pool = eligible.length ? eligible : rows;
  return pool.toSorted((a, b) => b.period_start.localeCompare(a.period_start))[0];
}

function mergeRevenuePick(allShaped, base) {
  if (!base) return null;
  const siblings = allShaped.filter((r) =>
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
  const includeJlr = parseIncludeJlr(req.query?.includeJlr);
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    FT = funnelTargetsFrom(await loadTargetsMaster(supabase, propertyUrl), MONEY_PAGE_TIERS);
    const [audits, rawPageMetrics, bookingBundle, aiMap, priorities, rawGa4Snap, policies] = await Promise.all([
      fetchLatestAudit(supabase, propertyUrl),
      fetchPageMetrics(supabase, propertyUrl),
      fetchBookingSheetBundle(supabase, propertyUrl, includeJlr),
      fetchAiOverviewMap(supabase, propertyUrl),
      fetchPrioritiesWithCycle(supabase, propertyUrl),
      readLatestGa4Metrics(supabase, propertyUrl),
      fetchIndexabilityPolicies(supabase)
    ]);
    const revenueSnaps = bookingBundle.revenueSnaps;
    const revenueHistory = bookingBundle.revenueHistory;
    const revenueSnap = revenueSnaps.kpiSnap;
    const tierRevenueSnap = revenueSnaps.tierSnap;
    const pageMetrics = await alignPageMetricsToGa4(supabase, propertyUrl, rawPageMetrics, rawGa4Snap);
    const ga4Snap = await ga4SnapForEnd(supabase, propertyUrl, rawGa4Snap, pageMetrics.dateEnd);
    const pageRows = pageMetrics.rows;
    const periodStart = pageMetrics.dateEnd ? `${String(pageMetrics.dateEnd).slice(0, 7)}-01` : null;
    const policyBySlug = buildPolicyBySlug(pageRows, policies);
    const enrichedPageRows = enrichPageRowsWithPolicy(pageRows, policyBySlug, periodStart);
    const auditLatest = audits[0] || null;
    const auditPrior = audits[1] || null;
    const ga4View = ga4AttributedView(ga4Snap);
    const txn28 = await fetchTxnCountForWindow(supabase, propertyUrl, pageMetrics.dateEnd, includeJlr);
    const money28 = await fetchWindowMoney(supabase, propertyUrl, txn28.window, includeJlr);
    const kpis = computeKpis(enrichedPageRows, auditLatest, auditPrior, windowRevenueSnap(revenueSnap, money28), ga4View, txn28.count);
    const funnel = computeFunnel(kpis, revenueSnap, ga4View, money28);
    const leakPages = pickLeakPages(pageRows);
    const earningPages = pickEarningPages(pageRows);
    const revenueHistoryDecorated = decorateHistoryWithTargets(revenueHistory);
    const moneyPagePerformance = pickMoneyPagePerformance(pageRows, aiMap, tierRevenueSnap, revenueHistoryDecorated);
    const kpiTargets = computeKpiTargets(kpis, revenueSnap);
    const tierHistory = buildTierHistory(revenueHistoryDecorated);
    const ytdSummary = buildYtdSummary(revenueHistoryDecorated);
    const profitPyramid = buildProfitPyramid(tierHistory);
    alignYtdPace(ytdSummary, profitPyramid);
    return send(res, 200, {
      property_url: propertyUrl,
      include_jlr: includeJlr,
      generated_at: new Date().toISOString(),
      page_metrics_date_end: pageMetrics.dateEnd,
      transactions_window: txn28.window
        ? { ...txn28.window, transactions: txn28.count, include_jlr: includeJlr }
        : null,
      ga4_metrics_date_end: ga4Snap?.date_end || null,
      ga4_metrics_captured_at: ga4Snap?.captured_at || null,
      ga4_metrics: ga4View ? {
        date_start: ga4Snap.date_start,
        date_end: ga4Snap.date_end,
        // Bot-excluded figures. Automated Unassigned traffic is ~73% of raw
        // sessions, so the raw numbers are kept alongside for auditability only.
        sessions_28d: ga4View.sessions,
        page_views_28d: ga4View.page_views,
        enquiry_events_28d: ga4View.enquiry_events,
        money_page_enquiry_events_28d: ga4View.money_page_enquiry_events,
        bot_excluded: ga4View.bot_excluded,
        excluded_sessions_28d: ga4View.excluded_sessions,
        excluded_page_views_28d: ga4View.excluded_page_views,
        excluded_enquiry_events_28d: ga4View.excluded_enquiry_events,
        raw_sessions_28d: ga4View.raw_sessions,
        raw_page_views_28d: ga4View.raw_page_views,
        top_events: Object.entries(ga4View.event_counts || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([eventName, count]) => ({ eventName, count: Number(count) || 0 }))
      } : null,
      kpis,
      rows_total_count: enrichedPageRows.length,
      rows_indexable_count: enrichedPageRows.filter(isRowIndexable).length,
      kpi_targets: kpiTargets,
      funnel,
      top_leak_pages: leakPages,
      ai_overview_map: aiMap,
      priorities,
      earning_pages: earningPages,
      pages_by_traffic: pickPagesByTraffic(pageRows),
      money_28d: money28,
      money_page_performance: moneyPagePerformance,
      latest_revenue: tierRevenueSnap,
      kpi_revenue_snap: revenueSnap,
      revenue_history: revenueHistoryDecorated,
      tier_history: tierHistory,
      ytd_summary: ytdSummary,
      profit_pyramid: profitPyramid,
      tiers: MONEY_PAGE_TIERS.map(t => ({
        id: t.id,
        label: t.label,
        hub_url: t.hubUrl,
        monthly_target: tierTarget(t),
        gross_profit_pct: tierGpPct(t),
        gross_profit_rag: gpRagBucket(tierGpPct(t))
      })),
      targets: targetsBlock()
    });
  } catch (err) {
    return send(res, 500, { error: 'summary_failed', message: err?.message || String(err) });
  }
}
