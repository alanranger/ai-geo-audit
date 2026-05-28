/** D23 — Current Month Pulse UI (above Exec Summary). */

import {
  escapeHtml, fmtMoney, fmtN, basisBadge, BAND_COLOURS, slugLink
} from './revenue-truth-ui-core.mjs';
import { computePulseGscSignals, defconTileClass, DEFCON_SURVIVAL_LINE } from './revenue-truth-current-month-pulse.mjs';

function fmtDelta(d, pct) {
  if (d == null && pct == null) return '—';
  const sign = Number(d) >= 0 ? '+' : '−';
  const money = `${Number(d) >= 0 ? '+' : ''}${fmtMoney(Number(d) || 0, 0)}`;
  const pctTxt = pct == null ? '' : ` (${sign}${Math.abs(Number(pct)).toFixed(0)}%)`;
  return `${money}${pctTxt}`;
}

function glanceSection(title) {
  return `<tr class="rt-glance-section"><td colspan="4">${escapeHtml(title)}</td></tr>`;
}

function glanceRow(label, benchmark, current, gap, opts = {}) {
  const gapCls = opts.neg ? 'is-negative' : (opts.pos ? 'is-positive' : '');
  const labelHtml = opts.htmlLabel ? label : escapeHtml(label);
  return `<tr class="${opts.sub ? 'rt-glance-sub' : ''}">`
    + `<td>${labelHtml}</td>`
    + `<td>${benchmark}</td>`
    + `<td><strong>${current}</strong></td>`
    + `<td class="${gapCls}">${gap}</td></tr>`;
}

function scenarioMini(title, amount, defcon, cls) {
  if (!defcon?.active) return '';
  return `<div class="rt-pulse-scenario ${cls}">`
    + `<div class="rt-pulse-scenario-title">${escapeHtml(title)}</div>`
    + `<div class="rt-pulse-scenario-val">${fmtMoney(amount, 0)}</div>`
    + `<div class="rt-pulse-scenario-defcon defcon-${defcon.level}${defcon.pulse ? ' defcon-pulse' : ''}">`
    + `DEFCON ${defcon.level} ${escapeHtml(defcon.status)}`
    + `</div>`
    + `<div class="rt-pulse-scenario-meta">${defcon.pct_of_survival.toFixed(0)}% of survival</div>`
    + `</div>`;
}

function tierGapRows(gaps) {
  if (!gaps?.length) return '';
  const rows = gaps.map((t) => {
    const gap = t.gap_gbp || 0;
    const cls = gap < 0 ? 'is-negative' : '';
    return `<tr class="rt-pulse-tier-row" data-rt-tier-scroll="rt-diag-tier-${escapeHtml(t.tier_key)}">`
      + `<td><a href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(t.tier_key)}">${escapeHtml(t.label)}</a></td>`
      + `<td>${fmtMoney(t.prior_year_same_day, 0)}</td>`
      + `<td>${fmtMoney(t.current_so_far, 0)}</td>`
      + `<td class="${cls}">${gap >= 0 ? '+' : ''}${fmtMoney(gap, 0)}</td></tr>`;
  }).join('');
  const totCur = gaps.reduce((s, t) => s + (t.current_so_far || 0), 0);
  const totPri = gaps.reduce((s, t) => s + (t.prior_year_same_day || 0), 0);
  const totGap = gaps.reduce((s, t) => s + (t.gap_gbp || 0), 0);
  return `<div class="rt-pulse-tier-wrap"><table class="rt-table rt-striped rt-pulse-tier-table">`
    + `<thead><tr><th>Tier</th><th>Same day LY</th><th>This month</th><th>Gap</th></tr></thead>`
    + `<tbody>${rows}</tbody>`
    + `<tfoot><tr class="rt-grand-total"><td class="rt-grand-total-label">Total</td>`
    + `<td>${fmtMoney(totPri, 0)}</td><td>${fmtMoney(totCur, 0)}</td>`
    + `<td>${fmtMoney(totGap, 0)}</td></tr></tfoot></table></div>`;
}

function gscGlanceRows(gsc) {
  const rows = [];
  for (const r of (gsc.hub_declines || []).slice(0, 3)) {
    const slug = '/' + String(r.slug || '').replace(/^\/+/, '');
    rows.push(glanceRow(
      slugLink(slug, slug.replace(/^\//, '')),
      'Hub YoY',
      `${fmtN(r.impressions)} imp`,
      `${Number(r.delta_pct).toFixed(0)}%`,
      { sub: true, neg: Number(r.delta_pct) < 0, htmlLabel: true }
    ));
  }
  for (const r of (gsc.product_declines || []).slice(0, 2)) {
    const slug = '/' + String(r.slug || '').replace(/^\/+/, '');
    rows.push(glanceRow(
      slugLink(slug, slug.replace(/^\//, '')),
      'Product YoY',
      `${fmtN(r.impressions)} imp`,
      `${Number(r.delta_pct).toFixed(0)}%`,
      { sub: true, neg: Number(r.delta_pct) < 0, htmlLabel: true }
    ));
  }
  if (!rows.length) {
    rows.push(glanceRow('Search impressions', 'Recurring tiers', '—', 'No declining signals', { sub: true }));
  }
  return rows.join('');
}

function renderPulseStrip(pulse, tileCls) {
  const d = pulse.defcon;
  if (!d?.active) {
    return `<div class="rt-pulse-strip rt-defcon-inactive">`
      + `<div class="rt-defcon-placeholder">${escapeHtml(d?.placeholder || 'Insufficient data')}</div></div>`;
  }
  const miss = d.miss_vs_survival_gbp > 0
    ? `${fmtMoney(d.miss_vs_survival_gbp, 0)} below survival`
    : 'At/above survival';
  return `<div class="rt-pulse-strip ${tileCls}" style="--defcon-colour:${d.colour}">`
    + `<div class="rt-pulse-strip-defcon${d.pulse ? ' is-pulsing' : ''}">`
    + `<span class="rt-defcon-level">DEFCON ${d.level}</span>`
    + `<span class="rt-defcon-status">${escapeHtml(d.status)}</span>`
    + `<span class="rt-defcon-pips">${d.pip_display}</span>`
    + `</div>`
    + `<div class="rt-pulse-strip-meta">`
    + `<strong>${escapeHtml(pulse.month_label)}</strong>`
    + `<span class="rt-pill partial">${pulse.days_elapsed}/${pulse.days_in_month}d · ${pulse.days_remaining} left</span>`
    + `<span>Booked ${fmtMoney(pulse.booked_nonjlr_so_far, 0)}</span>`
    + `<span>Worst ${fmtMoney(d.projected_month_end, 0)}</span>`
    + `<span class="is-negative">${miss}</span>`
    + `${basisBadge('nonjlr_net')}`
    + `</div></div>`;
}

function renderAtAGlance(pulse, gsc, fi) {
  const proj = pulse.projection || {};
  const monthShort = pulse.month_label.replace(/\s+\d{4}$/, '');
  const lySameDay = pulse.comparisons?.prior_year_same_month;
  const trail6 = pulse.comparisons?.trailing_6_same_day_avg;
  const lyFull = proj.prior_year_same_month_full;
  const histLow = proj.historical_low;
  const worstEnd = proj.worst_case_month_end ?? proj.linear_month_end;
  const missSurvival = pulse.defcon?.miss_vs_survival_gbp ?? 0;

  let rows = glanceSection('This month')
    + glanceRow('Booked so far', '—', fmtMoney(pulse.booked_nonjlr_so_far, 0), '—')
    + glanceRow(
      'Worst-case month-end',
      `Survival ${fmtMoney(DEFCON_SURVIVAL_LINE, 0)}`,
      fmtMoney(worstEnd, 0),
      pulse.defcon?.active
        ? `${pulse.defcon.pct_of_survival.toFixed(0)}% · ${fmtMoney(missSurvival, 0)} below`
        : '—',
      { neg: missSurvival > 0 }
    );

  if (pulse.defcon?.active) {
    rows += glanceRow(
      'Best case (blended)',
      proj.blend_anchor_label || 'Prior-year same month',
      fmtMoney(proj.blended_month_end, 0),
      `DEFCON ${pulse.defcon.best_case.level}`,
      { neg: pulse.defcon.best_case.level >= 3 }
    );
  }

  rows += glanceSection('vs benchmarks');
  if (lySameDay) {
    rows += glanceRow(
      `Same day ${monthShort} last year`,
      fmtMoney(lySameDay.amount, 0),
      fmtMoney(pulse.booked_nonjlr_so_far, 0),
      fmtDelta(lySameDay.deltaGbp, lySameDay.deltaPct),
      { neg: (lySameDay.deltaGbp || 0) < 0 }
    );
  }
  if (trail6) {
    rows += glanceRow(
      'Trailing 6-mo same-day avg',
      fmtMoney(trail6.amount, 0),
      fmtMoney(pulse.booked_nonjlr_so_far, 0),
      fmtDelta(trail6.deltaGbp, trail6.deltaPct),
      { neg: (trail6.deltaGbp || 0) < 0 }
    );
  }
  if (lyFull > 0) {
    const dFull = (worstEnd || 0) - lyFull;
    rows += glanceRow(
      `${monthShort} last year (full month)`,
      fmtMoney(lyFull, 0),
      fmtMoney(worstEnd, 0),
      fmtDelta(dFull, (dFull / lyFull) * 100),
      { neg: dFull < 0 }
    );
  }
  if (histLow != null) {
    const dLow = (worstEnd || 0) - histLow;
    rows += glanceRow(
      'Prior low (non-JLR history)',
      fmtMoney(histLow, 0),
      fmtMoney(worstEnd, 0),
      fmtDelta(dLow, histLow ? (dLow / histLow) * 100 : null) + (proj.is_worst_in_history ? ' · worst ever' : ''),
      { neg: dLow < 0 }
    );
  }

  const tierNeg = (pulse.tier_gaps || []).filter((t) => (t.gap_gbp || 0) < 0).slice(0, 4);
  if (tierNeg.length) {
    rows += glanceSection('Tier gaps vs same day last year');
    for (const t of tierNeg) {
      rows += glanceRow(
        t.label,
        fmtMoney(t.prior_year_same_day, 0),
        fmtMoney(t.current_so_far, 0),
        fmtDelta(t.gap_gbp, t.gap_pct),
        { sub: true, neg: true }
      );
    }
  }

  rows += glanceSection('Search & forecast');
  rows += gscGlanceRows(gsc);
  if (fi) {
    rows += glanceRow(
      fi.current_label || 'Year forecast (closed months)',
      basisBadge('headline_gross'),
      fmtMoney(fi.current_forecast, 0),
      '—'
    );
    const fcPct = fi.current_forecast ? (fi.delta_gbp / fi.current_forecast) * 100 : null;
    rows += glanceRow(
      fi.revised_label || 'Revised incl. May pace',
      basisBadge('nonjlr_net'),
      fmtMoney(fi.revised_forecast, 0),
      fmtDelta(fi.delta_gbp, fcPct),
      { neg: (fi.delta_gbp || 0) < 0 }
    );
  }

  return `<div class="rt-pulse-glance"><h4>At a glance</h4>`
    + `<table class="rt-table rt-glance-table"><thead><tr>`
    + `<th>Finding</th><th>Benchmark</th><th>Current</th><th>Gap</th>`
    + `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderCurrentMonthPulseHtml(summary, diagnosis) {
  const pulse = summary?.currentMonthPulse;
  if (!pulse) return '<div class="rt-loading">Loading live month&hellip;</div>';

  const proj = pulse.projection || {};
  const fi = pulse.forecast_impact || {};
  const gsc = computePulseGscSignals(diagnosis);
  const tileCls = pulse.defcon?.active ? defconTileClass(pulse.defcon) : 'defcon-inactive';
  const worstFlag = proj.is_worst_in_history
    ? `<div class="rt-pulse-alert is-critical">Worst-case ${fmtMoney(proj.worst_case_month_end ?? proj.linear_month_end, 0)} would be the worst month in ${proj.historical_month_count} months of non-JLR history (prior low ${fmtMoney(proj.historical_low, 0)}).</div>`
    : '';

  const asideHtml = pulse.defcon?.active
    ? `<aside class="rt-pulse-aside">`
      + scenarioMini('Worst case (pace)', proj.linear_month_end, pulse.defcon.worst_case, 'is-worst')
      + scenarioMini('Best case (blended)', proj.blended_month_end, pulse.defcon.best_case, 'is-best')
      + `</aside>`
    : '';

  const volatileNote = (pulse.volatile_tiers || []).length
    ? `<p class="rt-sub rt-pulse-volatile">Volatile: ${pulse.volatile_tiers.map((t) => `${t.label} ${fmtMoney(t.current_so_far, 0)} vs ${fmtMoney(t.prior_year_same_day, 0)} ly`).join(' · ')}</p>`
    : '';

  return `<div class="rt-pulse-grid ${tileCls}">`
    + renderPulseStrip(pulse, tileCls)
    + worstFlag
    + `<div class="rt-pulse-main">${asideHtml}${renderAtAGlance(pulse, gsc, fi)}</div>`
    + `<details class="rt-pulse-details"><summary>Tier breakdown (same day vs last year)</summary>`
    + tierGapRows(pulse.tier_gaps)
    + volatileNote
    + `</details></div>`;
}

export function pulseBandColour(band) {
  return BAND_COLOURS[band] || BAND_COLOURS.below_survival;
}
