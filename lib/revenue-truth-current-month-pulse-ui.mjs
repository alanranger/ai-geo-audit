/** D23 — Current Month Pulse UI (verdict / insight / actions). */

import {
  escapeHtml, fmtMoney, fmtN, basisBadge, BAND_COLOURS, slugLink, recurringBaselineLabel, VOLATILE_TIER_KEYS
} from './revenue-truth-ui-core.mjs';
import { computePulseGscSignals, defconTileClass, DEFCON_SURVIVAL_LINE, formatDefconLegend } from './revenue-truth-current-month-pulse.mjs';
import { EXEC_SUMMARY_TIER_KEYS } from './revenue-truth-exec-filters.mjs';

const PULSE_INVESTIGATE_SKIP_TIERS = new Set(['workshops_non_residential', 'workshops_residential']);

/** Static high-margin rescue priorities — not derived from tier deltas. */
export const PULSE_RESCUE_ACTIONS = [
  {
    text: 'Fix /photography-courses-coventry rank (pos 26 → top 10)',
    tierLabel: 'Courses / Masterclasses',
    cardLabel: 'Courses / Masterclasses tier card',
    tierScroll: 'courses_masterclasses',
    pageSlug: 'photography-courses-coventry',
    measures: [
      'Refresh title/H1 for Coventry evening-class intent (rank ~26, target top 10).',
      'Lift CTR: stronger meta, dates, and price above the fold.',
      'Cross-link from hub /landscape-photography-workshops to Coventry course dates.'
    ],
    bd: [
      'Email past Coventry course buyers for autumn dates.',
      'Camera-club / Meetup partner post with direct booking link.'
    ]
  },
  {
    text: 'Diagnose Commissions+Corporate+Product inquiry stop 17 Apr',
    tierLabel: 'Commissions tier',
    cardLabel: 'Commissions tier card',
    tierScroll: 'commissions',
    measures: [
      'Last inquiry-to-booking on Commissions tier: 17 Apr 2026 — treat as pipeline freeze.',
      'Check corporate/product inquiry forms and GA4 events since mid-April.',
      'Review open quotes and stale leads in CRM.'
    ],
    bd: [
      'Personal follow-up to corporate contacts active before 17 Apr.',
      'Re-open product photography outreach to agencies on retainer.'
    ]
  },
  {
    text: 'Rebuild Academy trial-to-paid conversion (£59/79 funnel)',
    tierLabel: 'Academy tier',
    cardLabel: 'Academy tier card',
    tierScroll: 'academy',
    pageSlug: 'free-online-photography-course',
    measures: [
      'Trial-to-paid is ~4% (below 10-25% SaaS norm) — fix day 7/12 paid nudges.',
      'Clarify £59 vs £79 annual choice at signup (70/30 split assumption).',
      'Audit Memberstack trial emails and in-app upgrade path.'
    ],
    bd: [
      'Direct outreach to active trials before day 14 expiry.',
      'Survey non-converters: price, content gap, or timing?'
    ]
  },
  {
    text: 'Rebuild £360 4-for-3 package + /private-photography-lessons',
    tierLabel: '1-2-1 Lessons tier',
    cardLabel: '1-2-1 Lessons tier card',
    tierScroll: 'one_to_one_lessons',
    pageSlug: 'private-photography-lessons',
    measures: [
      'Republish £360 four-for-three package prominently on lessons page.',
      'Restore primary CTA above fold (page losing impressions YoY).',
      'Bundle online + in-person lesson upsell on booking confirmation.'
    ],
    bd: [
      'Email past 1-2-1 buyers with package offer.',
      'Retarget site visitors who viewed lessons but did not book.'
    ]
  }
];

export function buildPulseRescueActions() {
  return PULSE_RESCUE_ACTIONS;
}

function fmtDelta(d, pct) {
  if (d == null && pct == null) return '-';
  const sign = Number(d) >= 0 ? '+' : '-';
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

function tierGapRows(gaps, recurringBaselineSoFar) {
  if (!gaps?.length && !recurringBaselineSoFar) return '';
  const rows = (gaps || []).map((t) => {
    const gap = t.gap_gbp || 0;
    const cls = gap < 0 ? 'is-negative' : '';
    return `<tr class="rt-pulse-tier-row" data-rt-tier-scroll="rt-diag-tier-${escapeHtml(t.tier_key)}">`
      + `<td><a href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(t.tier_key)}">${escapeHtml(t.label)}</a></td>`
      + `<td>${fmtMoney(t.prior_year_same_day, 0)}</td><td>${fmtMoney(t.current_so_far, 0)}</td>`
      + `<td class="${cls}">${gap >= 0 ? '+' : ''}${fmtMoney(gap, 0)}</td></tr>`;
  }).join('');
  let totCur = (gaps || []).reduce((s, t) => s + (t.current_so_far || 0), 0);
  const totPri = (gaps || []).reduce((s, t) => s + (t.prior_year_same_day || 0), 0);
  const residual = Math.round(((recurringBaselineSoFar || 0) - totCur) * 100) / 100;
  let otherRow = '';
  if (Math.abs(residual) >= 0.01) {
    totCur += residual;
    otherRow = `<tr class="rt-pulse-tier-row rt-pulse-tier-other"><td>Other recurring tiers</td>`
      + `<td>—</td><td>${fmtMoney(residual, 0)}</td><td>—</td></tr>`;
  }
  const totGap = totCur - totPri;
  return `<div class="rt-pulse-tier-wrap"><table class="rt-table rt-striped rt-pulse-tier-table">`
    + `<thead><tr><th>Tier</th><th>Same day LY</th><th>This month</th><th>Gap</th></tr></thead>`
    + `<tbody>${rows}${otherRow}</tbody><tfoot><tr class="rt-grand-total">`
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
  const jlrBasisLabel = pulse.include_jlr ? 'JLR incl.' : 'non-JLR';

  let rows = glanceSection('This month')
    + glanceRow(`Booked so far (headline ${jlrBasisLabel})`, '-', fmtMoney(pulse.booked_nonjlr_so_far, 0), '-')
    + glanceRow(recurringBaselineLabel('Recurring baseline so far'), `Lumpy excluded ${fmtMoney(pulse.recurring_lumpy_excluded || 0, 0)}`,
      fmtMoney(rb.booked_so_far ?? pulse.recurring_baseline_so_far ?? 0, 0), basisBadge('recurring_baseline'), { htmlLabel: true })
    + glanceRow('Worst-case month-end (headline)', `Survival ${fmtMoney(DEFCON_SURVIVAL_LINE, 0)}`, fmtMoney(worstEnd, 0),
      pulse.defcon?.active ? `${pulse.defcon.pct_of_survival.toFixed(0)}% · ${fmtMoney(missSurvival, 0)} below` : '-',
      { neg: missSurvival > 0 })
    + glanceRow('Recurring projected (pace)', rb.closed_ytd_avg ? `YTD closed avg ${fmtMoney(rb.closed_ytd_avg, 0)}` : 'YTD recurring avg',
      fmtMoney(rb.linear_month_end ?? 0, 0), rb.defcon?.active ? `DEFCON ${rb.defcon.level}` : '-',
      { neg: (rb.defcon?.level || 0) >= 3 });

  if (pulse.defcon?.active) {
    rows += glanceRow('Best case (blended)', proj.blend_anchor_label || 'Prior-year same month',
      fmtMoney(proj.blended_month_end, 0), `DEFCON ${pulse.defcon.best_case.level}`, { neg: pulse.defcon.best_case.level >= 3 });
  }
  const ytdRecAvg = rbSummary.closedYtdRecurringAvg;
  const survivalLine = rbSummary.survivalLine || DEFCON_SURVIVAL_LINE;
  if (ytdRecAvg != null) {
    const ytdLabel = `Recurring avg (${rbSummary.closedYtdCount || 0}-mo YTD closed)`;
    rows += glanceRow(ytdLabel, `Survival ${fmtMoney(survivalLine, 0)}`, fmtMoney(ytdRecAvg, 0),
      fmtDelta(ytdRecAvg - survivalLine, ((ytdRecAvg - survivalLine) / survivalLine) * 100),
      { neg: ytdRecAvg < survivalLine });
  }

  rows += glanceSection('vs benchmarks');
  if (lySameDay) {
    rows += glanceRow(`Same day ${monthShort} last year`, fmtMoney(lySameDay.amount, 0),
      fmtMoney(pulse.booked_nonjlr_so_far, 0), fmtDelta(lySameDay.deltaGbp, lySameDay.deltaPct), { neg: (lySameDay.deltaGbp || 0) < 0 });
  }
  if (trail6) {
    rows += glanceRow('Trailing 6-mo same-day avg (headline)', fmtMoney(trail6.amount, 0), fmtMoney(pulse.booked_nonjlr_so_far, 0),
      fmtDelta(trail6.deltaGbp, trail6.deltaPct) + ' ' + basisBadge('headline_gross'), { neg: (trail6.deltaGbp || 0) < 0, htmlLabel: false });
  }
  const trail6Rec = pulse.comparisons?.trailing_6_same_day_recurring_avg;
  if (trail6Rec) {
    rows += glanceRow('Trailing 6-mo same-day avg (recurring)', fmtMoney(trail6Rec.amount, 0),
      fmtMoney(rb.booked_so_far ?? pulse.recurring_baseline_so_far ?? 0, 0),
      fmtDelta(trail6Rec.deltaGbp, trail6Rec.deltaPct) + ' ' + basisBadge('recurring_baseline'),
      { neg: (trail6Rec.deltaGbp || 0) < 0, htmlLabel: false });
  }
  if (lyFull > 0) {
    const dFull = (worstEnd || 0) - lyFull;
    rows += glanceRow(`${monthShort} last year (full month)`, fmtMoney(lyFull, 0), fmtMoney(worstEnd, 0),
      fmtDelta(dFull, (dFull / lyFull) * 100), { neg: dFull < 0 });
  }
  if (histLow != null) {
    const dLow = (worstEnd || 0) - histLow;
    rows += glanceRow(`Prior low (${jlrBasisLabel} history)`, fmtMoney(histLow, 0), fmtMoney(worstEnd, 0),
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

function renderPulseInvestigateList(pulse, gsc) {
  const items = [];
  const workshopNotes = [];
  for (const t of (pulse.tier_gaps || [])) {
    if ((t.gap_gbp || 0) >= -100) continue;
    if (PULSE_INVESTIGATE_SKIP_TIERS.has(t.tier_key) || VOLATILE_TIER_KEYS.has(t.tier_key)) {
      if (t.tier_key === 'workshops_non_residential') workshopNotes.push(t);
      continue;
    }
    if (!EXEC_SUMMARY_TIER_KEYS.has(t.tier_key)) continue;
    items.push(`<li><a href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(t.tier_key)}">${escapeHtml(t.label)}</a>: ${fmtMoney(t.gap_gbp, 0)} vs same day LY</li>`);
  }
  for (const r of (gsc.hub_declines || []).slice(0, 2)) {
    const slug = '/' + String(r.slug || '').replace(/^\/+/, '');
    items.push(`<li>${slugLink(slug, slug)}: ${Number(r.delta_pct).toFixed(0)}% impressions${r.trend_shape ? ` (${r.trend_shape})` : ''}</li>`);
  }
  if (!items.length && !workshopNotes.length) return '';
  const foot = workshopNotes.length
    ? `<p class="rt-pulse-investigate-foot">Note: ${workshopNotes.map((t) => `${t.label} ${fmtMoney(t.gap_gbp, 0)} vs LY`).join(' · ')} — expected volatility, low margin, not a rescue priority.</p>`
    : '';
  return `<h4 class="rt-pulse-numbers-subhead">Investigate (data signals)</h4>`
    + `<ul class="rt-pulse-investigate-list">${items.join('')}</ul>${foot}`;
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
    + `<div class="rt-pulse-verdict-legend">${escapeHtml(formatDefconLegend(DEFCON_SURVIVAL_LINE))}</div>`
    + `<div class="rt-pulse-verdict-sub">${escapeHtml(subParts.join(' · '))}</div></div>`;
}

function renderPulseInsight(summary, pulse) {
  const rb = summary?.recurringBaseline || {};
  const survival = rb.survivalLine || summary?.config?.tierBands?.survival || DEFCON_SURVIVAL_LINE;
  const avg = rb.closedYtdRecurringAvg;
  const months = rb.closedYtdCount || 0;
  const below = rb.ytdMonthsBelowSurvival || 0;
  let headline;
  let support;
  if (avg != null && avg < survival && months > 0) {
    const monthWord = months === 1 ? 'month' : 'months';
    headline = `Recurring baseline averaged ${fmtMoney(avg, 0)}/mo across ${months} closed ${monthWord} YTD`;
    support = `${below} of ${months} ${monthWord} below the ${fmtMoney(survival, 0)} survival floor — structural, not a one-month dip.`;
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
    const measures = (a.measures || []).map((m) => `<li>${escapeHtml(m)}</li>`).join('');
    const bd = (a.bd || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
    const cardLink = a.tierScroll
      ? `<a class="rt-pulse-card-link" href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(a.tierScroll)}">`
        + `Open ${escapeHtml(a.cardLabel || a.tierLabel)} in Sec. 9 diagnosis`
        + `</a>`
      : '';
    const pageLink = a.pageSlug
      ? `<a class="rt-pulse-page-link" href="https://www.alanranger.com/${escapeHtml(a.pageSlug)}" target="_blank" rel="noopener noreferrer">View live page /${escapeHtml(a.pageSlug)}</a>`
      : '';
    return `<details class="rt-pulse-action-item">`
      + `<summary class="rt-pulse-action-chip">`
      + `<span class="rt-pulse-chip-arrow" aria-hidden="true">▸</span>`
      + `<span class="rt-pulse-chip-body">`
      + `<span class="rt-pulse-chip-text">${escapeHtml(a.text)}</span>`
      + `<span class="rt-pulse-chip-tier">${escapeHtml(a.tierLabel)}</span>`
      + `</span></summary>`
      + `<div class="rt-pulse-action-expand">`
      + `<div class="rt-pulse-action-block"><h5>Simple measures</h5><ul>${measures}</ul></div>`
      + `<div class="rt-pulse-action-block"><h5>BD</h5><ul>${bd}</ul></div>`
      + `<div class="rt-pulse-action-links">${cardLink}${pageLink}</div>`
      + `</div></details>`;
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
    + renderPulseInvestigateList(pulse, gsc)
    + `<h4 class="rt-pulse-numbers-subhead">Tier breakdown (same day vs last year)</h4>`
    + tierGapRows(pulse.tier_gaps, pulse.recurring_baseline_so_far)
    + volatileNote
    + `</div></details>`;
}

export function renderCurrentMonthPulseHtml(summary, diagnosis) {
  const pulse = summary?.currentMonthPulse;
  if (!pulse) return '<div class="rt-loading">Loading live month&hellip;</div>';

  const fi = pulse.forecast_impact || {};
  const gsc = computePulseGscSignals(diagnosis);
  const tileCls = pulse.defcon?.active ? defconTileClass(pulse.defcon) : 'defcon-inactive';
  const actions = buildPulseRescueActions();

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
