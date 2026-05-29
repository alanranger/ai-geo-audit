import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExcludedExecSlug,
  isExecSummaryTier,
  passesExecDiagGate,
  execSeasonalImpressionDelta,
  execImpressionDelta,
  isGenuineVisibilityWorry,
  isExecFindingsDecline,
  isExecInvestigateCandidate,
  auditExecSummaryBullets,
  WORRY_MAX_BULLETS
} from '../lib/revenue-truth-exec-filters.mjs';
import { buildExecSummary } from '../lib/revenue-truth-exec-summary.mjs';

function diag(overrides = {}) {
  return {
    page_slug: 'landscape-photography-workshops',
    tier_key: 'workshops_non_residential',
    state: 'visibility_loss_normal_ctr',
    page_seasonality: { type: 'event_bound', event_months: [4] },
    deltas: {
      impressions: { adjusted: -71, insufficient_history: false },
      position: { positions: 3 }
    },
    metrics: {
      full_window: { impressions: 5000, revenue_gbp_nonjlr: 1200 },
      monthly_series: []
    },
    ...overrides
  };
}

function monthSeries(pairs) {
  return pairs.map(([period_start, impressions]) => ({ period_start, impressions, clicks: 0 }));
}

describe('revenue-truth exec filters', () => {
  it('excludes informational slugs', () => {
    assert.equal(isExcludedExecSlug('about-alan-ranger'), true);
    assert.equal(isExcludedExecSlug('testimonials-customer-reviews'), true);
    assert.equal(isExcludedExecSlug('landscape-photography-workshops'), false);
  });

  it('allows only recurring exec tiers', () => {
    assert.equal(isExecSummaryTier('workshops_non_residential'), true);
    assert.equal(isExecSummaryTier('workshops_residential'), false);
    assert.equal(isExecSummaryTier('gift_vouchers_inc'), false);
  });

  it('blocks informational pages even with visibility_loss state', () => {
    const d = diag({ page_slug: 'about-alan-ranger', tier_key: 'courses_masterclasses' });
    assert.equal(passesExecDiagGate(d), false);
    assert.equal(isGenuineVisibilityWorry(d, 3), false);
  });

  it('event_bound off-season yields insufficient delta (Bluebell in May)', () => {
    const series = monthSeries([
      ['2025-06-01', 40], ['2025-07-01', 35], ['2025-08-01', 30], ['2025-09-01', 25],
      ['2025-10-01', 20], ['2025-11-01', 15], ['2025-12-01', 10], ['2026-01-01', 8],
      ['2026-02-01', 6], ['2026-03-01', 5], ['2026-04-01', 900], ['2026-05-01', 30]
    ]);
    const d = diag({
      page_seasonality: { type: 'event_bound', event_months: [4] },
      metrics: { full_window: { impressions: 5000 }, monthly_series: series }
    });
    const result = execSeasonalImpressionDelta(d);
    assert.equal(result.insufficient, true);
    assert.equal(result.reason, 'current month outside event season');
    assert.equal(isGenuineVisibilityWorry(d, 3), false);
  });

  it('season_bound uses same-month YoY not raw narrow-window delta', () => {
    const series = monthSeries([
      ['2025-03-01', 800], ['2025-04-01', 1200], ['2025-05-01', 900],
      ['2026-03-01', 700], ['2026-04-01', 1100], ['2026-05-01', 850]
    ]);
    const d = diag({
      page_seasonality: { type: 'season_bound', event_months: null },
      deltas: { impressions: { adjusted: -71 }, position: { positions: 3 } },
      metrics: { full_window: { impressions: 5000, revenue_gbp_nonjlr: 800 }, monthly_series: series }
    });
    const { delta, insufficient } = execImpressionDelta(d, 3);
    assert.equal(insufficient, true);
    assert.equal(delta, null);
  });

  it('caps worry card items at five', () => {
    const baseMonths = [];
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        baseMonths.push([`${y}-${String(m).padStart(2, '0')}-01`, 400 + m]);
      }
    }
    const diags = Array.from({ length: 12 }, (_, i) => diag({
      page_slug: `workshop-hub-${i}`,
      deltas: { impressions: { adjusted: -40 - i }, position: { positions: 4 } },
      metrics: {
        full_window: { impressions: 2000 + i * 100, revenue_gbp_nonjlr: 500 + i * 50 },
        monthly_series: monthSeries(baseMonths)
      }
    }));
    const out = buildExecSummary({
      summary: {
        forecast: { forecastCentral: 50000 },
        monthly: [
          { year: 2026, month: 1, headlineRevenue: 2000, isClosed: true },
          { year: 2026, month: 2, headlineRevenue: 2100, isClosed: true },
          { year: 2026, month: 3, headlineRevenue: 2200, isClosed: true }
        ],
        config: { tierBands: { survival: 3000, comfortable: 5000, thrive: 8000 } }
      },
      findings: null,
      diagnosis: { tier_rollup: [], diagnostics: diags, tier_reconciliation: { passes: true } },
      windowMonths: 3
    });
    assert.ok(out.bullets.worry.length <= WORRY_MAX_BULLETS);
  });

  it('excludes retired findings from worry', () => {
    const f = {
      unit_type: 'product',
      unit_id: 'Somerset workshop',
      meta: { category: 'workshop (non-residential)', is_retired: true },
      flags: ['retired_wound_down'],
      deltas: { nonjlr_2024_to_2025: { delta_gbp: -3000 } },
      series_nonjlr: { y2024: 5000, y2025: 2000, y2026_annualised: 1000, y2026_ytd_closed: 500 }
    };
    assert.equal(isExecFindingsDecline(f), false);
  });

  it('investigate requires recurring tier and excludes informational slugs', () => {
    assert.equal(isExecInvestigateCandidate(diag({ state: 'traffic_with_zero_conversion' })), true);
    assert.equal(isExecInvestigateCandidate(diag({
      page_slug: 'about-alan-ranger',
      tier_key: 'courses_masterclasses',
      state: 'traffic_with_zero_conversion'
    })), false);
  });

  it('audit helper flags blocked tokens', () => {
    const audit = auditExecSummaryBullets({
      bullets: { worry: [{ text: '/about-alan-ranger: impressions -30%' }] }
    }, 3);
    assert.equal(audit.ok, false);
    assert.match(audit.issues[0], /about-alan-ranger/);
  });
});
