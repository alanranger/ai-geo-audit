/**
 * Strategy & KPIs tab v4 — diary/gaps, push, trends, KPI scorecard, quarter ticks.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  let lastData = null;
  let flashSavedId = null;
  let filterState = { rag: 'all', type: 'all', needs: false };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function gbp(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return '£' + Math.round(Number(n)).toLocaleString('en-GB');
  }
  function fmtChange(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtVal(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 100) return gbp(v);
      return String(Math.round(v * 10) / 10);
    }
    return esc(String(v));
  }
  function dayName(iso) {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function pill(status, text) {
    const cls = status === 'ok' || status === 'green' ? 'ok'
      : status === 'below' || status === 'bad' || status === 'red' ? 'bad'
      : status === 'needs_plans' || status === 'n/a' ? 'partial' : 'warn';
    return `<span class="rt-pill ${cls}">${esc(text || status)}</span>`;
  }
  function eventLink(e) {
    if (!e.url) return esc(e.title);
    const href = e.url.startsWith('http') ? e.url : `https://www.alanranger.com${e.url}`;
    return `<a class="st-event-link" href="${esc(href)}" target="_blank" rel="noopener">${esc(e.title)}</a>`;
  }
  function ragChip(rag, full) {
    const label = full ? 'GREEN ✓' : (rag || '').toUpperCase();
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
          const av = a.cells[col]?.innerText.trim() || '';
          const bv = b.cells[col]?.innerText.trim() || '';
          const an = Number(String(av).replace(/[^0-9.-]/g, ''));
          const bn = Number(String(bv).replace(/[^0-9.-]/g, ''));
          const cmp = (/\d/.test(av) && /\d/.test(bv) && !Number.isNaN(an) && !Number.isNaN(bn)) ? an - bn : av.localeCompare(bv);
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
          <span class="st-side">${flash}${overdue ? pill('bad', 'OVERDUE') : ''}</span>
          <input class="st-due" type="date" data-id="${a.id}" value="${esc(a.due_week_start)}" />
        </li>`;
      }).join('');
      return `<div class="qcard ${isCur ? 'is-current' : ''}" ${isCur ? '' : 'style="opacity:.75"'}>
        <h4>${esc(q.label)} ${isCur ? '<span class="rt-pill current">CURRENT</span>' : ''}
          <span class="st-progress">${done.length} of ${acts.length} done</span></h4>
        <div class="obj">${esc(q.objective)}</div>
        <ul>${lis}</ul>
        <div class="qmeta">Targets: ${t.plans} plans · ${t.beginners_non_jlr} non-JLR · GP T3 ${gbp(t.gp_t3)} · returning ${gbp(t.returning_r12)}</div>
      </div>`;
    }).join('');
  }

  function diaryRows(data) {
    return (data.diary || []).map((e) => {
      const rag = e.rag || 'amber';
      const statusTxt = e.full ? 'Full ✓' : e.status;
      const pace = e.pace == null ? '—' : (e.pace >= 0 ? `+${e.pace}` : String(e.pace));
      const fill = e.fill_pct != null ? `${e.fill_pct}%` : '—';
      return `<tr data-rag="${rag}" data-type="${esc(e.type)}" data-needs="${rag !== 'green' ? '1' : '0'}">
        <td>${esc(dayName(e.date))}</td>
        <td class="left">${eventLink(e)}${e.note ? `<div class="rt-sub">${esc(e.note)}</div>` : ''}
          ${e.capacity_source ? `<div class="rt-sub">cap: ${esc(e.capacity_source)}</div>` : ''}</td>
        <td>${gbp(e.price)}</td>
        <td>${e.cap}</td>
        <td>${e.booked}</td>
        <td>${e.left}</td>
        <td>${esc(fill)}</td>
        <td>${esc(pace)}</td>
        <td>${e.be}</td>
        <td data-sort="${rag}">${ragChip(rag, e.full)}</td>
        <td>${pill(rag === 'green' ? 'ok' : rag === 'red' ? 'bad' : 'warn', statusTxt)}</td>
        <td>${gbp(e.booked_gbp)}</td>
        <td>${gbp(e.unsold_gbp)}</td>
        <td>${e.mismatch ? pill('bad', 'MISMATCH') : '—'}${e.over ? ' ' + pill('bad', 'Over cap') : ''}</td>
      </tr>`;
    }).join('');
  }

  function applyFilters(root) {
    root.querySelectorAll('#st-diary tbody tr').forEach((tr) => {
      const ragOk = filterState.rag === 'all' || tr.dataset.rag === filterState.rag;
      const typeOk = filterState.type === 'all' || tr.dataset.type === filterState.type;
      const needsOk = !filterState.needs || tr.dataset.needs === '1';
      tr.style.display = ragOk && typeOk && needsOk ? '' : 'none';
    });
  }

  function render(root, data) {
    lastData = data;
    const t = data.trends || {};
    const h = data.headline || {};
    const plansEmpty = data.plan_clients?.empty_reason;

    root.innerHTML = `
      <style>
        #strategy-root .st-event-link { color:#93c5fd; text-decoration:none; }
        #strategy-root .st-event-link:hover { text-decoration:underline; color:#bfdbfe; }
        #strategy-root .st-rag-chip { display:inline-block; min-width:4.2rem; text-align:center; padding:.15rem .4rem; border-radius:4px; font-size:.68rem; font-weight:800; letter-spacing:.03em; color:#fff; }
        #strategy-root .st-rag-chip.red { background:#dc2626; }
        #strategy-root .st-rag-chip.amber { background:#d97706; }
        #strategy-root .st-rag-chip.green { background:#16a34a; }
        #strategy-root .st-filters { display:flex; flex-wrap:wrap; gap:.5rem; margin:.5rem 0 .75rem; align-items:center; }
        #strategy-root .st-filters label { font-size:.8rem; color:var(--rt-muted,#94a3b8); background:#0b1118; border:1px solid #1f2937; padding:.25rem .5rem; border-radius:6px; }
        #strategy-root .st-trend-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; }
        #strategy-root .st-trend { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:.7rem; }
        #strategy-root .st-trend .big { font-size:1.15rem; font-weight:800; color:#f59e0b; }
        #strategy-root .st-actions { list-style:none; padding:0; margin:.4rem 0 0; }
        #strategy-root .st-actions li { margin:.35rem 0; font-size:.85rem; }
        @media (max-width:900px){ #strategy-root .st-trend-grid { grid-template-columns:1fr 1fr; } }
      </style>
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin-bottom:.25rem;">
        <h2>Strategy &amp; KPIs</h2>
        <span class="rt-prov-pill rt-prov-dynamic">LIVE v4</span>
      </div>
      <p class="rt-sub">Current position &amp; gaps to fill · next 12 weeks ·
        <a href="https://www.alanranger.com" target="_blank" rel="noopener">plan document ↗</a></p>
      <p class="rt-sub">Snapshots build empty-run fill, +wk pace &amp; run rate from 7 Oct 2026 · courses prior partial from Feb 2025.</p>

      <div class="rt-section">
        <h3>A · Next 12 weeks — diary &amp; gaps</h3>
        <div class="st-filters">
          <label>RAG <select id="st-rag"><option value="all">All</option><option value="red">Red</option><option value="amber">Amber</option><option value="green">Green</option></select></label>
          <label>Type <select id="st-type"><option value="all">All</option><option value="day">Day</option><option value="residential">Residential</option><option value="course">Course</option><option value="walk">Walk</option></select></label>
          <label><input type="checkbox" id="st-needs"> Needs action only</label>
          <span class="rt-sub">${(data.diary || []).length} events · B/E day=2 / residential=3</span>
        </div>
        <div style="overflow-x:auto">
        <table class="rt-table" id="st-diary">
          <thead><tr>
            <th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">Price</th><th data-col="3">Cap</th>
            <th data-col="4">Booked</th><th data-col="5">Left</th><th data-col="6">Fill</th><th data-col="7">+wk</th><th data-col="8">B/E</th>
            <th data-col="9">RAG</th><th data-col="10">Status</th><th data-col="11">£ booked</th><th data-col="12">£ unsold</th><th data-col="13">Flags</th>
          </tr></thead>
          <tbody>${diaryRows(data)}</tbody>
        </table>
        </div>
      </div>

      <div class="rt-section">
        <h3>B · Where to push + Action needed</h3>
        <table class="rt-table" id="st-push">
          <thead><tr><th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">RAG</th><th class="left" data-col="3">Gap</th><th data-col="4">Decide by</th></tr></thead>
          <tbody>
            ${(data.push || []).map((e) => `<tr>
              <td>${esc(dayName(e.date))}</td>
              <td class="left">${eventLink(e)}</td>
              <td>${ragChip(e.rag, e.full)}</td>
              <td class="left">${esc(e.gap)}</td>
              <td class="rt-sub">PROPOSED</td>
            </tr>`).join('') || '<tr><td colspan="5">Nothing to push</td></tr>'}
          </tbody>
        </table>
        <h4 style="margin:1rem 0 .35rem;font-size:.95rem">Action needed</h4>
        <ul class="st-actions">
          ${(data.action_needed || []).map((a) => `<li>${pill('bad', '•')}
            ${a.url ? `<a href="https://www.alanranger.com${esc(a.url)}" target="_blank">${esc(a.title)}</a>` : esc(a.title)}
            — ${esc(a.detail || a.why || '')}</li>`).join('') || '<li class="rt-sub">Nothing triggered</li>'}
        </ul>
      </div>

      <div class="rt-section">
        <h3>C · Trends <span class="rt-sub">(L12 vs prior)</span></h3>
        <div class="st-trend-grid">
          <div class="st-trend"><div class="rt-sub">1 · GP / month (T3)</div><div class="big">${gbp(t.gp_t3)}</div>
            <div class="rt-sub">prior ${gbp(t.gp_t3_prior)} · vs survival ${gbp(data.survival_gp)} · stretch £4k / £4.7k</div></div>
          <div class="st-trend"><div class="rt-sub">2 · Beginners fill</div><div class="big">${t.beginners_fill != null ? t.beginners_fill + '%' : '—'}</div>
            <div class="rt-sub">prior ${t.beginners_fill_prior != null ? t.beginners_fill_prior + '%' : '—'} · ${esc(t.notes?.courses_prior || '')}<br>${esc(t.notes?.empty_runs || '')}</div></div>
          <div class="st-trend"><div class="rt-sub">3 · Workshop attendees</div><div class="big">day ${t.day_attendees_l12 ?? '—'} · res ${t.res_attendees_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_attendees_prior ?? '—'} / res ${t.res_attendees_prior ?? '—'}</div></div>
          <div class="st-trend"><div class="rt-sub">4 · Avg / run</div><div class="big">day ${t.day_avg_l12 ?? '—'} · res ${t.res_avg_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_avg_prior ?? '—'} / res ${t.res_avg_prior ?? '—'}</div></div>
        </div>
      </div>

      <div class="rt-section">
        <h3>F · KPI scorecard</h3>
        <div style="overflow-x:auto">
        <table class="rt-table" id="st-kpis">
          <thead><tr>
            <th class="left" data-col="0">KPI</th><th data-col="1">This QTD</th><th data-col="2">Last 12m</th>
            <th data-col="3">Prior 12m</th><th data-col="4">Change</th><th data-col="5">Target</th><th data-col="6">Status</th>
          </tr></thead>
          <tbody>
            ${(data.kpi_scorecard || []).map((k) => `<tr title="${esc(k.def || '')}">
              <td class="left">${esc(k.name)}${k.note ? `<div class="rt-sub">${esc(k.note)}</div>` : ''}</td>
              <td>${fmtVal(k.qtd)}</td><td>${fmtVal(k.l12)}</td><td>${fmtVal(k.prior)}</td>
              <td>${fmtChange(k.change)}</td>
              <td>${typeof k.target === 'number' && k.target >= 100 ? gbp(k.target) : esc(k.target)}</td>
              <td>${pill(k.status, k.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>
      </div>

      <div class="rt-section">
        <h3>D · This quarter</h3>
        <div class="quarters">${renderActions(data)}</div>
        <p class="rt-sub">Now: plans ${h.plans_active ?? 0} · non-JLR beginners ${data.roadmap_now?.beginners_non_jlr ?? 0} · GP T3 ${gbp(h.gp_t3)} · returning ${gbp(h.returning_r12)}</p>
      </div>

      <div class="rt-section">
        <h3>E · Plans</h3>
        ${plansEmpty || !(data.plan_clients?.rows || []).length
          ? `<p class="rt-sub">${esc(plansEmpty || 'Hidden until ≥1 Plans row exists')}</p>`
          : `<table class="rt-table"><thead><tr><th class="left">Client</th><th>Type</th><th>Value</th><th>Credit</th><th>Status</th></tr></thead>
            <tbody>${(data.plan_clients.rows || []).map((r) => `<tr>
              <td class="left">${esc(r.client)}</td><td>${esc(r.plan_type)}</td><td>${gbp(r.plan_value)}</td>
              <td>${gbp(r.credit_used)}</td><td>${esc(r.status || '—')}</td></tr>`).join('')}</tbody></table>`}
      </div>
    `;

    root.querySelectorAll('.rt-table').forEach(sortTable);
    const rag = root.querySelector('#st-rag');
    const typ = root.querySelector('#st-type');
    const needs = root.querySelector('#st-needs');
    if (rag) rag.value = filterState.rag;
    if (typ) typ.value = filterState.type;
    if (needs) needs.checked = filterState.needs;
    if (rag) rag.addEventListener('change', () => { filterState.rag = rag.value; applyFilters(root); });
    if (typ) typ.addEventListener('change', () => { filterState.type = typ.value; applyFilters(root); });
    if (needs) needs.addEventListener('change', () => { filterState.needs = needs.checked; applyFilters(root); });
    applyFilters(root);

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

  window.renderStrategyTab = async function renderStrategyTab(force) {
    const root = document.getElementById('strategy-root');
    if (!root) return;
    if (!force && lastData && root.dataset.loaded === '1') { render(root, lastData); return; }
    root.innerHTML = '<div class="rt-loading">Loading Strategy &amp; KPIs…</div>';
    try {
      const r = await fetch('/api/aigeo/strategy-summary?propertyUrl=' + encodeURIComponent(PROP));
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load');
      root.dataset.loaded = '1';
      render(root, j);
      if (window.AigeoTabLoad?.markReady) window.AigeoTabLoad.markReady('strategy');
    } catch (e) {
      root.innerHTML = `<div class="rt-error">${esc(e.message || String(e))}</div>`;
    }
  };
})();
