/**
 * Revenue (sales) ↔ GP dual display using rolling margin from business_targets.
 * Sales survival bands = GP ÷ margin; never mix units in one comparison silently.
 */

import { APPROVED_GP_TIERS, salesNeeded } from './business-targets.mjs';
import { DEFAULT_TIER_BANDS, TIER_BAND_TARGETS } from './revenue-truth-ui-core.mjs';

function round0(n) {
  return Math.round(Number(n) || 0);
}

export function resolveMarginPct(summaryOrCfg) {
  const cfg = summaryOrCfg?.config || summaryOrCfg || {};
  const fromDerived = Number(cfg.derivedSales?.margin_pct);
  if (Number.isFinite(fromDerived) && fromDerived > 0) return fromDerived;
  const fromBt = Number(summaryOrCfg?.businessTargets?.margin?.margin_pct);
  if (Number.isFinite(fromBt) && fromBt > 0) return fromBt;
  return null;
}

export function revenueToGp(revenue, marginPct) {
  const m = Number(marginPct);
  if (!Number.isFinite(m) || m <= 0) return null;
  return round0((Number(revenue) || 0) * (m / 100));
}

export function gpToRevenue(gp, marginPct) {
  return salesNeeded(gp, marginPct);
}

/** Monthly + annual survival pairs (sales + GP). */
export function survivalTargetsDual(summary) {
  const marginPct = resolveMarginPct(summary);
  const cfg = summary?.config || {};
  const salesMo = Number(cfg.tierBands?.survival) || DEFAULT_TIER_BANDS.survival;
  const gpMo = Number(summary?.businessTargets?.gp_tiers?.survival)
    || Number(APPROVED_GP_TIERS.survival_gp_monthly)
    || 3700;
  const gpYr = Number(cfg.annualGpTargets?.survival)
    || Number(summary?.businessTargets?.annual_gp?.survival)
    || TIER_BAND_TARGETS.survival;
  const salesYr = marginPct
    ? (gpToRevenue(gpYr, marginPct) || round0(salesMo * 12))
    : round0(salesMo * 12);
  return {
    marginPct,
    salesMonthly: round0(salesMo),
    gpMonthly: round0(gpMo),
    salesAnnual: round0(salesYr),
    gpAnnual: round0(gpYr),
    marginLabel: marginPct == null ? 'n/a' : `${marginPct}%`
  };
}

/** Format "£A rev / £B GP" (GP omitted if margin missing). */
export function fmtRevGp(revenue, marginPct, digits = 0) {
  const rev = Number(revenue) || 0;
  const gp = revenueToGp(rev, marginPct);
  const revTxt = '£' + Math.abs(rev).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
  if (gp == null) return `${revTxt} rev`;
  const gpTxt = '£' + Math.abs(gp).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
  return `${revTxt} rev / ${gpTxt} GP`;
}

export function fmtSurvivalPair(sales, gp, period = 'mo') {
  const s = '£' + Math.abs(Number(sales) || 0).toLocaleString('en-GB');
  const g = '£' + Math.abs(Number(gp) || 0).toLocaleString('en-GB');
  return `Survival ${s} ${period} sales · ${g} ${period} GP`;
}
