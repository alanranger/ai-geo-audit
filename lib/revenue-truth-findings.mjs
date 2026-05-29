// lib/revenue-truth-findings.mjs
//
// Phase B analyser: reads Phase A booking_sheet_transactions + canonical
// product flags, produces the structured FINDINGS object that the
// "What's Changed & Why" section on the Revenue Truth tab renders.
//
// Rules (per the brief):
// - Findings are CORRELATIONS, not causal claims. Plain-text uses
//   "coincided with" / "alongside" / "while" -- never "because" / "due to".
// - JLR-stripped is the DEFAULT view; JLR-inclusive is computed alongside
//   so the UI can flip the toggle without a second API call.
// - Current partial month is EXCLUDED from year-on-year run-rate logic
//   (2026 annualised uses CLOSED MONTHS only). 2026 YTD (incl. partial
//   month) is also exposed for reconciliation against the Phase A V4 /
//   V5 totals.
// - Each finding cites its underlying £ figures and reconciles back to
//   the transactions table -- nothing is hidden behind a model.
//
// Complexity discipline: every function below stays under the project's
// 15-cyclomatic-complexity rule. Where the rule was at risk the logic
// is split into named helpers.

import { isPlumbingProduct, VOLATILE_TIER_KEYS } from './revenue-truth-ui-core.mjs';
import { isRankableFinding, productTierKey } from './revenue-truth-findings-filters.mjs';

const NEW_D2C_DEFAULT = ['Google', 'Referral', 'ChatGPT', 'Into the Blue', 'Into The Blue', 'Batsford', 'Artfully Walls', 'Pure Photo', 'Other'];
const EXISTING_SOURCE = 'Existing';
const ONE_OFF_SHARE_THRESHOLD = 0.4;         // single txn >= 40% of year total
const TOP_N = 5;
// Forecast model constants. The +/-10% range is the brief's specified
// allowance for historical year-to-year seasonality variance; it is not
// a statistical confidence interval.
const FORECAST_RANGE_PCT = 0.1;
const FORECAST_BASE_YEARS_OFFSET = [2, 1];   // currentYear-2, currentYear-1
const FORECAST_NEAR_ZERO_EPSILON = 0.01;     // skip year when |annual| < this
const FORECAST_CLOSED_WEIGHT_MIN = 0.001;    // fallback below this

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildFindings(input) {
  const ctx = buildContext(input);
  const productMetrics = aggregateByUnit(ctx, 'product');
  const pageMetrics    = aggregateByUnit(ctx, 'page');
  const productFindings = buildUnitFindings(productMetrics, 'product', ctx);
  const pageFindings    = buildUnitFindings(pageMetrics, 'page', ctx);
  return {
    asOf: new Date().toISOString(),
    dataThrough: ctx.dataThrough,
    closedMonthsCurrentYear: ctx.closedMonthsCurrentYear,
    currentYear: ctx.currentYear,
    headline: buildHeadline(ctx),
    seasonal_forecast: buildSeasonalForecast(ctx),
    products: {
      decliningTop5_2024_to_2025: rankFindings(productFindings, '2024->2025', 'decline').slice(0, TOP_N),
      growingTop5_2024_to_2025:   rankFindings(productFindings, '2024->2025', 'growth').slice(0, TOP_N),
      decliningTop5_2025_to_2026: rankFindings(productFindings, '2025->2026', 'decline').slice(0, TOP_N),
      growingTop5_2025_to_2026:   rankFindings(productFindings, '2025->2026', 'growth').slice(0, TOP_N),
      all: productFindings
    },
    pages: {
      decliningTop5_2024_to_2025: rankFindings(pageFindings, '2024->2025', 'decline').slice(0, TOP_N),
      growingTop5_2024_to_2025:   rankFindings(pageFindings, '2024->2025', 'growth').slice(0, TOP_N),
      decliningTop5_2025_to_2026: rankFindings(pageFindings, '2025->2026', 'decline').slice(0, TOP_N),
      growingTop5_2025_to_2026:   rankFindings(pageFindings, '2025->2026', 'growth').slice(0, TOP_N),
      all: pageFindings
    },
    flags: collectFlags(productFindings, pageFindings),
    reconciliation: buildReconciliation(ctx),
    canonical_catalog: buildCanonicalCatalog(input.canonicalProducts || [])
  };
}

function buildCanonicalCatalog(products) {
  return products.map(p => ({
    product_title: p.product_title,
    product_url: p.product_url || null,
    service_page_url: p.service_page_url || null,
    category: p.category || null,
    is_retired: Boolean(p.is_retired),
    is_redemption: Boolean(p.is_redemption)
  }));
}

// ---------------------------------------------------------------------------
// Context: known-year set, current partial month, retired-product set, etc.
// ---------------------------------------------------------------------------

function buildContext(input) {
  const now = input.now ? new Date(input.now) : new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const txns = (input.transactions || []).map(normaliseTxn);
  const retired = new Set((input.canonicalProducts || []).filter(p => p.is_retired).map(p => p.product_title));
  const productMeta = indexProductMeta(input.canonicalProducts || []);
  const years = [...new Set(txns.map(t => t.year))].sort((a, b) => a - b);
  const closedMonthsCurrentYear = computeClosedMonths(currentYear, currentMonth);
  return {
    now, currentYear, currentMonth, closedMonthsCurrentYear,
    txns,
    retired, productMeta,
    years,
    dataThrough: `${currentYear}-${String(currentMonth - 1 || 12).padStart(2, '0')}` // last CLOSED month
  };
}

function normaliseTxn(t) {
  const src = String(t.booking_source || '').trim();
  return {
    year: Number(t.year),
    month: Number(t.month),
    amount: Number(t.amount) || 0,
    canonical_product: t.canonical_product || null,
    landing_page_url: t.landing_page_url || null,
    booking_source: src,
    client_name: t.client_name || null,
    category_label: t.category_label || null,
    is_jlr: Boolean(t.is_jlr),
    is_redemption: Boolean(t.is_redemption)
  };
}

function indexProductMeta(products) {
  const m = new Map();
  for (const p of products) {
    m.set(p.product_title, {
      product_url: p.product_url || null,
      service_page_url: p.service_page_url || null,
      service_page_title: p.service_page_title || null,
      category: p.category || null,
      seasonality_type: p.seasonality_type || null,
      is_retired: Boolean(p.is_retired),
      is_redemption: Boolean(p.is_redemption)
    });
  }
  return m;
}

function computeClosedMonths(year, currentMonth) {
  // "Closed" = strictly before the current partial month. So mid-May 2026 ->
  // 4 closed months (Jan..Apr).
  if (currentMonth <= 1) return 0;
  return currentMonth - 1;
}

// ---------------------------------------------------------------------------
// Aggregation per unit (product OR page)
// ---------------------------------------------------------------------------

function aggregateByUnit(ctx, unitType) {
  const buckets = new Map();
  for (const t of ctx.txns) {
    const unitId = unitType === 'product' ? t.canonical_product : t.landing_page_url;
    if (!unitId) continue;
    const b = buckets.get(unitId) || createEmptyBucket(unitId, unitType);
    addTxnToBucket(b, t, ctx);
    buckets.set(unitId, b);
  }
  return [...buckets.values()];
}

function createEmptyBucket(unitId, unitType) {
  return {
    unitType,
    unitId,
    yearly: new Map(),   // year -> { nonjlr, jlr, total, count, nonjlr_count, jlr_count, ytd_closed_nonjlr, ytd_closed_total, decomp }
    txns: []
  };
}

function addTxnToBucket(b, t, ctx) {
  const y = t.year;
  const slot = b.yearly.get(y) || emptyYearSlot();
  applyTxnToSlot(slot, t, y === ctx.currentYear, ctx.closedMonthsCurrentYear, t.month);
  b.yearly.set(y, slot);
  b.txns.push(t);
}

function emptyYearSlot() {
  return {
    nonjlr: 0, jlr: 0, total: 0,
    count: 0, nonjlr_count: 0, jlr_count: 0,
    // ytd-closed = closed-months-only sum (used for annualised in current year)
    closed_nonjlr: 0, closed_total: 0, closed_months_seen: new Set(),
    // source decomp (uses full year for past years; YTD for current year)
    decomp: emptyDecomp(),
    largestSingleNonjlr: null
  };
}

function emptyDecomp() {
  return {
    new_d2c: { revenue: 0, count: 0 },
    existing: { revenue: 0, count: 0 },
    jlr:      { revenue: 0, count: 0 }
  };
}

function applyTxnToSlot(slot, t, isCurrentYear, closedMonths, month) {
  slot.total += t.amount;
  slot.count += 1;
  if (t.is_jlr) {
    slot.jlr += t.amount; slot.jlr_count += 1;
    slot.decomp.jlr.revenue += t.amount; slot.decomp.jlr.count += 1;
  } else {
    slot.nonjlr += t.amount; slot.nonjlr_count += 1;
    if (isExistingSource(t.booking_source)) {
      slot.decomp.existing.revenue += t.amount; slot.decomp.existing.count += 1;
    } else {
      slot.decomp.new_d2c.revenue += t.amount; slot.decomp.new_d2c.count += 1;
    }
    if (!slot.largestSingleNonjlr || t.amount > slot.largestSingleNonjlr.amount) {
      slot.largestSingleNonjlr = { amount: t.amount, client_name: t.client_name, booking_source: t.booking_source, month };
    }
  }
  if (isCurrentYear && month <= closedMonths) {
    slot.closed_total  += t.amount;
    slot.closed_nonjlr += t.is_jlr ? 0 : t.amount;
    slot.closed_months_seen.add(month);
  }
}

function isExistingSource(src) {
  return String(src || '').trim().toLowerCase() === EXISTING_SOURCE.toLowerCase();
}

// ---------------------------------------------------------------------------
// Per-unit -> Finding
// ---------------------------------------------------------------------------

function buildUnitFindings(buckets, unitType, ctx) {
  const filtered = unitType === 'product'
    ? buckets.filter(b => !isPlumbingProduct(b.unitId))
    : buckets;
  return filtered.map(b => buildOneFinding(b, unitType, ctx));
}

function buildOneFinding(b, unitType, ctx) {
  const series = buildSeries(b, ctx);
  const meta = unitType === 'product' ? (ctx.productMeta.get(b.unitId) || {}) : {};
  const metaOut = unitType === 'product' ? { ...meta, tier_key: productTierKey(meta) } : meta;
  const oneOff = detectOneOff(b, series);
  const flags = detectFlags(b, series, meta);
  return {
    unit_type: unitType,
    unit_id: b.unitId,
    meta: metaOut,
    series_nonjlr: series.nonjlr,
    series_total:  series.total,
    counts: series.counts,
    deltas: buildDeltas(series),
    source_decomposition: buildSourceDecomp(b, series),
    largest_single_txn_nonjlr: largestForRanking(b),
    one_off_caveat: oneOff,
    flags,
    plain_text: buildPlainText(b, unitType, series, meta, flags, oneOff)
  };
}

function buildSeries(b, ctx) {
  const y2024 = b.yearly.get(2024) || emptyYearSlot();
  const y2025 = b.yearly.get(2025) || emptyYearSlot();
  const y2026 = b.yearly.get(ctx.currentYear) || emptyYearSlot();
  const closedCount = ctx.closedMonthsCurrentYear;
  const annualiser = closedCount > 0 ? 12 / closedCount : 0;
  return {
    nonjlr: {
      y2024: round2(y2024.nonjlr),
      y2025: round2(y2025.nonjlr),
      y2026_ytd: round2(y2026.nonjlr),
      y2026_ytd_closed: round2(y2026.closed_nonjlr),
      y2026_annualised: round2(y2026.closed_nonjlr * annualiser)
    },
    total: {
      y2024: round2(y2024.total),
      y2025: round2(y2025.total),
      y2026_ytd: round2(y2026.total),
      y2026_ytd_closed: round2(y2026.closed_total),
      y2026_annualised: round2(y2026.closed_total * annualiser)
    },
    counts: {
      y2024: y2024.count, y2025: y2025.count, y2026_ytd: y2026.count,
      y2024_nonjlr: y2024.nonjlr_count, y2025_nonjlr: y2025.nonjlr_count, y2026_nonjlr_ytd: y2026.nonjlr_count
    }
  };
}

function buildDeltas(series) {
  return {
    nonjlr_2024_to_2025: {
      delta_gbp: round2(series.nonjlr.y2025 - series.nonjlr.y2024),
      delta_pct: pctChange(series.nonjlr.y2024, series.nonjlr.y2025)
    },
    nonjlr_2025_to_2026: {
      delta_gbp: round2(series.nonjlr.y2026_annualised - series.nonjlr.y2025),
      delta_pct: pctChange(series.nonjlr.y2025, series.nonjlr.y2026_annualised)
    },
    total_2024_to_2025: {
      delta_gbp: round2(series.total.y2025 - series.total.y2024),
      delta_pct: pctChange(series.total.y2024, series.total.y2025)
    },
    total_2025_to_2026: {
      delta_gbp: round2(series.total.y2026_annualised - series.total.y2025),
      delta_pct: pctChange(series.total.y2025, series.total.y2026_annualised)
    }
  };
}

function pctChange(a, b) {
  if (!a) return null;
  return round1(((b - a) / a) * 100);
}

function buildSourceDecomp(b, series) {
  return {
    y2024: decompForYear(b, 2024, series.nonjlr.y2024),
    y2025: decompForYear(b, 2025, series.nonjlr.y2025),
    y2026: decompForYear(b, 2026, series.nonjlr.y2026_ytd),
    delta_2024_to_2025: decompDeltaForWindow(b, 2024, 2025)
  };
}

function decompForYear(b, year, yearNonjlr) {
  const s = b.yearly.get(year) || emptyYearSlot();
  const total = yearNonjlr || (s.decomp.new_d2c.revenue + s.decomp.existing.revenue);
  return {
    new_d2c: {
      revenue: round2(s.decomp.new_d2c.revenue),
      count: s.decomp.new_d2c.count,
      share: total > 0 ? round3(s.decomp.new_d2c.revenue / total) : 0
    },
    existing: {
      revenue: round2(s.decomp.existing.revenue),
      count: s.decomp.existing.count,
      share: total > 0 ? round3(s.decomp.existing.revenue / total) : 0
    },
    jlr: {
      revenue: round2(s.decomp.jlr.revenue),
      count: s.decomp.jlr.count
    }
  };
}

function decompDeltaForWindow(b, fromYear, toYear) {
  const a = (b.yearly.get(fromYear) || emptyYearSlot()).decomp;
  const z = (b.yearly.get(toYear)   || emptyYearSlot()).decomp;
  const newD2cDelta   = round2(z.new_d2c.revenue - a.new_d2c.revenue);
  const existingDelta = round2(z.existing.revenue - a.existing.revenue);
  const jlrDelta      = round2(z.jlr.revenue - a.jlr.revenue);
  const lossTotal = Math.min(0, newD2cDelta) + Math.min(0, existingDelta) + Math.min(0, jlrDelta);
  return {
    new_d2c:  { delta_gbp: newD2cDelta,   share_of_loss: shareOfLoss(newD2cDelta,   lossTotal) },
    existing: { delta_gbp: existingDelta, share_of_loss: shareOfLoss(existingDelta, lossTotal) },
    jlr:      { delta_gbp: jlrDelta,      share_of_loss: shareOfLoss(jlrDelta,      lossTotal) }
  };
}

function shareOfLoss(delta, lossTotal) {
  if (lossTotal === 0 || delta >= 0) return 0;
  return round3(delta / lossTotal);
}

// ---------------------------------------------------------------------------
// Flags + caveats
// ---------------------------------------------------------------------------

function detectOneOff(b, series) {
  const years = [2024, 2025, 2026];
  for (const year of years) {
    const slot = b.yearly.get(year);
    if (!slot?.largestSingleNonjlr) continue;
    const yearTotal = series.nonjlr[`y${year === 2026 ? '2026_ytd' : year}`] || 0;
    if (yearTotal <= 0) continue;
    const share = slot.largestSingleNonjlr.amount / yearTotal;
    if (share >= ONE_OFF_SHARE_THRESHOLD) {
      return {
        year,
        amount: round2(slot.largestSingleNonjlr.amount),
        share: round3(share),
        client_name: slot.largestSingleNonjlr.client_name,
        booking_source: slot.largestSingleNonjlr.booking_source,
        note: `One transaction (${slot.largestSingleNonjlr.client_name || 'unnamed client'}, ${slot.largestSingleNonjlr.booking_source || 'unknown source'}, £${round2(slot.largestSingleNonjlr.amount)}) made up ${Math.round(share * 100)}% of ${year} revenue for this unit. Year-on-year deltas for this unit should be read with the one-off in mind.`
      };
    }
  }
  return null;
}

function detectFlags(b, series, meta) {
  const flags = [];
  if (meta.is_retired) flags.push('retired_wound_down');
  if (meta.is_redemption) flags.push('voucher_redemption_line');
  if (isFirstRevenueInWindow(series)) flags.push('first_revenue_in_window');
  if (collapsedToZero(series)) flags.push('collapsed_to_zero');
  if (recovered(series)) flags.push('recovered_in_2026');
  if (declineDominantBy(b, 'new_d2c'))   flags.push('new_d2c_loss_dominant');
  if (declineDominantBy(b, 'existing'))  flags.push('existing_loss_dominant');
  return flags;
}

function isFirstRevenueInWindow(s) {
  return s.nonjlr.y2024 === 0 && (s.nonjlr.y2025 > 0 || s.nonjlr.y2026_ytd > 0);
}

function collapsedToZero(s) {
  return (s.nonjlr.y2024 > 0 || s.nonjlr.y2025 > 0)
    && s.nonjlr.y2026_ytd_closed === 0
    && s.nonjlr.y2025 < s.nonjlr.y2024;
}

function recovered(s) {
  return s.nonjlr.y2025 < s.nonjlr.y2024
    && s.nonjlr.y2026_annualised > s.nonjlr.y2025;
}

function declineDominantBy(b, bucket) {
  const a = (b.yearly.get(2024) || emptyYearSlot()).decomp;
  const z = (b.yearly.get(2025) || emptyYearSlot()).decomp;
  const delta = z[bucket].revenue - a[bucket].revenue;
  if (delta >= 0) return false;
  const allDelta =
    (z.new_d2c.revenue - a.new_d2c.revenue)
    + (z.existing.revenue - a.existing.revenue);
  if (allDelta >= 0) return false;
  return delta / allDelta >= 0.55;     // >= 55% of total loss
}

function largestForRanking(b) {
  let best = null;
  for (const [year, slot] of b.yearly.entries()) {
    if (!slot.largestSingleNonjlr) continue;
    if (!best || slot.largestSingleNonjlr.amount > best.amount) {
      best = { ...slot.largestSingleNonjlr, year };
    }
  }
  return best ? { ...best, amount: round2(best.amount) } : null;
}

// ---------------------------------------------------------------------------
// Plain-text generator (correlations-only, max 3 sentences)
// ---------------------------------------------------------------------------

function buildPlainText(b, unitType, series, meta, flags, oneOff) {
  const subject = subjectLabel(b, unitType, meta);
  const trend = trendSentence(subject, series);
  const decomp = decompSentence(b, series);
  const flagSentence = flagSentenceText(flags, oneOff);
  return [trend, decomp, flagSentence].filter(Boolean).join(' ');
}

function subjectLabel(b, unitType, meta) {
  if (unitType === 'page') return 'The ' + shortenUrl(b.unitId) + ' page';
  if (meta.is_retired) return 'The (retired) ' + truncate(b.unitId, 70);
  return 'The ' + truncate(b.unitId, 70);
}

function trendSentence(subject, s) {
  const a = s.nonjlr.y2024;
  const c = s.nonjlr.y2025;
  const d = s.nonjlr.y2026_annualised;
  const ytd = s.nonjlr.y2026_ytd;
  if (a === 0 && c > 0) {
    return `${subject} launched in 2025 with £${fmtMoney(c)} of non-JLR revenue; 2026 YTD is £${fmtMoney(ytd)} (annualised £${fmtMoney(d)}).`;
  }
  const parts = [];
  if (a > 0 || c > 0) parts.push(`went £${fmtMoney(a)} (2024) -> £${fmtMoney(c)} (2025)`);
  if (d > 0 || ytd > 0) parts.push(`-> £${fmtMoney(ytd)} YTD 2026 (annualised £${fmtMoney(d)})`);
  return `${subject} ${parts.join(' ')}, all non-JLR.`;
}

function decompSentence(b, series) {
  if (series.nonjlr.y2024 === 0 && series.nonjlr.y2025 === 0) return '';
  const dec = decompDeltaForWindow(b, 2024, 2025);
  const parts = [];
  if (dec.new_d2c.share_of_loss > 0)  parts.push(`${Math.round(dec.new_d2c.share_of_loss  * 100)}% from new D2C clients (predominantly Google)`);
  if (dec.existing.share_of_loss > 0) parts.push(`${Math.round(dec.existing.share_of_loss * 100)}% from existing clients`);
  if (parts.length === 0) return '';
  return `The 2024->2025 change coincided with ${parts.join(' and ')}.`;
}

function flagSentenceText(flags, oneOff) {
  const out = [];
  if (flags.includes('collapsed_to_zero')) out.push('All channels for this unit had ceased by the closed months of 2026.');
  if (flags.includes('first_revenue_in_window')) out.push('First non-JLR revenue appears in the 2025+ window (not a launch date claim).');
  if (flags.includes('retired_wound_down')) out.push('Tagged as RETIRED / historical in the canonical product list, so the decline is a wind-down, not a market signal.');
  if (flags.includes('recovered_in_2026'))  out.push('2026 annualised run-rate is above 2025, alongside a recovery in this unit.');
  if (oneOff) out.push(oneOff.note);
  return out.slice(0, 2).join(' ');     // never more than 2 extra sentences
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function rankFindings(findings, windowKey, mode) {
  const key = windowKey === '2024->2025' ? 'nonjlr_2024_to_2025' : 'nonjlr_2025_to_2026';
  const candidates = findings.filter(f => isRankable(f, key, mode));
  return candidates.sort((a, z) => sortRank(a, z, key, mode));
}

function isRankable(f, key, mode) {
  return isRankableFinding(f, key, mode);
}

function sortRank(a, z, key, mode) {
  const da = a.deltas[key].delta_gbp;
  const dz = z.deltas[key].delta_gbp;
  return mode === 'decline' ? da - dz : dz - da;
}

// ---------------------------------------------------------------------------
// Headline strip
// ---------------------------------------------------------------------------

function buildHeadline(ctx) {
  const byYear = sumByYear(ctx.txns, false);
  const byYearTotal = sumByYear(ctx.txns, true);
  const closedNonjlr2026 = sumYearMonthlyClosed(ctx.txns, ctx.currentYear, ctx.closedMonthsCurrentYear, false);
  const closedTotal2026  = sumYearMonthlyClosed(ctx.txns, ctx.currentYear, ctx.closedMonthsCurrentYear, true);
  const annualiser = ctx.closedMonthsCurrentYear > 0 ? 12 / ctx.closedMonthsCurrentYear : 0;
  return {
    nonjlr: {
      y2024: round2(byYear.get(2024) || 0),
      y2025: round2(byYear.get(2025) || 0),
      y2026_ytd:          round2(byYear.get(ctx.currentYear) || 0),
      y2026_ytd_closed:   round2(closedNonjlr2026),
      y2026_annualised:   round2(closedNonjlr2026 * annualiser),
      delta_2024_to_2025: round2((byYear.get(2025) || 0) - (byYear.get(2024) || 0)),
      delta_2025_to_2026: round2((closedNonjlr2026 * annualiser) - (byYear.get(2025) || 0))
    },
    total: {
      y2024: round2(byYearTotal.get(2024) || 0),
      y2025: round2(byYearTotal.get(2025) || 0),
      y2026_ytd:          round2(byYearTotal.get(ctx.currentYear) || 0),
      y2026_ytd_closed:   round2(closedTotal2026),
      y2026_annualised:   round2(closedTotal2026 * annualiser),
      delta_2024_to_2025: round2((byYearTotal.get(2025) || 0) - (byYearTotal.get(2024) || 0)),
      delta_2025_to_2026: round2((closedTotal2026 * annualiser) - (byYearTotal.get(2025) || 0))
    },
    summarySentence: buildHeadlineSentence(byYear, closedNonjlr2026 * annualiser, ctx),
    pace_context: buildPaceContext(ctx)
  };
}

// Like-for-like Jan..closedMonths comparison across years, plus the largest
// single non-JLR transaction in the current-year closed-months window. This
// exists specifically so the dashboard can render a data-backed honesty note
// next to the annualised figure: no narrative is hard-coded -- every number
// in the rendered caveat traces back to a sum over booking_sheet_transactions.
function buildPaceContext(ctx) {
  const closedM = ctx.closedMonthsCurrentYear;
  if (closedM === 0) return null;
  const byYearWindow = sumByYearWindow(ctx.txns, closedM, false);
  const currentSum = round2(byYearWindow.get(ctx.currentYear) || 0);
  const priorYears = buildPriorYearComparisons(byYearWindow, ctx.currentYear, currentSum);
  const largest = largestSingleNonjlrInWindow(ctx.txns, ctx.currentYear, closedM);
  return {
    closed_months_window: closedM,
    current_year_jan_to_m_nonjlr: currentSum,
    prior_years_jan_to_m_nonjlr: priorYears,
    largest_single_nonjlr_in_window: largest,
    pace_sentence: buildPaceSentence(priorYears, currentSum, largest, closedM, ctx.currentYear)
  };
}

function sumByYearWindow(txns, lastMonthInclusive, includeJlr) {
  const m = new Map();
  for (const t of txns) {
    if (t.month > lastMonthInclusive) continue;
    if (!includeJlr && t.is_jlr) continue;
    m.set(t.year, (m.get(t.year) || 0) + t.amount);
  }
  return m;
}

function buildPriorYearComparisons(byYearWindow, currentYear, currentSum) {
  const out = [];
  for (const [year, sum] of byYearWindow.entries()) {
    if (year === currentYear) continue;
    out.push({
      year,
      jan_to_m_nonjlr: round2(sum),
      pct_vs_current: pctChange(sum, currentSum)
    });
  }
  out.sort((a, z) => a.year - z.year);
  return out;
}

function largestSingleNonjlrInWindow(txns, currentYear, closedM) {
  let best = null;
  for (const t of txns) {
    if (t.year !== currentYear || t.month > closedM || t.is_jlr) continue;
    if (!best || t.amount > best.amount) {
      best = {
        amount: round2(t.amount),
        month: t.month,
        client_name: t.client_name || null,
        booking_source: t.booking_source || null
      };
    }
  }
  return best;
}

function buildPaceSentence(priorYears, currentSum, largest, monthsWin, currentYear) {
  if (!priorYears.length) return '';
  const monthsLabel = monthsWin === 1 ? '1 closed month' : `${monthsWin} closed months`;
  const compares = priorYears
    .filter(p => p.pct_vs_current != null)
    .map(p => `${p.pct_vs_current >= 0 ? '+' : ''}${p.pct_vs_current}% vs ${p.year} (£${fmtMoney(p.jan_to_m_nonjlr)})`)
    .join(', ');
  const head = `Like-for-like (first ${monthsLabel}): ${currentYear} non-JLR = £${fmtMoney(currentSum)} — ${compares}.`;
  if (!largest) return head;
  const who = largest.client_name || 'unnamed';
  const src = largest.booking_source || 'unknown source';
  const tail = ` Largest single non-JLR transaction in this window = £${fmtMoney(largest.amount)} (${who}, ${src}). No single outlier drives the annualised figure.`;
  return head + tail;
}

function sumByYear(txns, includeJlr) {
  const m = new Map();
  for (const t of txns) {
    if (!includeJlr && t.is_jlr) continue;
    m.set(t.year, (m.get(t.year) || 0) + t.amount);
  }
  return m;
}

function sumYearMonthlyClosed(txns, year, closedMonths, includeJlr) {
  let s = 0;
  for (const t of txns) {
    if (t.year !== year) continue;
    if (t.month > closedMonths) continue;
    if (!includeJlr && t.is_jlr) continue;
    s += t.amount;
  }
  return s;
}

function buildHeadlineSentence(byYearNonjlr, ann2026, ctx) {
  const a = byYearNonjlr.get(2024) || 0;
  const b = byYearNonjlr.get(2025) || 0;
  const d1 = round2(b - a);
  const d2 = round2(ann2026 - b);
  const s1 = `Non-JLR revenue fell £${fmtMoney(Math.abs(d1))} (2024->2025)`;
  const verb = d2 >= 0 ? 'recovering' : 'falling a further';
  const s2 = `${verb} ${d2 >= 0 ? '+' : '-'}£${fmtMoney(Math.abs(d2))} toward ${d2 >= 0 ? '2024 levels' : 'a deeper trough'} in ${ctx.currentYear} (annualised from ${ctx.closedMonthsCurrentYear} closed months)`;
  return d1 < 0 ? `${s1}, ${s2}.` : `Non-JLR revenue grew £${fmtMoney(d1)} (2024->2025) and is on track for £${fmtMoney(ann2026)} in ${ctx.currentYear} (annualised).`;
}

// ---------------------------------------------------------------------------
// Per-category seasonally-adjusted full-year forecast (replaces the naive
// YTD x 12/M extrapolation). Spec:
//   weight[m] for category c = (avg over base years) of
//                              month_m_nonjlr[c] / annual_nonjlr[c]
//   forecast_full_year[c]    = ytd_closed_nonjlr[c] / sum(weight[1..M])
//   total_mid                = sum over c of forecast_full_year[c]
//   range_low / range_high   = total_mid * (1 -/+ 0.10)
// JLR is excluded from the seasonality base (would distort certain months).
// Negative-sum categories (Pick n Mix Out, Gift Vouchers Out) keep
// sign-preserving weights and forecast to a negative full year, which is
// the correct behaviour for those reattribution lines.
// ---------------------------------------------------------------------------

function buildSeasonalForecast(ctx) {
  const closedM = ctx.closedMonthsCurrentYear;
  if (closedM === 0 || closedM >= 12) return null;
  const baseYears = FORECAST_BASE_YEARS_OFFSET.map(off => ctx.currentYear - off);
  const matrix = aggregateNonjlrByCatYearMonth(ctx.txns);
  const weights = computeSeasonalWeights(matrix, baseYears);
  const ytdPerCat = computeCurrentYearYtdPerCat(ctx.txns, ctx.currentYear, closedM);
  const perCat = buildPerCategoryForecasts(matrix, weights, ytdPerCat, closedM, baseYears);
  const mid = perCat.reduce((s, p) => s + p.forecast_full_year_mid, 0);
  return {
    method: 'seasonally_adjusted_per_category',
    method_label: 'Forecast — seasonally adjusted, based on 2024-25 non-JLR monthly distribution. Range ±10%.',
    base_years: baseYears,
    closed_months_current_year: closedM,
    range_pct: FORECAST_RANGE_PCT,
    forecast_per_category: perCat,
    total_full_year_mid:  round2(mid),
    total_full_year_low:  round2(mid * (1 - FORECAST_RANGE_PCT)),
    total_full_year_high: round2(mid * (1 + FORECAST_RANGE_PCT)),
    sanity_check: buildForecastSanityCheck(matrix, weights, baseYears, closedM),
    formula_text: 'forecast_full_year[c] = ytd_closed_nonjlr[c] / sum(weight[1..M])  where  weight[m] = avg over base years of (month_m_nonjlr[c] / annual_nonjlr[c])'
  };
}

function aggregateNonjlrByCatYearMonth(txns) {
  const out = new Map();
  for (const t of txns) {
    if (t.is_jlr) continue;
    if (!t.canonical_product && !t.landing_page_url && !t.amount) continue;
    if (!isValidMonthYear(t.year, t.month)) continue;
    const cat = txnCategoryLabel(t);
    if (!cat) continue;
    addToCategoryMatrix(out, cat, t.year, t.month, t.amount);
  }
  return out;
}

function addToCategoryMatrix(matrix, cat, year, month, amount) {
  let byYear = matrix.get(cat);
  if (!byYear) { byYear = new Map(); matrix.set(cat, byYear); }
  let arr = byYear.get(year);
  if (!arr) { arr = new Array(12).fill(0); byYear.set(year, arr); }
  arr[month - 1] += amount;
}

function isValidMonthYear(year, month) {
  return Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12;
}

function txnCategoryLabel(t) {
  // The findings library only sees the normalised txn shape (which does not
  // include category_label). The dashboard already groups by category for
  // its category tab; for forecasting we reach into the underlying field
  // via the optional .category_label that ingest provides. If it is missing
  // we fall back to canonical_product so the forecast still produces output.
  return t.category_label || t.canonical_product || null;
}

function computeSeasonalWeights(matrix, baseYears) {
  const out = new Map();
  for (const [cat, byYear] of matrix.entries()) {
    out.set(cat, averagedMonthlyShare(byYear, baseYears));
  }
  return out;
}

function averagedMonthlyShare(byYear, baseYears) {
  const perYear = [];
  for (const y of baseYears) {
    const arr = byYear.get(y);
    if (!arr) continue;
    const annual = arr.reduce((a, b) => a + b, 0);
    if (Math.abs(annual) < FORECAST_NEAR_ZERO_EPSILON) continue;
    perYear.push(arr.map(v => v / annual));
  }
  if (perYear.length === 0) return null;
  const avg = new Array(12).fill(0);
  for (const w of perYear) for (let i = 0; i < 12; i++) avg[i] += w[i] / perYear.length;
  return avg;
}

function computeCurrentYearYtdPerCat(txns, currentYear, closedM) {
  const m = new Map();
  for (const t of txns) {
    if (t.is_jlr) continue;
    if (Number(t.year) !== currentYear) continue;
    if (Number(t.month) > closedM) continue;
    const cat = txnCategoryLabel(t);
    if (!cat) continue;
    m.set(cat, (m.get(cat) || 0) + (Number(t.amount) || 0));
  }
  return m;
}

function buildPerCategoryForecasts(matrix, weights, ytdPerCat, closedM, baseYears) {
  const allCats = unionOfCategoryKeys(matrix, ytdPerCat);
  const out = [];
  for (const cat of allCats) {
    out.push(buildCategoryForecastRow(cat, weights.get(cat), ytdPerCat.get(cat) || 0, closedM, matrix.get(cat), baseYears));
  }
  out.sort((a, z) => z.forecast_full_year_mid - a.forecast_full_year_mid);
  return out;
}

function unionOfCategoryKeys(matrix, ytdPerCat) {
  return [...new Set([...matrix.keys(), ...ytdPerCat.keys()])].sort((a, z) => a.localeCompare(z));
}

function buildCategoryForecastRow(cat, weights, ytd, closedM, byYear, baseYears) {
  const row = {
    category: cat,
    ytd_closed_nonjlr: round2(ytd),
    base_year_avg_full_year_nonjlr: round2(historicalAvgAnnual(byYear, baseYears)),
    base_year_avg_jan_to_m_nonjlr: round2(historicalAvgJanToM(byYear, baseYears, closedM)),
    monthly_weights: weights ? weights.map(w => round4(w)) : null
  };
  if (!weights) return fillFallbackForecast(row, ytd, closedM, 'no_base_year_history');
  const closedWeightSum = weights.slice(0, closedM).reduce((a, b) => a + b, 0);
  if (Math.abs(closedWeightSum) < FORECAST_CLOSED_WEIGHT_MIN) return fillFallbackForecast(row, ytd, closedM, 'zero_closed_weight_sum');
  row.method = 'seasonally_adjusted';
  row.closed_weight_sum = round3(closedWeightSum);
  row.remaining_weight_sum = round3(1 - closedWeightSum);
  row.forecast_full_year_mid = round2(ytd / closedWeightSum);
  row.forecast_remaining = round2(row.forecast_full_year_mid - ytd);
  return row;
}

function fillFallbackForecast(row, ytd, closedM, reason) {
  const fallback = closedM > 0 ? ytd * (12 / closedM) : ytd;
  row.method = 'flat_12_over_M_fallback';
  row.fallback_reason = reason;
  row.closed_weight_sum = null;
  row.remaining_weight_sum = null;
  row.forecast_full_year_mid = round2(fallback);
  row.forecast_remaining = round2(fallback - ytd);
  return row;
}

function historicalAvgAnnual(byYear, baseYears) {
  if (!byYear) return 0;
  const vals = [];
  for (const y of baseYears) {
    const arr = byYear.get(y);
    if (!arr) continue;
    vals.push(arr.reduce((a, b) => a + b, 0));
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function historicalAvgJanToM(byYear, baseYears, closedM) {
  if (!byYear) return 0;
  const vals = [];
  for (const y of baseYears) {
    const arr = byYear.get(y);
    if (!arr) continue;
    vals.push(arr.slice(0, closedM).reduce((a, b) => a + b, 0));
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

// Sanity check: feed the historical Jan..M average as YTD and verify the
// forecast equals (approximately) the historical full-year average. This
// is the brief's mandated spot-check; categories with diff_pct > 15% are
// flagged "model_sensitive" so the dashboard can show a warning chip.
function buildForecastSanityCheck(matrix, weights, baseYears, closedM) {
  const rows = [];
  for (const [cat, w] of weights.entries()) {
    if (!w) continue;
    const row = sanityRowForCategory(cat, w, matrix.get(cat), baseYears, closedM);
    if (row) rows.push(row);
  }
  rows.sort((a, z) => z.diff_pct - a.diff_pct);
  return {
    rows,
    pass_count:        rows.filter(r => r.status === 'pass').length,
    warn_count:        rows.filter(r => r.status === 'warn').length,
    model_sensitive_count: rows.filter(r => r.status === 'model_sensitive').length
  };
}

function sanityRowForCategory(cat, weights, byYear, baseYears, closedM) {
  const histJanApr = []; const histAnnual = [];
  for (const y of baseYears) {
    const arr = byYear ? byYear.get(y) : null;
    if (!arr) continue;
    const annual = arr.reduce((a, b) => a + b, 0);
    if (Math.abs(annual) < FORECAST_NEAR_ZERO_EPSILON) continue;
    histAnnual.push(annual);
    histJanApr.push(arr.slice(0, closedM).reduce((a, b) => a + b, 0));
  }
  if (!histJanApr.length) return null;
  const avgJanApr = histJanApr.reduce((a, b) => a + b, 0) / histJanApr.length;
  const avgAnnual = histAnnual.reduce((a, b) => a + b, 0) / histAnnual.length;
  const cws = weights.slice(0, closedM).reduce((a, b) => a + b, 0);
  if (Math.abs(cws) < FORECAST_CLOSED_WEIGHT_MIN || Math.abs(avgAnnual) < FORECAST_NEAR_ZERO_EPSILON) return null;
  const modelForecast = avgJanApr / cws;
  const diffPct = Math.abs(modelForecast - avgAnnual) / Math.abs(avgAnnual) * 100;
  return {
    category: cat,
    avg_jan_to_m_nonjlr: round2(avgJanApr),
    avg_annual_nonjlr:   round2(avgAnnual),
    model_forecast:      round2(modelForecast),
    diff_pct:            round2(diffPct),
    status:              sanityStatus(diffPct)
  };
}

function sanityStatus(diffPct) {
  if (diffPct < 5) return 'pass';
  if (diffPct < 15) return 'warn';
  return 'model_sensitive';
}

// ---------------------------------------------------------------------------
// Flags panel + reconciliation
// ---------------------------------------------------------------------------

function collectFlags(productFindings, pageFindings) {
  const oneOffs   = collectByFlag([...productFindings, ...pageFindings], f => f.one_off_caveat != null, f => ({ unit_type: f.unit_type, unit_id: f.unit_id, note: f.one_off_caveat.note, year: f.one_off_caveat.year, amount: f.one_off_caveat.amount }));
  const retired   = collectByFlag(productFindings, f => f.flags.includes('retired_wound_down'), f => ({ unit_id: f.unit_id, note: `${f.unit_id} is tagged retired/historical in canonical_products - any decline is a wind-down.` }));
  const firstWin = collectByFlag([...productFindings, ...pageFindings], f => f.flags.includes('first_revenue_in_window'), f => ({ unit_type: f.unit_type, unit_id: f.unit_id, note: `${f.unit_id} first non-JLR revenue in the 2025+ data window — compare YoY with care.` }));
  return { one_offs: oneOffs, retired_wind_downs: retired, first_revenue_in_window: firstWin };
}

function collectByFlag(findings, predicate, mapper) {
  return findings.filter(predicate).map(mapper);
}

function buildReconciliation(ctx) {
  const byYear = sumByYear(ctx.txns, false);
  const byYearTotal = sumByYear(ctx.txns, true);
  return {
    nonjlr_per_year: yearMapToArray(byYear),
    total_per_year:  yearMapToArray(byYearTotal)
  };
}

function yearMapToArray(m) {
  return [...m.entries()].sort((a, z) => a[0] - z[0]).map(([year, amount]) => ({ year, amount: round2(amount) }));
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }
function round1(n) { return Number((Number(n) || 0).toFixed(1)); }
function round3(n) { return Number((Number(n) || 0).toFixed(3)); }
function round4(n) { return Number((Number(n) || 0).toFixed(4)); }
function fmtMoney(n) { return Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
function shortenUrl(u) {
  if (!u) return 'unknown';
  return String(u).replace(/^https?:\/\/(www\.)?alanranger\.com/i, '');
}

// Re-export the NEW_D2C_DEFAULT for tests / documentation -- callers can
// inspect it to verify which booking sources are bucketed as "new D2C".
export { NEW_D2C_DEFAULT };
