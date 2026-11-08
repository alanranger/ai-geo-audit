/**
 * Marketing & Campaigns → Schedule: the read-only model behind the Days and Weeks views (no DOM, no fetches, no writes).
 * Items come from the delivery builder (window.mkDeliveryItems in lib/marketing-delivery.js: campaign steps + ticks,
 * campaign records, Squarespace schedules), so nothing is copied or re-derived. Derived here only:
 *  - where each item sits (done by publication day, others by planned / scheduled day; past + not done = late);
 *  - per-week counts and the email limit: more than 2 emails in any rolling 7 days is red, unless an approved
 *    exception covers that window (read from campaign.rules.email.limit_exceptions; none are stored today);
 *  - possible duplicates: the server's own duplicate warning pair (lib/marketing/delivery.mjs), or a Squarespace
 *    schedule not matched to a campaign beside one of its candidate records on the same UK day;
 *  - gaps: a future week with no step on a channel is "nothing planned" (steps are never invented);
 *  - "Selling this week" from the quarter plan (initiatives, open actions) and event / offer dates.
 * Exposes window.mkScheduleModel.
 */
(function () {
  const LONDON = 'Europe/London';
  const EMAIL_LIMIT = 2;
  const ROLL_DAYS = 7;
  const ROWS = ['email', 'fbig', 'linkedin', 'outlook', 'gbp'];
  const ROW_OF = { email: 'email', facebook: 'fbig', instagram: 'fbig', linkedin: 'linkedin', outlook: 'outlook', gbp: 'gbp' };
  const GAP_ROWS = new Set(['email', 'fbig', 'linkedin']);
  const RANK = { late: 0, prep: 1, ready: 1, scheduled: 2, done: 3 };
  const COUNTED = new Set(['done', 'sch', 'pl', 'warn']);

  const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });
  const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
  const ukShort = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  /* ---------- items ---------- */

  const LEAD = /^(Post|Personal note to past clients|Main email of the week|Lightroom targeted email|Google Business update)\s*:\s*/i;
  /** Card title: at most 4 words; the full title stays in the side panel and the tooltip. */
  function shortTitle(t) {
    const s = String(t || '').replace(/^Weekly email \((.*)\)$/, 'Weekly: $1').replace(/^Google Business check.*$/i, 'Weekly check')
      .replace(LEAD, '').replace(/["“”]/g, '').replace(/\s+\+\s*\d+\s+more$/, '').replace(/\s+for\s+/i, ' ');
    const head = s.split(/\s+[|—–]\s+|\s+-\s+/)[0];
    return head.split(/\s+/).filter(Boolean).slice(0, 4).join(' ').replace(/[,:;·]+$/, '');
  }

  const stepKeyOf = (it) => (it.step != null ? it.key.slice(0, it.key.lastIndexOf('|')) : null);
  /** Facebook + Instagram are one shared post: one card, the less advanced of the two platforms. */
  function mergeSocial(items) {
    const out = [];
    const pairs = new Map();
    for (const it of items) {
      if (it.channel !== 'facebook' && it.channel !== 'instagram') { out.push(it); continue; }
      const k = stepKeyOf(it);
      if (!pairs.has(k)) { pairs.set(k, []); out.push({ merge: k }); }
      pairs.get(k).push(it);
    }
    return out.map((x) => (x.merge ? combine(pairs.get(x.merge)) : x));
  }
  function combine(list) {
    const open = list.filter((x) => x.status !== 'resolved');
    if (!open.length) return { ...list[0], channel: 'fbig', parts: list };
    const worst = open.slice().sort((a, b) => (RANK[a.status] ?? 1) - (RANK[b.status] ?? 1))[0];
    return { ...worst, channel: 'fbig', parts: list };
  }

  const unverified = (dl) => !!dl && dl.record_stage === 'scheduled' && !dl.evidence && !dl.sent && !dl.cancelled;
  function stateOf(it, day, today) {
    if (it.status === 'done') return 'done';
    if (day && day < today) return 'late';
    if (unverified(it.delivery)) return 'warn';
    if (it.status === 'scheduled') return 'sch';
    return 'pl';
  }
  function peopleOf(it) {
    const dl = it.delivery;
    if (!dl) return null;
    if (dl.amount != null && !(dl.cancelled && dl.release === 'released')) return Number(dl.amount);
    return dl.estimate && dl.estimate.sends ? Number(dl.estimate.sends) : null;
  }
  function placeItem(it, today) {
    const done = it.status === 'done';
    const at = done ? it.done_at : it.planned_at;
    const day = at ? dayOf(at) : it.planned || null;
    const row = ROW_OF[it.channel] || it.channel;
    return {
      id: `${row}|${it.key}`, row, key: it.key, step_key: stepKeyOf(it), record_key: it.record_key || (row === 'email' ? it.key : null),
      title: it.title, short: shortTitle(it.title), day, time: at ? timeOf(at) : null, people: row === 'email' ? peopleOf(it) : null,
      state: it.status === 'resolved' ? 'resolved' : stateOf(it, day, today), estimate: !!(it.delivery && !it.delivery.sent && it.delivery.estimate && it.delivery.amount == null),
      gbp: it.gbp || null, optional: !!it.optional, dup: null, raw: it
    };
  }

  /* ---------- possible duplicates ---------- */

  const liveDl = (x) => !!x && !x.sent && !x.cancelled && x.bucket !== 'released';
  const dlDay = (x) => (x.send_at ? dayOf(x.send_at) : x.send_day);
  /** [keyA, keyB] pairs: the server's duplicate warning pair, or an unmatched schedule beside a same-day candidate. */
  function dupPairs(d) {
    const dls = d?.meter?.deliveries || [];
    const out = (d?.meter?.warnings || []).filter((w) => Array.isArray(w.pair) && w.pair.length === 2).map((w) => w.pair);
    for (const x of dls.filter((y) => y.review && liveDl(y))) {
      for (const k of x.provider?.link_candidates || []) {
        const other = dls.find((y) => y.key === k);
        if (liveDl(other) && dlDay(other) === dlDay(x)) out.push([x.key, k]);
      }
    }
    const seen = new Set();
    return out.filter((p) => { const k = [...p].sort().join('~'); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function markDuplicates(items, pairs) {
    const byKey = new Map(items.filter((x) => x.row === 'email' && x.state !== 'resolved').map((x) => [x.record_key, x]));
    const found = [];
    for (const [a, b] of pairs) {
      const [x, y] = [byKey.get(a), byKey.get(b)];
      if (!x || !y) continue;
      x.dup = y.id;
      y.dup = x.id;
      found.push([x, y]);
    }
    return found;
  }

  /* ---------- email limit ---------- */

  const countedEmails = (items) => items.filter((x) => x.row === 'email' && COUNTED.has(x.state) && x.day);
  function perDay(items) {
    const m = new Map();
    for (const x of countedEmails(items)) m.set(x.day, (m.get(x.day) || 0) + 1);
    return m;
  }
  const exempt = (exceptions, day) => exceptions.some((e) => (typeof e === 'string' ? e === day : e && e.from <= day && (!e.to || e.to >= day)));
  /**
   * Highest count in the 7 days up to and including each email day from..to (so a week is judged by its own emails);
   * red over the limit unless an approved exception covers that day.
   */
  function rolling(counts, from, to, exceptions) {
    let best = { max: 0, at: null };
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!counts.get(d)) continue;
      let c = 0;
      for (let k = 0; k < ROLL_DAYS; k += 1) c += counts.get(addDays(d, -k)) || 0;
      if (c > best.max) best = { max: c, at: d };
    }
    return { ...best, red: best.max > EMAIL_LIMIT && !exempt(exceptions, best.at) };
  }

  /* ---------- selling this week ---------- */

  const MOMENT_ORDER = ['Last chance', 'Last places', 'Main push', 'Announce'];
  function eventNames(s) {
    const m = new Map();
    for (const w of s?.campaign?.weeks || []) for (const r of [...(w.rows || []), ...(w.more || [])]) if (r.event_key && r.name) m.set(r.event_key, r.name);
    return m;
  }
  const GENERIC = /\b(photography|photographic|photo|workshops?|classes|editing)\b/gi;
  const plainName = (t) => (/beginner/i.test(t) ? 'Beginners course' : String(t || '').split(/\s+[|—–]\s+|\s+-\s+/)[0].replace(GENERIC, ' ').trim().split(/\s+/).slice(0, 3).join(' '));
  function momentBits(s, week) {
    const w = (s?.campaign?.weeks || []).find((x) => x.week === week);
    const rows = [...(w?.rows || []), ...(w?.more || [])].filter((r) => r.type === 'moment' && MOMENT_ORDER.includes(r.stage) && r.name);
    rows.sort((a, b) => MOMENT_ORDER.indexOf(a.stage) - MOMENT_ORDER.indexOf(b.stage));
    return rows.map((r) => ({ b: r.name, t: r.stage.toLowerCase() }));
  }
  function offerBits(s, week, end) {
    return Object.values(s?.campaign?.overrides || {}).filter((o) => o.offer_code && o.offer_ends && o.offer_ends >= week && o.offer_ends <= end)
      .map((o) => ({ b: o.offer_code, t: `ends ${ukShort(o.offer_ends).split(' ').slice(0, 2).join(' ')}` }));
  }
  function eventBits(s, week, end, names) {
    return (s?.diary || []).filter((e) => e.date >= week && e.date <= end).map((e) => ({ b: names.get(`${e.date}|${e.url}`) || plainName(e.title), t: ukShort(e.date).split(' ').slice(1).join(' ') }));
  }
  const initiativesOf = (s) => Object.values(s?.quarter_plan?.initiatives || {}).filter((i) => i.kind === 'initiative');
  function planBits(s, week, end) {
    const out = [];
    for (const i of initiativesOf(s)) {
      if (i.start_date >= week && i.start_date <= end) out.push({ b: i.title, t: 'starts' });
      for (const a of (i.actions || []).filter((x) => !x.is_ticked && x.due >= week && x.due <= end)) out.push({ b: a.label, t: '' });
    }
    return out;
  }
  function activeBits(s, week, end) {
    return initiativesOf(s).filter((i) => i.start_date <= end && (!i.end_date || i.end_date >= week)).slice(0, 2).map((i) => ({ b: '', t: i.title, quiet: true }));
  }
  function sellingFor(s, week) {
    const end = addDays(week, 6);
    const bits = [...momentBits(s, week), ...offerBits(s, week, end), ...eventBits(s, week, end, eventNames(s)), ...planBits(s, week, end)];
    const seen = new Set();
    const uniq = bits.filter((x) => { const k = `${x.b}|${x.t}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
    return uniq.length ? uniq : activeBits(s, week, end);
  }

  /* ---------- needs you ---------- */

  const LATE_LABEL = { email: 'Email', fbig: 'FB/IG', linkedin: 'LinkedIn', outlook: 'Outlook', gbp: 'Google' };
  function lateLine(items) {
    const late = items.filter((x) => x.state === 'late');
    if (!late.length) return null;
    const by = ROWS.map((r) => [r, late.filter((x) => x.row === r).length]).filter(([, k]) => k).map(([r, k]) => `${LATE_LABEL[r]} ${k}`);
    return { level: 'amber', text: `${late.length} late (${by.join(', ')}): do it or skip it.`, ids: late.map((x) => x.id) };
  }
  function dupLines(pairs) {
    return pairs.map(([a, b]) => ({ level: 'amber', text: `${ukShort(a.day)}: “${a.short}” and “${b.short}” may be the same email (${a.people ?? '?'} / ${b.people ?? '?'} people). Keep one.`, ids: [a.id, b.id] }));
  }
  function limitLine(items, today) {
    const next = countedEmails(items).filter((x) => x.day >= today && x.day <= addDays(today, ROLL_DAYS - 1));
    if (next.length <= EMAIL_LIMIT) return null;
    const days = new Map();
    for (const x of next) days.set(x.day, [...(days.get(x.day) || []), x]);
    const [busy, list] = [...days].sort((a, b) => b[1].length - a[1].length)[0];
    return { level: 'amber', text: `${next.length} emails in the next 7 days (limit ${EMAIL_LIMIT}); ${ukShort(busy)} has ${list.length}. Pick which go.`, ids: next.map((x) => x.id) };
  }
  function recordLines(items, cap) {
    const out = [];
    const warn = items.filter((x) => x.state === 'warn');
    if (warn.length) out.push({ level: 'amber', text: `${warn.length} marked scheduled with no platform evidence: confirm in Squarespace.`, ids: warn.map((x) => x.id) });
    const soon = (cap?.unchosen || []).filter((x) => !x.late);
    if (soon.length) out.push({ level: 'amber', text: `Weekly email ${ukShort(soon[0].day)}: choose its audience${soon.length > 1 ? ` (+${soon.length - 1} more)` : ''}.`, ids: items.filter((x) => soon.some((u) => u.key === x.record_key)).map((x) => x.id) });
    if (cap?.overage > 0) out.push({ level: 'red', text: `Booked emails are ${cap.overage.toLocaleString('en-GB')} over the allowance before the reset.`, ids: [] });
    return out;
  }
  function unmatchedLine(d, pairs) {
    const paired = new Set(pairs.flat().map((x) => x.record_key));
    const left = (d?.meter?.deliveries || []).filter((x) => x.review && liveDl(x) && !paired.has(x.key));
    return left.length ? [{ level: 'amber', text: `${left.length} Squarespace schedule${left.length === 1 ? '' : 's'} not matched to a campaign: link it.`, ids: left.map((x) => `email|${x.key}`), link: true }] : [];
  }
  function needsYou(items, pairs, d, cap, today) {
    return [...dupLines(pairs), limitLine(items, today), lateLine(items), ...recordLines(items, cap), ...unmatchedLine(d, pairs)].filter(Boolean);
  }

  /* ---------- allowance ---------- */

  function allowance(cap) {
    if (!cap) return null;
    const booked = (cap.committed || 0) + (cap.provisional || 0);
    const free = cap.quota - cap.used - booked;
    return { quota: cap.quota, used: cap.used, booked, free, over: free < 0, reset: cap.next_cycle?.starts_at || null, missing: cap.missing_audiences || 0 };
  }

  /* ---------- views ---------- */

  function gbpItem(g, today) {
    if (!g?.reachable || !g.last_post_at) return null;
    const day = dayOf(g.last_post_at);
    return { id: `gbp|auto|${day}`, row: 'gbp', key: `gbp-auto|${day}`, title: 'Viking Local automatic post (seen by the Google Business Profile API)', short: 'Auto post', day, time: timeOf(g.last_post_at), people: null, state: 'done', synthetic: true, seen_today: day === today, raw: { evidence: { kind: 'seen', at: g.last_post_at, by: 'Google Business Profile API' } } };
  }

  /**
   * Everything both views need. items = window.mkDeliveryItems(d, s); cap = window.mkCapacity(d, s); g = Google
   * Business status (or null). today = YYYY-MM-DD (UK).
   */
  const exceptionsOf = (s) => s?.campaign?.rules?.email?.limit_exceptions || [];
  function build(input) {
    const { items, d, s, cap, g } = { items: [], d: null, s: null, cap: null, g: null, ...input };
    const today = input?.today || todayIso();
    const placed = mergeSocial(items).map((it) => placeItem(it, today));
    const auto = gbpItem(g, today);
    if (auto) placed.push(auto);
    const pairs = markDuplicates(placed, dupPairs(d));
    return { today, items: placed, byId: new Map(placed.map((x) => [x.id, x])), pairs, exceptions: exceptionsOf(s), counts: perDay(placed), needs: needsYou(placed, pairs, d, cap, today), allowance: allowance(cap), s, week_start: s?.week_start || mondayOf(today) };
  }

  const visible = (x) => x.state !== 'resolved';
  const byTime = (a, b) => String(a.time || '99').localeCompare(String(b.time || '99'));
  /** Days view: one block per 7 days from `start`; late items collect in today's column when today is shown. */
  function days(model, start, n) {
    const list = Array.from({ length: n }, (_, i) => addDays(start, i));
    const showLate = list.includes(model.today);
    const cell = (row, day) => model.items.filter((x) => x.row === row && x.day === day && visible(x) && x.state !== 'late').sort(byTime);
    const rows = ROWS.map((row) => ({ row, cells: list.map((day) => cell(row, day)), late: showLate ? model.items.filter((x) => x.row === row && x.state === 'late') : [] }));
    const offers = Object.values(model.s?.campaign?.overrides || {}).filter((o) => o.offer_code && list.includes(o.offer_ends));
    return { days: list, rows, offers, blocks: Math.ceil(n / 7) };
  }

  function emailSummary(model, weekItems, week, end) {
    const counted = countedEmails(weekItems);
    const known = counted.filter((x) => x.people != null);
    return {
      count: counted.length, sends: known.reduce((t, x) => t + x.people, 0), estimate: counted.some((x) => x.estimate), unknown: counted.length - known.length,
      late: weekItems.filter((x) => x.row === 'email' && x.state === 'late').length,
      skipped: weekItems.filter((x) => x.row === 'email' && x.state === 'resolved' && /skipped/.test(String(x.raw?.note || ''))).length,
      ...rolling(model.counts, week, end, model.exceptions)
    };
  }
  /** A folded card is only as far on as its least advanced email (amber > planned > scheduled > done). */
  function groupState(xs) {
    const has = (k) => xs.some((x) => x.state === k);
    if (has('warn')) return 'warn';
    if (has('pl')) return 'pl';
    return has('sch') ? 'sch' : 'done';
  }
  /** Cards for one channel cell: late ones folded into one, 3+ emails on one day folded into one. */
  function weekCell(list) {
    const late = list.filter((x) => x.state === 'late');
    const rest = list.filter((x) => x.state !== 'late').sort((a, b) => `${a.day}${a.time || ''}`.localeCompare(`${b.day}${b.time || ''}`));
    const out = late.length ? [{ late: true, ids: late.map((x) => x.id), names: [...new Set(late.map((x) => x.short))] }] : [];
    const perDayList = new Map();
    for (const x of rest) perDayList.set(x.day, [...(perDayList.get(x.day) || []), x]);
    for (const [day, xs] of perDayList) {
      if (xs.length >= 3 && xs[0].row === 'email') out.push({ group: true, day, ids: xs.map((x) => x.id), count: xs.length, people: xs.reduce((t, x) => t + (x.people || 0), 0), state: groupState(xs), dup: xs.some((x) => x.dup) });
      else xs.forEach((x) => out.push({ id: x.id }));
    }
    return out;
  }
  const hasSteps = (s, week) => (s?.campaign?.weeks || []).some((w) => w.week === week);
  function weekRow(model, week) {
    const end = addDays(week, 6);
    const items = model.items.filter((x) => x.day >= week && x.day <= end);
    const live = items.filter(visible);
    const future = end >= model.today;
    const cells = {};
    const gaps = {};
    for (const row of ROWS) {
      cells[row] = weekCell(live.filter((x) => x.row === row));
      gaps[row] = !cells[row].length && future && GAP_ROWS.has(row);
    }
    return { week, end, now: model.today >= week && model.today <= end, past: end < model.today, planned: hasSteps(model.s, week), selling: sellingFor(model.s, week), emails: emailSummary(model, items, week, end), cells, gaps };
  }
  function weeks(model, count, lastDay) {
    const out = [];
    for (let w = model.week_start; out.length < count && (!lastDay || w <= lastDay); w = addDays(w, 7)) out.push(weekRow(model, w));
    return out;
  }
  const quarterEnd = (s) => (s?.quarter_plan?.quarters || []).find((q) => q.state === 'current')?.end_date || null;

  window.mkScheduleModel = { build, days, weeks, quarterEnd, shortTitle, rolling, dupPairs, sellingFor, addDays, mondayOf, ukShort, ROWS, EMAIL_LIMIT };
})();
