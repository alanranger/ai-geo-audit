/**
 * Strategy "Sales gap by month" (QUESTION-2026-11-09 (h)): rolling-quarter + 3 month tiles, the Remedy plan and four
 * quarter planning cards. Renders s.sales_gap from the strategy summary (server model lib/strategy-sales-gap.mjs);
 * no figures are computed here. Every £ is counted in the month the booking is made.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const gbpK = (v) => {
    const a = Math.abs(Number(v) || 0);
    return a >= 1000 ? `£${(Math.round(a / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(a).toLocaleString('en-GB')}`;
  };
  const dm = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const wdm = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const MONTH = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
  const mk = '<a href="#marketing" data-goto-marketing class="sg-a">';

  function bar(still, likely) {
    const lp = still > 0 ? Math.min(100, Math.round((likely / still) * 100)) : 100;
    return `<div class="sg-bar"><span class="sg-b1" style="width:${lp}%">${lp >= 14 ? gbpK(Math.min(likely, still)) : ''}</span><span class="sg-b2" style="width:${100 - lp}%">${100 - lp >= 22 ? `${gbpK(Math.max(0, still - likely))} non-dated needed` : ''}</span></div>`;
  }
  const row = (label, value, cls = '') => `<div class="sg-r ${cls}"><span>${label}</span><b>${value}</b></div>`;

  function workingHtml(m) {
    const stock = (m.stock.list || []).slice(0, 14).map((e) => `${esc(e.title)} ${dm(e.date)} × ${e.left} · ${gbp(e.price)}`).join(' · ');
    const rows = (m.working || []).slice(0, 12).map((w) => `<li><b>${esc(w.title)} ${dm(w.date)}</b>: ${w.this_month} places · ${gbp(w.this_month_gbp)} this month <span class="rt-sub">(likely ${w.likely_total} in total, damping ${w.damping}% · by booking month: ${esc(w.split)})</span></li>`).join('');
    return `<details class="sg-d"><summary>events &amp; working ▾</summary>`
      + `<p class="rt-sub"><b>Stock that can still be sold in ${esc(MONTH[m.label] || m.label)}</b> (${m.stock.events} events, ${m.stock.places} places; first ${Math.min(14, m.stock.list.length)}): ${stock || 'none'}</p>`
      + `<p class="rt-sub">Booked ahead for this month's events: <b>${gbpK(m.booked_ahead)}</b> (already counted in the month it was booked, not new cash).</p>`
      + (rows ? `<p class="rt-sub"><b>Likely bookings made this month, per event</b> (top ${Math.min(12, m.working.length)} of ${m.working.length}):</p><ul class="sg-w">${rows}</ul>` : '<p class="rt-sub">No likely bookings this month.</p>')
      + '</details>';
  }

  function monthCard(m) {
    const head = `<div class="sg-h"><b>${esc(MONTH[m.label] || m.label)}</b>${m.days_left != null ? `<span class="rt-sub">${m.days_left} days left</span>` : ''}</div>`;
    return `<div class="sg-card" data-sg-month="${esc(m.key)}">${head}<div class="sg-big">${gbpK(m.still_to_sell)} <span class="sg-u">of ${gbp(m.target)} still to sell</span></div>${bar(m.still_to_sell, m.likely)}`
      + row('Dated places sellable this month', `${gbpK(m.stock.gbp)} · ${m.stock.places} places`)
      + row('Likely bookings made this month (fill rate)', gbpK(m.likely))
      + row('Non-dated needed (likely)', gbpK(m.non_dated_needed), 'sg-amber')
      + row('Best case: every sellable place sells', gbpK(m.best_case), 'sg-grey')
      + `<div class="sg-v">${esc(m.verdict)}</div>${workingHtml(m)}</div>`;
  }
  function quarterTile(g) {
    const r = g.rolling;
    const m = g.months;
    return `<div class="sg-card sg-q"><div class="sg-h"><b>Quarter · ${dm(r.from)} → ${dm(r.to)}</b><span class="rt-sub">revenue</span></div><div class="sg-big">${gbpK(r.still_to_sell)} <span class="sg-u">still to sell</span></div>${bar(r.still_to_sell, r.likely)}`
      + row('Dated places sellable (stock)', `${gbpK(r.stock.gbp)} · ${r.stock.places} places · ${r.stock.events} events`)
      + row('Likely dated bookings (fill rate)', gbpK(r.likely))
      + row('Non-dated needed (likely)', gbpK(r.non_dated_needed), 'sg-amber')
      + row('Best case: every sellable place sells', gbpK(r.best_case), 'sg-grey')
      + `<div class="sg-v">On likely bookings, dated events cover about ${r.likely_share ?? '—'}% of the ${gbpK(r.still_to_sell)}. ${m.map((x) => `${x.label} ${gbpK(x.non_dated_needed)}`).join(' · ')} non-dated needed. See the Remedy plan below.</div></div>`;
  }

  /* ---------- Remedy plan ---------- */

  function lever1Html(l) {
    if (!l.rows.length) return '<span class="rt-sub">—</span>';
    return `<b>+${l.places} places · ${gbpK(l.gbp)}</b><div class="rt-sub">${l.rows.map((r) => `${mk}${esc(r.title)} ${dm(r.date)} +${r.places}</a>`).join(' · ')}</div>`;
  }
  function lever2Html(l) {
    const b = l.brief;
    if (l.too_late) return `<span class="rt-sub">Too late: under a median lead time (${esc(b.type)}) left; latest on-sale date was ${wdm(b.latest_on_sale)}</span>`;
    if (!l.events) return '<span class="rt-sub">—</span>';
    return `<b>+${l.events} event${l.events > 1 ? 's' : ''} · ~${gbpK(l.gbp)} likely</b><details class="sg-d"><summary>add-event brief ▾</summary><div class="rt-sub">${esc(b.type)} · ${b.cap} places · ${gbp(b.price)} · on sale by <b>${wdm(b.latest_on_sale)}</b> · likely ${gbpK(b.per_event)} each booked this month</div></details>`;
  }
  function lever3Html(l) {
    if (!(l.gbp > 0)) return '<span class="rt-sub">—</span>';
    const u = l.units;
    const p = l.unit_prices;
    return `<b>${gbpK(l.gbp)}</b><div class="rt-sub">≈ ${u.vouchers} × ${gbp(p.voucher)} vouchers, or ${u.one_to_ones} × ${gbp(p.one_to_one)} 1-2-1s, or ${u.pick_n_mix} Pick n Mix plans · ${mk}gift / Pick n Mix / 1-2-1 campaigns</a></div>`;
  }
  function remedyHtml(rp) {
    const rows = rp.rows.map((r) => `<tr><td class="left"><b>${esc(r.label)}</b>${r.days_left != null ? `<div class="rt-sub">${r.days_left} days</div>` : ''}</td>`
      + `<td class="left"><b class="sg-amber">${gbpK(r.gap)}</b><div class="rt-sub">${gbpK(r.non_dated_needed)} − ${gbpK(r.normal_non_dated)} normal non-dated</div></td>`
      + `<td class="left">${lever1Html(r.lever1)}</td><td class="left">${lever2Html(r.lever2)}</td><td class="left">${lever3Html(r.lever3)}</td>`
      + `<td class="left ${r.closes.yes ? 'sg-yes' : 'sg-no'}">${esc(r.closes.text)}</td></tr>`).join('');
    const t = rp.total;
    const total = `<tr class="sg-tot"><td class="left"><b>Total</b></td><td class="left"><b class="sg-amber">${gbpK(t.gap)}</b></td><td class="left">+${t.lever1_places} places · ${gbpK(t.lever1)}</td><td class="left">+${t.lever2_events} events · ${gbpK(t.lever2)}</td><td class="left">${gbpK(t.lever3)}</td><td></td></tr>`;
    return '<h3>Remedy plan: how to close each month (based on likely)</h3><p class="rt-sub">Gap after likely bookings and normal non-dated sales, closed by three levers in order of effort. The levers add up to the gap and recalculate as bookings arrive; each £ lands in the month the booking must be made.</p>'
      + `<table class="rt-table sg-rem"><thead><tr><th class="left">Month</th><th class="left">Gap after likely<div class="rt-sub">non-dated needed − normal non-dated</div></th><th class="left">1 · Sell existing places beyond normal fill</th><th class="left">2 · Add new dated events</th><th class="left">3 · Non-dated push</th><th class="left">Closes?</th></tr></thead><tbody>${rows}${total}</tbody></table>`;
  }

  /* ---------- quarter planning cards ---------- */

  function stockLine(q) {
    if (q.no_events_on_sale) return '<span class="rt-sub">no events on sale yet</span>';
    return `${gbpK(q.stock.gbp)} <span class="rt-sub">· ${q.stock.events} events · ${q.stock.places} places at full price</span>`;
  }
  function reconcileHtml(q) {
    if (!q.reconcile) return '';
    const parts = q.reconcile.parts.map((p) => `${esc(p.label)} ${p.raw_gap < 0 ? '−' : ''}${gbpK(Math.abs(p.raw_gap))}${p.in_tiles ? '' : ' (sold ' + gbpK(p.sold) + ')'}`).join(' + ');
    return `<div class="rt-sub sg-rec" title="target − sold, month by month">Reconciles with the months: ${parts} = ${gbpK(q.reconcile.sum_of_months)} ${q.reconcile.ok ? '✓' : '✗'}</div>`;
  }
  function planHtml(q) {
    if (q.no_events_on_sale) return `To plan: <b>${gbpK(q.to_plan)}</b> <span class="rt-sub">no events on sale yet: put this quarter's events on sale by ${wdm(q.plan_by)}</span>`;
    const by = q.plan_by_passed ? `plan-by date ${wdm(q.plan_by)} has passed: put any extra events on sale now` : `plan by ${wdm(q.plan_by)}`;
    return `To plan: <b>${gbpK(q.to_plan)}</b>${q.extra_events ? ` ≈ ${q.extra_events} extra events` : ''} <span class="rt-sub">· ${by}</span>`;
  }
  function quarterCard(q) {
    return `<div class="sg-card sg-qc sg-${esc(q.state)}"><div class="sg-h"><b>${esc(q.label)}</b><span class="rt-sub">${esc(q.state)}</span></div>`
      + row('Target · sold so far', `${gbpK(q.target)} · ${gbpK(q.sold)}`) + row('Still to sell', gbpK(q.still_to_sell))
      + `<div class="sg-r sg-col"><span>Dated places sellable in the quarter</span><b>${stockLine(q)}</b></div>`
      + row('Likely bookings made in the quarter', gbpK(q.likely))
      + row('Non-dated needed (likely)', `${gbpK(q.non_dated_needed)} <span class="rt-sub">· normal ${gbpK(q.normal_non_dated)}</span>`, 'sg-amber')
      + `<div class="sg-v">${planHtml(q)}</div>${reconcileHtml(q)}</div>`;
  }

  const STYLE = `<style>
    .sg-grid { display: grid; grid-template-columns: 1.15fr repeat(3, 1fr); gap: 0.75rem; }
    .sg-qgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; }
    @media (max-width: 1300px) { .sg-grid, .sg-qgrid { grid-template-columns: repeat(2, 1fr); } }
    .sg-card { background: #161b26; border: 1px solid #2a3142; border-radius: 10px; padding: 0.8rem 0.9rem; font-size: 0.86rem; min-width: 0; }
    .sg-card.sg-q { border-color: #f0a500; } .sg-card.sg-current { border-color: #f0a500; }
    .sg-h { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.2rem; }
    .sg-big { font-size: 1.6rem; font-weight: 700; color: #fff; } .sg-u { font-size: 0.8rem; font-weight: 400; color: #9aa4b2; }
    .sg-bar { display: flex; height: 14px; border-radius: 4px; overflow: hidden; background: #2a3142; margin: 0.35rem 0 0.5rem; font-size: 10px; line-height: 14px; color: #111; }
    .sg-b1 { background: #6aa6ff; padding-left: 3px; white-space: nowrap; } .sg-b2 { background: #f0b429; padding-left: 4px; white-space: nowrap; overflow: hidden; }
    .sg-r { display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.12rem 0; } .sg-r span { color: #b8c0cc; } .sg-r b { text-align: right; white-space: nowrap; }
    .sg-amber b, b.sg-amber { color: #f0b429; } .sg-grey b { color: #8b95a5; font-weight: 500; }
    .sg-v { margin-top: 0.45rem; padding: 0.45rem 0.55rem; border-radius: 6px; background: #2a2412; color: #f3d48a; font-size: 0.82rem; }
    .sg-d { margin-top: 0.4rem; } .sg-d summary { cursor: pointer; color: #8fb7ff; font-size: 0.8rem; }
    .sg-w { margin: 0.2rem 0 0; padding-left: 1rem; font-size: 0.78rem; } .sg-w li { margin-bottom: 0.15rem; } .sg-rem td { vertical-align: top; white-space: normal; }
    .sg-yes { color: #5fd38d; } .sg-no { color: #f0b429; } .sg-tot td { border-top: 2px solid #3a4256; }
    .sg-legend { font-size: 0.8rem; color: #9aa4b2; margin: 0.4rem 0 0; } .sg-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 10px; }
    .sg-rec { margin-top: 0.35rem; } .sg-a { color: #8fb7ff; }
    .sg-r.sg-col { flex-direction: column; gap: 0.1rem; } .sg-r.sg-col b { text-align: left; white-space: normal; }
  </style>`;

  function rulesHtml(g) {
    return `<details class="sg-d"><summary>Rules ▾</summary><ul class="rt-sub">${(g.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>`;
  }
  /** The three blocks: tiles (+ legend + rules), Remedy plan, quarter planning cards. */
  window.stSalesGapHtml = function stSalesGapHtml(s) {
    const g = s?.sales_gap;
    if (!g || g.error) return { tiles: `<h3>Sales gap</h3><p class="rt-sub">Sales gap unavailable: ${esc(g?.error || 'not in the strategy summary')}</p>`, remedy: '', quarters: '' };
    const tiles = `${STYLE}<h3>Sales gap this quarter: where the money has to come from</h3><p class="rt-sub">Each month: target still to sell → how much dated bookings are likely to cover (bookings made that month, for any event date) → what must come from non-dated sales (gifts, vouchers, 1-2-1s, Academy, Pick n Mix, commissions). Every £ is counted in the month the booking is made, never the event's month.</p>`
      + `<div class="sg-grid">${quarterTile(g)}${g.months.map(monthCard).join('')}</div>`
      + `<p class="sg-legend"><i style="background:#6aa6ff"></i>likely dated bookings made in the month <i style="background:#f0b429"></i>non-dated sales needed · dated places sellable = stock on sale, not revenue for the event's month · fill rate day ${Math.round(g.fill.day * 1000) / 10}% / residential ${Math.round(g.fill.residential * 1000) / 10}% / course ${Math.round(g.fill.course * 1000) / 10}%</p>${rulesHtml(g)}`;
    const quarters = `<h3>Quarter planning: what to put on sale for Q1–Q4</h3><p class="rt-sub">Same booking-month method per quarter. "To plan" = still to sell − likely − normal non-dated (same quarter last year), ≈ extra events at the all-events average likely £ per event.</p><div class="sg-qgrid">${g.quarters.map(quarterCard).join('')}</div>`;
    return { tiles, remedy: remedyHtml(g.remedy), quarters };
  };
})();
