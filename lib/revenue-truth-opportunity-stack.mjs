/** Revenue Recovery Opportunities — curated levers/uplift + live-derived metrics. */

import { escapeHtml, escapeAttr, fmtMoney, fmtN } from './revenue-truth-ui-core.mjs';
import { buildTierFactsMap, findSlugFacts, driftPct } from './revenue-truth-live-facts.mjs';

export const OPPORTUNITY_GROUPS = [
  { id: 'A', label: 'GROUP A — RESTORE', badge: 'RESTORE', color: '#22c55e', tagline: '(High confidence — bring back what worked)' },
  { id: 'B', label: 'GROUP B — SCALE', badge: 'SCALE', color: '#3b82f6', tagline: '(High confidence — scale what\'s working)' },
  { id: 'C', label: 'GROUP C — AMPLIFY', badge: 'AMPLIFY', color: '#f59e0b', tagline: '(Hub ranking amplifiers — indirect £)' },
  { id: 'D', label: 'GROUP D — SMALL', badge: 'SMALL', color: '#94a3b8', tagline: '(Smaller plays)' }
];

// `baseline_y2026` = canonical non-JLR tier revenue (2026 YTD) at authoring time;
// used only to flag drift vs live. `primary_slug` drives the live GSC lookup.
export const OPPORTUNITY_STACK = [
  { id: 1, group: 'A', lever: 'Re-launch £360 4-for-3 Package', tier: '1-2-1 Lessons', tier_anchor: 'one_to_one_lessons', primary_slug: 'private-photography-lessons', baseline_y2026: 1440, evidence: '£5,040 (2024) → £0 (2026). Pure unlisted-product effect.', low: 1500, mid: 2500, high: 3500, difficulty: 'LOW', confidence: 'HIGH', first_action: 'Republish package on /private-photography-lessons + email past buyers' },
  { id: 2, group: 'A', lever: 'Restore /private-photography-lessons hub', tier: '1-2-1 Lessons', tier_anchor: 'one_to_one_lessons', primary_slug: 'private-photography-lessons', baseline_y2026: 1440, evidence: '£6,827 (2024) → £936 ann (2026). 9,831 imp/yr remain.', low: 2000, mid: 3500, high: 5000, difficulty: 'LOW', confidence: 'HIGH', first_action: 'Restore primary CTA above fold + republish 4-for-3 package' },
  { id: 3, group: 'A', lever: 'Revive Commercial/Product Shoot product', tier: 'Commissions', tier_anchor: 'commissions', primary_slug: 'professional-commercial-photographer-coventry', baseline_y2026: 2245, evidence: '£7,262 (2024) → £570 YTD (-92%). Pipeline froze 17 Apr.', low: 1500, mid: 3000, high: 4500, difficulty: 'MED', confidence: 'MED', first_action: 'Outreach to past 2024 commercial clients + agency retainer pitches' },
  { id: 4, group: 'A', lever: 'Fix /professional-commercial-photographer-coventry conversion', tier: 'Commissions', tier_anchor: 'commissions', primary_slug: 'professional-commercial-photographer-coventry', baseline_y2026: 2245, evidence: '£7,512 (2024) → £3,048 ann. 9,419 imp/yr still there.', low: 1000, mid: 2000, high: 3500, difficulty: 'MED', confidence: 'MED', first_action: 'Diagnose 17 Apr inquiry stop; CRM + GA4 event audit' },
  { id: 5, group: 'B', lever: 'Add 4th cohort of Beginners 3-Weekly Course', tier: 'Courses / Masterclasses', tier_anchor: 'courses_masterclasses', primary_slug: null, baseline_y2026: 2390, evidence: '£1,045 (2025) → £4,896 ann (2026). Proven product.', low: 1000, mid: 2500, high: 4000, difficulty: 'LOW', confidence: 'HIGH', first_action: 'Schedule autumn cohort + email past Coventry course buyers' },
  { id: 6, group: 'B', lever: 'Fix Academy trial-to-paid funnel (£59/£79)', tier: 'Academy', tier_anchor: 'academy', primary_slug: 'free-online-photography-course', baseline_y2026: 1303, evidence: '£990 (2025) → £3,127 ann (2026). ~4% trial→paid vs 10-25% SaaS norm.', low: 2000, mid: 4500, high: 8000, difficulty: 'MED', confidence: 'MED', first_action: 'Audit Memberstack day 7/12 nudges; clarify £59 vs £79 at signup' },
  { id: 7, group: 'C', lever: 'Rank /photography-courses-coventry pos 26 → top 10', tier: 'Courses hub', tier_anchor: 'courses_masterclasses', primary_slug: 'photography-courses-coventry', baseline_y2026: 2390, evidence: '70k imp/yr, 604 clicks/yr. Hub routes to product pages.', low: 1500, mid: 3500, high: 6000, difficulty: 'HIGH', confidence: 'MED', first_action: 'Refresh title/H1 for Coventry evening-class intent; lift CTR' },
  { id: 8, group: 'C', lever: 'Fix /hire-a-professional-photographer-in-coventry hub', tier: 'Commissions hub', tier_anchor: 'commissions', primary_slug: 'hire-a-professional-photographer-in-coventry', baseline_y2026: 2245, evidence: '45k imp/yr, 188 clicks/yr. Routes to commercial/portrait/corporate pages.', low: 1000, mid: 2500, high: 4500, difficulty: 'MED', confidence: 'LOW', first_action: 'Add clear pricing tiers + inquiry form + portfolio above fold' },
  { id: 9, group: 'D', lever: 'Mentoring Monthly Subscription rescue', tier: 'Mentoring', tier_anchor: 'mentoring', primary_slug: 'photography-mentoring-online-assignments', baseline_y2026: 100, evidence: '£1,080 (2024) → £240 ann (2026). Small but recurring.', low: 500, mid: 800, high: 1200, difficulty: 'LOW', confidence: 'MED', first_action: 'Re-promote on /photography-mentoring-online-assignments; reactivate lapsed subs' }
];

const DIFF_RANK = { LOW: 0, MED: 1, HIGH: 2 };
const CONF_RANK = { LOW: 0, MED: 1, HIGH: 2 };
const FILTERS = [
  { id: 'all', label: 'All (9)' },
  { id: 'group_a', label: 'Group A only' },
  { id: 'ab', label: 'A + B' },
  { id: 'quick_wins', label: 'Quick wins (LOW + HIGH conf)' }
];

const TIER_PILL = {
  '1-2-1 Lessons': 'rt-opp-tier-121',
  Commissions: 'rt-opp-tier-comm',
  'Commissions hub': 'rt-opp-tier-comm',
  'Courses / Masterclasses': 'rt-opp-tier-courses',
  'Courses hub': 'rt-opp-tier-courses',
  Academy: 'rt-opp-tier-academy',
  Mentoring: 'rt-opp-tier-mentoring'
};

function sortVal(row, col) {
  if (col === 'num') return row.id;
  if (col === 'lever') return row.lever.toLowerCase();
  if (col === 'tier') return row.tier.toLowerCase();
  if (col === 'low' || col === 'mid' || col === 'high') return row[col];
  if (col === 'diff') return DIFF_RANK[row.difficulty] ?? 9;
  if (col === 'conf') return CONF_RANK[row.confidence] ?? 9;
  return row.mid;
}

export function filterOpportunityRows(filterId) {
  if (filterId === 'group_a') return OPPORTUNITY_STACK.filter((r) => r.group === 'A');
  if (filterId === 'ab') return OPPORTUNITY_STACK.filter((r) => r.group === 'A' || r.group === 'B');
  if (filterId === 'quick_wins') return OPPORTUNITY_STACK.filter((r) => r.difficulty === 'LOW' && r.confidence === 'HIGH');
  return OPPORTUNITY_STACK.slice();
}

export function sortOpportunityRowsInGroups(rows, sortCol = 'mid', sortDir = 'desc') {
  const byGroup = new Map(OPPORTUNITY_GROUPS.map((g) => [g.id, []]));
  for (const r of rows) (byGroup.get(r.group) || byGroup.set(r.group, []).get(r.group)).push(r);
  const out = [];
  for (const g of OPPORTUNITY_GROUPS) {
    const list = (byGroup.get(g.id) || []).slice().sort((a, b) => {
      const cmp = sortVal(a, sortCol) < sortVal(b, sortCol) ? -1 : sortVal(a, sortCol) > sortVal(b, sortCol) ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    out.push(...list);
  }
  return out;
}

export function computeOpportunityTotals(rows) {
  return rows.reduce((t, r) => ({
    low: t.low + r.low,
    mid: t.mid + r.mid,
    high: t.high + r.high,
    count: t.count + 1
  }), { low: 0, mid: 0, high: 0, count: 0 });
}

function pill(level, kind) {
  const cls = kind === 'diff' ? `rt-opp-pill-diff-${level.toLowerCase()}` : `rt-opp-pill-conf-${level.toLowerCase()}`;
  return `<span class="rt-opp-pill ${cls}">${escapeHtml(level)}</span>`;
}

function tierPill(tier) {
  const cls = TIER_PILL[tier] || 'rt-opp-tier-default';
  return `<span class="rt-pill rt-opp-tier-pill ${cls}">${escapeHtml(tier)}</span>`;
}

function sortArrow(col, sortCol, sortDir) {
  if (col !== sortCol) return '↕';
  return sortDir === 'asc' ? '↑' : '↓';
}

function groupHeader(g) {
  return `<tr class="rt-opp-group-head" data-rt-opp-group="${g.id}" style="--rt-opp-group-color:${g.color}">`
    + `<td colspan="9"><span class="rt-opp-group-label">${escapeHtml(g.label)}</span>`
    + `<span class="rt-opp-group-tag">${escapeHtml(g.tagline)}</span></td></tr>`;
}

let oppLiveFacts = null;

/** Wire live diagnosis facts in so rows can show current numbers + drift. */
export function setOpportunityLiveFacts(diagnosis, includeJlr) {
  oppLiveFacts = diagnosis ? { tiers: buildTierFactsMap(diagnosis, includeJlr), diagnosis } : null;
}

function driftBadge(r, f) {
  if (r.baseline_y2026 == null) return '';
  const d = driftPct(r.baseline_y2026, f.y2026_nonjlr);
  if (d == null || Math.abs(d) < 20) return '';
  const sign = d >= 0 ? '+' : '';
  return ` <span class="rt-opp-drift" title="Curated baseline ${fmtMoney(r.baseline_y2026, 0)} (non-JLR 2026 YTD) · live ${fmtMoney(f.y2026_nonjlr, 0)}">⟳ updated ${sign}${d}%</span>`;
}

function liveBits(r, f) {
  const bits = [`${fmtMoney(f.y2026_ytd, 0)} 2026 YTD`];
  if (f.yoy_25_26 != null) bits.push(`${f.yoy_25_26 >= 0 ? '+' : ''}${f.yoy_25_26.toFixed(0)}% vs 2025`);
  if (f.at_risk_gbp > 0) bits.push(`${fmtMoney(f.at_risk_gbp, 0)} at risk`);
  const sf = r.primary_slug ? findSlugFacts(oppLiveFacts.diagnosis, r.primary_slug) : null;
  if (sf) {
    const pos = sf.position == null ? '' : `, pos ${sf.position}`;
    bits.push(`/${escapeHtml(sf.slug)}: ${fmtN(sf.impressions)} imp${pos}`);
  }
  return bits;
}

function liveMetricsBlock(r) {
  if (!oppLiveFacts) return '';
  const f = oppLiveFacts.tiers.get(r.tier_anchor);
  if (!f) return '';
  return `<p class="rt-opp-live"><strong>Live (tier, auto):</strong> ${liveBits(r, f).join(' · ')}${driftBadge(r, f)}</p>`;
}

function dataRow(r, expanded) {
  const rowId = `row_${r.id}`;
  const open = expanded.has(rowId);
  return `<tr class="rt-opp-row" data-rt-opp-row="${rowId}" data-tier-anchor="${escapeAttr(r.tier_anchor)}" tabindex="0">`
    + `<td class="rt-opp-num">${r.id}</td>`
    + `<td class="rt-opp-lever">${escapeHtml(r.lever)}</td>`
    + `<td>${tierPill(r.tier)}</td>`
    + `<td class="rt-opp-money rt-opp-low">${fmtMoney(r.low, 0)}</td>`
    + `<td class="rt-opp-money rt-opp-mid">${fmtMoney(r.mid, 0)}</td>`
    + `<td class="rt-opp-money rt-opp-high">${fmtMoney(r.high, 0)}</td>`
    + `<td>${pill(r.difficulty, 'diff')}</td>`
    + `<td>${pill(r.confidence, 'conf')}</td>`
    + `<td class="rt-opp-action"><button type="button" class="rt-opp-chevron${open ? ' is-open' : ''}" data-rt-opp-chevron="${rowId}" aria-expanded="${open ? 'true' : 'false'}" aria-label="Toggle detail">▸</button></td>`
    + `</tr>`
    + `<tr class="rt-opp-detail${open ? '' : ' is-collapsed'}" data-rt-opp-detail="${rowId}">`
    + `<td colspan="9"><div class="rt-opp-detail-inner">`
    + liveMetricsBlock(r)
    + `<p><strong>Evidence (curated):</strong> ${escapeHtml(r.evidence)}</p>`
    + `<p><strong>First action:</strong> ${escapeHtml(r.first_action)}</p>`
    + `<p><a href="#rt-diag-section" class="rt-opp-tier-link" data-rt-tier-scroll="${escapeAttr(r.tier_anchor)}">Open tier diagnosis →</a></p>`
    + `</div></td></tr>`;
}

function totalsStrip(totals, highlightMid = true) {
  const midCls = highlightMid ? ' rt-opp-total-mid-highlight' : '';
  return `<div class="rt-opp-totals">`
    + `<div class="rt-opp-total-cell"><div class="rt-opp-total-label">LOW (conservative)</div><div class="rt-opp-total-val">${fmtMoney(totals.low, 0)}</div></div>`
    + `<div class="rt-opp-total-cell${midCls}"><div class="rt-opp-total-label">MID (realistic)</div><div class="rt-opp-total-val rt-opp-total-val-mid">${fmtMoney(totals.mid, 0)}</div></div>`
    + `<div class="rt-opp-total-cell"><div class="rt-opp-total-label">HIGH (stretch)</div><div class="rt-opp-total-val">${fmtMoney(totals.high, 0)}</div></div>`
    + `</div>`
    + `<p class="rt-opp-totals-note">Mid-case ${fmtMoney(totals.mid, 0)}/yr realistic recovery ≈ 2x current recurring baseline. Sum of all ${totals.count} levers below.</p>`;
}

export function renderOpportunityStackHtml(state = {}) {
  const filter = state.filter || 'all';
  const sortCol = state.sortCol || 'mid';
  const sortDir = state.sortDir || 'desc';
  const expanded = state.expanded instanceof Set ? state.expanded : new Set(state.expanded || []);
  const filtered = filterOpportunityRows(filter);
  const totals = computeOpportunityTotals(filtered);
  const grouped = new Map(OPPORTUNITY_GROUPS.map((g) => [g.id, []]));
  for (const r of sortOpportunityRowsInGroups(filtered, sortCol, sortDir)) grouped.get(r.group).push(r);

  const filterBtns = FILTERS.map((f) =>
    `<button type="button" class="rt-opp-filter${f.id === filter ? ' is-active' : ''}" data-rt-opp-filter="${f.id}">${escapeHtml(f.label)}</button>`
  ).join('');

  const th = (col, label, cls = '') =>
    `<th class="rt-opp-sort-th${sortCol === col ? ' is-sorted' : ''} ${cls}" data-rt-opp-sort="${col}">${label} <span class="rt-opp-sort-ind">${sortArrow(col, sortCol, sortDir)}</span></th>`;

  let body = '';
  for (const g of OPPORTUNITY_GROUPS) {
    const rows = grouped.get(g.id) || [];
    if (!rows.length) continue;
    body += groupHeader(g);
    body += rows.map((r) => dataRow(r, expanded)).join('');
  }

  const foot = `<tr class="rt-opp-foot"><td colspan="3">TOTAL (${totals.count} levers)</td>`
    + `<td class="rt-opp-money rt-opp-low">${fmtMoney(totals.low, 0)}</td>`
    + `<td class="rt-opp-money rt-opp-mid rt-opp-foot-mid">${fmtMoney(totals.mid, 0)}</td>`
    + `<td class="rt-opp-money rt-opp-high">${fmtMoney(totals.high, 0)}</td><td colspan="3"></td></tr>`;

  return totalsStrip(totals)
    + `<div class="rt-opp-toolbar"><div class="rt-opp-filters">${filterBtns}</div></div>`
    + `<div class="rt-opp-table-wrap"><table class="rt-table rt-opp-table"><thead><tr>`
    + th('num', '#', 'rt-opp-col-num') + th('lever', 'LEVER') + th('tier', 'TIER')
    + th('low', 'LOW £', 'rt-opp-col-money') + th('mid', 'MID £', 'rt-opp-col-money') + th('high', 'HIGH £', 'rt-opp-col-money')
    + th('diff', 'DIFF') + th('conf', 'CONF') + `<th class="rt-opp-col-action">ACTION</th>`
    + `</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`
    + `<p class="rt-opp-legend">Difficulty: LOW = page tweak/email · MED = funnel rebuild · HIGH = SEO/ranking change. Confidence: HIGH = proven historical revenue · MED = demand exists, conversion unproven · LOW = speculative.</p>`;
}

let oppState = { filter: 'all', sortCol: 'mid', sortDir: 'desc', expanded: new Set() };
let oppBound = false;

function refreshOpportunityBody(section) {
  const body = section?.querySelector('#rt-opportunity-stack-body');
  if (body) body.innerHTML = renderOpportunityStackHtml(oppState);
}

export function getOpportunityStackState() {
  return oppState;
}

export function setOpportunityStackState(next) {
  oppState = { ...oppState, ...next, expanded: next.expanded ?? oppState.expanded };
}

export function bindOpportunityStack(section, onTierScroll) {
  if (!section || oppBound) return;
  oppBound = true;
  section.addEventListener('click', (e) => {
    const chev = e.target.closest('[data-rt-opp-chevron]');
    if (chev) {
      e.stopPropagation();
      const id = chev.getAttribute('data-rt-opp-chevron');
      const next = new Set(oppState.expanded);
      if (next.has(id)) next.delete(id); else next.add(id);
      setOpportunityStackState({ expanded: next });
      refreshOpportunityBody(section);
      return;
    }
    const filterBtn = e.target.closest('[data-rt-opp-filter]');
    if (filterBtn) {
      setOpportunityStackState({ filter: filterBtn.getAttribute('data-rt-opp-filter') });
      refreshOpportunityBody(section);
      return;
    }
    const sortTh = e.target.closest('[data-rt-opp-sort]');
    if (sortTh) {
      const col = sortTh.getAttribute('data-rt-opp-sort');
      const sortDir = oppState.sortCol === col && oppState.sortDir === 'asc' ? 'desc' : 'asc';
      setOpportunityStackState({ sortCol: col, sortDir });
      refreshOpportunityBody(section);
      return;
    }
    const tierLink = e.target.closest('[data-rt-tier-scroll]');
    if (tierLink) {
      e.preventDefault();
      onTierScroll?.(tierLink.getAttribute('data-rt-tier-scroll'));
      return;
    }
    const row = e.target.closest('.rt-opp-row');
    if (row) onTierScroll?.(row.getAttribute('data-tier-anchor'));
  });
}
