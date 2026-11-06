/**
 * Revenue tab · "Where we are now": A (progress bars) then B (gauge tiles) for this month, year to date and the
 * full year, against the Targets panel (seasonal survival / stretch; flat bills line). One GP method: category
 * revenue × its GP rate (D2C + B2B categories). One forecast method, alternatives on hover.
 */
const GP_ORDERS = new Set([1, 2, 3, 6, 7, 10, 11, 12]);
const DEFCON_STEPS = [[1, 1], [0.75, 2], [0.5, 3], [0.3, 4]];
const DEFCON_COLOUR = { 1: '#22c55e', 2: '#a3c04a', 3: '#f0b429', 4: '#f59e0b', 5: '#ff6b6b' };

const gbp = (n) => (n < 0 ? '−£' : '£') + Math.abs(Math.round(Number(n) || 0)).toLocaleString('en-GB');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

/** Monthly GP and revenue of the D2C + B2B categories (JLR already applied by the summary). */
export function monthlyTotals(categoryBreakdown) {
  const out = new Map();
  for (const r of categoryBreakdown || []) {
    if (!GP_ORDERS.has(Number(r.category_order))) continue;
    const k = key(r.year, r.month);
    const cur = out.get(k) || { gp: 0, rev: 0 };
    cur.gp += Number(r.gpAmount) || 0;
    cur.rev += Number(r.revenue) || 0;
    out.set(k, cur);
  }
  return out;
}

export function defconLevel(value, survival) {
  if (!(survival > 0)) return 5;
  const pct = value / survival;
  const hit = DEFCON_STEPS.find(([f]) => pct >= f);
  return hit ? hit[1] : 5;
}

function trailingClosedAvg(totals, now, basis) {
  const closed = [...totals.keys()].filter((k) => k < key(now.year, now.month)).sort().slice(-3);
  if (!closed.length) return 0;
  return closed.reduce((a, k) => a + totals.get(k)[basis], 0) / closed.length;
}

function yearSum(totals, year, uptoMonth, basis) {
  let s = 0;
  for (let m = 1; m <= uptoMonth; m += 1) s += totals.get(key(year, m))?.[basis] || 0;
  return s;
}

/** Figures for one basis ('gp' | 'rev'). */
export function positionFigures(rtData, basis) {
  const now = rtData.config.now;
  const pulse = rtData.currentMonthPulse || {};
  const totals = monthlyTotals(rtData.categoryBreakdown);
  const t = rtData.businessTargets.position;
  const booked = totals.get(key(now.year, now.month))?.[basis] || 0;
  const elapsed = Math.max(1, Number(pulse.days_elapsed) || 1);
  const dim = Number(pulse.days_in_month) || 30;
  const pace = (booked / elapsed) * dim;
  const closedYtd = yearSum(totals, now.year, now.month - 1, basis);
  const t3 = trailingClosedAvg(totals, now, basis);
  const monthsAfter = 12 - now.month;
  return {
    basis, now, daysLeft: Number(pulse.days_remaining) || 0, booked, pace,
    ytd: closedYtd + booked,
    forecast: closedYtd + pace + t3 * monthsAfter,
    alternatives: [
      ['Closed months only (trailing-3 average × the rest of the year)', closedYtd + t3 * (monthsAfter + 1)],
      ['Booked so far, nothing more', closedYtd + booked]
    ],
    t3,
    targets: t[basis],
    bills: t.bills_line[basis],
    billsYtd: t.bills_line[basis] * (now.month - 1 + Number(t.day_fraction || 0))
  };
}

function pct(v, max) {
  return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
}

function barHtml(actual, projected, levels, bills) {
  const max = Math.max(levels.stretch2, projected, actual) || 1;
  const a = pct(actual, max);
  const p = pct(projected, max);
  const proj = p > a ? `<div class="proj" style="left:${a.toFixed(1)}%;width:${(p - a).toFixed(1)}%"></div>` : '';
  const mk = (v, cls, title) => `<div class="mk ${cls}" style="left:${pct(v, max).toFixed(1)}%" title="${esc(title)}"></div>`;
  return `<div class="bar"><div class="act" style="width:${a.toFixed(1)}%"></div>${proj}`
    + mk(levels.survival, 'sv', `Survival ${gbp(levels.survival)}`)
    + mk(levels.stretch1, 's1', `Stretch 1 ${gbp(levels.stretch1)}`)
    + mk(levels.stretch2, 's2', `Stretch 2 ${gbp(levels.stretch2)}`)
    + mk(bills, 'bl', `Bills line ${gbp(bills)}`) + '</div>';
}

function defconChip(level) {
  return `<span class="def" style="--dc:${DEFCON_COLOUR[level]}">DEFCON ${level}</span>`;
}

function rowsFor(f) {
  const u = f.basis === 'gp' ? 'GP' : 'revenue';
  const mon = new Date(Date.UTC(f.now.year, f.now.month - 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return [
    { label: 'This month', sub: `${mon} · ${f.daysLeft} days left`, value: f.pace, actual: f.booked, levels: f.targets.month, bills: f.bills,
      fig: `Booked <b>${gbp(f.booked)} ${u}</b> · pace <b>${gbp(f.pace)} ${u}</b>`, gapNote: `vs survival ${gbp(f.targets.month.survival)} (seasonal)` },
    { label: 'Year to date', sub: '1 Jan – today', value: f.ytd, actual: f.ytd, levels: f.targets.ytd, bills: f.billsYtd,
      fig: `Actual <b>${gbp(f.ytd)} ${u}</b> · survival by today ${gbp(f.targets.ytd.survival)}`, gapNote: 'vs survival to date' },
    { label: `Full year ${f.now.year}`, sub: 'forecast', value: f.forecast, actual: f.ytd, levels: f.targets.year, bills: f.bills * 12,
      fig: `Forecast <b>${gbp(f.forecast)} ${u}</b>`, gapNote: `vs survival ${gbp(f.targets.year.survival)}` }
  ];
}

function barsBlock(rows) {
  return rows.map((r) => {
    const gap = r.value - r.levels.survival;
    return `<div class="row"><div class="lbl"><b>${esc(r.label)}</b><span>${esc(r.sub)}</span><br>${defconChip(defconLevel(r.value, r.levels.survival))}</div>`
      + `<div><div class="fig">${r.fig}</div>${barHtml(r.actual, r.value, r.levels, r.bills)}</div>`
      + `<div class="gap"><b class="${gap < 0 ? 'neg' : 'pos'}">${gap < 0 ? '' : '+'}${gbp(gap)}</b><span>${esc(r.gapNote)}</span></div></div>`;
  }).join('');
}

function ring(pctOf, level) {
  const c = 2 * Math.PI * 62;
  const len = (Math.min(100, Math.max(0, pctOf)) / 100) * c;
  return `<div class="ring"><svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="62" fill="none" stroke="#1b2130" stroke-width="14"/>`
    + `<circle cx="75" cy="75" r="62" fill="none" stroke="${DEFCON_COLOUR[level]}" stroke-width="14" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 75 75)"/></svg>`;
}

function tilesBlock(rows, lines) {
  const what = ['of survival (pace)', 'of survival to date', 'of survival (forecast)'];
  return rows.map((r, i) => {
    const level = defconLevel(r.value, r.levels.survival);
    const p = r.levels.survival > 0 ? (r.value / r.levels.survival) * 100 : 0;
    const gap = r.value - r.levels.survival;
    return `<div class="tile"><h3>${esc(r.label)} · ${defconChip(level)}</h3>${ring(p, level)}`
      + `<div class="c"><b>${Math.round(p)}%</b><span>${what[i]}</span></div></div>`
      + `<div class="l">${lines[i]}</div><div class="g ${gap < 0 ? 'neg' : 'pos'}">${gap < 0 ? '' : '+'}${gbp(gap)}</div></div>`;
  }).join('');
}

function tileLines(f, rev) {
  const u = f.basis === 'gp' ? 'GP' : '';
  return [
    `Booked ${gbp(f.booked)} · pace ${gbp(f.pace)} ${u}<br>Survival ${gbp(f.targets.month.survival)} · ${f.daysLeft} days left`,
    `${gbp(f.ytd)} ${u} of ${gbp(f.targets.ytd.survival)}${f.basis === 'gp' ? `<br>Revenue ${gbp(rev.ytd)}` : ''}`,
    `Forecast ${gbp(f.forecast)} ${u} of ${gbp(f.targets.year.survival)}${f.basis === 'gp' ? `<br>Revenue ${gbp(rev.forecast)}` : ''}`
  ];
}

function footerHtml(f, rtData) {
  const alt = f.alternatives.map(([l, v]) => `${l}: ${gbp(v)}`).join('\n');
  const rb = rtData.recurringBaseline || {};
  const recurring = rb.closedYtdRecurringAvg != null
    ? `Recurring baseline ${gbp(rb.closedYtdRecurringAvg)}/mo revenue (${rb.closedYtdCount || 0} closed months this year; vouchers and redemptions excluded) vs ${gbp(rtData.businessTargets.position.rev.month.survival)} sales survival this month.`
    : '';
  const legend = `DEFCON 5 under 30% of survival · 4 30–49% · 3 50–74% · 2 75–99% · 1 at or above survival.`;
  return `<div class="foot"><span class="fc" title="${esc(alt)}">Forecast = year to date + this month at its current daily pace + the trailing-3-closed-month average (${gbp(f.t3)}) for each month left. Hover for other methods.</span>`
    + `<span>${esc(recurring)}</span><span>${esc(legend)} Bills line (dashed) = flat ${gbp(f.bills)} a month.</span></div>`;
}

export function renderPositionHtml(rtData, basis = 'gp') {
  if (!rtData?.businessTargets?.position || !rtData?.categoryBreakdown) return '<div class="rt-loading">Loading position…</div>';
  const f = positionFigures(rtData, basis);
  const rev = basis === 'gp' ? positionFigures(rtData, 'rev') : f;
  const rows = rowsFor(f);
  const btn = (b, l) => `<button type="button" data-pos-basis="${b}" aria-pressed="${b === basis}">${l}</button>`;
  return `<div class="pos-head"><div class="pos-seg">${btn('gp', 'GP')}${btn('rev', 'Revenue')}</div></div>`
    + `<div class="card">${barsBlock(rows)}</div>`
    + `<div class="card"><div class="tiles">${tilesBlock(rows, tileLines(f, rev))}</div></div>`
    + footerHtml(f, rtData);
}
