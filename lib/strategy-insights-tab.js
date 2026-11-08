/**
 * Strategy & Actions "Where we stand and why" tiles (top of the tab): one-line summary, then MONEY · DEMAND &
 * FULFILMENT · MIX & GROWTH (4 tiles each). Data: strategy-summary `insights` (lib/strategy-insights/*). Red only
 * when behind; every tile shows its window, source and freshness.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const stamp = (iso) => {
    if (!iso) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  };
  const ROWS = [['money', 'Money'], ['demand', 'Demand & fulfilment'], ['mix', 'Mix & growth']];

  const td = (c, i) => `<td class="${i === 0 ? 'left' : ''}${c.muted ? ' si-muted' : ''}${c.bold ? ' si-bold' : ''}${c.wrap ? ' si-wrap' : ''}"${c.title ? ` title="${esc(c.title)}"` : ''}>${c.rag && c.rag !== 'grey' ? `<span class="si-rag si-${c.rag}">${esc(c.v)}</span>` : esc(c.v)}</td>`;
  const tr = (r) => `<tr>${r.map(td).join('')}</tr>`;
  function tableHtml(t) {
    if (!t) return '';
    const head = `<thead><tr>${t.cols.map((c, i) => `<th class="${i === 0 ? 'left' : ''}">${esc(c)}</th>`).join('')}</tr></thead>`;
    const body = t.sections
      ? t.sections.map((s) => `${s.head ? `<tr class="si-sec"><td colspan="${t.cols.length}">${esc(s.head)}</td></tr>` : ''}${s.rows.map(tr).join('')}`).join('')
      : t.rows.map(tr).join('');
    return `<table class="si-table${t.cols.length > 5 ? ' si-dense' : ''}">${head}<tbody>${body}</tbody></table>${t.footnote ? `<div class="si-foot">${esc(t.footnote)}</div>` : ''}`;
  }
  const boxHtml = (b) => `<div class="si-box si-box-${esc(b.rag || 'grey')}"><div class="si-box-l">${esc(b.label)}${b.estimated ? ' <span class="si-est">estimate</span>' : ''}</div><div class="si-box-v">${esc(b.value)}</div><div class="si-box-s">${esc(b.sub)}</div></div>`;
  function linkHtml(l) {
    if (!l) return '';
    const attr = l.panel ? `data-si-panel="${esc(l.panel)}"` : `data-si-anchor="${esc(l.anchor)}"`;
    return `<a href="#" class="si-link" ${attr}>${esc(l.label)}</a>`;
  }
  function tileRag(t) {
    return t.headRag || t.headline?.delta?.rag || t.headline?.rag || 'grey';
  }

  /* ---------- "Record what happened" on the events tile → /api/aigeo/strategy-event-outcomes ---------- */
  const PROP = 'https://www.alanranger.com';
  const REASONS = [['low_bookings', 'Low bookings'], ['weather', 'Weather'], ['leader_unavailable', 'Leader unavailable'], ['venue', 'Venue'], ['other', 'Other (add a note)']];
  const BOOKINGS = [['', '— not set —'], ['transferred', 'Transferred'], ['refunded', 'Refunded'], ['credit_held', 'Credit held'], ['mixed', 'Mixed']];
  let recOutcomes = new Map();
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${v === (sel || '') ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const shortTitle = (t) => String(t || '').split(/[|–-]/)[0].trim();
  const eventLabel = (o) => `${stamp(o.date)} · ${shortTitle(o.title)} · ${o.recorded ? 'cancelled (recorded)' : o.outcome}${o.mismatch ? ' · needs a record' : ''}`;
  const numIn = (id, label, v) => `<label class="si-rec-f si-rec-n">${esc(label)} <input type="number" min="0" max="99" id="${id}" value="${v ?? ''}" placeholder="blank"></label>`;

  function recordFields(o) {
    const r = o?.record || {};
    return `<label class="si-rec-f"><input type="checkbox" id="si-rec-cx"${o?.outcome === 'ran' && !o?.recorded ? '' : ' checked'}> Cancelled</label>
      <label class="si-rec-f">Reason <select id="si-rec-reason">${opts(REASONS, r.reason || 'low_bookings')}</select></label>
      <label class="si-rec-f">Note <input type="text" id="si-rec-note" maxlength="300" value="${esc(r.reason_note || '')}" placeholder="e.g. moved to Sun 25 Oct, then cancelled"></label>
      <label class="si-rec-f">Bookings <select id="si-rec-books">${opts(BOOKINGS, r.bookings_outcome)}</select></label>
      ${transferFields(r)}
      <div class="si-rec-row">${numIn('si-rec-tc', 'Transferred', r.transferred_count)}${numIn('si-rec-rc', 'Refunded', r.refunded_count)}${numIn('si-rec-cc', 'Credit held', r.credit_held_count)}</div>
      <label class="si-rec-f">Credit used on <input type="date" id="si-rec-used" value="${esc(r.credit_used_on || '')}"> <span class="si-rec-who">${r.credit_linked ? 'credit linked to a person (kept on save)' : 'no person linked'}</span></label>
      <label class="si-rec-f">Bookings note <input type="text" id="si-rec-bnote" maxlength="400" value="${esc(r.bookings_note || '')}"></label>
      <div class="si-rec-who">${r.set_by ? `Last set by ${esc(r.set_by)} · ${esc(stamp(r.set_at))}` : 'No record yet.'} Counts: leave blank when not evidenced.</div>`;
  }

  /** The first transfer is editable; any further transfers on the record are kept as they are. */
  function transferFields(r) {
    const first = (r.transfers || [])[0] || { title: r.transferred_to_title, date: r.transferred_to_date, count: r.transferred_count };
    const more = (r.transfers || []).slice(1);
    return `<label class="si-rec-f">Transferred to <input type="text" id="si-rec-to" maxlength="200" value="${esc(first.title || '')}" placeholder="event"> <input type="date" id="si-rec-todate" value="${esc(first.date || '')}"> how many <input type="number" min="0" max="99" id="si-rec-tocount" class="si-rec-num" value="${first.count ?? ''}" placeholder="blank"></label>
      ${more.length ? `<div class="si-rec-who">Also transferred (kept): ${more.map((t) => `${esc(shortTitle(t.title))} ${esc(stamp(t.date))}${t.count != null ? ` (${esc(t.count)})` : ''}`).join('; ')}</div>` : ''}`;
  }

  function recordEditorHtml(outcomes) {
    const list = (outcomes || []).filter((o) => o.key).sort((a, b) => (a.date < b.date ? 1 : -1));
    recOutcomes = new Map(list.map((o) => [o.key, o]));
    if (!list.length) return '';
    const first = list.find((o) => o.mismatch) || list[0];
    return `<details class="si-rec"><summary>Record what happened</summary>
      <label class="si-rec-f">Event <select id="si-rec-event">${list.map((o) => `<option value="${esc(o.key)}"${o === first ? ' selected' : ''}>${esc(eventLabel(o))}</option>`).join('')}</select></label>
      <div id="si-rec-fields">${recordFields(first)}</div>
      <div class="si-rec-actions"><button type="button" class="rf-btn" id="si-rec-save">Save</button> <span class="si-rec-who" id="si-rec-status">Saves to strategy_event_outcomes (logged). Never changes the Booking Sheet or the website.</span></div>
    </details>`;
  }

  const val = (id) => document.getElementById(id)?.value ?? '';
  function recordBody() {
    const o = recOutcomes.get(val('si-rec-event'));
    const first = val('si-rec-todate') ? [{ title: val('si-rec-to'), date: val('si-rec-todate'), count: val('si-rec-tocount') }] : [];
    return {
      propertyUrl: PROP, run_key: o?.key, event_title: o?.title, cancelled: !!document.getElementById('si-rec-cx')?.checked,
      reason: val('si-rec-reason'), reason_note: val('si-rec-note'), bookings_outcome: val('si-rec-books') || null, bookings_note: val('si-rec-bnote'),
      transfers: [...first, ...(o?.record?.transfers || []).slice(1)], credit_used_on: val('si-rec-used') || null,
      transferred_count: val('si-rec-tc'), refunded_count: val('si-rec-rc'), credit_held_count: val('si-rec-cc')
    };
  }

  async function saveRecord() {
    const status = document.getElementById('si-rec-status');
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) { status.textContent = 'Not saved: no admin key in this browser. Set it on Configuration & Reporting → "Optimisation Tracking Security" → Save Admin Key.'; return; }
    try {
      status.textContent = 'Saving…';
      const r = await fetch('/api/aigeo/strategy-event-outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: JSON.stringify(recordBody()) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || `Not saved (${r.status})`);
      status.textContent = 'Saved. Updating the figures…';
      if (typeof window.stRefreshSummary === 'function') await window.stRefreshSummary();
    } catch (err) {
      status.textContent = err.message || String(err);
    }
  }
  document.addEventListener('change', (e) => {
    if (e.target?.id !== 'si-rec-event') return;
    const host = document.getElementById('si-rec-fields');
    if (host) host.innerHTML = recordFields(recOutcomes.get(e.target.value));
  });
  document.addEventListener('click', (e) => {
    if (e.target?.id === 'si-rec-save') saveRecord();
  });
  function tileHtml(t) {
    const h = t.headline || {};
    const delta = h.delta ? ` <span class="si-delta si-${esc(h.delta.rag)}">${esc(h.delta.text)}</span>` : '';
    return `<div class="si-tile si-edge-${esc(tileRag(t))}" data-si-key="${esc(t.key)}">
      <h4 class="si-title">${esc(t.title)}</h4>
      <div class="si-head"><span class="si-val${h.rag ? ` si-${esc(h.rag)}` : ''}">${esc(h.value)}</span> <span class="si-lab">${esc(h.label || '')}</span>${delta}</div>
      <div class="si-cmp">${esc(t.comparison || '')}</div>
      ${t.boxes ? `<div class="si-boxes">${t.boxes.map(boxHtml).join('')}</div>` : ''}
      ${tableHtml(t.table)}${tableHtml(t.table2)}
      ${t.note ? `<p class="si-note">${esc(t.note)}</p>` : ''}
      ${t.scenario ? `<p class="si-note si-scenario">${esc(t.scenario)}</p>` : ''}
      ${t.foot ? `<div class="si-foot">${esc(t.foot)}</div>` : ''}
      ${t.key === 'demand-runs' ? recordEditorHtml(t.outcomes) : ''}
      ${linkHtml(t.link)}
      <div class="si-src">${esc(t.source || '')} · ${esc(t.freshness_label || 'Booking Sheet imported')} ${esc(stamp(t.freshness))}</div>
    </div>`;
  }

  const STYLE = `<style>
    #st-insights .si-summary { background: #0b1118; border: 1px solid var(--dark-border); border-left: 4px solid var(--dark-brand); border-radius: 8px; padding: 0.7rem 1rem; margin-bottom: 1rem; font-size: 0.95rem; line-height: 1.5; color: var(--dark-text); }
    #st-insights .si-rowlab { font-size: 0.78rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dark-text-muted); margin: 0.9rem 0 0.4rem; }
    #st-insights .si-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.8rem; }
    @media (max-width: 1400px) { #st-insights .si-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { #st-insights .si-row { grid-template-columns: 1fr; } }
    #st-insights .si-tile { background: #111827; border: 1px solid var(--dark-border); border-left: 4px solid #475569; border-radius: 10px; padding: 0.85rem 0.95rem; min-width: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    #st-insights .si-edge-red { border-left-color: #ef4444; } #st-insights .si-edge-amber { border-left-color: #f59e0b; } #st-insights .si-edge-green { border-left-color: #22c55e; }
    #st-insights .si-title { margin: 0; font-size: 1.05rem; font-weight: 800; color: #ffffff; }
    #st-insights .si-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; }
    #st-insights .si-val { font-size: 1.7rem; font-weight: 900; color: #ffffff; line-height: 1.1; }
    #st-insights .si-lab { font-size: 0.85rem; color: var(--dark-text-muted); }
    #st-insights .si-delta { font-size: 1.05rem; font-weight: 800; }
    #st-insights .si-red { color: #f87171; } #st-insights .si-amber { color: #fbbf24; } #st-insights .si-green { color: #4ade80; }
    #st-insights .si-cmp { font-size: 0.78rem; color: var(--dark-text-muted); line-height: 1.4; }
    #st-insights .si-table { width: 100%; border-collapse: collapse; font-size: 0.76rem; margin-top: 0.3rem; table-layout: auto; }
    #st-insights .si-table th { color: var(--dark-text-muted); font-weight: 700; text-align: right; padding: 3px 4px; border-bottom: 1px solid #1f2937; }
    #st-insights .si-table td { text-align: right; padding: 3px 4px; border-bottom: 1px solid #1f2937; white-space: normal; overflow-wrap: anywhere; }
    #st-insights .si-table .left { text-align: left; }
    #st-insights .si-table td:not(.left):not(.si-wrap) { white-space: nowrap; overflow-wrap: normal; }
    #st-insights .si-table td.si-wrap { white-space: normal; overflow-wrap: normal; text-align: left; min-width: 4.5rem; }
    #st-insights .si-table.si-dense { font-size: 0.68rem; } #st-insights .si-table.si-dense td, #st-insights .si-table.si-dense th { padding: 2px 2px; }
    #st-insights .si-table th { white-space: normal; overflow-wrap: normal; vertical-align: bottom; }
    #st-insights .si-table td.left { overflow-wrap: normal; word-break: normal; hyphens: auto; }
    #st-insights .si-table .si-muted { color: #64748b; } #st-insights .si-table .si-bold { font-weight: 800; }
    #st-insights .si-sec td { text-align: left; font-size: 0.68rem; letter-spacing: 0.05em; text-transform: uppercase; color: #94a3b8; padding-top: 6px; }
    #st-insights .si-rag { font-weight: 800; }
    #st-insights .si-boxes { display: grid; grid-template-columns: 1fr; gap: 0.4rem; }
    #st-insights .si-box { background: #0b1118; border: 1px solid #1f2937; border-radius: 6px; padding: 0.45rem 0.6rem; }
    #st-insights .si-box-red { border-color: #7f1d1d; } #st-insights .si-box-green { border-color: #14532d; }
    #st-insights .si-box-l { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: #94a3b8; }
    #st-insights .si-box-v { font-size: 1.25rem; font-weight: 900; color: #fff; } #st-insights .si-box-red .si-box-v { color: #f87171; }
    #st-insights .si-box-s { font-size: 0.72rem; color: var(--dark-text-muted); line-height: 1.35; }
    #st-insights .si-est { font-size: 0.6rem; background: #1e3a8a; color: #bfdbfe; border-radius: 3px; padding: 0 4px; text-transform: none; }
    #st-insights .si-note { margin: 0.25rem 0 0; font-size: 0.86rem; color: var(--dark-text); line-height: 1.4; }
    #st-insights .si-foot { font-size: 0.7rem; color: #64748b; line-height: 1.35; }
    #st-insights .si-link { color: var(--dark-brand); font-size: 0.8rem; font-weight: 700; text-decoration: none; }
    #st-insights .si-src { margin-top: auto; font-size: 0.66rem; color: #64748b; }
    #st-insights .si-rec { border: 1px solid #1f2937; border-radius: 6px; padding: 0.35rem 0.55rem; font-size: 0.76rem; }
    #st-insights .si-rec summary { cursor: pointer; color: var(--dark-brand); font-weight: 700; }
    #st-insights .si-rec-f { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; margin-top: 0.3rem; color: var(--dark-text-muted); }
    #st-insights .si-rec-f input[type="text"], #st-insights .si-rec-f select { flex: 1; min-width: 8rem; }
    #st-insights .si-rec-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    #st-insights .si-rec-n input, #st-insights .si-rec-num { width: 3.5rem; }
    #st-insights .si-rec-who { font-size: 0.68rem; color: #64748b; margin-top: 0.25rem; }
    #st-insights .si-rec-actions { margin-top: 0.4rem; }
  </style>`;

  window.stInsightsHtml = function stInsightsHtml(ins) {
    if (!ins) return `${STYLE}<h3>Where we stand and why</h3><p class="rt-sub">Loading…</p>`;
    if (ins.error) return `${STYLE}<h3>Where we stand and why</h3><p class="rt-sub">Could not build the tiles: ${esc(ins.error)}</p>`;
    return `${STYLE}<h3>Where we stand and why</h3><div class="si-summary">${esc(ins.summary)}</div>`
      + ROWS.map(([k, label]) => `<div class="si-rowlab">${esc(label)}</div><div class="si-row">${(ins.rows[k] || []).map(tileHtml).join('')}</div>`).join('')
      + `<p class="rt-sub" style="margin-top:.6rem">Built ${esc(stamp(ins.built_at))} · all figures calculated live; estimates are labelled.</p>`;
  };

  function goPanel(panel) {
    document.querySelector(`.aigeo-nav-item[data-panel="${panel}"]`)?.click();
  }
  document.addEventListener('click', (e) => {
    const p = e.target.closest?.('[data-si-panel]');
    const a = e.target.closest?.('[data-si-anchor]');
    if (!p && !a) return;
    e.preventDefault();
    if (p) { goPanel(p.dataset.siPanel); return; }
    document.getElementById(a.dataset.siAnchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
