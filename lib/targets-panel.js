/**
 * Targets panel (Strategy & Actions, collapsed at the bottom): the one target set every tab and the Monday brief
 * read. Loads and saves GET/POST /api/aigeo/targets-master; a save writes one business_targets row dated today.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FUNNEL_LABELS = {
    ctr_28d_pct: 'Search CTR, 28 days (%)',
    money_page_click_share_pct: 'Money-page share of clicks (%)',
    click_to_sale_pct: 'Click → sale (%)',
    enquiry_to_sale_pct: 'Enquiry → sale (%)',
    revenue_per_1k_impressions: 'Revenue per 1,000 impressions (£)'
  };
  const ROADMAP_FIELDS = [['plans', 'Plans'], ['beginners_non_jlr', 'Non-JLR beginners'], ['returning_r12', 'Returning £ (R12)'], ['gp_t3', 'GP avg (T3m) £']];
  const KPI_LABELS = {
    beginners_seats_pct: 'Beginners seats filled (≥ %)',
    residential_avg: 'Residential average booked (≥)',
    plan_conversion_pct: 'Plan conversion ≤60 days (%)',
    plans_active: 'Plans active',
    plan_reviews_pct: 'Plan reviews held (%)',
    plan_discount_max_pct: 'Plan discount cost (max %)',
    plan_credit_pace_band_pct: 'Plan credit vs pace (± %)',
    plan_renewals_pct: 'Plan renewals (%)',
    returning_r12_gbp: 'Returning-client revenue R12 (£)'
  };
  const RETIRED = 'Retired: Scenario Planning\'s £2,500 floor and £30k–£48k range · Funnel\'s "£58,556 annual target" · the tier cards\' own £133 / £333 targets · the Money pages cards\' £667 / £1,667 / £833. Every one of those screens now reads groups 1–2 above.';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gbp = (n) => (n == null ? '—' : `£${Math.round(Number(n)).toLocaleString('en-GB')}`);
  const num = (name, value, step = 1) => `<input type="number" step="${step}" min="0" data-target="${esc(name)}" value="${esc(value)}" style="width:6.5rem;">`;

  function monthHead(t) {
    return MONTHS.map((m, i) => `<th${i + 1 === t.this_month.month ? ' class="st-now"' : ''}>${m}</th>`).join('');
  }

  function monthCells(values, t) {
    return (values || []).map((v, i) => `<td${i + 1 === t.this_month.month ? ' class="st-now"' : ''}>${gbp(v)}</td>`).join('');
  }

  function moneyGroup(t) {
    const m = t.money;
    const rates = Object.entries(t.gp_rates || {}).map(([o, r]) => `${o}: ${Math.round(r * 100)}%`).join(' · ');
    return `<h4>1 · Money: GP a month</h4>
      <div class="st-filters">
        <label>Survival ${num('survival_gp_monthly', m.survival_monthly)}</label>
        <label>Stretch ${num('stretch1_gp_monthly', m.stretch1_monthly)}</label>
        <label>Stretch ${num('stretch2_gp_monthly', m.stretch2_monthly)}</label>
      </div>
      <div class="rt-sub">Full year: survival ${gbp(m.survival_annual)} · stretch ${gbp(m.stretch1_annual)} / ${gbp(m.stretch2_annual)}. Flat bills line ${gbp(m.bills_line)} a month.
        GP method: per-category rates (${esc(t.sources.gp_rates)}): ${esc(rates)}.</div>`;
  }

  function seasonalGroup(t) {
    const tierRows = (t.per_tier || []).map((x) => `<tr><td class="left">${esc(x.label)} <span class="rt-sub">${Math.round(x.share * 100)}% of GP · ${Math.round((x.gp_rate || 0) * 100)}% rate</span></td>${monthCells(x.gp_monthly, t)}</tr>`).join('');
    return `<h4>2 · Each month and each tier (worked out, not typed)</h4>
      <div class="rt-sub">Month = full-year target × the Booking Sheet's monthly weighting (${esc(t.sources.pattern)}). Tier = its share of GP from the Booking Sheet category mix × GP rate.
        This month: survival ${gbp(t.this_month.survival)} · year to date ${gbp(t.ytd.survival)}.</div>
      <div class="st-diary-scroll"><table class="rt-table" id="st-targets-seasonal">
        <thead><tr><th class="left">GP target</th>${monthHead(t)}</tr></thead>
        <tbody>
          <tr><td class="left"><b>Survival</b></td>${monthCells(t.seasonal.survival, t)}</tr>
          <tr><td class="left">Stretch ${gbp(t.money.stretch1_monthly)}</td>${monthCells(t.seasonal.stretch1, t)}</tr>
          <tr><td class="left">Stretch ${gbp(t.money.stretch2_monthly)}</td>${monthCells(t.seasonal.stretch2, t)}</tr>
          ${tierRows}
          <tr><td class="left">Revenue needed for survival</td>${monthCells(t.revenue_equivalent.survival_monthly, t)}</tr>
        </tbody>
      </table></div>`;
  }

  function funnelGroup(t) {
    const fields = Object.entries(FUNNEL_LABELS).map(([k, label]) => `<label>${esc(label)} ${num(`funnel.${k}`, t.funnel_targets?.[k], 0.1)}</label>`).join('');
    return `<h4>3 · Funnel targets</h4><div class="st-filters">${fields}</div>`;
  }

  function roadmapGroup(t) {
    const rows = (t.roadmap_targets || []).map((r, i) => `<tr><td class="left">${esc(r.label)}</td>${ROADMAP_FIELDS.map(([k]) => `<td>${num(`roadmap.${i}.${k}`, r[k])}</td>`).join('')}</tr>`).join('');
    const kpis = Object.entries(KPI_LABELS).map(([k, label]) => `<label>${esc(label)} ${num(`kpi.${k}`, t.kpi_targets?.[k], 1)}</label>`).join('');
    return `<h4>4 · Roadmap &amp; KPI targets</h4>
      <table class="rt-table" id="st-targets-roadmap"><thead><tr><th class="left">Milestone</th>${ROADMAP_FIELDS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
      <div class="st-filters" id="st-targets-kpi">${kpis}</div>
      <p class="rt-sub">The KPI scorecard and the quarter cards read these.</p>`;
  }

  /** 5 · Campaign channels (S3d): the agreed timetable; list size, monthly send cap and email day editable. */
  function campaignGroup(t) {
    const c = t.campaign_targets;
    if (!c) return '';
    const inp = (path, v, type) => `<input data-campaign="${path}" type="${type}" value="${esc(v)}" style="width:6rem">`;
    return `<h4>5 · Campaign channels</h4>
      <div class="st-filters"><label>Email list size ${inp('email.list_size', c.email.list_size, 'number')}</label>
        <label>Monthly send cap ${inp('email.monthly_cap_sends', c.email.monthly_cap_sends, 'number')}</label>
        <label>Email day ${inp('email.day', c.email.day, 'text')}</label></div>
      <p class="rt-sub">Facebook + Instagram ${esc(c.facebook_instagram.days.join(' + '))} (one prep task) · LinkedIn ${esc(c.linkedin.days.join(', '))} (${esc(c.linkedin.angle)}) · YouTube: ${esc(c.youtube)} · Google Business Profile: ${esc(c.google_business_profile)} · Outlook: ${esc(c.outlook_notes)} · Light &amp; Logic folded into the week of the ${esc(c.email.light_and_logic_day)}th; Christmas email by ${esc(c.email.christmas_by)}.</p>`;
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
        headers: { 'Content-Type': 'application/json', ...(key ? { 'x-arp-admin-key': key } : {}) },
        body: JSON.stringify(collect(host, t))
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      draw(host, j, true);
      host.querySelector('#st-targets-status').textContent = `Saved (${j.saved} business_targets row ${j.money.effective_from}). Reload the tabs to use the new targets.`;
    } catch (e) {
      status.textContent = `Not saved: ${e.message || e}`;
    }
  }

  function draw(host, t, open) {
    host.innerHTML = `<details id="st-targets"${open ? ' open' : ''}><summary><h3 style="display:inline">Targets</h3>
        <span class="rt-sub">the one target set: Revenue, Pipeline &amp; Funnel, this tab and the Monday brief read it${t.money?.effective_from ? ` · last changed ${esc(t.money.effective_from)}` : ''}</span></summary>
      ${moneyGroup(t)}${seasonalGroup(t)}${funnelGroup(t)}${roadmapGroup(t)}${campaignGroup(t)}
      <p class="rt-sub" id="st-targets-retired">${esc(RETIRED)}</p>
      <div class="st-filters" style="margin-top:0.75rem;"><button type="button" class="rf-btn" id="st-targets-save">Save targets</button>
        <span class="rt-sub" id="st-targets-status">Saves to business_targets (one row dated today; earlier rows kept as history). ${typeof window.getAdminKey === 'function' && window.getAdminKey() ? 'Admin key is set in this browser.' : 'Admin key not set in this browser: enter it on Configuration &amp; Reporting → "Optimisation Tracking Security" first.'}</span></div>
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
