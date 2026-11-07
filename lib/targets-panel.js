/**
 * Targets panel (Strategy & Actions, collapsed at the bottom): the one target set every tab and the Monday brief
 * read. Loads and saves GET/POST /api/aigeo/targets-master; a save writes one business_targets row dated today.
 * Layout follows the approved S1 mock-up: four group cards (money, per tier, funnel, roadmap & KPIs) + campaign channels.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FUNNEL_LABELS = {
    ctr_28d_pct: ['Search CTR, 28 days', '%'],
    money_page_click_share_pct: ['Money-page share of clicks', '%'],
    click_to_sale_pct: ['Click → sale', '%'],
    enquiry_to_sale_pct: ['Enquiry → sale', '%'],
    revenue_per_1k_impressions: ['Revenue per 1,000 impressions', '£']
  };
  const ROADMAP_FIELDS = [['plans', 'Plans'], ['beginners_non_jlr', 'Non-JLR beginners'], ['returning_r12', 'Returning £ (R12)'], ['gp_t3', 'GP avg (T3m) £']];
  const KPI_LABELS = {
    beginners_seats_pct: ['Beginners seats filled', '≥ %'],
    residential_avg: ['Residential average booked', '≥'],
    plan_conversion_pct: ['Plan conversion ≤60 days', '%'],
    plans_active: ['Pick n Mix plans active', ''],
    plan_reviews_pct: ['Plan reviews held', '%'],
    plan_discount_max_pct: ['Plan discount cost', 'max %'],
    plan_credit_pace_band_pct: ['Plan credit vs pace', '± %'],
    plan_renewals_pct: ['Plan renewals', '%'],
    returning_r12_gbp: ['Returning-client revenue (R12)', '£']
  };
  const RETIRED = 'Retired: Scenario Planning\'s £2,500 floor and £30k–£48k range · Funnel\'s "£58,556 annual target" · the tier cards\' own £133 / £333 targets · the Money pages cards\' £667 / £1,667 / £833. Every one of those screens now reads groups 1–2 above.';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gbp = (n) => (n == null ? '—' : `£${Math.round(Number(n)).toLocaleString('en-GB')}`);
  const pctOf = (x) => `${Math.round((Number(x) || 0) * 1000) / 10}%`;
  const ukDay = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const num = (name, value, step = 1) => `<input type="number" step="${step}" min="0" data-target="${esc(name)}" value="${esc(value)}">`;
  const row = (label, control, hint = '') => `<div class="tp-row"><span>${label}${hint ? ` <span class="rt-sub">${hint}</span>` : ''}</span><span>${control}</span></div>`;

  function moneyCard(t) {
    const m = t.money;
    const rates = (t.per_tier || []).map((x) => `${esc(String(x.label).replace(/^\d+\.?\s*/, ''))} ${Math.round((x.gp_rate || 0) * 100)}%`).join(' · ');
    const w = t.seasonal?.weighting || [];
    const split = w.length === 12 ? MONTHS.map((mm, i) => `${mm} ${pctOf(w[i])}`).join(' · ') : '—';
    return `<div class="tp-card"><h4>1 · Money (gross profit per month)</h4>
      ${row('Survival', num('survival_gp_monthly', m.survival_monthly))}
      ${row('Stretch 1', num('stretch1_gp_monthly', m.stretch1_monthly))}
      ${row('Stretch 2', num('stretch2_gp_monthly', m.stretch2_monthly))}
      ${row('Full year', `${gbp(m.survival_annual)} · ${gbp(m.stretch1_annual)} · ${gbp(m.stretch2_annual)}`)}
      ${row('Bills line', `${gbp(m.bills_line)} a month`)}
      <p class="rt-sub"><b>GP method:</b> per-category GP rates from the Booking Sheet: ${rates}.</p>
      <p class="rt-sub"><b>Monthly split:</b> your Booking Sheet seasonal weighting: ${split}.</p></div>`;
  }

  function monthCells(values, t) {
    return (values || []).map((v, i) => `<td${i + 1 === t.this_month.month ? ' class="st-now"' : ''}>${gbp(v)}</td>`).join('');
  }
  function allMonthsTable(t) {
    const head = MONTHS.map((m, i) => `<th${i + 1 === t.this_month.month ? ' class="st-now"' : ''}>${m}</th>`).join('');
    const tiers = (t.per_tier || []).map((x) => `<tr><td class="left">${esc(x.label)}</td>${monthCells(x.gp_monthly, t)}</tr>`).join('');
    return `<details class="tp-more"><summary>All 12 months, every tier</summary><div class="st-diary-scroll"><table class="rt-table" id="st-targets-seasonal">
      <thead><tr><th class="left">GP target</th>${head}</tr></thead><tbody>
      <tr><td class="left"><b>Survival</b></td>${monthCells(t.seasonal.survival, t)}</tr>
      <tr><td class="left">Stretch 1</td>${monthCells(t.seasonal.stretch1, t)}</tr>
      <tr><td class="left">Stretch 2</td>${monthCells(t.seasonal.stretch2, t)}</tr>
      ${tiers}
      <tr><td class="left">Revenue needed for survival</td>${monthCells(t.revenue_equivalent.survival_monthly, t)}</tr>
      </tbody></table></div></details>`;
  }
  function tierCard(t) {
    const m = t.this_month.month - 1;
    const mon = MONTHS[m];
    const w = t.seasonal?.weighting?.[m];
    const rows = (t.per_tier || []).map((x) => `<tr><td class="left">${esc(String(x.label).replace(/^\d+\.?\s*/, ''))}</td><td>${pctOf(x.share)}</td><td>${Math.round((x.gp_rate || 0) * 100)}%</td><td>${gbp(x.gp_monthly?.[m])}</td></tr>`).join('');
    return `<div class="tp-card"><h4>2 · Per tier per month (worked out, not typed)</h4>
      <table class="rt-table tp-table"><thead><tr><th class="left">Tier</th><th>Share of GP</th><th>GP rate</th><th>${mon} GP target</th></tr></thead>
      <tbody>${rows}<tr class="tp-total"><td class="left"><b>Total</b></td><td>100%</td><td></td><td><b>${gbp(t.money.survival_annual)} × ${mon} ${pctOf(w)} = ${gbp(t.this_month.survival)}</b></td></tr></tbody></table>
      <p class="rt-sub">Shares come from your Booking Sheet category mix × each category's GP rate. Year to date: ${gbp(t.ytd.survival)} · revenue needed this month: ${gbp(t.revenue_equivalent.survival_monthly?.[m])}. All 12 months: below the cards.</p></div>`;
  }

  function funnelCard(t) {
    const rows = Object.entries(FUNNEL_LABELS).map(([k, [label, unit]]) => row(label, num(`funnel.${k}`, t.funnel_targets?.[k], 0.1), unit)).join('');
    return `<div class="tp-card"><h4>3 · Funnel (Pipeline &amp; Funnel KPI tiles)</h4>${rows}</div>`;
  }

  function roadmapCard(t) {
    const rows = (t.roadmap_targets || []).map((r, i) => `<tr><td class="left">${esc(r.label)}</td>${ROADMAP_FIELDS.map(([k]) => `<td>${num(`roadmap.${i}.${k}`, r[k])}</td>`).join('')}</tr>`).join('');
    const kpis = Object.entries(KPI_LABELS).map(([k, [label, unit]]) => row(label, num(`kpi.${k}`, t.kpi_targets?.[k], 1), unit)).join('');
    return `<div class="tp-card"><h4>4 · Roadmap &amp; KPIs (quarter cards, roadmap and KPI scorecard)</h4>
      <table class="rt-table tp-table" id="st-targets-roadmap"><thead><tr><th class="left">Milestone</th>${ROADMAP_FIELDS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <div class="tp-kpis">${kpis}</div></div>`;
  }

  /** 5 · Campaign channels (S3d): the agreed timetable; list size, monthly send cap and email day editable. */
  function campaignCard(t) {
    const c = t.campaign_targets;
    if (!c) return '';
    const inp = (path, v, type) => `<input data-campaign="${path}" type="${type}" value="${esc(v)}">`;
    return `<div class="tp-card tp-wide"><h4>5 · Campaign channels</h4>
      <div class="tp-three">${row('Email list size', inp('email.list_size', c.email.list_size, 'number'))}${row('Monthly send cap', inp('email.monthly_cap_sends', c.email.monthly_cap_sends, 'number'))}${row('Email day', inp('email.day', c.email.day, 'text'))}</div>
      <p class="rt-sub">Facebook + Instagram ${esc(c.facebook_instagram.days.join(' + '))} (one prep task) · LinkedIn ${esc(c.linkedin.days.join(', '))} (${esc(c.linkedin.angle)}) · YouTube: ${esc(c.youtube)} · Google Business Profile: ${esc(c.google_business_profile)} · Outlook: ${esc(c.outlook_notes)} · Light &amp; Logic folded into the week of the ${esc(c.email.light_and_logic_day)}th; Christmas email by ${esc(c.email.christmas_by)}.</p></div>`;
  }
  function collectCampaign(root, t) {
    const c = JSON.parse(JSON.stringify(t.campaign_targets || {}));
    root.querySelectorAll('[data-campaign]').forEach((el) => {
      const [g, k] = el.dataset.campaign.split('.');
      c[g] = c[g] || {};
      c[g][k] = el.type === 'number' ? Number(el.value) : el.value.trim();
    });
    return c;
  }
  function collect(root, t) {
    const body = { propertyUrl: PROP, funnel_targets: { ...(t.funnel_targets || {}) }, kpi_targets: { ...(t.kpi_targets || {}) }, roadmap_targets: (t.roadmap_targets || []).map((r) => ({ ...r })), campaign_targets: collectCampaign(root, t) };
    root.querySelectorAll('[data-target]').forEach((el) => {
      const [group, a, b] = el.dataset.target.split('.');
      const v = Number(el.value);
      if (group === 'funnel') body.funnel_targets[a] = v;
      else if (group === 'kpi') body.kpi_targets[a] = v;
      else if (group === 'roadmap') body.roadmap_targets[Number(a)][b] = v;
      else body[group] = v;
    });
    return body;
  }

  const keyNote = () => (typeof window.getAdminKey === 'function' && window.getAdminKey()
    ? 'Admin key is set in this browser.'
    : 'Admin key not set in this browser: enter it on Configuration &amp; Reporting → "Optimisation Tracking Security" first.');

  async function save(host, t) {
    const status = host.querySelector('#st-targets-status');
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) {
      status.textContent = 'Not saved: no admin key in this browser. Set it on Configuration & Reporting → "Optimisation Tracking Security" → Save Admin Key, then save again.';
      return;
    }
    status.textContent = 'Saving…';
    try {
      const r = await fetch('/api/aigeo/targets-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key },
        body: JSON.stringify(collect(host, t))
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      draw(host, j, true);
      host.querySelector('#st-targets-status').textContent = `Saved (${j.saved} targets row, ${ukDay(j.money.effective_from)}). Reload the tabs to use the new targets.`;
    } catch (e) {
      status.textContent = `Not saved: ${e.message || e}`;
    }
  }

  const STYLE = `<style>
    #st-targets .tp-head { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; margin:.6rem 0 .8rem; }
    #st-targets .tp-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }
    #st-targets .tp-card { background:#0b1118; border:1px solid #1f2937; border-radius:10px; padding:12px 14px; min-width:0; overflow-x:auto; }
    #st-targets .tp-card h4 { margin:0 0 .55rem; color:#f59e0b; font-size:.9rem; }
    #st-targets .tp-wide { grid-column:1 / -1; }
    #st-targets .tp-row { display:flex; justify-content:space-between; align-items:center; gap:.75rem; padding:5px 0; border-bottom:1px solid #1f2937; font-size:.85rem; }
    #st-targets .tp-row:last-child { border-bottom:0; }
    #st-targets .tp-row input { width:7rem; text-align:right; background:#111827; color:#e5e7eb; border:1px solid #334155; border-radius:6px; padding:3px 6px; }
    #st-targets .tp-kpis { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:1.2rem; margin-top:.6rem; }
    #st-targets .tp-three { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); column-gap:1.2rem; }
    #st-targets .tp-table { width:100%; font-size:.82rem; } #st-targets .tp-table input { width:4.6rem; text-align:right; background:#111827; color:#e5e7eb; border:1px solid #334155; border-radius:6px; padding:2px 5px; }
    #st-targets .tp-total td { border-top:1px solid #334155; }
    #st-targets .tp-more { margin-top:.5rem; } #st-targets .tp-more summary { cursor:pointer; color:#94a3b8; font-size:.82rem; }
    #st-targets .rt-sub { line-height:1.45; }
    @media (max-width:1100px) { #st-targets .tp-grid, #st-targets .tp-kpis, #st-targets .tp-three { grid-template-columns:1fr; } }
  </style>`;

  function draw(host, t, open) {
    host.innerHTML = `${STYLE}<details id="st-targets"${open ? ' open' : ''}><summary><h3 style="display:inline">Targets</h3>
        <span class="rt-sub">the one target set: Revenue, Pipeline &amp; Funnel, this tab and the Monday brief read it${t.money?.effective_from ? ` · last changed ${esc(ukDay(t.money.effective_from))}` : ''}</span></summary>
      <div class="tp-head"><span class="rt-sub">Set here once; every tab reads these. Boxes are editable.</span>
        <span><button type="button" class="rf-btn" id="st-targets-save">Save targets</button></span></div>
      <div class="tp-grid">${moneyCard(t)}${tierCard(t)}${funnelCard(t)}${roadmapCard(t)}${campaignCard(t)}</div>
      ${allMonthsTable(t)}
      <p class="rt-sub" id="st-targets-retired">${esc(RETIRED)}</p>
      <p class="rt-sub" id="st-targets-status">Saves a new targets row dated today (earlier rows kept as history). ${keyNote()}</p>
    </details>`;
    host.querySelector('#st-targets-save').addEventListener('click', () => save(host, t));
  }

  window.mountTargetsPanel = async function mountTargetsPanel(host) {
    if (!host) return;
    host.innerHTML = '<div class="rt-sub">Loading targets…</div>';
    try {
      const r = await fetch(`/api/aigeo/targets-master?propertyUrl=${encodeURIComponent(PROP)}`);
      const t = await r.json();
      if (!t.ok) throw new Error(t.error || 'Failed to load targets');
      draw(host, t, false);
    } catch (e) {
      host.innerHTML = `<div class="rt-error">Targets didn't load: ${esc(e.message || e)}</div>`;
    }
  };
})();
