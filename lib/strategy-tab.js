/**
 * Strategy & KPIs tab — dark Revenue Truth styling, real data only.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  let lastData = null;
  let flashSavedId = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function gbp(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return '£' + Math.round(Number(n)).toLocaleString('en-GB');
  }

  function fmtDone(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  function pill(status, text) {
    const cls = status === 'ok' ? 'ok' : status === 'below' || status === 'bad' ? 'bad'
      : status === 'needs_plans' || status === 'n/a' ? 'partial' : 'warn';
    return `<span class="rt-pill ${cls}">${esc(text || status.toUpperCase())}</span>`;
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
          const cmp = (av.match(/[0-9]/) && bv.match(/[0-9]/) && !Number.isNaN(an) && !Number.isNaN(bn))
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
    for (const a of data.actions || []) {
      (byQ[a.quarter_key] = byQ[a.quarter_key] || []).push(a);
    }
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
        const doneDate = a.is_ticked && a.ticked_at ? `done ${fmtDone(a.ticked_at)}` : '';
        const flash = flashSavedId === a.id ? '<span class="st-saved">Saved ✓</span>' : '';
        return `<li class="${a.is_ticked ? 'st-done' : ''}${overdue ? ' st-overdue' : ''}" data-id="${a.id}">
          <button type="button" class="st-tick ${a.is_ticked ? 'on' : ''}" data-id="${a.id}" aria-pressed="${a.is_ticked}" title="Toggle"></button>
          <span class="st-lab" contenteditable="true" data-id="${a.id}" data-field="label">${esc(a.label)}</span>
          <span class="st-side">${flash}${doneDate ? `<span class="st-done-date">${esc(doneDate)}</span>` : ''}${overdue ? pill('bad', 'OVERDUE') : ''}</span>
          <input class="st-due" type="date" data-id="${a.id}" value="${esc(a.due_week_start)}" title="Due week start (Monday)" />
        </li>`;
      }).join('');
      return `<div class="qcard ${isCur ? 'is-current' : ''}">
        <h4>${esc(q.label)} ${isCur ? '<span class="rt-pill current">CURRENT</span>' : ''} <span class="st-progress">${done.length} of ${acts.length} done</span></h4>
        <div class="obj">${esc(q.objective)}</div>
        <ul>${lis}</ul>
        <div class="qmeta">Targets: ${t.plans} plans · ${t.beginners_non_jlr} non-JLR beginners · GP T3 ${gbp(t.gp_t3)} · returning ${gbp(t.returning_r12)}</div>
      </div>`;
    }).join('');
  }

  function gpChart(series, survival) {
    if (!series?.length) return '<p class="rt-sub">No GP series yet.</p>';
    const w = 560; const h = 160; const pad = 20;
    const vals = series.map((s) => s.gp);
    const max = Math.max(survival * 1.2, ...vals, 1);
    const min = Math.min(0, ...vals);
    const span = max - min || 1;
    const pts = series.map((s, i) => {
      const x = pad + (i / Math.max(series.length - 1, 1)) * (w - pad * 2);
      const y = h - pad - ((s.gp - min) / span) * (h - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    const ySurv = h - pad - ((survival - min) / span) * (h - pad * 2);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:160px;display:block">
      <line x1="0" y1="${ySurv}" x2="${w}" y2="${ySurv}" stroke="#94a3b8" stroke-dasharray="5 5" stroke-width="1.5"/>
      <text x="8" y="${ySurv - 6}" fill="#94a3b8" font-size="11">£${survival.toLocaleString('en-GB')}</text>
      <polyline fill="none" stroke="#f59e0b" stroke-width="3" points="${pts}"/>
    </svg>`;
  }

  function render(root, data) {
    lastData = data;
    const h = data.headline || {};
    const now = data.roadmap_now || {};
    const sources = data.beginners_sources || {};
    const ws = data.workshop_signals || {};
    const plansEmpty = data.plan_clients?.empty_reason;
    const convNote = data.beginners_conversion?.empty_note;

    root.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;margin-bottom:.35rem;">
        <h2>Strategy &amp; KPIs</h2>
        <span class="rt-prov-pill rt-prov-dynamic">LIVE</span>
      </div>
      <p class="rt-sub">2026–27 plan. Survival GP ${gbp(data.survival_gp)} (from business_targets). Tick actions here — saved to Supabase. JLR separate. ≥£3,000 one-offs excluded from returning £.</p>

      <div class="rt-section">
        <h3>1 · Strategy &amp; quarterly plan</h3>
        <div class="pillars">
          <div class="pillar"><h4>Fill the front door</h4><p>£150 3-evening beginners at home (max 4). Google, gift vouchers, referrals. JLR = upside only.</p></div>
          <div class="pillar"><h4>Keep them</h4><p>“Your first year” Pick n Mix on every beginners last night — from £600 / £50pm; reviews quarterly; Academy free 12m.</p></div>
          <div class="pillar"><h4>Protect margins</h4><p>Fewer proven workshops; max 4, one car; plan clients first refusal on residentials; hold 1-2-1 prices.</p></div>
        </div>
        <div class="quarters" style="margin-top:1rem;">${renderActions(data)}</div>
      </div>

      <div class="rt-section">
        <h3>Headline strip</h3>
        <div class="rt-strip">
          <div class="rt-strip-card ${h.gp_t3 != null && h.gp_t3 < data.survival_gp ? 'band-below_survival' : 'band-thrive'}">
            <div class="rt-strip-label">1 · GP / month (T3)</div>
            <div class="rt-strip-value">${gbp(h.gp_t3)}</div>
            <div class="rt-strip-meta">vs survival ${gbp(data.survival_gp)}</div>
          </div>
          <div class="rt-strip-card band-thrive">
            <div class="rt-strip-label">2 · Beginners seats</div>
            <div class="rt-strip-value">${h.beginners_fill_pct != null ? h.beginners_fill_pct + '%' : '—'}</div>
            <div class="rt-strip-meta">R12 · next 8w ${h.beginners_next_8w?.booked || 0}/${h.beginners_next_8w?.seats || 0} · target ≥60%</div>
          </div>
          <div class="rt-strip-card band-comfortable">
            <div class="rt-strip-label">5 · Plans active</div>
            <div class="rt-strip-value">${h.plans_active != null ? h.plans_active : '—'}</div>
            <div class="rt-strip-meta">${esc(h.plans_meta || (h.plans_active == null ? 'Awaiting Plans tab upload' : '→ 12 by Sep 27'))}</div>
          </div>
          <div class="rt-strip-card band-survival">
            <div class="rt-strip-label">9 · Returning £ (R12)</div>
            <div class="rt-strip-value">${gbp(h.returning_r12)}</div>
            <div class="rt-strip-meta">excl JLR &amp; ≥£3k · target £23k</div>
          </div>
        </div>
      </div>

      <div class="two">
        <div class="rt-section">
          <h3>GP by month vs survival</h3>
          <p class="rt-sub">Dashed line = ${gbp(data.survival_gp)}. Pick n Mix Out excluded from GP.</p>
          ${gpChart(data.gp_series, data.survival_gp)}
        </div>
        <div class="rt-section">
          <h3>Roadmap milestones</h3>
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
      </div>

      <div class="rt-section">
        <h3>2 · Upcoming events fill (next 90 days)</h3>
        <label class="rt-toggle"><input type="checkbox" id="st-filter-risk"> At risk only</label>
        ${!(data.upcoming_events || []).length ? '<p class="rt-sub">No upcoming Workshops / Courses-Classes events in the next 90 days.</p>' : `
        <table class="rt-table" id="st-upcoming">
          <thead><tr><th data-col="0">Date</th><th class="left" data-col="1">Course / workshop</th><th data-col="2">Type</th><th data-col="3">Booked</th><th data-col="4">Cap</th><th data-col="5">Left</th><th data-col="6">Status</th></tr></thead>
          <tbody>
            ${(data.upcoming_events || []).map((e) => `<tr data-status="${esc(e.status)}">
              <td>${esc(e.date)}</td><td class="left">${esc(e.name)}</td><td>${esc(e.type)}</td>
              <td>${e.booked}</td><td>${e.capacity}</td><td>${e.places_left}</td>
              <td>${pill(e.status === 'At risk' ? 'warn' : e.status === 'Full' ? 'ok' : 'partial', e.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="rt-section">
        <h3>3 · Plan clients</h3>
        ${plansEmpty ? `<p class="rt-sub">${esc(plansEmpty)}</p>` : `
        <table class="rt-table" id="st-plans">
          <thead><tr><th class="left" data-col="0">Client</th><th data-col="1">Type</th><th data-col="2">Value</th><th data-col="3">Start</th><th data-col="4">Credit £</th><th data-col="5">Pace %</th><th data-col="6">Next review</th><th data-col="7">Held</th><th data-col="8">Status</th><th data-col="9">Flags</th></tr></thead>
          <tbody>
            ${(data.plan_clients.rows || []).map((r) => `<tr>
              <td class="left">${esc(r.client)}</td><td>${esc(r.plan_type)}</td><td>${gbp(r.plan_value)}</td><td>${esc(r.start_date)}</td>
              <td>${gbp(r.credit_used)}</td><td>${r.pace_pct == null ? '—' : r.pace_pct + '%'}</td>
              <td>${esc(r.next_review_due || '—')}</td><td>${r.reviews_held}/4</td><td>${esc(r.status || '—')}</td>
              <td>${(r.flags || []).map((f) => pill(f === 'unmatched_name' ? 'bad' : 'warn', f)).join(' ') || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="rt-section">
        <h3>4 · Beginners → plan conversion by course</h3>
        ${convNote ? `<p class="rt-sub">${esc(convNote)}</p>` : ''}
        <table class="rt-table" id="st-conv">
          <thead><tr><th data-col="0">Dates</th><th class="left" data-col="1">Course</th><th data-col="2">Attendees</th><th data-col="3">JLR</th><th data-col="4">Plans ≤60d</th><th data-col="5">Conv %</th></tr></thead>
          <tbody>
            ${(data.beginners_conversion?.rows || []).slice(0, 40).map((r) => `<tr>
              <td>${esc(r.dates)}</td><td class="left">${esc(r.event)}</td><td>${r.attendees}</td><td>${r.jlr}</td>
              <td>${r.plans_60d == null ? '—' : r.plans_60d}</td>
              <td>${r.conversion_pct == null ? '—' : r.conversion_pct + '%'}</td>
            </tr>`).join('') || '<tr><td colspan="6">No beginners course rows</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="two">
        <div class="rt-section">
          <h3>3 · Beginners by source</h3>
          <p class="rt-sub">JLR shown separately — never mixed into non-JLR growing.</p>
          <table class="rt-table" id="st-sources">
            <thead><tr><th class="left" data-col="0">Source</th><th data-col="1">Seats</th></tr></thead>
            <tbody>
              ${['Google', 'Gift', 'Existing & referral', 'JLR', 'Other'].map((k) =>
                `<tr><td class="left">${esc(k)}${k === 'JLR' ? ' <span class="rt-pill partial">EXCL</span>' : ''}</td><td>${sources[k] || 0}</td></tr>`
              ).join('')}
            </tbody>
          </table>
        </div>
        <div class="rt-section">
          <h3>Plans &amp; workshops (6–8, 10)</h3>
          <table class="rt-table">
            <thead><tr><th class="left">Signal</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td class="left">Residential avg attendees / run</td><td>${ws.residential_avg ?? '—'}</td></tr>
              <tr><td class="left">Residentials ≤2 booked (next 60d)</td><td>${ws.residentials_at_risk_60d ?? 0}</td></tr>
              <tr><td class="left">Plan credit / reviews / discount</td><td>${plansEmpty ? esc(plansEmpty) : 'see Plan clients + KPI table'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="rt-section">
        <h3>All 11 KPIs</h3>
        <label class="rt-toggle"><input type="checkbox" id="st-kpi-filter"> Hide needs-plans</label>
        <table class="rt-table" id="st-kpis">
          <thead><tr><th data-col="0">#</th><th class="left" data-col="1">KPI</th><th data-col="2">Actual</th><th data-col="3">Target</th><th data-col="4">Status</th></tr></thead>
          <tbody>
            ${(data.kpis || []).map((k) => {
              let actual = k.actual;
              if (k.unit === 'gbp') actual = gbp(k.actual);
              else if (k.unit === 'pct' && k.actual != null) actual = k.actual + '%';
              else if (k.actual == null) actual = '—';
              return `<tr data-status="${esc(k.status)}"><td>${k.id}</td><td class="left">${esc(k.label)}</td>
                <td>${esc(actual)}${k.reason ? ` <span class="rt-sub">(${esc(k.reason)})</span>` : ''}</td>
                <td>${k.unit === 'gbp' ? gbp(k.target) : esc(k.target)}</td>
                <td>${pill(k.status, k.status === 'needs_plans' ? 'NEEDS PLANS' : k.status)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    root.querySelectorAll('.rt-table').forEach(sortTable);

    root.querySelectorAll('.st-tick').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const li = btn.closest('li');
        const wasOn = btn.classList.contains('on');
        const next = !wasOn;
        const prevErr = li?.querySelector('.st-err');
        if (prevErr) prevErr.remove();
        btn.disabled = true;
        btn.classList.toggle('on', next);
        btn.setAttribute('aria-pressed', String(next));
        try {
          const action = await patchAction(id, { is_ticked: next });
          if (lastData?.actions) {
            const row = lastData.actions.find((a) => Number(a.id) === id);
            if (row) Object.assign(row, action);
          }
          flashSavedId = id;
          render(root, lastData);
          setTimeout(() => {
            if (flashSavedId === id) {
              flashSavedId = null;
              const r = document.getElementById('strategy-root');
              if (r && lastData) render(r, lastData);
            }
          }, 1600);
        } catch (e) {
          btn.classList.toggle('on', wasOn);
          btn.setAttribute('aria-pressed', String(wasOn));
          if (li) {
            const err = document.createElement('span');
            err.className = 'st-err';
            err.textContent = 'Not saved — try again';
            li.appendChild(err);
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

    root.querySelectorAll('.st-due').forEach((inp) => {
      inp.addEventListener('change', async () => {
        try {
          await patchAction(Number(inp.dataset.id), { due_week_start: inp.value });
        } catch (e) { alert(e.message || String(e)); }
      });
    });

    root.querySelectorAll('.st-lab').forEach((el) => {
      el.addEventListener('blur', async () => {
        try {
          await patchAction(Number(el.dataset.id), { label: el.textContent.trim() });
        } catch (e) { alert(e.message || String(e)); }
      });
    });

    const risk = root.querySelector('#st-filter-risk');
    if (risk) {
      risk.addEventListener('change', () => {
        root.querySelectorAll('#st-upcoming tbody tr').forEach((tr) => {
          tr.style.display = risk.checked && tr.dataset.status !== 'At risk' ? 'none' : '';
        });
      });
    }
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
    if (!force && lastData && root.dataset.loaded === '1') {
      render(root, lastData);
      return;
    }
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
