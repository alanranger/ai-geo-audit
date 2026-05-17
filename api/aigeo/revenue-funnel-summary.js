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

// Path prefixes treated as money/commercial pages.
const MONEY_PAGE_PREFIXES = [
  '/photography-courses',
  '/photography-workshops',
  '/landscape-photography-workshops',
  '/hire-a-professional-photographer',
  '/photography-services',
  '/1-2-1-photography-tuition',
  '/1-2-1-private-photography-tuition',
  '/photography-prints',
  '/print-shop',
  '/photography-products'
];

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
  const p = pathOf(pageUrl);
  if (!p) return false;
  return MONEY_PAGE_PREFIXES.some((prefix) => p.startsWith(prefix));
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
  const path = pathOf(row.best_url || '');
  const isMoney = isMoneyPage(path) || segment === 'money';
  return {
    keyword: row.keyword,
    rank: row.best_rank_group != null ? Number(row.best_rank_group) : null,
    search_volume: Number(row.search_volume) || 0,
    has_ai_overview: overview,
    cited,
    bucket,
    best_url: row.best_url || null,
    segment,
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

// Returns the most recent 12 month-shaped revenue rows (length 25-35 days),
// oldest first, so the UI can render a sparkline + month-over-month deltas.
function isMonthShapedRow(row) {
  const days = daysBetween(row.period_start, row.period_end);
  return days >= 25 && days <= 35;
}

async function fetchRevenueHistory(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, period_end, revenue_amount, currency, source, transactions')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(40);
  if (error) throw error;
  const monthly = (data || []).filter(isMonthShapedRow);
  const dedupedByMonth = new Map();
  for (const row of monthly) {
    const key = row.period_start.slice(0, 7); // YYYY-MM
    if (!dedupedByMonth.has(key)) dedupedByMonth.set(key, row);
  }
  const sorted = Array.from(dedupedByMonth.values())
    .sort((a, b) => a.period_end.localeCompare(b.period_end));
  return sorted.slice(-12);
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
    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      page_metrics_date_end: pageMetrics.dateEnd,
      kpis,
      funnel,
      top_leak_pages: leakPages,
      ai_overview_map: aiMap,
      priorities,
      earning_pages: earningPages,
      latest_revenue: revenueSnap,
      revenue_history: revenueHistory
    });
  } catch (err) {
    return send(res, 500, { error: 'summary_failed', message: err?.message || String(err) });
  }
}
