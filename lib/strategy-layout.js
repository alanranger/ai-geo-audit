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

  /* "Sales still needed", "This month" and "Booked ahead" are retired: the Sales gap section replaces them (booked
     ahead is a line inside each month's detail). Repeat clients and Academy progression moved here from Marketing. */
  function repeatTile(s) {
    const t = T()?.tileRepeat ? T().tileRepeat(s) : null;
    if (!t) return na(1, 'Repeat clients', 'returning sales not available', 'si:mix-returning');
    return { ...t, n: 1, go: 'si:mix-returning', goLabel: 'returning detail' };
  }
  function academyTile(s) {
    const t = T()?.tileAcademy ? T().tileAcademy(s) : null;
    if (!t) return na(3, 'Academy progression', 'Academy figures not available', 'si:mix-academy');
    return { ...t, n: 3, go: 'si:mix-academy', goLabel: 'Academy detail' };
  }
  function plansTile(s) {
    const x = tileOf(s, 'mix-pick-n-mix')?.numbers;
    const kpi = (s?.quarter_plan?.quarters || []).find((q) => q.state === 'current')?.kpis?.find((k) => k.key === 'plans');
    if (!x) return na(2, 'Pick n Mix plans', 'plan figures not available', 'si:mix-pick-n-mix');
    return {
      n: 2, title: 'Pick n Mix plans', rag: 'grey', go: 'si:mix-pick-n-mix', goLabel: 'Pick n Mix detail',
      head: `${x.since_relaunch} <span class="mko-unit">${kpi?.target != null ? `of ${kpi.target} ${esc(kpi.sub?.split('·')[1]?.trim() || '')}` : 'since relaunch'}</span>`,
      lines: [esc(x.status_line || '')], src: 'PnM Plans tab · Targets panel'
    };
  }
  function tilesHtml(s) {
    const tiles = [repeatTile(s), plansTile(s), academyTile(s)];
    const html = T()?.tileHtml ? tiles.map((t) => T().tileHtml(t)).join('') : '';
    return `${T()?.STYLE || ''}<h3>Where we are <span class="rt-sub">relationships and progression (moved here from Marketing) · each tile opens its detail</span></h3><div class="mko st-where-tiles"><div class="mko-grid st-g3">${html}</div></div>`;
  }

  /* ---------- 2 · Decisions for Alan (server: lib/strategy-decisions.mjs) ---------- */

  function targetDecisionsHtml(list, head) {
    const rows = list.map((d) => `<tr><td class="left"><b>${esc(d.what)}</b></td><td class="left">${esc(d.why)}</td><td class="left">${d.options.map(esc).join(' · ')}</td><td>${esc(ukDay(d.due))}</td></tr>`).join('');
    const body = list.length ? `<table class="rt-table st-dec"><thead><tr><th class="left">What</th><th class="left">Why</th><th class="left">Options</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="rt-sub">Nothing needs your decision right now.</p>';
    return `${head}${body}`;
  }
  /** Needs Alan = Marketing "Waiting on you" (server: one shared decision state); target decisions listed apart, not counted. */
  function needsAlanHtml(n) {
    const tip = 'The same list as Marketing “Waiting on you” (one shared decision state), so the two counts always match. Target decisions are worked out from the data and listed apart.';
    const head = `<h3>Needs Alan (${n.count == null ? '?' : n.count}) <span class="rt-sub" title="${esc(tip)}">ⓘ</span> <span class="rt-sub">same list as Marketing “Waiting on you”</span></h3>`;
    if (n.count == null) return `${head}<p class="rt-sub">Decision list unavailable: ${esc(n.error || 'unknown error')}</p>`;
    const rows = n.open.map((o) => `<tr><td class="left"><b>${esc(o.what)}</b></td><td class="left">${esc(o.why)}</td><td>${o.due ? esc(ukDay(o.due)) : '—'}${o.late ? ' · late' : ''}</td></tr>`).join('');
    return head + (n.open.length ? `<table class="rt-table st-dec"><thead><tr><th class="left">What</th><th class="left">Why</th><th>Due</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="rt-sub">Nothing is waiting on you.</p>');
  }
  function decisionsHtml(s) {
    const list = s?.decisions || [];
    if (!s?.needs_alan) return targetDecisionsHtml(list, `<h3>Decisions for Alan (${list.length}) <span class="rt-sub" title="Only decisions you must make: targets, offers, prices, approvals. Worked out from the data; GPT / Claude / Cursor tasks never appear here.">ⓘ</span></h3>`);
    const targets = list.length ? targetDecisionsHtml(list, `<h4>Target decisions (${list.length}) <span class="rt-sub">worked out from the data · not in the Needs Alan count</span></h4>`) : '';
    return needsAlanHtml(s.needs_alan) + targets;
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
  /** The shared delivery status for a schedule item (server index: step key, `send|campaign`, campaign key, item key). */
  function statusOfItem(x, s) {
    const by = s?.delivery_status?.by_key || {};
    return by[x.step_key] || (x.record_key && (by[`send|${x.record_key}`] || by[x.record_key])) || by[x.key] || null;
  }
  function nextDeliveryLine(x, s) {
    if (!x) return 'Next delivery: nothing planned yet <a href="#marketing" data-goto-marketing>→ Marketing</a>';
    const st = statusOfItem(x, s);
    if (st?.line) return `Next delivery: <b>${esc(x.title)}</b> · <span data-status="${esc(st.code)}">${esc(st.line)}</span> <a href="#marketing" data-goto-marketing>→ Marketing</a>`;
    const kind = x.draft || x.raw?.delivery?.bucket === 'draft' ? 'draft' : STATE[x.state] || x.state;
    return `Next delivery: <b>${esc(x.title)}</b> · ${esc(ukDay(x.day))}${x.time ? ` ${esc(x.time)}` : ''} · ${esc(kind)} <a href="#marketing" data-goto-marketing>→ Marketing</a>`;
  }
  async function fillNextDelivery(el, s) {
    const d = await loadOverview();
    const model = plannedModel(d, s);
    if (!el.isConnected) return;
    if (!model) { el.innerHTML = 'Next delivery: open <a href="#marketing" data-goto-marketing>Marketing →</a> (schedule not loaded)'; return; }
    const first = window.mkScheduleModel.firstPlanned(model);
    el.innerHTML = nextDeliveryLine(first, s);
    el.dataset.nextKey = first ? first.id : '';
  }

  /* ---------- folds ---------- */

  const KEEP = new Set(['st-sales-gap', 'st-remedy', 'st-prospects', 'st-quarter-cards', 'st-where', 'st-decisions', 'st-quarter-plan', 'st-next-delivery', 'st-fold-why', 'st-fold-targets']);
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
    .st-where-tiles .st-g3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 1300px) { .st-where-tiles .st-g3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    #st-next-delivery { padding: 0.55rem 0.9rem; font-size: 0.95rem; }
    .st-dec td { vertical-align: top; white-space: normal; } .qp-mk { font-size: 0.78rem; margin-left: 0.3rem; }
  </style>`;

  /** Sales gap tiles · Remedy plan · quarter planning cards (lib/strategy-sales-gap.js renders s.sales_gap). */
  function salesGapBlocks(s) {
    const html = typeof window.stSalesGapHtml === 'function' ? window.stSalesGapHtml(s) : { tiles: '<p class="rt-sub">Sales gap view not loaded.</p>', remedy: '', quarters: '' };
    const prospects = typeof window.stMountProspects === 'function' ? block('st-prospects', '<p class="rt-sub">Loading prospects…</p>') : block('st-prospects', '');
    return [block('st-sales-gap', html.tiles), block('st-remedy', html.remedy), prospects, block('st-quarter-cards', html.quarters)].filter((el) => el.innerHTML);
  }
  function placeTop(root, s) {
    const header = [...root.children].filter(isHeader);
    const gap = salesGapBlocks(s);
    const where = block('st-where', STYLE + tilesHtml(s));
    const dec = block('st-decisions', decisionsHtml(s));
    const next = block('st-next-delivery', 'Next delivery: loading the schedule…');
    const qp = root.querySelector('#st-quarter-plan');
    const anchor = header[header.length - 1];
    if (anchor) anchor.after(...gap, where, dec); else root.prepend(...gap, where, dec);
    if (qp) qp.after(next); else dec.after(next);
    return { header, gap, where, dec, qp, next };
  }

  /** Called by strategy-tab.js after the tab renders and every mount step has run (actions, board, targets). */
  window.stArrangeLayout = function stArrangeLayout(root, s) {
    if (!root || root.querySelector('#st-fold-why')) return;
    const panel = root.parentElement;
    const top = placeTop(root, s);
    const why = whyFold(root, panel);
    const targets = targetsFold(root);
    root.append(why, targets);
    [...top.header, ...top.gap, top.where, top.dec, top.qp, top.next, why, targets].filter(Boolean).forEach((el, i) => { el.style.order = String(i); });
    root.querySelector('#st-where').addEventListener('click', onTile);
    root.querySelectorAll('#st-sales-gap, #st-remedy').forEach((el) => el.addEventListener('click', onMarketingLink));
    if (typeof window.stMountProspects === 'function') window.stMountProspects(root.querySelector('#st-prospects'), s);
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

  /** Remedy lever links (event campaigns, gift / Pick n Mix / 1-2-1 campaigns) open the Marketing tab. */
  function onMarketingLink(e) {
    const a = e.target.closest('[data-goto-marketing]');
    if (!a) return;
    e.preventDefault();
    document.querySelector('.aigeo-nav-item[data-panel="marketing"]')?.click();
  }

  window.stLayoutParts = { repeatTile, academyTile, plansTile, tilesHtml, decisionsHtml, nextDeliveryLine, plannedModel, salesGapBlocks };
})();
