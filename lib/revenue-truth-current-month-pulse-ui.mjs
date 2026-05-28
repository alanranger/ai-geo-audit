/** D23 — Current Month Pulse UI (above Exec Summary). */

import {
  escapeHtml, fmtMoney, fmtN, basisBadge, BAND_LABEL, BAND_COLOURS, slugLink
} from './revenue-truth-ui-core.mjs';
import { computePulseGscSignals, defconTileClass } from './revenue-truth-current-month-pulse.mjs';

function bandClass(b) {
  return 'band-' + (b || 'below_survival');
}

function cmpRow(label, cmp) {
  if (!cmp) return '';
  const d = cmp.deltaGbp ?? cmp.delta_gbp ?? 0;
  const pct = cmp.deltaPct ?? cmp.delta_pct;
  const sign = d >= 0 ? '+' : '';
  const pctTxt = pct == null ? '—' : `${sign}${Number(pct).toFixed(0)}%`;
  const badge = cmp.basis ? basisBadge(cmp.basis) : basisBadge('nonjlr_net');
  return `<div class="rt-pulse-cmp ${bandClass(cmp.rag)}"><div class="rt-pulse-cmp-label">${escapeHtml(label)} ${badge}</div>`
    + `<div class="rt-pulse-cmp-val">${fmtMoney(cmp.amount ?? cmp.target ?? 0, 0)}</div>`
    + `<div class="rt-pulse-cmp-delta">${sign}${fmtMoney(Math.abs(d), 0)} (${pctTxt})</div></div>`;
}

function scenarioTile(title, amount, defcon, meta, cls = '') {
  if (!defcon?.active) return '';
  const d = defcon;
  return `<div class="rt-pulse-scenario ${cls}">`
    + `<div class="rt-pulse-scenario-title">${escapeHtml(title)}</div>`
    + `<div class="rt-pulse-scenario-val">${fmtMoney(amount, 0)}</div>`
    + `<div class="rt-pulse-scenario-defcon defcon-${d.level}${d.pulse ? ' defcon-pulse' : ''}">`
    + `DEFCON ${d.level} <span class="rt-defcon-pips">${d.pip_display}</span> ${escapeHtml(d.status)}`
    + `</div>`
    + `<div class="rt-pulse-scenario-meta">${d.pct_of_survival.toFixed(0)}% of survival · ${escapeHtml(meta)}</div>`
    + `</div>`;
}

function tierGapRows(gaps) {
  if (!gaps?.length) return '<p class="rt-sub">No recurring-tier gaps in current month.</p>';
  return `<table class="rt-table rt-striped rt-pulse-tier-table"><thead><tr>`
    + `<th>Tier</th><th>This month so far</th><th>Same day ${escapeHtml('last year')}</th><th>Gap</th></tr></thead><tbody>`
    + gaps.map((t) => {
      const gap = t.gap_gbp || 0;
      const cls = gap < 0 ? 'is-negative' : '';
      return `<tr class="rt-pulse-tier-row" data-rt-tier-scroll="rt-diag-tier-${escapeHtml(t.tier_key)}">`
        + `<td><a href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(t.tier_key)}">${escapeHtml(t.label)}</a></td>`
        + `<td>${fmtMoney(t.current_so_far, 0)}</td><td>${fmtMoney(t.prior_year_same_day, 0)}</td>`
        + `<td class="${cls}">${gap >= 0 ? '+' : ''}${fmtMoney(gap, 0)}</td></tr>`;
    }).join('')
    + `</tbody><tfoot><tr class="rt-grand-total">`
    + `<td class="rt-grand-total-label">Grand total</td>`
    + `<td>${fmtMoney(gaps.reduce((s, t) => s + (t.current_so_far || 0), 0), 0)}</td>`
    + `<td>${fmtMoney(gaps.reduce((s, t) => s + (t.prior_year_same_day || 0), 0), 0)}</td>`
    + `<td>${fmtMoney(gaps.reduce((s, t) => s + (t.gap_gbp || 0), 0), 0)}</td>`
    + `</tr></tfoot></table>`;
}

function gscList(title, rows) {
  if (!rows?.length) return `<div class="rt-pulse-gsc-block"><h5>${escapeHtml(title)}</h5><p class="rt-sub">No declining signals.</p></div>`;
  const items = rows.map((r) => {
    const slug = '/' + String(r.slug || '').replace(/^\/+/, '');
    return `<li>${slugLink(slug, slug)}: ${Number(r.delta_pct).toFixed(0)}% impressions (${fmtN(r.impressions)} total)</li>`;
  }).join('');
  return `<div class="rt-pulse-gsc-block"><h5>${escapeHtml(title)}</h5><ul>${items}</ul></div>`;
}

function renderDefconGauge(pulse) {
  const d = pulse.defcon;
  if (!d?.active) {
    return `<div class="rt-defcon rt-defcon-inactive"><div class="rt-defcon-placeholder">${escapeHtml(d?.placeholder || 'Insufficient data')}</div></div>`;
  }
  const cls = defconTileClass(d);
  const miss = d.miss_vs_survival_gbp > 0 ? fmtMoney(d.miss_vs_survival_gbp, 0) + ' below survival' : 'At/above survival';
  return `<div class="rt-defcon ${cls}" style="--defcon-colour:${d.colour}">`
    + `<div class="rt-defcon-badge${d.pulse ? ' is-pulsing' : ''}">`
    + `<div class="rt-defcon-level">DEFCON ${d.level}</div>`
    + `<div class="rt-defcon-status">${escapeHtml(d.status)} · worst-case</div>`
    + `<div class="rt-defcon-pips" aria-label="Severity ${d.pips} of 5">${d.pip_display}</div>`
    + `</div>`
    + `<div class="rt-defcon-stats">`
    + `<div><span class="k">Worst projected</span> <strong>${fmtMoney(d.projected_month_end, 0)}</strong></div>`
    + `<div><span class="k">% survival</span> <strong>${d.pct_of_survival.toFixed(0)}%</strong></div>`
    + `<div><span class="k">Miss vs £3k</span> <strong class="is-negative">${miss}</strong></div>`
    + `<div><span class="k">Days left</span> <strong>${pulse.days_remaining}</strong></div>`
    + `</div></div>`;
}

export function renderCurrentMonthPulseHtml(summary, diagnosis) {
  const pulse = summary?.currentMonthPulse;
  if (!pulse) return '<div class="rt-loading">Loading live month&hellip;</div>';

  const proj = pulse.projection || {};
  const fi = pulse.forecast_impact || {};
  const gsc = computePulseGscSignals(diagnosis);
  const tileCls = pulse.defcon?.active ? defconTileClass(pulse.defcon) : 'defcon-inactive';
  const worstFlag = proj.is_worst_in_history
    ? `<div class="rt-pulse-alert is-critical">Worst-case month-end ${fmtMoney(proj.worst_case_month_end ?? proj.linear_month_end, 0)} would be the worst month in ${proj.historical_month_count} months of non-JLR history (prior low ${fmtMoney(proj.historical_low, 0)}).</div>`
    : '';

  const daysLeft = proj.days_remaining ?? pulse.days_remaining ?? 0;
  const anchorNote = proj.blend_anchor_label || 'Prior-year same month (non-JLR)';
  const scenarioHtml = pulse.defcon?.active ? `<div class="rt-pulse-scenarios">`
    + scenarioTile(
      'Best case (blended)',
      proj.blended_month_end,
      pulse.defcon.best_case,
      `Assumes final ${daysLeft} days match ${anchorNote.toLowerCase()} (${Math.round((proj.blend_weights?.trailing || 0) * 100)}% history + ${Math.round((proj.blend_weights?.pace || 0) * 100)}% pace)`,
      'is-best'
    )
    + scenarioTile(
      'Worst case (current pace)',
      proj.linear_month_end,
      pulse.defcon.worst_case,
      'Assumes pace continues unchanged',
      'is-worst'
    )
    + `</div>` : '';

  const volatileNote = (pulse.volatile_tiers || []).length
    ? `<p class="rt-sub">Volatile tiers (factual): ${pulse.volatile_tiers.map((t) => `${t.label} ${fmtMoney(t.current_so_far, 0)} vs ${fmtMoney(t.prior_year_same_day, 0)} ly`).join(' · ')}</p>`
    : '';

  return `<div class="rt-pulse-grid ${tileCls}">`
    + renderDefconGauge(pulse)
    + `<div class="rt-pulse-head ${tileCls}">`
    + `<div class="rt-pulse-title">${escapeHtml(pulse.month_label)} <span class="rt-pill partial">PARTIAL · ${pulse.days_elapsed}/${pulse.days_in_month} days · ${pulse.days_remaining} remaining</span> ${basisBadge('nonjlr_net')}</div>`
    + `<div class="rt-pulse-lead">${escapeHtml(pulse.lead_message)}</div>`
    + `<div class="rt-pulse-booked">Booked so far: <strong>${fmtMoney(pulse.booked_nonjlr_so_far, 0)}</strong> ${basisBadge('nonjlr_net')}</div>`
    + worstFlag
    + `</div>`
    + `<div class="rt-pulse-comparisons">`
    + cmpRow(`Same day ${pulse.month_label.replace(/\s+\d{4}$/, '')} last year`, pulse.comparisons?.prior_year_same_month)
    + cmpRow('Trailing 6-mo same-day avg', pulse.comparisons?.trailing_6_same_day_avg)
    + cmpRow('Comfortable pro-rata', pulse.comparisons?.comfortable_pro_rata)
    + `</div>`
    + scenarioHtml
    + `<div class="rt-pulse-tiers"><h4>Where's the gap vs same month last year</h4>${tierGapRows(pulse.tier_gaps)}${volatileNote}</div>`
    + `<div class="rt-pulse-gsc"><h4>GSC signal (recurring tiers)</h4><div class="rt-pulse-gsc-grid">${gscList('Hub impressions YoY (worst 3)', gsc.hub_declines)}${gscList('Product impressions YoY (worst 3)', gsc.product_declines)}</div></div>`
    + `<div class="rt-pulse-forecast"><h4>Forecast impact</h4>`
    + `<div class="rt-pulse-fc-row"><span>${escapeHtml(fi.current_label || 'Current')}</span><strong>${fmtMoney(fi.current_forecast, 0)}</strong> ${basisBadge('headline_gross')}</div>`
    + `<div class="rt-pulse-fc-row"><span>${escapeHtml(fi.revised_label || 'Revised pace')}</span><strong class="${(fi.delta_gbp || 0) < 0 ? 'is-negative' : ''}">${fmtMoney(fi.revised_forecast, 0)}</strong> ${basisBadge('nonjlr_net')}</div>`
    + `<div class="rt-pulse-fc-delta">Live-month revision: ${fmtMoney(fi.delta_gbp || 0, 0)} vs closed-months-only forecast</div>`
    + `</div></div>`;
}

export function pulseBandColour(band) {
  return BAND_COLOURS[band] || BAND_COLOURS.below_survival;
}
