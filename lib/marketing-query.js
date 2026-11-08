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
  const S = { cat: null, query: emptyQuery(), quick: {}, summary: null, preset: 'overview', cols: null, sort: 'spend_net', dir: 'desc', page: 0, show: 'yes', result: null, group: null, host: null };

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
  const months = (k) => ({ n: k, unit: 'months' });
  /** The 12 everyday recipes (GPT addendum 7 Nov). Each uses only the visible controls; 9 picks the latest campaign. */
  const EXAMPLES = [
    ['1 Local Lightroom progression', G('all', [C('booking', 'exists', { cats: ['beginners'] }), C('booking', 'none', { cats: ['lightroom'] }), C('miles', 'lte', 30), C('eligible', 'is_true')])],
    ['2 Macro / creative interest', G('all', [G('any', [C('booking', 'exists', { cats: ['abstract_macro'] }), C('click', 'exists', { topics: ['macro'], within: months(12) })]), C('future_booking', 'none', { cats: ['abstract_macro'] }), C('eligible', 'is_true')])],
    ['3 Residential', G('all', [G('any', [C('booking', 'exists', { cats: ['residential'] }), C('click', 'exists', { topics: ['away'], within: months(12) })]), C('open_band', 'in', ['warm', 'cooling', 'cooling_partial']), C('future_booking', 'none', { cats: ['residential'] }), C('eligible', 'is_true')])],
    ['4 Valuable returning clients', G('all', [G('any', [C('spend_net', 'gte', 500), C('orders', 'gte', 3)]), C('purchase', 'exists', { within: months(24) }), C('eligible', 'is_true')])],
    ['5 Reconnect (no purchase 18 mo)', G('all', [C('purchase', 'exists', {}), C('purchase', 'none', { within: months(18) }), C('future_booking', 'none', {}), C('eligible', 'is_true')])],
    ['6 Gift audience', G('all', [G('any', [C('purchase', 'exists', { cats: ['voucher_bought'] }), C('bought_for_others', 'gte', 1), C('orders', 'gte', 2)]), C('last_emailed', 'older_than', { n: 7, unit: 'days' }), C('eligible', 'is_true')])],
    ['7 Pick n Mix candidates', G('all', [C('booking', 'exists', { cats: ['beginners'], time: 'past', within: months(12) }), C('pnm_status', 'not_in', ['active', 'starting']), C('eligible', 'is_true')])],
    ['8 Academy trial ended, not paying', G('all', [C('academy_status', 'in', ['trial_expired']), C('academy_trial_end', 'within_last', { n: 90, unit: 'days' }), C('eligible', 'is_true')])],
    ['9 Opened latest email, no click', (cat) => { const c = cat.campaigns?.[0]; const v = c ? { email_id: c.id, campaign_label: `${ukShort(c.sent_on)} · ${c.subject.slice(0, 60)}` } : {}; return G('all', [C('campaign_opened', 'exists', v), C('click', 'none', v), C('eligible', 'is_true')]); }],
    ['10 Broad: engaged, any history', G('all', [C('open_band', 'in', ['warm', 'cooling', 'cooling_partial']), C('eligible', 'is_true')])],
    ['11 Clean-up review (never bought, silent 12 mo)', G('all', [C('record_type', 'in', ['person']), C('orders', 'eq', 0), C('future_booking', 'none', {}), C('identity_review', 'is_false'), C('history_incomplete', 'is_false'), C('academy_status', 'in', ['never', 'account_only']), C('campaign_received', 'count_gte', { count: 6, within: months(12) }), C('campaign_opened', 'none', { within: months(12) }), C('click', 'none', { within: months(12) })])],
    ['12 Data repair', G('any', [C('has_location', 'is_false'), C('identity_review', 'is_true'), C('history_incomplete', 'is_true')])]
  ];
  const exampleQuery = (i) => { const q = EXAMPLES[i][1]; return JSON.parse(JSON.stringify(typeof q === 'function' ? q(S.cat) : q)); };

  /* ---------- builder ---------- */

  const field = (k) => S.cat.fields.find((f) => f.key === k);
  const OP = { is_true: 'is yes', is_false: 'is no', gte: 'at least', lte: 'at most', eq: 'exactly', between: 'between', after: 'on or after', before: 'before', within_last: 'within the last', older_than: 'more than … ago', known: 'is known', unknown: 'is unknown', is: 'is', is_not: 'is not', in: 'is one of', not_in: 'is none of', exists: 'has at least one', none: 'has no', count_gte: 'at least N times', count_lte: 'at most N times', sum_gte: 'total at least £', sum_lte: 'total at most £', last_months: 'in the last' };
  const optLabel = (o) => S.cat.option_labels?.[o] || String(o).replace(/_/g, ' ');

  /** Field chooser: a button showing the readable name; the searchable grouped list opens in a popover. */
  function fieldSelect(cur) {
    const f = field(cur);
    return `<input type="hidden" data-q="field" value="${esc(cur)}"><button type="button" class="mq-fbtn" data-q-act="pick-field" title="${esc(f?.hint || '')}">${esc(f?.label || cur)} ▾</button>`;
  }
  function pickerHtml(filter) {
    const q = String(filter || '').toLowerCase();
    const groups = [...new Set(S.cat.fields.map((x) => x.group))];
    const item = (x) => (x.stage === 'B'
      ? `<div class="mq-fopt off" title="${esc(x.reason || '')}">${esc(x.label)} <span class="rt-sub">— not available: ${esc(x.reason || 'Stage B')}</span></div>`
      : `<button type="button" class="mq-fopt" data-q-pick="${x.key}">${esc(x.label)}${x.hint ? ` <span class="rt-sub">${esc(x.hint)}</span>` : ''}</button>`);
    const body = groups.map((g) => {
      const list = S.cat.fields.filter((x) => x.group === g && (!q || `${x.label} ${g}`.toLowerCase().includes(q)));
      return list.length ? `<div class="mq-fgroup"><div class="mq-fglab">${esc(g)}</div>${list.map(item).join('')}</div>` : '';
    }).join('');
    return body || '<div class="rt-sub">No field matches.</div>';
  }
  function openPicker(btn) {
    closePicker();
    const box = document.createElement('div');
    box.id = 'mq-fpick';
    box.innerHTML = `<input id="mq-fpick-q" type="search" placeholder="Find a field (e.g. Lightroom, opened, miles)"><div id="mq-fpick-list">${pickerHtml('')}</div>`;
    btn.insertAdjacentElement('afterend', box);
    S.pickFor = btn.closest('[data-node="cond"]');
    box.querySelector('#mq-fpick-q').focus();
  }
  function closePicker() { S.host?.querySelector('#mq-fpick')?.remove(); }
  function choosePicked(key) {
    const hidden = S.pickFor?.querySelector(':scope > [data-q="field"]');
    if (hidden) hidden.value = key;
    closePicker();
    S.query = readQuery();
    paint();
  }
  const opSelect = (f, cur) => (f.ops.length === 1 ? `<input type="hidden" data-q="op" value="${f.ops[0]}"><span class="rt-sub">${OP[f.ops[0]] || f.ops[0]}</span>` : `<select data-q="op">${f.ops.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${OP[o] || o}</option>`).join('')}</select>`);
  const inp = (k, v, type = 'text', w = '7rem', ph = '') => `<input data-q="${k}" type="${type}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" style="width:${w}">`;
  const unitSel = (k, v) => `<select data-q="${k}"><option value="days" ${v !== 'months' ? 'selected' : ''}>days</option><option value="months" ${v === 'months' ? 'selected' : ''}>months</option></select>`;
  /** Several choices as tick-chips with readable names (no ctrl-click multi-selects). */
  const multi = (k, opts, cur, label = optLabel) => `<span class="mq-ticks" data-q-ticks="${k}">${opts.map((o) => `<label class="mq-tick"><input type="checkbox" data-q-tick="${k}" value="${esc(o)}" ${(cur || []).includes(o) ? 'checked' : ''}> ${esc(label(o))}</label>`).join('')}</span>`;
  const ukShort = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
  function campaignSel(cur) {
    const opts = (S.cat.campaigns || []).map((c) => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(ukShort(c.sent_on))} · ${esc(c.subject.slice(0, 70))}</option>`).join('');
    return `<select data-q="email_id" class="mq-camp"><option value="">any campaign</option>${opts}</select>`;
  }
  const whenOf = (v) => (v.within ? 'within' : (v.after && v.before ? 'between' : (v.after ? 'after' : (v.before ? 'before' : 'any'))));
  /** One "when" choice, then only the inputs that choice needs. */
  function whenInputs(v) {
    const w = v._when || whenOf(v);
    const sel = `<select data-q="when">${[['any', 'any time'], ['within', 'in the last…'], ['after', 'on or after…'], ['before', 'before…'], ['between', 'between…']].map(([k, l]) => `<option value="${k}" ${w === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const parts = {
      within: () => `${inp('within_n', v.within?.n ?? 12, 'number', '4rem')}${unitSel('within_unit', v.within?.unit || 'months')}`,
      after: () => inp('after', v.after, 'date', '9rem'), before: () => inp('before', v.before, 'date', '9rem'),
      between: () => `${inp('after', v.after, 'date', '9rem')}<span class="rt-sub">and</span>${inp('before', v.before, 'date', '9rem')}`, any: () => ''
    };
    return `${sel}${parts[w]()}`;
  }
  const AGG_INPUT = { count_gte: ['count', 'times'], count_lte: ['count', 'times'], sum_gte: ['amount', '£'], sum_lte: ['amount', '£'] };
  function aggInput(op, v) {
    const a = AGG_INPUT[op];
    return a ? `${inp(a[0], v[a[0]] ?? (a[0] === 'count' ? 2 : 250), 'number', '5rem')}<span class="rt-sub">${a[1]}</span>` : '';
  }
  function whatInputs(f, v) {
    if (f.records === 'clicks') return `${campaignSel(v.email_id)}<span class="rt-sub">about</span>${multi('topics', (S.cat.topics || []).map((t) => t.key), v.topics, (k) => S.cat.topics.find((t) => t.key === k)?.label || k)}${inp('url_contains', v.url_contains, 'text', '8rem', 'or link contains')}`;
    if (f.records === 'deliveries' || f.records === 'opens') return campaignSel(v.email_id);
    const time = f.records === 'bookings' ? `<select data-q="time"><option value="">past or future</option><option value="past" ${v.time === 'past' ? 'selected' : ''}>past</option><option value="future" ${v.time === 'future' ? 'selected' : ''}>still to come</option></select>` : '';
    return `${multi('cats', S.cat.categories, v.cats)}${inp('title_contains', v.title_contains, 'text', '8rem', 'or name contains')}${time}`;
  }
  function recordInputs(f, op, v = {}) {
    return `<span class="mq-rec">${aggInput(op, v)}${whatInputs(f, v)}${whenInputs(v)}</span>`;
  }

  const INPUT_TYPE = { date: 'date', number: 'number' };
  const pair = (f, v) => `${inp('a', v?.[0], INPUT_TYPE[f.type] || 'number', '8rem')} and ${inp('b', v?.[1], INPUT_TYPE[f.type] || 'number', '8rem')}`;
  const plain = (f, op, v) => inp('v', Array.isArray(v) ? v.join(', ') : v, INPUT_TYPE[f.type] || 'text', '9rem', op === 'in' ? 'comma, separated' : '');
  function valueInputs(f, op, v) {
    if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return '';
    if (f.type === 'months') return `${inp('n', v?.n ?? 6, 'number', '4rem')}<span class="rt-sub">calendar months (3 / 6 / 12 / 24 or any whole number)</span>`;
    if (f.type === 'records') return recordInputs(f, op, v || {});
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
  const sel = (el, k) => [...el.querySelectorAll(`:scope > .mq-val [data-q-tick="${k}"]:checked`)].map((o) => o.value);
  const numOrNull = (s) => (s === '' ? null : Number(s));

  const WHEN_KEYS = { any: [], within: ['within'], after: ['after'], before: ['before'], between: ['after', 'before'] };
  function readWhen(el, out) {
    const w = val(el, 'when') || 'any';
    out._when = w;
    if (WHEN_KEYS[w].includes('within') && val(el, 'within_n')) out.within = { n: Number(val(el, 'within_n')), unit: val(el, 'within_unit') || 'months' };
    WHEN_KEYS[w].filter((k) => k !== 'within').forEach((k) => { if (val(el, k)) out[k] = val(el, k); });
  }
  function readRecord(el) {
    const out = {};
    const cats = sel(el, 'cats');
    if (cats.length) out.cats = cats;
    const topics = sel(el, 'topics');
    if (topics.length) out.topics = topics;
    ['title_contains', 'url_contains', 'time', 'email_id'].forEach((k) => { if (val(el, k)) out[k] = val(el, k); });
    const camp = out.email_id && (S.cat.campaigns || []).find((c) => c.id === out.email_id);
    if (camp) out.campaign_label = `${ukShort(camp.sent_on)} · ${camp.subject.slice(0, 60)}`;
    ['count', 'amount'].forEach((k) => { if (val(el, k) !== '') out[k] = Number(val(el, k)); });
    readWhen(el, out);
    return out;
  }
  function readValue(el, f, op) {
    if (['is_true', 'is_false', 'known', 'unknown'].includes(op)) return null;
    if (f.type === 'months') return { n: Number(val(el, 'n')) || 6 };
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
  const BAND = { warm: 'ok', cooling: 'amber', cooling_partial: 'amber', cold: '', none_recorded: '', insufficient: '', unknown: '' };
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
  function dateCell(key, v, row) {
    const sub = row.subs?.[key] || (key === 'next_event' ? row.next_title : null);
    return `${ukDate(v)}${sub ? `<div class="rt-sub">${esc(sub)}</div>` : ''}`;
  }
  function cell(key, v, row) {
    const c = S.cat.columns[key];
    if (isEmpty(v)) return '<span class="rt-sub">—</span>';
    if (typeof v === 'boolean') return v ? '<span class="rt-pill ok">YES</span>' : '<span class="rt-pill">NO</span>';
    if (c.money) return gbp(v);
    if (c.chips) return v.map((x) => `<span class="mq-cchip">${esc(optLabel(x).replace(/ course$/, ''))}</span>`).join(' ');
    if (key === 'open_band') return `<span class="mq-band ${BAND[v] ?? ''}">${esc(optLabel(v))}</span>`;
    if (c.option) return `<span class="mq-band">${esc(optLabel(v))}</span>`;
    if (c.date) return dateCell(key, v, row);
    return esc(typeof v === 'number' ? n(v) : v);
  }
  /** "+ O organisations + M owner addresses": the same split as the health panel (organisations stay listed as rows). */
  const apartLine = (h) => `${h.organisations ? ` · <span class="hb-owner" title="Organisation clients: listed as rows, counted apart from people">+ ${n(h.organisations)} organisation${h.organisations === 1 ? '' : 's'}</span>` : ''}${window.mkBadge ? window.mkBadge.ownerLine(h.owner_addresses) : ''}`;
  function coverageText(c) {
    if (!c) return '';
    if (c.is_complete) return `complete (${n(c.campaigns)} campaigns)`;
    if (c.covered) return `as of the last collected campaign (${ukDate(c.covered_through)}); ${n(c.pending)} sent in the last ${n(c.recent_pending_hours)} h still collecting`;
    return 'incomplete — "no response" / cold filters stay undecided';
  }
  function headerHtml(r) {
    const h = r.header;
    const unk = r.results.unknown;
    const owner = apartLine(h);
    return `<div class="mq-head"><b>${n(h.people)}</b> people ${S.show === 'unknown' ? '<b>undecided</b>' : 'match'}${owner} · <b>${n(h.eligible_addresses)}</b> emailable addresses · known net ${gbp(h.spend_net)} <span class="rt-sub">(+ ${gbp(h.spend_probable)} probable, name match)</span> · ${n(h.orders)} orders · ${n(h.bookings)} bookings · ${n(h.places)} places`
      + ` · <button type="button" class="mq-link" data-q-act="toggle-unknown">${S.show === 'unknown' ? 'back to matches' : `${n(unk)} undecided (unknown data) — review`}</button><div class="rt-sub">${n(r.results.no)} don't match · as of ${new Date(r.as_of).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ${r.ms} ms · email activity ${coverageText(r.engagement_coverage)}${r.academy_feed ? '' : ' · Academy feed unavailable (Academy filters unknown)'} · ${window.mkBadge ? window.mkBadge.watermark(r.health) : ''}</div></div>`;
  }
  const arrow = (r, k) => (r.sort === k ? (r.dir === 'asc' ? ' ▲' : ' ▼') : '');
  /** Badge columns sit right after Name (and Email when it comes next), in every preset. */
  function splitCols(r) {
    const cols = r.columns.filter((k) => !(r.badge_columns || []).includes(k));
    const at = cols[1] === 'email' ? 2 : 1;
    return [cols.slice(0, at), cols.slice(at)];
  }
  const rowKind = (row) => (row.badges?.owner ? 'mq-row-owner' : (row.badges?.organisation ? 'mq-row-org' : ''));
  function tableHtml(r) {
    const [lead, rest] = splitCols(r);
    const th1 = (k) => `<th class="${k === 'name' ? 'left mq-sticky' : ''}" data-q-sort="${k}" title="Sort">${esc(S.cat.columns[k].label)}${arrow(r, k)}</th>`;
    const badgeHead = window.mkBadge ? window.mkBadge.head((key) => `data-q-sort="${key}" class="mq-badge-h"`) : '';
    const th = `${lead.map(th1).join('')}${badgeHead}${rest.map(th1).join('')}`;
    const td = (row) => (k) => `<td class="${k === 'name' ? 'left mq-sticky' : (['email', 'last_product', 'sources', 'suppressed', 'last_category'].includes(k) ? 'left' : '')}">${cell(k, row.cells[k], row)}</td>`;
    const cols = [...lead, 'b1', 'b2', 'b3', ...rest];
    const rows = r.rows.map((row) => `<tr data-q-person="${row.person_id}" class="${rowKind(row)}">${lead.map(td(row)).join('')}${window.mkBadge ? window.mkBadge.cells(row.badges) : ''}${rest.map(td(row)).join('')}</tr>`).join('');
    const pages = Math.max(1, Math.ceil(r.total / r.page_size));
    const nav = `<div class="mk-params"><button type="button" class="rf-btn rf-btn-secondary" data-q-page="${r.page - 1}" ${r.page <= 0 ? 'disabled' : ''}>‹ Prev</button> <span class="rt-sub" id="mq-pageinfo">Page ${r.page + 1} of ${pages} · ${n(r.total)} people</span> <button type="button" class="rf-btn rf-btn-secondary" data-q-page="${r.page + 1}" ${r.page + 1 >= pages ? 'disabled' : ''}>Next ›</button></div>`;
    return `${headerHtml(r)}${nav}<div class="mk-wide"><table class="rt-table" id="mq-table"><thead><tr>${th}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="rt-sub">No one.</td></tr>`}</tbody></table></div>${nav}`;
  }
  function columnsPicker() {
    const on = new Set(colsNow());
    return `<details class="mq-cols"><summary class="rt-sub">Columns…</summary>${Object.entries(S.cat.columns).map(([k, c]) => `<label class="mq-colopt"><input type="checkbox" data-q-col="${k}" ${on.has(k) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</details>`;
  }

  /* ---------- client health chips: purchase band, email band (independent), inactivity / opened windows ---------- */

  const HQ_ROWS = [
    ['purchase', 'Purchase health', [['p0_6', 'Recent'], ['p6_12', 'Active'], ['p12_24', 'Cooling'], ['p24_plus', 'Lapsed'], ['p_none', 'No evidenced purchase'], ['p_unknown', 'Unknown']]],
    ['email', 'Email health', [['hot', 'Hot'], ['warm_click', 'Warm · click'], ['warm_open', 'Warm · open-only'], ['cooling', 'Cooling'], ['cold', 'Cold'], ['no_response', 'No recorded response'], ['too_few', 'Too few emails'], ['e_unknown', 'Unknown']]]
  ];
  const HQ_MONTHS = [['inactive', 'No open or click in last', 'no_response_months'], ['opened', 'Opened within last', 'opened_months']];
  const hq = () => S.hq || (S.hq = { purchase: new Set(), email: new Set(), inactive: null, opened: null });
  function healthChipsHtml() {
    const h = hq();
    const set = ([key, label, chips]) => `<div class="mq-chiprow"><span class="mq-chiplab">${label}</span>${chips.map(([k, l]) => `<button type="button" class="mq-chip ${h[key].has(k) ? 'on' : ''}" data-qh="${key}:${k}">${esc(l)}</button>`).join('')}</div>`;
    const win = ([key, label]) => `<div class="mq-chiprow"><span class="mq-chiplab">${label}</span>${[3, 6, 12, 24].map((m) => `<button type="button" class="mq-chip ${h[key] === m ? 'on' : ''}" data-qh="${key}:${m}">${m} months</button>`).join('')}<label class="rt-sub mq-miles">custom <input data-qh-custom="${key}" type="number" min="1" max="120" value="${h[key] && ![3, 6, 12, 24].includes(h[key]) ? h[key] : ''}"> calendar months</label></div>`;
    return `${HQ_ROWS.map(set).join('')}${HQ_MONTHS.map(win).join('')}<p class="rt-sub">Purchase "Active / Cooling" is about buying; email "Warm / Cooling" is about recorded opens and clicks. "No open or click": too few emails or no data stays undecided, never a match (review only, not a clean-up rule).</p>`;
  }
  function healthConds() {
    const h = hq();
    const out = [];
    if (h.purchase.size) out.push(C('purchase_band', 'in', [...h.purchase]));
    if (h.email.size) out.push(C('email_health', 'in', [...h.email]));
    HQ_MONTHS.forEach(([key, , field]) => { if (h[key]) out.push(C(field, 'last_months', { n: h[key] })); });
    return out;
  }
  function toggleHealth(spec) {
    const [key, v] = spec.split(':');
    const h = hq();
    if (h[key] instanceof Set) { if (h[key].has(v)) h[key].delete(v); else h[key].add(v); } else h[key] = h[key] === Number(v) ? null : Number(v);
    S.host.querySelector('#mq-health-chips').innerHTML = healthChipsHtml();
    return run(0);
  }

  /** The query actually run and saved: quick-filter chips + health chips (ALL) plus the advanced builder's conditions. */
  function fullQuery() {
    const quick = window.mkQuick ? window.mkQuick.compile(S.quick, { campaigns: S.cat.campaigns }) : null;
    const items = [...(quick?.items || []), ...healthConds()];
    if (!items.length) return S.query;
    return S.query.items?.length ? G('all', [...items, S.query]) : G('all', items);
  }
  function paintQuick() {
    if (!window.mkQuick) return;
    S.host.querySelector('#mq-quick').innerHTML = window.mkQuick.chipsHtml(S.quick);
    S.host.querySelector('#mq-match').innerHTML = window.mkQuick.matchHtml(S.result, S.result?.english);
  }
  async function run(page = 0) {
    const out = S.host.querySelector('#mq-results');
    S.query = readQuery();
    S.page = page;
    out.innerHTML = '<div class="rt-loading">Running…</div>';
    try {
      S.result = await api('POST', '', { action: 'query-run', query: { root: fullQuery() }, sort: S.sort, dir: S.dir, page, columns: colsNow(), show: S.show, q: S.host.querySelector('#mq-q')?.value || '', summary: !S.summary });
      if (S.result.summary) { S.summary = S.result.summary; S.host.querySelector('#mq-tiles').innerHTML = `${window.mkQuick?.tilesHtml(S.summary) || ''}<p class="rt-sub">Tiles count people only${apartLine(S.summary)} (organisations stay in the list as labelled rows).</p>`; }
      S.host.querySelector('#mq-english').textContent = S.result.english;
      out.innerHTML = tableHtml(S.result);
      paintQuick();
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
    const rows = t.map((x) => `<tr class="mq-tl-${esc(x.kind)}"><td>${ukDate(x.date)}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td class="left">${esc(x.text)}${x.level === 'p' ? ' <span class="mk-chip prob">probable</span>' : ''}${x.for_other ? ' <span class="mk-chip">for someone else</span>' : ''}${x.cancelled ? ' <span class="mk-chip warn">cancelled</span>' : ''}${x.duplicate ? ' <span class="mk-chip">duplicate — not added</span>' : ''}${x.refunded ? ` <span class="rt-sub">(refunded ${gbp(x.refunded)})</span>` : ''}</td><td>${x.amount != null ? gbp(x.amount) : ''}</td></tr>`).join('');
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
  /* ---------- client health on the person (three tags, reasons, markers, relationship hold) ---------- */

  const why_ = (s) => (s ? ` <span class="rt-sub">· ${esc(String(s).replace(/_/g, ' '))}</span>` : '');
  function purchaseLine(t) {
    const last = t.last ? `${ukDate(t.last)}${t.last_title ? ` · ${esc(t.last_title)}` : ''}` : 'none confirmed';
    const prob = t.probable_last ? ` · probable (name match) ${ukDate(t.probable_last)}, not used for the band` : '';
    return `<li><b>Last evidenced purchase v${t.version}:</b> ${esc(optLabel(t.band))} — ${last}${prob}${t.incomplete ? ' · <span class="mq-note">history has gaps</span>' : ''}${why_(t.reason)} <span class="rt-sub">(6 / 12 / 24 months back = ${ukDate(t.thresholds.m6)} / ${ukDate(t.thresholds.m12)} / ${ukDate(t.thresholds.m24)})</span></li>`;
  }
  function emailLine(t) {
    const latest = t.latest ? `latest known recorded response ${ukDate(t.latest)} (${esc(t.latest_kind)}, ${n(t.days)} days)` : 'no recorded response';
    return `<li><b>Email health v${t.version}:</b> ${esc(optLabel(t.state))} — ${latest} · ${n(t.delivered)} campaigns delivered${t.partial ? ' · coverage incomplete' : ''}${why_(t.reason)}</li>`;
  }
  function markersLine(o) {
    const chips = [o.booked_ahead ? `<span class="mk-chip">booked ahead: ${esc(o.booked_ahead.title || 'event')} ${ukDate(o.booked_ahead.date)}</span>` : '', o.active_plan ? '<span class="mk-chip">active plan</span>' : '', o.member ? '<span class="mk-chip">Academy member</span>' : '', o.relationship_hold ? `<span class="mk-chip warn">relationship hold: ${esc(o.relationship_hold.reason)} (${ukDate(o.relationship_hold.set_at)})</span>` : ''].filter(Boolean).join(' ');
    return `<li><b>Markers:</b> ${chips || '<span class="rt-sub">none</span>'}</li>`;
  }
  function healthHtml(h, id) {
    if (!h) return '';
    const hold = h.overlays.relationship_hold;
    const btn = `<button type="button" class="rf-btn rf-btn-secondary" data-q-hold="${esc(id)}|${hold ? 'clear' : 'set'}">${hold ? 'Clear relationship hold' : 'Set relationship hold'}</button>`;
    return `<h4>Client health <span class="rt-sub">as of ${ukDate(h.as_of)}</span></h4><ul class="mk-seglist">${purchaseLine(h.purchase)}${emailLine(h.email)}<li><b>Can we email v${h.consent.version}:</b> ${esc(optLabel(h.consent.state))} <span class="rt-sub">· reasons: ${esc(h.consent.reasons.join(', ').replace(/_/g, ' ') || '—')}</span></li>${markersLine(h.overlays)}</ul>${btn} <span class="rt-sub">A hold protects from clean-up and changes no tag or consent.</span>`;
  }
  async function toggleHold(spec) {
    const [id, mode] = spec.split('|');
    const reason = window.prompt(mode === 'set' ? 'Why hold this relationship? (10+ characters, logged)' : 'Why clear the hold? (10+ characters, logged)');
    if (!reason) return;
    try {
      await api('POST', '', { action: mode === 'set' ? 'relationship-hold-set' : 'relationship-hold-clear', person_id: id, reason });
      await detail(id);
    } catch (e) { window.alert(e.message); }
  }

  async function detail(id) {
    const box = S.host.querySelector('#mq-detail');
    box.innerHTML = '<div class="rt-loading">Loading person…</div>';
    try {
      const p = await api('POST', '', { action: 'customer-why', person_id: id, query: { root: fullQuery() } });
      const segs = p.segments.map((s) => `<li>${s.reason ? '<span class="rt-sub">✗</span>' : '<b>✓</b>'} ${esc(s.name)}</li>`).join('');
      box.innerHTML = `<div class="mk-detail" data-q-detail="${esc(id)}"><h4>${esc(p.name || '—')} <span class="rt-sub">${esc(p.email || p.kind)}</span>${p.record_type !== 'person' ? ` <span class="mk-chip">${esc(p.record_type)}</span>` : ''} <button type="button" class="mq-x" data-q-act="close-detail" title="Close">×</button></h4>${valueLine(p.value)}${healthHtml(p.health, id)}<div class="two"><div>${whyHtml(p.why)}${shownUnderHtml(p.shown_under)}<h4>Segments &amp; groups</h4><ul class="mk-seglist">${segs}</ul></div><div>${timelineHtml(p.timeline)}</div></div></div>`;
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      box.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`;
    }
  }

  /* ---------- saved groups ---------- */

  function groupsHtml(list) {
    const rows = list.map((g) => `<tr><td class="left"><b>${esc(g.name)}</b> <span class="mk-chip">v${g.version}</span><div class="rt-sub">${esc(g.english)}</div></td><td>${g.last_check ? `${n((g.last_check.counts || {}).yes)} on ${ukDate(g.last_check.evaluated_at)}` : '<span class="rt-sub">not checked</span>'}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-q-load="${esc(g.segment_id)}">Open</button> <button type="button" class="rf-btn rf-btn-secondary" data-q-check="${esc(g.segment_id)}">Check: who joined / left</button></td></tr>`).join('');
    return `<div class="mk-wide"><table class="rt-table" id="mq-groups-table"><thead><tr><th class="left">Saved group</th><th>Last check</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="rt-sub">None saved yet.</td></tr>'}</tbody></table></div>`;
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
      S.query = readQuery();
      const r = await api('POST', '', { action: 'group-save', segment_id: S.group?.segment_id || undefined, name, purpose: S.host.querySelector('#mq-g-purpose').value, query: { root: fullQuery() } });
      S.group = { segment_id: r.segment_id, name };
      out.innerHTML = `Saved as version ${r.version}. It also appears under Segments for audience snapshots.`;
      await loadGroups();
    } catch (e) { out.innerHTML = `<span class="mk-chip warn">${esc(e.message)}</span>`; }
  }
  const kindChip = (b) => (b?.owner ? ` <span class="mk-chip">${b.business ? 'business copy' : 'owner address'}</span>` : (b?.organisation ? ' <span class="mk-chip">organisation</span>' : ''));
  const personList = (xs) => xs.map((p) => `<li>${esc(p.name || '—')}${kindChip(p.badges)}${window.mkBadge ? window.mkBadge.inline(p.badges) : ''} <span class="rt-sub">${esc(p.email || '')}${p.why ? ` — ${esc(p.why)}` : ''}</span></li>`).join('');
  async function checkGroup(id) {
    const box = S.host.querySelector('#mq-diff');
    box.innerHTML = '<div class="rt-loading">Checking…</div>';
    try {
      const d = await api('POST', '', { action: 'group-preview', segment_id: id, record: true });
      await loadGroups();
      const apart = (o, org) => [org ? `${n(org)} organisation` : '', o ? `${n(o)} owner` : ''].filter(Boolean).join(', ');
      const extra = (o, org) => (o || org ? ` <span class="rt-sub">(+ ${apart(o, org)})</span>` : '');
      box.innerHTML = `<div class="mk-detail"><p><b>${n(d.now)}</b> people match now${apartLine({ organisations: d.organisations, owner_addresses: d.owner_addresses })} (v${d.version}) · ${d.last_check ? `${n(d.last_check.count)} people at the last check (${ukDate(d.last_check.at)})` : 'first check'} · <b>${n(d.joined_count)}</b> people joined${extra(d.joined_owner, d.joined_organisations)} · <b>${n(d.left_count)}</b> left${extra(d.left_owner, d.left_organisations)} · ${n(d.results.unknown)} undecided · ${window.mkBadge ? window.mkBadge.watermark(d.health) : ''}</p>`
        + `<div class="two"><div><h4>Joined</h4><ul class="mk-seglist">${personList(d.joined) || '<li class="rt-sub">Nobody.</li>'}</ul></div><div><h4>Left</h4><ul class="mk-seglist">${personList(d.left) || '<li class="rt-sub">Nobody.</li>'}</ul></div></div>`
        + `<details><summary class="rt-sub">Everyone in the group now (${n((d.members || []).length)}${(d.members || []).length >= 300 ? ', first 300' : ''})</summary><ul class="mk-seglist">${personList(d.members || [])}</ul></details><p class="rt-sub">Recorded as the new check.</p></div>`;
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
    .mq-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; margin: 0.6rem 0; }
    .mq-tile { border: 1px solid #1f2937; border-radius: 8px; padding: 8px 10px; background: #111827; } .mq-tile b { display: block; font-size: 20px; } .mq-tile span { font-size: 12px; color: #94a3b8; }
    .mq-chiprow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 5px 0; } .mq-chiplab { width: 9.5rem; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #94a3b8; }
    .mq-chip { background: transparent; color: #e5e7eb; border: 1px solid #475569; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; } .mq-chip.on { background: #f59e0b; border-color: #f59e0b; color: #111827; font-weight: 600; }
    .mq-miles input { width: 3.5rem; background: #0b1118; color: #e5e7eb; border: 1px solid #334155; border-radius: 4px; }
    .mq-match { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid #334155; border-radius: 8px; padding: 8px 12px; margin: 8px 0; background: #0b1118; }
    .mq-match-act { display: flex; gap: 6px; } .mq-send { background: #f59e0b !important; color: #111827 !important; border-color: #f59e0b !important; font-weight: 600; }
    .mq-adv { margin-top: 0.6rem; } .mq-adv > summary { cursor: pointer; margin-bottom: 0.3rem; }
    .mq-fbtn { background: #0b1118; color: #e5e7eb; border: 1px solid #334155; border-radius: 4px; padding: 2px 6px; font-size: 12px; cursor: pointer; max-width: 22rem; text-align: left; }
    #mq-fpick { position: absolute; z-index: 30; width: 30rem; max-height: 22rem; overflow-y: auto; background: #0f172a; border: 1px solid #475569; border-radius: 8px; padding: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
    #mq-fpick input { width: 100%; box-sizing: border-box; margin-bottom: 4px; } .mq-fglab { font-size: 11px; text-transform: uppercase; color: #94a3b8; margin: 6px 0 2px; }
    .mq-fopt { display: block; width: 100%; text-align: left; background: none; border: none; color: #e5e7eb; padding: 3px 6px; font-size: 12px; cursor: pointer; border-radius: 4px; } .mq-fopt:hover { background: #1e293b; } .mq-fopt.off { color: #64748b; cursor: not-allowed; }
    .mq-cond { position: relative; } .mq-ticks { display: inline-flex; flex-wrap: wrap; gap: 3px 8px; max-width: 34rem; } .mq-tick { font-size: 12px; white-space: nowrap; }
    .mq-camp { max-width: 20rem; } .mq-cchip { display: inline-block; border: 1px solid #475569; border-radius: 4px; padding: 0 5px; font-size: 11px; margin: 1px 0; }
    .mq-band { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #1e293b; color: #cbd5e1; } .mq-band.ok { background: #14532d; color: #bbf7d0; } .mq-band.amber { background: #78350f; color: #fde68a; }
    #mq-table tr.mq-row-org td.mq-sticky::after { content: ' · organisation'; color: #93c5fd; font-size: 11px; } #mq-table tr.mq-row-owner td.mq-sticky::after { content: ' · owner address (not counted)'; color: #93c5fd; font-size: 11px; }
    .mq-note { color: #fbbf24; } #mq-groups-table td.left { min-width: 16rem; max-width: 40rem; white-space: normal; }
  </style>`;

  function shell() {
    const presets = Object.entries(S.cat.presets).map(([k, p]) => `<option value="${k}" ${S.preset === k ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    return `${STYLE}<h3>Customers &amp; segments <button type="button" class="rf-btn rf-btn-secondary" data-q-act="client-health" title="Purchase recency × consent matrix, email health, recent buyers who can't be emailed">Client list health ›</button></h3><p class="rt-sub">Everyone from Squarespace contacts, orders, the Booking Sheet, plan statements and Academy, one row per person. Email activity is collected from every Squarespace campaign report.</p>`
      + `<div id="mq-tiles">${window.mkQuick?.tilesHtml(S.summary) || ''}</div><div id="mq-quick">${window.mkQuick?.chipsHtml(S.quick) || ''}</div><div id="mq-health-chips">${healthChipsHtml()}</div><div id="mq-match"></div>`
      + `<details class="mq-adv" open><summary><b>Advanced conditions</b> <span class="rt-sub">ALL / ANY / NONE groups, combined with the chips above</span></summary>`
      + `<p class="rt-sub">A condition on bookings, purchases, campaigns or clicks is tested on one record at a time (the same click must be about Lightroom <i>and</i> within 90 days). Unknown data never counts as "no": undecided people are counted apart. Money is each sale counted once (Squarespace orders + Booking Sheet sales that aren't Squarespace orders + Pick n Mix plan payments); Booking Sheet sales carry a name only, so they are "probable" for a contact.</p>`
      + `<div class="mq-ex"><span class="rt-sub">Recipes:</span>${EXAMPLES.map(([label], i) => `<button type="button" class="rf-btn rf-btn-secondary" data-q-ex="${i}">${esc(label)}</button>`).join('')}<button type="button" class="rf-btn rf-btn-secondary" data-q-act="quick-to-builder" title="Turn the chosen chips into editable conditions">Chips → conditions</button><button type="button" class="rf-btn rf-btn-secondary" data-q-act="clear">Clear all</button></div>`
      + `<div id="mq-builder">${groupHtml(S.query, true)}</div><div class="mq-english" id="mq-english">Press Run to see what this filter means.</div></details>`
      + `<div class="mk-params"><input id="mq-q" type="search" placeholder="Search name or email" style="width:14rem"> <button type="button" class="rf-btn" data-q-act="run">Run</button> <label class="st-ov-f mk-f">Columns<select id="mq-preset">${presets}</select></label>${columnsPicker()}</div>`
      + '<div id="mq-results"></div><div id="mq-detail"></div>'
      + `<h4>Saved groups</h4><div class="mk-params"><label class="st-ov-f mk-f">Group name<input id="mq-g-name" type="text" maxlength="120" style="width:16rem"></label><label class="st-ov-f mk-f">Purpose<input id="mq-g-purpose" type="text" maxlength="200" style="width:16rem" placeholder="e.g. Jan Lightroom launch"></label><button type="button" class="rf-btn rf-btn-secondary" data-q-act="save-group">Save current filter as a group</button> <span id="mq-save-out" class="rt-sub"></span></div><div id="mq-groups"><div class="rt-loading">Loading saved groups…</div></div><div id="mq-diff"></div>`;
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
    run: () => run(0), clear: () => { S.query = emptyQuery(); S.quick = {}; S.hq = null; S.group = null; paintHealthChips(); paint(); return run(0); },
    'quick-to-builder': () => { S.query = readQuery(); S.query = fullQuery(); S.quick = {}; S.hq = null; paintHealthChips(); paint(); return run(0); },
    'toggle-unknown': () => { S.show = S.show === 'unknown' ? 'yes' : 'unknown'; return run(0); },
    'close-detail': () => { S.host.querySelector('#mq-detail').innerHTML = ''; }, 'save-group': saveGroupNow,
    'client-health': () => (typeof window.mkOpenClientHealth === 'function' ? window.mkOpenClientHealth() : null)
  };
  function openGroup(id) {
    const g = S.groups.find((x) => x.segment_id === id);
    S.query = JSON.parse(JSON.stringify(g.query.root));
    S.quick = {};
    S.group = { segment_id: g.segment_id, name: g.name };
    S.host.querySelector('#mq-g-name').value = g.name;
    S.host.querySelector('#mq-g-purpose').value = g.purpose || '';
    paint();
    return run(0);
  }
  function toggleChip(spec) {
    const [row, key] = spec.split(':');
    const set = S.quick[row] || (S.quick[row] = new Set());
    if (set.has(key)) set.delete(key); else set.add(key);
    return run(0);
  }
  /** "Send to Squarespace list": the group must be saved (it then appears under Segments → audience snapshot). Nothing is sent here. */
  function sendToList() {
    const out = S.host.querySelector('#mq-save-out');
    const snap = document.querySelector('.mk-snap');
    if (!S.group) {
      S.host.querySelector('#mq-g-name').focus();
      out.innerHTML = '<span class="mq-note">Save this as a segment first (give it a name).</span> Then tick it under <b>Segments → Audience snapshot</b>: the snapshot re-reads consent, and the list load is checked and stays blocked until it passes. Nothing is sent from here.';
      return null;
    }
    out.innerHTML = `Saved as “${esc(S.group.name)}”. Tick it under <b>Segments → Audience snapshot</b> (reload the tab if it isn't listed yet). Nothing is sent from here.`;
    snap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return null;
  }
  const sortBy = (key) => { S.dir = S.sort === key && S.dir === 'desc' ? 'asc' : 'desc'; S.sort = key; savePrefs(); return run(0); };
  const loadExample = (i) => { S.query = exampleQuery(Number(i)); S.quick = {}; S.group = null; paint(); return run(0); };
  /** [data attribute selector, dataset key, handler(value)] for clicks that aren't builder actions. */
  const CLICKS = [
    ['[data-q-ex]', 'qEx', loadExample], ['[data-qq]', 'qq', toggleChip], ['[data-q-pick]', 'qPick', choosePicked],
    ['[data-q-sort]', 'qSort', sortBy], ['[data-q-page]', 'qPage', (v) => run(Number(v))], ['[data-q-person]', 'qPerson', (v) => detail(v)],
    ['[data-q-load]', 'qLoad', (v) => openGroup(v)], ['[data-q-check]', 'qCheck', (v) => checkGroup(v)], ['[data-q-separate]', 'qSeparate', (v) => separate(v)],
    ['[data-q-hold]', 'qHold', (v) => toggleHold(v)], ['[data-qh]', 'qh', toggleHealth]
  ];
  const focusName = () => { const el = S.host.querySelector('#mq-g-name'); el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return null; };
  function onClick(e) {
    const t = e.target;
    const actEl = t.closest('[data-q-act]');
    const act = actEl?.dataset.qAct;
    if (act === 'pick-field') return openPicker(actEl);
    if (!t.closest('#mq-fpick')) closePicker();
    if (act === 'save-segment') return focusName();
    if (act === 'send-list') return sendToList();
    if (['add-cond', 'add-group', 'remove'].includes(act)) return structural(act, t);
    if (act) return ACTS[act]();
    for (const [selector, key, fn] of CLICKS) {
      const el = t.closest(selector);
      if (el) return fn(el.dataset[key]);
    }
    return null;
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'mq-preset') { S.preset = t.value; S.cols = null; savePrefs(); S.host.querySelector('.mq-cols').outerHTML = columnsPicker(); return run(S.page); }
    if (t.dataset.qCol) { S.cols = [...S.host.querySelectorAll('[data-q-col]:checked')].map((c) => c.dataset.qCol); savePrefs(); return run(S.page); }
    if (t.dataset.q === 'op' || t.dataset.q === 'when') { S.query = readQuery(); paint(); }
    if (t.id === 'mq-qq-miles') { S.quick.miles = Math.max(1, Number(t.value) || 30); return run(0); }
    if (t.dataset.qhCustom) { const m = Math.round(Number(t.value)); hq()[t.dataset.qhCustom] = m >= 1 && m <= 120 ? m : null; paintHealthChips(); return run(0); }
    return null;
  }
  function paintHealthChips() { const box = S.host?.querySelector('#mq-health-chips'); if (box) box.innerHTML = healthChipsHtml(); }
  function onInput(e) {
    if (e.target.id === 'mq-fpick-q') S.host.querySelector('#mq-fpick-list').innerHTML = pickerHtml(e.target.value);
  }

  /**
   * Open a segment's own definition here (same evaluator → same count), with "can be emailed" added as segments do.
   * opts.gate === false opens the query exactly as given (client list health counts people who can't be emailed);
   * opts.preset picks the column preset.
   */
  let pendingOpen = null;
  window.mkOpenQuery = function mkOpenQuery(root, name, opts = {}) {
    if (!S.host || !S.cat || !S.ready) { pendingOpen = [root, name, opts]; return null; }
    const base = JSON.parse(JSON.stringify(root));
    const gate = C('eligible', 'is_true');
    if (opts.gate === false || JSON.stringify(base).includes('"field":"eligible"')) S.query = base;
    else S.query = base.match === 'all' ? { ...base, items: [...base.items, gate] } : G('all', [base, gate]);
    if (opts.preset && S.cat.presets[opts.preset]) { S.preset = opts.preset; S.cols = null; S.host.querySelector('#mq-preset').value = opts.preset; S.host.querySelector('.mq-cols').outerHTML = columnsPicker(); }
    S.show = 'yes';
    S.quick = {};
    S.hq = null;
    paintHealthChips();
    S.group = null;
    S.host.querySelector('#mq-g-name').value = name ? `${name} (copy)` : '';
    paint();
    S.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return run(0);
  };

  /** The query the Customers section is showing (chips + conditions), for the clean-up review. */
  window.mkCurrentQuery = () => { if (S.host && S.cat) S.query = readQuery(); return { root: S.cat ? fullQuery() : emptyQuery() }; };

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
      host.addEventListener('input', onInput);
      host.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target.closest('#mq-builder') || e.target.id === 'mq-q')) { e.preventDefault(); run(0); } });
      await Promise.all([run(0), loadGroups()]);
      S.ready = true;
      if (pendingOpen) { const [r, nm, o] = pendingOpen; pendingOpen = null; await window.mkOpenQuery(r, nm, o); }
    } catch (e) {
      host.innerHTML = `<h3>Customers</h3><div class="rt-error">${esc(e.message)}</div>`;
    }
  };
})();
