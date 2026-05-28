/** Exec summary gating — evidence-or-silence (D22 + D15 + D14). */

import { pctChange } from './revenue-truth-gsc-deltas.mjs';
import { VOLATILE_TIER_KEYS } from './revenue-truth-ui-core.mjs';
import { productTierKey, isExcludedFromMovers, isRankableFinding } from './revenue-truth-findings-filters.mjs';

export const EXEC_SUMMARY_TIER_KEYS = new Set([
  'courses_masterclasses',
  'workshops_non_residential',
  'one_to_one_lessons',
  'commissions',
  'academy'
]);

export const PLUMBING_TIER_KEYS = new Set([
  'pick_n_mix_inc',
  'gift_vouchers_inc',
  'prints_royalties',
  'mentoring'
]);

const EXCLUDED_SLUG_EXACT = new Set([
  'about-alan-ranger',
  'testimonials-customer-reviews',
  'contact-alan-ranger',
  'awards-and-recognition',
  'free-photography-tips',
  'photography-tuition-services',
  'course-finder',
  'jaguar-land-rover-els'
]);

const EXCLUDED_SLUG_PATTERNS = [
  /jaguar-land-rover/,
  /(^|\/)blog/,
  /calculator/,
  /news/,
  /testimonial/,
  /about-alan/,
  /equipment-recommendations/,
  /free-photography-tips/,
  /(^|\/)presents/,
  /course-finder/,
  /tips-and-tricks/,
  /photography-tuition/
];

export const WORRY_IMPRESSION_THRESHOLD = -25;
export const WORRY_MAX_BULLETS = 5;
export const INVESTIGATE_MAX_BULLETS = 5;

export function isExcludedExecSlug(pageSlug) {
  const s = String(pageSlug || '').toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!s || EXCLUDED_SLUG_EXACT.has(s)) return true;
  return EXCLUDED_SLUG_PATTERNS.some((re) => re.test(s));
}

export function isExecSummaryTier(tierKey) {
  if (!tierKey) return false;
  if (VOLATILE_TIER_KEYS.has(tierKey)) return false;
  if (PLUMBING_TIER_KEYS.has(tierKey)) return false;
  return EXEC_SUMMARY_TIER_KEYS.has(tierKey);
}

export function passesExecDiagGate(d) {
  if (!d || !isExecSummaryTier(d.tier_key)) return false;
  if (isExcludedExecSlug(d.page_slug)) return false;
  if (d.state === 'skipped_none' || d.state === 'insufficient_data') return false;
  return true;
}

function monthNum(iso) {
  return Number(String(iso || '').slice(5, 7));
}

function yearNum(iso) {
  return Number(String(iso || '').slice(0, 4));
}

function sortedSeries(monthlySeries) {
  return (monthlySeries || [])
    .slice()
    .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
}

/** Same-month YoY for event_bound / season_bound — evidence-or-silence. */
export function execSeasonalImpressionDelta(d) {
  const series = sortedSeries(d.metrics?.monthly_series);
  if (series.length < 12) {
    return { delta: null, insufficient: true, reason: 'fewer than 12 months of GSC history' };
  }
  const pageType = d.page_seasonality?.type || 'season_bound';
  const eventMonths = d.page_seasonality?.event_months || null;
  const latest = series.at(-1);
  const m = monthNum(latest.period_start);
  const y = yearNum(latest.period_start);

  if (pageType === 'event_bound' && eventMonths?.length && !eventMonths.includes(m)) {
    return { delta: null, insufficient: true, reason: 'current month outside event season' };
  }

  const prior = series.find((r) => monthNum(r.period_start) === m && yearNum(r.period_start) === y - 1);
  const recentImp = Number(latest.impressions) || 0;
  const priorImp = prior ? (Number(prior.impressions) || 0) : 0;
  if (!prior || priorImp === 0) {
    return { delta: null, insufficient: true, reason: 'no prior-year same-month baseline' };
  }
  return { delta: pctChange(recentImp, priorImp), insufficient: false, mode: 'same_month_yoy' };
}

/** year_round: half-window period-over-period within diagnosis window. */
export function execYearRoundImpressionDelta(d, windowMonths) {
  const series = sortedSeries(d.metrics?.monthly_series);
  const win = series.slice(-Math.max(2, windowMonths));
  if (win.length < 2) return { delta: null, insufficient: true, reason: 'insufficient window data' };
  const half = Math.floor(win.length / 2);
  const prior = win.slice(0, half);
  const recent = win.slice(half);
  const sumImp = (arr) => arr.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
  return { delta: pctChange(sumImp(recent), sumImp(prior)), insufficient: false, mode: 'half_window' };
}

export function execImpressionDelta(d, windowMonths) {
  const pageType = d.page_seasonality?.type || 'season_bound';
  if (pageType === 'event_bound' || pageType === 'season_bound') {
    return execSeasonalImpressionDelta(d);
  }
  if (pageType === 'year_round') {
    const adj = d.deltas?.impressions?.adjusted;
    if (adj != null) return { delta: adj, insufficient: false, mode: 'diagnosis_adjusted' };
    return execYearRoundImpressionDelta(d, windowMonths);
  }
  return execSeasonalImpressionDelta(d);
}

export function isGenuineVisibilityWorry(d, windowMonths) {
  if (!passesExecDiagGate(d)) return false;
  if (!String(d.state || '').startsWith('visibility_loss')) return false;
  if (d.deltas?.impressions?.insufficient_history) return false;

  const { delta, insufficient } = execImpressionDelta(d, windowMonths);
  if (insufficient || delta == null || delta > WORRY_IMPRESSION_THRESHOLD) return false;

  const fw = d.metrics?.full_window || {};
  if ((fw.impressions || 0) <= 500) return false;

  const posDrop = d.deltas?.position?.positions;
  if (posDrop != null && posDrop < 2) return false;

  return true;
}

export function visibilityWorryScore(d, windowMonths) {
  const fw = d.metrics?.full_window || {};
  const { delta } = execImpressionDelta(d, windowMonths);
  const rev = Number(fw.revenue_gbp_nonjlr) || 0;
  const impLoss = Math.abs(Number(delta) || 0) * (Number(fw.impressions) || 0) / 100;
  return rev + impLoss * 0.01;
}

export function tierCriticalWorryScore(t) {
  return Number(t.pages_at_risk_gbp) || 0;
}

export function isExecFindingsDecline(f) {
  if (isExcludedFromMovers(f)) return false;
  if (f.flags?.includes('retired_wound_down')) return false;
  if (f.unit_type === 'product') {
    const tier = productTierKey(f.meta);
    if (!tier || !isExecSummaryTier(tier)) return false;
  }
  if (f.unit_type === 'page') {
    const slug = String(f.unit_id || '').replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
    if (isExcludedExecSlug(slug)) return false;
  }
  return isRankableFinding(f, 'nonjlr_2024_to_2025', 'decline');
}

export function findingsDeclineScore(f) {
  return Math.abs(Number(f.deltas?.nonjlr_2024_to_2025?.delta_gbp) || 0);
}

export function isExecInvestigateCandidate(d) {
  if (!passesExecDiagGate(d)) return false;
  if (d.state !== 'traffic_with_zero_conversion') return false;
  return (d.metrics?.full_window?.impressions || 0) > 1000;
}

export function investigateScore(d) {
  return Number(d.metrics?.full_window?.impressions) || 0;
}

/** Spot-check helper for preview / tests. */
export function auditExecSummaryBullets(bullets, windowMonths) {
  const issues = [];
  const worry = bullets?.worry || [];
  if (worry.length > WORRY_MAX_BULLETS) {
    issues.push(`Worry Points has ${worry.length} bullets (max ${WORRY_MAX_BULLETS})`);
  }
  const blocked = [
    'about-alan-ranger',
    'testimonials',
    'contact',
    'awards',
    'jaguar-land-rover',
    'free-photography-tips',
    'bluebell',
    'somerset'
  ];
  for (const item of worry) {
    const text = String(item.text || '').toLowerCase();
    for (const token of blocked) {
      if (text.includes(token)) issues.push(`Worry mentions blocked token "${token}": ${item.text}`);
    }
  }
  return { ok: issues.length === 0, issues, windowMonths, worryCount: worry.length };
}
