/**
 * Build CEO weekly metrics blob (READ-ONLY on dashboard tables).
 */
import { DEFAULT_TIER_BANDS } from '../revenue-truth-ui-core.mjs';
import { DEFAULT_PROPERTY, fmtGbp, fmtNum, deltaArrow, addDaysYmd } from './shared.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function appBase() {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

async function loadPriorSnapshot(supabase, weekStart) {
  const priorWeek = addDaysYmd(weekStart, -7);
  const { data } = await supabase
    .from('ceo_weekly_report_snapshots')
    .select('week_start, metrics')
    .eq('week_start', priorWeek)
    .maybeSingle();
  return data || null;
}

async function sectionRevenueTruth(propertyUrl, prior) {
  // Mirror the Revenue Truth tab: same endpoint the dashboard calls.
  const url = `${appBase()}/api/aigeo/revenue-truth-summary?propertyUrl=${encodeURIComponent(propertyUrl)}&includeJlr=0`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`revenue_truth_summary_${res.status}:${json?.error || 'fail'}`);
  const pulse = json.currentMonthPulse || {};
  const defcon = pulse.defcon || {};
  const mtd = num(pulse.booked_nonjlr_so_far);
  const survival = DEFAULT_TIER_BANDS.survival;
  const priorMtd = prior?.metrics?.revenue_truth?.mtd;
  return {
    mtd,
    survival,
    gap_vs_survival: mtd == null ? null : mtd - survival,
    defcon_level: defcon.level ?? null,
    defcon_status: defcon.status ?? null,
    projected_month_end: num(defcon.projected_month_end),
    miss_vs_survival_gbp: num(defcon.miss_vs_survival_gbp),
    wow: deltaArrow(mtd, priorMtd),
    source: 'GET /api/aigeo/revenue-truth-summary (currentMonthPulse)'
  };
}

async function sectionRevenueByLine(supabase, prior) {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const { data: rows } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_order, category_label, revenue_amount, year, month')
    .eq('year', y)
    .eq('month', m)
    .order('category_order', { ascending: true });
  const lines = (rows || []).map((r) => {
    const amount = num(r.revenue_amount) || 0;
    const prevAmt = prior?.metrics?.revenue_by_line?.lines?.find(
      (x) => x.category_label === r.category_label
    )?.amount;
    return {
      category_order: r.category_order,
      category_label: r.category_label,
      amount,
      wow: deltaArrow(amount, prevAmt)
    };
  });
  const total = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const priorTotal = prior?.metrics?.revenue_by_line?.total;
  return { year: y, month: m, lines, total, wow: deltaArrow(total, priorTotal) };
}

async function sectionFunnel(supabase, propertyUrl, prior) {
  const { data } = await supabase
    .from('ga4_site_metrics_28d')
    .select('*')
    .eq('property_url', propertyUrl)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sessions = num(data?.attributed_sessions_28d ?? data?.sessions_28d);
  const pageViews = num(data?.attributed_page_views_28d ?? data?.page_views_28d);
  const enquiries = num(data?.attributed_enquiry_events_28d ?? data?.enquiry_events_28d);
  const moneyEnquiries = num(data?.money_page_enquiry_events_28d);
  const moneyConv = sessions && moneyEnquiries != null
    ? (moneyEnquiries / sessions) * 100
    : null;
  const p = prior?.metrics?.funnel || {};
  return {
    sessions_28d: sessions,
    page_views_28d: pageViews,
    enquiries_28d: enquiries,
    money_page_enquiries_28d: moneyEnquiries,
    money_conversion_pct: moneyConv,
    note: 'Unassigned GA4 channel excluded (attributed_* preferred)',
    wow: {
      sessions: deltaArrow(sessions, p.sessions_28d),
      page_views: deltaArrow(pageViews, p.page_views_28d),
      enquiries: deltaArrow(enquiries, p.enquiries_28d),
      money_enquiries: deltaArrow(moneyEnquiries, p.money_page_enquiries_28d)
    }
  };
}

async function sectionRankings(supabase, propertyUrl, prior) {
  const { data: rows } = await supabase
    .from('keyword_rankings')
    .select('best_rank_group, keyword')
    .eq('property_url', propertyUrl)
    .limit(5000);
  const buckets = { b1: 0, b2_3: 0, b4_10: 0, b11_20: 0, b21: 0, unranked: 0 };
  let tracked = 0;
  for (const r of rows || []) {
    tracked += 1;
    const p = num(r.best_rank_group);
    if (p == null) buckets.unranked += 1;
    else if (p <= 1) buckets.b1 += 1;
    else if (p <= 3) buckets.b2_3 += 1;
    else if (p <= 10) buckets.b4_10 += 1;
    else if (p <= 20) buckets.b11_20 += 1;
    else buckets.b21 += 1;
  }
  const page1 = buckets.b1 + buckets.b2_3 + buckets.b4_10;
  const { data: audit } = await supabase
    .from('audit_results')
    .select('gsc_clicks, gsc_avg_position, audit_date')
    .ilike('property_url', `%alanranger.com%`)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    buckets,
    page1,
    tracked,
    site_clicks: num(audit?.gsc_clicks),
    site_avg_position: num(audit?.gsc_avg_position),
    movers: { status: 'from_next_monday', up: [], down: [] },
    wow: {
      page1: deltaArrow(page1, prior?.metrics?.rankings?.page1),
      site_clicks: deltaArrow(num(audit?.gsc_clicks), prior?.metrics?.rankings?.site_clicks)
    }
  };
}

async function sectionBacklinks(supabase, prior) {
  const { data: cache } = await supabase
    .from('dfs_backlink_summary_cache')
    .select('rank, backlinks, referring_domains, backlinks_spam_score, crawled_pages, updated_at')
    .eq('domain_host', 'alanranger.com')
    .maybeSingle();
  const { data: hist } = await supabase
    .from('domain_rank_history')
    .select('rank, referring_domains, backlinks, created_at')
    .eq('domain', 'alanranger.com')
    .order('created_at', { ascending: false })
    .limit(8);
  const weeklyPoints = (hist || []).length;
  return {
    rank: num(cache?.rank),
    backlinks: num(cache?.backlinks),
    referring_domains: num(cache?.referring_domains),
    spam_score: num(cache?.backlinks_spam_score),
    crawled_pages: num(cache?.crawled_pages),
    new_lost_domains: weeklyPoints >= 2
      ? { status: 'ready', note: 'diff last two weekly history points on next cadence' }
      : { status: 'from_next_monday', note: 'needs ≥2 weekly domain_rank_history points' },
    wow: {
      referring_domains: deltaArrow(
        num(cache?.referring_domains),
        prior?.metrics?.backlinks?.referring_domains
      ),
      backlinks: deltaArrow(num(cache?.backlinks), prior?.metrics?.backlinks?.backlinks)
    }
  };
}

async function sectionOptimisation(supabase, prior) {
  const { data: tasks } = await supabase
    .from('optimisation_tasks')
    .select('id, status, updated_at, created_at')
    .limit(2000);
  const byStatus = {};
  let shippedWeek = 0;
  const weekAgo = Date.now() - 7 * 86400000;
  for (const t of tasks || []) {
    const s = String(t.status || 'unknown').toLowerCase();
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (s === 'done' || s === 'shipped' || s === 'complete') {
      const u = t.updated_at ? Date.parse(t.updated_at) : 0;
      if (u >= weekAgo) shippedWeek += 1;
    }
  }
  const { data: prios } = await supabase
    .from('revenue_funnel_priorities')
    .select('id, title, status, estimated_lift, sort_order, description')
    .not('status', 'in', '(done,cancelled)')
    .order('sort_order', { ascending: true })
    .limit(5);
  const { data: llm } = await supabase
    .from('llm_visibility_snapshots')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    tasks_by_status: byStatus,
    shipped_this_week: shippedWeek,
    top_actions: (prios || []).map((p) => ({
      title: p.title,
      status: p.status,
      estimated_lift: p.estimated_lift,
      note: '£/mo profit numeric lives on smart-priorities candidates; list uses curated estimated_lift text'
    })),
    ai_summary: llm || null,
    wow: {
      shipped: deltaArrow(shippedWeek, prior?.metrics?.optimisation?.shipped_this_week)
    }
  };
}

function buildNarrative(metrics) {
  const good = [];
  const bad = [];
  const rt = metrics.revenue_truth || {};
  if (rt.mtd != null && rt.mtd >= rt.survival) {
    good.push(`MTD ${fmtGbp(rt.mtd)} is at/above survival (${fmtGbp(rt.survival)}).`);
  } else if (rt.mtd != null) {
    bad.push(`MTD ${fmtGbp(rt.mtd)} is ${fmtGbp(Math.abs(rt.gap_vs_survival || 0))} below survival ${fmtGbp(rt.survival)}.`);
  }
  if (rt.defcon_level != null && rt.defcon_level >= 3) {
    bad.push(`DEFCON ${rt.defcon_level} (${rt.defcon_status || 'active'}).`);
  } else if (rt.defcon_level === 1) {
    good.push('DEFCON 1 — projected month-end clears survival.');
  }
  const fun = metrics.funnel || {};
  if (fun.money_conversion_pct != null && fun.money_conversion_pct < 1) {
    bad.push(`Money-page conversion ${fun.money_conversion_pct.toFixed(2)}% — funnel leak watch.`);
  }
  const bl = metrics.backlinks || {};
  if (bl.referring_domains != null) {
    good.push(`Referring domains ${fmtNum(bl.referring_domains)} (DFS cache).`);
  }
  return { good_points: good, bad_points: bad };
}

export async function buildCeoWeeklyMetrics(supabase, opts = {}) {
  const propertyUrl = opts.propertyUrl || DEFAULT_PROPERTY;
  const weekStart = opts.weekStart;
  const prior = await loadPriorSnapshot(supabase, weekStart);

  const revenue_truth = await sectionRevenueTruth(propertyUrl, prior);
  const revenue_by_line = await sectionRevenueByLine(supabase, prior);
  const funnel = await sectionFunnel(supabase, propertyUrl, prior);
  const rankings = await sectionRankings(supabase, propertyUrl, prior);
  const backlinks = await sectionBacklinks(supabase, prior);
  const optimisation = await sectionOptimisation(supabase, prior);

  const metrics = {
    week_start: weekStart,
    prior_week_start: prior?.week_start || addDaysYmd(weekStart, -7),
    has_prior_snapshot: !!prior,
    property_url: propertyUrl,
    revenue_truth,
    revenue_by_line,
    funnel,
    rankings,
    backlinks,
    optimisation,
    definitions: {
      money_pages: 'pages_master / moneyRoleForUrl: headline = money_role commercial (landing segment maps to commercial). Not commercial+landing IN list.',
      revenue_lines: 'booking_sheet_monthly_category.category_label (12 Booking Sheet categories)',
      survival: 'DEFAULT_TIER_BANDS.survival = 4450 from lib/revenue-truth-ui-core.mjs',
      unassigned: 'dropped — attributed_* GA4 fields preferred',
      movers_backlinks: 'placeholders until ≥2 weekly snapshots'
    }
  };
  metrics.narrative = buildNarrative(metrics);
  return metrics;
}
