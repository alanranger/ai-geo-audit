/**
 * Strategy & Actions campaign layer (browser): per-event promotion switch, campaign records with stage chips and results.
 * Writes POST /api/aigeo/strategy-campaigns (admin key): strategy_event_overrides / strategy_campaigns.
 * A weekly email moved to "sent" also ticks the moments it covers (strategy_campaign_ticks).
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const STAGES = ['proposed', 'drafted', 'verified', 'approved', 'scheduled', 'sent', 'measured'];
  const SIDE = ['blocked', 'cancelled'];
  const LABEL = { proposed: 'Proposed', drafted: 'Drafted', verified: 'Verified', approved: 'Approved by Alan', scheduled: 'Scheduled', sent: 'Sent / published', measured: 'Measured', blocked: 'Blocked', cancelled: 'Cancelled' };
  const MODE_LABEL = { normal: 'Normal', dont_promote: "Don't promote", weekly: 'Weekly until the date' };
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const data = () => (window.stLastData ? window.stLastData() : null);
  const campaign = () => data()?.campaign || null;

  function urlPath(u) {
    const s = String(u || '').trim().toLowerCase();
    return s ? s.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '') : '';
  }
  const eventKeyOf = (e) => `${String(e?.date || '').slice(0, 10)}|${urlPath(e?.url) || norm(e?.title).slice(0, 40)}`;

  /* ---------- promotion switch ---------- */

  function overrideSummary(o) {
    if (!o) return '';
    const bits = [];
    if (o.promote_mode && o.promote_mode !== 'normal') bits.push(MODE_LABEL[o.promote_mode]);
    if (o.offer_note && (!o.offer_ends || o.offer_ends >= new Date().toISOString().slice(0, 10))) bits.push(`Offer${o.offer_ends ? ` to ${o.offer_ends}` : ''}`);
    return bits.join(' · ');
  }
  window.stOverrideHtml = function stOverrideHtml(e) {
    if (!e?.date || !campaign()) return '';
    const key = eventKeyOf(e);
    const o = campaign().overrides?.[key];
    const sum = overrideSummary(o);
    const ev = esc(JSON.stringify({ key, date: String(e.date).slice(0, 10), title: e.title || '', url: e.url || '' }));
    return ` <button type="button" class="st-ov-btn" data-ov="${ev}" title="Promotion switch for this event">${sum ? esc(sum) : 'Promote ▾'}</button>`;
  };
  window.stOfferHtml = function stOfferHtml(offer) {
    if (!offer?.note) return '';
    return ` <span class="st-offer">${esc(offer.note)}${offer.code ? ` · code ${esc(offer.code)}` : ''}${offer.ends ? ` · until ${esc(offer.ends)}` : ''}</span>`;
  };

  function popHtml(ev, o) {
    const mode = o?.promote_mode || 'normal';
    const radio = (m) => `<label><input type="radio" name="st-ov-mode" value="${m}" ${mode === m ? 'checked' : ''}> ${MODE_LABEL[m]}</label>`;
    const who = o?.set_at ? `<p class="rt-sub">Set by ${esc(o.set_by || '—')} on ${esc(String(o.set_at).slice(0, 16).replace('T', ' '))}. Clears itself after ${esc(ev.date)}.</p>` : `<p class="rt-sub">Clears itself after ${esc(ev.date)}. Nothing changes on the website or in Squarespace.</p>`;
    return `<h4>${esc(ev.title)} <span class="rt-sub">(${esc(ev.date)})</span></h4>`
      + `<div class="st-ov-modes">${['normal', 'dont_promote', 'weekly'].map(radio).join('')}</div>`
      + `<label class="st-ov-f">Offer note <input type="text" id="st-ov-note" maxlength="300" value="${esc(o?.offer_note || '')}" placeholder="e.g. 30% off, £105, book by Sun 8 Nov"></label>`
      + `<label class="st-ov-f">Code <input type="text" id="st-ov-code" maxlength="40" value="${esc(o?.offer_code || '')}"></label>`
      + `<label class="st-ov-f">Offer ends <input type="date" id="st-ov-ends" value="${esc(o?.offer_ends || '')}"></label>`
      + `${who}<div class="st-ov-actions"><button type="button" class="rf-btn" id="st-ov-save">Save</button> <button type="button" class="rf-btn rf-btn-secondary" id="st-ov-close">Close</button> <span class="rt-sub" id="st-ov-status">Saves to strategy_event_overrides. Needs the admin key.</span></div>`;
  }
  let popEvent = null;
  function openPop(btn) {
    popEvent = JSON.parse(btn.getAttribute('data-ov'));
    let pop = document.getElementById('st-ov-pop');
    if (!pop) { pop = document.createElement('div'); pop.id = 'st-ov-pop'; document.body.appendChild(pop); }
    pop.innerHTML = popHtml(popEvent, campaign()?.overrides?.[popEvent.key]);
    const r = btn.getBoundingClientRect();
    pop.style.top = `${window.scrollY + r.bottom + 4}px`;
    pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 380))}px`;
    pop.hidden = false;
  }

  async function post(body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) throw new Error('Not saved: no admin key in this browser. Set it on Configuration & Reporting → "Optimisation Tracking Security" → Save Admin Key.');
    const r = await fetch('/api/aigeo/strategy-campaigns', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key },
      body: JSON.stringify({ propertyUrl: PROP, ...body })
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `Not saved (${r.status})`);
    return j;
  }
  async function saveOverride() {
    const status = document.getElementById('st-ov-status');
    const mode = document.querySelector('input[name="st-ov-mode"]:checked')?.value || 'normal';
    try {
      status.textContent = 'Saving…';
      await post({
        type: 'override', event_key: popEvent.key, event_date: popEvent.date, event_title: popEvent.title, event_url: popEvent.url,
        promote_mode: mode, offer_note: document.getElementById('st-ov-note').value, offer_code: document.getElementById('st-ov-code').value,
        offer_ends: document.getElementById('st-ov-ends').value || null
      });
      status.textContent = 'Saved. Updating the plan…';
      if (typeof window.stRefreshSummary === 'function') await window.stRefreshSummary();
      document.getElementById('st-ov-pop').hidden = true;
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  }

  /* ---------- campaign records ---------- */

  function nextStage(s) {
    const i = STAGES.indexOf(s);
    if (i < 0) return 'proposed';
    return STAGES[Math.min(i + 1, STAGES.length - 1)];
  }
  window.stStageChip = function stStageChip(rec) {
    if (!rec) return '';
    const s = rec.stage || 'proposed';
    const last = s === 'measured';
    const opts = [...STAGES, ...SIDE].map((x) => `<option value="${x}" ${x === s ? 'selected' : ''}>${LABEL[x]}</option>`).join('');
    return `<span class="st-stage-wrap"><button type="button" class="st-stage st-stage-${s}" data-stage-key="${esc(rec.campaign_key)}" ${last ? 'disabled' : ''} title="${last ? 'Final stage' : `Move on to ${LABEL[nextStage(s)]}`}">${LABEL[s]}${last ? '' : ' →'}</button>`
      + `<select class="st-stage-sel" data-stage-key="${esc(rec.campaign_key)}" aria-label="Set stage">${opts}</select></span>`;
  };
  function resultsHtml(r) {
    if (!r) return '<span class="rt-sub">—</span>';
    return `<div title="${esc(r.sales_basis)}">${r.bookings} booking${r.bookings === 1 ? '' : 's'} · ${gbp(r.revenue)} <span class="rt-sub">(inferred)</span></div>`
      + `<div title="${esc(r.sessions_basis)}">${r.sessions} tagged sessions <span class="rt-sub">(measured)</span></div>`
      + `<div class="rt-sub" title="${esc(r.enquiries)}; ${esc(r.email_stats)}">Enquiries, bounces: not available</div>`;
  }
  const KIND = { weekly_email: 'Weekly email', event: 'Event', theme: 'Theme' };
  function stepsCell(rec) {
    const parts = (rec.steps || []).map((s) => `${esc(s.channel)} ${esc(s.day.slice(5))}`);
    const mods = rec.modules?.length ? `<details><summary class="rt-sub">${rec.modules.length} module${rec.modules.length === 1 ? '' : 's'}</summary>${rec.modules.map(esc).join('<br>')}</details>` : '';
    return (parts.join('<br>') || '<span class="rt-sub">Mentions in the weekly email</span>') + mods;
  }
  function recordRow(rec) {
    const offer = rec.offer ? window.stOfferHtml(rec.offer) : '';
    return `<tr data-campaign="${esc(rec.campaign_key)}"><td class="left">${esc(rec.title)}${offer}<div class="rt-sub">utm_campaign=${esc(rec.utm_campaign || '')}</div></td>`
      + `<td>${KIND[rec.kind] || esc(rec.kind)}</td><td>${esc(rec.window_start || '—')} → ${esc(rec.window_end || '—')}</td>`
      + `<td class="left">${stepsCell(rec)}</td><td>${window.stStageChip(rec)}</td><td class="left">${resultsHtml(rec.results)}</td></tr>`;
  }
  function themeForm(c) {
    const cats = Object.entries(c.category_labels || {}).map(([n, l]) => `<label><input type="checkbox" class="st-th-cat" value="${esc(n)}"> ${esc(l)}</label>`).join(' ');
    return `<details class="st-th"><summary>Add a theme campaign (e.g. Christmas vouchers)</summary>`
      + `<label class="st-ov-f">Title <input type="text" id="st-th-title" maxlength="200"></label> <label class="st-ov-f">From <input type="date" id="st-th-from"></label> <label class="st-ov-f">To <input type="date" id="st-th-to"></label>`
      + `<div class="st-th-cats">Booking Sheet categories for results: ${cats || '<span class="rt-sub">none loaded</span>'}</div>`
      + `<button type="button" class="rf-btn" id="st-th-save">Add theme</button> <span class="rt-sub" id="st-th-status">Saves to strategy_campaigns. Needs the admin key.</span></details>`;
  }
  window.stCampaignRecordsHtml = function stCampaignRecordsHtml(c) {
    const recs = (c?.campaigns || []).filter((r) => r.stage !== 'cancelled' || r.stored);
    return `<h4 id="st-campaign-records-h">Campaigns: stages &amp; results</h4>`
      + `<p class="rt-sub">One record per campaign: one weekly email per week (all its modules), one per promoted event, plus themes. Click the stage to move it on; use the list for blocked / cancelled. Bookings and £ are inferred (Booking Sheet booking date inside the window); sessions are measured from the tagged links in the Brief.</p>`
      + `<div class="st-diary-scroll"><table class="rt-table" id="st-campaign-records"><thead><tr><th class="left">Campaign</th><th>Kind</th><th>Window</th><th class="left">Steps</th><th>Stage</th><th class="left">Results</th></tr></thead>`
      + `<tbody>${recs.map(recordRow).join('') || '<tr><td colspan="6" class="rt-sub">No campaigns in these weeks.</td></tr>'}</tbody></table></div>${themeForm(c)}`;
  };

  function sendsLocal(c) {
    const month = new Date().toISOString().slice(0, 7);
    const sent = c.campaigns.filter((r) => r.kind === 'weekly_email' && (r.stage === 'sent' || r.stage === 'measured') && String(r.send_day || r.window_start || '').startsWith(month)).length;
    c.sends = { ...c.sends, emails_sent: sent, sends: sent * c.sends.list_size };
  }
  async function tickCovers(rec) {
    if (!rec.covers?.length) return;
    await fetch('/api/aigeo/strategy-ticks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyUrl: PROP, keys: rec.covers.slice(0, 100), is_ticked: true }) });
    const now = new Date().toISOString();
    rec.covers.forEach((k) => { campaign().ticks[k] = { is_ticked: true, ticked_at: now }; });
  }
  async function setStage(key, stage, el) {
    const c = campaign();
    const rec = c?.campaigns?.find((r) => r.campaign_key === key);
    if (!rec) return;
    el.disabled = true;
    try {
      const j = await post({ type: 'stage', campaign_key: rec.campaign_key, kind: rec.kind, title: rec.title, event_key: rec.event_key || null, window_start: rec.window_start, window_end: rec.window_end, categories: rec.categories || null, stage });
      Object.assign(rec, { stage, stage_history: j.stage_history, stored: true });
      if (rec.kind === 'weekly_email' && stage === 'sent') await tickCovers(rec);
      sendsLocal(c);
      window.stRepaintBoard?.();
    } catch (err) {
      el.disabled = false;
      el.insertAdjacentHTML('afterend', `<span class="st-err">${esc(err.message || String(err))}</span>`);
    }
  }
  async function saveTheme() {
    const status = document.getElementById('st-th-status');
    try {
      status.textContent = 'Saving…';
      await post({ type: 'theme', title: document.getElementById('st-th-title').value, window_start: document.getElementById('st-th-from').value, window_end: document.getElementById('st-th-to').value || null, categories: [...document.querySelectorAll('.st-th-cat:checked')].map((i) => Number(i.value)) });
      status.textContent = 'Saved. Updating…';
      await window.stRefreshSummary?.();
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  }

  const CLICK = [
    ['.st-ov-btn', (el) => openPop(el)],
    ['#st-ov-save', () => saveOverride()],
    ['#st-ov-close', () => { document.getElementById('st-ov-pop').hidden = true; }],
    ['.st-stage', (el) => setStage(el.getAttribute('data-stage-key'), nextStage(campaign()?.campaigns?.find((r) => r.campaign_key === el.getAttribute('data-stage-key'))?.stage), el)],
    ['#st-th-save', () => saveTheme()]
  ];
  document.addEventListener('click', (e) => {
    for (const [sel, fn] of CLICK) {
      const el = e.target.closest?.(sel);
      if (el) { fn(el); return; }
    }
  });
  document.addEventListener('change', (e) => {
    const sel = e.target.closest?.('.st-stage-sel');
    if (sel) setStage(sel.getAttribute('data-stage-key'), sel.value, sel);
  });
  window.stEventKeyOf = eventKeyOf;
})();
