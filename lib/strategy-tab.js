/**
 * Strategy & KPIs tab v5 — full restored layout + v4 diary/RAG + Part 1 capacity.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  let lastData = null;
  let flashSavedId = null;
  let filterState = { rag: 'all', type: 'all', needs: false };
  /** Set true to revert B/E to the old stacked "free / paid" cell (Alan may ask). */
  const ST_BE_STACKED = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function gbp(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return '£' + Math.round(Number(n)).toLocaleString('en-GB');
  }
  function pct0(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Math.round(Number(n)) + '%';
  }
  function fmtChange(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return (v >= 0 ? '+' : '') + Math.round(v) + '%';
  }
  function fmtVal(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 100) return gbp(v);
      return String(Math.round(v * 10) / 10);
    }
    return esc(String(v));
  }
  /** Unit-aware scorecard cell: pct → "70%", gbp → "£2,767", else fmtVal. */
  function fmtKpi(v, unit) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (unit === 'pct') return Math.round(v) + '%';
      if (unit === 'gbp') return gbp(v);
    }
    return fmtVal(v);
  }
  function fmtTarget(k) {
    if (typeof k.target === 'number') {
      if (k.unit === 'pct') return '≥' + Math.round(k.target) + '%';
      if (k.unit === 'gbp' || k.target >= 100) return gbp(k.target);
    }
    return esc(k.target);
  }
  function dayName(iso) {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
    });
  }
  function pill(status, text) {
    const cls = status === 'ok' || status === 'green' ? 'ok'
      : status === 'below' || status === 'bad' || status === 'red' ? 'bad'
      : status === 'needs_plans' || status === 'n/a' ? 'partial' : 'warn';
    return `<span class="rt-pill ${cls}">${esc(text || status)}</span>`;
  }
  function hrefOf(url) {
    if (!url) return null;
    return url.startsWith('http') ? url : `https://www.alanranger.com${url}`;
  }
  function eventLink(e) {
    const href = hrefOf(e.url);
    if (!href) return esc(e.title);
    return `<a class="st-event-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(e.title)}</a>`;
  }
  function ragChip(rag, full) {
    const label = full ? 'GREEN ✓' : String(rag || '').toUpperCase();
    const cls = rag === 'green' ? 'st-rag-chip green' : rag === 'red' ? 'st-rag-chip red' : 'st-rag-chip amber';
    return `<span class="${cls}">${esc(label)}</span>`;
  }
  function sortTable(table) {
    table.querySelectorAll('th[data-col]').forEach((th) => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = Number(th.dataset.col);
        const tbody = table.tBodies[0];
        if (!tbody) return;
        const rows = [...tbody.rows];
        const asc = th.dataset.dir !== 'asc';
        table.querySelectorAll('th').forEach((h) => { h.dataset.dir = ''; });
        th.dataset.dir = asc ? 'asc' : 'desc';
        rows.sort((a, b) => {
          const as = a.cells[col]?.dataset?.sort;
          const bs = b.cells[col]?.dataset?.sort;
          const av = as != null && as !== '' ? as : (a.cells[col]?.innerText.trim() || '');
          const bv = bs != null && bs !== '' ? bs : (b.cells[col]?.innerText.trim() || '');
          const an = Number(String(av).replace(/[^0-9.-]/g, ''));
          const bn = Number(String(bv).replace(/[^0-9.-]/g, ''));
          const cmp = (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).match(/[0-9]/))
            ? an - bn : String(av).localeCompare(String(bv));
          return asc ? cmp : -cmp;
        });
        rows.forEach((r) => tbody.appendChild(r));
      });
    });
  }

  async function patchAction(id, body) {
    const r = await fetch('/api/aigeo/strategy-actions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, propertyUrl: PROP, ...body })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'patch failed');
    return j.action;
  }

  /** "12 of 15 done · 1 overdue · 2 due in next 4 weeks" (S3b). */
  function quarterSummary(acts, week) {
    const in4 = new Date(`${week}T12:00:00Z`);
    in4.setUTCDate(in4.getUTCDate() + 28);
    const horizon = in4.toISOString().slice(0, 10);
    const open = acts.filter((a) => !a.is_ticked);
    const overdue = open.filter((a) => a.due_week_start < week).length;
    const soon = open.filter((a) => a.due_week_start >= week && a.due_week_start < horizon).length;
    return `${acts.length - open.length} of ${acts.length} done · ${overdue} overdue · ${soon} due in next 4 weeks`;
  }

  /** Tick / untick a quarter action from anywhere on the tab (cards, action list); re-renders the tab. */
  window.stTickAction = async function stTickAction(id, next) {
    const action = await patchAction(Number(id), { is_ticked: !!next });
    const row = lastData?.actions?.find((a) => Number(a.id) === Number(id));
    if (row) Object.assign(row, action);
    const root = document.getElementById('strategy-root');
    if (root && lastData) render(root, lastData);
    return action;
  };

  function renderActions(data) {
    const byQ = {};
    for (const a of data.actions || []) (byQ[a.quarter_key] = byQ[a.quarter_key] || []).push(a);
    const week = data.week_start;
    return (data.quarters || []).map((q) => {
      const isCur = q.key === data.current_quarter;
      const acts = byQ[q.key] || [];
      const open = acts.filter((a) => !a.is_ticked).sort((a, b) => a.sort_order - b.sort_order);
      const done = acts.filter((a) => a.is_ticked).sort((a, b) => a.sort_order - b.sort_order);
      const ordered = open.concat(done);
      const t = q.targets || {};
      const lis = ordered.map((a) => {
        const overdue = !a.is_ticked && a.due_week_start < week;
        const flash = flashSavedId === a.id ? '<span class="st-saved">Saved ✓</span>' : '';
        return `<li class="${a.is_ticked ? 'st-done' : ''}${overdue ? ' st-overdue' : ''}" data-id="${a.id}">
          <button type="button" class="st-tick ${a.is_ticked ? 'on' : ''}" data-id="${a.id}" aria-pressed="${a.is_ticked}" title="Toggle"></button>
          <span class="st-lab" contenteditable="true" data-id="${a.id}">${esc(a.label)}</span>
          <span class="st-meta"><input class="st-due" type="date" data-id="${a.id}" value="${esc(a.due_week_start)}" />
          <span class="st-side">${flash}${overdue ? pill('bad', 'OVERDUE') : ''}</span></span>
        </li>`;
      }).join('');
      return `<div class="qcard ${isCur ? 'is-current' : ''}" ${isCur ? '' : 'style="opacity:.75"'}>
        <h4>${esc(q.label)} ${isCur ? '<span class="rt-pill current">CURRENT</span>' : ''}
          <span class="st-progress">${quarterSummary(acts, week)}</span></h4>
        <div class="obj">${esc(q.objective)}</div>
        <ul>${lis}</ul>
        <div class="qmeta">Targets: ${t.plans} plans · ${t.beginners_non_jlr} non-JLR · GP T3 ${gbp(t.gp_t3)} · returning ${gbp(t.returning_r12)}</div>
      </div>`;
    }).join('');
  }

  window.stLastData = () => lastData;
  /** S3 Action list, S4 / S5 merges and the S6 order (lib/strategy-actions.js). */
  function mountActionsLayer(root, data) {
    if (typeof window.mountStrategyActions === 'function') window.mountStrategyActions(root, data);
  }
  function mountTargetsHost(root) {
    if (typeof window.mountTargetsPanel === 'function') window.mountTargetsPanel(root.querySelector('#st-targets-host'));
  }

  function gbpSigned(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Math.round(Number(n));
    return (v < 0 ? '-£' : '£') + Math.abs(v).toLocaleString('en-GB');
  }
  function ragClass(rag) {
    return rag === 'green' ? 'st-c-green' : rag === 'red' ? 'st-c-red' : 'st-c-amber';
  }
  function leftCell(e, rag) {
    return `<td class="st-big ${ragClass(rag)}" data-sort="${e.left}">${e.left}</td>`;
  }
  function beFreeCell(e, rag) {
    const free = e.be_free != null ? e.be_free : e.be;
    const have = e.rag_booked != null ? e.rag_booked : e.booked;
    const short = free != null ? free - have : 0;
    const hint = short > 0
      ? `<div class="st-be-hint">${free} needed / ${short} short</div>`
      : '';
    return `<td class="st-big ${ragClass(rag)}" data-sort="${free ?? ''}">${free ?? '—'}${hint}</td>`;
  }
  function bePaidCell(e) {
    const after = e.be_after;
    return `<td class="st-big" data-sort="${after ?? ''}">${after != null ? after : '—'}</td>`;
  }
  /** Legacy stacked B/E — enabled when ST_BE_STACKED is true. */
  function beStackedCell(e, rag) {
    const free = e.be_free != null ? e.be_free : e.be;
    const after = e.be_after;
    const have = e.rag_booked != null ? e.rag_booked : e.booked;
    const label = after != null ? `${free} / ${after}` : String(free ?? '—');
    const short = free != null ? free - have : 0;
    const hint = short > 0
      ? `<div class="st-be-hint">${free} needed / ${short} short</div>`
      : '';
    return `<td class="st-big ${ragClass(rag)}" data-sort="${free ?? ''}">${label}${hint}</td>`;
  }
  function beCells(e, rag) {
    if (ST_BE_STACKED) return beStackedCell(e, rag);
    return `${beFreeCell(e, rag)}${bePaidCell(e)}`;
  }
  function gpSingleCell(val, est, tip) {
    if (val == null || Number.isNaN(Number(val))) {
      return `<td data-sort=""${tip ? ` title="${esc(tip)}"` : ''}>—</td>`;
    }
    const neg = Number(val) < 0 ? ' st-gp-neg' : '';
    const estMark = est ? ' <span class="st-est">est.</span>' : '';
    return `<td class="${neg.trim()}" data-sort="${val}"${tip ? ` title="${esc(tip)}"` : ''}>${gbpSigned(val)}${estMark}</td>`;
  }
  function flagCell(e) {
    const flag = e.mismatch
      ? `<span title="${esc(e.flag_message || '')}">${pill('bad', 'MISMATCH')}</span>`
      : '—';
    return `<td>${flag}${e.over ? ` ${pill('bad', 'Over cap')}` : ''}</td>`;
  }
  function paceSinceLabel(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00Z`);
    return `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  }
  function paceCell(e) {
    if (e.pace == null) return '<td data-sort="">—</td>';
    const n = Number(e.pace);
    const cls = n > 0 ? 'st-pace-up' : n < 0 ? 'st-pace-down' : 'st-pace-zero';
    const txt = n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
    const sub = e.pace_since
      ? `<div class="rt-sub">since ${esc(paceSinceLabel(e.pace_since))}</div>` : '';
    return `<td class="${cls}" data-sort="${n}">${txt}${sub}</td>`;
  }
  function snapshotWarn(data) {
    const m = data.snapshot_meta || {};
    if (!m.warn_after_7uk) return '';
    const d = m.today || 'today';
    return `<p class="st-snap-warn">Booking snapshot missing for ${esc(d)}, +wk may be wrong</p>`;
  }
  function parentRow(e) {
    const fill = e.fill_pct != null ? `${e.fill_pct}%` : '—';
    const bePad = ST_BE_STACKED ? '<td>—</td>' : '<td>—</td><td>—</td>';
    return `<tr class="st-parent" data-parent="1" data-key="${esc(e.eventKey)}" data-rag="parent" data-type="${esc(e.type)}" data-needs="${e.mismatch ? '1' : '0'}">
        <td>${esc(dayName(e.date))}</td>
        <td class="left" title="${esc(e.capacity_source || '')}">${eventLink(e)}${ovHtml(e)}${e.note ? `<div class="rt-sub">${esc(e.note)}</div>` : ''}
          ${e.flag_message ? `<div class="rt-sub">${esc(e.flag_message)}</div>` : ''}</td>
        <td>${gbp(e.price)}</td><td>${e.cap}</td><td>${e.booked}</td><td>${e.left}</td>
        <td>${esc(fill)}</td>${paceCell(e)}
        ${bePad}<td>—</td><td>—</td><td>—</td><td>—</td>
        <td>—</td><td>—</td><td>—</td><td>—</td>
        ${flagCell(e)}
      </tr>`;
  }
  const ovHtml = (e) => (typeof window.stOverrideHtml === 'function' ? window.stOverrideHtml(e) : '');
  function eventCell(e) {
    if (!e.is_subrow) {
      const noLoc = e.no_location ? ' <span class="st-no-loc" title="No travel location matched — mileage/drive not charged">no location</span>' : '';
      return `<td class="left" title="${esc(e.capacity_source || '')}">${eventLink(e)}${noLoc}${ovHtml(e)}${e.note ? `<div class="rt-sub">${esc(e.note)}</div>` : ''}
          ${e.flag_message ? `<div class="rt-sub">${esc(e.flag_message)}</div>` : ''}</td>`;
    }
    const href = hrefOf(e.url);
    const label = `↳ ${esc(e.session)} session`;
    const noLoc = e.no_location ? ' <span class="st-no-loc" title="No travel location matched — mileage/drive not charged">no location</span>' : '';
    const inner = href
      ? `<a class="st-event-link" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : label;
    return `<td class="left st-sub-cell" title="${esc(e.capacity_source || '')}">${inner}${noLoc}</td>`;
  }
  function eventRow(e) {
    const rag = e.rag || 'amber';
    const statusTxt = e.full ? 'Full ✓' : e.status;
    const fill = e.fill_pct != null ? `${e.fill_pct}%` : '—';
    const cls = e.is_subrow ? ' class="st-subrow"' : '';
    const par = e.is_subrow ? ` data-parent-key="${esc(e.parentKey)}"` : '';
    return `<tr${cls}${par} data-rag="${rag}" data-type="${esc(e.type)}" data-needs="${rag !== 'green' ? '1' : '0'}">
        <td>${esc(dayName(e.date))}</td>
        ${eventCell(e)}
        <td>${gbp(e.price)}</td>
        <td>${e.cap}</td>
        <td>${e.booked}</td>
        ${leftCell(e, rag)}
        <td>${esc(fill)}</td>
        ${paceCell(e)}
        ${beCells(e, rag)}
        <td data-sort="${rag}">${ragChip(rag, e.full)}</td>
        <td>${pill(rag === 'green' ? 'ok' : rag === 'red' ? 'bad' : 'warn', statusTxt)}</td>
        <td data-sort="${e.booked_gbp ?? ''}">${gbp(e.booked_gbp)}</td>
        <td data-sort="${e.unsold_gbp ?? ''}">${gbp(e.unsold_gbp)}</td>
        ${gpSingleCell(e.gp_now_free, e.gp_est, e.gp_tooltip)}
        ${gpSingleCell(e.gp_now_after, e.gp_est, e.gp_tooltip)}
        ${gpSingleCell(e.gp_full_free, e.gp_est, e.gp_tooltip)}
        ${gpSingleCell(e.gp_full_after, e.gp_est, e.gp_tooltip)}
        ${flagCell(e)}
      </tr>`;
  }
  function diaryRows(data) {
    return (data.diary || []).map((e) => (e.is_parent ? parentRow(e) : eventRow(e))).join('');
  }
  function diaryGpFooter(data) {
    const g = data.diary_gp;
    if (!g || !g.rows) return '';
    const est = g.est_rows ? ` <span class="st-est">(${g.est_rows} of ${g.rows} rows est. — walks/courses)</span>` : '';
    const src = g.model_loaded
      ? 'per-event Workshop Costs (time free + after £30/h)'
      : 'category GP rates (no Workshop Costs model yet)';
    const um = (g.unmatched || []).length
      ? `<br><span class="st-est">No location (grey flag): ${esc(g.unmatched.slice(0, 8).join('; '))}${g.unmatched.length > 8 ? '…' : ''}</span>`
      : '';
    const nf = g.now_free != null ? g.now_free : g.now;
    const na = g.now_after;
    const ff = g.full_free != null ? g.full_free : g.full;
    const fa = g.full_after;
    return `<p class="rt-sub st-gp-total">Totals — GP now (free) <b class="${nf < 0 ? 'st-gp-neg' : ''}">${gbpSigned(nf)}</b>
      · GP now (paid) <b class="${na != null && na < 0 ? 'st-gp-neg' : ''}">${na != null ? gbpSigned(na) : '—'}</b>
      · GP if full (free) <b class="${ff < 0 ? 'st-gp-neg' : ''}">${gbpSigned(ff)}</b>
      · GP if full (paid) <b class="${fa != null && fa < 0 ? 'st-gp-neg' : ''}">${fa != null ? gbpSigned(fa) : '—'}</b>${est} · source: ${esc(src)}${um}</p>`;
  }

  function applyFilters(root) {
    const shownParents = new Set();
    root.querySelectorAll('#st-diary tbody tr:not([data-parent])').forEach((tr) => {
      const ragOk = filterState.rag === 'all' || tr.dataset.rag === filterState.rag;
      const typeOk = filterState.type === 'all' || tr.dataset.type === filterState.type;
      const needsOk = !filterState.needs || tr.dataset.needs === '1';
      const show = ragOk && typeOk && needsOk;
      tr.style.display = show ? '' : 'none';
      if (show && tr.dataset.parentKey) shownParents.add(tr.dataset.parentKey);
    });
    root.querySelectorAll('#st-diary tbody tr[data-parent]').forEach((tr) => {
      const typeOk = filterState.type === 'all' || tr.dataset.type === filterState.type;
      const own = filterState.rag === 'all' && (!filterState.needs || tr.dataset.needs === '1');
      tr.style.display = typeOk && (own || shownParents.has(tr.dataset.key)) ? '' : 'none';
    });
  }

  function bindTicks(root) {
    root.querySelectorAll('.st-tick').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const li = btn.closest('li');
        const wasOn = btn.classList.contains('on');
        const next = !wasOn;
        btn.disabled = true;
        btn.classList.toggle('on', next);
        try {
          const action = await patchAction(id, { is_ticked: next });
          const row = lastData?.actions?.find((a) => Number(a.id) === id);
          if (row) Object.assign(row, action);
          flashSavedId = id;
          render(root, lastData);
          setTimeout(() => {
            if (flashSavedId === id) { flashSavedId = null; render(root, lastData); }
          }, 1600);
        } catch (e) {
          btn.classList.toggle('on', wasOn);
          if (li) {
            const err = document.createElement('span');
            err.className = 'st-err';
            err.textContent = 'Not saved — try again';
            li.appendChild(err);
          }
        } finally { btn.disabled = false; }
      });
    });
    root.querySelectorAll('.st-due').forEach((inp) => {
      inp.addEventListener('change', async () => {
        try { await patchAction(Number(inp.dataset.id), { due_week_start: inp.value }); }
        catch (e) { alert(e.message || String(e)); }
      });
    });
    root.querySelectorAll('.st-lab').forEach((el) => {
      el.addEventListener('blur', async () => {
        try { await patchAction(Number(el.dataset.id), { label: el.textContent.trim() }); }
        catch (e) { alert(e.message || String(e)); }
      });
    });
  }

  /** Styles for #strategy-root and the diary host on Pipeline & Funnel. */
  function stylesHtml() {
    return `
      <style>
        :is(#strategy-root, #rf-diary-host) a, :is(#strategy-root, #rf-diary-host) .st-event-link { color:#e5e7eb !important; text-decoration:underline; text-underline-offset:2px; }
        :is(#strategy-root, #rf-diary-host) a:hover, :is(#strategy-root, #rf-diary-host) .st-event-link:hover { color:#ffffff !important; }
        :is(#strategy-root, #rf-diary-host) .st-rag-chip { display:inline-block; min-width:4.2rem; text-align:center; padding:.15rem .4rem; border-radius:4px; font-size:.68rem; font-weight:800; letter-spacing:.03em; color:#fff; }
        :is(#strategy-root, #rf-diary-host) .st-rag-chip.red { background:#dc2626; }
        :is(#strategy-root, #rf-diary-host) .st-rag-chip.amber { background:#d97706; }
        :is(#strategy-root, #rf-diary-host) .st-rag-chip.green { background:#16a34a; }
        :is(#strategy-root, #rf-diary-host) .st-big { font-weight:800; font-size:1.05rem; }
        :is(#strategy-root, #rf-diary-host) .st-c-red { color:#f87171; }
        :is(#strategy-root, #rf-diary-host) .st-c-amber { color:#fbbf24; }
        :is(#strategy-root, #rf-diary-host) .st-c-green { color:#4ade80; }
        :is(#strategy-root, #rf-diary-host) .st-be-hint { font-size:.62rem; font-weight:600; opacity:.9; white-space:nowrap; }
        :is(#strategy-root, #rf-diary-host) .st-gp-neg { color:#f87171; font-weight:700; }
        :is(#strategy-root, #rf-diary-host) .st-pace-up { color:#4ade80; font-weight:700; }
        :is(#strategy-root, #rf-diary-host) .st-pace-down { color:#f87171; font-weight:700; }
        :is(#strategy-root, #rf-diary-host) .st-pace-zero { color:#94a3b8; font-weight:600; }
        :is(#strategy-root, #rf-diary-host) .st-snap-warn { color:#f87171; font-weight:700; font-size:.85rem; margin:0 0 .5rem; }
        :is(#strategy-root, #rf-diary-host) .st-est { color:#94a3b8; font-size:.62rem; font-weight:600; }
        :is(#strategy-root, #rf-diary-host) .st-no-loc { display:inline-block; margin-left:.35rem; padding:.1rem .35rem; border-radius:4px; font-size:.62rem; font-weight:700; letter-spacing:.03em; color:#94a3b8; background:#1e293b; border:1px solid #334155; vertical-align:middle; }
        :is(#strategy-root, #rf-diary-host) .st-diary-scroll { overflow-x:auto; max-width:100%; -webkit-overflow-scrolling:touch; }
        :is(#strategy-root, #rf-diary-host) .st-diary-scroll .rt-table { min-width:980px; }
        :is(#strategy-root, #rf-diary-host) #st-diary thead th { white-space:normal; line-height:1.15; vertical-align:bottom; max-width:5.5rem; }
        :is(#strategy-root, #rf-diary-host) #st-diary th.left, :is(#strategy-root, #rf-diary-host) #st-diary td.left { text-align:left; }
        :is(#strategy-root, #rf-diary-host) #st-diary thead th.left { max-width:none; }
        :is(#strategy-root, #rf-diary-host) tr.st-parent td { color:#94a3b8; font-size:.8rem; background:#0b1118; }
        :is(#strategy-root, #rf-diary-host) tr.st-subrow td:first-child { padding-left:1.1rem; }
        :is(#strategy-root, #rf-diary-host) .st-sub-cell { padding-left:1.4rem; }
        :is(#strategy-root, #rf-diary-host) .st-filters { display:flex; flex-wrap:wrap; gap:.5rem; margin:.5rem 0 .75rem; align-items:center; }
        :is(#strategy-root, #rf-diary-host) .st-filters label { font-size:.8rem; color:var(--rt-muted,#94a3b8); background:#0b1118; border:1px solid #1f2937; padding:.25rem .5rem; border-radius:6px; }
        :is(#strategy-root, #rf-diary-host) .st-trend-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; }
        :is(#strategy-root, #rf-diary-host) .st-trend { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:.7rem; }
        :is(#strategy-root, #rf-diary-host) .st-trend .big { font-size:1.15rem; font-weight:800; color:#f59e0b; }
        :is(#strategy-root, #rf-diary-host) .st-actions { list-style:none; padding:0; margin:.4rem 0 0; }
        :is(#strategy-root, #rf-diary-host) .st-actions li { margin:.35rem 0; font-size:.85rem; }
        :is(#strategy-root, #rf-diary-host) .pillars { display:grid; grid-template-columns:repeat(3,1fr); gap:.7rem; }
        :is(#strategy-root, #rf-diary-host) .pillar { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:.75rem; }
        :is(#strategy-root, #rf-diary-host) .pillar h4 { margin:0 0 .35rem; color:#f59e0b; }
        @media (max-width:900px){
          :is(#strategy-root, #rf-diary-host) .st-trend-grid, :is(#strategy-root, #rf-diary-host) .pillars { grid-template-columns:1fr; }
        }
      </style>
    `;
  }
  /** "Future bookings: next 12 weeks, diary & gaps" — shown on Pipeline & Funnel (P9 §1). */
  function diarySectionHtml(data) {
    return `
      <div class="rt-section" id="st-diary-section">
        <h3>Future bookings: next 12 weeks, diary &amp; gaps</h3>
        ${snapshotWarn(data)}
        <div class="st-filters">
          <label>RAG <select id="st-rag"><option value="all">All</option><option value="red">Red</option><option value="amber">Amber</option><option value="green">Green</option></select></label>
          <label>Type <select id="st-type"><option value="all">All</option><option value="day">Day</option><option value="residential">Residential</option><option value="course">Course</option><option value="walk">Walk</option></select></label>
          <label><input type="checkbox" id="st-needs"> Needs action only</label>
          <span class="rt-sub">${(data.diary || []).length} events · day/walk cap 6 · Batsford AM+PM linked · RAG = B/E (free time)</span>
        </div>
        <div class="st-diary-scroll">
        <table class="rt-table" id="st-diary">
          <thead><tr>
            <th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">Price</th><th data-col="3">Cap</th>
            <th data-col="4">Booked</th><th data-col="5">Left</th><th data-col="6">Fill</th>
            <th data-col="7" title="Places booked in the last 7 days (from the daily 07:15 snapshot)">+wk</th>
            ${ST_BE_STACKED
    ? '<th data-col="8" title="B/E free / paid. RAG uses free time.">B/E</th>'
    : `<th data-col="8" title="Free time = cash in minus cash out. Drives RAG.">B/E<br>(free time)</th>
            <th data-col="9" title="Paid time = also pays you £30/h for event hours plus driving.">B/E<br>(paid time)</th>`}
            <th data-col="${ST_BE_STACKED ? 9 : 10}">RAG</th>
            <th data-col="${ST_BE_STACKED ? 10 : 11}">Status</th>
            <th data-col="${ST_BE_STACKED ? 11 : 12}">Revenue<br>booked</th>
            <th data-col="${ST_BE_STACKED ? 12 : 13}">Revenue<br>unsold</th>
            <th data-col="${ST_BE_STACKED ? 13 : 14}" title="Free time = cash in minus cash out.">GP now<br>(free time)</th>
            <th data-col="${ST_BE_STACKED ? 14 : 15}" title="Paid time = also pays you £30/h for event hours plus driving.">GP now<br>(paid time)</th>
            <th data-col="${ST_BE_STACKED ? 15 : 16}" title="Free time = cash in minus cash out.">GP if full<br>(free time)</th>
            <th data-col="${ST_BE_STACKED ? 16 : 17}" title="Paid time = also pays you £30/h for event hours plus driving.">GP if full<br>(paid time)</th>
            <th data-col="${ST_BE_STACKED ? 17 : 18}">Flags</th>
          </tr></thead>
          <tbody>${diaryRows(data)}</tbody>
        </table>
        </div>
        ${diaryGpFooter(data)}
      </div>
    `;
  }

  function render(root, data) {
    lastData = data;
    const t = data.trends || {};
    const h = data.headline || {};
    const now = data.roadmap_now || {};
    const sources = data.beginners_sources || {};
    const ws = data.workshop_signals || {};
    const plansEmpty = data.plan_clients?.empty_reason;
    const convNote = data.beginners_conversion?.empty_note;
    const survival = data.survival_gp || 0;
    const survT3 = data.survival_t3_gp;

    root.innerHTML = `
      ${stylesHtml()}
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin-bottom:.25rem;">
        <h2>Strategy &amp; KPIs</h2>
        <span class="rt-prov-pill rt-prov-dynamic">LIVE v6</span>
      </div>
      <p class="rt-sub">Current position, gaps, and plan ·
        <a href="https://www.alanranger.com" target="_blank" rel="noopener">plan document ↗</a></p>

      <div class="rt-section">
        <h3>1 · Strategy pillars</h3>
        <div class="pillars">
          <div class="pillar"><h4>Fill the front door</h4><p>£150 3-evening beginners at home (max 4). Google, gift vouchers, referrals. JLR = upside only.</p></div>
          <div class="pillar"><h4>Keep them</h4><p>“Your first year” Pick n Mix on every beginners last night — from £600 / £50pm; reviews quarterly; Academy free 12m.</p></div>
          <div class="pillar"><h4>Protect margins</h4><p>Fewer proven workshops; max 4 / one car on residentials; plan clients first refusal; hold 1-2-1 prices.</p></div>
        </div>
      </div>

      <div class="rt-section">
        <h3>2 · Quarter cards Q1–Q4</h3>
        <div class="quarters">${renderActions(data)}</div>
      </div>

      <div class="rt-section">
        <h3>3 · Headline strip</h3>
        <div class="rt-strip">
          <div class="rt-strip-card ${h.gp_t3 != null && h.gp_t3 < survT3 ? 'band-below_survival' : 'band-thrive'}">
            <div class="rt-strip-label">1 · GP / month (T3)</div>
            <div class="rt-strip-value">${gbp(h.gp_t3)}</div>
            <div class="rt-strip-meta">vs seasonal survival ${gbp(survT3)} (same 3 months) · bills line ${gbp(survival)}</div>
            <div class="rt-strip-meta"><a href="#rt-monthly-chart" data-goto-panel="revenue-truth" data-goto-anchor="rt-monthly-chart">Month-by-month chart on Revenue →</a></div>
          </div>
          <div class="rt-strip-card band-thrive">
            <div class="rt-strip-label">2 · Beginners seats</div>
            <div class="rt-strip-value">${h.beginners_fill_pct != null ? pct0(h.beginners_fill_pct) : '—'}</div>
            <div class="rt-strip-meta">R12 · next 8w ${h.beginners_next_8w?.booked || 0}/${h.beginners_next_8w?.seats || 0}</div>
          </div>
          <div class="rt-strip-card band-comfortable">
            <div class="rt-strip-label">5 · Plans active</div>
            <div class="rt-strip-value">${h.plans_active != null ? h.plans_active : '—'}</div>
            <div class="rt-strip-meta">${esc(h.plans_meta || 'No plans yet')}</div>
          </div>
          <div class="rt-strip-card band-survival">
            <div class="rt-strip-label">9 · Returning £ (R12)</div>
            <div class="rt-strip-value">${gbp(h.returning_r12)}</div>
            <div class="rt-strip-meta">Q1 £16k · year-end £23k</div>
          </div>
        </div>
      </div>

        <div class="rt-section">
        <h3>5 · Roadmap milestones</h3>
          <table class="rt-table" id="st-roadmap">
            <thead><tr><th class="left" data-col="0">Metric</th><th data-col="1">Dec 26</th><th data-col="2">Mar 27</th><th data-col="3">Jun 27</th><th data-col="4">Sep 27</th><th data-col="5">Now</th></tr></thead>
            <tbody>
              <tr><td class="left">Plans sold</td><td>3</td><td>6</td><td>9</td><td>12</td><td><b>${now.plans_sold ?? 0}</b></td></tr>
              <tr><td class="left">Non-JLR beginners taught</td><td>8</td><td>17</td><td>27</td><td>37</td><td><b>${now.beginners_non_jlr ?? 0}</b></td></tr>
            <tr><td class="left">Returning £ (R12)</td><td>£16k</td><td>£18k</td><td>£20k</td><td>£23k</td><td><b>${gbp(now.returning_r12)}</b></td></tr>
              <tr><td class="left">GP avg (T3m)</td><td>£2.8k</td><td>£3.0k</td><td>£3.3k</td><td>£3.5k</td><td><b>${gbp(now.gp_t3)}</b></td></tr>
            </tbody>
          </table>
        </div>

      <div class="rt-section">
        <h3>F · Where to push + Action needed</h3>
        <table class="rt-table" id="st-push">
          <thead><tr><th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">RAG</th><th class="left" data-col="3">Gap</th></tr></thead>
          <tbody>
            ${(data.push || []).map((e) => `<tr>
              <td>${esc(dayName(e.date))}</td>
              <td class="left">${eventLink(e)}</td>
              <td>${ragChip(e.rag, e.full)}</td>
              <td class="left">${esc(e.gap)}</td>
            </tr>`).join('') || '<tr><td colspan="4">Nothing to push</td></tr>'}
          </tbody>
        </table>
        <h4 style="margin:1rem 0 .35rem;font-size:.95rem">Action needed</h4>
        <ul class="st-actions">
          ${(data.action_needed || []).map((a) => {
            const href = hrefOf(a.url);
            const title = href
              ? `<a class="st-event-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(a.title)}</a>`
              : esc(a.title);
            return `<li>${pill('bad', '•')} ${title}${a.sep || ' — '}${esc(a.detail || a.why || '')}</li>`;
          }).join('') || '<li class="rt-sub">Nothing triggered</li>'}
        </ul>
      </div>

      <div class="rt-section">
        <h3>8 · Plan clients</h3>
        ${!(data.plan_clients?.rows || []).length
          ? `<table class="rt-table"><tbody><tr><td class="left rt-sub">${esc(plansEmpty || 'No plans yet — empty-state row until first plan is added')}</td></tr></tbody></table>`
          : `<table class="rt-table" id="st-plans">
            <thead><tr><th class="left" data-col="0">Client</th><th data-col="1">Type</th><th data-col="2">Value</th><th data-col="3">Start</th><th data-col="4">Credit</th><th data-col="5">Pace</th><th data-col="6">Next review</th><th data-col="7">Held</th><th data-col="8">Status</th><th data-col="9">Flags</th></tr></thead>
            <tbody>${(data.plan_clients.rows || []).map((r) => `<tr>
              <td class="left">${esc(r.client)}</td><td>${esc(r.plan_type)}</td><td>${gbp(r.plan_value)}</td><td>${esc(r.start_date || '—')}</td>
              <td>${gbp(r.credit_used)}</td><td>${r.pace_pct == null ? '—' : pct0(r.pace_pct)}</td>
              <td>${esc(r.next_review_due || '—')}</td><td>${r.reviews_held}/4</td><td>${esc(r.status || '—')}</td>
              <td>${(r.flags || []).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>`}
      </div>

      <div class="rt-section">
        <h3>9 · Beginners → plan conversion <span class="rt-sub">(last 6 completed courses)</span></h3>
        ${convNote ? `<p class="rt-sub">${esc(convNote)}</p>` : ''}
        <table class="rt-table" id="st-conv">
          <thead><tr><th data-col="0">Dates</th><th class="left" data-col="1">Course</th><th data-col="2">Attendees</th><th data-col="3">Google</th><th data-col="4">Gift</th><th data-col="5">Existing &amp; referral</th><th data-col="6">JLR</th><th data-col="7">Other</th><th data-col="8">Plans ≤60d</th><th data-col="9">Conv %</th></tr></thead>
          <tbody>
            ${(data.beginners_conversion?.rows || []).map((r) => `<tr>
              <td>${esc(r.dates)}</td><td class="left">${esc(r.event)}</td><td>${r.attendees}</td>
              ${['Google', 'Gift', 'Existing & referral'].map((k) => `<td>${r.sources?.[k] ?? '—'}</td>`).join('')}<td>${r.jlr}</td><td>${r.sources?.Other ?? '—'}</td>
              <td>${r.plans_60d == null ? '—' : r.plans_60d}</td>
              <td>${r.conversion_pct == null ? '—' : pct0(r.conversion_pct)}</td>
            </tr>`).join('') || '<tr><td colspan="10">No completed courses yet</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="two">
        <div class="rt-section">
          <h3>A · Beginners by source <span class="rt-sub">(last 12 months)</span></h3>
          <table class="rt-table" id="st-sources">
            <thead><tr><th class="left" data-col="0">Source</th><th data-col="1">Seats</th><th data-col="2">Prior 12m</th></tr></thead>
            <tbody>
              ${['Google', 'Gift', 'Existing & referral', 'JLR', 'Other'].map((k) =>
                `<tr><td class="left">${esc(k)}${k === 'JLR' ? ' <span class="rt-pill partial">EXCL</span>' : ''}</td>
                  <td>${sources[k] || 0}</td>
                  <td>${(data.beginners_sources_prior || {})[k] || 0}</td></tr>`
              ).join('')}
            </tbody>
          </table>
        </div>
        <div class="rt-section">
          <h3>B · Plans &amp; workshops signals</h3>
          <table class="rt-table">
            <tbody>
              <tr><td class="left">Residential avg / run (${esc(ws.residential_avg_window || 'last 12 months')})</td><td>${ws.residential_avg ?? '—'}</td></tr>
              <tr><td class="left">Residentials ≤2 booked (next 60d)</td><td>${ws.residentials_at_risk_60d ?? 0}</td></tr>
              <tr><td class="left">Plan credit / reviews</td><td class="rt-sub">${esc(plansEmpty || 'see Plan clients')}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rt-section">
        <h3>D · KPI scorecard</h3>
        <div style="overflow-x:auto">
        <table class="rt-table" id="st-score">
          <thead><tr>
            <th class="left" data-col="0">KPI</th><th data-col="1">This QTD</th><th data-col="2">Last 12m</th>
            <th data-col="3">Prior 12m</th><th data-col="4">Change</th><th data-col="5">Target</th><th data-col="6">Status</th>
          </tr></thead>
          <tbody>
            ${(data.kpi_scorecard || []).map((k) => `<tr title="${esc(k.def || '')}">
              <td class="left">${esc(k.name)}${k.note ? `<div class="rt-sub">${esc(k.note)}</div>` : ''}</td>
              <td>${fmtKpi(k.qtd, k.unit)}</td><td>${fmtKpi(k.l12, k.unit)}</td><td>${fmtKpi(k.prior, k.unit)}</td>
              <td>${fmtChange(k.change)}</td>
              <td>${fmtTarget(k)}</td>
              <td>${pill(k.status, k.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </div>

      <div class="rt-section">
        <h3>C · All 11 KPIs</h3>
        <label class="rt-toggle"><input type="checkbox" id="st-kpi-filter"> Hide needs-plans</label>
        <table class="rt-table" id="st-kpis">
          <thead><tr><th data-col="0">#</th><th class="left" data-col="1">KPI</th><th data-col="2">Actual</th><th data-col="3">Target</th><th data-col="4">Status</th></tr></thead>
          <tbody>
            ${(data.kpis || []).map((k) => {
              let actual = k.actual;
              if (k.id === 9 || (k.unit === 'gbp')) actual = gbp(k.actual);
              else if (k.unit === 'pct' && k.actual != null) actual = pct0(k.actual);
              else if (k.actual == null) actual = '—';
              const target = (k.unit === 'gbp' && typeof k.target === 'number') ? gbp(k.target) : esc(k.target);
              return `<tr data-status="${esc(k.status)}"><td>${k.id}</td><td class="left">${esc(k.label)}</td>
                <td>${esc(actual)}${k.reason ? ` <span class="rt-sub">(${esc(k.reason)})</span>` : ''}</td>
                <td>${target}</td>
                <td>${pill(k.status, k.status === 'needs_plans' ? 'NEEDS PLANS' : k.status)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="rt-section">
        <h3>G · Trends <span class="rt-sub">(L12 vs prior)</span></h3>
        <div class="st-trend-grid">
          <div class="st-trend"><div class="rt-sub">1 · GP / month (T3)</div><div class="big">${gbp(t.gp_t3)}</div>
            <div class="rt-sub">prior ${gbp(t.gp_t3_prior)} · vs seasonal survival ${gbp(survT3)} · bills line ${gbp(survival)}</div></div>
          <div class="st-trend"><div class="rt-sub">2 · Beginners fill</div><div class="big">${t.beginners_fill != null ? pct0(t.beginners_fill) : '—'}</div>
            <div class="rt-sub">prior ${t.beginners_fill_prior != null ? pct0(t.beginners_fill_prior) : '—'}</div></div>
          <div class="st-trend"><div class="rt-sub">3 · Workshop attendees</div><div class="big">day ${t.day_attendees_l12 ?? '—'} · res ${t.res_attendees_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_attendees_prior ?? '—'} / res ${t.res_attendees_prior ?? '—'}</div></div>
          <div class="st-trend"><div class="rt-sub">4 · Avg / run</div><div class="big">day ${t.day_avg_l12 ?? '—'} · res ${t.res_avg_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_avg_prior ?? '—'} / res ${t.res_avg_prior ?? '—'}</div></div>
        </div>
      </div>

      <div class="rt-section" id="st-targets-host"></div>
    `;

    root.querySelectorAll('.rt-table').forEach(sortTable);
    bindTicks(root);
    mountActionsLayer(root, data);
    mountTargetsHost(root);
    const kf = root.querySelector('#st-kpi-filter');
    if (kf) {
      kf.addEventListener('change', () => {
        root.querySelectorAll('#st-kpis tbody tr').forEach((tr) => {
          tr.style.display = kf.checked && tr.dataset.status === 'needs_plans' ? 'none' : '';
        });
      });
    }
  }

  function bindDiaryFilters(host) {
    const rag = host.querySelector('#st-rag');
    const typ = host.querySelector('#st-type');
    const needs = host.querySelector('#st-needs');
    if (!rag || !typ || !needs) return;
    rag.value = filterState.rag;
    typ.value = filterState.type;
    needs.checked = filterState.needs;
    rag.addEventListener('change', () => { filterState.rag = rag.value; applyFilters(host); });
    typ.addEventListener('change', () => { filterState.type = typ.value; applyFilters(host); });
    needs.addEventListener('change', () => { filterState.needs = needs.checked; applyFilters(host); });
    applyFilters(host);
  }

  let summaryLoading = null;
  function loadStrategySummary() {
    if (!summaryLoading) {
      summaryLoading = fetch('/api/aigeo/strategy-summary?propertyUrl=' + encodeURIComponent(PROP))
        .then((r) => r.json())
        .then((j) => { if (!j.ok) throw new Error(j.error || 'Failed to load'); return j; })
        .finally(() => { summaryLoading = null; });
    }
    return summaryLoading;
  }

  /** Diary on Pipeline & Funnel: same data, filters and sorting as before. */
  window.mountStrategyDiary = async function mountStrategyDiary(host, force) {
    if (!host) return;
    if (!force && host.dataset.loaded === '1') return;
    host.innerHTML = '<div class="rt-loading">Loading future bookings…</div>';
    try {
      const data = lastData && !force ? lastData : await loadStrategySummary();
      lastData = lastData || data;
      host.innerHTML = stylesHtml() + diarySectionHtml(data);
      host.dataset.loaded = '1';
      host.querySelectorAll('.rt-table').forEach(sortTable);
      bindDiaryFilters(host);
    } catch (e) {
      host.innerHTML = `<div class="rt-error">${esc(e.message || String(e))}</div>`;
    }
  };

  /** Reload the summary (after a promotion switch or theme save) and repaint Strategy and the diary if shown. */
  window.stRefreshSummary = async function stRefreshSummary() {
    const j = await loadStrategySummary();
    lastData = j;
    const root = document.getElementById('strategy-root');
    if (root?.dataset.loaded === '1') render(root, j);
    const host = document.getElementById('rf-diary-host');
    if (host?.dataset.loaded === '1') await window.mountStrategyDiary(host, true);
  };

  function mountDiaryIfFunnel() {
    if (document.querySelector('.aigeo-panel[data-panel="revenue-funnel"].is-active')) {
      window.mountStrategyDiary(document.getElementById('rf-diary-host'));
    }
  }
  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('.aigeo-nav-item[data-panel="revenue-funnel"]')) setTimeout(mountDiaryIfFunnel, 0);
  });
  /** The tab can become active without a nav click (page opened on #revenue-funnel, refresh, internal links). */
  function watchFunnelPanel() {
    const panel = document.querySelector('.aigeo-panel[data-panel="revenue-funnel"]');
    if (panel) new MutationObserver(mountDiaryIfFunnel).observe(panel, { attributes: true, attributeFilter: ['class'] });
    mountDiaryIfFunnel();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchFunnelPanel);
  else setTimeout(watchFunnelPanel, 0);

  window.renderStrategyTab = async function renderStrategyTab(force) {
    const root = document.getElementById('strategy-root');
    if (!root) return;
    if (!force && lastData && root.dataset.loaded === '1') { render(root, lastData); return; }
    root.innerHTML = '<div class="rt-loading">Loading Strategy &amp; KPIs…</div>';
    try {
      const j = await loadStrategySummary();
      root.dataset.loaded = '1';
      render(root, j);
      if (window.AigeoTabLoad?.markReady) window.AigeoTabLoad.markReady('strategy');
    } catch (e) {
      root.innerHTML = `<div class="rt-error">${esc(e.message || String(e))}</div>`;
    }
  };
})();
