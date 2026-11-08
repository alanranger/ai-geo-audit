/**
 * Strategy & Actions: clean layout (QUESTION-2026-11-08-strategy-tab-clean-layout). Layout and read-only aggregation only.
 * Visible, top to bottom: Where we are (5 tiles) · Decisions for Alan · Quarter plan + "Next delivery" · two closed folds:
 * "Why" (every analysis section as it is, Alan's GP-vs-survival chart, Top 3 weights, seasonality, and the weekly task
 * lists in their own closed sub-fold) and "Targets" (the Targets panel). Nothing is deleted: sections are moved, not
 * rebuilt. Shared numbers use the Marketing Overview tile builders (window.mkOverviewTiles) on the same strategy
 * summary objects, and "Next delivery" is Marketing Planned's first item from the same schedule model.
 */
(function () {
  const LONDON = 'Europe/London';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
  const ukDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const gbpK = (v) => {
    if (v == null) return '—';
    const a = Math.abs(Number(v));
    return a >= 1000 ? `£${(Math.round(a / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(a).toLocaleString('en-GB')}`;
  };
  const T = () => window.mkOverviewTiles || null;
  const tileOf = (s, key) => (T()?.insightTile ? T().insightTile(s, key) : null);

  /* ---------- 1 · Where we are (same builders / objects as the Marketing Overview tiles) ---------- */

  const na = (n, title, why, go) => ({ n, title, head: '<span class="mko-na">Not available</span>', lines: [esc(why)], src: 'Strategy summary', go, goLabel: 'detail', rag: 'grey' });

  function salesTile(s) {
    const t = tileOf(s, 'money-next-3');
    const months = t?.numbers?.months || [];
    if (months.length < 3) return na(1, 'Sales still needed', 'Strategy money figures not available', 'si:money-next-3');
    const [m0, m1, m2] = months;
    return {
      n: 1, title: 'Sales still needed', rag: 'grey', go: 'si:money-next-3', goLabel: 'sales detail',
      head: `${gbpK(m1.to_end)} <span class="mko-unit">to ${ukDay(m1.end)}</span> · ${gbpK(m2.to_end)} <span class="mko-unit">to ${ukDay(m2.end)}</span>`,
      lines: [`${esc(m0.label)} ${gbpK(m0.needed)} left · ${esc(m1.label)} ${gbpK(m1.needed)} · ${esc(m2.label)} ${gbpK(m2.needed)} (seasonal targets)`],
      src: 'Targets panel · Booking Sheet'
    };
  }
  function paceRag(actual, target, today) {
    const [y, m, d] = today.split('-').map(Number);
    const pace = (target * d) / new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (actual >= pace) return 'green';
    return actual >= pace * 0.75 ? 'amber' : 'red';
  }
  function monthTile(s) {
    const t = tileOf(s, 'money-this-month');
    const x = t?.numbers;
    if (!x?.sales_target) return na(2, 'This month', 'month target not available', 'si:money-this-month');
    const rag = paceRag(x.sales, x.sales_target, todayIso());
    return {
      n: 2, title: `This month · ${esc(String(t.title).split('·')[1]?.trim() || '')}`, rag, go: 'si:money-this-month', goLabel: 'month detail',
      head: `${gbp(x.sales)} <span class="mko-unit">of ${gbp(x.sales_target)}</span>`,
      lines: [`<span class="mko-t-${rag}">${Math.round(x.of_target_pct)}%</span> of the month's sales target · GP ${gbp(x.gp)} of ${gbp(x.gp_target)}`],
      src: 'Targets panel · Booking Sheet'
    };
  }
  function bookedTile(s) {
    const t = tileOf(s, 'money-next-3');
    const x = t?.numbers;
    if (!x) return na(3, 'Booked ahead', 'diary figures not available', 'si:demand-booked-ahead');
    return {
      n: 3, title: 'Booked ahead · next 3 months', rag: 'grey', go: 'si:demand-booked-ahead', goLabel: 'booked-ahead detail',
      head: `${gbpK(x.inHand)} <span class="mko-unit">already booked to ${ukDay(x.window_end)}</span>`,
      lines: [`${gbpK(x.potential)} still unsold at full price on these dates`],
      src: 'diary + daily snapshots'
    };
  }
  function returningTile(s) {
    const t = T()?.tileRepeat ? T().tileRepeat(s) : null;
    if (!t) return na(4, 'Returning clients', 'returning sales not available', 'si:mix-returning');
    return { ...t, n: 4, title: 'Returning-client sales', go: 'si:mix-returning', goLabel: 'returning detail', lines: t.lines.slice(0, 1), src: 'Booking Sheet + plan statements' };
  }
  function plansTile(s) {
    const x = tileOf(s, 'mix-pick-n-mix')?.numbers;
    const kpi = (s?.quarter_plan?.quarters || []).find((q) => q.state === 'current')?.kpis?.find((k) => k.key === 'plans');
    if (!x) return na(5, 'Pick n Mix plans', 'plan figures not available', 'si:mix-pick-n-mix');
    return {
      n: 5, title: 'Pick n Mix plans', rag: 'grey', go: 'si:mix-pick-n-mix', goLabel: 'Pick n Mix detail',
      head: `${x.since_relaunch} <span class="mko-unit">${kpi?.target != null ? `of ${kpi.target} ${esc(kpi.sub?.split('·')[1]?.trim() || '')}` : 'since relaunch'}</span>`,
      lines: [esc(x.status_line || '')], src: 'PnM Plans tab · Targets panel'
    };
  }
  function tilesHtml(s) {
    const tiles = [salesTile(s), monthTile(s), bookedTile(s), returningTile(s), plansTile(s)];
    const html = T()?.tileHtml ? tiles.map((t) => T().tileHtml(t)).join('') : '';
    return `${T()?.STYLE || ''}<h3>Where we are <span class="rt-sub">revenue first, GP beside it · each tile opens its detail</span></h3><div class="mko st-where-tiles"><div class="mko-grid st-g5">${html}</div></div>`;
  }

  /* ---------- 2 · Decisions for Alan (server: lib/strategy-decisions.mjs) ---------- */

  function decisionsHtml(s) {
    const list = s?.decisions || [];
    const rows = list.map((d) => `<tr><td class="left"><b>${esc(d.what)}</b></td><td class="left">${esc(d.why)}</td><td class="left">${d.options.map(esc).join(' · ')}</td><td>${esc(ukDay(d.due))}</td></tr>`).join('');
    const body = list.length ? `<table class="rt-table st-dec"><thead><tr><th class="left">What</th><th class="left">Why</th><th class="left">Options</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="rt-sub">Nothing needs your decision right now.</p>';
    return `<h3>Decisions for Alan (${list.length}) <span class="rt-sub" title="Only decisions you must make: targets, offers, prices, approvals. Worked out from the data; GPT / Claude / Cursor tasks never appear here.">ⓘ</span></h3>${body}`;
  }

  /* ---------- 3 · Next delivery (Marketing Planned's first item, same schedule model) ---------- */

  let overview = null;
  function loadOverview() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) return Promise.resolve(null);
    if (!overview) overview = fetch('/api/aigeo/marketing?action=overview', { headers: { 'x-arp-admin-key': key } }).then((r) => r.json()).then((j) => (j.ok ? j : null)).catch(() => null);
    return overview;
  }
  /** The same model Marketing's Planned builds (window.mkDeliveryItems + mkCapacity + mkScheduleModel). */
  function plannedModel(d, s) {
    const M = window.mkScheduleModel;
    if (!d || !M?.build || typeof window.mkDeliveryItems !== 'function') return null;
    return M.build({ items: window.mkDeliveryItems(d, s), d, s, cap: typeof window.mkCapacity === 'function' ? window.mkCapacity(d, s) : null });
  }
  const STATE = { sch: 'scheduled in the platform', pl: 'planned', warn: 'needs attention' };
  function nextDeliveryLine(x) {
    if (!x) return 'Next delivery: nothing planned yet <a href="#marketing" data-goto-marketing>→ Marketing</a>';
    const kind = x.draft || x.raw?.delivery?.bucket === 'draft' ? 'draft' : STATE[x.state] || x.state;
    return `Next delivery: <b>${esc(x.title)}</b> · ${esc(ukDay(x.day))}${x.time ? ` ${esc(x.time)}` : ''} · ${esc(kind)} <a href="#marketing" data-goto-marketing>→ Marketing</a>`;
  }
  async function fillNextDelivery(el, s) {
    const d = await loadOverview();
    const model = plannedModel(d, s);
    if (!el.isConnected) return;
    if (!model) { el.innerHTML = 'Next delivery: open <a href="#marketing" data-goto-marketing>Marketing →</a> (schedule not loaded)'; return; }
    const first = window.mkScheduleModel.firstPlanned(model);
    el.innerHTML = nextDeliveryLine(first);
    el.dataset.nextKey = first ? first.id : '';
  }

  /* ---------- folds ---------- */

  const KEEP = new Set(['st-where', 'st-decisions', 'st-quarter-plan', 'st-next-delivery', 'st-fold-why', 'st-fold-targets']);
  const TASKS = ['st-action-list', 'st-next4', 'st-campaign'];
  function fold(id, title, sub) {
    const el = document.createElement('details');
    el.id = id;
    el.className = 'rt-section st-fold';
    el.innerHTML = `<summary><h3>${title}</h3> <span class="rt-sub">${sub}</span></summary><div class="st-fold-body"></div>`;
    return el;
  }
  function block(id, html) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'rt-section';
    el.innerHTML = html;
    return el;
  }
  const isHeader = (el) => el.tagName === 'STYLE' || (!el.id && !el.classList.contains('rt-section') && !el.classList.contains('two'));
  function gpChartSection() {
    const el = document.createElement('div');
    el.id = 'st-gp-chart';
    el.className = 'rt-section mc-root';
    el.innerHTML = '<h3><span id="st-gp-h-metric">GP</span> by month vs survival <span class="rt-sub">the same chart and data as Revenue</span></h3><div class="st-gp-host"><div class="rt-sub">Opens with this section.</div></div>';
    return el;
  }
  function mountChartOnOpen(why) {
    why.addEventListener('toggle', () => {
      const sec = why.querySelector('#st-gp-chart');
      if (!why.open || !sec || sec.dataset.mounted) return;
      sec.dataset.mounted = '1';
      if (typeof window.rtMountMonthlyChart === 'function') window.rtMountMonthlyChart(sec).catch(() => { sec.querySelector('.st-gp-host').innerHTML = '<div class="rt-error">Chart did not load: see Revenue.</div>'; });
    });
  }
  function whyFold(root, panel) {
    const why = fold('st-fold-why', 'Why', 'every analysis as it was: sales, GP mix, demand, booked ahead, events, pace, returning, Pick n Mix, Academy, roadmap, beginners → plans, KPI scorecard, pillars, GP vs survival, Top 3 weights');
    const body = why.querySelector('.st-fold-body');
    body.appendChild(gpChartSection());
    const moved = [...root.children].filter((el) => !isHeader(el) && !KEEP.has(el.id) && !TASKS.includes(el.id) && el.id !== 'st-targets-host');
    moved.forEach((el) => { el.style.order = ''; body.appendChild(el); });
    ['st-seasonality', 'st-weights'].map((id) => panel?.querySelector(`#${id}`) || document.getElementById(id)).filter(Boolean).forEach((el) => { el.style.order = ''; body.appendChild(el); });
    const tasks = fold('st-fold-tasks', 'Weekly task lists', 'Action list · Next 4 weeks · Next campaign: these live on Marketing\'s schedule');
    TASKS.map((id) => root.querySelector(`#${id}`)).filter(Boolean).forEach((el) => { el.style.order = ''; tasks.querySelector('.st-fold-body').appendChild(el); });
    body.appendChild(tasks);
    mountChartOnOpen(why);
    return why;
  }
  function targetsFold(root) {
    const t = fold('st-fold-targets', 'Targets', 'the Targets panel, unchanged');
    const host = root.querySelector('#st-targets-host');
    if (host) t.querySelector('.st-fold-body').appendChild(host);
    return t;
  }

  /** Before strategy-tab.js re-renders #strategy-root, put the panel-level sections back so they survive. */
  window.stRescueLayout = function stRescueLayout(root) {
    const panel = root?.parentElement;
    if (!panel) return;
    ['st-seasonality', 'st-weights'].map((id) => root.querySelector(`#${id}`)).filter(Boolean).forEach((el) => panel.appendChild(el));
  };

  const STYLE = `<style>
    #st-fold-why > summary, #st-fold-targets > summary, #st-fold-tasks > summary { cursor: pointer; list-style: revert; }
    .st-fold > summary h3 { display: inline; margin: 0; }
    .st-fold-body { margin-top: 0.75rem; display: flex; flex-direction: column; gap: 1rem; }
    .st-where-tiles .st-g5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    @media (max-width: 1300px) { .st-where-tiles .st-g5 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    #st-next-delivery { padding: 0.55rem 0.9rem; font-size: 0.95rem; }
    .st-dec td { vertical-align: top; white-space: normal; } .qp-mk { font-size: 0.78rem; margin-left: 0.3rem; }
  </style>`;

  function placeTop(root, s) {
    const header = [...root.children].filter(isHeader);
    const where = block('st-where', STYLE + tilesHtml(s));
    const dec = block('st-decisions', decisionsHtml(s));
    const next = block('st-next-delivery', 'Next delivery: loading the schedule…');
    const qp = root.querySelector('#st-quarter-plan');
    const anchor = header[header.length - 1];
    if (anchor) anchor.after(where, dec); else root.prepend(where, dec);
    if (qp) qp.after(next); else dec.after(next);
    return { header, where, dec, qp, next };
  }

  /** Called by strategy-tab.js after the tab renders and every mount step has run (actions, board, targets). */
  window.stArrangeLayout = function stArrangeLayout(root, s) {
    if (!root || root.querySelector('#st-fold-why')) return;
    const panel = root.parentElement;
    const top = placeTop(root, s);
    const why = whyFold(root, panel);
    const targets = targetsFold(root);
    root.append(why, targets);
    [...top.header, top.where, top.dec, top.qp, top.next, why, targets].filter(Boolean).forEach((el, i) => { el.style.order = String(i); });
    root.querySelector('#st-where').addEventListener('click', onTile);
    fillNextDelivery(top.next, s);
  };

  /** A tile opens its detail: the Why fold, scrolled to that analysis tile. */
  function onTile(e) {
    const el = e.target.closest('[data-mko-go]');
    if (!el) return;
    e.preventDefault();
    const key = String(el.dataset.mkoGo).replace(/^si:/, '');
    const why = document.getElementById('st-fold-why');
    if (why) why.open = true;
    setTimeout(() => document.querySelector(`[data-si-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  window.stLayoutParts = { salesTile, monthTile, bookedTile, returningTile, plansTile, decisionsHtml, nextDeliveryLine, plannedModel };
})();
