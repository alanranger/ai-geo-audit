/**
 * Strategy & KPIs tab v5 — full restored layout + v4 diary/RAG + Part 1 capacity.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  let lastData = null;
  let flashSavedId = null;
  let filterState = { rag: 'all', type: 'all', needs: false, gpSort: 'free' };

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

  const GP_CAT_META = [
    { id: 1, name: 'Courses', c: '#60a5fa' },
    { id: 2, name: 'Workshops (day)', c: '#f59e0b' },
    { id: 3, name: 'Residentials', c: '#f97316' },
    { id: 7, name: '1-2-1', c: '#a78bfa' },
    { id: 6, name: 'Mentoring', c: '#2dd4bf' },
    { id: 11, name: 'Commissions', c: '#f472b6' },
    { id: 12, name: 'Academy', c: '#34d399' },
    { id: 10, name: 'Prints & royalties', c: '#94a3b8' }
  ];
  const GP_LS_KEY = 'st-gp-chart-v1';
  const GP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const GP_RISE_DEFAULT = { 2021: 0.15, 2022: 0.15, 2023: 0.15, 2024: 0.15, 2025: 0.2, 2026: 0.2 };
  let gpChartInst = null;

  function gbpAbs(v) {
    return (v < 0 ? '-£' : '£') + Math.abs(Math.round(v)).toLocaleString('en-GB');
  }
  function gpSgn(v) {
    return (v >= 0 ? '+' : '') + gbpAbs(v);
  }
  function gpPct(v) {
    return Math.round(v * 100) + '%';
  }
  function gpPeriodLabel(p) {
    const [y, m] = String(p).split('-');
    return `${GP_MON[+m - 1]} ${String(y).slice(2)}`;
  }
  function gpYr(p) {
    return Number(String(p).slice(0, 4));
  }
  function gpTierForYear(base, year, rises, baseYear) {
    let v = Number(base) || 0;
    const y = Number(year);
    if (!Number.isFinite(y) || y >= baseYear) return Math.round(v);
    for (let yy = baseYear; yy > y; yy -= 1) {
      v /= 1 + Number(rises[yy] ?? 0.15);
    }
    return Math.round(v);
  }
  function gpLoadState() {
    const base = {
      metric: 'gp', range: '24', view: 'line', ly: true, avg: false, tgt: true,
      cats: GP_CAT_META.map((c) => c.id)
    };
    try {
      const raw = localStorage.getItem(GP_LS_KEY);
      if (!raw) return base;
      const j = JSON.parse(raw);
      const cats = Array.isArray(j.cats) ? j.cats.map(Number).filter((id) => GP_CAT_META.some((c) => c.id === id)) : base.cats;
      return {
        metric: j.metric === 'rev' ? 'rev' : 'gp',
        range: ['12', '24', 'all', 'ytd'].includes(j.range) ? j.range : base.range,
        view: j.view === 'bar' ? 'bar' : 'line',
        ly: j.ly !== false,
        avg: j.avg === true,
        tgt: j.tgt !== false,
        cats: cats.length ? cats : base.cats
      };
    } catch (_e) {
      return base;
    }
  }
  function gpSaveState(state) {
    try {
      localStorage.setItem(GP_LS_KEY, JSON.stringify({
        metric: state.metric, range: state.range, view: state.view,
        ly: state.ly, avg: state.avg, tgt: state.tgt, cats: [...state.cats]
      }));
    } catch (_e) { /* ignore */ }
  }
  function gpBuildByPeriod(rows) {
    const byP = new Map();
    (rows || []).forEach((r) => {
      const p = String(r.period || '');
      const c = Number(r.category_order);
      if (!p || !Number.isFinite(c)) return;
      if (!byP.has(p)) byP.set(p, {});
      const cur = byP.get(p)[c] || { rev: 0, gp: 0 };
      cur.gp += Math.round(Number(r.gp) || 0);
      cur.rev += Math.round(Number(r.revenue) || 0);
      byP.get(p)[c] = cur;
    });
    return byP;
  }
  function gpChartShell(survival, stretch) {
    const s1 = Number(stretch?.stretch1 || 4000);
    const s2 = Number(stretch?.stretch2 || 4700);
    const chips = GP_CAT_META.map((c) =>
      `<button type="button" class="st-gp-chip" data-cat="${c.id}" style="--c:${c.c}" aria-pressed="true">${esc(c.name)}</button>`
    ).join('') + '<button type="button" class="st-gp-chip" data-cat="all" aria-pressed="false">All</button>';
    return `
      <style>
        #strategy-root .st-gp-panel { display:grid; gap:14px; min-width:0; }
        #strategy-root .st-gp-controls { display:flex; flex-wrap:wrap; gap:14px 22px; align-items:flex-start; }
        #strategy-root .st-gp-ctl { display:grid; gap:6px; }
        #strategy-root .st-gp-ctl > span { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
        #strategy-root .st-gp-seg { display:flex; flex-wrap:wrap; gap:4px; }
        #strategy-root .st-gp-seg button, #strategy-root .st-gp-chip {
          background:#0b1118; color:#94a3b8; border:1px solid #1f2937; border-radius:6px;
          padding:5px 10px; font:inherit; font-size:12px; cursor:pointer;
        }
        #strategy-root .st-gp-seg button[aria-pressed="true"], #strategy-root .st-gp-chip[aria-pressed="true"] {
          background:#1e293b; color:#e5e7eb; border-color:#334155;
        }
        #strategy-root .st-gp-chip[aria-pressed="true"]::before {
          content:""; display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px; background:var(--c,#94a3b8);
        }
        #strategy-root .st-gp-chips { display:flex; flex-wrap:wrap; gap:4px; max-width:720px; }
        #strategy-root .st-gp-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }
        #strategy-root .st-gp-stat { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:10px 12px; }
        #strategy-root .st-gp-stat .k { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
        #strategy-root .st-gp-stat .v { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
        #strategy-root .st-gp-stat .d { font-size:12px; color:#94a3b8; margin-top:2px; }
        #strategy-root .st-gp-stat .good { color:#22c55e; } #strategy-root .st-gp-stat .bad { color:#ef4444; }
        #strategy-root .st-gp-legend { display:flex; flex-wrap:wrap; gap:16px; font-size:12px; color:#94a3b8; }
        #strategy-root .st-gp-legend i { display:inline-block; width:18px; height:0; border-top:3px solid var(--c); vertical-align:middle; margin-right:6px; }
        #strategy-root .st-gp-legend i.dash { border-top-style:dashed; border-top-width:2px; }
        #strategy-root .st-gp-plot { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:10px; position:relative; height:420px; min-width:0; }
        @media (max-width:600px){ #strategy-root .st-gp-plot { height:340px; } }
      </style>
      <div class="st-gp-panel" id="st-gp-panel"
        data-survival="${survival}" data-s1="${s1}" data-s2="${s2}">
        <p class="rt-sub" id="st-gp-sub">GP = revenue × each year's category GP rates (D2C + B2B). Survival steps by year to £${Number(survival).toLocaleString('en-GB')} in 2026.</p>
        <div class="st-gp-controls">
          <div class="st-gp-ctl"><span>Measure</span><div class="st-gp-seg" id="st-gp-metric">
            <button type="button" data-v="gp" aria-pressed="true">GP</button>
            <button type="button" data-v="rev">Revenue</button>
          </div></div>
          <div class="st-gp-ctl"><span>Period</span><div class="st-gp-seg" id="st-gp-range">
            <button type="button" data-v="12">12 months</button>
            <button type="button" data-v="24" aria-pressed="true">24 months</button>
            <button type="button" data-v="all">All (since Jan 24)</button>
            <button type="button" data-v="ytd">This year</button>
          </div></div>
          <div class="st-gp-ctl"><span>Show</span><div class="st-gp-seg" id="st-gp-view">
            <button type="button" data-v="line" aria-pressed="true">Total line</button>
            <button type="button" data-v="bar">Stacked by category</button>
          </div></div>
          <div class="st-gp-ctl"><span>Overlays</span><div class="st-gp-seg">
            <button type="button" id="st-gp-oly" aria-pressed="true">Same month last year</button>
            <button type="button" id="st-gp-oavg" aria-pressed="false">3-month average</button>
            <button type="button" id="st-gp-otgt" aria-pressed="true">Stretch targets</button>
          </div></div>
          <div class="st-gp-ctl"><span>Categories</span><div class="st-gp-chips" id="st-gp-cats">${chips}</div></div>
        </div>
        <div class="st-gp-stats" id="st-gp-stats"></div>
        <div class="st-gp-legend" id="st-gp-legend"></div>
        <div class="st-gp-plot"><canvas id="st-gp-canvas"></canvas></div>
      </div>`;
  }

  function mountGpChart(root, data) {
    const panel = root.querySelector('#st-gp-panel');
    const canvas = root.querySelector('#st-gp-canvas');
    if (!panel || !canvas || typeof Chart === 'undefined') return;
    const byP = gpBuildByPeriod(data.gp_by_category);
    const ALL = [...byP.keys()].sort();
    if (!ALL.length) {
      panel.innerHTML = '<p class="rt-sub">No GP series yet.</p>';
      return;
    }
    const baseSurv = Number(panel.dataset.survival || data.survival_gp || 3700);
    const baseS1 = Number(panel.dataset.s1 || data.stretch?.stretch1 || 4000);
    const baseS2 = Number(panel.dataset.s2 || data.stretch?.stretch2 || 4700);
    const baseYear = Number(data.gp_target_base_year || 2026);
    const rises = { ...GP_RISE_DEFAULT, ...(data.cost_rise_by_year || {}) };
    const inProgress = String(data.as_of || new Date().toISOString().slice(0, 10)).slice(0, 7);
    const state = gpLoadState();
    state.cats = new Set(state.cats);
    let T = { surv: [], s1: [], s2: [], m: null };

    const sumKey = (p, key) => {
      const r = byP.get(p);
      if (!r) return null;
      let s = 0;
      state.cats.forEach((c) => { s += r[c] ? r[c][key] : 0; });
      return s;
    };
    const val = (p) => sumKey(p, state.metric === 'rev' ? 'rev' : 'gp');
    const marginOf = (p) => {
      const rv = sumKey(p, 'rev');
      const g = sumKey(p, 'gp');
      return rv ? g / rv : null;
    };
    const periods = () => {
      if (state.range === 'all') return ALL;
      if (state.range === 'ytd') return ALL.filter((p) => p.startsWith(inProgress.slice(0, 4)));
      return ALL.slice(-Number(state.range));
    };
    const prevYear = (p) => {
      const [y, m] = p.split('-');
      return `${Number(y) - 1}-${m}`;
    };
    const blended = (ps) => {
      let rv = 0;
      let g = 0;
      ps.filter((p) => p !== inProgress).forEach((p) => {
        rv += sumKey(p, 'rev') || 0;
        g += sumKey(p, 'gp') || 0;
      });
      return rv ? g / rv : 1;
    };
    const targets = (ps) => {
      const m = state.metric === 'gp' ? 1 : blended(ps);
      const f = (k, base) => ps.map((p) => gpTierForYear(base, gpYr(p), rises, baseYear) / m);
      return { m: state.metric === 'gp' ? null : m, surv: f('surv', baseSurv), s1: f('s1', baseS1), s2: f('s2', baseS2) };
    };
    const syncUi = () => {
      panel.querySelectorAll('#st-gp-metric button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.metric));
      panel.querySelectorAll('#st-gp-range button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.range));
      panel.querySelectorAll('#st-gp-view button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.view));
      const oly = panel.querySelector('#st-gp-oly');
      const oavg = panel.querySelector('#st-gp-oavg');
      const otgt = panel.querySelector('#st-gp-otgt');
      if (oly) oly.setAttribute('aria-pressed', state.ly);
      if (oavg) oavg.setAttribute('aria-pressed', state.avg);
      if (otgt) otgt.setAttribute('aria-pressed', state.tgt);
      panel.querySelectorAll('#st-gp-cats .st-gp-chip[data-cat]').forEach((b) => {
        if (b.dataset.cat === 'all') b.setAttribute('aria-pressed', 'false');
        else b.setAttribute('aria-pressed', state.cats.has(Number(b.dataset.cat)));
      });
    };

    const lineLabels = {
      id: 'stGpLineLabels',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea: a, scales: { y } } = chart;
        if (!a || !y || !T.surv.length) return;
        const last = (arr) => arr[arr.length - 1];
        const isRev = state.metric === 'rev';
        const items = [[last(T.surv), isRev
          ? `Revenue needed for £${baseSurv.toLocaleString('en-GB')} GP: ${gbpAbs(last(T.surv))}`
          : `Survival £${baseSurv.toLocaleString('en-GB')} (${baseYear})`, '#cbd5e1']];
        if (state.tgt) {
          items.push(
            [last(T.s1), isRev ? `for £${baseS1.toLocaleString('en-GB')} GP: ${gbpAbs(last(T.s1))}` : `Stretch £${baseS1.toLocaleString('en-GB')}`, '#64748b'],
            [last(T.s2), isRev ? `for £${baseS2.toLocaleString('en-GB')} GP: ${gbpAbs(last(T.s2))}` : `Stretch £${baseS2.toLocaleString('en-GB')}`, '#64748b']
          );
        }
        ctx.save();
        ctx.font = '11px system-ui';
        ctx.textAlign = 'right';
        items.forEach(([v, t, c]) => {
          const py = y.getPixelForValue(v);
          if (py < a.top || py > a.bottom) return;
          ctx.fillStyle = c;
          ctx.fillText(t, a.right - 4, py - 5);
        });
        ctx.restore();
      }
    };

    const paint = () => {
      gpSaveState(state);
      syncUi();
      const isRev = state.metric === 'rev';
      const ps = periods();
      T = targets(ps);
      const tot = ps.map(val);
      const ly = ps.map((p) => val(prevYear(p)));
      const avg = tot.map((_, i) => {
        const w = tot.slice(Math.max(0, i - 2), i + 1).filter((v) => v != null);
        return w.length === 3 ? w.reduce((a, b) => a + b, 0) / 3 : null;
      });
      const ipIdx = ps.indexOf(inProgress);
      const mainName = isRev ? 'Revenue' : 'GP';
      const mainCol = isRev ? '#38bdf8' : '#f59e0b';
      const hMetric = root.querySelector('#st-gp-h-metric');
      if (hMetric) hMetric.textContent = mainName;
      const sub = panel.querySelector('#st-gp-sub');
      if (sub) {
        sub.textContent = isRev
          ? `Revenue (D2C + B2B). Dashed line = revenue needed for each year's survival GP at the ${gpPct(T.m)} blended margin of closed months × categories selected. Survival steps to £${baseSurv.toLocaleString('en-GB')} in ${baseYear}.`
          : `GP = revenue × each year's category GP rates (D2C + B2B). Survival line steps by year (+15% / +20%) to £${baseSurv.toLocaleString('en-GB')} in ${baseYear}.`;
      }
      const ds = [];
      if (state.view === 'bar') {
        GP_CAT_META.filter((c) => state.cats.has(c.id)).forEach((c) => {
          ds.push({
            type: 'bar', label: c.name,
            data: ps.map((p) => {
              const r = (byP.get(p) || {})[c.id];
              return r ? r[state.metric === 'rev' ? 'rev' : 'gp'] : 0;
            }),
            backgroundColor: c.c + 'cc', stack: 's', order: 5, borderWidth: 0
          });
        });
      } else {
        ds.push({
          type: 'line', label: mainName, data: tot,
          borderColor: mainCol, backgroundColor: isRev ? 'rgba(56,189,248,.08)' : 'rgba(245,158,11,.08)',
          fill: true, borderWidth: 3, tension: 0.25, order: 1,
          pointRadius: ps.map((_, i) => (i === ipIdx ? 5 : 3)),
          pointHoverRadius: 7,
          pointBackgroundColor: ps.map((_, i) => (i === ipIdx ? '#0b1118' : (tot[i] >= T.surv[i] ? '#22c55e' : mainCol))),
          pointBorderColor: ps.map((_, i) => (i === ipIdx ? mainCol : (tot[i] >= T.surv[i] ? '#22c55e' : mainCol))),
          segment: { borderDash: (ctx) => (ctx.p1DataIndex === ipIdx ? [5, 4] : undefined) }
        });
      }
      if (state.ly) {
        ds.push({
          type: 'line', label: 'Same month last year', data: ly,
          borderColor: '#7c8aa0', borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
          tension: 0.25, order: 2, spanGaps: true
        });
      }
      if (state.avg) {
        ds.push({
          type: 'line', label: '3-month average', data: avg,
          borderColor: '#e5e7eb', borderWidth: 2, borderDash: [2, 3], pointRadius: 0, tension: 0.3, order: 2
        });
      }
      ds.push({
        type: 'line', label: 'Target', data: T.surv,
        borderColor: '#cbd5e1', borderWidth: 2, borderDash: [7, 5],
        pointRadius: 0, pointHoverRadius: 0, order: 3, stepped: 'middle'
      });
      if (state.tgt) {
        ds.push({
          type: 'line', label: 'Stretch 1', data: T.s1,
          borderColor: '#475569', borderWidth: 1, borderDash: [3, 5],
          pointRadius: 0, pointHoverRadius: 0, order: 4, stepped: 'middle'
        });
        ds.push({
          type: 'line', label: 'Stretch 2', data: T.s2,
          borderColor: '#475569', borderWidth: 1, borderDash: [3, 5],
          pointRadius: 0, pointHoverRadius: 0, order: 4, stepped: 'middle'
        });
      }
      if (gpChartInst) {
        gpChartInst.destroy();
        gpChartInst = null;
      }
      gpChartInst = new Chart(canvas, {
        data: { labels: ps.map(gpPeriodLabel), datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { stacked: state.view === 'bar', grid: { color: '#1a2230' }, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true } },
            y: { stacked: state.view === 'bar', beginAtZero: true, grid: { color: '#1a2230' }, ticks: { color: '#94a3b8', callback: (v) => gbpAbs(v) } }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#111827', borderColor: '#334155', borderWidth: 1, padding: 10,
              titleColor: '#f8fafc', bodyColor: '#cbd5e1', footerColor: '#94a3b8',
              filter: (i) => !['Target', 'Stretch 1', 'Stretch 2'].includes(i.dataset.label)
                && (state.view !== 'bar' || i.raw > 0),
              callbacks: {
                title: (items) => {
                  const p = ps[items[0].dataIndex];
                  return gpPeriodLabel(p).replace(/ (\d\d)$/, ' 20$1') + (p === inProgress ? '  (in progress)' : '');
                },
                label: (i) => ` ${i.dataset.label}: ${i.raw == null ? '—' : gbpAbs(i.raw)}`,
                footer: (items) => {
                  const k = items[0].dataIndex;
                  const p = ps[k];
                  const t = tot[k];
                  const l = ly[k];
                  const out = [];
                  if (state.view === 'bar') out.push(`Total ${mainName}: ${gbpAbs(t)}`);
                  if (isRev) {
                    const m = marginOf(p);
                    const g = sumKey(p, 'gp');
                    out.push(`GP: ${gbpAbs(g)} (${m == null ? '—' : gpPct(m)} margin)`);
                    const sv = gpTierForYear(baseSurv, gpYr(p), rises, baseYear);
                    out.push(`Needed: ${gbpAbs(T.surv[k])} (${gbpAbs(sv)} GP at ${gpPct(T.m)}) → ${gpSgn(t - T.surv[k])}`);
                    if (m) out.push(`At this month's own mix it needed ${gbpAbs(sv / m)}`);
                  } else {
                    out.push(`Survival ${gpYr(p)}: ${gbpAbs(T.surv[k])} → ${gpSgn(t - T.surv[k])}`);
                    const rv = sumKey(p, 'rev');
                    if (rv) out.push(`Revenue: ${gbpAbs(rv)} (${gpPct(sumKey(p, 'gp') / rv)} margin)`);
                  }
                  if (l != null) out.push(`vs last year: ${gpSgn(t - l)}`);
                  if (state.view !== 'bar') {
                    const r = byP.get(p) || {};
                    const key = state.metric === 'rev' ? 'rev' : 'gp';
                    const top = GP_CAT_META
                      .filter((c) => state.cats.has(c.id) && r[c.id] && r[c.id][key])
                      .sort((a, b) => r[b.id][key] - r[a.id][key])
                      .slice(0, 4)
                      .map((c) => `${c.name} ${gbpAbs(r[c.id][key])}`);
                    if (top.length) out.push('Top: ' + top.join(' · '));
                  }
                  return out;
                }
              }
            }
          }
        },
        plugins: [lineLabels]
      });

      const lg = [];
      if (state.view === 'line') {
        lg.push([`${mainName} (green dot = at/above ${isRev ? 'revenue needed' : 'survival'})`, mainCol, false]);
      }
      if (state.ly) lg.push(['Same month last year', '#7c8aa0', false]);
      if (state.avg) lg.push(['3-month average', '#e5e7eb', true]);
      lg.push([isRev ? 'Revenue needed for survival GP (steps by year)' : `Survival GP (steps by year to £${baseSurv.toLocaleString('en-GB')} in ${baseYear})`, '#cbd5e1', true]);
      if (state.tgt) {
        lg.push([isRev ? 'for stretch GP (steps by year)' : `Stretch £${baseS1.toLocaleString('en-GB')} / £${baseS2.toLocaleString('en-GB')} (${baseYear}, same yearly steps)`, '#475569', true]);
      }
      const legendEl = panel.querySelector('#st-gp-legend');
      if (legendEl) {
        legendEl.innerHTML = lg.map(([t, c, d]) =>
          `<span><i class="${d ? 'dash' : ''}" style="--c:${c}"></i>${esc(t)}</span>`).join('');
      }

      const closed = ps.filter((p) => p !== inProgress);
      const ci = closed.map((p) => ps.indexOf(p));
      const ct = closed.map(val);
      const n = ct.length;
      const tg = ci.map((i) => T.surv[i]);
      const avgAll = ct.reduce((a, b) => a + b, 0) / Math.max(n, 1);
      const avgT = tg.reduce((a, b) => a + b, 0) / Math.max(n, 1);
      const hit = ct.filter((v, j) => v >= tg[j]).length;
      const lyVals = closed.map((p) => val(prevYear(p))).filter((v) => v != null);
      const lyAvg = lyVals.length ? lyVals.reduce((a, b) => a + b, 0) / lyVals.length : null;
      const l3 = ct.slice(-3).reduce((a, b) => a + b, 0) / Math.max(Math.min(3, n), 1);
      const l3t = tg.slice(-3).reduce((a, b) => a + b, 0) / Math.max(Math.min(3, n), 1);
      const gap = ct.reduce((a, v, j) => a + (v - tg[j]), 0);
      const cls = (v) => (v >= 0 ? 'good' : 'bad');
      const tl = isRev ? 'needed' : 'survival';
      const tiles = [
        [`Average ${mainName.toLowerCase()} / month`, gbpAbs(avgAll), `<span class="${cls(avgAll - avgT)}">${gpSgn(avgAll - avgT)}</span> vs ${tl} (avg ${gbpAbs(avgT)})`],
        [`Months at or above ${tl}`, `${hit} of ${n}`, `${Math.round((hit / Math.max(n, 1)) * 100)}% of closed months`],
        ['Last 3 closed months', `${gbpAbs(l3)} avg`, `<span class="${cls(l3 - l3t)}">${gpSgn(l3 - l3t)}</span> vs ${tl}`],
        ['Same months last year', lyAvg == null ? '—' : `${gbpAbs(lyAvg)} avg`, lyAvg == null ? '' : `<span class="${cls(avgAll - lyAvg)}">${gpSgn(avgAll - lyAvg)}</span> this period vs last`],
        [`Cumulative vs ${tl}`, `<span class="${cls(gap)}">${gpSgn(gap)}</span>`, `over ${n} closed months`]
      ];
      if (isRev) {
        tiles.splice(1, 0, ['Blended GP margin', gpPct(T.m), `so £${baseSurv.toLocaleString('en-GB')} GP (${baseYear}) needs ${gbpAbs(baseSurv / T.m)} revenue`]);
      }
      const statsEl = panel.querySelector('#st-gp-stats');
      if (statsEl) {
        statsEl.innerHTML = tiles.map(([k, v, d]) =>
          `<div class="st-gp-stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
      }
    };

    panel.querySelectorAll('#st-gp-metric button').forEach((b) => {
      b.onclick = () => { state.metric = b.dataset.v; paint(); };
    });
    panel.querySelectorAll('#st-gp-range button').forEach((b) => {
      b.onclick = () => { state.range = b.dataset.v; paint(); };
    });
    panel.querySelectorAll('#st-gp-view button').forEach((b) => {
      b.onclick = () => { state.view = b.dataset.v; paint(); };
    });
    const oly = panel.querySelector('#st-gp-oly');
    const oavg = panel.querySelector('#st-gp-oavg');
    const otgt = panel.querySelector('#st-gp-otgt');
    if (oly) oly.onclick = () => { state.ly = !state.ly; paint(); };
    if (oavg) oavg.onclick = () => { state.avg = !state.avg; paint(); };
    if (otgt) otgt.onclick = () => { state.tgt = !state.tgt; paint(); };
    panel.querySelectorAll('#st-gp-cats .st-gp-chip').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.cat === 'all') {
          GP_CAT_META.forEach((c) => state.cats.add(c.id));
        } else {
          const id = Number(b.dataset.cat);
          if (state.cats.has(id)) {
            if (state.cats.size > 1) state.cats.delete(id);
          } else state.cats.add(id);
        }
        paint();
      };
    });
    paint();
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
    const free = e.be_free != null ? e.be_free : e.be;
    const after = e.be_after;
    const have = e.rag_booked != null ? e.rag_booked : e.booked;
    const label = after != null ? `${free} / ${after}` : String(free ?? '—');
    const short = free != null ? free - have : 0;
    const hint = short > 0
      ? `<div class="st-be-hint">${free} needed (time free) / ${short} short</div>`
      : `<div class="st-be-hint">RAG = time free</div>`;
    return `<td class="st-big ${ragClass(rag)}" data-sort="${free ?? ''}" title="B/E time free / after time. RAG uses time free.">${label}${hint}</td>`;
  }
  function gpDualCell(free, after, est, tip) {
    if (free == null && after == null) return '<td>—</td>';
    const sortBasis = filterState.gpSort === 'after' ? after : free;
    const sortVal = sortBasis != null ? sortBasis : (free != null ? free : after);
    const freeCls = Number(free) < 0 ? 'st-gp-neg' : '';
    const afterCls = Number(after) < 0 ? 'st-gp-neg' : '';
    const freeHtml = free == null
      ? '—'
      : `<b class="${freeCls}">${gbpSigned(free)}${est ? ' <span class="st-est">est.</span>' : ''}</b>`;
    const afterHtml = after == null
      ? '<div class="rt-sub">—</div>'
      : `<div class="rt-sub ${afterCls}">${gbpSigned(after)}</div>`;
    const title = tip ? ` title="${esc(tip)}"` : '';
    return `<td data-sort="${sortVal}"${title}>${freeHtml}${afterHtml}</td>`;
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
        ${gpDualCell(e.gp_now_free, e.gp_now_after, e.gp_est, e.gp_tooltip)}
        ${gpDualCell(e.gp_full_free, e.gp_full_after, e.gp_est, e.gp_tooltip)}
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
      ? `<br><span class="st-est">Unmatched locations (room £0): ${esc(g.unmatched.slice(0, 6).join('; '))}</span>`
      : '';
    const nf = g.now_free != null ? g.now_free : g.now;
    const na = g.now_after;
    const ff = g.full_free != null ? g.full_free : g.full;
    const fa = g.full_after;
    return `<p class="rt-sub st-gp-total">Total GP now — time free <b class="${nf < 0 ? 'st-gp-neg' : ''}">${gbpSigned(nf)}</b>${na != null ? ` · after time <b class="${na < 0 ? 'st-gp-neg' : ''}">${gbpSigned(na)}</b>` : ''}
      · if full — time free <b class="${ff < 0 ? 'st-gp-neg' : ''}">${gbpSigned(ff)}</b>${fa != null ? ` · after time <b class="${fa < 0 ? 'st-gp-neg' : ''}">${gbpSigned(fa)}</b>` : ''}${est} · source: ${esc(src)}${um}</p>`;
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
        <h3>4 · <span id="st-gp-h-metric">GP</span> by month vs survival</h3>
        ${gpChartShell(survival, data.stretch)}
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
          <label>GP sort <select id="st-gp-sort"><option value="free">Time free</option><option value="after">After time</option></select></label>
          <span class="rt-sub">${(data.diary || []).length} events · day/walk cap 6 · Batsford AM+PM linked · RAG = B/E time free</span>
        </div>
        <div style="overflow-x:auto">
        <table class="rt-table" id="st-diary">
          <thead><tr>
            <th data-col="0">Date</th><th class="left" data-col="1">Event</th><th data-col="2">Price</th><th data-col="3">Cap</th>
            <th data-col="4">Booked</th><th data-col="5">Left</th><th data-col="6">Fill</th><th data-col="7">+wk</th>
            <th data-col="8" title="B/E time free / after time. RAG uses time free (losing cash).">B/E</th>
            <th data-col="9">RAG</th><th data-col="10">Status</th><th data-col="11">£ booked</th><th data-col="12">£ unsold</th>
            <th data-col="13" title="Time free = cash in minus cash out. After time = also pays you £30/h. Bold = time free; below = after time.">GP now</th>
            <th data-col="14" title="Time free = cash in minus cash out. After time = also pays you £30/h. Bold = time free; below = after time.">GP if full</th>
            <th data-col="15">Flags</th>
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

    if (gpChartInst) {
      try { gpChartInst.destroy(); } catch (_e) { /* ignore */ }
      gpChartInst = null;
    }
    root.querySelectorAll('.rt-table').forEach(sortTable);
    const rag = root.querySelector('#st-rag');
    const typ = root.querySelector('#st-type');
    const needs = root.querySelector('#st-needs');
    const gpSort = root.querySelector('#st-gp-sort');
    if (rag) rag.value = filterState.rag;
    if (typ) typ.value = filterState.type;
    if (needs) needs.checked = filterState.needs;
    if (gpSort) gpSort.value = filterState.gpSort || 'free';
    if (rag) rag.addEventListener('change', () => { filterState.rag = rag.value; applyFilters(root); });
    if (typ) typ.addEventListener('change', () => { filterState.type = typ.value; applyFilters(root); });
    if (needs) needs.addEventListener('change', () => { filterState.needs = needs.checked; applyFilters(root); });
    if (gpSort) {
      gpSort.addEventListener('change', () => {
        filterState.gpSort = gpSort.value;
        render(root, lastData);
      });
    }
    applyFilters(root);
    bindTicks(root);
    mountGpChart(root, data);
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
