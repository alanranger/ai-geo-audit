/**
 * Customers → quick filters (approved mock-up customers-segments-mockup-2026-11-07): summary tiles, chip rows and the
 * "N people match" line. Chips compile into ordinary query conditions (same evaluator as the advanced builder, saved
 * groups and snapshots): chips within a row are ANY, except "Has done" / "Hasn't done" where every chosen item applies;
 * rows combine with ALL, and with the advanced builder's own conditions.
 */
(function () {
  const C = (field, op, value) => ({ type: 'cond', field, op, value: value ?? null });
  const G = (match, items) => ({ type: 'group', match, items });
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '…' : Number(v).toLocaleString('en-GB'));

  const ROWS = [
    { key: 'email', label: 'Email activity', chips: [['warm', 'Warm'], ['cooling', 'Cooling'], ['cold', 'Cold'], ['clicked3', 'Clicked in last 3 campaigns'], ['none', 'No opens recorded']] },
    { key: 'dist', label: 'Distance', chips: [['near', 'Within {m} miles'], ['mid', '{m}–60 miles'], ['far', '60+ miles'], ['unk', 'Unknown']] },
    { key: 'done', label: 'Has done', chips: [['beginners', 'Beginners course'], ['lightroom', 'Lightroom'], ['day_workshop', 'Day workshop'], ['residential', 'Residential'], ['one_to_one', '1-2-1'], ['academy', 'Academy'], ['voucher_bought', 'Bought voucher'], ['pnm', 'Pick n Mix plan']] },
    { key: 'notdone', label: "Hasn't done", chips: [['lightroom', 'Lightroom'], ['day_workshop', 'Day workshop'], ['residential', 'Residential'], ['pnm', 'Pick n Mix plan']] },
    { key: 'last', label: 'Last booking', chips: [['r12', 'Within 12 months'], ['r24', '12–24 months'], ['lapsed', '24+ months (lapsed)'], ['never', 'Never booked']] },
    { key: 'topic', label: 'Clicked a link to', chips: [['lightroom', 'Lightroom'], ['workshops', 'Workshops'], ['courses', 'Courses'], ['vouchers', 'Vouchers'], ['pick_n_mix', 'Pick n Mix'], ['macro', 'Macro'], ['away', 'Away locations'], ['academy', 'Academy']] }
  ];

  const months = (k) => ({ n: k, unit: 'months' });
  const pastWithin = (k) => ({ time: 'past', within: months(k) });

  function emailConds(on, ctx) {
    const bands = ['warm', 'cooling', 'cold'].filter((b) => on.has(b));
    if (bands.includes('cooling')) bands.push('cooling_partial');
    const out = bands.length ? [C('open_band', 'in', bands)] : [];
    if (on.has('none')) out.push(C('open_band', 'in', ['none_recorded']));
    if (on.has('clicked3') && ctx.campaigns?.length) out.push(C('click', 'exists', { email_ids: ctx.campaigns.slice(0, 3).map((c) => c.id), campaign_label: 'one of the last 3 campaigns' }));
    return out;
  }
  const DIST = { near: (m) => C('miles', 'lte', m), mid: (m) => C('miles', 'between', [m, 60]), far: () => C('miles', 'gte', 60), unk: () => C('miles', 'unknown') };
  /** Has / hasn't a Pick n Mix plan = a plan running now or starting later (PnM Plans tab first, statements as history). */
  const PNM_LIVE = ['active', 'starting'];
  const doneCond = (k) => {
    if (k === 'pnm') return C('pnm_status', 'in', PNM_LIVE);
    if (k === 'academy') return G('any', [C('academy_status', 'in', ['paid_active', 'cancelled']), C('booking', 'exists', { cats: ['academy'] })]);
    if (k === 'voucher_bought') return C('purchase', 'exists', { cats: ['voucher_bought'] });
    return C('booking', 'exists', { cats: [k] });
  };
  const notDoneCond = (k) => (k === 'pnm' ? C('pnm_status', 'not_in', PNM_LIVE) : C('booking', 'none', { cats: [k] }));
  const LAST = {
    r12: () => C('booking', 'exists', pastWithin(12)),
    r24: () => G('all', [C('booking', 'exists', pastWithin(24)), C('booking', 'none', pastWithin(12))]),
    lapsed: () => G('all', [C('booking', 'exists', { time: 'past' }), C('booking', 'none', pastWithin(24))]),
    never: () => C('booking', 'none', {})
  };

  const anyOf = (items) => (items.length === 1 ? items[0] : G('any', items));
  /** The chips as one ALL group of conditions (null when nothing is chosen). */
  function compile(state, ctx) {
    const on = (k) => state[k] || new Set();
    const rows = [];
    const email = emailConds(on('email'), ctx);
    if (email.length) rows.push(anyOf(email));
    const dist = [...on('dist')].map((k) => DIST[k](state.miles || 30));
    if (dist.length) rows.push(anyOf(dist));
    rows.push(...[...on('done')].map(doneCond), ...[...on('notdone')].map(notDoneCond));
    const last = [...on('last')].map((k) => LAST[k]());
    if (last.length) rows.push(anyOf(last));
    if (on('topic').size) rows.push(C('click', 'exists', { topics: [...on('topic')] }));
    return rows.length ? G('all', rows) : null;
  }

  function tilesHtml(s) {
    const t = (v, label) => `<div class="mq-tile"><b>${n(v)}</b><span>${label}</span></div>`;
    return `<div class="mq-tiles">${t(s?.people, 'people')}${t(s?.subscribed, 'subscribed')}${t(s?.warm, 'warm (opened in 90 days)')}${t(s?.cooling, 'cooling (3–6 months)')}${t(s?.cold, 'cold (no open 6 months+)')}${t(s?.within_30, 'within 30 miles of the centre')}</div>`;
  }

  function chipsHtml(state) {
    const m = state.miles || 30;
    const row = (r) => `<div class="mq-chiprow"><span class="mq-chiplab">${esc(r.label)}</span>${r.chips.map(([k, label]) => `<button type="button" class="mq-chip ${(state[r.key] || new Set()).has(k) ? 'on' : ''}" data-qq="${r.key}:${k}">${esc(label.replace('{m}', m))}</button>`).join('')}${r.key === 'dist' ? `<label class="rt-sub mq-miles">radius <input id="mq-qq-miles" type="number" min="1" max="300" value="${m}"> miles</label>` : ''}</div>`;
    return `<div class="mq-chips">${ROWS.map(row).join('')}</div>`;
  }

  function matchHtml(r, english) {
    if (!r) return '<div class="mq-match"><span class="rt-sub">Choose chips or build conditions below, then results update.</span></div>';
    return `<div class="mq-match"><div><b>${n(r.header.people)} people match</b> · ${esc(english)} · ${n(r.header.eligible_addresses)} can be emailed</div><div class="mq-match-act"><button type="button" class="rf-btn rf-btn-secondary" data-q-act="save-segment">Save as segment</button><button type="button" class="rf-btn mq-send" data-q-act="send-list">Send to Squarespace list</button></div></div>`;
  }

  window.mkQuick = { ROWS, compile, tilesHtml, chipsHtml, matchHtml };
})();
