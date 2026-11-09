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

  /** Quarter tile £: always one decimal in £k (£0.6k, £15.0k), as in Alan's approved mock-up. */
  const k1 = (v) => `£${(Math.round((Number(v) || 0) / 100) / 10).toFixed(1)}k`;
  const pct = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`);
  /** Committed work (allocated, delivery pending) taken off "Still to find": named only when it is above £0. */
  const hasCommitted = (v) => Math.round(Number(v) || 0) > 0;
  const committedTxt = (v, fmt = gbpK) => (hasCommitted(v) ? ` − committed ${fmt(v)}` : '');
  const committedPart = (v) => (hasCommitted(v) ? ` · committed ${gbpK(v)}` : '');
  /** Enquiries about dated events (weighted, capped by places) taken off "Still to find": named only above £0. */
  const datedTxt = (v, fmt = gbpK) => (hasCommitted(v) ? ` − dated-event enquiries ${fmt(v)}` : '');
  const datedPart = (v) => (hasCommitted(v) ? ` · dated-event ${gbpK(v)}` : '');

  function bar(still, likely, quarter = false, minB = 22) {
    const lp = still > 0 ? Math.min(100, Math.round((likely / still) * 100)) : 100;
    const fmt = quarter ? k1 : gbpK;
    const a = lp >= 14 ? `${fmt(Math.min(likely, still))}${quarter ? ' likely dated' : ''}` : '';
    const b = 100 - lp >= minB ? `${fmt(Math.max(0, still - likely))} non-dated${quarter ? '' : ' needed'}` : '';
    return `<div class="sg-bar"><span class="sg-b1" style="width:${lp}%">${a}</span><span class="sg-b2" style="width:${100 - lp}%">${b}</span></div>`;
  }
  const row = (label, value, cls = '') => `<div class="sg-r ${cls}"><span>${label}</span><b>${value}</b></div>`;

  const evList = (list, max) => (list || []).slice(0, max).map((e) => `${esc(e.title)} ${dm(e.date)} × ${e.left}`).join(' · ') + ((list || []).length > max ? ` · +${list.length - max} more` : '');
  /** "Show the working" (Rules): per-event likely working + on-sale stock outside the prime window, for GPT and checking. */
  function workingHtml(m) {
    const rows = (m.working || []).slice(0, 12).map((w) => `<li><b>${esc(w.title)} ${dm(w.date)}</b>: ${w.this_month} places · ${gbp(w.this_month_gbp)} this month <span class="rt-sub">(likely ${w.likely_total} in total, damping ${w.damping}% · by booking month: ${esc(w.split)})</span></li>`).join('');
    return `<details class="sg-d sg-wk"><summary>${esc(MONTH[m.label] || m.label)}: working ▾</summary>`
      + `<p class="rt-sub">${esc(m.label)}: in prime buying window ${m.prime.events} events, ${m.prime.places} places: ${evList(m.prime.list, 30) || 'none'}</p>`
      + `<p class="rt-sub sg-small">On-sale stock outside the prime window (${m.outside.events} events, ${m.outside.places} places): ${evList(m.outside.list, 40) || 'none'}</p>`
      + (rows ? `<p class="rt-sub"><b>Likely bookings made this month, per event</b> (top ${Math.min(12, m.working.length)} of ${m.working.length}):</p><ul class="sg-w">${rows}</ul>` : '<p class="rt-sub">No likely bookings this month.</p>')
      + '</details>';
  }

  /* ---------- monthly tiles (v2, same style as the quarter tile) ---------- */

  /** QUESTION (s): monthly "If all sold" overlaps between months (an event can be prime in more than one month). */
  const ifAllSoldTip = (g) => 'Full-price value of the unsold places on the events people normally book this month. The same event can be in its buying window in more than one month, '
    + `so these figures overlap and don't add up to the quarter's ${k1(g?.rolling?.stock?.gbp)} stock.`;
  /** ⓘ with a tooltip on hover, keyboard focus and tap (the click handler below toggles it for touch). */
  const tipIcon = (tip) => `<span class="sg-tip" data-sg-tip tabindex="0" role="button" aria-label="What If all sold means" aria-expanded="false">ⓘ<span class="sg-tipb" role="tooltip">${esc(tip)}</span></span>`;
  function monthTableHtml(c, tip) {
    if (!c) return '';
    return `<div class="sg-qt">Events people book this month <span class="sg-u">(prime buying window)</span></div><table class="sg-qtab sg-mcat"><thead><tr><th class="left">Category</th><th>Events</th><th>Places</th><th>If all sold ${tipIcon(tip)}</th><th>Fill rate</th><th>Likely £</th></tr></thead>`
      + `<tbody>${c.rows.map((r) => catRow(r)).join('')}${catRow(c.total, 'sg-qtot', tip)}</tbody></table>`;
  }
  function pushHtml(p) {
    const groups = (p?.groups || []).map((g) => `<div class="sg-pg"><b>${esc(g.label)}</b><ul>${g.list.map((e) => `<li>${wdm(e.date)} · ${esc(e.title)} · ${e.left} place${e.left === 1 ? '' : 's'} left · ${gbp(e.price)}</li>`).join('')}</ul></div>`).join('');
    const retired = (p?.retired || []).length ? `<p class="sg-qdp rt-sub">Not pushed (retired from promotion by Alan, still on sale): ${p.retired.map((e) => `${esc(e.title)} ${dm(e.date)}`).join(' · ')}</p>` : '';
    return `<p class="sg-qdp"><b>Events to push this month</b></p>${groups || '<p class="sg-qdp rt-sub">none</p>'}${retired}`;
  }
  function monthNormalHtml(m) {
    const cats = (m.normal_cats || []).filter((x) => Math.round(x.gbp)).map((x) => `${esc(x.label)} ${gbp(x.gbp)}`).join(' · ') || 'none';
    return `<p class="sg-qdp"><b>Normal non-dated sales, same month last year: ${gbp(m.normal_non_dated)}</b> · ${cats}</p>`
      + `<p class="sg-qdp"><b>Still to find after normal and pipeline${datedTxt(m.dated_event_gbp, gbp)}${committedTxt(m.committed_gbp, gbp)}: <span class="sg-amber">${gbp(m.still_to_find)}</span></b></p>`;
  }
  function monthDetailsHtml(m) {
    return `<details class="sg-d sg-qd sg-md"><summary>details</summary>${pushHtml(m.push)}`
      + `<p class="sg-qdp"><b>Booked ahead for this month's events: ${gbp(m.booked_ahead)}</b> (already counted in the month it was booked).</p>${monthNormalHtml(m)}</details>`;
  }
  function monthCard(m, tip, cover) {
    const head = `<div class="sg-h"><b>${esc(MONTH[m.label] || m.label)}</b>${m.days_left != null ? `<span class="rt-sub">${m.days_left} days left</span>` : ''}</div>`;
    const sub = m.current ? `of ${gbp(m.target)} still to sell · ${gbp(m.sold)} sold` : 'still to sell';
    const c = (cover?.months || []).find((x) => x.key === m.key);
    return `<div class="sg-card sg-m" data-sg-month="${esc(m.key)}">${head}<div class="sg-big">${k1(m.still_to_sell)} <span class="sg-u">${sub}</span></div>${bar(m.still_to_sell, m.likely, true, 10)}${coverBarHtml(c?.bar)}`
      + `${monthTableHtml(m.categories, tip)}<div class="sg-mnd"><span>Non-dated needed</span><b>${k1(m.non_dated_needed)}</b></div>`
      + '<div class="sg-ndnote">From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints &amp; royalties.</div>'
      + `${agreedBox(m.key, { keys: [m.key], quarter: false, bar: c?.bar })}${monthDetailsHtml(m)}</div>`;
  }

  /* ---------- "How it's covered" bar (QUESTION (dd)): segments from the shared cover calculation (sales_gap.cover) ---------- */

  const SEG_CLS = { events: 'sg-s-ev', event_enquiries: 'sg-s-eq', normal: 'sg-s-no', agreed: 'sg-s-ag', prospects: 'sg-s-pr' };
  const segPct = (v, b) => Math.max(0, (Number(v) || 0) / b.still_to_sell * 100);
  function coverKeyHtml(b) {
    const items = b.segments.filter((s) => Math.round(s.gbp) > 0).map((s) => `<span><i class="${SEG_CLS[s.key]}"></i>${esc(s.label)} ${cv(s.gbp)}</span>`);
    const months = b.shortfall_months?.length ? ` (${b.shortfall_months.join('+')})` : '';
    const end = b.covered ? `<span class="sg-ccov">Covered${b.surplus > 0.5 ? ` (+${cv(b.surplus)})` : ''}</span>` : `<span><i class="sg-s-gap"></i>Still to find ${cv(b.still_to_find)}${months}</span>`;
    return [...items, end].join('');
  }
  function coverBarHtml(b) {
    if (!b || !(b.still_to_sell > 0)) return '';
    const segs = b.segments.filter((s) => s.width > 0.5).map((s) => `<span class="sg-cs ${SEG_CLS[s.key]}" style="width:${segPct(s.width, b).toFixed(2)}%" title="${esc(s.label)} ${cv(s.gbp)}">${segPct(s.width, b) >= 9 ? cv(s.gbp) : ''}</span>`).join('');
    const gap = b.covered ? '' : `<span class="sg-cs sg-s-gap" style="width:${segPct(b.still_to_find, b).toFixed(2)}%" title="Still to find ${cv(b.still_to_find)}">${segPct(b.still_to_find, b) >= 9 ? cv(b.still_to_find) : ''}</span>`;
    return `<div class="sg-cov" data-sg-cover><div class="sg-covt">How it's covered</div><div class="sg-covbar">${segs}${gap}</div><div class="sg-covkey">${coverKeyHtml(b)}</div></div>`;
  }

  /* ---------- "Agreed & prospects due this month" (QUESTION (dd)): enquiry labels from the ADMIN prospects API only ---------- */

  const AG = { rows: null, config: [], factor: 0.25, error: null, at: 0, loading: null, ctx: {} };
  const AG_PROBS = { qualify: 0.2, quote: 0.4, scheduled: 0.75 };
  const AG_STAGE = { qualify: 'Qualify', quote: 'Quote', scheduled: 'Scheduled' };
  const adminKey = () => (typeof window.getAdminKey === 'function' ? window.getAdminKey() : '');
  /** Repaint every agreed box from the rows held for this page (no re-render of the tiles). */
  function repaintAgreed() {
    document.querySelectorAll('[data-sg-agreed]').forEach((el) => {
      const c = AG.ctx[el.dataset.sgAgreed];
      if (c) el.innerHTML = agreedInner(c);
    });
  }
  /** Rows come from GET /api/aigeo/prospects with the admin key (personal data never goes through the public summary). */
  function loadAgreed() {
    if (AG.loading || (AG.rows && Date.now() - AG.at < 60000)) return;
    const k = adminKey();
    if (!k) { AG.error = 'admin key needed to list enquiries'; return; }
    AG.loading = fetch('/api/aigeo/prospects', { headers: { 'x-arp-admin-key': k } }).then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error || 'prospects unavailable');
        Object.assign(AG, { rows: j.rows || [], config: j.config || [], factor: j.revalidate_factor ?? 0.25, error: null, at: Date.now() });
      })
      .catch((e) => { AG.error = e.message; })
      .finally(() => { AG.loading = null; repaintAgreed(); });
  }
  const probOf = (stage) => Number((AG.config.find((x) => x.stage === stage) || {}).probability ?? AG_PROBS[stage] ?? 0);
  const chipOf = (e, t) => {
    if (t === 'receivable') return 'To collect';
    return e.value_basis === 'agreed' ? 'Agreed' : 'Committed';
  };
  /** One list row: agreed (committed work / to collect) at full value; a new sale weighted (stage × revalidate factor). */
  function agreedRow(e) {
    const t = e.revenue_type || 'new_sale';
    const live = !['booked_paid', 'closed_lost', 'parked'].includes(e.stage) && e.cash_month;
    const full = e.value_basis === 'unknown' ? 0 : Number(e.value_gbp) || 0;
    const base = { label: e.client_or_org, month: String(e.cash_month || '').slice(0, 7), full };
    if (!live) return null;
    if (t === 'committed_work' || t === 'receivable') return { ...base, chip: chipOf(e, t), value: full, agreed: true };
    if (t !== 'new_sale' || !AG_STAGE[e.stage]) return null;
    return { ...base, chip: AG_STAGE[e.stage], value: full * probOf(e.stage) * (e.review_status === 'revalidate' ? AG.factor : 1), agreed: false };
  }
  const byAgreed = (a, b) => (Number(b.agreed) - Number(a.agreed)) || (b.value - a.value);
  const monShort = (key) => Object.keys(MONTH)[Number(String(key).slice(5, 7)) - 1] || key;
  function agRowHtml(r, quarter) {
    const val = r.agreed ? gbp(r.full) : `${gbp(r.full)} → ${gbp(r.value)}`;
    return `<div class="sg-agr"><span class="sg-agl" data-sg-label>${esc(r.label)}</span><span class="sg-chip sg-chip-${r.agreed ? 'a' : 'p'}">${esc(r.chip)}</span><span class="sg-agv">${val}${quarter ? ` · ${monShort(r.month)}` : ''}</span></div>`;
  }
  function findTxt(b) {
    if (!b) return '';
    return b.covered ? `<span class="sg-ccov">covered${b.surplus > 0.5 ? ` (+${cv(b.surplus)})` : ''}</span>` : `still to find <b class="sg-amber">${cv(b.still_to_find)}</b>`;
  }
  const undatedBox = (c) => (c.quarter && c.undated ? `<div class="sg-agu"><b>Not yet in a month</b> <span class="rt-sub">(GPT + Alan qualifying)</span>: ${c.undated.count} enquir${c.undated.count === 1 ? 'y' : 'ies'} · ${gbp(c.undated.gbp)} weighted</div>` : '');
  function agreedList(c) {
    if (!AG.rows) return `<div class="sg-agn">${esc(AG.error || 'Loading enquiries…')}</div>`;
    const rows = AG.rows.map(agreedRow).filter((r) => r && c.keys.includes(r.month)).sort(byAgreed);
    const list = rows.slice(0, 5).map((r) => agRowHtml(r, c.quarter)).join('');
    const more = rows.length > 5 ? `<a href="#" class="sg-a sg-agm" data-sg-prospects>+${rows.length - 5} more → Prospects</a>` : '';
    return list ? `<div class="sg-agls">${list}</div>${more}` : `<div class="sg-agn">None with ${c.quarter ? 'a month in this quarter' : 'this month'} yet.</div>`;
  }
  function agreedInner(c) {
    return `<div class="sg-agh"><b>Agreed &amp; prospects ${c.quarter ? 'this quarter' : 'due this month'}</b> · ${findTxt(c.bar)}</div>${agreedList(c)}${undatedBox(c)}`;
  }
  /** The box: remembered per key so the list repaints when the admin rows arrive. */
  function agreedBox(key, c) {
    AG.ctx[key] = c;
    return `<div class="sg-ag" data-sg-agreed="${esc(key)}">${agreedInner(c)}</div>`;
  }
  window.stSalesGapAgreed = { state: AG, agreedRow, agreedInner, coverBarHtml };
  document.addEventListener('click', (e) => {
    if (!e.target?.closest?.('[data-sg-prospects]')) return;
    e.preventDefault();
    document.getElementById('st-prospects')?.scrollIntoView({ block: 'start' });
  });
  /* ---------- rolling quarter tile ---------- */

  const catRow = (r, cls = '', tip = '') => `<tr class="${cls}"><td class="left">${esc(r.label)}</td><td>${r.events}</td><td>${r.places}</td><td${tip ? ` title="${esc(tip)}"` : ''}>${k1(r.gbp)}</td><td>${pct(r.fill)}</td><td>${k1(r.likely)}</td></tr>`;
  function datedHtml(c) {
    if (!c) return '';
    return '<div class="sg-qt">Dated events</div><table class="sg-qtab sg-cat"><thead><tr><th class="left">Category</th><th>Events</th><th>Unsold places</th><th>If all sold</th><th>Fill rate</th><th>Likely £</th></tr></thead>'
      + `<tbody>${c.rows.map((r) => catRow(r)).join('')}${catRow(c.total, 'sg-qtot')}</tbody></table>`;
  }
  function nonDatedHtml(nd) {
    if (!nd) return '';
    return `<div class="sg-qt">Non-dated needed</div><table class="sg-qtab sg-nd"><thead><tr><th></th>${nd.months.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th>Total</th></tr></thead>`
      + `<tbody><tr class="sg-qtot"><td class="left">Needed</td>${nd.months.map((m) => `<td>${k1(m.gbp)}</td>`).join('')}<td>${k1(nd.total)}</td></tr></tbody></table>`
      + '<div class="sg-ndnote">From gift vouchers, Pick n Mix, 1-2-1s, mentoring, Academy, commissions, prints &amp; royalties.</div>';
  }
  const avg = (x) => (x.avg_booked == null ? '—' : (Math.round(x.avg_booked * 10) / 10).toFixed(1));
  function bookedHtml(c) {
    const rows = [...c.rows, c.total].map((x, i) => `<tr class="${i === c.rows.length ? 'sg-qtot' : ''}"><td class="left">${esc(x.label)}</td><td>${x.booked} / ${x.cap}</td><td>${avg(x)}</td></tr>`).join('');
    return `<table class="sg-qtab"><thead><tr><th class="left">Category</th><th>Booked / capacity</th><th>Avg people per event</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function normalHtml(r) {
    const n = r.normal;
    const cats = n.by_cat.filter((x) => Math.round(x.gbp)).map((x) => `${esc(x.label)} ${gbpK(x.gbp)}`).join(' · ') || 'none';
    const find = n.still_to_find_by_month.map((x) => `${esc(x.label)} ${gbpK(x.gbp)}`).join(' · ');
    const later = r.pipeline?.later > 0.5 ? ` · pipeline with a cash month after the quarter ${gbpK(r.pipeline.later)}` : '';
    return `<p class="sg-qdp"><b>Normal non-dated (same months last year): ${gbpK(n.total)}</b> · ${cats}</p>`
      + `<p class="sg-qdp"><b>Still to find after normal and pipeline: <span class="sg-amber">${gbpK(n.still_to_find)}</span></b> (${find}) = non-dated needed ${gbpK(r.non_dated_needed)} − normal ${gbpK(n.adjusted)} − pipeline ${gbpK(n.pipeline)}${datedTxt(n.dated_event)}${committedTxt(n.committed)}${later}</p>`;
  }
  function quarterDetailsHtml(r) {
    const best = r.best_case > 0 ? `<p class="sg-qdp">Best case, all stock on sale sells: ${gbpK(r.best_case)} still to sell.</p>` : '';
    return `<details class="sg-d sg-qd"><summary>details</summary>${r.categories ? bookedHtml(r.categories) : ''}${r.normal ? normalHtml(r) : ''}${best}`
      + '<p class="sg-qdp"><a href="#" class="sg-a" data-sg-rules>Rules</a> (how each figure is worked out)</p></details>';
  }
  function quarterTile(g) {
    const r = g.rolling;
    const qb = g.cover?.rolling?.bar;
    return `<div class="sg-card sg-q"><div class="sg-h"><b>Quarter · ${dm(r.from)} → ${dm(r.to)}</b><span class="rt-sub">revenue</span></div><div class="sg-big">${k1(r.still_to_sell)} <span class="sg-u">still to sell</span></div>${bar(r.still_to_sell, r.likely, true)}${coverBarHtml(qb)}`
      + `${datedHtml(r.categories)}${nonDatedHtml(r.non_dated)}${agreedBox('quarter', { keys: (g.months || []).map((m) => m.key), quarter: true, bar: qb, undated: g.cover?.undated })}${quarterDetailsHtml(r)}</div>`;
  }
  /** Tap / click toggles an ⓘ tooltip (touch has no hover); any other click closes the open ones. */
  document.addEventListener('click', (e) => {
    const t = e.target?.closest?.('[data-sg-tip]');
    document.querySelectorAll('[data-sg-tip].sg-open').forEach((x) => {
      if (x === t) return;
      x.classList.remove('sg-open');
      x.setAttribute('aria-expanded', 'false');
    });
    if (!t) return;
    e.preventDefault();
    const open = t.classList.toggle('sg-open');
    t.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    const a = e.target?.closest?.('[data-sg-rules]');
    const rules = a && document.getElementById('sg-rules');
    if (!a) return;
    e.preventDefault();
    if (rules) { rules.open = true; rules.scrollIntoView({ block: 'nearest' }); }
  });

  /* ---------- "Can we hit the target? Realistic cover by month" (QUESTION (v)) ---------- */

  /** Cover £: "—" at £0, whole £ under £100, else one decimal in £k (as the tiles). */
  const cv = (v) => {
    const n = Number(v) || 0;
    if (Math.round(n) === 0) return '—';
    return Math.abs(n) < 100 ? gbp(n) : k1(n);
  };
  const W = '<span class="sg-cw">weighted</span>';
  const COVER_ROWS = [
    { section: 'Dated events' },
    { key: 'likely', label: 'Likely bookings (fill rate)' },
    { key: 'dated_event', label: `Enquiries about dated events ${W}`, sub: 'enquiries flagged to a dated event, capped at its places left' },
    { section: 'Non-dated' },
    { key: 'normal', label: 'Normal sales (same month last year)', sub: 'commissions, Academy, 1-2-1, prints, mentoring, vouchers' },
    { key: 'pipeline', label: `Prospects pipeline ${W}`, sub: 'by expected month · old "revalidate" leads count at a quarter' },
    { key: 'committed', label: 'Committed work', sub: 'allocated, delivery pending' },
    { key: 'cash_to_collect', label: 'Cash to collect', sub: 'invoiced, payment unverified' }
  ];
  function coverCell(c) {
    if (c.still_to_find > 0.5) return `<td class="sg-cfind">${cv(c.still_to_find)}</td>`;
    return `<td class="sg-ccov">covered${c.surplus > 0.5 ? ` (+${cv(c.surplus)})` : ''}</td>`;
  }
  function coverRowHtml(r, cols) {
    if (r.section) return `<tr class="sg-csec"><td class="left" colspan="${cols.length + 1}">${esc(r.section)}</td></tr>`;
    return `<tr><td class="left">${r.label}${r.sub ? `<div class="sg-csub">${esc(r.sub)}</div>` : ''}</td>${cols.map((c) => `<td>${cv(c[r.key])}</td>`).join('')}</tr>`;
  }
  function coverNote(cv0) {
    const short = cv0.months.filter((m) => m.still_to_find > 0.5).map((m) => m.label);
    const plus = cv0.months.filter((m) => m.surplus > 0.5).map((m) => MONTH[m.label] || m.label);
    const which = short.length ? `${short.join(' + ')} shortfall${short.length > 1 ? 's' : ''} only` : 'the monthly shortfalls only';
    return `"Still to find" for the rolling 3 months = ${which}${plus.length ? `: ${plus.join(' and ')}'s surplus can't pay an earlier month's bills` : ''}. `
      + 'Normal non-dated sales are reduced where an enquiry of the same type is already in the pipeline, so nothing is counted twice.';
  }
  function coverHtml(cv0) {
    if (!cv0) return '';
    const cols = [...cv0.months, cv0.rolling];
    const head = `<tr><th class="left"></th>${cv0.months.map((m) => `<th>${esc(MONTH[m.label] || m.label)}</th>`).join('')}<th>Rolling 3 months</th></tr>`;
    const body = `<tr class="sg-cstill"><td class="left">Still to sell</td>${cols.map((c) => `<td>${cv(c.still_to_sell)}</td>`).join('')}</tr>`
      + COVER_ROWS.map((r) => coverRowHtml(r, cols)).join('')
      + `<tr class="sg-ctot"><td class="left">Realistic total</td>${cols.map((c) => `<td>${cv(c.total)}</td>`).join('')}</tr>`
      + `<tr class="sg-ctot sg-cfrow"><td class="left">Still to find</td>${cv0.months.map(coverCell).join('')}${coverCell({ still_to_find: cv0.rolling.still_to_find, surplus: 0 })}</tr>`;
    const u = cv0.undated;
    return `<div class="sg-cover" id="sg-cover"><h4>Can we hit the target? Realistic cover by month</h4><p class="rt-sub">Everything realistically expected to bring cash in each month, against what's still to sell. Every £ in the month the booking or cash is expected.</p>`
      + `<table class="sg-ctab"><thead>${head}</thead><tbody>${body}</tbody></table>`
      + `<p class="sg-cund" data-sg-undated>Undated potential <b>${gbp(u.gbp)}</b> (${u.count} enquir${u.count === 1 ? 'y' : 'ies'} without an expected month, not counted)</p>`
      + `<p class="sg-cfoot">${esc(coverNote(cv0))}<br>Each enquiry gets an <b>expected cash month</b> (GPT sets it from the conversation; Alan can change it). Enquiries with no month yet show above as "undated potential" and are not counted.</p></div>`;
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
  function lever3Html(l, r) {
    const find = `<div class="sg-find">Still to find <b>${gbpK(r.still_to_find)}</b> <span class="rt-sub">(pipeline ${gbpK(r.pipeline_weighted)}${datedPart(r.dated_event_gbp)}${committedPart(r.committed_gbp)} counted)</span></div>`;
    if (!(l.gbp > 0)) return `${find}<span class="rt-sub">push after levers 1–2: —</span>`;
    const u = l.units;
    const p = l.unit_prices;
    return `${find}<b>${gbpK(l.gbp)} push</b><div class="rt-sub">≈ ${u.vouchers} × ${gbp(p.voucher)} vouchers, or ${u.one_to_ones} × ${gbp(p.one_to_one)} 1-2-1s, or ${u.pick_n_mix} Pick n Mix plans · ${mk}gift / Pick n Mix / 1-2-1 campaigns</a></div>`;
  }
  function gapCell(r) {
    const less = r.normal_adjusted < r.normal_non_dated - 0.5 ? ` (of ${gbpK(r.normal_non_dated)}, less pipeline of the same kind)` : '';
    return `<b class="sg-amber">${gbpK(r.gap)}</b><div class="rt-sub">${gbpK(r.non_dated_needed)} − ${gbpK(r.normal_adjusted)} normal non-dated${less} − ${gbpK(r.pipeline_weighted)} pipeline${datedTxt(r.dated_event_gbp)}${committedTxt(r.committed_gbp)}</div>`;
  }
  /** October's shortfall is not carried forward (QUESTION (q) item 14) + Alan's retired-from-promotion events (item 11). */
  function remedyNotesHtml(rp) {
    const nc = rp.not_carried;
    const months = nc ? nc.months.join(' + ') || 'past months' : '';
    const carried = nc ? `<p class="rt-sub sg-rn">${esc(months)}'s shortfall (${gbpK(nc.gbp)}, in the ${esc(nc.quarter)} card) is not carried into this forward plan: it covers the rolling months only, each closing its own gap. Targets are unchanged.</p>` : '';
    const retired = (rp.retired || []).length ? `<p class="rt-sub sg-rn">Retired from promotion (Alan), not recommended: ${rp.retired.map((e) => `${esc(e.title)} ${dm(e.date)}`).join(' · ')}. Still in stock and on sale.</p>` : '';
    return carried + retired;
  }
  function remedyHtml(rp) {
    const rows = rp.rows.map((r) => `<tr><td class="left"><b>${esc(r.label)}</b>${r.days_left != null ? `<div class="rt-sub">${r.days_left} days</div>` : ''}</td>`
      + `<td class="left">${gapCell(r)}</td>`
      + `<td class="left">${lever1Html(r.lever1)}</td><td class="left">${lever2Html(r.lever2)}</td><td class="left">${lever3Html(r.lever3, r)}</td>`
      + `<td class="left ${r.closes.yes ? 'sg-yes' : 'sg-no'}">${esc(r.closes.text)}</td></tr>`).join('');
    const t = rp.total;
    const total = `<tr class="sg-tot"><td class="left"><b>Total</b></td><td class="left"><b class="sg-amber">${gbpK(t.gap)}</b></td><td class="left">+${t.lever1_places} places · ${gbpK(t.lever1)}</td><td class="left">+${t.lever2_events} events · ${gbpK(t.lever2)}</td><td class="left">${gbpK(t.lever3)}</td><td></td></tr>`;
    return '<h3>Remedy plan: how to close each month (based on likely)</h3><p class="rt-sub">Gap after likely bookings and normal non-dated sales, closed by three levers in order of effort. The levers add up to the gap and recalculate as bookings arrive; each £ lands in the month the booking must be made.</p>'
      + remedyNotesHtml(rp) + `<table class="rt-table sg-rem"><thead><tr><th class="left">Month</th><th class="left">Still to find<div class="rt-sub">non-dated needed (likely) − normal non-dated − pipeline weighted</div></th><th class="left">1 · Sell existing places beyond normal fill</th><th class="left">2 · Add new dated events</th><th class="left">3 · Non-dated push</th><th class="left">Closes?</th></tr></thead><tbody>${rows}${total}</tbody></table>`;
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
  /** Item 14: the current quarter's still to sell names the past-month shortfall it includes, next to the forward months. */
  function periodRows(q) {
    const p = q.period;
    if (!p || p.forward_still == null) return row('Still to sell', gbpK(q.still_to_sell));
    const incl = p.shortfall > 0.5 ? ` incl. ${esc(p.shortfall_months.join(' + '))} shortfall ${gbpK(p.shortfall)}` : '';
    return row(`Still to sell · ${esc(p.name)}${incl}`, gbpK(q.still_to_sell), 'sg-col')
      + row(`${esc(p.forward_months.join(' + '))} still to sell <span class="rt-sub">(forward plan)</span>`, gbpK(p.forward_still));
  }
  function quarterCard(q) {
    return `<div class="sg-card sg-qc sg-${esc(q.state)}"><div class="sg-h"><b>${esc(q.label)}</b><span class="rt-sub">${esc(q.state)}</span></div>`
      + row('Target · sold so far', `${gbpK(q.target)} · ${gbpK(q.sold)}`) + periodRows(q)
      + `<div class="sg-r sg-col"><span>Dated places sellable in the quarter</span><b>${stockLine(q)}</b></div>`
      + row('Likely bookings made in the quarter', gbpK(q.likely))
      + row('Non-dated needed (likely)', `${gbpK(q.non_dated_needed)} <span class="rt-sub">· normal ${gbpK(q.normal_non_dated)}</span>`, 'sg-amber')
      + (q.still_to_find ? row(`Still to find (${esc(q.still_to_find.months.join(' + '))}, after pipeline)`, `${gbpK(q.still_to_find.gbp)} <span class="rt-sub">· pipeline ${gbpK(q.still_to_find.pipeline)}</span>`, 'sg-amber') : '')
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
    .sg-rec { margin-top: 0.35rem; } .sg-a { color: #8fb7ff; } .sg-find { margin-bottom: 0.2rem; } .sg-find b { color: #f0b429; }
    .sg-from { margin: -0.1rem 0 0.15rem; font-size: 0.75rem; } .sg-small { font-size: 0.75rem; opacity: 0.85; } .sg-asof { font-size: 0.75rem; font-weight: 400; margin-left: 0.5rem; }
    .sg-tag { font-size: 0.7rem; padding: 0 5px; border-radius: 6px; background: #2a3142; color: #f3d48a; }
    .sg-r.sg-col { flex-direction: column; gap: 0.1rem; } .sg-r.sg-col b { text-align: left; white-space: normal; }
    .sg-qt { font-weight: 700; color: #fff; margin: 0.3rem 0 0; font-size: 0.82rem; line-height: 1.3; }
    .sg-qtab { width: 100%; border-collapse: collapse; font-size: 0.74rem; line-height: 1.2; font-variant-numeric: tabular-nums; background: none; }
    .sg-qtab th, .sg-qtab td { text-align: right; padding: 1px 0 1px 5px; border: 0; border-bottom: 1px solid #262d3c; background: none; }
    .sg-qtab th { color: #9aa4b2; font-weight: 400; line-height: 1.1; vertical-align: bottom; text-transform: none; letter-spacing: 0; }
    .sg-qtab td { color: #dde3ec; white-space: nowrap; } .sg-qtab .left { text-align: left; padding-left: 0; white-space: nowrap; }
    .sg-qtab .sg-qtot td { font-weight: 700; color: #fff; border-bottom: 0; } .sg-nd .sg-qtot td:not(.left) { color: #f0b429; }
    .sg-card .sg-ndnote { font-size: 0.68rem; line-height: 1.25; color: #9aa4b2; margin-top: 0.1rem; }
    .sg-card .sg-pipe { margin-top: 0.3rem; padding: 0.2rem 0.45rem; border: 1px solid #2a3142; border-radius: 6px; background: #11151d; font-size: 0.72rem; line-height: 1.3; }
    .sg-card .sg-mnd { display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.4rem; } .sg-mnd span { color: #dde3ec; font-size: 0.82rem; } .sg-mnd b { color: #f0b429; font-size: 1.05rem; }
    .sg-pg { margin-top: 0.2rem; font-size: 0.74rem; color: #b8c0cc; } .sg-pg b { color: #dde3ec; } .sg-pg ul { margin: 0.05rem 0 0; padding-left: 1rem; } .sg-pg li { margin: 0; line-height: 1.3; }
    .sg-card.sg-m { position: relative; } .sg-tip { cursor: help; color: #8fb7ff; font-size: 0.72rem; line-height: 0; outline: none; }
    .sg-tipb { display: none; position: absolute; left: 0.6rem; right: 0.6rem; margin-top: 1.1rem; z-index: 20; padding: 0.4rem 0.55rem; border: 1px solid #3a4256; border-radius: 6px; background: #0e1218; color: #dde3ec; font-size: 0.74rem; line-height: 1.35; text-align: left; white-space: normal; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5); }
    .sg-tip:hover .sg-tipb, .sg-tip:focus-visible .sg-tipb, .sg-tip.sg-open .sg-tipb { display: block; }
    .sg-cover { margin-top: 0.75rem; background: #161b26; border: 1px solid #2a3142; border-radius: 10px; padding: 0.8rem 0.9rem; }
    .sg-cover h4 { margin: 0 0 0.1rem; color: #fff; font-size: 1rem; } .sg-ctab { width: 100%; border-collapse: collapse; font-size: 0.84rem; font-variant-numeric: tabular-nums; background: none; margin-top: 0.4rem; }
    .sg-ctab th, .sg-ctab td { text-align: right; padding: 0.3rem 0.5rem; border: 0; border-bottom: 1px solid #262d3c; background: none; } .sg-ctab th { color: #9aa4b2; font-weight: 400; text-transform: none; letter-spacing: 0; }
    .sg-ctab td { color: #dde3ec; } .sg-ctab .left { text-align: left; width: 34%; } .sg-csub { font-size: 0.72rem; color: #8b95a5; }
    .sg-csec td { color: #8b95a5 !important; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; padding-top: 0.55rem; }
    .sg-ctot td { font-weight: 700; color: #fff; } .sg-cfind { color: #f0b429 !important; } .sg-ccov { color: #5fd38d !important; }
    .sg-cw { font-size: 0.68rem; padding: 0 5px; border-radius: 6px; background: #2a3142; color: #b8c0cc; font-weight: 400; margin-left: 0.3rem; }
    .sg-cund { margin: 0.45rem 0 0; font-size: 0.8rem; color: #b8c0cc; } .sg-cfoot { margin: 0.3rem 0 0; font-size: 0.74rem; color: #8b95a5; line-height: 1.4; }
    .sg-rn { margin: 0.2rem 0; } .sg-wk { margin-left: 0.5rem; }
    .sg-cov { margin: 0.1rem 0 0.4rem; padding: 0.3rem 0.4rem; border: 1px solid #2a3142; border-radius: 6px; background: #11151d; }
    .sg-covt { font-size: 0.72rem; color: #9aa4b2; margin-bottom: 0.2rem; } .sg-covbar { display: flex; height: 16px; border-radius: 4px; overflow: hidden; background: #1b2130; font-size: 10px; line-height: 16px; color: #111; }
    .sg-cs { padding-left: 3px; white-space: nowrap; overflow: hidden; box-sizing: border-box; } .sg-s-ev { background: #6aa6ff; } .sg-s-eq { background: repeating-linear-gradient(45deg, #6aa6ff 0 4px, #3d6fbf 4px 8px); }
    .sg-s-no { background: #5fd38d; } .sg-s-ag { background: #a78bfa; } .sg-s-pr { background: repeating-linear-gradient(45deg, #f0b429 0 4px, #8a6a1f 4px 8px); }
    .sg-s-gap { background: transparent; border: 1.5px dashed #f0b429; color: #f0b429; border-radius: 0 4px 4px 0; }
    .sg-covkey { display: flex; flex-wrap: wrap; gap: 0.1rem 0.6rem; margin-top: 0.25rem; font-size: 0.68rem; color: #b8c0cc; } .sg-covkey i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
    .sg-covkey i.sg-s-gap { border-width: 1px; } .sg-covkey .sg-ccov { color: #5fd38d; font-weight: 600; }
    .sg-card .sg-ag { margin-top: 0.4rem; padding: 0.35rem 0.5rem; border: 1px solid #2a3142; border-radius: 6px; background: #11151d; font-size: 0.74rem; }
    .sg-agh { margin-bottom: 0.2rem; color: #dde3ec; } .sg-agh .sg-ccov { color: #5fd38d; font-weight: 700; } .sg-agr { display: flex; align-items: baseline; gap: 0.4rem; padding: 0.12rem 0; border-bottom: 1px solid #1f2533; }
    .sg-agl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #dde3ec; } .sg-agv { white-space: nowrap; color: #dde3ec; font-variant-numeric: tabular-nums; }
    .sg-chip { font-size: 0.66rem; padding: 0 6px; border-radius: 8px; white-space: nowrap; } .sg-chip-a { background: #3b2d63; color: #d9ccff; } .sg-chip-p { background: #4a3a12; color: #ffd98a; }
    .sg-agn { color: #8b95a5; } .sg-agm { display: inline-block; margin-top: 0.2rem; } .sg-agu { margin-top: 0.35rem; padding: 0.25rem 0.4rem; border: 1px dashed #3a4256; border-radius: 6px; color: #b8c0cc; }
    .sg-qd { margin-top: 0.25rem; } .sg-card .sg-qdp { margin: 0.3rem 0 0; font-size: 0.74rem; line-height: 1.3; color: #b8c0cc; } .sg-qdp b { color: #dde3ec; } .sg-qd .sg-qtab { margin-top: 0.25rem; } .sg-qd .sg-qtab th { white-space: normal; }
  </style>`;

  function rulesHtml(g) {
    const asm = (g.assumptions || []).map((a) => `<li><b>${esc(a.label)}:</b> ${esc(a.value)} <span class="sg-tag">${esc(a.status)}</span></li>`).join('');
    return `<details class="sg-d" id="sg-rules"><summary>Rules ▾</summary><ul class="rt-sub">${(g.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      + (asm ? `<p class="rt-sub"><b>Editable assumptions</b> (confirmed by Alan 9 Nov; set 9 Nov, review later):</p><ul class="rt-sub">${asm}</ul>` : '')
      + `<p class="rt-sub"><b>Show the working</b> (per event, fractional places, damping and split by booking month; also in the strategy-summary API):</p>${(g.months || []).map(workingHtml).join('')}</details>`;
  }
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'unknown');
  /** "as of {Booking Sheet sync time} · events {snapshot date}" (recalculated on every load, never cached). */
  function asOfHtml(g) {
    const f = g.freshness || {};
    return `<span class="rt-sub sg-asof">as of Booking Sheet sync ${esc(stamp(f.booking_sheet_synced_at))} · events ${esc(f.events_snapshot_date ? dm(f.events_snapshot_date) : 'unknown')} · recalculated on every load</span>`;
  }
  /** The three blocks: tiles (+ legend + rules), Remedy plan, quarter planning cards. */
  window.stSalesGapHtml = function stSalesGapHtml(s) {
    const g = s?.sales_gap;
    if (!g || g.error) return { tiles: `<h3>Sales gap</h3><p class="rt-sub">Sales gap unavailable: ${esc(g?.error || 'not in the strategy summary')}</p>`, remedy: '', quarters: '' };
    loadAgreed();
    const tiles = `${STYLE}<h3>Sales gap · Rolling 3 months: where the money has to come from ${asOfHtml(g)}</h3><p class="rt-sub">Each month: target still to sell → how much dated bookings are likely to cover (bookings made that month, for any event date) → what must come from non-dated sales (gifts, vouchers, 1-2-1s, Academy, Pick n Mix, commissions). Every £ is counted in the month the booking is made, never the event's month.</p>`
      + `<div class="sg-grid">${quarterTile(g)}${g.months.map((m) => monthCard(m, ifAllSoldTip(g), g.cover)).join('')}</div>${coverHtml(g.cover)}`
      + `<p class="sg-legend"><i style="background:#6aa6ff"></i>likely dated bookings made in the month <i style="background:#f0b429"></i>non-dated sales needed · <b>${esc(g.footnote || 'an event can be in its buying window in more than one month, so months don\'t add up to the quarter')}</b> · stock on sale is not revenue for the event's month · fill rate day ${Math.round(g.fill.day * 1000) / 10}% / residential ${Math.round(g.fill.residential * 1000) / 10}% / course ${Math.round(g.fill.course * 1000) / 10}%</p>${rulesHtml(g)}`;
    const quarters = `<h3>Quarter planning: what to put on sale for Q1–Q4</h3><p class="rt-sub">Same booking-month method per quarter. "To plan" = still to sell − likely − normal non-dated (same quarter last year), ≈ extra events at the all-events average likely £ per event.</p><div class="sg-qgrid">${g.quarters.map(quarterCard).join('')}</div>`;
    return { tiles, remedy: remedyHtml(g.remedy), quarters };
  };
})();
