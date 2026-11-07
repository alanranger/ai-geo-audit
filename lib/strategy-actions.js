/**
 * Strategy & Actions: the ONE action list (S3), headline + KPI merges (S4), "Beginners → plans" (S5) and the tab
 * order (S6). Runs after strategy-tab.js renders #strategy-root (window.mountStrategyActions).
 *
 * Action list bands: Fill dates (diary "where to push" + "action needed", merged per event), Plan actions (quarter-
 * card actions, ticks write strategy_quarter_actions.is_ticked), Pages & search (Pipeline & Funnel Priority Action
 * Plan). Chips are real filters with live counts; filter + sort remembered per browser.
 */
(function () {
  const LS = 'st-action-list-v1';
  const BANDS = { fill: 'Fill dates', plan: 'Plan actions', pages: 'Pages & search' };
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (n) => (n == null ? '—' : (n < 0 ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB'));
  const DEFAULT_STATE = { band: 'all', overdue: false, done: false, sort: 'rank', dir: 1 };
  let state = loadState();
  let rows = [];

  function loadState() {
    try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch (_e) { return { ...DEFAULT_STATE }; }
  }
  function saveState() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (_e) { /* private mode */ } }

  // ---- rows -------------------------------------------------------------------------------------------------
  function extraGpIfFull(e) {
    const full = e.gp_full_free ?? e.gp_full;
    const now = e.gp_now_free ?? e.gp_now;
    return full == null || now == null ? null : full - now;
  }
  function fillRows(data) {
    const needed = new Map((data.action_needed || []).map((a) => [a.key, a]));
    return (data.push || []).map((e) => {
      const a = needed.get(e.eventKey);
      return {
        key: `fill|${e.eventKey}`, band: 'fill', title: e.title, url: e.url, due: e.date,
        detail: [e.gap, a?.detail].filter(Boolean).join(' · '),
        sources: a ? ['Diary: where to push', 'Action needed'] : ['Diary: where to push'],
        gp: extraGpIfFull(e), gpLabel: 'extra GP if full (this event)', overdue: false, done: !!e.full
      };
    });
  }
  function planRows(data) {
    const qLabel = new Map((data.quarters || []).map((q) => [q.key, q.label.split(' — ')[0]]));
    return (data.actions || []).map((a) => ({
      key: `plan|${a.id}`, band: 'plan', id: a.id, title: a.label, due: a.due_week_start, detail: '',
      sources: [`Quarter card ${qLabel.get(a.quarter_key) || a.quarter_key}`], gp: null, gpLabel: '',
      overdue: !a.is_ticked && a.due_week_start < data.week_start, done: !!a.is_ticked
    }));
  }
  let topCandidates = [];
  const pagesRow = (key, title, detail, source, extra = {}) => ({
    key: `pages|${key}`, band: 'pages', title, detail: detail || '', due: null, sources: [source],
    gp: null, gpLabel: '', overdue: false, done: false, ...extra
  });
  function priorityRows() {
    const pr = window.rfLatestSummary?.priorities;
    const list = Array.isArray(pr) ? pr : (pr?.rows || []);
    return list.map((p) => pagesRow(`prio|${p.id}`, p.title, p.estimated_lift, 'Priority Action Plan',
      { prio: p, gpLabel: p.estimated_lift ? 'estimated lift' : '', done: p.status === 'done' || p.status === 'cancelled' }));
  }
  function leverRows(src) {
    return (src?.levers || []).map((l) => pagesRow(`lever|${l.id}`, l.lever, `${l.first_action} · ${l.evidence}`, 'Recovery Opportunities',
      { gp: null, gpLabel: `£${Number(l.mid).toLocaleString('en-GB')}/yr mid case (£${Number(l.low).toLocaleString('en-GB')}–£${Number(l.high).toLocaleString('en-GB')})`, yearly: l.mid }));
  }
  function revenueRows(src) {
    const rescue = (src?.rescue || []).map((a, i) => pagesRow(`rescue|${i}|${a.text}`, a.text, [a.tierLabel, (a.measures || [])[0]].filter(Boolean).join(' · '), 'What to do next (Revenue)'));
    const inv = (src?.investigate || []).map((b, i) => pagesRow(`inv|${i}|${b.text}`, b.text, b.sub, 'Next to investigate'));
    const sig = (src?.signals || []).map((s, i) => pagesRow(`sig|${i}|${s.title}`, s.title, s.detail, 'Investigate (data signals)'));
    return [...rescue, ...inv, ...sig];
  }
  function topRows() {
    return topCandidates.map((c, i) => pagesRow(`top|${i}|${c.title}`, c.title, [c.tier_label, c.description].filter(Boolean).join(' · '), 'Do these 3 things',
      { gp: Math.round(Number(c.estimated_lift_gbp_profit) * 12) || null, gpLabel: `£${Math.round(Number(c.estimated_lift_gbp_profit) || 0).toLocaleString('en-GB')}/mo GP lift (shown per year)` }));
  }
  function pageRows() {
    const src = typeof window.rtActionSources === 'function' ? window.rtActionSources() : null;
    return [...topRows(), ...priorityRows(), ...leverRows(src), ...revenueRows(src)];
  }
  /** Same action from two sources → one row with both tags. */
  function mergeDuplicates(list) {
    const by = new Map();
    for (const r of list) {
      const k = `${r.band}|${String(r.title).toLowerCase().replace(/\s+/g, ' ').trim()}`;
      const hit = by.get(k);
      if (hit) hit.sources = [...new Set([...hit.sources, ...r.sources])];
      else by.set(k, { ...r });
    }
    return [...by.values()];
  }
  function rankValue(r) {
    const due = r.due ? Date.parse(`${r.due}T00:00:00Z`) : 8.64e15;
    return (r.overdue ? 0 : 1e16) + due - (Number(r.gp) || 0);
  }

  // ---- filtering / sorting ------------------------------------------------------------------------------------
  function passes(r, s) {
    if (s.band !== 'all' && r.band !== s.band) return false;
    if (!s.done && r.done) return false;
    if (s.overdue && !r.overdue) return false;
    return true;
  }
  const SORTERS = {
    rank: (r) => rankValue(r), band: (r) => r.band, title: (r) => String(r.title).toLowerCase(),
    source: (r) => r.sources.join(','), due: (r) => r.due || '9999', gp: (r) => -(Number(r.gp) || -1e9), status: (r) => (r.done ? 2 : r.overdue ? 0 : 1)
  };
  function visible() {
    const key = SORTERS[state.sort] || SORTERS.rank;
    return rows.filter((r) => passes(r, state)).sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * state.dir);
  }
  function countFor(over) { return rows.filter((r) => passes(r, { ...state, ...over })).length; }

  // ---- render ------------------------------------------------------------------------------------------------
  function chip(label, attr, on, n) {
    return `<button type="button" class="st-al-chip" ${attr} aria-pressed="${on}">${esc(label)} <span class="n">${n}</span></button>`;
  }
  function chipsHtml() {
    const bands = [['all', 'All'], ...Object.entries(BANDS)].map(([b, l]) => chip(l, `data-al-band="${b}"`, state.band === b, countFor({ band: b })));
    return bands.join('') + chip('Overdue only', 'data-al-toggle="overdue"', state.overdue, countFor({ overdue: true }))
      + chip('Show done', 'data-al-toggle="done"', state.done, countFor({ done: true }));
  }
  function actionCell(r) {
    if (r.band === 'plan') return `<input type="checkbox" class="st-al-tick" data-id="${r.id}" ${r.done ? 'checked' : ''} aria-label="Done">`;
    if (r.band === 'fill' && r.url) return `<a href="https://www.alanranger.com${esc(r.url)}" target="_blank" rel="noopener">Event page</a>`;
    return r.prio ? priorityButtons(r.prio) : '';
  }
  /** Same buttons as the old Priority Action Plan ("Start task" → Optimisation Tracking). */
  function priorityButtons(p) {
    const b = (action, label) => `<button type="button" class="rf-btn rf-btn-secondary" data-al-prio="${action}" data-id="${esc(p.id)}">${label}</button>`;
    if (p.optimisation_task_id) return `<a href="#optimisation" data-goto-panel="optimisation" data-goto-anchor="optimisation">Open task</a> ${p.status === 'done' ? '' : b('mark-done', 'Mark done')}`;
    if (p.status === 'done' || p.status === 'cancelled') return b('reopen', 'Reopen');
    return `${b('start', 'Start task')} ${b('dismiss', 'Skip')}`;
  }
  function statusCell(r) {
    if (r.done) return '<span class="rt-pill ok">done</span>';
    return r.overdue ? '<span class="rt-pill bad">overdue</span>' : '<span class="rt-pill partial">open</span>';
  }
  function rowHtml(r) {
    return `<tr data-al-key="${esc(r.key)}"><td>${esc(BANDS[r.band])}</td>`
      + `<td class="left"><b>${esc(r.title)}</b>${r.detail ? `<div class="rt-sub">${esc(r.detail)}</div>` : ''}</td>`
      + `<td class="left">${r.sources.map((s) => `<span class="st-al-tag">${esc(s)}</span>`).join(' ')}</td>`
      + `<td>${esc(r.due || '—')}</td><td title="${esc(r.gpLabel)}">${r.gp != null ? gbp(r.gp) : esc(r.gpLabel ? r.detail.slice(0, 28) : '—')}</td>`
      + `<td>${statusCell(r)}</td><td>${actionCell(r)}</td></tr>`;
  }
  function headHtml() {
    return [['band', 'Band'], ['title', 'Action'], ['source', 'Source'], ['due', 'Do by / date'], ['gp', 'Extra GP'], ['status', 'Status'], [null, '']]
      .map(([k, l]) => (k ? `<th data-al-sort="${k}" style="cursor:pointer">${l}${state.sort === k ? (state.dir > 0 ? ' ↑' : ' ↓') : ''}</th>` : '<th></th>')).join('');
  }
  const BAND_HEAD = {
    fill: 'THIS WEEK · fill the next dates (cash in the next 30 days)',
    plan: 'THIS QUARTER · plan actions',
    pages: 'PAGES & SEARCH · slower, bigger (yearly £, mid case)'
  };
  /** Ranked view: the three bands in order, each ranked by urgency then extra GP; other sorts are one flat list. */
  function bodyHtml(vis) {
    if (state.sort !== 'rank') return vis.map(rowHtml).join('');
    return Object.keys(BANDS).map((b) => {
      const list = vis.filter((r) => r.band === b);
      return list.length ? `<tr class="st-al-band"><td colspan="7" class="left">${esc(BAND_HEAD[b])} <span class="rt-sub">(${list.length})</span></td></tr>${list.map(rowHtml).join('')}` : '';
    }).join('');
  }
  function listHtml() {
    const vis = visible();
    return `<div class="st-al-chips">${chipsHtml()}</div>`
      + `<div class="rt-sub st-al-showing">Showing ${vis.length} of ${rows.length} · <a href="#" data-al-reset="1">Reset</a></div>`
      + `<div class="st-diary-scroll"><table class="rt-table" id="st-action-table"><thead><tr>${headHtml()}</tr></thead>`
      + `<tbody>${bodyHtml(vis) || '<tr><td colspan="7" class="rt-sub">Nothing matches these filters.</td></tr>'}</tbody></table></div>`;
  }
  function paint() {
    const host = document.getElementById('st-action-list-body');
    if (host) host.innerHTML = listHtml();
  }

  function onClick(e) {
    const t = e.target;
    const band = t.closest?.('[data-al-band]');
    const tog = t.closest?.('[data-al-toggle]');
    const sort = t.closest?.('[data-al-sort]');
    const reset = t.closest?.('[data-al-reset]');
    if (!band && !tog && !sort && !reset) return;
    e.preventDefault();
    if (band) state.band = band.getAttribute('data-al-band');
    if (tog) state[tog.getAttribute('data-al-toggle')] = !state[tog.getAttribute('data-al-toggle')];
    if (sort) applySort(sort.getAttribute('data-al-sort'));
    if (reset) state = { ...DEFAULT_STATE };
    saveState();
    paint();
  }
  function applySort(k) {
    state.dir = state.sort === k ? -state.dir : 1;
    state.sort = k;
  }
  async function onTick(e) {
    const box = e.target.closest?.('.st-al-tick');
    if (!box || typeof window.stTickAction !== 'function') return;
    box.disabled = true;
    try { await window.stTickAction(box.getAttribute('data-id'), box.checked); } catch (_e) { box.checked = !box.checked; box.disabled = false; }
  }

  // ---- S4 / S5 / S6 layout ------------------------------------------------------------------------------------
  function sectionByTitle(root, re) {
    return [...root.querySelectorAll(':scope > .rt-section')].find((s) => re.test(s.querySelector('h3')?.textContent || ''));
  }
  function bandClass(ok, warn) { return ok ? 'band-thrive' : (warn ? 'band-survival' : 'band-below_survival'); }
  /** [status class or null to keep, prior-12-month text] for the 4 headline tiles (S4). */
  function headlineBands(data) {
    const h = data.headline || {};
    const t = data.trends || {};
    const b8 = h.beginners_next_8w || {};
    const sc = data.scorecard?.returning || {};
    const plans = h.plans_active || 0;
    const retTarget = sc.target || 23000;
    return [
      [null, gbp(t.gp_t3_prior)],
      [bandClass(b8.seats && b8.booked / b8.seats >= 0.6, b8.booked > 0), t.beginners_fill_prior != null ? `${Math.round(t.beginners_fill_prior)}%` : '—'],
      [bandClass(plans >= 3, plans > 0), '—'],
      [bandClass(sc.pace >= retTarget, sc.pace >= retTarget * 0.9), gbp(sc.prior)]
    ];
  }
  function headlineStatus(root, data) {
    const cards = sectionByTitle(root, /Headline strip/)?.querySelectorAll('.rt-strip-card') || [];
    headlineBands(data).forEach(([cls, prior], i) => {
      if (!cards[i]) return;
      if (cls) cards[i].className = `rt-strip-card ${cls}`;
      cards[i].insertAdjacentHTML('beforeend', `<div class="rt-strip-meta">prior 12m: ${esc(prior)}</div>`);
    });
  }
  function mergeKpis(root, data) {
    const d = sectionByTitle(root, /D · KPI scorecard/);
    if (d) {
      d.querySelector('h3').textContent = 'KPI scorecard';
      d.querySelectorAll('#st-score tbody tr').forEach((tr) => {
        if (/^Residential avg/.test(tr.cells[0]?.textContent.trim() || '')) tr.remove();
        if (/Plan KPIs/.test(tr.cells[0]?.textContent || '')) tr.cells[0].innerHTML = `<b>Plans: ${(data.plan_clients?.rows || []).length} sold yet</b><div class="rt-sub">Plan conversion, credit, reviews, discount and renewals expand here once the first plan exists.</div>`;
      });
    }
    [/C · All 11 KPIs/, /G · Trends/, /F · Where to push/].forEach((re) => { const s = sectionByTitle(root, re); if (s) s.style.display = 'none'; });
  }
  /** Any .rt-section by title, including ones inside a wrapper grid (A and B sit side by side). */
  function sectionDeep(root, re) {
    return [...root.querySelectorAll('.rt-section')].find((s) => re.test(s.querySelector('h3')?.textContent || ''));
  }
  function hideWithWrapper(root, el) {
    if (!el) return;
    el.style.display = 'none';
    const wrap = el.parentElement;
    if (wrap && wrap !== root && [...wrap.children].every((c) => c.style.display === 'none' || c.tagName === 'STYLE')) wrap.style.display = 'none';
  }
  function beginnersPanel(root, data) {
    const parts = [/8 · Plan clients/, /9 · Beginners → plan conversion/, /A · Beginners by source/, /B · Plans & workshops signals/].map((re) => sectionDeep(root, re));
    const conv = parts[1];
    if (!conv) return null;
    const src = data.beginners_sources || {};
    const line = Object.entries(src).map(([k, v]) => `${esc(k)} ${v}`).join(' · ');
    const plans = (data.plan_clients?.rows || []).length ? parts[0]?.querySelector('table')?.outerHTML || '' : '';
    conv.querySelector('h3').innerHTML = 'Beginners → plans <span class="rt-sub">(completed courses: attendees by source, plans sold ≤60 days, conversion)</span>';
    conv.insertAdjacentHTML('beforeend', `<p class="rt-sub">Last 12 months by source: ${line} (JLR excluded from conversion).</p>${plans}`);
    parts.forEach((p, i) => { if (i !== 1) hideWithWrapper(root, p); });
    return conv;
  }
  /** The Top 3 tier / lever weights editor (moved here with Scenario Planning's retirement), collapsed. */
  function moveWeightsOnce(panel) {
    if (document.getElementById('st-weights')) return;
    const det = document.createElement('details');
    det.id = 'st-weights';
    det.className = 'rt-section';
    det.innerHTML = '<summary><h3 style="display:inline">Top 3 tier &amp; lever weights</h3> <span class="rt-sub">how "Do these 3 things" rows are picked</span></summary>';
    const ed = document.getElementById('rfTopActionsConfig');
    if (ed) { ed.style.display = ''; det.appendChild(ed); }
    panel.appendChild(det);
    window.rfTopActionsConfig?.reload?.();
    det.addEventListener('toggle', () => { if (det.open) window.rfTopActionsConfig?.reload?.(); }, { once: true });
  }
  function applyOrder(root, data) {
    const panel = root.parentElement;
    panel.classList.add('st-ordered');
    moveWeightsOnce(panel);
    const beg = beginnersPanel(root, data);
    const ord = [
      [sectionByTitle(root, /1 · Strategy pillars/), 1], [sectionByTitle(root, /Headline strip/), 2], [sectionByTitle(root, /Quarter cards/), 3],
      [document.getElementById('st-seasonality'), 4], [root.querySelector('#st-next4'), 5], [root.querySelector('#st-campaign'), 6],
      [document.getElementById('st-action-list'), 7], [document.getElementById('st-weights'), 8],
      [sectionByTitle(root, /Roadmap milestones/), 9], [beg, 10], [sectionByTitle(root, /KPI scorecard/), 11], [root.querySelector('#st-targets-host'), 12]
    ];
    ord.forEach(([el, n]) => { if (el) el.style.order = String(n); });
    dropOldNumbers(root);
  }
  /** The old "1 ·", "3 ·", "D ·" prefixes no longer match the order (S6); keep the names. */
  function dropOldNumbers(root) {
    root.querySelectorAll('.rt-section > h3').forEach((h) => {
      const tn = h.firstChild;
      if (tn && tn.nodeType === 3) tn.textContent = tn.textContent.replace(/^\s*[0-9A-G]\s*·\s*/, '');
    });
  }

  window.mountStrategyActions = function mountStrategyActions(root, data) {
    if (!root || !data) return;
    const h2 = root.querySelector('h2');
    if (h2) h2.textContent = 'Strategy & Actions';
    if (!root.querySelector('#st-action-list')) {
      root.insertAdjacentHTML('beforeend', '<div class="rt-section" id="st-action-list"><h3>Action list</h3>'
        + '<p class="rt-sub">Every "what to do next" in one list: fill the next dates (diary), this quarter\'s plan actions, pages &amp; search tasks. Ranked by urgency, then extra gross profit. Ticking a plan action ticks it on its quarter card.</p>'
        + '<div id="st-action-list-body"></div></div>');
    }
    rows = mergeDuplicates([...fillRows(data), ...planRows(data), ...pageRows()]);
    paint();
    headlineStatus(root, data);
    mergeKpis(root, data);
    if (typeof window.mountStrategyBoard === 'function') window.mountStrategyBoard(root, data);
    applyOrder(root, data);
    loadTopCandidates();
  };

  function refreshRows() {
    const data = window.stLastData ? window.stLastData() : null;
    if (data && document.getElementById('st-action-list-body')) { rows = mergeDuplicates([...fillRows(data), ...planRows(data), ...pageRows()]); paint(); }
  }
  async function loadTopCandidates() {
    if (typeof window.rfGetTopActionCandidates !== 'function') return;
    try { topCandidates = await window.rfGetTopActionCandidates(); refreshRows(); } catch (_e) { /* smart priorities optional */ }
  }
  async function onPriority(e) {
    const b = e.target.closest?.('[data-al-prio]');
    if (!b || typeof window.rfHandlePriorityAction !== 'function') return;
    b.disabled = true;
    try { await window.rfHandlePriorityAction(b.getAttribute('data-al-prio'), b.getAttribute('data-id')); } finally { b.disabled = false; }
  }

  window.addEventListener('rf:summary', () => { refreshRows(); loadTopCandidates(); });
  window.addEventListener('rt:sources', refreshRows);
  document.addEventListener('click', onPriority);
  document.addEventListener('click', onClick);
  document.addEventListener('change', onTick);
})();
