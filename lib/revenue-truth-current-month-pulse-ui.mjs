/** D23 — Current Month Pulse UI (verdict / insight / actions). */

import {
  escapeHtml, fmtMoney, fmtN, basisBadge, BAND_COLOURS, slugLink
} from './revenue-truth-ui-core.mjs';
import { TIER_DEFINITIONS } from './revenue-tier-mapping.js';
import { computePulseGscSignals, defconTileClass, DEFCON_SURVIVAL_LINE } from './revenue-truth-current-month-pulse.mjs';
import { EXEC_SUMMARY_TIER_KEYS, passesExecDiagGate } from './revenue-truth-exec-filters.mjs';

function fmtDelta(d, pct) {
  if (d == null && pct == null) return '-';
  const sign = Number(d) >= 0 ? '+' : '-';
  const money = `${Number(d) >= 0 ? '+' : ''}${fmtMoney(Number(d) || 0, 0)}`;
  const pctTxt = pct == null ? '' : ` (${sign}${Math.abs(Number(pct)).toFixed(0)}%)`;
  return `${money}${pctTxt}`;
}

function fmtShortDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function tierShortLabel(tierKey) {
  const label = TIER_DEFINITIONS[tierKey]?.label || tierKey || 'Tier';
  return label.includes('/') ? label.split('/')[0].trim() + ' tier' : `${label} tier`;
}

function glanceSection(title) {
  return `<tr class="rt-glance-section"><td colspan="4">${escapeHtml(title)}</td></tr>`;
}

function glanceRow(label, benchmark, current, gap, opts = {}) {
  const gapCls = opts.neg ? 'is-negative' : (opts.pos ? 'is-positive' : '');
  const labelHtml = opts.htmlLabel ? label : escapeHtml(label);
  return `<tr class="${opts.sub ? 'rt-glance-sub' : ''}">`
    + `<td>${labelHtml}</td><td>${benchmark}</td><td><strong>${current}</strong></td>`
    + `<td class="${gapCls}">${gap}</td></tr>`;
}

function scenarioMini(title, amount, defcon, cls) {
  if (!defcon?.level) return '';
  return `<div class="rt-pulse-scenario ${cls}">`
    + `<div class="rt-pulse-scenario-title">${escapeHtml(title)}</div>`
    + `<div class="rt-pulse-scenario-val">${fmtMoney(amount, 0)}</div>`
    + `<div class="rt-pulse-scenario-defcon defcon-${defcon.level}${defcon.pulse ? ' defcon-pulse' : ''}">`
    + `DEFCON ${defcon.level} ${escapeHtml(defcon.status)}</div>`
    + `<div class="rt-pulse-scenario-meta">${defcon.pct_of_survival.toFixed(0)}% of survival</div></div>`;
}

function tierGapRows(gaps) {
  if (!gaps?.length) return '';
  const rows = gaps.map((t) => {
    const gap = t.gap_gbp || 0;
    const cls = gap < 0 ? 'is-negative' : '';
    return `<tr class="rt-pulse-tier-row" data-rt-tier-scroll="rt-diag-tier-${escapeHtml(t.tier_key)}">`
      + `<td><a href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(t.tier_key)}">${escapeHtml(t.label)}</a></td>`
      + `<td>${fmtMoney(t.prior_year_same_day, 0)}</td><td>${fmtMoney(t.current_so_far, 0)}</td>`
      + `<td class="${cls}">${gap >= 0 ? '+' : ''}${fmtMoney(gap, 0)}</td></tr>`;
  }).join('');
  const totCur = gaps.reduce((s, t) => s + (t.current_so_far || 0), 0);
  const totPri = gaps.reduce((s, t) => s + (t.prior_year_same_day || 0), 0);
  const totGap = gaps.reduce((s, t) => s + (t.gap_gbp || 0), 0);
  return `<div class="rt-pulse-tier-wrap"><table class="rt-table rt-striped rt-pulse-tier-table">`
    + `<thead><tr><th>Tier</th><th>Same day LY</th><th>This month</th><th>Gap</th></tr></thead>`
    + `<tbody>${rows}</tbody><tfoot><tr class="rt-grand-total">`
    + `<td class="rt-grand-total-label">Total</td><td>${fmtMoney(totPri, 0)}</td>`
    + `<td>${fmtMoney(totCur, 0)}</td><td>${fmtMoney(totGap, 0)}</td></tr></tfoot></table></div>`;
}

function gscGlanceRows(gsc) {
  const rows = [];
  const add = (r, kind) => {
    const slug = '/' + String(r.slug || '').replace(/^\/+/, '');
    const shape = r.trend_shape ? ` · ${r.trend_shape}` : '';
    rows.push(glanceRow(slugLink(slug, slug.replace(/^\//, '')), kind, `${fmtN(r.impressions)} imp`,
      `${Number(r.delta_pct).toFixed(0)}%${shape}`, { sub: true, neg: Number(r.delta_pct) < 0, htmlLabel: true }));
  };
  for (const r of (gsc.hub_declines || []).slice(0, 3)) add(r, 'Hub YoY');
  for (const r of (gsc.product_declines || []).slice(0, 2)) add(r, 'Product YoY');
  if (!rows.length) rows.push(glanceRow('Search impressions', 'Recurring tiers', '-', 'No declining signals', { sub: true }));
  return rows.join('');
}

function renderAtAGlance(pulse, gsc, fi, summary) {
  const proj = pulse.projection || {};
  const rb = pulse.recurring_baseline || {};
  const rbSummary = summary?.recurringBaseline || {};
  const monthShort = pulse.month_label.replace(/\s+\d{4}$/, '');
  const lySameDay = pulse.comparisons?.prior_year_same_month;
  const trail6 = pulse.comparisons?.trailing_6_same_day_avg;
  const lyFull = proj.prior_year_same_month_full;
  const histLow = proj.historical_low;
  const worstEnd = proj.worst_case_month_end ?? proj.linear_month_end;
  const missSurvival = pulse.defcon?.miss_vs_survival_gbp ?? 0;

  let rows = glanceSection('This month')
    + glanceRow('Booked so far (headline non-JLR)', '-', fmtMoney(pulse.booked_nonjlr_so_far, 0), '-')
    + glanceRow('Recurring baseline so far', `Lumpy excluded ${fmtMoney(pulse.recurring_lumpy_excluded || 0, 0)}`,
      fmtMoney(rb.booked_so_far ?? pulse.recurring_baseline_so_far ?? 0, 0), basisBadge('recurring_baseline'))
    + glanceRow('Worst-case month-end (headline)', `Survival ${fmtMoney(DEFCON_SURVIVAL_LINE, 0)}`, fmtMoney(worstEnd, 0),
      pulse.defcon?.active ? `${pulse.defcon.pct_of_survival.toFixed(0)}% · ${fmtMoney(missSurvival, 0)} below` : '-',
      { neg: missSurvival > 0 })
    + glanceRow('Recurring projected (pace)', rb.jan_apr_avg ? `Jan-Apr avg ${fmtMoney(rb.jan_apr_avg, 0)}` : 'Jan-Apr recurring avg',
      fmtMoney(rb.linear_month_end ?? 0, 0), rb.defcon?.active ? `DEFCON ${rb.defcon.level}` : '-',
      { neg: (rb.defcon?.level || 0) >= 3 });

  if (pulse.defcon?.active) {
    rows += glanceRow('Best case (blended)', proj.blend_anchor_label || 'Prior-year same month',
      fmtMoney(proj.blended_month_end, 0), `DEFCON ${pulse.defcon.best_case.level}`, { neg: pulse.defcon.best_case.level >= 3 });
  }
  if (rbSummary.janAprRecurringAvg) {
    rows += glanceRow('Jan-Apr recurring avg', 'Survival £3k', fmtMoney(rbSummary.janAprRecurringAvg, 0),
      fmtDelta(rbSummary.janAprRecurringAvg - DEFCON_SURVIVAL_LINE,
        ((rbSummary.janAprRecurringAvg - DEFCON_SURVIVAL_LINE) / DEFCON_SURVIVAL_LINE) * 100),
      { neg: rbSummary.janAprRecurringAvg < DEFCON_SURVIVAL_LINE });
  }

  rows += glanceSection('vs benchmarks');
  if (lySameDay) {
    rows += glanceRow(`Same day ${monthShort} last year`, fmtMoney(lySameDay.amount, 0),
      fmtMoney(pulse.booked_nonjlr_so_far, 0), fmtDelta(lySameDay.deltaGbp, lySameDay.deltaPct), { neg: (lySameDay.deltaGbp || 0) < 0 });
  }
  if (trail6) {
    rows += glanceRow('Trailing 6-mo same-day avg', fmtMoney(trail6.amount, 0), fmtMoney(pulse.booked_nonjlr_so_far, 0),
      fmtDelta(trail6.deltaGbp, trail6.deltaPct), { neg: (trail6.deltaGbp || 0) < 0 });
  }
  if (lyFull > 0) {
    const dFull = (worstEnd || 0) - lyFull;
    rows += glanceRow(`${monthShort} last year (full month)`, fmtMoney(lyFull, 0), fmtMoney(worstEnd, 0),
      fmtDelta(dFull, (dFull / lyFull) * 100), { neg: dFull < 0 });
  }
  if (histLow != null) {
    const dLow = (worstEnd || 0) - histLow;
    rows += glanceRow('Prior low (non-JLR history)', fmtMoney(histLow, 0), fmtMoney(worstEnd, 0),
      fmtDelta(dLow, histLow ? (dLow / histLow) * 100 : null) + (proj.is_worst_in_history ? ' · worst ever' : ''), { neg: dLow < 0 });
  }

  const tierNeg = (pulse.tier_gaps || []).filter((t) => (t.gap_gbp || 0) < 0).slice(0, 4);
  if (tierNeg.length) {
    rows += glanceSection('Tier gaps vs same day last year');
    for (const t of tierNeg) {
      rows += glanceRow(t.label, fmtMoney(t.prior_year_same_day, 0), fmtMoney(t.current_so_far, 0),
        fmtDelta(t.gap_gbp, t.gap_pct), { sub: true, neg: true });
    }
  }

  rows += glanceSection('Search & forecast');
  rows += gscGlanceRows(gsc);
  if (fi) {
    rows += glanceRow(fi.current_label || 'Year forecast (closed months)', basisBadge('headline_gross'),
      fmtMoney(fi.current_forecast, 0), '-');
    const fcPct = fi.current_forecast ? (fi.delta_gbp / fi.current_forecast) * 100 : null;
    rows += glanceRow(fi.revised_label || 'Revised incl. May pace', basisBadge('nonjlr_net'),
      fmtMoney(fi.revised_forecast, 0), fmtDelta(fi.delta_gbp, fcPct), { neg: (fi.delta_gbp || 0) < 0 });
  }

  return `<div class="rt-pulse-glance"><h4>At a glance</h4>`
    + `<table class="rt-table rt-glance-table"><thead><tr>`
    + `<th>Finding</th><th>Benchmark</th><th>Current</th><th>Gap</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function buildPulseNextActions(pulse, gsc, diagnosis) {
  const actions = [];
  const seen = new Set();
  const push = (a) => {
    const key = a.tierScroll || a.text;
    if (seen.has(key) || actions.length >= 3) return;
    seen.add(key);
    actions.push(a);
  };

  const gscRows = [...(gsc?.hub_declines || []), ...(gsc?.product_declines || [])]
    .sort((a, b) => (a.delta_pct - b.delta_pct) || (b.impressions - a.impressions));
  if (gscRows[0]) {
    const r = gscRows[0];
    push({
      text: `Fix /${r.slug} rank`,
      tierLabel: tierShortLabel(r.tier_key),
      href: '#rt-diag-section',
      tierScroll: r.tier_key
    });
  }

  const diags = (diagnosis?.diagnostics || []).filter(passesExecDiagGate);
  const tierGaps = (pulse?.tier_gaps || []).filter((g) => EXEC_SUMMARY_TIER_KEYS.has(g.tier_key) && (g.gap_gbp || 0) < -50);
  for (const t of tierGaps) {
    const dates = diags.filter((d) => d.tier_key === t.tier_key)
      .map((d) => d.metrics?.lifetime?.last_txn_date).filter(Boolean).sort();
    const stop = dates.length ? ` stop ${fmtShortDate(dates.at(-1))}` : '';
    push({ text: `Diagnose ${t.label}${stop}`, tierLabel: tierShortLabel(t.tier_key), href: '#rt-diag-section', tierScroll: t.tier_key });
  }

  const academy = (diagnosis?.tier_rollup || []).find((t) => t.tier_key === 'academy');
  if (academy && (academy.page_state_counts?.traffic_rich_modest_conversion || academy.pages_at_risk_gbp > 0)) {
    push({ text: 'Rebuild Academy trial-to-paid conversion', tierLabel: 'Academy tier', href: '#rt-diag-section', tierScroll: 'academy' });
  }

  for (const d of diags.filter((x) => x.state === 'traffic_with_zero_conversion')
    .sort((a, b) => (b.metrics?.full_window?.impressions || 0) - (a.metrics?.full_window?.impressions || 0)).slice(0, 2)) {
    push({ text: `Fix zero-conversion on /${d.page_slug}`, tierLabel: tierShortLabel(d.tier_key), href: '#rt-diag-section', tierScroll: d.tier_key });
  }

  if (actions.length < 3) {
    push({ text: 'Sec. 9 Diagnosis - tier + page drill-down', tierLabel: 'Full diagnosis', href: '#rt-diag-section', tierScroll: null });
  }
  if (actions.length < 3) {
    push({ text: 'Sec. 2 Headline vs recurring forecast gap', tierLabel: 'Forecast', href: '#rt-headline-forecast', tierScroll: null });
  }
  return actions.slice(0, 3);
}

function renderPulseVerdict(pulse, tileCls) {
  const d = pulse.defcon;
  const proj = pulse.projection || {};
  const colour = d?.colour || '#64748b';
  if (!d?.active) {
    return `<div class="rt-pulse-verdict rt-defcon-inactive" style="--defcon-colour:${colour}">`
      + `<div class="rt-pulse-verdict-money">${escapeHtml(d?.placeholder || 'Insufficient data')}</div>`
      + `<div class="rt-pulse-verdict-sub">${escapeHtml(pulse.month_label || '')}</div></div>`;
  }

  const worstEnd = d.projected_month_end ?? proj.worst_case_month_end ?? proj.linear_month_end;
  const subParts = [pulse.month_label, `${pulse.days_remaining} days left`];
  if (proj.is_worst_in_history) subParts.push(`Worst month in ${proj.historical_month_count} months`);
  else if (d.miss_vs_survival_gbp > 0) subParts.push(`${fmtMoney(d.miss_vs_survival_gbp, 0)} below survival`);

  return `<div class="rt-pulse-verdict ${tileCls}${d.pulse ? ' is-pulsing' : ''}" style="--defcon-colour:${colour}">`
    + `<div class="rt-pulse-verdict-money">${fmtMoney(worstEnd, 0)} projected</div>`
    + `<div class="rt-pulse-verdict-defcon">DEFCON ${d.level} ${escapeHtml(d.status)}</div>`
    + `<div class="rt-pulse-verdict-sub">${escapeHtml(subParts.join(' · '))}</div></div>`;
}

function renderPulseInsight(summary, pulse) {
  const rb = summary?.recurringBaseline || {};
  let headline;
  let support;
  if (rb.janAprRecurringAvg && rb.janAprRecurringAvg < DEFCON_SURVIVAL_LINE) {
    headline = `Recurring baseline was ${fmtMoney(rb.janAprRecurringAvg, 0)}/mo for 4 months`;
    support = 'Already below £3k survival before May. May exposed it. This is structural, not a May problem.';
  } else {
    headline = pulse.lead_message || 'Monitor recurring baseline alongside headline non-JLR.';
    support = pulse.defcon?.active
      ? `Booked ${fmtMoney(pulse.booked_nonjlr_so_far, 0)} so far · ${pulse.defcon.pct_of_survival.toFixed(0)}% of survival on worst-case pace.`
      : 'Live month data still building.';
  }
  return `<div class="rt-pulse-insight">`
    + `<div class="rt-pulse-insight-head">${escapeHtml(headline)}</div>`
    + `<div class="rt-pulse-insight-support">${escapeHtml(support)}</div></div>`;
}

function renderPulseActionsZone(actions) {
  const chips = actions.map((a) => {
    const tierScroll = a.tierScroll ? ` data-rt-tier-scroll="${escapeHtml(a.tierScroll)}"` : '';
    return `<a class="rt-pulse-action-chip" href="${escapeHtml(a.href)}"${tierScroll}>`
      + `<span class="rt-pulse-chip-arrow" aria-hidden="true">▸</span>`
      + `<span class="rt-pulse-chip-body"><span class="rt-pulse-chip-text">${escapeHtml(a.text)}</span>`
      + `<span class="rt-pulse-chip-tier">${escapeHtml(a.tierLabel)}</span></span></a>`;
  }).join('');
  return `<div class="rt-pulse-actions-zone">`
    + `<h4 class="rt-pulse-actions-head">What to do next</h4>`
    + `<div class="rt-pulse-action-chips">${chips}</div></div>`;
}

function renderPulseNumbersDetails(pulse, gsc, fi, summary, diagnosis) {
  const proj = pulse.projection || {};
  const volatileNote = (pulse.volatile_tiers || []).length
    ? `<p class="rt-sub rt-pulse-volatile">Volatile: ${pulse.volatile_tiers.map((t) => `${t.label} ${fmtMoney(t.current_so_far, 0)} vs ${fmtMoney(t.prior_year_same_day, 0)} ly`).join(' · ')}</p>`
    : '';
  const asideHtml = pulse.defcon?.active
    ? `<aside class="rt-pulse-aside">`
      + scenarioMini('Worst case (pace)', proj.linear_month_end, pulse.defcon.worst_case, 'is-worst')
      + scenarioMini('Best case (blended)', proj.blended_month_end, pulse.defcon.best_case, 'is-best')
      + `</aside>`
    : '';

  return `<details class="rt-pulse-numbers">`
    + `<summary>Show the numbers ▸</summary>`
    + `<div class="rt-pulse-numbers-body">`
    + `<div class="rt-pulse-main">${asideHtml}${renderAtAGlance(pulse, gsc, fi, summary)}</div>`
    + `<h4 class="rt-pulse-numbers-subhead">Tier breakdown (same day vs last year)</h4>`
    + tierGapRows(pulse.tier_gaps)
    + volatileNote
    + `</div></details>`;
}

export function renderCurrentMonthPulseHtml(summary, diagnosis) {
  const pulse = summary?.currentMonthPulse;
  if (!pulse) return '<div class="rt-loading">Loading live month&hellip;</div>';

  const fi = pulse.forecast_impact || {};
  const gsc = computePulseGscSignals(diagnosis);
  const tileCls = pulse.defcon?.active ? defconTileClass(pulse.defcon) : 'defcon-inactive';
  const actions = buildPulseNextActions(pulse, gsc, diagnosis);

  return `<div class="rt-pulse-stack ${tileCls}">`
    + renderPulseVerdict(pulse, tileCls)
    + renderPulseInsight(summary, pulse)
    + renderPulseActionsZone(actions)
    + renderPulseNumbersDetails(pulse, gsc, fi, summary, diagnosis)
    + `</div>`;
}

export function pulseBandColour(band) {
  return BAND_COLOURS[band] || BAND_COLOURS.below_survival;
}
