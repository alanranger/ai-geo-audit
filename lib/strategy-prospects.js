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
  const STAGE = { qualify: 'Qualify', quote: 'Quote', scheduled: 'Scheduled', allocated: 'Allocated · delivery pending', booked_paid: 'Booked / paid', closed_lost: 'Closed – lost' };
  const OPEN = ['qualify', 'quote', 'scheduled'];
  const RTYPE = { new_sale: 'New sale', partner_development: 'Partner', committed_work: 'Committed work', receivable: 'Receivable' };
  const rtypeOf = (e) => (RTYPE[e.revenue_type] ? e.revenue_type : 'new_sale');
  const live = (e) => !['booked_paid', 'closed_lost'].includes(e.stage);
  /** In the weighted pipeline: a new sale at an open stage (committed work / receivables / partners have their own lines). */
  const inPipeline = (e) => OPEN.includes(e.stage) && rtypeOf(e) === 'new_sale';
  /** Rows whose cash month matters: the pipeline, live committed work and live receivables. */
  const hasCash = (e) => inPipeline(e) || (live(e) && ['committed_work', 'receivable'].includes(rtypeOf(e)));
  const TYPES = ['1-2-1', 'mentoring', 'commission', 'corporate training', 'Academy', 'voucher / gift', 'other'];
  const OWNERS = ['Alan', 'GPT', 'Claude'];
  const SOURCES = ['', 'email', 'phone', 'web form', 'referral'];
  const MARKETS = ['D2C', 'B2B', 'unclassified'];
  const BASES = ['agreed', 'quoted', 'estimated', 'unknown'];
  const REVIEW = ['recent', 'revalidate'];
  const st = { rows: null, history: [], config: [], error: null, sort: 'cash_month', dir: 1, stage: '', type: '', market: '', review: '', rtype: '', q: '', lost: false, edit: null };
  const key = () => (typeof window.getAdminKey === 'function' ? window.getAdminKey() : '');
  const probs = () => Object.fromEntries((st.config || []).map((c) => [c.stage, Number(c.probability)]));
  const unknown = (e) => e.value_basis === 'unknown';
  /** Old leads count at a quarter (review "revalidate" × the factor from the API; the editable assumption is in Rules). */
  const factorOf = (e) => (e.review_status === 'revalidate' ? st.factor ?? 0.25 : 1);
  const weighted = (e) => (inPipeline(e) && !unknown(e) ? (Number(e.value_gbp) || 0) * (probs()[e.stage] ?? 0) * factorOf(e) : 0);
  /** "£200 est." on estimated values; an unknown value reads "unknown", never £0. */
  const money = (e, v) => (unknown(e) ? '<span class="rt-sub">unknown</span>' : `${gbp(v)}${e.value_basis === 'estimated' ? ' <span class="pp-est">est.</span>' : ''}`);
  const cashBucket = (e) => {
    const m = String(e.cash_month || '').slice(0, 7);
    if (!m) return 'undated';
    return m < todayIso().slice(0, 7) ? 'overdue' : 'dated';
  };
  const touchDays = (e) => {
    const t = String(e.last_touch_at || e.created_at || '').slice(0, 10);
    return t ? Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 864e5) : null;
  };
  const stalled = (e) => inPipeline(e) && (touchDays(e) ?? 0) >= 14;

  /* ---------- tiles (summary aggregates) ---------- */

  function stageTile(t, conv) {
    const real = conv?.rates?.[t.stage];
    const rate = `${Math.round((t.probability || 0) * 100)}%${real != null ? ` · real ${real}%` : ''}`;
    const unk = t.unknown ? ` · ${t.unknown} value unknown` : '';
    const sub = t.stage === 'booked_paid' ? `${gbp(t.value)} · moves to actual sales (Booking Sheet)${unk}` : `${gbp(t.value)} value · <b>${gbp(t.weighted)} weighted</b>${unk}`;
    return `<div class="pp-tile pp-${t.stage}"><div class="pp-h"><b>${STAGE[t.stage]}</b><span class="rt-sub">${rate}</span></div><div class="pp-n">${t.count} <span class="rt-sub">${t.stage === 'booked_paid' ? 'this month' : 'enquiries'}</span></div><div class="rt-sub">${sub}</div></div>`;
  }
  const mkt = (pl, m) => gbp(pl.by_market?.[m]?.weighted);
  /** Overdue + unknown + revalidate + estimate notes for the Pipeline tile (empty when none). */
  function pipelineFlags(pl) {
    const out = [];
    if (pl.overdue_count) out.push(`<span class="pp-amber">${pl.overdue_count} overdue cash expectation${pl.overdue_count > 1 ? 's' : ''} ${gbp(pl.overdue_gbp)}</span> (cash month passed: revise; not in any month)`);
    if (pl.unknown_count) out.push(`${pl.unknown_count} value unknown (not in totals)`);
    if (pl.revalidate_count) out.push(`<span class="pp-amber">${pl.revalidate_count} to revalidate</span> (old leads count at a quarter)`);
    if (pl.estimated_gbp > 0.5) out.push(`of which est. ${gbp(pl.estimated_gbp)}`);
    return out.length ? `<div class="rt-sub">${out.join(' · ')}</div>` : '';
  }
  function pipelineTile(p) {
    const pl = p.pipeline;
    const split = (pl.by_month || []).map((m) => `${esc(m.label)} ${gbp(m.weighted)}`).join(' · ');
    const unc = pl.by_market?.unclassified?.count ? ` · unclassified ${mkt(pl, 'unclassified')}` : '';
    return `<div class="pp-tile pp-total"><div class="pp-h"><b>Pipeline, weighted</b><span class="rt-sub">new sales, open stages</span></div><div class="pp-n">${gbp(pl.total)}</div>`
      + `<div class="rt-sub" data-pp-market><b>D2C ${mkt(pl, 'D2C')}</b> · <b>B2B ${mkt(pl, 'B2B')}</b>${unc}</div>`
      + `<div class="rt-sub" data-pp-dated>dated ${gbp(pl.dated_gbp)} · dated-event enquiries ${gbp(pl.dated_event_gbp)} · undated ${gbp(pl.undated_gbp ?? pl.undated_weighted)}${pl.undated_count ? ` (${pl.undated_count} without a cash month: not in any month)` : ''}</div>`
      + `<div class="rt-sub">${split || 'no cash months yet'} · <span class="${pl.stalled ? 'pp-amber' : ''}">${pl.stalled} stalled</span> (no action in 14 days)</div>${pipelineFlags(pl)}${otherLines(p)}</div>`;
  }
  const lineExtras = (l) => [l.undated_gbp > 0.5 ? `undated ${gbp(l.undated_gbp)}` : '', l.overdue_count ? `<span class="pp-amber">${l.overdue_count} cash month passed ${gbp(l.overdue_gbp)}</span>` : '', l.unknown_count ? `${l.unknown_count} value unknown` : ''].filter(Boolean);
  /** Committed work (full value, by cash month) · Cash to collect (never new sales) · Partner relationships (counted, unvalued). */
  function otherLines(p) {
    const c = p.committed || {};
    const r = p.cash_to_collect || {};
    const pa = p.partners || {};
    const months = (c.by_month || []).filter((m) => m.gbp > 0.5).map((m) => `${esc(m.label)} ${gbp(m.gbp)}`);
    const cm = [...months, ...lineExtras(c)].join(' · ');
    return `<div class="pp-lines"><div data-pp-committed><b>Committed work ${gbp(c.total_gbp)}</b>${c.count ? ` <span class="rt-sub">(${c.count} allocated, delivery pending${cm ? `: ${cm}` : ''}; full value, not weighted)</span>` : ''}</div>`
      + `<div data-pp-collect><b>Cash to collect ${gbp(r.total_gbp)}</b>${r.count ? ` <span class="rt-sub">(${r.count} invoiced, payment unverified${lineExtras(r).length ? ` · ${lineExtras(r).join(' · ')}` : ''}; not new sales)</span>` : ''}</div>`
      + `<div data-pp-partners><b>Partner relationships ${pa.count || 0}</b> <span class="rt-sub">(unvalued${pa.unvalued_count != null && pa.count ? `: ${pa.unvalued_count} of ${pa.count}` : ''}; never in £ totals, no age alarm)</span></div></div>`;
  }
  function convNote(p) {
    const c = p.conversion;
    return c?.rates ? `Real conversion shown beside each assumption (${c.closed} closed); the rates are not switched automatically, Alan decides.` : `Real conversion appears once ${c?.needed ?? 20} enquiries have closed (${c?.closed ?? 0} so far).`;
  }

  /* ---------- table (admin rows) ---------- */

  const COLS = [['enquiry_ref', 'Ref'], ['enquiry_date', 'Received'], ['client', 'Client ID'], ['client_or_org', 'Enquiry'], ['customer_market', 'Market'], ['revenue_type', 'Revenue type'], ['type', 'Type'], ['stage', 'Stage'], ['review_status', 'Review'], ['days_open', 'Days open'], ['value_gbp', 'Value'], ['value_basis', 'Value basis'], ['weighted', 'Weighted'], ['cash_month', 'Cash expected'], ['next_action', 'Next action'], ['owner', 'Owner'], ['last_touch_at', 'Last touch']];
  const NUM_COLS = new Set(['value_gbp', 'weighted', 'days_open']);
  const daysOpen = (e) => (inPipeline(e) && e.enquiry_date ? Math.max(0, Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${String(e.enquiry_date).slice(0, 10)}T00:00:00Z`)) / 864e5)) : null);
  const clientOf = (e) => st.clients?.[e.person_id] || null;
  const NUM = { weighted: (e) => weighted(e), value_gbp: (e) => Number(e.value_gbp) || 0, days_open: (e) => daysOpen(e) ?? -1 };
  const valOf = (e, k) => (NUM[k] ? NUM[k](e) : String(k === 'client' ? clientOf(e)?.id || '' : e[k] ?? ''));
  const marketKey = (e) => (MARKETS.includes(e.customer_market) ? e.customer_market : 'unclassified');
  const reviewKey = (e) => e.review_status || 'recent';
  const FILTERS = [
    (e) => st.lost || e.stage !== 'closed_lost', (e) => !st.stage || e.stage === st.stage, (e) => !st.type || e.type === st.type,
    (e) => !st.market || marketKey(e) === st.market, (e) => !st.review || reviewKey(e) === st.review, (e) => !st.rtype || rtypeOf(e) === st.rtype,
    (e) => !st.q || `${e.client_or_org} ${e.next_action || ''} ${e.notes || ''}`.toLowerCase().includes(st.q.toLowerCase())
  ];
  function visibleRows() {
    return (st.rows || []).filter((e) => FILTERS.every((f) => f(e)))
      .sort((a, b) => {
        const x = valOf(a, st.sort);
        const y = valOf(b, st.sort);
        return (typeof x === 'number' ? x - y : x.localeCompare(y)) * st.dir;
      });
  }
  function clientCell(e) {
    const c = clientOf(e);
    if (!c) return '—';
    return `<a href="#" data-pp-client="${esc(e.person_id)}" title="${esc(c.record_type)}: open the client record">${esc(c.id)}</a>${c.record_type === 'prospect' ? ' <span class="rt-sub">prospect</span>' : ''}`;
  }
  /** Cash expected: the month, "Overdue cash expectation" when it has passed (revise), "undated potential" when none. */
  function cashCell(e) {
    if (!hasCash(e)) return mon(e.cash_month);
    const b = cashBucket(e);
    if (b === 'overdue') return `${mon(e.cash_month)}<div class="pp-amber pp-flag">Overdue cash expectation · revise</div>`;
    return b === 'undated' ? '<span class="rt-sub">undated potential</span>' : mon(e.cash_month);
  }
  const basisCell = (e) => `${esc(e.value_basis || '—')}${e.value_basis_note ? `<div class="rt-sub">${esc(e.value_basis_note)}</div>` : ''}`;
  const reviewCell = (e) => (reviewKey(e) === 'revalidate' ? '<span class="pp-chip pp-reval">revalidate</span>' : '<span class="rt-sub">recent</span>');
  const marketCell = (e) => `<span class="pp-chip pp-m-${marketKey(e)}">${esc(marketKey(e))}</span>`;
  const rtypeCell = (e) => `<span class="pp-chip pp-r-${rtypeOf(e)}">${RTYPE[rtypeOf(e)]}</span>`;
  const LIVE_STATUS = { receivable: 'Invoiced · payment unverified', partner_development: 'Partner · ongoing' };
  /** Stage chip; a live receivable / partner shows its own status; committed work shows delivery due + invoice by. */
  function stageCell(e) {
    const label = live(e) && LIVE_STATUS[rtypeOf(e)] ? LIVE_STATUS[rtypeOf(e)] : STAGE[e.stage];
    const extra = e.stage === 'closed_lost' ? ` <span class="rt-sub">(${esc(e.lost_reason || 'no reason')})</span>` : '';
    const dates = [e.delivery_due ? `delivery ${dm(e.delivery_due)}` : '', e.invoice_by ? `invoice by ${dm(e.invoice_by)}` : ''].filter(Boolean).join(' · ');
    return `<span class="pp-chip pp-${e.stage}">${esc(label)}</span>${extra}${dates ? `<div class="rt-sub">${dates}</div>` : ''}`;
  }
  /** Weighted column: weighted £ for new sales; committed work at full value ("committed"); receivables "to collect"; partners never in totals. */
  function amountCell(e) {
    if (inPipeline(e)) return `${money(e, weighted(e))}${factorOf(e) < 1 ? ` <span class="pp-tag" title="old leads count at a quarter">× ${factorOf(e)}</span>` : ''}`;
    if (!live(e)) return '—';
    const t = rtypeOf(e);
    if (t === 'committed_work') return `${money(e, e.value_gbp)} <span class="pp-tag">committed</span>`;
    if (t === 'receivable') return `${money(e, e.value_gbp)} <span class="pp-tag">to collect</span>`;
    return t === 'partner_development' ? '<span class="rt-sub">not in totals</span>' : '—';
  }
  /** An enquiry about a dated event: counted under the Sales gap Dated events (capped by places), not the non-dated pipeline. */
  const eventLine = (e) => (e.relates_to_event ? `<div class="rt-sub"><span class="pp-tag">dated event</span> ${dm(String(e.relates_to_event).slice(0, 10))} · ${esc(String(e.relates_to_event).slice(11))}</div>` : '');
  function rowHtml(e) {
    const touch = stalled(e) ? `<span class="pp-amber">${dm(e.last_touch_at || e.created_at)} · stalled</span>` : dm(e.last_touch_at || e.created_at);
    const open = daysOpen(e);
    return `<tr class="${stalled(e) ? 'pp-stalled' : ''}${reviewKey(e) === 'revalidate' ? ' pp-revalidate' : ''}"><td class="left">${esc(e.enquiry_ref || '—')}</td><td>${dm(e.enquiry_date)}</td><td class="left">${clientCell(e)}</td>`
      + `<td class="left"><b>${esc(e.client_or_org)}</b>${eventLine(e)}${e.notes ? `<div class="rt-sub">${esc(e.notes)}</div>` : ''}</td><td class="left">${marketCell(e)}</td><td class="left">${rtypeCell(e)}</td><td class="left">${esc(e.type)}</td>`
      + `<td class="left">${stageCell(e)}</td><td class="left">${reviewCell(e)}</td><td>${open == null ? '—' : open}</td><td>${money(e, e.value_gbp)}</td><td class="left">${basisCell(e)}</td>`
      + `<td>${amountCell(e)}</td><td>${cashCell(e)}</td>`
      + `<td class="left">${esc(e.next_action || '—')}${e.next_action_date ? ` · ${dm(e.next_action_date)}` : ''}</td><td class="left">${esc(e.owner)}</td><td>${touch}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary pp-btn" data-pp-edit="${esc(e.id)}">Edit</button></td></tr>`;
  }
  const opt = (list, cur, labels = {}) => list.map((v) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(labels[v] || v || 'any')}</option>`).join('');
  function filtersHtml() {
    return `<div class="pp-filters">Market <select data-pp-f="market">${opt(['', ...MARKETS], st.market)}</select> Stage <select data-pp-f="stage">${opt(['', ...Object.keys(STAGE)], st.stage, STAGE)}</select>`
      + ` Review <select data-pp-f="review">${opt(['', ...REVIEW], st.review)}</select> Revenue type <select data-pp-f="rtype">${opt(['', ...Object.keys(RTYPE)], st.rtype, RTYPE)}</select> Type <select data-pp-f="type">${opt(['', ...TYPES], st.type)}</select>`
      + ` <input data-pp-f="q" placeholder="search" value="${esc(st.q)}"> <label><input type="checkbox" data-pp-f="lost"${st.lost ? ' checked' : ''}> show closed-lost</label></div>`;
  }
  function tableHtml() {
    if (st.error) return `<p class="rt-sub">Enquiries unavailable: ${esc(st.error)}</p>`;
    if (!st.rows) return '<p class="rt-sub">Loading enquiries…</p>';
    const rows = visibleRows();
    const head = COLS.map(([k, l]) => `<th class="${NUM_COLS.has(k) || ['cash_month', 'last_touch_at', 'enquiry_date'].includes(k) ? '' : 'left'}" data-pp-sort="${k}" style="cursor:pointer">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = rows.map(rowHtml).join('') || `<tr><td colspan="${COLS.length + 1}" class="rt-sub">${st.rows.length ? 'No enquiries match the filters.' : 'No enquiries yet: Claude loads the first list through the API; "+ Add enquiry" adds one by hand.'}</td></tr>`;
    return `<div class="pp-wrap"><table class="rt-table pp-table"><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody></table></div><p class="rt-sub">Stalled = no touch in 14 days on Qualify / Quote / Scheduled (amber; in Needs Alan only when Alan owns the next step) · closed-lost hidden by default, reason kept · revalidate = an older enquiry to re-check (never closed by age) · value = the full order value; "est." = estimated, "unknown" is not counted in totals.</p>`;
  }

  /* ---------- add / edit form ---------- */

  function formHtml(e) {
    const v = e || { stage: 'qualify', owner: 'Alan', type: '1-2-1' };
    const inp = (n, val, extra = '') => `<input name="${n}" value="${esc(val ?? '')}" ${extra}>`;
    return `<form class="pp-form" data-pp-form="${esc(v.id || '')}"><b>${v.id ? 'Edit enquiry' : 'Add enquiry'}</b>`
      + `<label>Received ${inp('enquiry_date', v.enquiry_date || todayIso(), 'type="date" required')}</label><label>Client / organisation ${inp('client_or_org', v.client_or_org, 'required')}</label><label title="matches an existing client by email first">Client email ${inp('client_email', '', 'type="email"')}</label><label>Type <select name="type">${opt(TYPES, v.type)}</select></label>`
      + `<label>Market <select name="customer_market">${opt(MARKETS, v.customer_market || 'unclassified')}</select></label>`
      + `<label title="new sale = weighted pipeline · committed work = allocated, full value · receivable = cash to collect · partner = counted, never in £ totals">Revenue type <select name="revenue_type">${opt(Object.keys(RTYPE), rtypeOf(v), RTYPE)}</select></label>`
      + `<label title="committed work">Delivery due ${inp('delivery_due', v.delivery_due, 'type="date"')}</label><label title="committed work">Invoice by ${inp('invoice_by', v.invoice_by, 'type="date"')}</label>`
      + `<label title="the full order value (stage probability weights it)">Value £ ${inp('value_gbp', v.value_gbp ?? '', 'type="number" min="0" step="1"')}</label><label>Value basis <select name="value_basis">${opt(['', ...BASES], v.value_basis || '', { '': 'choose…' })}</select></label>`
      + `<label>Basis note ${inp('value_basis_note', v.value_basis_note)}</label><label>Review <select name="review_status">${opt(REVIEW, v.review_status || 'recent')}</select></label>`
      + `<label>Stage <select name="stage">${opt(Object.keys(STAGE), v.stage, STAGE)}</select></label>`
      + `<label>Cash month ${inp('cash_month', String(v.cash_month || '').slice(0, 7), 'type="month"')}</label><label title="an enquiry about a dated event: YYYY-MM-DD|/event-page (or paste the page URL after the |); counted under the Sales gap Dated events">Dated event ${inp('relates_to_event', v.relates_to_event, 'placeholder="2026-11-28|/event-page"')}</label><label>Next action ${inp('next_action', v.next_action)}</label>`
      + `<label>by ${inp('next_action_date', v.next_action_date, 'type="date"')}</label><label>Owner <select name="owner">${opt(OWNERS, v.owner)}</select></label>`
      + `<label>Source <select name="source">${opt(SOURCES, v.source || '')}</select></label><label title="e.g. the Gmail message id">Source ref ${inp('source_ref', v.source_ref)}</label><label>Notes ${inp('notes', v.notes)}</label>`
      + `<label>Lost reason ${inp('lost_reason', v.lost_reason)}</label><label title="Booked / paid only: the Booking Sheet sale">Sale date ${inp('sale_date', '', 'type="date"')}</label><label>Sale £ ${inp('sale_amount', '', 'type="number" step="0.01"')}</label>`
      + '<label><input type="checkbox" name="touch" checked> touched today</label><button type="submit" class="rf-btn">Save</button> <button type="button" class="rf-btn rf-btn-secondary" data-pp-cancel>Cancel</button> <span class="rt-sub" data-pp-msg></span></form>';
  }
  /** Form field → payload: as typed; blank → null (cleared) or left out (undefined: not sent). */
  const AS_IS = ['client_or_org', 'type', 'stage', 'owner', 'customer_market', 'review_status', 'revenue_type'];
  const BLANK_NULL = ['enquiry_date', 'cash_month', 'next_action', 'next_action_date', 'source', 'notes', 'lost_reason', 'value_basis_note', 'source_ref', 'delivery_due', 'invoice_by', 'relates_to_event'];
  const BLANK_UNSENT = ['client_email', 'value_basis'];
  function payloadOf(form) {
    const f = Object.fromEntries(new FormData(form).entries());
    const enquiry = { value_gbp: Number(f.value_gbp || 0) };
    for (const k of AS_IS) enquiry[k] = f[k];
    for (const k of BLANK_NULL) enquiry[k] = f[k] || null;
    for (const k of BLANK_UNSENT) enquiry[k] = f[k] || undefined;
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
      Object.assign(st, { rows: j.rows, history: j.history, config: j.config, clients: j.clients || {}, factor: j.revalidate_factor ?? 0.25, error: null });
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
    .pp-amber { color: #f0b429; } .pp-stalled td { background: rgba(240, 180, 41, 0.05); } .pp-revalidate td:first-child { box-shadow: inset 3px 0 0 #f0b429; }
    .pp-est { font-size: 0.72rem; color: #f0b429; font-weight: 600; } .pp-flag { font-size: 0.72rem; } .pp-chip.pp-reval { background: #5a4310; color: #ffd98a; }
    .pp-chip.pp-m-D2C { background: #1d3a5e; } .pp-chip.pp-m-B2B { background: #3d2a55; } .pp-chip.pp-m-unclassified { background: #2a3142; color: #aab3c5; }
    .pp-chip.pp-allocated { background: #4a3a12; color: #ffd98a; } .pp-chip.pp-r-committed_work { background: #4a3a12; } .pp-chip.pp-r-receivable { background: #12404a; } .pp-chip.pp-r-partner_development { background: #2d3d24; }
    .pp-tag { font-size: 0.7rem; color: #aab3c5; } .pp-lines { margin-top: 0.4rem; padding-top: 0.35rem; border-top: 1px solid #2a3142; font-size: 0.8rem; } .pp-lines > div { margin: 0.1rem 0; }
    .pp-chip { padding: 1px 7px; border-radius: 9px; font-size: 0.75rem; background: #2a3142; } .pp-chip.pp-quote { background: #23395e; } .pp-chip.pp-scheduled { background: #3b2d63; } .pp-chip.pp-booked_paid { background: #1d4a33; }
    .pp-wrap { overflow-x: auto; max-width: 100%; } .pp-table { font-size: 0.8rem; } .pp-table th, .pp-table td { padding-left: 0.35rem; padding-right: 0.35rem; }
    .pp-table td { vertical-align: top; white-space: normal; } .pp-table td:first-child, .pp-table td:nth-child(2) { white-space: nowrap; } .pp-table td .rt-sub { font-size: 0.75rem; } .pp-filters { margin: 0.3rem 0; font-size: 0.85rem; } .pp-filters select, .pp-filters input { margin-right: 0.5rem; }
    .pp-form { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; align-items: end; padding: 0.6rem; border: 1px solid #2a3142; border-radius: 8px; margin: 0.5rem 0; font-size: 0.82rem; }
    .pp-form label { display: flex; flex-direction: column; } .pp-btn { padding: 2px 8px; font-size: 0.75rem; } .pp-client { border: 1px solid #2a3142; border-radius: 8px; padding: 0.5rem 0.7rem; margin: 0.4rem 0; font-size: 0.85rem; }
  </style>`;
  function sectionHtml(s) {
    const p = s?.prospects;
    const intro = '<p class="rt-sub">Enquiries for 1-2-1s, mentoring, commissions, corporate training, Academy and vouchers. Weighted £ = value × stage probability, placed in the month the cash is expected (not the month the work is done). Feeds the Remedy plan\'s lever 3.</p>';
    if (!p || p.error) return `${STYLE}<h3>Prospects: non-dated work in the pipeline</h3>${intro}<p class="rt-sub">Pipeline unavailable: ${esc(p?.error || 'not in the strategy summary')}</p>`;
    const tiles = `<div class="pp-tiles">${p.tiles.map((t) => stageTile(t, p.conversion)).join('')}${pipelineTile(p)}</div>`;
    return `${STYLE}<h3>Prospects: non-dated work in the pipeline <button type="button" class="rf-btn pp-btn" data-pp-add>+ Add enquiry</button></h3>${intro}${tiles}<p class="rt-sub">${convNote(p)}${p.booked_unmatched ? ` · <span class="pp-amber">${p.booked_unmatched} booked / paid not yet matched to a Booking Sheet sale${p.booked_review ? ` (${p.booked_review} need a sale review: more than one possible sale, or not linked to the client yet)` : ''}</span>` : ''}</p>`
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
