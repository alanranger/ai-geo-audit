/**
 * Marketing & Campaigns → Customers: mix-and-match customer search (ALL / ANY / NONE groups), column presets, server-side
 * paging, person timeline with "why in / out", and versioned saved groups. Everything runs through
 * /api/aigeo/marketing with the admin key; the browser only sends a structured query built from the server's allowlist.
 */
(function () {
  const API = '/api/aigeo/marketing';
  const PREFS = 'mk-query-prefs-v1';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const gbp = (v) => (v == null ? '—' : `£${Math.round(Number(v)).toLocaleString('en-GB')}`);
  const ukDate = (iso) => (iso ? new Date(String(iso).length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '—');
  const emptyQuery = () => ({ type: 'group', match: 'all', items: [] });
  const S = { cat: null, query: emptyQuery(), preset: 'overview', cols: null, sort: 'spend_net', dir: 'desc', page: 0, show: 'yes', result: null, group: null, host: null };

  async function api(method, query, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`${API}${query || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; } };
  const savePrefs = () => localStorage.setItem(PREFS, JSON.stringify({ preset: S.preset, cols: S.cols, sort: S.sort, dir: S.dir }));

  /* ---------- worked examples (spec section 6) ---------- */

  const C = (field, op, value) => ({ type: 'cond', field, op, value });
  const G = (match, items) => ({ type: 'group', match, items });
  const EXAMPLES = [
    ['1 Beginners, 30 mi, no Lightroom', G('all', [C('booking', 'exists', { cats: ['beginners'] }), C('booking', 'none', { cats: ['lightroom'] }), C('miles', 'lte', 30), C('eligible', 'is_true')])],
    ['2 Valuable, lapsed 12 mo, clicked', G('all', [G('any', [C('spend_net', 'gte', 300), C('orders', 'gte', 2)]), C('purchase', 'none', { within: { n: 12, unit: 'months' } }), C('future_booking', 'none', {}), C('click', 'exists', { within: { n: 180, unit: 'days' } }), C('eligible', 'is_true')])],
    ['3 Residential/landscape, not Norfolk', G('all', [C('booking', 'exists', { cats: ['residential', 'day_workshop'] }), C('booking', 'none', { title_contains: 'norfolk' }), G('any', [C('click', 'exists', { url_contains: 'landscape', within: { n: 365, unit: 'days' } }), C('booking', 'exists', { cats: ['residential'], within: { n: 36, unit: 'months' } })]), C('eligible', 'is_true')])],
    ['4 Academy trial, not converted', G('all', [C('academy', 'in', ['trial']), C('eligible', 'is_true')])],
    ['5 Voucher / repeat buyers', G('all', [G('any', [C('booking', 'exists', { cats: ['voucher_bought'] }), C('bought_for_others', 'gte', 1), C('orders', 'gte', 2)]), C('last_emailed', 'older_than', { n: 14, unit: 'days' }), C('eligible', 'is_true')])],
    ['6 @yahoo.com, never bought (review only)', G('all', [C('email_domain', 'is', 'yahoo.com'), C('orders', 'eq', 0), C('future_booking', 'none', {}), C('academy', 'not_in', ['member']), C('history_incomplete', 'is_false')])],
    ['7 Identity review', G('any', [C('identity_review', 'is_true'), C('contact_kind', 'in', ['admin'])])]
  ];

  /* ---------- builder ---------- */

  const field = (k) => S.cat.fields.find((f) => f.key === k);
  const OP = { is_true: 'is yes', is_false: 'is no', gte: 'at least', lte: 'at most', eq: 'exactly', between: 'between', after: 'on or after', before: 'before', within_last: 'within the last', older_than: 'more than … ago', known: 'is known', unknown: 'is unknown', is: 'is', is_not: 'is not', in: 'is one of', not_in: 'is none of', exists: 'has at least one', none: 'has no' };

  function fieldSelect(cur) {
    const groups = [...new Set(S.cat.fields.map((f) => f.group))];
    return `<select data-q="field">${groups.map((g) => `<optgroup label="${esc(g)}">${S.cat.fields.filter((f) => f.group === g).map((f) => `<option value="${f.key}" ${f.key === cur ? 'selected' : ''} ${f.stage === 'B' ? 'disabled' : ''}>${esc(f.label)}${f.stage === 'B' ? ' (Stage B)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`;
  }
  const opSelect = (f, cur) => `<select data-q="op">${f.ops.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${OP[o] || o}</option>`).join('')}</select>`;
  const inp = (k, v, type = 'text', w = '7rem', ph = '') => `<input data-q="${k}" type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" style="width:${w}">`;
  const unitSel = (k, v) => `<select data-q="${k}"><option value="days" ${v !== 'months' ? 'selected' : ''}>days</option><option value="months" ${v === 'months' ? 'selected' : ''}>months</option></select>`;
  const multi = (k, opts, cur) => `<select data-q="${k}" multiple size="3">${opts.map((o) => `<option value="${o}" ${(cur || []).includes(o) ? 'selected' : ''}>${esc(o.replace(/_/g, ' '))}</option>`).join('')}</select>`;

  function recordInputs(f, v = {}) {
    const cats = f.records === 'clicks' ? '' : multi('cats', S.cat.categories, v.cats);
    const text = f.records === 'clicks' ? inp('url_contains', v.url_contains, 'text', '9rem', 'link contains') : inp('title_contains', v.title_contains, 'text', '8rem', 'name contains');
    const time = f.records === 'bookings' ? `<select data-q="time"><option value="">any time</option><option value="past" ${v.time === 'past' ? 'selected' : ''}>past</option><option value="future" ${v.time === 'future' ? 'selected' : ''}>still to come</option></select>` : '';
    const money = f.records === 'purchases' ? inp('min_net', v.min_net, 'number', '5rem', 'min £') : '';
    return `<span class="mq-rec">${cats}${text}${time}<span class="rt-sub">in last</span>${inp('within_n', v.within?.n, 'number', '4rem')}${unitSel('within_unit', v.within?.unit)}<span class="rt-sub">after</span>${inp('after', v.after, 'date', '9rem')}<span class="rt-sub">before</span>${inp('before', v.before, 'date', '9rem')}${money}</span>`;
  }

  const INPUT_TYPE = { date: 'date', number: 'number' };
  const pair = (f, v) => `${inp('a', v?.[0], INPUT_TYPE[f.type] || 'number', '8rem')} and ${inp('b', v?.[1], INPUT_TYPE[f.type] || 'number', '8rem')}`;
  const plain = (f, op, v) => inp('v', Array.isArray(v) ? v.join(', ') : v, INPUT_TYPE[f.type] || 'text', '9rem', op === 'in' ? 'comma, separated' : '');
  function valueInputs(f, op, v) {
    if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return '';
    if (f.type === 'records') return recordInputs(f, v || {});
    if (op === 'between') return pair(f, v);
    if (op === 'within_last' || op === 'older_than') return `${inp('n', v?.n, 'number', '4rem')}${unitSel('unit', v?.unit)}`;
    if (f.type === 'enum') return multi('list', f.options, Array.isArray(v) ? v : []);
    return plain(f, op, v);
  }

  function condHtml(c) {
    const f = field(c.field) || S.cat.fields[0];
    const op = f.ops.includes(c.op) ? c.op : f.ops[0];
    return `<div class="mq-cond" data-node="cond">${fieldSelect(f.key)}${opSelect(f, op)}<span class="mq-val">${valueInputs(f, op, c.value)}</span><button type="button" class="mq-x" data-q-act="remove" title="Remove">×</button></div>`;
  }
  function groupHtml(g, root) {
    const sel = `<select data-q="match">${['all', 'any', 'none'].map((m) => `<option value="${m}" ${g.match === m ? 'selected' : ''}>${{ all: 'ALL of these', any: 'ANY of these', none: 'NONE of these' }[m]}</option>`).join('')}</select>`;
    const items = (g.items || []).map((it) => (it.type === 'group' ? groupHtml(it, false) : condHtml(it))).join('');
    return `<div class="mq-group mq-${g.match}" data-node="group">${sel} <button type="button" class="rf-btn rf-btn-secondary" data-q-act="add-cond">+ condition</button> <button type="button" class="rf-btn rf-btn-secondary" data-q-act="add-group">+ group</button>${root ? '' : ' <button type="button" class="mq-x" data-q-act="remove" title="Remove group">×</button>'}<div class="mq-items">${items || '<span class="rt-sub">No conditions: everyone.</span>'}</div></div>`;
  }

  /* ---------- read the builder back into a query ---------- */

  const val = (el, k) => el.querySelector(`:scope > .mq-val [data-q="${k}"]`)?.value ?? '';
  const sel = (el, k) => [...(el.querySelector(`:scope > .mq-val [data-q="${k}"]`)?.selectedOptions || [])].map((o) => o.value);
  const numOrNull = (s) => (s === '' ? null : Number(s));

  function readRecord(el) {
    const out = {};
    const cats = sel(el, 'cats');
    if (cats.length) out.cats = cats;
    ['title_contains', 'url_contains', 'time', 'after', 'before'].forEach((k) => { if (val(el, k)) out[k] = val(el, k); });
    if (val(el, 'within_n')) out.within = { n: Number(val(el, 'within_n')), unit: val(el, 'within_unit') || 'days' };
    if (val(el, 'min_net') !== '') out.min_net = Number(val(el, 'min_net'));
    return out;
  }
  function readValue(el, f, op) {
    if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return null;
    if (f.type === 'records') return readRecord(el);
    if (op === 'between') return f.type === 'date' ? [val(el, 'a'), val(el, 'b')] : [numOrNull(val(el, 'a')), numOrNull(val(el, 'b'))];
    if (op === 'within_last' || op === 'older_than') return { n: Number(val(el, 'n')), unit: val(el, 'unit') || 'days' };
    if (f.type === 'enum') return sel(el, 'list');
    if (op === 'in') return val(el, 'v').split(',').map((s) => s.trim()).filter(Boolean);
    return f.type === 'number' ? numOrNull(val(el, 'v')) : val(el, 'v');
  }
  function readNode(el) {
    if (el.dataset.node === 'cond') {
      const f = field(el.querySelector(':scope > [data-q="field"]').value);
      const op = el.querySelector(':scope > [data-q="op"]').value;
      return { type: 'cond', field: f.key, op, value: readValue(el, f, op) };
    }
    return { type: 'group', match: el.querySelector(':scope > [data-q="match"]').value, items: [...el.querySelector(':scope > .mq-items').children].filter((c) => c.dataset.node).map(readNode) };
  }
  const readQuery = () => readNode(S.host.querySelector('#mq-builder > .mq-group'));

  /* ---------- results ---------- */

  const colsNow = () => S.cols || S.cat.presets[S.preset].columns;
  function cell(key, v, row) {
    const c = S.cat.columns[key];
    if (v == null || v === '') return '<span class="rt-sub">—</span>';
    if (typeof v === 'boolean') return v ? '<span class="rt-pill ok">YES</span>' : '<span class="rt-pill">NO</span>';
    if (c.money) return gbp(v);
    if (c.date) return `${ukDate(v)}${key === 'next_event' && row.next_title ? `<div class="rt-sub">${esc(row.next_title)}</div>` : ''}`;
    return esc(typeof v === 'number' ? n(v) : v);
  }
  function headerHtml(r) {
    const h = r.header;
    const unk = r.results.unknown;
    return `<div class="mq-head"><b>${n(h.people)}</b> people ${S.show === 'unknown' ? '<b>undecided</b>' : 'match'} · <b>${n(h.eligible_addresses)}</b> emailable addresses · known net ${gbp(h.spend_net)} <span class="rt-sub">(+ ${gbp(h.spend_probable)} probable, name match)</span> · ${n(h.orders)} orders · ${n(h.bookings)} bookings · ${n(h.places)} places`
      + ` · <button type="button" class="mq-link" data-q-act="toggle-unknown">${S.show === 'unknown' ? 'back to matches' : `${n(unk)} undecided (unknown data) — review`}</button><div class="rt-sub">${n(r.results.no)} don't match · as of ${new Date(r.as_of).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${r.ms} ms · email activity ${r.engagement_coverage?.is_complete ? `complete (${n(r.engagement_coverage.campaigns)} campaigns)` : 'incomplete — email filters stay unknown'}${r.academy_feed ? '' : ' · Academy feed unavailable (Academy filters unknown)'}</div></div>`;
  }
  function tableHtml(r) {
    const cols = r.columns;
    const th = cols.map((k) => `<th class="${k === 'name' ? 'left mq-sticky' : ''}" data-q-sort="${k}" title="Sort">${esc(S.cat.columns[k].label)}${r.sort === k ? (r.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const rows = r.rows.map((row) => `<tr data-q-person="${row.person_id}">${cols.map((k) => `<td class="${k === 'name' ? 'left mq-sticky' : (['email', 'last_product', 'sources', 'suppressed', 'last_category'].includes(k) ? 'left' : '')}">${cell(k, row.cells[k], row)}</td>`).join('')}</tr>`).join('');
    const pages = Math.max(1, Math.ceil(r.total / r.page_size));
    const nav = `<div class="mk-params"><button type="button" class="rf-btn rf-btn-secondary" data-q-page="${r.page - 1}" ${r.page <= 0 ? 'disabled' : ''}>‹ Prev</button> <span class="rt-sub" id="mq-pageinfo">Page ${r.page + 1} of ${pages} · ${n(r.total)} people</span> <button type="button" class="rf-btn rf-btn-secondary" data-q-page="${r.page + 1}" ${r.page + 1 >= pages ? 'disabled' : ''}>Next ›</button></div>`;
    return `${headerHtml(r)}${nav}<div class="mk-wide"><table class="rt-table" id="mq-table"><thead><tr>${th}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="rt-sub">No one.</td></tr>`}</tbody></table></div>${nav}`;
  }
  function columnsPicker() {
    const on = new Set(colsNow());
    return `<details class="mq-cols"><summary class="rt-sub">Columns…</summary>${Object.entries(S.cat.columns).map(([k, c]) => `<label class="mq-colopt"><input type="checkbox" data-q-col="${k}" ${on.has(k) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</details>`;
  }

  async function run(page = 0) {
    const out = S.host.querySelector('#mq-results');
    S.query = readQuery();
    S.page = page;
    out.innerHTML = '<div class="rt-loading">Running…</div>';
    try {
      S.result = await api('POST', '', { action: 'query-run', query: { root: S.query }, sort: S.sort, dir: S.dir, page, columns: colsNow(), show: S.show });
      S.host.querySelector('#mq-english').textContent = S.result.english;
      out.innerHTML = tableHtml(S.result);
    } catch (e) {
      out.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`;
    }
  }

  /* ---------- person detail ---------- */

  const RES = { yes: '<b class="mq-yes">✓</b>', no: '<span class="mq-no">✗</span>', unknown: '<span class="mq-unk" title="unknown — not counted as yes or no">?</span>' };
  function whyHtml(w) {
    if (!w) return '';
    return `<h4>Why ${w.result === 'yes' ? 'in' : (w.result === 'unknown' ? 'undecided' : 'out')} ${RES[w.result]}</h4><ul class="mk-seglist">${w.lines.map((l) => `<li style="padding-left:${l.depth * 1.1}rem">${RES[l.result]} ${esc(l.text)}${l.evidence ? ` <span class="rt-sub">— ${esc(l.evidence)}</span>` : ''}</li>`).join('')}</ul>`;
  }
  const KIND = { purchase: 'Purchase', plan: 'Plan', booking: 'Booking', upcoming: 'Upcoming', email_delivered: 'Email', email_opened: 'Opened', email_clicked: 'Clicked', email_unsubscribed: 'Unsubscribed', consent: 'Consent' };
  function timelineHtml(t) {
    const rows = t.map((x) => `<tr class="mq-tl-${esc(x.kind)}"><td>${ukDate(x.date)}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="left">${esc(x.text)}${x.level === 'p' ? ' <span class="mk-chip prob">probable</span>' : ''}${x.for_other ? ' <span class="mk-chip">for someone else</span>' : ''}${x.cancelled ? ' <span class="mk-chip warn">cancelled</span>' : ''}${x.refunded ? ` <span class="rt-sub">(refunded ${gbp(x.refunded)})</span>` : ''}</td><td>${x.amount != null ? gbp(x.amount) : ''}</td></tr>`).join('');
    return `<h4>Timeline</h4><div class="mq-tl"><table class="rt-table"><thead><tr><th>Date</th><th>What</th><th class="left">Detail</th><th>£</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="rt-sub">Nothing recorded.</td></tr>'}</tbody></table></div>`;
  }
  function valueLine(v) {
    if (!v) return '';
    const s = v.c.by_src || {};
    const split = `<div class="mq-split"><span>Orders ${gbp(s.squarespace || 0)}</span> · <span>Booking Sheet ${gbp(s.booking_sheet || 0)}</span> · <span>Plan payments ${gbp(s.plan || 0)}</span> · <b>Total ${gbp(v.c.net)}</b> <span class="rt-sub">· last 12 months ${gbp(v.c.r12_net)}</span></div>`;
    return `${split}<p class="rt-sub">${n(v.c.orders)} orders, ${n(v.c.places)} places, avg order ${gbp(v.c.aov)}, refunded ${gbp(v.c.refunds)}${v.c.plan_payments ? `, ${n(v.c.plan_payments)} plan payments` : ''}${v.p.orders ? ` · probable extra ${gbp(v.p.net)} from ${n(v.p.orders)} Booking Sheet sale(s) by name` : ''} · first ${ukDate(v.cp.first)} · last ${ukDate(v.cp.last)}. Plan-funded events and "Pick n Mix Out" redemptions are shown but not added again.</p>`;
  }
  /** Booking Sheet name records shown under this contact (probable, never confirmed evidence) — each can be separated. */
  function shownUnderHtml(list) {
    if (!list?.length) return '';
    const li = list.map((r) => `<li>${esc(r.name || '—')} <span class="mk-chip prob">probable</span> <span class="rt-sub">${r.links} record(s)${r.attached ? '' : ' · kept separate'}</span>${r.attached ? ` <button type="button" class="rf-btn rf-btn-secondary" data-q-separate="${esc(r.person_id)}">Not the same person — separate</button>` : ''}</li>`).join('');
    return `<h4>Booking Sheet records shown under this person</h4><ul class="mk-seglist">${li}</ul><p class="rt-sub">Exact-name matches to this one contact. Shown here as probable history, never as confirmed evidence, and never used for "has no …" rules.</p>`;
  }
  async function separate(personId) {
    const reason = window.prompt('Why is this a different person? (10+ characters, logged)');
    if (!reason) return;
    const box = S.host.querySelector('#mq-detail');
    const owner = box.querySelector('[data-q-detail]')?.dataset.qDetail;
    box.insertAdjacentHTML('afterbegin', '<div class="rt-loading">Separating and rebuilding the customer view (about a minute)…</div>');
    await api('POST', '', { action: 'identity-separate', person_id: personId, reason });
    await run(S.page);
    if (owner) await detail(owner);
  }
  async function detail(id) {
    const box = S.host.querySelector('#mq-detail');
    box.innerHTML = '<div class="rt-loading">Loading person…</div>';
    try {
      const p = await api('POST', '', { action: 'customer-why', person_id: id, query: { root: S.query } });
      const segs = p.segments.map((s) => `<li>${s.reason ? '<span class="rt-sub">✗</span>' : '<b>✓</b>'} ${esc(s.name)}</li>`).join('');
      box.innerHTML = `<div class="mk-detail" data-q-detail="${esc(id)}"><h4>${esc(p.name || '—')} <span class="rt-sub">${esc(p.email || p.kind)}</span>${p.record_type !== 'person' ? ` <span class="mk-chip">${esc(p.record_type)}</span>` : ''} <button type="button" class="mq-x" data-q-act="close-detail" title="Close">×</button></h4>${valueLine(p.value)}<div class="two"><div>${whyHtml(p.why)}${shownUnderHtml(p.shown_under)}<h4>Segments &amp; groups</h4><ul class="mk-seglist">${segs}</ul></div><div>${timelineHtml(p.timeline)}</div></div></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      box.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`;
    }
  }

  /* ---------- saved groups ---------- */

  function groupsHtml(list) {
    const rows = list.map((g) => `<tr><td class="left"><b>${esc(g.name)}</b> <span class="mk-chip">v${g.version}</span><div class="rt-sub">${esc(g.english)}</div></td><td>${g.last_check ? `${n((g.last_check.counts || {}).yes)} on ${ukDate(g.last_check.evaluated_at)}` : '<span class="rt-sub">not checked</span>'}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-q-load="${esc(g.segment_id)}">Open</button> <button type="button" class="rf-btn rf-btn-secondary" data-q-check="${esc(g.segment_id)}">Check: who joined / left</button></td></tr>`).join('');
    return `<table class="rt-table" id="mq-groups-table"><thead><tr><th class="left">Saved group</th><th>Last check</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="rt-sub">None saved yet.</td></tr>'}</tbody></table><div id="mq-diff"></div>`;
  }
  async function loadGroups() {
    const box = S.host.querySelector('#mq-groups');
    try { S.groups = (await api('GET', '?action=groups')).groups; box.innerHTML = groupsHtml(S.groups); } catch (e) { box.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
  }
  async function saveGroupNow() {
    const out = S.host.querySelector('#mq-save-out');
    const name = S.host.querySelector('#mq-g-name').value;
    out.textContent = 'Saving…';
    try {
      const r = await api('POST', '', { action: 'group-save', segment_id: S.group?.segment_id || undefined, name, purpose: S.host.querySelector('#mq-g-purpose').value, query: { root: readQuery() } });
      S.group = { segment_id: r.segment_id, name };
      out.innerHTML = `Saved as version ${r.version}. It also appears under Segments for audience snapshots.`;
      await loadGroups();
    } catch (e) { out.innerHTML = `<span class="mk-chip warn">${esc(e.message)}</span>`; }
  }
  const personList = (xs) => xs.map((p) => `<li>${esc(p.name || '—')} <span class="rt-sub">${esc(p.email || '')} — ${esc(p.why)}</span></li>`).join('');
  async function checkGroup(id) {
    const box = S.host.querySelector('#mq-diff');
    box.innerHTML = '<div class="rt-loading">Checking…</div>';
    try {
      const d = await api('POST', '', { action: 'group-preview', segment_id: id, record: true });
      box.innerHTML = `<div class="mk-detail"><p><b>${n(d.now)}</b> match now (v${d.version}) · ${d.last_check ? `${n(d.last_check.count)} at the last check (${ukDate(d.last_check.at)})` : 'first check'} · <b>${n(d.joined_count)}</b> joined · <b>${n(d.left_count)}</b> left · ${n(d.results.unknown)} undecided</p>`
        + `<div class="two"><div><h4>Joined</h4><ul class="mk-seglist">${personList(d.joined) || '<li class="rt-sub">Nobody.</li>'}</ul></div><div><h4>Left</h4><ul class="mk-seglist">${personList(d.left) || '<li class="rt-sub">Nobody.</li>'}</ul></div></div><p class="rt-sub">Recorded as the new check.</p></div>`;
      await loadGroups();
    } catch (e) { box.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
  }

  /* ---------- shell + events ---------- */

  const STYLE = `<style>
    .mq-group { border-left: 3px solid #3b82f6; padding: 0.35rem 0 0.35rem 0.6rem; margin: 0.35rem 0; background: rgba(59,130,246,0.04); }
    .mq-group.mq-any { border-left-color: #a855f7; background: rgba(168,85,247,0.05); } .mq-group.mq-none { border-left-color: #f59e0b; background: rgba(245,158,11,0.05); }
    .mq-items { margin-top: 0.35rem; } .mq-cond { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; margin: 0.25rem 0; }
    .mq-cond select, .mq-cond input, .mq-group > select { background: #0b1118; color: #e5e7eb; border: 1px solid #334155; border-radius: 4px; padding: 2px 4px; font-size: 12px; }
    .mq-rec { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; } .mq-x { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; }
    .mq-english { margin: 0.5rem 0; padding: 0.45rem 0.7rem; background: #0b1118; border: 1px solid #334155; border-radius: 6px; font-size: 0.9rem; }
    .mq-ex { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.4rem 0; } .mq-ex .rf-btn { font-size: 11px; padding: 2px 8px; }
    .mq-head { margin: 0.6rem 0 0.2rem; } .mq-link { background: none; border: none; color: #93c5fd; cursor: pointer; text-decoration: underline; padding: 0; font: inherit; }
    #mq-table th { cursor: pointer; white-space: nowrap; } #mq-table tbody tr { cursor: pointer; } #mq-table tbody tr:hover td { background: #111827; }
    #mq-table .mq-sticky { position: sticky; left: 0; background: #0f172a; z-index: 1; min-width: 10rem; }
    .mq-cols { display: inline-block; margin-left: 0.6rem; } .mq-colopt { display: inline-block; margin: 2px 8px 2px 0; font-size: 12px; }
    .mq-yes { color: #4ade80; } .mq-no { color: #f87171; } .mq-unk { color: #fbbf24; font-weight: 700; }
    .mq-tl { max-height: 26rem; overflow-y: auto; } .mq-tl-purchase td { color: #e5e7eb; } .mq-tl-email_delivered td { color: #94a3b8; }
  </style>`;

  function shell() {
    const presets = Object.entries(S.cat.presets).map(([k, p]) => `<option value="${k}" ${S.preset === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    return `${STYLE}<h3>Customers</h3><p class="rt-sub">Build any mix of conditions. A condition on bookings, purchases or clicks is tested on one record at a time (e.g. the same click must be a Lightroom link <i>and</i> within 90 days). Unknown data never counts as "no": undecided people are counted apart and can be reviewed. Money is each sale counted once (Squarespace orders + Booking Sheet sales that aren't Squarespace orders); Booking Sheet sales carry a name only, so they are "probable" for a contact.</p>`
      + `<div class="mq-ex"><span class="rt-sub">Examples:</span>${EXAMPLES.map(([label], i) => `<button type="button" class="rf-btn rf-btn-secondary" data-q-ex="${i}">${esc(label)}</button>`).join('')}<button type="button" class="rf-btn rf-btn-secondary" data-q-act="clear">Clear all</button></div>`
      + `<div id="mq-builder">${groupHtml(S.query, true)}</div><div class="mq-english" id="mq-english">Press Run to see what this filter means.</div>`
      + `<div class="mk-params"><button type="button" class="rf-btn" data-q-act="run">Run</button> <label class="st-ov-f mk-f">Columns<select id="mq-preset">${presets}</select></label>${columnsPicker()}</div>`
      + '<div id="mq-results"></div><div id="mq-detail"></div>'
      + `<h4>Saved groups</h4><div class="mk-params"><label class="st-ov-f mk-f">Group name<input id="mq-g-name" type="text" maxlength="120" style="width:16rem"></label><label class="st-ov-f mk-f">Purpose<input id="mq-g-purpose" type="text" maxlength="200" style="width:16rem" placeholder="e.g. Jan Lightroom launch"></label><button type="button" class="rf-btn rf-btn-secondary" data-q-act="save-group">Save current filter as a group</button> <span id="mq-save-out" class="rt-sub"></span></div><div id="mq-groups"><div class="rt-loading">Loading saved groups…</div></div>`;
  }

  function paint() { S.host.querySelector('#mq-builder').innerHTML = groupHtml(S.query, true); }
  function nodeAt(el) {
    const path = [];
    for (let cur = el; cur && cur.id !== 'mq-builder'; cur = cur.parentElement) {
      if (cur.dataset?.node) path.unshift([...cur.parentElement.children].filter((c) => c.dataset.node).indexOf(cur));
    }
    return path.slice(1);
  }
  function at(path) { return path.reduce((g, i) => g.items[i], S.query); }
  function structural(act, el) {
    S.query = readQuery();
    const path = nodeAt(el.closest('[data-node]'));
    const target = at(path.slice(0, act === 'remove' ? -1 : undefined));
    if (act === 'add-cond') target.items.push({ type: 'cond', field: 'eligible', op: 'is_true', value: null });
    if (act === 'add-group') target.items.push({ type: 'group', match: 'any', items: [{ type: 'cond', field: 'orders', op: 'gte', value: 1 }] });
    if (act === 'remove') target.items.splice(path[path.length - 1], 1);
    paint();
  }

  const ACTS = {
    run: () => run(0), clear: () => { S.query = emptyQuery(); S.group = null; paint(); return run(0); },
    'toggle-unknown': () => { S.show = S.show === 'unknown' ? 'yes' : 'unknown'; return run(0); },
    'close-detail': () => { S.host.querySelector('#mq-detail').innerHTML = ''; }, 'save-group': saveGroupNow
  };
  function openGroup(id) {
    const g = S.groups.find((x) => x.segment_id === id);
    S.query = JSON.parse(JSON.stringify(g.query.root));
    S.group = { segment_id: g.segment_id, name: g.name };
    S.host.querySelector('#mq-g-name').value = g.name;
    S.host.querySelector('#mq-g-purpose').value = g.purpose || '';
    paint();
    return run(0);
  }
  function onClick(e) {
    const t = e.target;
    const act = t.closest('[data-q-act]')?.dataset.qAct;
    if (['add-cond', 'add-group', 'remove'].includes(act)) return structural(act, t);
    if (act) return ACTS[act]();
    const ex = t.closest('[data-q-ex]');
    if (ex) { S.query = JSON.parse(JSON.stringify(EXAMPLES[Number(ex.dataset.qEx)][1])); S.group = null; paint(); return run(0); }
    const srt = t.closest('[data-q-sort]');
    if (srt) { S.dir = S.sort === srt.dataset.qSort && S.dir === 'desc' ? 'asc' : 'desc'; S.sort = srt.dataset.qSort; savePrefs(); return run(0); }
    if (t.closest('[data-q-page]')) return run(Number(t.closest('[data-q-page]').dataset.qPage));
    if (t.closest('[data-q-person]')) return detail(t.closest('[data-q-person]').dataset.qPerson);
    if (t.closest('[data-q-load]')) return openGroup(t.closest('[data-q-load]').dataset.qLoad);
    if (t.closest('[data-q-check]')) return checkGroup(t.closest('[data-q-check]').dataset.qCheck);
    if (t.closest('[data-q-separate]')) return separate(t.closest('[data-q-separate]').dataset.qSeparate);
    return null;
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'mq-preset') { S.preset = t.value; S.cols = null; savePrefs(); S.host.querySelector('.mq-cols').outerHTML = columnsPicker(); return run(S.page); }
    if (t.dataset.qCol) { S.cols = [...S.host.querySelectorAll('[data-q-col]:checked')].map((c) => c.dataset.qCol); savePrefs(); return run(S.page); }
    if (t.dataset.q === 'field' || t.dataset.q === 'op') { S.query = readQuery(); paint(); }
    return null;
  }

  /** Open a segment's own definition here (same evaluator → same count), with "can be emailed" added as segments do. */
  let pendingOpen = null;
  window.mkOpenQuery = function mkOpenQuery(root, name) {
    if (!S.host || !S.cat || !S.ready) { pendingOpen = [root, name]; return null; }
    const base = JSON.parse(JSON.stringify(root));
    const gate = C('eligible', 'is_true');
    if (JSON.stringify(base).includes('"field":"eligible"')) S.query = base;
    else S.query = base.match === 'all' ? { ...base, items: [...base.items, gate] } : G('all', [base, gate]);
    S.group = null;
    S.host.querySelector('#mq-g-name').value = name ? `${name} (copy)` : '';
    paint();
    S.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return run(0);
  };

  /** Called by the Marketing tab once its data has loaded. */
  window.mkMountQuery = async function mkMountQuery(host) {
    S.host = host;
    S.ready = false;
    try {
      S.cat = await api('GET', '?action=query-fields');
      S.cat.categories = S.cat.fields.find((f) => f.key === 'last_category').options;
      Object.assign(S, loadPrefs());
      if (S.cols && !S.cols.every((c) => S.cat.columns[c])) S.cols = null;
      if (!S.cat.presets[S.preset]) S.preset = 'overview';
      host.innerHTML = shell();
      host.addEventListener('click', (e) => { Promise.resolve(onClick(e)).catch((err) => console.error(err)); });
      host.addEventListener('change', (e) => { Promise.resolve(onChange(e)).catch((err) => console.error(err)); });
      host.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('#mq-builder')) { e.preventDefault(); run(0); } });
      await Promise.all([run(0), loadGroups()]);
      S.ready = true;
      if (pendingOpen) { const [r, n] = pendingOpen; pendingOpen = null; await window.mkOpenQuery(r, n); }
    } catch (e) {
      host.innerHTML = `<h3>Customers</h3><div class="rt-error">${esc(e.message)}</div>`;
    }
  };
})();
