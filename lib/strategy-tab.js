/**
 * Strategy & KPIs tab v5 — full restored layout + v4 diary/RAG + Part 1 capacity.
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
          const av = a.cells[col]?.innerText.trim() || '';
          const bv = b.cells[col]?.innerText.trim() || '';
          const an = Number(String(av).replace(/[^0-9.-]/g, ''));
          const bn = Number(String(bv).replace(/[^0-9.-]/g, ''));
          const cmp = (/\d/.test(av) && /\d/.test(bv) && !Number.isNaN(an) && !Number.isNaN(bn))
            ? an - bn : av.localeCompare(bv);
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

  function gpChart(series, survival, stretch) {
    const last24 = (series || []).slice(-24);
    if (!last24.length) return '<p class="rt-sub">No GP series yet.</p>';
    const byPeriod = new Map((series || []).map((s) => [s.period, s.gp]));
    const stretch1 = Number(stretch?.stretch1 || 4000);
    const stretch2 = Number(stretch?.stretch2 || 4700);
    const w = 1100; const h = 340;
    const pad = { l: 56, r: 20, t: 28, b: 40 };
    const vals = last24.flatMap((s) => {
      const [y, m] = s.period.split('-').map(Number);
      const ly = byPeriod.get(`${y - 1}-${String(m).padStart(2, '0')}`);
      return [s.gp, ly].filter((x) => x != null);
    });
    const ymax = Math.max(survival * 1.15, stretch2, ...vals, 1);
    const xAt = (i) => pad.l + (i / Math.max(last24.length - 1, 1)) * (w - pad.l - pad.r);
    const yAt = (v) => pad.t + (1 - v / ymax) * (h - pad.t - pad.b);
    const thisPts = last24.map((s, i) => `${xAt(i)},${yAt(s.gp)}`).join(' ');
    const lyPts = last24.map((s, i) => {
      const [y, m] = s.period.split('-').map(Number);
      const ly = byPeriod.get(`${y - 1}-${String(m).padStart(2, '0')}`);
      return ly == null ? null : `${xAt(i)},${yAt(ly)}`;
    }).filter(Boolean).join(' ');
    const grid = [0.25, 0.5, 0.75, 1].map((t) => {
      const v = t * ymax;
      const y = yAt(v);
      return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#1f2937"/>
        <text x="${pad.l - 8}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end">${gbp(v)}</text>`;
    }).join('');
    const xLabels = last24.map((s, i) => (i % 2 && i !== last24.length - 1 ? ''
      : `<text x="${xAt(i)}" y="${h - 12}" fill="#94a3b8" font-size="11" text-anchor="middle">${esc(s.period.slice(2))}</text>`)).join('');
    const tips = last24.map((s, i) => {
      const [y, m] = s.period.split('-').map(Number);
      const ly = byPeriod.get(`${y - 1}-${String(m).padStart(2, '0')}`);
      const tip = `${s.period}: this year ${gbp(s.gp)} · last year ${ly == null ? '—' : gbp(ly)}`;
      return `<circle cx="${xAt(i)}" cy="${yAt(s.gp)}" r="5" fill="#f59e0b" fill-opacity="0.01" stroke="transparent">
        <title>${esc(tip)}</title></circle>`;
    }).join('');
    return `<div class="st-gp-chart" style="width:100%"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;min-height:320px;height:auto;background:#0b1118;border-radius:8px;border:1px solid #1f2937">
      ${grid}
      <line x1="${pad.l}" y1="${yAt(survival)}" x2="${w - pad.r}" y2="${yAt(survival)}" stroke="#94a3b8" stroke-dasharray="6 4" stroke-width="2"/>
      <text x="${w - pad.r}" y="${yAt(survival) - 6}" fill="#94a3b8" font-size="12" text-anchor="end">Survival ${gbp(survival)}</text>
      <line x1="${pad.l}" y1="${yAt(stretch1)}" x2="${w - pad.r}" y2="${yAt(stretch1)}" stroke="#64748b" stroke-dasharray="3 5"/>
      <line x1="${pad.l}" y1="${yAt(stretch2)}" x2="${w - pad.r}" y2="${yAt(stretch2)}" stroke="#475569" stroke-dasharray="3 5"/>
      <text x="${pad.l}" y="${yAt(stretch1) - 4}" fill="#64748b" font-size="11">Stretch ${gbp(stretch1)}</text>
      <text x="${pad.l}" y="${yAt(stretch2) - 4}" fill="#475569" font-size="11">Stretch ${gbp(stretch2)}</text>
      <polyline fill="none" stroke="#64748b" stroke-width="2" points="${lyPts}"/>
      <polyline fill="none" stroke="#f59e0b" stroke-width="3" points="${thisPts}"/>
      ${xLabels}${tips}
      <text x="${pad.l}" y="18" fill="#f59e0b" font-size="12">This year</text>
      <text x="${pad.l + 90}" y="18" fill="#64748b" font-size="12">Last year</text>
    </svg></div>`;
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
  function beCell(e, rag) {
    const have = e.rag_booked != null ? e.rag_booked : e.booked;
    const short = e.be - have;
    const hint = short > 0 ? `<div class="st-be-hint">${e.be} needed / ${short} short</div>` : '';
    return `<td class="st-big ${ragClass(rag)}" data-sort="${e.be}">${e.be}${hint}</td>`;
  }
  function gpCell(v, est) {
    if (v == null) return '<td>—</td>';
    const cls = Number(v) < 0 ? ' class="st-gp-neg"' : '';
    const tag = est ? ' <span class="st-est">est.</span>' : '';
    return `<td${cls} data-sort="${v}">${gbpSigned(v)}${tag}</td>`;
  }
  function flagCell(e) {
    const flag = e.mismatch
      ? `<span title="${esc(e.flag_message || '')}">${pill('bad', 'MISMATCH')}</span>`
      : '—';
    return `<td>${flag}${e.over ? ` ${pill('bad', 'Over cap')}` : ''}</td>`;
  }
  function paceText(e) {
    return e.pace == null ? '—' : (e.pace >= 0 ? `+${e.pace}` : String(e.pace));
  }
  function parentRow(e) {
    const fill = e.fill_pct != null ? `${e.fill_pct}%` : '—';
    return `<tr class="st-parent" data-parent="1" data-key="${esc(e.eventKey)}" data-rag="parent" data-type="${esc(e.type)}" data-needs="${e.mismatch ? '1' : '0'}">
        <td>${esc(dayName(e.date))}</td>
        <td class="left" title="${esc(e.capacity_source || '')}">${eventLink(e)}${e.note ? `<div class="rt-sub">${esc(e.note)}</div>` : ''}
          ${e.flag_message ? `<div class="rt-sub">${esc(e.flag_message)}</div>` : ''}</td>
        <td>${gbp(e.price)}</td><td>${e.cap}</td><td>${e.booked}</td><td>${e.left}</td>
        <td>${esc(fill)}</td><td>${esc(paceText(e))}</td>
        <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
        ${flagCell(e)}
      </tr>`;
  }
  function eventCell(e) {
    if (!e.is_subrow) {
      return `<td class="left" title="${esc(e.capacity_source || '')}">${eventLink(e)}${e.note ? `<div class="rt-sub">${esc(e.note)}</div>` : ''}
          ${e.flag_message ? `<div class="rt-sub">${esc(e.flag_message)}</div>` : ''}</td>`;
    }
    const href = hrefOf(e.url);
    const label = `↳ ${esc(e.session)} session`;
    const inner = href
      ? `<a class="st-event-link" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : label;
    return `<td class="left st-sub-cell" title="${esc(e.capacity_source || '')}">${inner}</td>`;
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
        <td>${esc(paceText(e))}</td>
        ${beCell(e, rag)}
        <td data-sort="${rag}">${ragChip(rag, e.full)}</td>
        <td>${pill(rag === 'green' ? 'ok' : rag === 'red' ? 'bad' : 'warn', statusTxt)}</td>
        <td>${gbp(e.booked_gbp)}</td>
        <td>${gbp(e.unsold_gbp)}</td>
        ${gpCell(e.gp_now, e.gp_est)}
        ${gpCell(e.gp_full, e.gp_est)}
        ${flagCell(e)}
      </tr>`;
  }
  function diaryRows(data) {
    return (data.diary || []).map((e) => (e.is_parent ? parentRow(e) : eventRow(e))).join('');
  }
  function diaryGpFooter(data) {
    const g = data.diary_gp;
    if (!g || !g.rows) return '';
    const est = g.est_rows ? ` <span class="st-est">(${g.est_rows} of ${g.rows} rows est.)</span>` : '';
    const src = g.model_loaded ? 'Workshop Costs model' : 'category GP rates (no Workshop Costs model yet)';
    return `<p class="rt-sub st-gp-total">Total GP now <b class="${g.now < 0 ? 'st-gp-neg' : ''}">${gbpSigned(g.now)}</b>
      · if all full <b>${gbpSigned(g.full)}</b>${est} · source: ${esc(src)}</p>`;
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

  function render(root, data) {
    lastData = data;
    const t = data.trends || {};
    const h = data.headline || {};
    const now = data.roadmap_now || {};
    const sources = data.beginners_sources || {};
    const ws = data.workshop_signals || {};
    const plansEmpty = data.plan_clients?.empty_reason;
    const convNote = data.beginners_conversion?.empty_note;
    const survival = data.survival_gp || 3700;

    root.innerHTML = `
      <style>
        #strategy-root a, #strategy-root .st-event-link { color:#e5e7eb !important; text-decoration:underline; text-underline-offset:2px; }
        #strategy-root a:hover, #strategy-root .st-event-link:hover { color:#ffffff !important; }
        #strategy-root .st-rag-chip { display:inline-block; min-width:4.2rem; text-align:center; padding:.15rem .4rem; border-radius:4px; font-size:.68rem; font-weight:800; letter-spacing:.03em; color:#fff; }
        #strategy-root .st-rag-chip.red { background:#dc2626; }
        #strategy-root .st-rag-chip.amber { background:#d97706; }
        #strategy-root .st-rag-chip.green { background:#16a34a; }
        #strategy-root .st-big { font-weight:800; font-size:1.05rem; }
        #strategy-root .st-c-red { color:#f87171; }
        #strategy-root .st-c-amber { color:#fbbf24; }
        #strategy-root .st-c-green { color:#4ade80; }
        #strategy-root .st-be-hint { font-size:.62rem; font-weight:600; opacity:.9; white-space:nowrap; }
        #strategy-root .st-gp-neg { color:#f87171; font-weight:700; }
        #strategy-root .st-est { color:#94a3b8; font-size:.62rem; font-weight:600; }
        #strategy-root tr.st-parent td { color:#94a3b8; font-size:.8rem; background:#0b1118; }
        #strategy-root tr.st-subrow td:first-child { padding-left:1.1rem; }
        #strategy-root .st-sub-cell { padding-left:1.4rem; }
        #strategy-root .st-filters { display:flex; flex-wrap:wrap; gap:.5rem; margin:.5rem 0 .75rem; align-items:center; }
        #strategy-root .st-filters label { font-size:.8rem; color:var(--rt-muted,#94a3b8); background:#0b1118; border:1px solid #1f2937; padding:.25rem .5rem; border-radius:6px; }
        #strategy-root .st-trend-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; }
        #strategy-root .st-trend { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:.7rem; }
        #strategy-root .st-trend .big { font-size:1.15rem; font-weight:800; color:#f59e0b; }
        #strategy-root .st-actions { list-style:none; padding:0; margin:.4rem 0 0; }
        #strategy-root .st-actions li { margin:.35rem 0; font-size:.85rem; }
        #strategy-root .pillars { display:grid; grid-template-columns:repeat(3,1fr); gap:.7rem; }
        #strategy-root .pillar { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:.75rem; }
        #strategy-root .pillar h4 { margin:0 0 .35rem; color:#f59e0b; }
        @media (max-width:900px){
          #strategy-root .st-trend-grid, #strategy-root .pillars { grid-template-columns:1fr; }
        }
      </style>
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
          <div class="rt-strip-card ${h.gp_t3 != null && h.gp_t3 < survival ? 'band-below_survival' : 'band-thrive'}">
            <div class="rt-strip-label">1 · GP / month (T3)</div>
            <div class="rt-strip-value">${gbp(h.gp_t3)}</div>
            <div class="rt-strip-meta">vs survival ${gbp(survival)}</div>
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
        <h3>4 · GP by month vs survival</h3>
        <p class="rt-sub">Full width · 24 months · this year / last year / survival ${gbp(survival)} · stretch ${gbp(data.stretch?.stretch1)} / ${gbp(data.stretch?.stretch2)}. Hover points for values.</p>
        ${gpChart(data.gp_series, survival, data.stretch)}
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
        <h3>E · Next 12 weeks — diary &amp; gaps</h3>
        <div class="st-filters">
          <label>RAG <select id="st-rag"><option value="all">All</option><option value="red">Red</option><option value="amber">Amber</option><option value="green">Green</option></select></label>
          <label>Type <select id="st-type"><option value="all">All</option><option value="day">Day</option><option value="residential">Residential</option><option value="course">Course</option><option value="walk">Walk</option></select></label>
          <label><input type="checkbox" id="st-needs"> Needs action only</label>
          <span class="rt-sub">${(data.diary || []).length} events · day/walk cap 6 · Batsford AM+PM linked</span>
        </div>
        <div style="overflow-x:auto">
        <table class="rt-table" id="st-diary">
          <thead><tr>
            <th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">Price</th><th data-col="3">Cap</th>
            <th data-col="4">Booked</th><th data-col="5">Left</th><th data-col="6">Fill</th><th data-col="7">+wk</th><th data-col="8">B/E</th>
            <th data-col="9">RAG</th><th data-col="10">Status</th><th data-col="11">£ booked</th><th data-col="12">£ unsold</th><th data-col="13">GP now</th><th data-col="14">GP if full</th><th data-col="15">Flags</th>
          </tr></thead>
          <tbody>${diaryRows(data)}</tbody>
        </table>
        </div>
        ${diaryGpFooter(data)}
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
          <thead><tr><th data-col="0">Dates</th><th class="left" data-col="1">Course</th><th data-col="2">Attendees</th><th data-col="3">JLR</th><th data-col="4">Plans ≤60d</th><th data-col="5">Conv %</th></tr></thead>
          <tbody>
            ${(data.beginners_conversion?.rows || []).map((r) => `<tr>
              <td>${esc(r.dates)}</td><td class="left">${esc(r.event)}</td><td>${r.attendees}</td><td>${r.jlr}</td>
              <td>${r.plans_60d == null ? '—' : r.plans_60d}</td>
              <td>${r.conversion_pct == null ? '—' : pct0(r.conversion_pct)}</td>
            </tr>`).join('') || '<tr><td colspan="6">No completed courses yet</td></tr>'}
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
            <div class="rt-sub">prior ${gbp(t.gp_t3_prior)} · vs survival ${gbp(survival)}</div></div>
          <div class="st-trend"><div class="rt-sub">2 · Beginners fill</div><div class="big">${t.beginners_fill != null ? pct0(t.beginners_fill) : '—'}</div>
            <div class="rt-sub">prior ${t.beginners_fill_prior != null ? pct0(t.beginners_fill_prior) : '—'}</div></div>
          <div class="st-trend"><div class="rt-sub">3 · Workshop attendees</div><div class="big">day ${t.day_attendees_l12 ?? '—'} · res ${t.res_attendees_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_attendees_prior ?? '—'} / res ${t.res_attendees_prior ?? '—'}</div></div>
          <div class="st-trend"><div class="rt-sub">4 · Avg / run</div><div class="big">day ${t.day_avg_l12 ?? '—'} · res ${t.res_avg_l12 ?? '—'}</div>
            <div class="rt-sub">prior day ${t.day_avg_prior ?? '—'} / res ${t.res_avg_prior ?? '—'}</div></div>
        </div>
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
    bindTicks(root);
    const kf = root.querySelector('#st-kpi-filter');
    if (kf) {
      kf.addEventListener('change', () => {
        root.querySelectorAll('#st-kpis tbody tr').forEach((tr) => {
          tr.style.display = kf.checked && tr.dataset.status === 'needs_plans' ? 'none' : '';
        });
      });
    }
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
