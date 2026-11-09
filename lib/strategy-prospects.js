/**
 * Strategy "Prospects" section (QUESTION-2026-11-09 (i)), under the Remedy plan. Tiles come from s.prospects (summary
 * aggregates, no names); enquiry rows come from GET /api/aigeo/prospects with the admin key (personal data never goes
 * through the public summary). Writes only on "+ Add enquiry" / Save in the drawer (POST upsert): viewing writes nothing.
 * Weighted £ = value × stage probability, placed in the month the cash is expected.
 * QUESTION-2026-11-09 (y / z / aa / bb): priority column + default sort, compact table (sticky header, totals row,
 * row detail), filter bar with removable chips, right-hand edit drawer that sends only the changed fields and shows a
 * refused change's reason beside the field, closed (reason) / parked (revisit date) rows hidden by default.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const dm = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const mon = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—');
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const daysFrom = (iso) => (iso ? Math.floor((Date.parse(`${todayIso()}T00:00:00Z`) - Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)) / 864e5) : null);
  const STAGE = {
    qualify: 'Qualify', quote: 'Quote', scheduled: 'Scheduled', allocated: 'Allocated · delivery pending', delivered: 'Delivered · invoice to send',
    invoiced: 'Invoiced · payment pending', booked_paid: 'Booked / paid', parked: 'Parked', closed_lost: 'Closed'
  };
  const OPEN = ['qualify', 'quote', 'scheduled'];
  const RTYPE = { new_sale: 'New sale', partner_development: 'Partner', committed_work: 'Committed work', receivable: 'Receivable' };
  /** The statuses offered in the drawer for each revenue type (a row's current stage is always kept in the list). */
  const STAGES_FOR = {
    new_sale: ['qualify', 'quote', 'scheduled', 'booked_paid', 'parked', 'closed_lost'], partner_development: ['qualify', 'quote', 'scheduled', 'parked', 'closed_lost'],
    committed_work: ['allocated', 'delivered', 'invoiced', 'booked_paid', 'parked', 'closed_lost'], receivable: ['scheduled', 'booked_paid', 'closed_lost']
  };
  const LOST = [['not_interested', 'Not interested'], ['no_response', 'No response / gone cold'], ['went_elsewhere', 'Went elsewhere'], ['too_expensive', 'Too expensive'], ['not_a_fit', 'Not a fit (out of scope)'], ['duplicate', 'Duplicate'], ['other', 'Other (note)']];
  const lostLabel = (code) => (LOST.find(([c]) => c === code) || [null, code])[1];
  const rtypeOf = (e) => (RTYPE[e.revenue_type] ? e.revenue_type : 'new_sale');
  const live = (e) => !['booked_paid', 'closed_lost', 'parked'].includes(e.stage);
  const parkedDue = (e) => e.stage === 'parked' && !!e.revisit_on && String(e.revisit_on).slice(0, 10) <= todayIso();
  /** Receivable "scheduled" = invoiced, payment unverified; booked_paid is "Paid" for anything but a new sale. */
  function stageLabel(stage, type) {
    if (stage === 'booked_paid' && type !== 'new_sale') return 'Paid';
    if (stage === 'scheduled' && type === 'receivable') return 'Invoiced · payment unverified';
    return STAGE[stage] || stage;
  }
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
  const BAND_RANK = { High: 0, Medium: 1, Low: 2 };
  const st = {
    rows: null, history: [], config: [], clients: {}, factor: 0.25, rules: null, error: null, sort: 'priority', dir: 1, ended: false,
    f: { q: '', priority: '', stage: '', market: '', rtype: '', review: '', owner: '' }, open: new Set(), toast: '', host: null, s: null
  };
  const key = () => (typeof window.getAdminKey === 'function' ? window.getAdminKey() : '');
  const probs = () => Object.fromEntries((st.config || []).map((c) => [c.stage, Number(c.probability)]));
  const unknown = (e) => e.value_basis === 'unknown';
  /** Old leads count at a quarter (review "revalidate" × the factor from the API; the editable assumption is in Rules). */
  const factorOf = (e) => (e.review_status === 'revalidate' ? st.factor ?? 0.25 : 1);
  const weighted = (e) => (inPipeline(e) && !unknown(e) ? (Number(e.value_gbp) || 0) * (probs()[e.stage] ?? 0) * factorOf(e) : 0);
  const valueOf = (e) => (unknown(e) ? 0 : Number(e.value_gbp) || 0);
  /** "£200 est." on estimated values; an unknown value reads "unknown", never £0. */
  const money = (e, v) => (unknown(e) ? '<span class="rt-sub">unknown</span>' : `${gbp(v)}${e.value_basis === 'estimated' ? ' <span class="pp-est">est.</span>' : ''}`);
  const cashBucket = (e) => {
    const m = String(e.cash_month || '').slice(0, 7);
    if (!m) return 'undated';
    return m < todayIso().slice(0, 7) ? 'overdue' : 'dated';
  };
  const touchDays = (e) => daysFrom(e.last_touch_at || e.created_at);
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
    return `<div class="pp-lines"><div data-pp-committed><b>Committed work ${gbp(c.total_gbp)}</b>${c.count ? ` <span class="rt-sub">(${c.count} in progress: allocated → delivered → invoiced${cm ? `: ${cm}` : ''}; full value, not weighted)</span>` : ''}</div>`
      + `<div data-pp-collect><b>Cash to collect ${gbp(r.total_gbp)}</b>${r.count ? ` <span class="rt-sub">(${r.count} invoiced, payment unverified${lineExtras(r).length ? ` · ${lineExtras(r).join(' · ')}` : ''}; not new sales)</span>` : ''}</div>`
      + `<div data-pp-partners><b>Partner relationships ${pa.count || 0}</b> <span class="rt-sub">(unvalued${pa.unvalued_count != null && pa.count ? `: ${pa.unvalued_count} of ${pa.count}` : ''}; never in £ totals, no age alarm)</span></div></div>`;
  }
  function convNote(p) {
    const c = p.conversion;
    return c?.rates ? `Real conversion shown beside each assumption (${c.closed} closed); the rates are not switched automatically, Alan decides.` : `Real conversion appears once ${c?.needed ?? 20} enquiries have closed (${c?.closed ?? 0} so far).`;
  }

  /* ---------- table (admin rows) ---------- */

  const clientOf = (e) => st.clients?.[e.person_id] || null;
  const marketKey = (e) => (MARKETS.includes(e.customer_market) ? e.customer_market : 'unclassified');
  const reviewKey = (e) => e.review_status || 'recent';
  const FILTER = {
    priority: (e, v) => (v === 'none' ? !e.priority : e.priority?.band === v), stage: (e, v) => e.stage === v, market: (e, v) => marketKey(e) === v,
    rtype: (e, v) => rtypeOf(e) === v, review: (e, v) => reviewKey(e) === v, owner: (e, v) => e.owner === v,
    q: (e, v) => `${e.enquiry_ref || ''} ${e.client_or_org} ${e.next_action || ''} ${e.notes || ''}`.toLowerCase().includes(v.toLowerCase())
  };
  /** Closed / parked rows are hidden unless the toggle is on, a stage filter asks for them, or a parked row is due to revisit. */
  const shown = (e) => st.ended || !!st.f.stage || !['closed_lost', 'parked'].includes(e.stage) || parkedDue(e);
  const STAGE_ORDER = Object.keys(STAGE);
  const SORT = {
    priority: (e) => (BAND_RANK[e.priority?.band] ?? 3) * 1e9 - weighted(e), client: (e) => String(e.client_or_org || '').toLowerCase(), stage: (e) => STAGE_ORDER.indexOf(e.stage),
    value: (e) => valueOf(e), expected: (e) => String(e.cash_month || '9999'), next: (e) => String(e.next_action_date || '9999'),
    touch: (e) => String(e.last_touch_at || e.created_at || ''), received: (e) => String(e.enquiry_date || '')
  };
  function visibleRows() {
    const active = Object.entries(st.f).filter(([, v]) => v);
    return (st.rows || []).filter((e) => shown(e) && active.every(([k, v]) => FILTER[k](e, v))).sort((a, b) => {
      const x = SORT[st.sort](a);
      const y = SORT[st.sort](b);
      return (typeof x === 'number' ? x - y : x.localeCompare(y)) * st.dir;
    });
  }
  /** Gmail link built by the admin API (never from the public summary); opens in a new tab. */
  const mailA = (m, label) => (m?.href ? `<a href="${esc(m.href)}" target="_blank" rel="noopener noreferrer" title="${esc(m.title)}" data-pp-mail>${label}</a>` : label);
  /** Client ID → all emails with the client; the client record (purchases, other enquiries) is the ⓘ beside it. */
  function clientCell(e) {
    const c = clientOf(e);
    if (!c) return '—';
    const info = `<a href="#" class="pp-info" data-pp-client="${esc(e.person_id)}" title="${esc(c.record_type)}: open the client record (purchases and other enquiries)" aria-label="Client record">ⓘ</a>`;
    return `${mailA(c.mail, esc(c.id))} ${info}${c.record_type === 'prospect' ? ' <span class="rt-sub">prospect</span>' : ''}`;
  }
  /** Ref → the original enquiry email (source_ref); plain text when there is none. */
  const refCell = (e) => mailA(e.mail, esc(e.enquiry_ref || '—'));
  const PILL = { D2C: 'd2c', B2B: 'b2b', unclassified: 'partial' };
  function priorityCell(e) {
    const p = e.priority;
    return p ? `<span class="rt-pill pp-pri pp-pri-${p.band.toLowerCase()}" title="${esc(p.tip)}">${p.band}</span>` : '<span class="rt-sub" title="priority is for new sales at open stages">—</span>';
  }
  function clientCellFull(e) {
    const open = st.open.has(e.id);
    const sub = `<span class="pp-nw">${refCell(e)}</span> · <span class="pp-nw">${clientCell(e)}</span> · <span class="rt-pill ${PILL[marketKey(e)]}">${esc(marketKey(e))}</span> · ${esc(e.type)}`;
    return `<div class="pp-c1"><button type="button" class="pp-exp" data-pp-expand="${esc(e.id)}" aria-expanded="${open}" title="Details">${open ? '▾' : '▸'}</button> <b title="${esc(e.client_or_org)}">${esc(e.client_or_org)}</b></div><div class="pp-c2">${sub}</div>`;
  }
  const LIVE_STATUS = { partner_development: 'Partner · ongoing' };
  /** Under the stage chip: committed delivery / invoice dates, the parked revisit date or the closed reason, a dated event. */
  function stageSub(e) {
    if (e.stage === 'closed_lost') return `${esc(lostLabel(e.lost_reason) || 'no reason')}${e.status_note ? ` · ${esc(e.status_note)}` : ''}`;
    if (e.stage === 'parked') return `revisit ${dm(e.revisit_on)}${e.status_note ? ` · ${esc(e.status_note)}` : ''}`;
    const dates = [e.delivery_due ? `delivery ${dm(e.delivery_due)}` : '', e.invoice_by ? `invoice by ${dm(e.invoice_by)}` : ''].filter(Boolean).join(' · ');
    return dates || (e.relates_to_event ? `<span class="pp-tag">dated event</span> ${dm(String(e.relates_to_event).slice(0, 10))}` : '');
  }
  function stageCell(e) {
    const t = rtypeOf(e);
    const label = live(e) && LIVE_STATUS[t] ? LIVE_STATUS[t] : stageLabel(e.stage, t);
    const extra = [t !== 'new_sale' ? `<span class="pp-chip pp-r-${t}">${RTYPE[t]}</span>` : '', reviewKey(e) === 'revalidate' ? '<span class="pp-chip pp-reval">revalidate</span>' : ''].join('');
    const sub = [extra, stageSub(e)].filter(Boolean).join(' ');
    return `<div class="pp-c1"><span class="pp-chip pp-${e.stage}">${esc(label)}</span></div>${sub ? `<div class="rt-sub pp-c2">${sub}</div>` : ''}`;
  }
  /** Under the value: weighted £ for new sales; committed work at full value; receivables "to collect"; partners never in totals. */
  function amountSub(e) {
    if (inPipeline(e)) return `${money(e, weighted(e))}${factorOf(e) < 1 ? ` <span class="pp-tag" title="old leads count at a quarter">× ${factorOf(e)}</span>` : ' weighted'}`;
    if (e.stage === 'parked') return '£0 weighted · parked';
    if (!live(e)) return '—';
    const t = rtypeOf(e);
    if (t === 'committed_work') return `${money(e, e.value_gbp)} <span class="pp-tag">committed</span>`;
    if (t === 'receivable') return `${money(e, e.value_gbp)} <span class="pp-tag">to collect</span>`;
    return '<span class="rt-sub">not in totals</span>';
  }
  const valueCell = (e) => `<div>${money(e, e.value_gbp)}</div><div class="rt-sub">${amountSub(e)}</div>`;
  /** Expected: the cash month; "overdue" (amber) when it has passed (revise); "undated" when none. */
  function cashCell(e) {
    if (!hasCash(e)) return '<span class="rt-sub">—</span>';
    const b = cashBucket(e);
    if (b === 'overdue') return `${mon(e.cash_month)}<div class="pp-amber pp-flag" title="Overdue cash expectation: the cash month has passed, revise it">overdue · revise</div>`;
    return b === 'undated' ? '<span class="rt-sub" title="Undated potential: no cash month, not in any month">undated</span>' : mon(e.cash_month);
  }
  /** Next action (2 lines, full text on hover) + due chip; a parked row due to revisit shows GPT's "revisit" action. */
  function nextCell(e) {
    if (parkedDue(e)) return `<div class="pp-clamp" title="Parked: revisit due"><span class="pp-amber">revisit:</span> ${esc(e.status_note || 'parked enquiry')}</div><span class="pp-due late">GPT · ${dm(e.revisit_on)}</span>`;
    const late = e.next_action_date && e.next_action_date < todayIso();
    return `<div class="pp-clamp" title="${esc(e.next_action || '')}">${esc(e.next_action || '—')}</div>${e.next_action_date ? `<span class="pp-due${late ? ' late' : ''}">${dm(e.next_action_date)}</span>` : ''}`;
  }
  function touchCell(e) {
    const d = touchDays(e);
    const when = dm(e.last_touch_at || e.created_at);
    return stalled(e) ? `<span class="pp-amber">${when}</span><div class="rt-sub pp-amber">${d} days · stalled</div>` : `${when}<div class="rt-sub">${d == null ? '' : `${d} days`}</div>`;
  }
  const receivedCell = (e) => `<span class="rt-sub">${dm(e.enquiry_date)}</span><div class="rt-sub">${e.enquiry_date ? `${daysFrom(e.enquiry_date)} days` : ''}</div>`;
  const hot = (e) => e.priority?.band === 'High' || (hasCash(e) && cashBucket(e) === 'overdue');
  function rowHtml(e) {
    const tr = `<tr class="pp-row${hot(e) ? ' pp-hot' : ''}${stalled(e) ? ' pp-stalled' : ''}" data-pp-row="${esc(e.id)}">`;
    const cells = [priorityCell(e), clientCellFull(e), stageCell(e), valueCell(e), cashCell(e), nextCell(e), touchCell(e), receivedCell(e)];
    const edit = `<button type="button" class="rf-btn rf-btn-secondary pp-icon" data-pp-edit="${esc(e.id)}" title="Edit ${esc(e.enquiry_ref || '')}" aria-label="Edit ${esc(e.enquiry_ref || '')}">✎</button>`;
    return `${tr}${cells.map((c, i) => `<td class="${i === 3 ? 'pp-num' : ''}">${c}</td>`).join('')}<td>${edit}</td></tr>${st.open.has(e.id) ? detailRow(e) : ''}`;
  }
  const histOf = (id) => (st.history || []).filter((h) => h.enquiry_id === id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const whoOf = (by) => String(by || '').replace(/\s*\(.*\)\s*$/, '');
  /** Why a row was closed / parked (reason, revisit date, note) as recorded in that history row. */
  const whyOf = (c) => [c.lost_reason?.to ? `reason: ${esc(lostLabel(c.lost_reason.to))}` : '', c.revisit_on?.to ? `revisit ${dm(c.revisit_on.to)}` : '', c.status_note?.to ? esc(c.status_note.to) : ''].filter(Boolean).join(' · ');
  function histLine(h) {
    const c = h.changes || {};
    const move = h.from_stage !== h.to_stage ? ` · ${esc(STAGE[h.from_stage] || 'new')} → ${esc(STAGE[h.to_stage] || h.to_stage)}` : '';
    const why = whyOf(c);
    const keys = Object.keys(c).filter((k) => !['created', 'client'].includes(k)).join(', ');
    const tail = why || (keys ? esc(keys) : '');
    return `<li>${dm(h.at)} · ${esc(whoOf(h.by))}${h.via ? ` (${esc(h.via)})` : ''}${move}${c.created ? ' · created' : ''}${tail ? ` · ${tail}` : ''}</li>`;
  }
  const historyHtml = (id) => `<ul class="pp-hist">${histOf(id).map(histLine).join('') || '<li class="rt-sub">No changes recorded yet.</li>'}</ul>`;
  function detailRow(e) {
    const kv = [['Value basis', `${esc(e.value_basis || '—')}${e.value_basis_note ? ` · ${esc(e.value_basis_note)}` : ''}`], ['Source email', e.mail?.href ? mailA(e.mail, 'open the original email') : '—'], ['Notes', esc(e.notes || '—')], ['Owner', esc(e.owner)]];
    return `<tr class="pp-detail"><td colspan="9"><table class="pp-kv">${kv.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table><div class="rt-sub"><b>History</b></div>${historyHtml(e.id)}</td></tr>`;
  }
  const COLS = [['priority', 'Priority'], ['client', 'Client'], ['stage', 'Stage'], ['value', 'Value'], ['expected', 'Expected'], ['next', 'Next action'], ['touch', 'Last touch'], ['received', 'Received']];
  const WIDTHS = ['8%', '23%', '16%', '10%', '7%', '15%', '9%', '8%', '4%'];
  function totalsRow(rows) {
    const value = rows.reduce((a, e) => a + valueOf(e), 0);
    const w = rows.reduce((a, e) => a + weighted(e), 0);
    return `<tfoot><tr><td></td><td>${rows.length} enquir${rows.length === 1 ? 'y' : 'ies'}</td><td></td><td class="pp-num">${gbp(value)}<div class="rt-sub">${gbp(w)} weighted</div></td><td colspan="5"></td></tr></tfoot>`;
  }
  /** Closed / parked totals (always, small and muted), whether or not those rows are shown. */
  function endedLine() {
    const rows = st.rows || [];
    const closed = rows.filter((e) => e.stage === 'closed_lost');
    const parked = rows.filter((e) => e.stage === 'parked');
    const due = parked.filter(parkedDue).length;
    return `<p class="rt-sub pp-ended" data-pp-ended>Closed ${closed.length} (${gbp(closed.reduce((a, e) => a + valueOf(e), 0))}) · Parked ${parked.length} (${gbp(parked.reduce((a, e) => a + valueOf(e), 0))}${due ? `; ${due} due to revisit, shown in the table` : ''}) · not in any total${st.ended ? '' : ' · hidden: "Show closed / parked"'}</p>`;
  }
  function tableHtml() {
    if (st.error) return `<p class="rt-sub">Enquiries unavailable: ${esc(st.error)}</p>`;
    if (!st.rows) return '<p class="rt-sub">Loading enquiries…</p>';
    const rows = visibleRows();
    const head = COLS.map(([k, l]) => `<th class="${k === 'value' ? 'pp-num' : ''}" data-pp-sort="${k}" aria-sort="${st.sort === k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${st.sort === k ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const empty = st.rows.length ? 'No enquiries match the filters.' : 'No enquiries yet: Claude loads the first list through the API; "+ Add enquiry" adds one by hand.';
    const body = rows.map(rowHtml).join('') || `<tr><td colspan="9" class="rt-sub">${empty}</td></tr>`;
    return `<table class="rt-table pp-table"><colgroup>${WIDTHS.map((w) => `<col style="width:${w}">`).join('')}</colgroup><thead><tr>${head}<th></th></tr></thead><tbody>${body}</tbody>${rows.length ? totalsRow(rows) : ''}</table>${endedLine()}`;
  }

  /* ---------- filter bar (search + dropdowns + active chips) ---------- */

  const BAR = [
    ['priority', 'All priorities', [['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low'], ['none', 'No priority (other types)']], 'Priority'],
    ['stage', 'All stages', Object.entries(STAGE), 'Stage'], ['market', 'All markets', MARKETS.map((m) => [m, m]), 'Market'],
    ['rtype', 'All revenue types', Object.entries(RTYPE), 'Revenue type'], ['review', 'All reviews', REVIEW.map((r) => [r, r]), 'Review'], ['owner', 'All owners', OWNERS.map((o) => [o, o]), 'Owner']
  ];
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  function chipsHtml() {
    const chips = BAR.filter(([k]) => st.f[k]).map(([k, , list, label]) => `<button type="button" class="pp-fchip" data-pp-unf="${k}" title="Remove this filter">${label}: ${esc((list.find(([v]) => v === st.f[k]) || [])[1] || st.f[k])} ×</button>`);
    if (st.f.q) chips.unshift(`<button type="button" class="pp-fchip" data-pp-unf="q" title="Remove this filter">Search: ${esc(st.f.q)} ×</button>`);
    return chips.join('');
  }
  const anyFilter = () => st.ended || Object.values(st.f).some(Boolean);
  function filtersHtml() {
    const selects = BAR.map(([k, all, list]) => `<select data-pp-f="${k}" aria-label="${esc(all)}">${opt([['', all], ...list], st.f[k])}</select>`).join('');
    return `<div class="rt-breakdown-controls pp-bar"><input class="rt-search" data-pp-f="q" placeholder="Search enquiries" value="${esc(st.f.q)}" aria-label="Search enquiries">${selects}`
      + `<label class="rt-toggle"><input type="checkbox" data-pp-f="ended"${st.ended ? ' checked' : ''}> Show closed / parked</label><button type="button" class="rf-btn rf-btn-secondary pp-btn" data-pp-clear${anyFilter() ? '' : ' hidden'}>Clear filters</button></div>`
      + `<div class="pp-chips" data-pp-chips>${chipsHtml()}</div>`;
  }

  /* ---------- drawer (add / edit) ---------- */

  const inputOf = (n, val, extra = '') => `<input id="pp-f-${n}" name="${n}" value="${esc(val ?? '')}" data-orig="${esc(val ?? '')}" ${extra}>`;
  const areaOf = (n, val) => `<textarea id="pp-f-${n}" name="${n}" rows="2" data-orig="${esc(val ?? '')}">${esc(val ?? '')}</textarea>`;
  const selectOf = (n, list, cur) => `<select id="pp-f-${n}" name="${n}" data-orig="${esc(cur ?? '')}">${opt(list, cur ?? '')}</select>`;
  const fld = (n, label, control, req) => `<div class="pp-fld" data-fld="${n}"><label class="sp-field-label" for="pp-f-${n}">${label}${req ? ' <span class="pp-req">*</span>' : ''}</label>${control}<div class="pp-err" data-err="${n}"></div></div>`;
  const pairs = (list) => list.map((v) => [v, v]);
  const stageOptions = (type, cur) => [...new Set([...(STAGES_FOR[type] || STAGES_FOR.new_sale), ...(cur ? [cur] : [])])].map((s) => [s, stageLabel(s, type)]);
  function clientSection(v, isNew) {
    const ref = isNew ? fld('source_ref', 'Source ref (Gmail message id)', inputOf('source_ref', v.source_ref)) : fld('source_ref', 'Source ref', `<div class="pp-ro">${esc(v.source_ref || '—')}${v.mail?.href ? ` · ${mailA(v.mail, 'open email')}` : ''}</div>`);
    return `<section><h5>Client</h5>${fld('client_or_org', 'Name / organisation', inputOf('client_or_org', v.client_or_org, 'required'), isNew)}`
      + `${fld('client_email', 'Client email', inputOf('client_email', '', 'type="email" placeholder="matches an existing client first"'))}${isNew ? '' : fld('client_id', 'Client ID', `<div class="pp-ro">${clientCell(v)}</div>`)}`
      + `<div class="pp-2col">${fld('customer_market', 'Market', selectOf('customer_market', pairs(MARKETS), v.customer_market || 'unclassified'))}${fld('type', 'Type', selectOf('type', pairs(TYPES), v.type || '1-2-1'), isNew)}</div>`
      + `<div class="pp-2col">${fld('source', 'Source', selectOf('source', SOURCES.map((s) => [s, s || '—']), v.source || ''))}${ref}</div></section>`;
  }
  function opportunitySection(v, isNew) {
    const type = rtypeOf(v);
    return `<section><h5>Opportunity</h5><div class="pp-2col">${fld('revenue_type', 'Revenue type', selectOf('revenue_type', Object.entries(RTYPE), type))}${fld('stage', 'Stage', selectOf('stage', stageOptions(type, v.stage), v.stage || (type === 'committed_work' ? 'allocated' : 'qualify')))}</div>`
      + `<div class="pp-2col">${fld('value_gbp', 'Value £ (full order value)', inputOf('value_gbp', v.value_gbp ?? '', 'type="number" min="0" step="0.01"'))}${fld('value_basis', 'Value basis', selectOf('value_basis', [['', 'Choose…'], ...pairs(BASES)], v.value_basis || ''), isNew)}</div>`
      + `${fld('value_basis_note', 'Basis note', areaOf('value_basis_note', v.value_basis_note))}${fld('review_status', 'Review', selectOf('review_status', pairs(REVIEW), v.review_status || 'recent'))}</section>`;
  }
  function timingSection(v, isNew) {
    return `<section><h5>Timing</h5><div class="pp-2col">${fld('enquiry_date', 'Received', inputOf('enquiry_date', v.enquiry_date || (isNew ? todayIso() : ''), 'type="date" required'), isNew)}${fld('cash_month', 'Expected cash month', inputOf('cash_month', String(v.cash_month || '').slice(0, 7), 'type="month"'))}</div>`
      + `${fld('next_action', 'Next action', areaOf('next_action', v.next_action))}<div class="pp-2col">${fld('next_action_date', 'Next action due', inputOf('next_action_date', v.next_action_date, 'type="date"'))}${fld('owner', 'Owner', selectOf('owner', pairs(OWNERS), v.owner || 'GPT'))}</div>`
      + `${fld('relates_to_event', 'Dated event (YYYY-MM-DD|/event-page)', inputOf('relates_to_event', v.relates_to_event, 'placeholder="2026-11-28|/event-page"'))}`
      + '<label class="pp-tick"><input type="checkbox" name="touch"> Touched today (sets last touch to now)</label></section>';
  }
  function conditionalSections(v) {
    return `<section data-when="committed"><h5>Committed work</h5><div class="pp-2col">${fld('delivery_due', 'Delivery due', inputOf('delivery_due', v.delivery_due, 'type="date"'))}${fld('invoice_by', 'Invoice by', inputOf('invoice_by', v.invoice_by, 'type="date"'))}</div></section>`
      + `<section data-when="closed"><h5>Closed</h5>${fld('lost_reason', 'Reason', selectOf('lost_reason', [['', 'Choose a reason…'], ...LOST], v.lost_reason || ''), true)}</section>`
      + `<section data-when="parked"><h5>Parked</h5>${fld('revisit_on', 'Revisit on', inputOf('revisit_on', v.revisit_on, 'type="date"'), true)}</section>`
      + `<section data-when="ended">${fld('status_note', 'Note (why closed / parked; required for "Other")', areaOf('status_note', v.status_note))}</section>`
      + `<section data-when="paid"><h5>Booked / paid</h5><p class="rt-sub">Needs a matching Booking Sheet sale for this client.</p><div class="pp-2col">${fld('sale_date', 'Sale date', '<input id="pp-f-sale_date" name="sale_date" type="date">')}${fld('sale_amount', 'Sale £', '<input id="pp-f-sale_amount" name="sale_amount" type="number" step="0.01">')}</div></section>`;
  }
  function drawerHtml(v, isNew) {
    const title = isNew ? 'Add enquiry' : `Edit ${esc(v.enquiry_ref || '')} · ${esc(v.client_or_org)}`;
    const hist = isNew ? '' : `<section><h5>History</h5>${historyHtml(v.id)}</section>`;
    return `${DRAWER_STYLE}<div class="pp-ptop"><b>${title}</b><button type="button" class="pp-x" data-pp-close aria-label="Close">×</button></div>`
      + `<form class="pp-dform" data-pp-form="${esc(isNew ? '' : v.id)}" data-pp-stage="${esc(v.stage || '')}" novalidate>${clientSection(v, isNew)}${opportunitySection(v, isNew)}${timingSection(v, isNew)}${conditionalSections(v)}${hist}</form>`
      + '<div class="pp-pfoot"><button type="button" class="rf-btn" data-pp-save>Save</button><button type="button" class="rf-btn rf-btn-secondary" data-pp-close>Cancel</button><span class="pp-pmsg" data-pp-msg></span></div>';
  }
  /** Show only the sections that apply to the chosen revenue type / stage; the stage list follows the revenue type. */
  function syncDrawer(form) {
    const type = form.elements.revenue_type.value;
    const sel = form.elements.stage;
    const allowed = stageOptions(type, form.dataset.ppStage).map(([s]) => s);
    if (!allowed.includes(sel.value)) sel.value = allowed[0];
    for (const o of sel.options) { o.hidden = !allowed.includes(o.value); o.textContent = stageLabel(o.value, type); }
    const stage = sel.value;
    const when = { committed: type === 'committed_work', closed: stage === 'closed_lost', parked: stage === 'parked', ended: ['closed_lost', 'parked'].includes(stage), paid: stage === 'booked_paid' && form.dataset.ppStage !== 'booked_paid' };
    for (const s of form.querySelectorAll('section[data-when]')) s.hidden = !when[s.dataset.when];
  }
  /** Only the fields Alan changed (plus id) are sent; a blank field clears it (email / value basis are then left out). */
  const UNSENT_IF_BLANK = new Set(['client_email', 'value_basis']);
  function fieldValue(el) {
    const v = el.value.trim();
    if (el.name === 'value_gbp') return v === '' ? 0 : Number(v);
    if (v) return v;
    return UNSENT_IF_BLANK.has(el.name) ? undefined : null;
  }
  function payloadOf(form) {
    const isNew = !form.dataset.ppForm;
    const enquiry = {};
    for (const el of form.querySelectorAll('[data-orig]')) {
      if (!isNew && el.value === el.dataset.orig) continue;
      const v = fieldValue(el);
      if (v !== undefined && !(isNew && v === null)) enquiry[el.name] = v;
    }
    if (!isNew) enquiry.id = form.dataset.ppForm;
    if (form.elements.touch?.checked) enquiry.last_touch_at = new Date().toISOString();
    const f = form.elements;
    return { action: 'upsert', enquiry, ...(f.sale_date?.value && f.sale_amount?.value ? { matched_sale: { txn_date: f.sale_date.value, amount: Number(f.sale_amount.value) } } : {}) };
  }
  const LABEL = { stage: 'Stage', value_gbp: 'Value', cash_month: 'Expected', next_action: 'Next action', next_action_date: 'Next action due', owner: 'Owner', lost_reason: 'Reason', revisit_on: 'Revisit on', status_note: 'Note', revenue_type: 'Revenue type' };
  function changeText(k, c, row) {
    const t = rtypeOf(row || {});
    if (k === 'stage') return `Stage ${stageLabel(c.from, t)} → ${stageLabel(c.to, t)}`;
    if (k === 'lost_reason') return `Reason ${lostLabel(c.to)}`;
    return `${LABEL[k] || k} ${c.from ?? '—'} → ${c.to ?? '—'}`;
  }
  function savedText(j, row) {
    if (j.unchanged) return `No changes to ${j.enquiry_ref || 'the enquiry'}.`;
    if (j.created) return `Added ${j.enquiry_ref}.`;
    const parts = Object.entries(j.changes || {}).filter(([k]) => k !== 'last_touch_at' && k !== 'match_review').map(([k, c]) => changeText(k, c, row));
    return `Saved ${j.enquiry_ref}${parts.length ? `: ${parts.join(' · ')}` : ''}.`;
  }

  /* ---------- data ---------- */

  async function load() {
    if (!key()) { st.error = 'admin key needed to list enquiries'; return; }
    try {
      const r = await fetch('/api/aigeo/prospects', { headers: { 'x-arp-admin-key': key() } });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      Object.assign(st, { rows: j.rows, history: j.history, config: j.config, clients: j.clients || {}, factor: j.revalidate_factor ?? 0.25, rules: j.priority_rules || null, error: null });
    } catch (e) {
      st.error = e.message;
    }
  }
  function showRefusal(form, j, status) {
    const reason = j.reason || j.error || `HTTP ${status}`;
    const slot = j.field && form.querySelector(`[data-err="${j.field}"]`);
    if (slot) { slot.textContent = reason; slot.closest('section')?.removeAttribute('hidden'); slot.closest('.pp-fld')?.classList.add('pp-bad'); }
    panel().querySelector('[data-pp-msg]').textContent = `Not saved: ${reason}`;
  }
  async function save(form) {
    for (const el of form.querySelectorAll('.pp-err')) el.textContent = '';
    for (const el of form.querySelectorAll('.pp-bad')) el.classList.remove('pp-bad');
    const msg = panel().querySelector('[data-pp-msg]');
    msg.textContent = 'Saving…';
    const row = (st.rows || []).find((r) => r.id === form.dataset.ppForm) || null;
    const r = await fetch('/api/aigeo/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key() }, body: JSON.stringify(payloadOf(form)) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: 'network error' };
    if (!r?.ok || !j.ok) return showRefusal(form, j, r?.status);
    closeDrawer();
    st.toast = savedText(j, row);
    await load();
    paintTable();
    if (typeof window.stRefreshQuiet === 'function') window.stRefreshQuiet();
    return undefined;
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
    .pp-amber { color: #f0b429; } .pp-stalled td { background: rgba(240, 180, 41, 0.05); } .pp-hot td:first-child { box-shadow: inset 3px 0 0 #f0b429; }
    .pp-est { font-size: 0.72rem; color: #f0b429; font-weight: 600; } .pp-flag { font-size: 0.72rem; } .pp-chip.pp-reval { background: #5a4310; color: #ffd98a; }
    .pp-chip { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 0.72rem; background: #2a3142; margin-right: 3px; white-space: nowrap; }
    .pp-chip.pp-quote { background: #23395e; } .pp-chip.pp-scheduled { background: #3b2d63; } .pp-chip.pp-booked_paid { background: #1d4a33; }
    .pp-chip.pp-allocated, .pp-chip.pp-delivered, .pp-chip.pp-invoiced { background: #4a3a12; color: #ffd98a; } .pp-chip.pp-parked { background: #2a3142; color: #aab3c5; } .pp-chip.pp-closed_lost { background: #1f2937; color: #94a3b8; }
    .pp-chip.pp-r-committed_work { background: #4a3a12; } .pp-chip.pp-r-receivable { background: #12404a; } .pp-chip.pp-r-partner_development { background: #2d3d24; }
    .pp-info { font-size: 0.75rem; color: #8fb7ff; text-decoration: none; cursor: pointer; } .pp-table a[data-pp-mail] { color: #8fb7ff; }
    .pp-tag { font-size: 0.7rem; color: #aab3c5; } .pp-lines { margin-top: 0.4rem; padding-top: 0.35rem; border-top: 1px solid #2a3142; font-size: 0.8rem; } .pp-lines > div { margin: 0.1rem 0; }
    .pp-table { table-layout: fixed; font-size: 0.8rem; } .pp-table th { z-index: 2; cursor: pointer; user-select: none; }
    .pp-table th, .pp-table td { text-align: left; padding: 0.35rem 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
    .pp-table .pp-num { text-align: right; } .pp-table td .rt-sub { font-size: 0.72rem; } .pp-row { cursor: pointer; }
    .pp-c1, .pp-c2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .pp-c2 { font-size: 0.72rem; color: var(--dark-text-muted, #94a3b8); } .pp-c2 .rt-pill { margin-left: 0; }
    .pp-nw { white-space: nowrap; } .pp-exp { background: none; border: 0; color: #94a3b8; cursor: pointer; padding: 0; font-size: 0.75rem; }
    .pp-clamp { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .pp-due { display: inline-block; font-size: 0.68rem; padding: 0 6px; border-radius: 4px; background: #1e293b; color: #cbd5e1; margin-top: 2px; } .pp-due.late { background: #78350f; color: #fde68a; }
    .rt-pill.pp-pri { margin-left: 0; } .pp-pri-high { background: #78350f; color: #fde68a; } .pp-pri-medium { background: #1e3a8a; color: #dbeafe; } .pp-pri-low { background: #334155; color: #cbd5e1; }
    .pp-icon { padding: 1px 7px; font-size: 0.8rem; } .pp-btn { padding: 2px 8px; font-size: 0.75rem; }
    .pp-detail td { white-space: normal; background: #0b1118; } .pp-kv { border-collapse: collapse; font-size: 0.78rem; margin: 0.2rem 0 0.4rem; } .pp-kv th { text-align: left; color: #8b93a3; font-weight: 400; width: 7rem; padding: 2px 8px 2px 0; vertical-align: top; } .pp-kv td { padding: 2px 0; white-space: normal; }
    .pp-hist { margin: 0.2rem 0 0; padding-left: 1.1rem; font-size: 0.76rem; } .pp-ended { margin-top: 0.3rem; }
    .pp-bar { margin: 0.5rem 0 0.3rem; } .pp-bar .rt-toggle { margin: 0; padding: 0.3rem 0.6rem; } .pp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 0.5rem; }
    .pp-fchip { background: #f59e0b; border: 1px solid #f59e0b; color: #111827; font-weight: 600; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
    .pp-toast { margin: 0.3rem 0; padding: 0.35rem 0.6rem; border: 1px solid #1d4a33; background: #0f1f17; color: #bbf7d0; border-radius: 6px; font-size: 0.82rem; }
    .pp-client { border: 1px solid #2a3142; border-radius: 8px; padding: 0.5rem 0.7rem; margin: 0.4rem 0; font-size: 0.85rem; } .pp-rules { margin-top: 0.4rem; font-size: 0.8rem; }
  </style>`;
  const DRAWER_STYLE = `<style>
    #pp-panel { position: fixed; top: 0; right: 0; width: min(440px, 94vw); height: 100vh; overflow-y: auto; background: #0b1118; border-left: 1px solid #334155; box-shadow: -8px 0 24px rgba(0,0,0,0.45); z-index: 9990; padding: 0 14px; color: #d6dbe4; font-size: 13px; box-sizing: border-box; }
    #pp-panel .pp-ptop { position: sticky; top: 0; background: #0b1118; display: flex; justify-content: space-between; align-items: center; padding: 12px 0 8px; border-bottom: 1px solid #263045; z-index: 1; gap: 8px; }
    #pp-panel .pp-ptop b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #pp-panel .pp-x { background: none; border: 0; color: #cbd5e1; font-size: 22px; cursor: pointer; line-height: 1; }
    #pp-panel section { border-bottom: 1px dashed #334155; padding: 8px 0 4px; } #pp-panel section[hidden] { display: none; }
    #pp-panel h5 { margin: 2px 0 8px; color: #fff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    #pp-panel .pp-fld { margin: 0 0 8px; min-width: 0; } #pp-panel .pp-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
    #pp-panel input:not([type="checkbox"]), #pp-panel select, #pp-panel textarea { width: 100%; box-sizing: border-box; background: #0f131b; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 5px 8px; font-size: 13px; font-family: inherit; }
    #pp-panel textarea { resize: vertical; } #pp-panel .pp-ro { padding: 5px 0; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } #pp-panel a { color: #93c5fd; }
    #pp-panel .pp-err { color: #fde68a; font-size: 12px; margin-top: 2px; } #pp-panel .pp-bad input, #pp-panel .pp-bad select, #pp-panel .pp-bad textarea { border-color: #a16207; }
    #pp-panel .pp-req { color: #f0b429; } #pp-panel .pp-tick { display: flex; gap: 6px; align-items: center; margin: 2px 0 8px; font-size: 12.5px; }
    #pp-panel .pp-pfoot { position: sticky; bottom: 0; background: #0b1118; border-top: 1px solid #263045; padding: 10px 0 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #pp-panel .pp-pmsg { color: #fde68a; font-size: 12.5px; } #pp-panel .pp-hist { padding-left: 1.1rem; font-size: 12px; margin: 0; }
  </style>`;
  function rulesHtml(p) {
    const rules = p?.priority_rules || st.rules || [];
    const items = rules.map((a) => `<li><b>${esc(a.label)}:</b> ${esc(a.value)} <span class="rt-sub">(${esc(a.status)})</span></li>`).join('');
    return `<details class="pp-rules"><summary>Rules</summary><ul class="rt-sub">${items}<li>Stalled = no touch in 14 days on Qualify / Quote / Scheduled (amber; in Needs Alan only when Alan owns the next step).</li>`
      + '<li>Closed needs a reason; Parked needs a revisit date, weighs £0 and shows again as GPT\'s "revisit" action on that date. Closed / parked rows are hidden by default and in no total. Nothing is closed or parked automatically.</li>'
      + '<li>Revalidate = an older enquiry to re-check (old leads count at a quarter). Value = the full order value; "est." = estimated; "unknown" is not counted in totals.</li></ul></details>';
  }
  function sectionHtml(s) {
    const p = s?.prospects;
    const intro = '<p class="rt-sub">Enquiries for 1-2-1s, mentoring, commissions, corporate training, Academy and vouchers. Weighted £ = value × stage probability, placed in the month the cash is expected (not the month the work is done). Feeds the Remedy plan\'s lever 3.</p>';
    if (!p || p.error) return `${STYLE}<h3>Prospects: non-dated work in the pipeline</h3>${intro}<p class="rt-sub">Pipeline unavailable: ${esc(p?.error || 'not in the strategy summary')}</p>`;
    const tiles = `<div class="pp-tiles">${p.tiles.map((t) => stageTile(t, p.conversion)).join('')}${pipelineTile(p)}</div>`;
    return `${STYLE}<h3>Prospects: non-dated work in the pipeline <button type="button" class="rf-btn pp-btn" data-pp-add>+ Add enquiry</button></h3>${intro}${tiles}<p class="rt-sub">${convNote(p)}${p.booked_unmatched ? ` · <span class="pp-amber">${p.booked_unmatched} booked / paid not yet matched to a Booking Sheet sale${p.booked_review ? ` (${p.booked_review} need a sale review: more than one possible sale, or not linked to the client yet)` : ''}</span>` : ''}</p>`
      + `${st.rows ? filtersHtml() : ''}<div data-pp-toast>${st.toast ? `<div class="pp-toast">${esc(st.toast)}</div>` : ''}</div><div data-pp-clientbox></div><div data-pp-table>${tableHtml()}</div>${rulesHtml(p)}`;
  }

  /* ---------- events ---------- */

  function panel() {
    let el = document.getElementById('pp-panel');
    if (!el) {
      el = document.createElement('aside');
      el.id = 'pp-panel';
      el.hidden = true;
      el.setAttribute('aria-label', 'Edit enquiry');
      document.body.appendChild(el);
      el.addEventListener('click', onDrawerClick);
      el.addEventListener('change', (e) => { if (['revenue_type', 'stage'].includes(e.target.name)) syncDrawer(e.target.form); });
    }
    return el;
  }
  function openDrawer(row) {
    const el = panel();
    el.innerHTML = drawerHtml(row || { owner: 'GPT' }, !row);
    el.hidden = false;
    syncDrawer(el.querySelector('form'));
    el.querySelector('input:not([type="checkbox"]), select, textarea')?.focus();
  }
  function closeDrawer() {
    const el = document.getElementById('pp-panel');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }
  function onDrawerClick(e) {
    if (e.target.closest('[data-pp-close]')) return closeDrawer();
    if (e.target.closest('[data-pp-save]')) return save(panel().querySelector('form'));
    return undefined;
  }
  function paintTable() {
    const host = st.host;
    if (!host?.isConnected) return;
    host.querySelector('[data-pp-table]').innerHTML = tableHtml();
    const chips = host.querySelector('[data-pp-chips]');
    if (chips) chips.innerHTML = chipsHtml();
    const clear = host.querySelector('[data-pp-clear]');
    if (clear) clear.hidden = !anyFilter();
    const toast = host.querySelector('[data-pp-toast]');
    if (toast) toast.innerHTML = st.toast ? `<div class="pp-toast">${esc(st.toast)}</div>` : '';
  }
  function repaint(host, s) {
    if (host.isConnected) host.innerHTML = sectionHtml(s);
  }
  const rowOf = (id) => (st.rows || []).find((r) => r.id === id) || null;
  function onTableClick(t, e) {
    const ex = t.closest('[data-pp-expand]');
    if (ex) { e.stopPropagation(); st.open[st.open.has(ex.dataset.ppExpand) ? 'delete' : 'add'](ex.dataset.ppExpand); return paintTable(); }
    const ed = t.closest('[data-pp-edit]') || (!t.closest('a, button') && t.closest('[data-pp-row]'));
    if (ed) return openDrawer(rowOf(ed.dataset.ppEdit || ed.dataset.ppRow));
    const so = t.closest('[data-pp-sort]');
    if (so) { st.dir = st.sort === so.dataset.ppSort ? -st.dir : 1; st.sort = so.dataset.ppSort; paintTable(); }
    return undefined;
  }
  function onClick(host, s, e) {
    const t = e.target;
    if (t.closest('[data-pp-add]')) return openDrawer(null);
    if (t.closest('[data-pp-closeclient]')) { host.querySelector('[data-pp-clientbox]').innerHTML = ''; return undefined; }
    const cl = t.closest('[data-pp-client]');
    if (cl) { e.preventDefault(); return openClient(host, cl.dataset.ppClient); }
    const un = t.closest('[data-pp-unf]');
    if (un) { st.f[un.dataset.ppUnf] = ''; return repaint(host, s); }
    if (t.closest('[data-pp-clear]')) { Object.keys(st.f).forEach((k) => { st.f[k] = ''; }); st.ended = false; return repaint(host, s); }
    return onTableClick(t, e);
  }
  function onFilter(host, s, e) {
    const f = e.target.dataset.ppF;
    if (!f) return;
    if (f === 'ended') st.ended = e.target.checked;
    else st.f[f] = e.target.value;
    paintTable();
  }
  let docBound = false;
  function bindDocument() {
    if (docBound) return;
    docBound = true;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }
  /** Mount into #st-prospects: tiles straight away, rows after the admin GET (kept across re-renders, so no flash). */
  window.stMountProspects = function stMountProspects(host, s) {
    if (!host) return;
    Object.assign(st, { host, s });
    repaint(host, s);
    bindDocument();
    if (host.dataset.ppBound !== '1') {
      host.dataset.ppBound = '1';
      host.addEventListener('click', (e) => onClick(host, st.s, e));
      host.addEventListener('change', (e) => onFilter(host, st.s, e));
      host.addEventListener('input', (e) => { if (e.target.dataset.ppF === 'q') onFilter(host, st.s, e); });
    }
    load().then(() => repaint(host, st.s));
  };
  window.stProspectsParts = { sectionHtml, stageTile, pipelineTile, visibleRows, payloadOf, drawerHtml, syncDrawer, tableHtml, filtersHtml, savedText, state: st };
})();
