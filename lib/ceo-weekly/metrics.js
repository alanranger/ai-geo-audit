/**
 * Build CEO weekly metrics blob (READ-ONLY on dashboard tables).
 * FIX 2026-09-04: latest-audit rankings; completed-month + rolling-4wk revenue.
 */
import { DEFAULT_TIER_BANDS } from '../revenue-truth-ui-core.mjs';
import { computeDefcon } from '../revenue-truth-current-month-pulse.mjs';
import { aggregateDfsBacklinkTileStats } from '../dfs-domain-backlink-tile-aggregates.js';
import { DEFAULT_PROPERTY, fmtGbp, fmtNum, deltaArrow, moneyDeltaArrow, addDaysYmd } from './shared.js';
import { fetchAcquisitionMetrics, fetchAuditTabMetrics, fetchLlmMetrics } from './tabMetrics.js';
import {
  fetchClickMoversTop3,
  loadHighDaDofollowSnapshot,
  sectionSeoHealth,
  weekSnapWow
} from './defSections.js';

const DA_BAND_ORDER = [
  { key: 'r80_100', label: '80–100 very strong' },
  { key: 'r50_79', label: '50–79 strong' },
  { key: 'r30_49', label: '30–49 moderate' },
  { key: 'r20_29', label: '20–29 weak' },
  { key: 'r_lt20', label: '<20 very weak' }
];

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
  if (v == null || v === '') return null;
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
    .select('week_start, metrics, send_status')
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
      wow: moneyDeltaArrow(cur.total, prev.total)
    },
    rolling_4wk: {
      amount: roll.sum,
      start: rollStart,
      end: today,
      wow: moneyDeltaArrow(roll.sum, priorRoll.sum)
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
    wow: moneyDeltaArrow(cur.total, priorRt.mtd ?? prev.total),
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
  // MoM from booking sheet only — never mix prior CEO snapshot (avoids exec/table divergence)
  void prior;

  const lines = CATEGORY_CANON.map(([order, label]) => {
    const hasCur = cur.byLabel.has(label);
    const hasPrev = prev.byLabel.has(label);
    const amount = hasCur ? (cur.byLabel.get(label) || 0) : 0;
    const prevAmt = hasPrev ? (prev.byLabel.get(label) || 0) : 0;
    const wow = (!hasCur && !hasPrev)
      ? { delta: null, arrow: '→', label: 'n/a' }
      : moneyDeltaArrow(amount, prevAmt);
    return {
      category_order: order,
      category_label: label,
      short_label: label.replace(/^\d+\.?\s*/, ''),
      amount,
      wow
    };
  });
  const total = lines.reduce((s, l) => s + (l.amount || 0), 0);
  const withDelta = lines.filter((l) => l.wow?.delta != null);
  const biggest_drop = [...withDelta].sort((a, b) => (a.wow.delta || 0) - (b.wow.delta || 0))[0] || null;
  const biggest_rise = [...withDelta].filter((l) => l.wow.delta > 0).sort((a, b) => (b.wow.delta || 0) - (a.wow.delta || 0))[0] || null;
  return {
    year: completed.year,
    month: completed.month,
    label: monthLabel(completed.year, completed.month),
    lines,
    biggest_drop,
    biggest_rise,
    total,
    wow: moneyDeltaArrow(total, prev.total),
    source: 'booking_sheet_monthly_category MoM (completed vs prior completed month)'
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
  let clickMovers = { climbers: [], droppers: [], window: null };
  try {
    clickMovers = await fetchClickMoversTop3(propertyUrl);
  } catch (e) {
    clickMovers = { climbers: [], droppers: [], error: e.message };
  }

  return {
    audit_date: auditDate,
    buckets,
    page1,
    tracked,
    avg_position: avgPos,
    money_avg_position: moneyAvg,
    site_clicks: num(audit?.gsc_clicks),
    site_avg_position: num(audit?.gsc_avg_position),
    movers: {
      status: clickMovers.climbers?.length || clickMovers.droppers?.length ? 'ready' : 'empty',
      climbers: clickMovers.climbers || [],
      droppers: clickMovers.droppers || [],
      window: clickMovers.window || null,
      source: clickMovers.source || null,
      error: clickMovers.error || null
    },
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
  // DA-band Δ only vs a prior *sent* Monday snapshot (dry_run / missing bands → from next Monday)
  const priorBandsReady = prior?.send_status === 'sent'
    && Array.isArray(priorBl.da_bands)
    && priorBl.da_bands.length > 0;

  // Same scan as Backlinks dashboard "Dofollow by ref. domain rank band" tile.
  const tiles = await aggregateDfsBacklinkTileStats(supabase, 'alanranger.com');
  const dfBands = tiles?.rankBandsDofollow || {};
  const nfBands = tiles?.rankBandsNofollow || {};
  const priorBands = priorBandsReady ? priorBl.da_bands : [];
  const da_bands = DA_BAND_ORDER.map(({ key, label }) => {
    const dofollow = Number(dfBands[key]) || 0;
    const nofollow = Number(nfBands[key]) || 0;
    const priorRow = priorBands.find((b) => b.key === key);
    return {
      key,
      label,
      dofollow,
      nofollow,
      wow_dofollow: weekSnapWow(dofollow, priorBandsReady ? priorRow?.dofollow : null),
      wow_nofollow: weekSnapWow(nofollow, priorBandsReady ? priorRow?.nofollow : null)
    };
  });

  // Tile scan is the same source as the DA-band table — use it for counts so
  // backlinks === dofollow + nofollow (+ unknown). Cache rank/spam stay for DFS summary.
  const blTotal = tiles?.totalBacklinks ?? null;
  const blDf = tiles?.dofollow ?? null;
  const blNf = tiles?.nofollow ?? null;
  const blUn = tiles?.unknown ?? null;
  const blRd = tiles?.referringDomains ?? num(cache?.referring_domains);
  const followPct = blDf != null && blTotal
    ? Math.round((blDf / Math.max(blTotal, 1)) * 100)
    : (tiles?.followRatio != null ? Math.round(Number(tiles.followRatio) * (Number(tiles.followRatio) <= 1 ? 100 : 1)) : null);

  let linkSnap = { high_da_dofollow_keys: [], new_links: { status: 'from_next_monday', items: [] } };
  try {
    linkSnap = await loadHighDaDofollowSnapshot(supabase, priorBl);
  } catch (e) {
    linkSnap = {
      high_da_dofollow_keys: priorBl.high_da_dofollow_keys || [],
      new_links: { status: 'error', items: [], note: e.message }
    };
  }

  return {
    rank: num(cache?.rank),
    backlinks: blTotal,
    referring_domains: blRd,
    spam_score: num(cache?.backlinks_spam_score),
    spam_label: (num(cache?.backlinks_spam_score) ?? 99) <= 30 ? 'low' : 'watch',
    crawled_pages: num(cache?.crawled_pages),
    dofollow: blDf,
    nofollow: blNf,
    unknown_follow: blUn,
    follow_ratio: tiles?.followRatio ?? null,
    follow_pct: followPct,
    // Cache headline kept for audit only (must not drive the Backlinks row).
    dfs_summary_backlinks_cache: num(cache?.backlinks),
    counts_reconcile:
      blTotal != null && blDf != null && blNf != null
        ? blTotal === blDf + blNf + (blUn || 0)
        : null,
    da_bands,
    da_bands_source: 'aggregateDfsBacklinkTileStats (same as Backlinks tile)',
    high_da_dofollow_keys: linkSnap.high_da_dofollow_keys,
    new_links: linkSnap.new_links,
    new_lost_domains: weeklyPoints >= 2
      ? { status: 'ready', note: 'diff last two weekly history points on next cadence' }
      : { status: 'from_next_monday', note: 'needs ≥2 weekly domain_rank_history points' },
    wow: {
      referring_domains: weekSnapWow(blRd, priorBl.referring_domains),
      backlinks: weekSnapWow(blTotal, priorBl.backlinks),
      rank: weekSnapWow(num(cache?.rank), priorBl.rank),
      dofollow: weekSnapWow(blDf, priorBl.dofollow),
      nofollow: weekSnapWow(blNf, priorBl.nofollow)
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
  const wins = [];
  const worries = [];
  const rt = metrics.revenue_truth || {};
  const cm = rt.completed_month || {};
  const acq = metrics.acquisition || {};
  const surf = metrics.surfaces || {};
  const lines = metrics.revenue_by_line?.lines || [];
  const topLine = [...lines].sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];
  const biggestDrop = metrics.revenue_by_line?.biggest_drop
    || [...lines].filter((l) => l.wow?.delta != null).sort((a, b) => (a.wow.delta || 0) - (b.wow.delta || 0))[0];
  const biggestRise = metrics.revenue_by_line?.biggest_rise || null;

  if (acq.google_organic?.wow?.pct != null && acq.google_organic.wow.pct > 0) {
    good.push(`Organic ${acq.google_organic.wow.label.replace(/^▲\s*/, '+')}`);
    wins.push(`Organic traffic ${acq.google_organic.wow.label}`);
  }
  if (metrics.chips?.brand?.wow?.delta > 0) {
    good.push(`Brand demand ${metrics.chips.brand.wow.label}`);
    wins.push(`Brand demand ${metrics.chips.brand.wow.label}`);
  }
  if (metrics.backlinks?.wow?.referring_domains?.delta > 0) {
    wins.push(`Referring domains ${metrics.backlinks.wow.referring_domains.label}`);
  }
  if (biggestRise?.wow?.delta > 0) {
    good.push(`${biggestRise.short_label || biggestRise.category_label.replace(/^\d+\.?\s*/, '')} ${biggestRise.wow.label}`);
    wins.push(`${biggestRise.short_label || biggestRise.category_label.replace(/^\d+\.?\s*/, '')} ${biggestRise.wow.label}`);
  } else if (topLine?.wow?.delta > 0) {
    good.push(`${topLine.category_label.replace(/^\d+\.?\s*/, '')} ${topLine.wow.label}`);
    wins.push(`${topLine.category_label.replace(/^\d+\.?\s*/, '')} ${topLine.wow.label}`);
  }

  if (cm.amount != null && cm.amount < rt.survival) {
    bad.push(`${fmtGbp(Math.abs(rt.gap_vs_survival || 0))} under survival`);
    worries.push(`Revenue ${cm.wow?.label || ''}`.trim());
  }
  if (biggestDrop?.wow?.delta < 0) {
    worries.push(`${biggestDrop.short_label || biggestDrop.category_label.replace(/^\d+\.?\s*/, '')} ${biggestDrop.wow.label}`);
  }
  if (acq.direct?.wow?.pct != null && acq.direct.wow.pct < 0) {
    worries.push(`Direct traffic ${acq.direct.wow.label}`);
  }
  const aio = surf.ai_overview?.pct;
  const paa = surf.paa?.pct;
  if (aio != null && aio < 10) {
    bad.push(`0 answer surfaces (AIO ${aio}%, PAA ${paa ?? 0}%)`);
    worries.push('0 answer-surface presence');
  }
  if ((metrics.optimisation?.shipped_this_week || 0) === 0) {
    bad.push('0 tasks shipped');
  }

  const orgPct = acq.google_organic?.wow?.pct;
  const week_verdict = orgPct != null && orgPct > 0 && (cm.amount || 0) < (rt.survival || 0)
    ? 'organic demand and brand are climbing, but revenue fell and you\'re still invisible on answer surfaces — the growth isn\'t converting to sales.'
    : (cm.amount || 0) < (rt.survival || 0)
      ? 'revenue is under the survival line — focus on converting demand you already have.'
      : 'trading above survival — keep pressure on answer-surface visibility.';

  const brandWow = metrics.chips?.brand?.wow;
  const surfWow = metrics.chips?.surface_vis?.wow;
  const surfStale = !!metrics.chips?.surface_vis?.stale || !!surfWow?.stale;
  const websiteVerdict = (orgPct != null && orgPct > 5 && (acq.direct?.wow?.pct || 0) < -5)
    ? {
      word: 'MIXED',
      color: '#b25e09',
      bar: '#f59e0b',
      line: `Traffic up, health holding. Organic <b style="color:#067647;">${acq.google_organic?.wow?.label || ''}</b>${brandWow?.delta > 0 ? `, brand demand <b style="color:#067647;">${brandWow.label}</b>` : ''}${(!surfStale && surfWow?.delta != null && surfWow.delta < 0) ? `, but surface visibility <b style="color:#b42318;">${surfWow.label}</b>` : ''} and direct <b style="color:#b42318;">${acq.direct?.wow?.label || ''}</b>.`
    }
    : {
      word: 'STEADY',
      color: '#067647',
      bar: '#067647',
      line: `Attributed visits ${fmtNum(acq.attributed_visits)}. Organic <b style="color:#067647;">${acq.google_organic?.wow?.label || '→'}</b>.`
    };

  const one21 = lines.find((l) => /1-2-1/i.test(l.category_label));
  const moneyWord = (cm.amount || 0) >= (rt.survival || 4450) ? 'HEALTHY' : 'DECLINE';
  const dropBit = biggestDrop?.wow?.delta < 0
    ? ` — ${biggestDrop.short_label || biggestDrop.category_label.replace(/^\d+\.?\s*/, '')} <b style="color:#b42318;">${biggestDrop.wow.label}</b>`
    : '';
  const riseBit = biggestRise?.wow?.delta > 0
    ? ` Only ${biggestRise.short_label || biggestRise.category_label.replace(/^\d+\.?\s*/, '')} grew <b style="color:#067647;">${biggestRise.wow.label}</b>.`
    : (one21?.wow?.delta > 0 ? ` Only 1-2-1 grew <b style="color:#067647;">${one21.wow.label}</b>.` : '');
  const moneyVerdict = {
    word: moneyWord,
    color: moneyWord === 'HEALTHY' ? '#067647' : '#b42318',
    bar: moneyWord === 'HEALTHY' ? '#067647' : '#b42318',
    line: `${fmtGbp(cm.amount)}, <b style="color:#b42318;">${fmtGbp(Math.abs(rt.gap_vs_survival || 0))} under survival</b>. Down <b style="color:#b42318;">${cm.wow?.label || ''}</b>${dropBit}.${riseBit}`
  };

  const llm = metrics.llm || {};
  const aiWord = (aio != null && aio >= 10) || (llm.prompts_named || 0) >= 5 ? 'PRESENT' : 'LOCKED OUT';
  const aiVerdict = {
    word: aiWord,
    color: aiWord === 'PRESENT' ? '#067647' : '#b42318',
    bar: aiWord === 'PRESENT' ? '#067647' : '#b42318',
    line: `AI Overview <b style="color:#b42318;">${aio ?? '—'}%</b>, People-Also-Ask <b style="color:#b42318;">${paa ?? 0}%</b>, named <b style="color:#b42318;">${llm.prompts_named ?? '—'}/${llm.prompts_total ?? 15}</b>.${acq.ai_assistant?.wow?.pct > 0 ? ` But AI-assistant visits growing <b style="color:#067647;">${acq.ai_assistant.wow.label}</b>.` : ''}`
  };

  return {
    good_points: good.slice(0, 4),
    bad_points: bad.slice(0, 4),
    wins: wins.slice(0, 4),
    worries: worries.slice(0, 4),
    week_verdict,
    domain_cards: { website: websiteVerdict, money: moneyVerdict, ai: aiVerdict }
  };
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
  let seo_health = null;
  try { seo_health = await sectionSeoHealth(supabase, prior); } catch (e) { seo_health = { error: e.message }; }

  let acquisition = null;
  let auditTabs = null;
  let llm = null;
  try { acquisition = await fetchAcquisitionMetrics(); } catch (e) { acquisition = { error: e.message }; }
  try { auditTabs = await fetchAuditTabMetrics(supabase, propertyUrl); } catch (e) { auditTabs = { error: e.message }; }
  try { llm = await fetchLlmMetrics(propertyUrl); } catch (e) { llm = { error: e.message }; }

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
    seo_health,
    optimisation,
    acquisition,
    chips: auditTabs?.chips || null,
    authority: auditTabs?.authority || null,
    money_pages: auditTabs?.money_pages || null,
    surfaces: auditTabs?.surfaces || null,
    ai_summary_score: auditTabs?.ai_summary_score ?? null,
    llm,
    definitions: {
      money_pages: 'pages_master / moneyRoleForUrl: headline = money_role commercial',
      revenue_lines: 'booking_sheet_monthly_category — last completed calendar month',
      rankings: 'keyword_rankings filtered to latest audit_date (Rankings tab tracked set)',
      acquisition: 'GET /api/aigeo/acquisition-channels',
      surfaces: 'computeSurfaceOutcomesRollup on money keywords',
      survival: 'DEFAULT_TIER_BANDS.survival = 4450',
      unassigned: 'dropped — attributed visits + bot footer',
      backlinks_da_delta: 'vs prior Monday ceo_weekly_report_snapshots.metrics.backlinks.da_bands',
      new_dofollow_da50: 'diff high_da_dofollow_keys vs prior snapshot — from next Monday until ≥2',
      click_movers: 'Trad SEO get-gsc-csv40d-click-movers (~40d)',
      seo_health: 'evaluation_cache + rules weighted score (hygiene); deep extractability deferred'
    }
  };
  metrics.narrative = buildNarrative(metrics);
  return metrics;
}
