/**
 * Marketing & Campaigns → Schedule: the read-only model behind the Days and Weeks views (no DOM, no fetches, no writes).
 * Items come from the delivery builder (window.mkDeliveryItems in lib/marketing-delivery.js: campaign steps + ticks,
 * campaign records, Squarespace schedules), so nothing is copied or re-derived. Derived here only:
 *  - where each item sits (done by publication day, others by planned / scheduled day; past + not done = late);
 *  - per-week counts and the per-person email limit, from the server's counts (d.meter.frequency,
 *    lib/marketing/frequency.mjs): people getting 1 / 2 / 3 / 4+ emails in the week's worst rolling 7 days; amber when
 *    anyone gets more than 2 without an approved exception for that campaign, red at 4+;
 *  - drafts (GPT's drafted campaigns and manual steps): dashed "draft · proposed time" cards, never counted as sends;
 *  - possible duplicates: the server's own duplicate warning pair (lib/marketing/delivery.mjs), or a Squarespace
 *    schedule not matched to a campaign beside one of its candidate records on the same UK day;
 *  - gaps: a future week with no step on a channel is "nothing planned" (steps are never invented);
 *  - "Selling this week" from the quarter plan (initiatives, open actions) and event / offer dates.
 * Exposes window.mkScheduleModel.
 */
(function () {
  const LONDON = 'Europe/London';
  const EMAIL_LIMIT = 2;
  const ROWS = ['email', 'fbig', 'linkedin', 'youtube', 'outlook', 'gbp'];
  const ROW_OF = { email: 'email', facebook: 'fbig', instagram: 'fbig', linkedin: 'linkedin', youtube: 'youtube', outlook: 'outlook', gbp: 'gbp' };
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
  const TITLE_MAX = 28;
  /**
   * Card title: the campaign's short title if it has one; otherwise the title cut at a word boundary (never a word
   * dropped from the middle) with "…", at most TITLE_MAX characters before the "…". Full title: side panel + tooltip.
   */
  function shortTitle(t, short) {
    if (short) return String(short);
    const s = String(t || '').replace(/^Weekly email \((.*)\)$/, 'Weekly: $1').replace(/^Google Business check.*$/i, 'Weekly check')
      .replace(LEAD, '').replace(/["“”]/g, '').replace(/\s+\+\s*\d+\s+more$/, '').trim();
    if (s.length <= TITLE_MAX) return s;
    const words = s.split(/\s+/);
    let out = words[0].slice(0, TITLE_MAX);
    for (const w of words.slice(1)) {
      if (`${out} ${w}`.length > TITLE_MAX) break;
      out = `${out} ${w}`;
    }
    return `${out.replace(/[\s,:;·—–|-]+$/, '')}…`;
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

  const unverified = (dl) => !!dl && dl.record_stage === 'scheduled' && (!dl.evidence || !!dl.not_in_scheduled) && !dl.sent && !dl.cancelled;
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
  /** A draft: a drafted campaign record not scheduled or sent, or a manual (non-generated) step not yet done. */
  function isDraft(it) {
    if (it.status === 'done' || it.status === 'resolved') return false;
    const dl = it.delivery;
    if (dl) return dl.record_stage === 'drafted' && !dl.sent && !dl.operator && dl.provider?.state !== 'scheduled';
    return it.step != null && !String(stepKeyOf(it)).startsWith('step|');
  }
  /** Card time; a draft reads "draft · <proposed time>". */
  function timeLabel(at, draft) {
    const time = at ? timeOf(at) : null;
    return draft ? `draft · ${time || 'time not set'}` : time;
  }
  function placeItem(it, today) {
    const done = it.status === 'done';
    const at = done ? it.done_at : it.planned_at;
    const day = at ? dayOf(at) : it.planned || null;
    const row = ROW_OF[it.channel] || it.channel;
    const draft = isDraft(it);
    return {
      id: `${row}|${it.key}`, row, key: it.key, step_key: stepKeyOf(it), record_key: it.record_key || (row === 'email' ? it.key : null), draft,
      title: it.title, short: shortTitle(it.title, it.short_title), day, time: timeLabel(at, draft), people: row === 'email' ? peopleOf(it) : null,
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

  const countedEmails = (items) => items.filter((x) => x.row === 'email' && COUNTED.has(x.state) && x.day && !x.draft);
  const fmt = (k) => Number(k).toLocaleString('en-GB');
  /** "573×2 · 39×3 (38 approved) · 9×1" from the server's counts for one rolling 7 days. */
  function perPersonText(f) {
    const b = f.by_count || {};
    const appr = b[3] && f.approved_over ? ` (${f.approved_over === b[3] ? 'approved' : `${fmt(f.approved_over)} approved`})` : '';
    const parts = [b[2] ? `${fmt(b[2])}×2` : '', b[3] ? `${fmt(b[3])}×3${appr}` : '', b['4+'] ? `${fmt(b['4+'])}×4+` : '', b[1] ? `${fmt(b[1])}×1` : ''];
    return parts.filter(Boolean).join(' · ') || null;
  }
  /** Per-person frequency for a week (its worst rolling 7 days, counted on the server); never a campaign count. */
  function frequencyOf(model, week) {
    const f = model.freq?.weeks?.[week];
    if (!f) return { red: false, amber: false, max: 0, at: null, per_person: null, freq: null };
    const b = f.by_count || {};
    const max = b['4+'] ? 4 : [3, 2, 1].find((k) => b[k]) || 0;
    return { red: f.level === 'red', amber: f.level === 'amber', max, at: f.to, window: { from: f.from, to: f.to }, per_person: perPersonText(f), freq_estimate: !!f.estimate, freq: f };
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
  const DONT = 'dont_promote';
  const dm = (iso) => ukShort(iso).split(' ').slice(1).join(' ');
  /** "15 Dec", "27–30 Nov", "28 Dec–1 Jan"; nothing for a span longer than a week (it runs all week). */
  function span(a, b) {
    if (!b || b === a) return dm(a);
    if (b > addDays(a, 7)) return '';
    return a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${dm(b)}` : `${dm(a)}–${dm(b)}`;
  }
  /** Fixed selling moments (public.marketing_selling_moments via GET /api/aigeo/marketing-schedule-extras). */
  function fixedBits(moments, week, end) {
    return (moments || []).filter((m) => m.starts_on <= end && (m.ends_on || m.starts_on) >= week)
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || a.starts_on.localeCompare(b.starts_on))
      .map((m) => ({ b: m.label, t: span(m.starts_on, m.ends_on) }));
  }
  function momentBits(s, week) {
    const w = (s?.campaign?.weeks || []).find((x) => x.week === week);
    const rows = [...(w?.rows || []), ...(w?.more || [])].filter((r) => r.type === 'moment' && MOMENT_ORDER.includes(r.stage) && r.name && r.promote_mode !== DONT);
    rows.sort((a, b) => MOMENT_ORDER.indexOf(a.stage) - MOMENT_ORDER.indexOf(b.stage));
    return rows.map((r) => ({ b: r.name, t: r.stage.toLowerCase() }));
  }
  function offerBits(s, week, end) {
    return Object.values(s?.campaign?.overrides || {}).filter((o) => o.offer_code && o.offer_ends && o.offer_ends >= week && o.offer_ends <= end)
      .map((o) => ({ b: o.offer_code, t: `ends ${ukShort(o.offer_ends).split(' ').slice(0, 2).join(' ')}` }));
  }
  /** Events that week; one set to "don't promote" may show as happening (dim), never as something being sold. */
  function eventBits(s, week, end, names) {
    const mode = (e) => s?.campaign?.overrides?.[`${e.date}|${e.url}`]?.promote_mode;
    return (s?.diary || []).filter((e) => e.date >= week && e.date <= end).map((e) => {
      const name = names.get(`${e.date}|${e.url}`) || plainName(e.title);
      return mode(e) === DONT ? { b: '', t: `${name} ${dm(e.date)} (not promoted)`, quiet: true } : { b: name, t: dm(e.date) };
    });
  }
  const initiativesOf = (s) => Object.values(s?.quarter_plan?.initiatives || {}).filter((i) => i.kind === 'initiative');
  const within = (d, week, end) => !!d && d >= week && d <= end;
  /** Quarter plan: an initiative's dated next action that week, else its open milestones due that week; starts. */
  function planBits(s, week, end) {
    const out = [];
    for (const i of initiativesOf(s)) {
      if (within(i.start_date, week, end)) out.push({ b: i.title, t: 'starts' });
      if (within(i.next_action_date, week, end) && i.next_action) { out.push({ b: shortTitle(i.next_action), t: dm(i.next_action_date) }); continue; }
      for (const a of (i.actions || []).filter((x) => !x.is_ticked && within(x.due, week, end))) out.push({ b: shortTitle(a.label), t: '' });
    }
    return out;
  }
  function activeBits(s, week, end) {
    return initiativesOf(s).filter((i) => i.start_date <= end && (!i.end_date || i.end_date >= week)).slice(0, 2).map((i) => ({ b: '', t: i.title, quiet: true }));
  }
  const SELLING_MAX = 4;
  /** At most 4 short items: fixed moments, campaign moments, offer ends, events, quarter plan; initiatives as fallback. */
  /** span = 7 (a week) or 1 (one day: dated items only; the weekly campaign moments and initiative fallback are weekly). */
  function sellingFor(s, week, moments, span = 7) {
    const end = addDays(week, span - 1);
    const weekly = span === 7;
    const bits = [...fixedBits(moments, week, end), ...(weekly ? momentBits(s, week) : []), ...offerBits(s, week, end), ...eventBits(s, week, end, eventNames(s)), ...planBits(s, week, end)];
    const seen = new Set();
    const uniq = bits.filter((x) => { const k = `${x.b}|${x.t}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const selling = uniq.filter((x) => !x.quiet);
    const quiet = uniq.filter((x) => x.quiet);
    return [...(selling.length || !weekly ? selling : activeBits(s, week, end)), ...quiet].slice(0, SELLING_MAX);
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
  /** Per person, next 7 days: amber = more than 2 without an approved exception; red = anyone at 4+. */
  function frequencyLine(items, d) {
    const f = d?.meter?.frequency?.next_7_days;
    if (!f || f.level === 'ok') return null;
    const ids = countedEmails(items).filter((x) => x.day >= f.from && x.day <= f.to).map((x) => x.id);
    const span = `${ukShort(f.from)} – ${ukShort(f.to)}`;
    if (f.level === 'red') return { level: 'red', text: `${fmt(f.by_count['4+'])} ${f.by_count['4+'] === 1 ? 'person gets' : 'people get'} 4 or more emails in 7 days (${span}). Move one.`, ids };
    const covered = f.approved_over ? ` (${fmt(f.approved_over)} more covered by an approved exception)` : '';
    return { level: 'amber', text: `${fmt(f.unapproved_over)} ${f.unapproved_over === 1 ? 'person gets' : 'people get'} 3 emails in 7 days (${span}) without an approved exception${covered}.`, ids };
  }
  function recordLines(items, cap) {
    const out = [];
    const gone = items.filter((x) => x.state === 'warn' && x.raw?.delivery?.not_in_scheduled);
    if (gone.length) out.push({ level: 'red', text: `Not in Squarespace Scheduled — check: ${gone.map((x) => `“${x.short}”`).join(', ')} (marked scheduled; counted as a draft, not reserved, until Squarespace lists it again).`, ids: gone.map((x) => x.id) });
    const warn = items.filter((x) => x.state === 'warn' && !x.raw?.delivery?.not_in_scheduled);
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
  /** Squarespace drafts no campaign record matches (d.drafts from the overview): listed, never turned into a send. */
  function draftLine(d) {
    const u = d?.drafts?.unmatched || [];
    if (!u.length) return [];
    const names = u.slice(0, 2).map((x) => `“${shortTitle(x.subject || '(no subject)')}”`).join(', ');
    return [{ level: 'amber', text: `${u.length} unmatched platform draft${u.length === 1 ? '' : 's'} in Squarespace (${names}${u.length > 2 ? ', …' : ''}): link it to its campaign.`, ids: [], go: 'mkd-drafts' }];
  }
  function needsYou(items, pairs, d, cap, today) {
    return [...dupLines(pairs), frequencyLine(items, d), lateLine(items), ...recordLines(items, cap), ...unmatchedLine(d, pairs), ...draftLine(d)].filter(Boolean);
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
   * One YouTube row per content record's YouTube release (board content[], lib/marketing/delivery-content.mjs). Status is
   * the provider's (status on the use); the card state follows it and never moves on by time.
   */
  const YT_STATE = { published: 'done', scheduled: 'sch' };
  function youtubeItem(c) {
    const u = (c.uses || []).find((y) => y.channel === 'youtube') || {};
    const at = u.planned_at || c.release_at;
    if (!at) return null;
    const st = u.status || c.status || {};
    return { id: `youtube|${c.asset_key}`, row: 'youtube', key: c.asset_key, title: c.title, short: shortTitle(String(c.title || '').split(' | ')[0]), day: dayOf(at), time: timeOf(at), people: null, state: YT_STATE[st.code] || 'pl', synthetic: true, raw: { status: st, content: c, link: u.link || c.url || null, planned_at: at } };
  }
  const youtubeItems = (content) => (content || []).filter((c) => c.format === 'short_video').map(youtubeItem).filter(Boolean);

  /**
   * Verified provider posts with no campaign step (board placements[].unplanned, e.g. Alan's 1-2-1 posts): one row per
   * step key, "added (no campaign step)"; the List / grid status comes from the board's placements as for any post.
   */
  function addedItem(key, ps) {
    const first = [...ps].sort((a, b) => String(a.planned_at).localeCompare(String(b.planned_at)))[0];
    if (!first?.planned_at) return null;
    const row = ps.every((p) => p.placement === 'linkedin_feed') ? 'linkedin' : 'fbig';
    const booked = ps.some((p) => ['scheduled', 'published'].includes(p.status?.code));
    return { id: `${row}|added|${key}`, row, key, step_key: key, title: first.title || key, short: shortTitle(first.title || key), day: dayOf(first.planned_at), time: timeOf(first.planned_at), people: null, state: booked ? 'sch' : 'pl', synthetic: true, added: true, raw: { planned_at: first.planned_at, added: true, set_by: first.set_by || null } };
  }
  /**
   * Exactly one row per post: when a row for the same step key and row already exists (e.g. the early List's board items),
   * that row is labelled "added" instead of a second one being created.
   */
  function addedItems(placements, placed = []) {
    const by = new Map();
    for (const p of (placements || []).filter((x) => x.unplanned)) by.set(p.step_key, [...(by.get(p.step_key) || []), p]);
    const out = [];
    for (const [k, ps] of by) {
      const x = addedItem(k, ps);
      const same = x && placed.find((y) => y.step_key === k && y.row === x.row);
      if (same) same.added = true;
      else if (x) out.push(x);
    }
    return out;
  }

  /** Generated "Main email of the week" steps covered by a real campaign that week (step.covered_by, set server-side). */
  function coverIndex(s) {
    const m = new Map();
    for (const w of s?.campaign?.weeks || []) for (const st of w.steps || []) if (st.is_email && st.covered_by?.length) m.set(st.key, st);
    return m;
  }
  const moduleLine = (f) => `${f.name || f.title}${f.when ? ` ${f.when}` : ''}${f.stage ? ` (${String(f.stage).toLowerCase()})` : ''}`;
  /**
   * A covered placeholder is not shown and not counted (resolved, display only: no record changes); its event modules
   * go to the covering campaign's side panel as "suggested modules".
   */
  function applyCover(placed, s) {
    const idx = coverIndex(s);
    for (const x of placed) {
      const st = x.row === 'email' && x.state !== 'done' ? idx.get(x.step_key) : null;
      if (!st) continue;
      x.state = 'resolved';
      x.covered_by = st.covered_by;
      const by = placed.find((y) => y !== x && st.covered_by.includes(y.record_key));
      if (by) by.suggested = (st.featured || []).map(moduleLine);
    }
  }
  const SOCIAL = new Set(['fbig', 'linkedin']);
  const generated = (x) => String(x.step_key || '').startsWith('step|');
  /**
   * A generated social step on a day and channel where GPT's manual row already sits (same slot) is not shown: the
   * manual row is the delivery, the generated one goes to its panel as "suggested" (display only, no record changes).
   */
  function coverSocial(placed) {
    const manual = placed.filter((y) => SOCIAL.has(y.row) && y.step_key && !generated(y) && y.state !== 'resolved');
    for (const x of placed.filter((y) => SOCIAL.has(y.row) && generated(y) && !['done', 'resolved'].includes(y.state))) {
      const by = manual.find((y) => y.row === x.row && y.day === x.day);
      if (!by) continue;
      x.state = 'resolved';
      x.covered_by = [by.id];
      by.suggested = [...(by.suggested || []), `Generated plan: ${x.title}`];
    }
  }

  /**
   * Everything both views need. items = window.mkDeliveryItems(d, s); cap = window.mkCapacity(d, s); g = Google
   * Business status (or null); moments = fixed selling moments (marketing_selling_moments); content = the status
   * board's content records (YouTube Shorts); placements = the board's placements (only `unplanned` ones add rows).
   * today = YYYY-MM-DD (UK).
   */
  function build(input) {
    const { items, d, s, cap, g } = { items: [], d: null, s: null, cap: null, g: null, ...input };
    const today = input?.today || todayIso();
    const placed = mergeSocial(items).map((it) => placeItem(it, today));
    applyCover(placed, s);
    coverSocial(placed);
    const auto = gbpItem(g, today);
    if (auto) placed.push(auto);
    placed.push(...youtubeItems(input?.content), ...addedItems(input?.placements, placed));
    const pairs = markDuplicates(placed, dupPairs(d));
    return { today, items: placed, byId: new Map(placed.map((x) => [x.id, x])), pairs, freq: d?.meter?.frequency || null, needs: needsYou(placed, pairs, d, cap, today), allowance: allowance(cap), s, moments: input?.moments || [], week_start: s?.week_start || mondayOf(today) };
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

  function emailSummary(model, weekItems, week) {
    const counted = countedEmails(weekItems);
    const known = counted.filter((x) => x.people != null);
    const drafts = weekItems.filter((x) => x.row === 'email' && x.draft && visible(x));
    return {
      count: counted.length, sends: known.reduce((t, x) => t + x.people, 0), estimate: counted.some((x) => x.estimate), unknown: counted.length - known.length,
      late: weekItems.filter((x) => x.row === 'email' && x.state === 'late').length,
      skipped: weekItems.filter((x) => x.row === 'email' && x.state === 'resolved' && /skipped/.test(String(x.raw?.note || ''))).length,
      drafts: drafts.length, draft_people: drafts.reduce((t, x) => t + (x.people || 0), 0),
      ...frequencyOf(model, week)
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
    return { week, end, now: model.today >= week && model.today <= end, past: end < model.today, planned: hasSteps(model.s, week), selling: sellingFor(model.s, week, model.moments), emails: emailSummary(model, items, week), cells, gaps };
  }
  const isSunday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 0;
  /** Weeks run Mon–Sun. The range starts this week; on a Sunday the week ending today is over, so it starts tomorrow. */
  const firstWeek = (today) => (isSunday(today) ? addDays(today, 1) : mondayOf(today));
  /** The week before the range shows only with late items (or, on a Sunday, anything still open today). */
  const lateIn = (w) => ROWS.some((r) => w.cells[r].some((c) => c.late));
  const showBefore = (w) => lateIn(w) || (w.now && ROWS.some((r) => w.cells[r].length));
  function tagOf(w, i, today) {
    if (w.now) return isSunday(today) ? 'this week · ends today' : 'this week';
    if (w.past) return 'last week';
    return i === 0 && isSunday(today) ? 'next week · from tomorrow' : '';
  }
  /** "This week + 8" = count 9 (never fewer); Quarter = count 20 up to lastDay. */
  function weeks(model, count, lastDay) {
    const start = firstWeek(model.today);
    const out = [];
    for (let w = start; out.length < count && (!lastDay || w <= lastDay); w = addDays(w, 7)) out.push(weekRow(model, w));
    out.forEach((w, i) => { w.tag = tagOf(w, i, model.today); });
    const before = weekRow(model, addDays(start, -7));
    before.tag = tagOf(before, -1, model.today);
    return showBefore(before) ? [before, ...out] : out;
  }
  const quarterEnd = (s) => (s?.quarter_plan?.quarters || []).find((q) => q.state === 'current')?.end_date || null;
  const UPCOMING = new Set(['sch', 'pl', 'warn']);
  /** Planned's first item: the earliest upcoming card (scheduled, planned or draft; not done, late or resolved), by day then time. */
  function firstPlanned(model) {
    return (model?.items || []).filter((x) => UPCOMING.has(x.state) && x.day && x.day >= model.today)
      .sort((a, b) => `${a.day}${a.time || '99'}`.localeCompare(`${b.day}${b.time || '99'}`) || ROWS.indexOf(a.row) - ROWS.indexOf(b.row))[0] || null;
  }

  window.mkScheduleModel = { build, days, weeks, firstWeek, quarterEnd, shortTitle, perPersonText, dupPairs, sellingFor, addDays, mondayOf, ukShort, ROWS, EMAIL_LIMIT, firstPlanned };
})();
