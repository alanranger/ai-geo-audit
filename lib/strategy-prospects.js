/**
 * Strategy "Prospects" section (QUESTION-2026-11-09 (i)), under the Remedy plan. Tiles come from s.prospects (summary
 * aggregates, no names); enquiry rows come from GET /api/aigeo/prospects with the admin key (personal data never goes
 * through the public summary). Writes only on "+ Add enquiry" / Save (POST upsert): viewing writes nothing.
 * Weighted £ = value × stage probability, placed in the month the cash is expected.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const gbpK = (v) => (Math.abs(Number(v) || 0) >= 1000 ? `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k` : gbp(v));
  const dm = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const mon = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—');
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const STAGE = { qualify: 'Qualify', quote: 'Quote', scheduled: 'Scheduled', booked_paid: 'Booked / paid', closed_lost: 'Closed – lost' };
  const OPEN = ['qualify', 'quote', 'scheduled'];
  const TYPES = ['1-2-1', 'mentoring', 'commission', 'corporate training', 'Academy', 'voucher / gift', 'other'];
  const OWNERS = ['Alan', 'GPT', 'Claude'];
  const SOURCES = ['', 'email', 'phone', 'web form', 'referral'];
  const st = { rows: null, history: [], config: [], error: null, sort: 'cash_month', dir: 1, stage: '', type: '', q: '', lost: false, edit: null };
  const key = () => (typeof window.getAdminKey === 'function' ? window.getAdminKey() : '');
  const probs = () => Object.fromEntries((st.config || []).map((c) => [c.stage, Number(c.probability)]));
  const weighted = (e) => (OPEN.includes(e.stage) ? (Number(e.value_gbp) || 0) * (probs()[e.stage] ?? 0) : 0);
  const touchDays = (e) => {
    const t = String(e.last_touch_at || e.created_at || '').slice(0, 10);
    return t ? Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 864e5) : null;
  };
  const stalled = (e) => OPEN.includes(e.stage) && (touchDays(e) ?? 0) >= 14;

  /* ---------- tiles (summary aggregates) ---------- */

  function stageTile(t, conv) {
    const real = conv?.rates?.[t.stage];
    const rate = `${Math.round((t.probability || 0) * 100)}%${real != null ? ` · real ${real}%` : ''}`;
    const sub = t.stage === 'booked_paid' ? `${gbp(t.value)} · moves to actual sales (Booking Sheet)` : `${gbp(t.value)} value · <b>${gbp(t.weighted)} weighted</b>`;
    return `<div class="pp-tile pp-${t.stage}"><div class="pp-h"><b>${STAGE[t.stage]}</b><span class="rt-sub">${rate}</span></div><div class="pp-n">${t.count} <span class="rt-sub">${t.stage === 'booked_paid' ? 'this month' : 'enquiries'}</span></div><div class="rt-sub">${sub}</div></div>`;
  }
  function pipelineTile(p) {
    const split = (p.pipeline.by_month || []).map((m) => `${esc(m.label)} ${gbp(m.weighted)}`).join(' · ');
    return `<div class="pp-tile pp-total"><div class="pp-h"><b>Pipeline, weighted</b><span class="rt-sub">open stages</span></div><div class="pp-n">${gbp(p.pipeline.total)}</div><div class="rt-sub">${split || 'no cash months yet'} · <span class="${p.pipeline.stalled ? 'pp-amber' : ''}">${p.pipeline.stalled} stalled</span> (no action in 14 days)${p.pipeline.no_cash_month ? ` · ${p.pipeline.no_cash_month} without a cash month` : ''}</div></div>`;
  }
  function convNote(p) {
    const c = p.conversion;
    return c?.rates ? `Real conversion shown beside each assumption (${c.closed} closed); the rates are not switched automatically, Alan decides.` : `Real conversion appears once ${c?.needed ?? 20} enquiries have closed (${c?.closed ?? 0} so far).`;
  }

  /* ---------- table (admin rows) ---------- */

  const COLS = [['enquiry_ref', 'Ref'], ['enquiry_date', 'Received'], ['client', 'Client ID'], ['client_or_org', 'Enquiry'], ['type', 'Type'], ['stage', 'Stage'], ['days_open', 'Days open'], ['value_gbp', 'Value'], ['weighted', 'Weighted'], ['cash_month', 'Cash expected'], ['next_action', 'Next action'], ['owner', 'Owner'], ['last_touch_at', 'Last touch']];
  const NUM_COLS = new Set(['value_gbp', 'weighted', 'days_open']);
  const daysOpen = (e) => (OPEN.includes(e.stage) && e.enquiry_date ? Math.max(0, Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${String(e.enquiry_date).slice(0, 10)}T00:00:00Z`)) / 864e5)) : null);
  const clientOf = (e) => st.clients?.[e.person_id] || null;
  const NUM = { weighted: (e) => weighted(e), value_gbp: (e) => Number(e.value_gbp) || 0, days_open: (e) => daysOpen(e) ?? -1 };
  const valOf = (e, k) => (NUM[k] ? NUM[k](e) : String(k === 'client' ? clientOf(e)?.id || '' : e[k] ?? ''));
  function visibleRows() {
    const q = st.q.toLowerCase();
    return (st.rows || []).filter((e) => (st.lost || e.stage !== 'closed_lost') && (!st.stage || e.stage === st.stage) && (!st.type || e.type === st.type) && (!q || `${e.client_or_org} ${e.next_action || ''} ${e.notes || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const x = valOf(a, st.sort);
        const y = valOf(b, st.sort);
        return (typeof x === 'number' ? x - y : x.localeCompare(y)) * st.dir;
      });
  }
  function rowHtml(e) {
    const touch = stalled(e) ? `<span class="pp-amber">${dm(e.last_touch_at || e.created_at)} · stalled</span>` : dm(e.last_touch_at || e.created_at);
    const extra = e.stage === 'closed_lost' ? ` <span class="rt-sub">(${esc(e.lost_reason || 'no reason')})</span>` : '';
    const c = clientOf(e);
    const cid = c ? `<a href="#" data-pp-client="${esc(e.person_id)}" title="${esc(c.record_type)}: open the client record">${esc(c.id)}</a>${c.record_type === 'prospect' ? ' <span class="rt-sub">prospect</span>' : ''}` : '—';
    const open = daysOpen(e);
    return `<tr class="${stalled(e) ? 'pp-stalled' : ''}"><td class="left">${esc(e.enquiry_ref || '—')}</td><td>${dm(e.enquiry_date)}</td><td class="left">${cid}</td>`
      + `<td class="left"><b>${esc(e.client_or_org)}</b>${e.notes ? `<div class="rt-sub">${esc(e.notes)}</div>` : ''}</td><td class="left">${esc(e.type)}</td>`
      + `<td class="left"><span class="pp-chip pp-${e.stage}">${STAGE[e.stage]}</span>${extra}</td><td>${open == null ? '—' : open}</td><td>${gbp(e.value_gbp)}</td><td>${OPEN.includes(e.stage) ? gbp(weighted(e)) : '—'}</td><td>${mon(e.cash_month)}</td>`
      + `<td class="left">${esc(e.next_action || '—')}${e.next_action_date ? ` · ${dm(e.next_action_date)}` : ''}</td><td class="left">${esc(e.owner)}</td><td>${touch}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary pp-btn" data-pp-edit="${esc(e.id)}">Edit</button></td></tr>`;
  }
  const opt = (list, cur, labels = {}) => list.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(labels[v] || v || 'any')}</option>`).join('');
  function filtersHtml() {
    return `<div class="pp-filters">Stage <select data-pp-f="stage">${opt(['', ...Object.keys(STAGE)], st.stage, STAGE)}</select> Type <select data-pp-f="type">${opt(['', ...TYPES], st.type)}</select>`
      + ` <input data-pp-f="q" placeholder="search" value="${esc(st.q)}"> <label><input type="checkbox" data-pp-f="lost"${st.lost ? ' checked' : ''}> show closed-lost</label></div>`;
  }
  function tableHtml() {
    if (st.error) return `<p class="rt-sub">Enquiries unavailable: ${esc(st.error)}</p>`;
    if (!st.rows) return '<p class="rt-sub">Loading enquiries…</p>';
    const rows = visibleRows();
    const head = COLS.map(([k, l]) => `<th class="${NUM_COLS.has(k) || ['cash_month', 'last_touch_at', 'enquiry_date'].includes(k) ? '' : 'left'}" data-pp-sort="${k}" style="cursor:pointer">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = rows.map(rowHtml).join('') || `<tr><td colspan="14" class="rt-sub">${st.rows.length ? 'No enquiries match the filters.' : 'No enquiries yet: Claude loads the first list through the API; "+ Add enquiry" adds one by hand.'}</td></tr>`;
    return `<table class="rt-table pp-table"><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table><p class="rt-sub">Stalled = no touch in 14 days on Qualify / Quote / Scheduled (amber; in Needs Alan only when Alan owns the next step) · closed-lost hidden by default, reason kept.</p>`;
  }

  /* ---------- add / edit form ---------- */

  function formHtml(e) {
    const v = e || { stage: 'qualify', owner: 'Alan', type: '1-2-1' };
    const inp = (n, val, extra = '') => `<input name="${n}" value="${esc(val ?? '')}" ${extra}>`;
    return `<form class="pp-form" data-pp-form="${esc(v.id || '')}"><b>${v.id ? 'Edit enquiry' : 'Add enquiry'}</b>`
      + `<label>Received ${inp('enquiry_date', v.enquiry_date || todayIso(), 'type="date" required')}</label><label>Client / organisation ${inp('client_or_org', v.client_or_org, 'required')}</label><label title="matches an existing client by email first">Client email ${inp('client_email', '', 'type="email"')}</label><label>Type <select name="type">${opt(TYPES, v.type)}</select></label>`
      + `<label>Value £ ${inp('value_gbp', v.value_gbp ?? '', 'type="number" min="0" step="1"')}</label><label>Stage <select name="stage">${opt(Object.keys(STAGE), v.stage, STAGE)}</select></label>`
      + `<label>Cash month ${inp('cash_month', String(v.cash_month || '').slice(0, 7), 'type="month"')}</label><label>Next action ${inp('next_action', v.next_action)}</label>`
      + `<label>by ${inp('next_action_date', v.next_action_date, 'type="date"')}</label><label>Owner <select name="owner">${opt(OWNERS, v.owner)}</select></label>`
      + `<label>Source <select name="source">${opt(SOURCES, v.source || '')}</select></label><label>Notes ${inp('notes', v.notes)}</label>`
      + `<label>Lost reason ${inp('lost_reason', v.lost_reason)}</label><label title="Booked / paid only: the Booking Sheet sale">Sale date ${inp('sale_date', '', 'type="date"')}</label><label>Sale £ ${inp('sale_amount', '', 'type="number" step="0.01"')}</label>`
      + '<label><input type="checkbox" name="touch" checked> touched today</label><button type="submit" class="rf-btn">Save</button> <button type="button" class="rf-btn rf-btn-secondary" data-pp-cancel>Cancel</button> <span class="rt-sub" data-pp-msg></span></form>';
  }
  function payloadOf(form) {
    const f = Object.fromEntries(new FormData(form).entries());
    const enquiry = { enquiry_date: f.enquiry_date || null, client_email: f.client_email || undefined, client_or_org: f.client_or_org, type: f.type, value_gbp: Number(f.value_gbp || 0), stage: f.stage, cash_month: f.cash_month || null, next_action: f.next_action || null, next_action_date: f.next_action_date || null, owner: f.owner, source: f.source || null, notes: f.notes || null, lost_reason: f.lost_reason || null };
    if (form.dataset.ppForm) enquiry.id = form.dataset.ppForm;
    if (f.touch) enquiry.last_touch_at = new Date().toISOString();
    return { action: 'upsert', enquiry, ...(f.sale_date && f.sale_amount ? { matched_sale: { txn_date: f.sale_date, amount: Number(f.sale_amount) } } : {}) };
  }

  /* ---------- data ---------- */

  async function load() {
    if (!key()) { st.error = 'admin key needed to list enquiries'; return; }
    try {
      const r = await fetch('/api/aigeo/prospects', { headers: { 'x-arp-admin-key': key() } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      Object.assign(st, { rows: j.rows, history: j.history, config: j.config, clients: j.clients || {}, error: null });
    } catch (e) {
      st.error = e.message;
    }
  }
  async function save(form) {
    const msg = form.querySelector('[data-pp-msg]');
    msg.textContent = 'Saving…';
    const r = await fetch('/api/aigeo/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key() }, body: JSON.stringify(payloadOf(form)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) { msg.textContent = `Not saved: ${j.error || r.status}`; return; }
    st.edit = null;
    if (typeof window.renderStrategyTab === 'function') window.renderStrategyTab(true);
  }

  /* ---------- client record (Marketing's customer detail, admin GET; read-only) ---------- */

  const bookingLine = (b) => [b.date || b.event_date || b.txn_date, b.title || b.event || b.product || b.category, b.amount != null ? gbp(b.amount) : null].filter(Boolean).map((x) => esc(String(x).slice(0, 60))).join(' · ');
  /** The client's record: purchases (Marketing customer detail) and every enquiry they have made. */
  function clientHtml(p, personId) {
    const list = p.bookings || [];
    const others = (st.rows || []).filter((x) => x.person_id === personId).map((x) => `${esc(x.enquiry_ref)} ${esc(x.type)} · ${STAGE[x.stage]} · ${gbp(x.value_gbp)}`).join(' · ');
    const bookings = list.slice(-5).map(bookingLine).filter(Boolean).join('<br>');
    const life = p.value?.total != null ? ` · lifetime ${gbp(p.value.total)}` : '';
    return `<div class="pp-client"><b>${esc(st.clients?.[personId]?.id || '')} · ${esc(p.name || p.display_name || '—')}</b> <span class="rt-sub">${esc(p.record_type || 'person')}</span> <button type="button" class="rf-btn rf-btn-secondary pp-btn" data-pp-closeclient>Close</button>`
      + `<div class="rt-sub">Purchases: ${list.length}${life}${bookings ? `<br>${bookings}` : ''}</div><div class="rt-sub">Enquiries: ${others || 'none'}</div></div>`;
  }
  async function openClient(host, personId) {
    const box = host.querySelector('[data-pp-clientbox]');
    box.innerHTML = '<p class="rt-sub">Loading client…</p>';
    try {
      const r = await fetch(`/api/aigeo/marketing?action=customer&person_id=${encodeURIComponent(personId)}`, { headers: { 'x-arp-admin-key': key() } });
      const p = await r.json();
      if (!r.ok || p.ok === false) throw new Error(p.error || `HTTP ${r.status}`);
      box.innerHTML = clientHtml(p, personId);
    } catch (err) {
      box.innerHTML = `<p class="rt-sub">Client record unavailable: ${esc(err.message)}</p>`;
    }
    return undefined;
  }

  /* ---------- section ---------- */

  const STYLE = `<style>
    .pp-tiles { display: grid; grid-template-columns: repeat(4, 1fr) 1.3fr; gap: 0.6rem; margin: 0.5rem 0 0.8rem; }
    .pp-tile { background: #161b26; border: 1px solid #2a3142; border-top: 3px solid #6aa6ff; border-radius: 10px; padding: 0.6rem 0.8rem; font-size: 0.85rem; }
    .pp-quote { border-top-color: #8fb7ff; } .pp-scheduled { border-top-color: #a78bfa; } .pp-booked_paid { border-top-color: #5fd38d; } .pp-total { border-top-color: #f0b429; }
    .pp-h { display: flex; justify-content: space-between; } .pp-n { font-size: 1.4rem; font-weight: 700; color: #fff; }
    .pp-amber { color: #f0b429; } .pp-stalled td { background: rgba(240, 180, 41, 0.05); }
    .pp-chip { padding: 1px 7px; border-radius: 9px; font-size: 0.75rem; background: #2a3142; } .pp-chip.pp-quote { background: #23395e; } .pp-chip.pp-scheduled { background: #3b2d63; } .pp-chip.pp-booked_paid { background: #1d4a33; }
    .pp-table td { vertical-align: top; white-space: normal; } .pp-filters { margin: 0.3rem 0; font-size: 0.85rem; } .pp-filters select, .pp-filters input { margin-right: 0.5rem; }
    .pp-form { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: end; padding: 0.6rem; border: 1px solid #2a3142; border-radius: 8px; margin: 0.5rem 0; font-size: 0.82rem; }
    .pp-form label { display: flex; flex-direction: column; } .pp-btn { padding: 2px 8px; font-size: 0.75rem; } .pp-client { border: 1px solid #2a3142; border-radius: 8px; padding: 0.5rem 0.7rem; margin: 0.4rem 0; font-size: 0.85rem; }
  </style>`;
  function sectionHtml(s) {
    const p = s?.prospects;
    const intro = '<p class="rt-sub">Enquiries for 1-2-1s, mentoring, commissions, corporate training, Academy and vouchers. Weighted £ = value × stage probability, placed in the month the cash is expected (not the month the work is done). Feeds the Remedy plan\'s lever 3.</p>';
    if (!p || p.error) return `${STYLE}<h3>Prospects: non-dated work in the pipeline</h3>${intro}<p class="rt-sub">Pipeline unavailable: ${esc(p?.error || 'not in the strategy summary')}</p>`;
    const tiles = `<div class="pp-tiles">${p.tiles.map((t) => stageTile(t, p.conversion)).join('')}${pipelineTile(p)}</div>`;
    return `${STYLE}<h3>Prospects: non-dated work in the pipeline <button type="button" class="rf-btn pp-btn" data-pp-add>+ Add enquiry</button></h3>${intro}${tiles}<p class="rt-sub">${convNote(p)}${p.booked_unmatched ? ` · <span class="pp-amber">${p.booked_unmatched} booked / paid not yet matched to a Booking Sheet sale</span>` : ''}</p>`
      + `<div data-pp-formhost>${st.edit !== null ? formHtml(st.edit) : ''}</div>${st.rows ? filtersHtml() : ''}<div data-pp-clientbox></div><div data-pp-table>${tableHtml()}</div>`;
  }
  function repaint(host, s) {
    if (host.isConnected) host.innerHTML = sectionHtml(s);
  }
  function onClick(host, s, e) {
    const t = e.target;
    if (t.closest('[data-pp-add]')) { st.edit = {}; return repaint(host, s); }
    if (t.closest('[data-pp-cancel]')) { st.edit = null; return repaint(host, s); }
    if (t.closest('[data-pp-closeclient]')) { host.querySelector('[data-pp-clientbox]').innerHTML = ''; return undefined; }
    const cl = t.closest('[data-pp-client]');
    if (cl) { e.preventDefault(); return openClient(host, cl.dataset.ppClient); }
    const ed = t.closest('[data-pp-edit]');
    if (ed) { st.edit = (st.rows || []).find((r) => r.id === ed.dataset.ppEdit) || null; return repaint(host, s); }
    const so = t.closest('[data-pp-sort]');
    if (so) { st.dir = st.sort === so.dataset.ppSort ? -st.dir : 1; st.sort = so.dataset.ppSort; repaint(host, s); }
    return undefined;
  }
  function onFilter(host, s, e) {
    const f = e.target.dataset.ppF;
    if (!f) return;
    st[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    host.querySelector('[data-pp-table]').innerHTML = tableHtml();
  }
  /** Mount into #st-prospects: tiles straight away, rows after the admin GET. */
  window.stMountProspects = function stMountProspects(host, s) {
    if (!host) return;
    repaint(host, s);
    host.addEventListener('click', (e) => onClick(host, s, e));
    host.addEventListener('change', (e) => onFilter(host, s, e));
    host.addEventListener('input', (e) => { if (e.target.dataset.ppF === 'q') onFilter(host, s, e); });
    host.addEventListener('submit', (e) => { e.preventDefault(); save(e.target); });
    load().then(() => repaint(host, s));
  };
  window.stProspectsParts = { sectionHtml, stageTile, pipelineTile, visibleRows, payloadOf, state: st };
})();
