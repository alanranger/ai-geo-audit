/**
 * Build CEO weekly metrics blob (READ-ONLY on dashboard tables).
 * FIX 2026-09-04: latest-audit rankings; completed-month + rolling-4wk revenue.
 */
import { DEFAULT_TIER_BANDS } from '../revenue-truth-ui-core.mjs';
import { computeDefcon } from '../revenue-truth-current-month-pulse.mjs';
import { DEFAULT_PROPERTY, fmtGbp, fmtNum, deltaArrow, addDaysYmd } from './shared.js';

const CATEGORY_CANON = [
  [1, '1. Courses/masterclasses'],
  [2, '2. Workshops Non Residential'],
  [3, '3. Workshops Residential'],
  [4, '4. Pick n Mix Inc'],
  [5, '5. Pick n Mix Out'],
  [6, '6. Mentoring'],
  [7, '7. 1-2-1'],
  [8, '8. Gift Vouchers Inc'],
  [9, '9. Gift Vouchers Out'],
  [10, '10. Prints & Royalties'],
  [11, '11 Commissions'],
  [12, '12. Academy']
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function londonParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

/** Last completed calendar month in London. */
function lastCompletedMonth(d = new Date()) {
  const { year, month } = londonParts(d);
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function ymdAdd(ymd, days) {
  return addDaysYmd(ymd, days);
}

function londonYmd(d = new Date()) {
  const { year, month, day } = londonParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

async function monthCategoryTotal(supabase, year, month) {
  const { data } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_order, category_label, revenue_amount')
    .eq('year', year)
    .eq('month', month);
  const byLabel = new Map();
  let total = 0;
  for (const r of data || []) {
    const amount = num(r.revenue_amount) || 0;
    byLabel.set(r.category_label, amount);
    total += amount;
  }
  return { total, byLabel, rows: data || [] };
}

async function txnSumNonJlr(supabase, startYmd, endYmdExclusive) {
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, is_jlr, txn_date')
    .gte('txn_date', startYmd)
    .lt('txn_date', endYmdExclusive)
    .limit(5000);
  if (error) throw new Error(error.message);
  let sum = 0;
  let count = 0;
  for (const t of data || []) {
    if (t.is_jlr === true) continue;
    sum += num(t.amount) || 0;
    count += 1;
  }
  return { sum, count };
}

async function sectionRevenueTruth(supabase, prior) {
  const completed = lastCompletedMonth();
  const priorMonth = completed.month === 1
    ? { year: completed.year - 1, month: 12 }
    : { year: completed.year, month: completed.month - 1 };

  const cur = await monthCategoryTotal(supabase, completed.year, completed.month);
  const prev = await monthCategoryTotal(supabase, priorMonth.year, priorMonth.month);

  const today = londonYmd();
  const rollStart = ymdAdd(today, -28);
  const priorRollStart = ymdAdd(today, -56);
  const roll = await txnSumNonJlr(supabase, rollStart, today);
  const priorRoll = await txnSumNonJlr(supabase, priorRollStart, rollStart);

  const survival = DEFAULT_TIER_BANDS.survival;
  const defcon = computeDefcon(cur.total, survival);
  const priorRt = prior?.metrics?.revenue_truth || {};

  return {
    // FIX2: never headline sub-5-day MTD
    headline_mode: 'completed_month',
    completed_month: {
      year: completed.year,
      month: completed.month,
      label: monthLabel(completed.year, completed.month),
      amount: cur.total,
      txn_count: (await txnSumNonJlr(
        supabase,
        `${completed.year}-${String(completed.month).padStart(2, '0')}-01`,
        completed.month === 12
          ? `${completed.year + 1}-01-01`
          : `${completed.year}-${String(completed.month + 1).padStart(2, '0')}-01`
      )).count,
      wow: deltaArrow(cur.total, prev.total)
    },
    rolling_4wk: {
      amount: roll.sum,
      start: rollStart,
      end: today,
      wow: deltaArrow(roll.sum, priorRoll.sum)
    },
    survival,
    gap_vs_survival: cur.total - survival,
    defcon_level: defcon.level,
    defcon_status: defcon.status,
    defcon_colour: defcon.colour,
    defcon_pips: defcon.pip_display,
    pct_of_survival: defcon.pct_of_survival,
    under_survival: cur.total < survival,
    // legacy keys kept for narrative helpers
    mtd: cur.total,
    wow: deltaArrow(cur.total, priorRt.mtd ?? prev.total),
    source: 'booking_sheet_monthly_category (last completed month) + booking_sheet_transactions (28d)'
  };
}

async function sectionRevenueByLine(supabase, prior) {
  const completed = lastCompletedMonth();
  const priorMonth = completed.month === 1
    ? { year: completed.year - 1, month: 12 }
    : { year: completed.year, month: completed.month - 1 };
  const cur = await monthCategoryTotal(supabase, completed.year, completed.month);
  const prev = await monthCategoryTotal(supabase, priorMonth.year, priorMonth.month);
  const priorLines = prior?.metrics?.revenue_by_line?.lines || [];

  const lines = CATEGORY_CANON.map(([order, label]) => {
    const amount = cur.byLabel.get(label) || 0;
    const prevAmt = prev.byLabel.get(label) ?? priorLines.find((x) => x.category_label === label)?.amount;
    return {
      category_order: order,
      category_label: label,
      amount,
      wow: deltaArrow(amount, prevAmt == null ? null : Number(prevAmt))
    };
  });
  const total = lines.reduce((s, l) => s + (l.amount || 0), 0);
  return {
    year: completed.year,
    month: completed.month,
    label: monthLabel(completed.year, completed.month),
    lines,
    total,
    wow: deltaArrow(total, prev.total)
  };
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
      money_enquiries: deltaArrow(moneyEnquiries, p.money_page_enquiries_28d),
      money_conversion: deltaArrow(moneyConv, p.money_conversion_pct)
    }
  };
}

async function latestRankingRows(supabase, propertyUrl) {
  const { data: latest } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const auditDate = latest?.audit_date || null;
  if (!auditDate) return { auditDate: null, rows: [] };
  const { data: rows, error } = await supabase
    .from('keyword_rankings')
    .select('keyword, best_rank_group, best_url, segment, page_type')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .limit(2000);
  if (error) throw new Error(error.message);
  return { auditDate, rows: rows || [] };
}

async function sectionRankings(supabase, propertyUrl, prior) {
  const { auditDate, rows } = await latestRankingRows(supabase, propertyUrl);
  const buckets = { b1: 0, b2_3: 0, b4_10: 0, b11_20: 0, b21: 0, unranked: 0 };
  let tracked = 0;
  let rankSum = 0;
  let rankN = 0;
  let moneySum = 0;
  let moneyN = 0;
  for (const r of rows) {
    tracked += 1;
    const p = num(r.best_rank_group);
    const seg = String(r.segment || r.page_type || '').toLowerCase();
    const isMoney = /commercial|landing|product|event|money/.test(seg);
    // Rankings tab: null/0 = not ranked; #1 is exactly 1 (not <=1).
    if (p == null || p <= 0) buckets.unranked += 1;
    else if (p === 1) buckets.b1 += 1;
    else if (p <= 3) buckets.b2_3 += 1;
    else if (p <= 10) buckets.b4_10 += 1;
    else if (p <= 20) buckets.b11_20 += 1;
    else buckets.b21 += 1;
    if (p != null && p > 0) {
      rankSum += p;
      rankN += 1;
      if (isMoney) {
        moneySum += p;
        moneyN += 1;
      }
    }
  }
  const page1 = buckets.b1 + buckets.b2_3 + buckets.b4_10;
  const avgPos = rankN ? rankSum / rankN : null;
  const moneyAvg = moneyN ? moneySum / moneyN : null;

  const { data: audit } = await supabase
    .from('audit_results')
    .select('gsc_clicks, gsc_avg_position, audit_date')
    .ilike('property_url', '%alanranger.com%')
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const priorRk = prior?.metrics?.rankings || {};
  return {
    audit_date: auditDate,
    buckets,
    page1,
    tracked,
    avg_position: avgPos,
    money_avg_position: moneyAvg,
    site_clicks: num(audit?.gsc_clicks),
    site_avg_position: num(audit?.gsc_avg_position),
    movers: { status: 'from_next_monday', up: [], down: [] },
    wow: {
      page1: deltaArrow(page1, priorRk.page1),
      tracked: deltaArrow(tracked, priorRk.tracked),
      site_clicks: deltaArrow(num(audit?.gsc_clicks), priorRk.site_clicks),
      avg_position: deltaArrow(avgPos, priorRk.avg_position),
      money_avg_position: deltaArrow(moneyAvg, priorRk.money_avg_position),
      b1: deltaArrow(buckets.b1, priorRk.buckets?.b1)
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
  const priorBl = prior?.metrics?.backlinks || {};
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
      referring_domains: deltaArrow(num(cache?.referring_domains), priorBl.referring_domains),
      backlinks: deltaArrow(num(cache?.backlinks), priorBl.backlinks),
      rank: deltaArrow(num(cache?.rank), priorBl.rank)
    }
  };
}

function parseProfitGbp(text) {
  const s = String(text || '');
  const m = s.match(/£\s*([\d,]+)\s*\/\s*mo\s*profit/i)
    || s.match(/~?£\s*([\d,]+)\s*\/\s*mo\s*profit/i)
    || s.match(/profit\s+at[^£]*£\s*([\d,]+)/i);
  if (!m) return null;
  return Number(String(m[1]).replace(/,/g, ''));
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

  const top_actions = (prios || []).map((p) => {
    const profit = parseProfitGbp(p.estimated_lift);
    return {
      title: p.title,
      status: p.status,
      estimated_lift: p.estimated_lift,
      profit_gbp_mo: profit
    };
  });
  const stakeOpen = top_actions.reduce((s, a) => s + (a.profit_gbp_mo || 0), 0);

  const { data: llm } = await supabase
    .from('llm_visibility_snapshots')
    .select('*')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const aiLikelihood = num(llm?.summary_likelihood ?? llm?.ai_summary_likelihood ?? llm?.likelihood_pct);
  const namedAnswers = num(llm?.named_in_answers_count ?? llm?.alan_named_count ?? llm?.citation_count);

  return {
    tasks_by_status: byStatus,
    shipped_this_week: shippedWeek,
    open_profit_gbp_mo: stakeOpen,
    top_actions,
    ai_summary_likelihood: aiLikelihood,
    named_in_ai_answers: namedAnswers,
    ai_summary: llm || null,
    wow: {
      shipped: deltaArrow(shippedWeek, prior?.metrics?.optimisation?.shipped_this_week),
      open_profit: deltaArrow(stakeOpen, prior?.metrics?.optimisation?.open_profit_gbp_mo),
      ai_likelihood: deltaArrow(aiLikelihood, prior?.metrics?.optimisation?.ai_summary_likelihood),
      named_answers: deltaArrow(namedAnswers, prior?.metrics?.optimisation?.named_in_ai_answers)
    }
  };
}

function buildNarrative(metrics) {
  const good = [];
  const bad = [];
  const rt = metrics.revenue_truth || {};
  const cm = rt.completed_month || {};
  if (cm.amount != null && cm.amount >= rt.survival) {
    good.push(`${cm.label} ${fmtGbp(cm.amount)} is at/above survival (${fmtGbp(rt.survival)}).`);
  } else if (cm.amount != null) {
    bad.push(`${cm.label} ${fmtGbp(cm.amount)} is ${fmtGbp(Math.abs(rt.gap_vs_survival || 0))} below survival ${fmtGbp(rt.survival)}.`);
  }
  if (rt.defcon_level != null && rt.defcon_level >= 3) {
    bad.push(`DEFCON ${rt.defcon_level} (${rt.defcon_status || 'active'}) on completed-month level.`);
  } else if (rt.defcon_level === 1) {
    good.push('DEFCON 1 — completed month clears survival.');
  }
  const fun = metrics.funnel || {};
  if (fun.money_conversion_pct != null && fun.money_conversion_pct < 1) {
    bad.push(`Money-page conversion ${fun.money_conversion_pct.toFixed(2)}% — funnel leak watch.`);
  }
  const rk = metrics.rankings || {};
  if (rk.page1 != null) {
    good.push(`Tracked set page-1 keywords: ${fmtNum(rk.page1)} of ${fmtNum(rk.tracked)} (audit ${rk.audit_date || '—'}).`);
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

  const revenue_truth = await sectionRevenueTruth(supabase, prior);
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
      money_pages: 'pages_master / moneyRoleForUrl: headline = money_role commercial',
      revenue_lines: 'booking_sheet_monthly_category — last completed calendar month',
      rankings: 'keyword_rankings filtered to latest audit_date (Rankings tab tracked set)',
      survival: 'DEFAULT_TIER_BANDS.survival = 4450',
      unassigned: 'dropped — attributed_* GA4 fields preferred',
      movers_backlinks: 'placeholders until ≥2 weekly snapshots'
    }
  };
  metrics.narrative = buildNarrative(metrics);
  return metrics;
}
