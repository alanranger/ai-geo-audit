/**
 * One month-by-month chart (Revenue tab): GP or revenue by month, every filter Strategy's chart had, its 6 tiles,
 * seasonal survival / stretch lines from the Targets panel and the flat bills line. window.MonthlyChart.
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
      metric: 'rev', range: 'ytd', view: 'line', ly: false, avg: false, tgt: true,
      cats: GP_CAT_META.map((c) => c.id)
    };
    try {
      const raw = localStorage.getItem(GP_LS_KEY);
      if (!raw) return base;
      const j = JSON.parse(raw);
      const cats = Array.isArray(j.cats) ? j.cats.map(Number).filter((id) => GP_CAT_META.some((c) => c.id === id)) : base.cats;
      return {
        metric: ['gp', 'rev'].includes(j.metric) ? j.metric : base.metric,
        range: ['12', '24', 'all', 'ytd'].includes(j.range) ? j.range : base.range,
        view: j.view === 'bar' ? 'bar' : 'line',
        ly: typeof j.ly === 'boolean' ? j.ly : base.ly,
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
  const validWeighting = (w) => Array.isArray(w) && w.length === 12;
  /** The weighting for a year: its own (weighting_by_year), the nearest year's outside that range, else this year's. */
  function weightingForYear(data, y) {
    const by = data.targets?.weighting_by_year || {};
    const years = Object.keys(by).map(Number).filter((k) => validWeighting(by[k])).sort((a, b) => a - b);
    if (!years.length) return data.targets?.weighting;
    return by[Math.min(Math.max(y, years[0]), years[years.length - 1])] || data.targets?.weighting;
  }
  /** Seasonal factor for a period: 12 × the Booking Sheet weighting of its month in its own year (1 when no pattern). */
  function seasonalFactor(data) {
    return (p) => {
      const w = weightingForYear(data, Number(String(p).slice(0, 4)));
      return validWeighting(w) ? 12 * (Number(w[Number(String(p).slice(5, 7)) - 1]) || 0) : 1;
    };
  }
  /** Revenue view, Targets-panel year: the panel's own revenue needed for that month (same £ as every tab). */
  function panelRevenueNeeded(data, baseYear) {
    const rev = data.targets?.revenue_survival;
    if (!Array.isArray(rev) || rev.length !== 12) return (_p, fallback) => fallback;
    return (p, fallback) => (gpYr(p) === baseYear ? Number(rev[Number(String(p).slice(5, 7)) - 1]) || fallback : fallback);
  }
  /** GP → revenue for "needed" lines: the Targets panel's target-mix margin (one GP method). */
  function targetMixMargin(data) {
    return Number(data.targets?.target_mix_margin) || null;
  }
  function gpChartShell(survival, stretch) {
    const s1 = Number(stretch?.stretch1 || 0);
    const s2 = Number(stretch?.stretch2 || 0);
    const chips = GP_CAT_META.map((c) =>
      `<button type="button" class="st-gp-chip" data-cat="${c.id}" style="--c:${c.c}" aria-pressed="true">${esc(c.name)}</button>`
    ).join('') + '<button type="button" class="st-gp-chip" data-cat="all" aria-pressed="false">All</button>';
    return `
      <style>
        .mc-root .st-gp-panel { display:grid; gap:14px; min-width:0; }
        .mc-root .st-gp-controls { display:flex; flex-wrap:wrap; gap:14px 22px; align-items:flex-start; }
        .mc-root .st-gp-ctl { display:grid; gap:6px; }
        .mc-root .st-gp-ctl > span { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
        .mc-root .st-gp-seg { display:flex; flex-wrap:wrap; gap:4px; }
        .mc-root .st-gp-seg button, .mc-root .st-gp-chip {
          background:#0b1118; color:#94a3b8; border:1px solid #1f2937; border-radius:6px;
          padding:5px 10px; font:inherit; font-size:12px; cursor:pointer;
        }
        .mc-root .st-gp-seg button[aria-pressed="true"], .mc-root .st-gp-chip[aria-pressed="true"] {
          background:#1e293b; color:#e5e7eb; border-color:#334155;
        }
        .mc-root .st-gp-chip[aria-pressed="true"]::before {
          content:""; display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:6px; background:var(--c,#94a3b8);
        }
        .mc-root .st-gp-chips { display:flex; flex-wrap:wrap; gap:4px; max-width:720px; }
        .mc-root .st-gp-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; }
        .mc-root .st-gp-stat { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:10px 12px; }
        .mc-root .st-gp-stat .k { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
        .mc-root .st-gp-stat .v { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; margin-top:2px; }
        .mc-root .st-gp-stat .d { font-size:12px; color:#94a3b8; margin-top:2px; }
        .mc-root .st-gp-stat .good { color:#22c55e; } .mc-root .st-gp-stat .bad { color:#ef4444; }
        .mc-root .st-gp-legend { display:flex; flex-wrap:wrap; gap:16px; font-size:12px; color:#94a3b8; }
        .mc-root .st-gp-legend i { display:inline-block; width:18px; height:0; border-top:3px solid var(--c); vertical-align:middle; margin-right:6px; }
        .mc-root .st-gp-legend i.dash { border-top-style:dashed; border-top-width:2px; }
        .mc-root .st-gp-plot { background:#0b1118; border:1px solid #1f2937; border-radius:8px; padding:10px; position:relative; height:420px; min-width:0; }
        @media (max-width:600px){ .mc-root .st-gp-plot { height:340px; } }
      </style>
      <div class="st-gp-panel" id="st-gp-panel"
        data-survival="${survival}" data-s1="${s1}" data-s2="${s2}">
        <p class="rt-sub" id="st-gp-sub">GP = revenue × each year's category GP rates (D2C + B2B). Survival steps by year to £${Number(survival).toLocaleString('en-GB')} in 2026.</p>
        <div class="st-gp-controls">
          <div class="st-gp-ctl"><span>Measure</span><div class="st-gp-seg" id="st-gp-metric">
            <button type="button" data-v="gp">GP</button>
            <button type="button" data-v="rev" aria-pressed="true">Revenue</button>
          </div></div>
          <div class="st-gp-ctl"><span>Period</span><div class="st-gp-seg" id="st-gp-range">
            <button type="button" data-v="12">12 months</button>
            <button type="button" data-v="24">24 months</button>
            <button type="button" data-v="all">All (since Jan 24)</button>
            <button type="button" data-v="ytd" aria-pressed="true">This year</button>
          </div></div>
          <div class="st-gp-ctl"><span>Show</span><div class="st-gp-seg" id="st-gp-view">
            <button type="button" data-v="line" aria-pressed="true">Total line</button>
            <button type="button" data-v="bar">Stacked by category</button>
          </div></div>
          <div class="st-gp-ctl"><span>Overlays</span><div class="st-gp-seg">
            <button type="button" id="st-gp-oly" aria-pressed="false">Same month last year</button>
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
    const baseSurv = Number(panel.dataset.survival || data.survival_gp || 0);
    const baseS1 = Number(panel.dataset.s1 || data.stretch?.stretch1 || 0);
    const baseS2 = Number(panel.dataset.s2 || data.stretch?.stretch2 || 0);
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
    const mixMargin = targetMixMargin(data);
    const seasonOf = seasonalFactor(data);
    const panelSurvRev = panelRevenueNeeded(data, baseYear);
    const targets = (ps) => {
      const isGp = state.metric === 'gp';
      const m = isGp || !mixMargin ? 1 : mixMargin;
      const flat = (base, p) => gpTierForYear(base, gpYr(p), rises, baseYear) / m;
      const f = (base) => ps.map((p) => flat(base, p) * seasonOf(p));
      const surv = f(baseSurv);
      return {
        m: isGp ? null : m, bm: isGp ? null : blended(ps),
        surv: isGp ? surv : ps.map((p, i) => panelSurvRev(p, surv[i])), s1: f(baseS1), s2: f(baseS2), bills: ps.map((p) => flat(baseSurv, p))
      };
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
        const items = [
          [last(T.surv), `${isRev ? 'Revenue needed for survival' : 'Survival (seasonal)'}: ${gbpAbs(last(T.surv))}`, '#cbd5e1'],
          [last(T.bills), `Bills line: ${gbpAbs(last(T.bills))}`, '#fbbf24']
        ];
        if (state.tgt) {
          items.push(
            [last(T.s1), `Stretch 1: ${gbpAbs(last(T.s1))}`, '#64748b'],
            [last(T.s2), `Stretch 2: ${gbpAbs(last(T.s2))}`, '#64748b']
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
          ? `Revenue (D2C + B2B). Dashed line = revenue each month's seasonal survival GP needs at the ${gpPct(T.m)} target-mix margin (Booking Sheet category mix × category GP rates). Amber dashes = the flat bills line (£${baseSurv.toLocaleString('en-GB')} GP in ${baseYear}, as revenue).`
          : `GP = revenue × each year's category GP rates (D2C + B2B). Survival = the Targets panel's seasonal monthly target (Booking Sheet weighting); amber dashes = the flat £${baseSurv.toLocaleString('en-GB')} bills line. Earlier years step down by the cost rises (+15% / +20%).`;
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
      ds.push({
        type: 'line', label: 'Bills line', data: T.bills,
        borderColor: '#fbbf24', borderWidth: 1.5, borderDash: [4, 4],
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
      // Lines must never stack on the category bars (or on each other) when the y axis is stacked.
      ds.forEach((d, i) => { if (d.type === 'line') d.stack = `line-${i}`; });
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
              filter: (i) => !['Target', 'Stretch 1', 'Stretch 2', 'Bills line'].includes(i.dataset.label)
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
                    const sv = T.surv[k] * T.m;
                    out.push(`Needed: ${gbpAbs(T.surv[k])} (${gbpAbs(sv)} seasonal GP at ${gpPct(T.m)}) → ${gpSgn(t - T.surv[k])}`);
                    if (m) out.push(`At this month's own mix it needed ${gbpAbs(sv / m)}`);
                  } else {
                    out.push(`Survival (seasonal): ${gbpAbs(T.surv[k])} → ${gpSgn(t - T.surv[k])} · bills line ${gbpAbs(T.bills[k])}`);
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
      lg.push([isRev ? 'Revenue needed for seasonal survival GP' : 'Survival GP (seasonal, Targets panel)', '#cbd5e1', true]);
      lg.push([`Bills line (flat £${baseSurv.toLocaleString('en-GB')} GP in ${baseYear}${isRev ? ', as revenue' : ''})`, '#fbbf24', true]);
      if (state.tgt) {
        lg.push([`Stretch £${baseS1.toLocaleString('en-GB')} / £${baseS2.toLocaleString('en-GB')} GP (${baseYear}), seasonal`, '#475569', true]);
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
        tiles.splice(1, 0, ['Blended GP margin', gpPct(T.bm), `closed months · "needed" uses the ${gpPct(T.m)} target mix, so £${baseSurv.toLocaleString('en-GB')} GP (${baseYear}) needs ${gbpAbs(baseSurv / T.m)} revenue`]);
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

  window.MonthlyChart = { shell: gpChartShell, mount: mountGpChart, seasonalFactor };
})();
