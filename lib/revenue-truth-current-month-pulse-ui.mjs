/** D23 — Current Month Pulse UI (verdict / insight / actions). */

import {
  escapeHtml, fmtMoney, fmtN, basisBadge, BAND_COLOURS, slugLink, recurringBaselineLabel, VOLATILE_TIER_KEYS
} from './revenue-truth-ui-core.mjs';
import { computePulseGscSignals, defconTileClass, DEFCON_SURVIVAL_LINE, formatDefconLegend } from './revenue-truth-current-month-pulse.mjs';
import { EXEC_SUMMARY_TIER_KEYS } from './revenue-truth-exec-filters.mjs';
import { buildTierFactsMap, findSlugFacts } from './revenue-truth-live-facts.mjs';

const PULSE_INVESTIGATE_SKIP_TIERS = new Set(['workshops_non_residential', 'workshops_residential']);

/**
 * Curated rescue playbook (strategy text only) keyed by tier. The numbers and the
 * choice of *which* tiers surface are derived live from the diagnosis — see
 * buildPulseRescueActions. Keep prescriptive actions here; never hardcode figures.
 */
export const RESCUE_PLAYBOOK = {
  courses_masterclasses: {
    headline: 'Fix Courses funnel + Coventry hub rank',
    tierLabel: 'Courses / Masterclasses',
    cardLabel: 'Courses / Masterclasses tier card',
    pageSlug: 'photography-courses-coventry',
    measures: [
      'Refresh title/H1 for Coventry evening-class intent; lift CTR above the fold.',
      'Add price + next dates above the fold on the hub and product pages.',
      'Cross-link from /landscape-photography-workshops to Coventry course dates.'
    ],
    bd: [
      'Email past Coventry course buyers for the next cohort.',
      'Camera-club / Meetup partner post with a direct booking link.'
    ]
  },
  commissions: {
    headline: 'Re-open Commissions / Corporate pipeline',
    tierLabel: 'Commissions tier',
    cardLabel: 'Commissions tier card',
    pageSlug: 'professional-commercial-photographer-coventry',
    measures: [
      'Audit inquiry forms + GA4 events for the commercial/product pages.',
      'Review open quotes and stale leads in the CRM.',
      'Diagnose the most recent inquiry-to-booking gap as a pipeline freeze.'
    ],
    bd: [
      'Personal follow-up to recent corporate contacts.',
      'Re-open product photography outreach to agencies on retainer.'
    ]
  },
  academy: {
    headline: 'Rebuild Academy trial-to-paid conversion',
    tierLabel: 'Academy tier',
    cardLabel: 'Academy tier card',
    pageSlug: 'free-online-photography-course',
    measures: [
      'Fix day 7/12 paid nudges (trial→paid well below SaaS norms).',
      'Clarify the £59 vs £79 annual choice at signup.',
      'Audit Memberstack trial emails and the in-app upgrade path.'
    ],
    bd: [
      'Direct outreach to active trials before expiry.',
      'Survey non-converters: price, content gap, or timing?'
    ]
  },
  one_to_one_lessons: {
    headline: 'Restore 1-2-1 Lessons hub + package',
    tierLabel: '1-2-1 Lessons tier',
    cardLabel: '1-2-1 Lessons tier card',
    pageSlug: 'private-photography-lessons',
    measures: [
      'Republish the multi-lesson package prominently on the lessons page.',
      'Restore the primary CTA above the fold.',
      'Bundle online + in-person lesson upsell on booking confirmation.'
    ],
    bd: [
      'Email past 1-2-1 buyers with the package offer.',
      'Retarget site visitors who viewed lessons but did not book.'
    ]
  },
  mentoring: {
    headline: 'Reactivate Mentoring subscriptions',
    tierLabel: 'Mentoring tier',
    cardLabel: 'Mentoring tier card',
    pageSlug: 'photography-mentoring-online-assignments',
    measures: [
      'Re-promote the monthly subscription on the mentoring page.',
      'Reactivate lapsed subscribers with a returning-member offer.'
    ],
    bd: ['Personal outreach to past mentees about new assignment cycles.']
  }
};

/** Low-margin / volatile / adjustment tiers never qualify as high-margin rescues. */
const RESCUE_EXCLUDE_TIERS = new Set([
  'workshops_residential', 'workshops_non_residential',
  'pick_n_mix_inc', 'gift_vouchers_inc', 'prints_royalties'
]);
const RESCUE_MAX = 4;

function rescueScore(facts, gap) {
  const atRisk = facts.at_risk_gbp || 0;
  const negGap = Math.max(0, -(gap?.gap_gbp || 0));
  const decline = facts.yoy_25_26 != null && facts.yoy_25_26 < 0 ? Math.abs(facts.yoy_25_26) * 10 : 0;
  return atRisk + negGap + decline;
}

function buildRescueChip(facts, gap, diagnosis) {
  const play = RESCUE_PLAYBOOK[facts.tier_key] || {};
  const slugFacts = play.pageSlug ? findSlugFacts(diagnosis, play.pageSlug) : null;
  return {
    tierScroll: facts.tier_key,
    tierLabel: play.tierLabel || facts.label,
    cardLabel: play.cardLabel || `${facts.label} tier card`,
    pageSlug: play.pageSlug || null,
    text: play.headline || `Rescue ${facts.label}`,
    measures: play.measures || [`Review broken diagnostic pages in ${facts.label} (£${Math.round(facts.at_risk_gbp)} at risk).`],
    bd: play.bd || [],
    live: {
      at_risk_gbp: facts.at_risk_gbp,
      yoy_25_26: facts.yoy_25_26,
      y2026_ytd: facts.y2026_ytd,
      slug: slugFacts?.slug || null,
      impressions: slugFacts?.impressions ?? null,
      position: slugFacts?.position ?? null
    }
  };
}

/**
 * Derive the top high-margin rescue priorities from live data: rank non-volatile,
 * non-workshop tiers by £-at-risk + worst current-month gap + YoY decline, then
 * attach curated strategy text where a playbook entry exists.
 */
export function buildPulseRescueActions(diagnosis, pulse, includeJlr) {
  const facts = buildTierFactsMap(diagnosis, includeJlr);
  const gapByTier = new Map((pulse?.tier_gaps || []).map((g) => [g.tier_key, g]));
  const ranked = [];
  for (const f of facts.values()) {
    if (RESCUE_EXCLUDE_TIERS.has(f.tier_key)) continue;
    const gap = gapByTier.get(f.tier_key);
    const score = rescueScore(f, gap);
    if (score <= 0) continue;
    ranked.push({ f, gap, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, RESCUE_MAX).map(({ f, gap }) => buildRescueChip(f, gap, diagnosis));
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

function recurringYtdGlanceRow(rbSummary) {
  const ytdRecAvg = rbSummary.closedYtdRecurringAvg;
  if (ytdRecAvg == null) return '';
  const survivalLine = rbSummary.survivalLine || DEFCON_SURVIVAL_LINE;
  const ytdBasis = rbSummary.includeJlr ? 'JLR incl.' : 'non-JLR';
  const ytdLabel = `Recurring avg (${rbSummary.closedYtdCount || 0}-mo YTD, ${ytdBasis})`;
  return glanceRow(ytdLabel, `Survival ${fmtMoney(survivalLine, 0)}`, fmtMoney(ytdRecAvg, 0),
    fmtDelta(ytdRecAvg - survivalLine, ((ytdRecAvg - survivalLine) / survivalLine) * 100),
    { neg: ytdRecAvg < survivalLine });
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
  rows += recurringYtdGlanceRow(rbSummary);

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
    const basis = rb.includeJlr ? 'JLR incl.' : 'non-JLR';
    headline = `Recurring baseline (${basis}) averaged ${fmtMoney(avg, 0)}/mo across ${months} closed ${monthWord} YTD`;
    support = `${below} of ${months} ${monthWord} below the ${fmtMoney(survival, 0)} survival floor — structural, not a one-month dip.`;
  } else {
    headline = pulse.lead_message || 'Monitor recurring baseline alongside headline non-JLR.';
    support = pulse.defcon?.active
      ? `Booked ${fmtMoney(pulse.booked_nonjlr_so_far, 0)} so far · ${pulse.defcon.pct_of_survival.toFixed(0)}% of survival on worst-case pace.`
      : 'Live month data still building.';
  }
  return `<div class="rt-pulse-insight">`
    + `<div class="rt-pulse-insight-head">${escapeHtml(headline)}`
    + ` <span class="rt-prov-pill rt-prov-dynamic" title="Computed live from closed-month recurring baseline vs the configured survival floor.">Dynamic</span></div>`
    + `<div class="rt-pulse-insight-support">${escapeHtml(support)}</div></div>`;
}

function rescueLiveLine(live) {
  if (!live) return '';
  const bits = [];
  if (live.at_risk_gbp > 0) bits.push(`${fmtMoney(live.at_risk_gbp, 0)} at risk`);
  if (live.yoy_25_26 != null) bits.push(`2026 ${live.yoy_25_26 >= 0 ? '+' : ''}${live.yoy_25_26.toFixed(0)}% vs 2025`);
  if (live.slug && live.impressions != null) {
    const pos = live.position == null ? '' : `, pos ${live.position}`;
    bits.push(`/${escapeHtml(live.slug)}: ${fmtN(live.impressions)} imp${pos}`);
  }
  if (!bits.length) return '';
  return `<span class="rt-pulse-chip-live">${bits.join(' · ')}</span>`;
}

function renderRescueChip(a) {
  const measures = (a.measures || []).map((m) => `<li>${escapeHtml(m)}</li>`).join('');
  const bd = (a.bd || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
  const cardLink = a.tierScroll
    ? `<a class="rt-pulse-card-link" href="#rt-diag-section" data-rt-tier-scroll="${escapeHtml(a.tierScroll)}">`
      + `Open ${escapeHtml(a.cardLabel || a.tierLabel)} in Sec. 9 diagnosis</a>`
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
    + rescueLiveLine(a.live)
    + `</span></summary>`
    + `<div class="rt-pulse-action-expand">`
    + `<div class="rt-pulse-action-block"><h5>Simple measures</h5><ul>${measures}</ul></div>`
    + `<div class="rt-pulse-action-block"><h5>BD</h5><ul>${bd}</ul></div>`
    + `<div class="rt-pulse-action-links">${cardLink}${pageLink}</div>`
    + `</div></details>`;
}

function renderPulseActionsZone(actions) {
  const head = `<h4 class="rt-pulse-actions-head">What to do next`
    + ` <span class="rt-prov-pill rt-prov-hybrid" title="Which tiers surface + the £/GSC figures are computed live from the diagnosis; the prescriptive measures are curated.">Hybrid: live ranking + curated actions</span></h4>`;
  if (!actions.length) {
    return `<div class="rt-pulse-actions-zone">${head}`
      + `<p class="rt-sub">No high-margin tier is showing £-at-risk or decline right now.</p></div>`;
  }
  const chips = actions.map(renderRescueChip).join('');
  return `<div class="rt-pulse-actions-zone">${head}`
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
  const actions = buildPulseRescueActions(diagnosis, pulse, pulse.include_jlr);

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
