/**
 * Marketing & Campaigns → Overview: "Next 12 weeks: by channel" (mock-up channels-tile-v1, Alan 10 Nov 19:00; separate
 * rows fix, Alan 10 Nov 20:14), directly after "Next 12 weeks: content mix". Seven channels, each its own row counting
 * its own posts / sends in the content mix's window (today + 84 days): Squarespace email = the content mix's email sends;
 * Facebook, Instagram, Instagram Stories and LinkedIn = the board placements of the content mix's steps on that platform
 * (a step with no placement there yet = draft, or planned with no post yet); Google Business = exception posts + any
 * GBP deliveries; YouTube Shorts = the content records. The content mix's own dedupe carries over: superseded steps and
 * generated steps a GPT post covers are not in its list, so none of their placements are counted. Read-only.
 */
(function () {
  const LONDON = 'Europe/London';
  const DAY = 86400000;
  const GAP_DAYS = 14;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
  const ukDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '') : '—');
  const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
  const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : (many || `${one}s`)}`;
  const inWin = (day, win) => !!day && day >= win.from && day <= win.to;

  /** On the platform's own schedule, still to go out; a closed "done" GBP step was posted / scheduled in Google. */
  const BOOKED = new Set(['scheduled', 'checking', 'late', 'verification_unavailable', 'done']);
  /** Already sent / published (today's sends are in the window): never Sched; counted apart, named in the row hover. */
  const SENT = new Set(['sent', 'published']);
  const EMPTY = () => ({ sched: 0, waiting: 0, drafts: 0, planned: 0, sent: 0, items: [] });
  const bookedBucket = (code, otherwise) => {
    if (SENT.has(code)) return 'sent';
    return BOOKED.has(code) ? 'sched' : otherwise;
  };

  /** Content-mix delivery → its column: drafts apart; approved-waiting; sent; booked; else planned with no post yet. */
  function bucketOf(x) {
    if (x.draft) return 'drafts';
    if (x.waiting) return 'waiting';
    return bookedBucket(x.code, 'planned');
  }
  const isEmail = (ch) => /Squarespace/i.test(ch || '') || (/email/i.test(ch || '') && !/Outlook/i.test(ch || ''));

  /**
   * The seven rows, in Alan's order. `place` = the board placement counted; `re` = the content-mix channels that post
   * there (a step of those channels with no placement yet is still that channel's draft / planned post).
   */
  const ROWS = [
    { key: 'email', label: 'Squarespace email', go: 'email', kind: 'mix', re: { test: isEmail } },
    { key: 'facebook', label: 'Facebook', go: 'facebook', kind: 'place', place: 'facebook_feed', re: /Facebook/ },
    { key: 'instagram', label: 'Instagram', go: 'instagram', kind: 'place', place: 'instagram_feed', re: /Instagram/ },
    { key: 'instagram_story', label: 'Instagram Stories', go: 'instagram', kind: 'place', place: 'instagram_story', re: null },
    { key: 'linkedin', label: 'LinkedIn', go: 'linkedin', kind: 'place', place: 'linkedin_feed', re: /LinkedIn/ },
    { key: 'gbp', label: 'Google Business', go: 'google', kind: 'gbp', re: /Google/ },
    { key: 'youtube', label: 'YouTube Shorts', go: 'youtube', kind: 'shorts', re: null }
  ];
  const rowOfChannel = (ch) => ROWS.find((r) => r.re && r.re.test(ch || ''));

  /** `ref` = the record the item comes from (content-mix delivery / step, Google Business step, Short): the service tiles' key. */
  function addTo(row, x, bucket, day) {
    row[bucket] += 1;
    row.items.push({ key: x.key, ref: x.ref || x.key, day, at: x.at || null, bucket });
  }
  /** Squarespace email: the content mix's own email sends (one send = one row item). */
  function mixRow(items, re) {
    const row = EMPTY();
    for (const x of items.filter((y) => re.test(y.channel))) addTo(row, x, bucketOf(x), x.day);
    return row;
  }

  /** A placement's column: booked on the platform; approved and waiting for its window; else still being prepared. */
  function placementBucket(p, draftStep) {
    const code = p.status?.code;
    if (SENT.has(code) || BOOKED.has(code)) return bookedBucket(code, 'sched');
    if (code === 'waiting_window' || (p.approved && !draftStep)) return 'waiting';
    return 'drafts';
  }
  /** A social channel: its placements of content-mix steps in the window, plus that channel's steps with none there yet. */
  function placementRow(items, board, win, def) {
    const steps = new Map(items.map((x) => [x.key, x]));
    const row = EMPTY();
    const placed = new Set();
    for (const p of board.placements.filter((y) => y.placement === def.place)) {
      const step = steps.get(p.step_key);
      const day = p.planned_at ? dayOf(p.planned_at) : step?.day;
      if (!step || !inWin(day, win)) continue;
      placed.add(step.key);
      addTo(row, { key: `${p.step_key}|${p.placement}`, ref: p.step_key, at: p.planned_at }, placementBucket(p, step.draft), day);
    }
    const unplaced = def.re ? items.filter((x) => def.re.test(x.channel) && !placed.has(x.key)) : [];
    for (const x of unplaced) addTo(row, { key: x.key }, x.draft ? 'drafts' : 'planned', x.day);
    return row;
  }

  /** Google Business exception posts (campaign steps; GPT ticks them done once posted / scheduled in Google). */
  const SKIPPED = new Set(['skipped', 'not_needed']);
  function gbpRow(s, win) {
    const c = s?.campaign;
    const steps = [...(c?.weeks || []).flatMap((w) => w.steps || []), ...(c?.carried?.future || [])].filter((x) => x.gbp === 'exception' && !SKIPPED.has(x.state?.status));
    const row = EMPTY();
    for (const x of steps.filter((y) => inWin(y.day, win))) addTo(row, { key: x.key }, x.state?.status === 'done' ? 'sched' : 'planned', x.day);
    return row;
  }
  /** Google Business: exception posts (not in the content mix) plus any GBP deliveries the content mix holds. */
  function gbpOut(items, s, win) {
    const a = gbpRow(s, win);
    const b = mixRow(items, /Google/);
    return { sched: a.sched + b.sched, waiting: b.waiting, drafts: b.drafts, planned: a.planned + b.planned, sent: a.sent + b.sent, items: [...a.items, ...b.items] };
  }

  /** YouTube Shorts from the content records (board.content: release time + YouTube's own status). */
  function shortsRow(board, win) {
    const row = EMPTY();
    for (const a of board.content.filter((y) => y.format === 'short_video')) {
      const at = a.release_at || a.provider?.publish_at;
      const day = at ? dayOf(at) : null;
      if (!inWin(day, win)) continue;
      addTo(row, { key: a.asset_key, at }, bookedBucket(a.status?.code, 'drafts'), day);
    }
    return row;
  }

  /** First stretch of 14+ days with nothing booked or approved-waiting, from today to the plan's horizon. */
  function gapOf(row, from, horizon) {
    const covered = [...new Set(row.items.filter((i) => ['sched', 'waiting', 'sent'].includes(i.bucket)).map((i) => i.day))].sort();
    const stops = [from, ...covered.filter((d) => d >= from && d <= horizon), horizon];
    for (let i = 1; i < stops.length; i += 1) {
      if (daysBetween(stops[i - 1], stops[i]) >= GAP_DAYS) return { from: stops[i - 1], to: stops[i], tail: i === stops.length - 1, none: !covered.length };
    }
    return null;
  }
  /** The next booked item still to come: by its time when known (an email sent at 10:00 today is not "next"), else its day. */
  function nextOf(row, ctx) {
    const ahead = row.items.filter((i) => i.bucket === 'sched' && (i.at ? Date.parse(i.at) > ctx.now : i.day >= ctx.today)).sort((a, b) => String(a.at || a.day).localeCompare(String(b.at || b.day)));
    return ahead[0]?.day || null;
  }
  function gapFlag(g, ctx) {
    const text = g.none ? 'nothing scheduled yet' : (g.tail ? `nothing after ${ukDay(g.from)}` : `nothing ${ukDay(g.from)} → ${ukDay(g.to)}`);
    return { kind: 'gap', text, tip: `No booked or approved-waiting item for ${daysBetween(g.from, g.to)} days (${ukDay(g.from)} → ${ukDay(g.to)}). Window ${ukDay(ctx.win.from)} → ${ukDay(ctx.win.to)}; gaps are checked up to the plan's last dated delivery (${ukDay(ctx.horizon)}).` };
  }
  function flagsOf(row, ctx) {
    const out = [];
    if (row.planned) out.push({ kind: 'planned', text: `${plural(row.planned, 'planned step')} with no post yet`, tip: `${plural(row.planned, 'campaign step')} in the next 12 weeks with nothing created on this platform yet (no draft, no schedule)` });
    const g = row.items.length ? gapOf(row, ctx.today, ctx.horizon) : null;
    if (g) out.push(gapFlag(g, ctx));
    return out;
  }

  /* ---------- model ---------- */

  function horizonOf(items, win) {
    const last = items.map((x) => x.day).filter(Boolean).sort().pop() || win.to;
    return last > win.to ? win.to : last;
  }
  /** The row's counts from its source; null = the source (the status board) is not loaded / not readable. */
  function countsOf(def, items, s, board, win) {
    if (def.kind === 'mix') return mixRow(items, def.re);
    if (def.kind === 'gbp') return gbpOut(items, s, win);
    if (def.kind === 'place') return board?.placements ? placementRow(items, board, win, def) : null;
    return board?.content ? shortsRow(board, win) : null;
  }
  /** Generated weekly steps a GPT post already covers (server: purpose_mix.covered): hover only, never counted. */
  const coveredOn = (mix, def) => (def.kind === 'place' && def.re ? (mix.covered || []).filter((c) => def.re.test(c.channel || '')) : []);
  function rowOut(def, mix, s, board, ctx) {
    const base = { key: def.key, label: def.label, go: def.go };
    const r = countsOf(def, mix.items, s, board, ctx.win);
    if (!r) return { ...base, missing: true };
    return { ...base, ...r, next: nextOf(r, ctx), flags: flagsOf(r, ctx), covered: coveredOn(mix, def) };
  }
  /** Content-mix deliveries none of the seven rows shows (e.g. personal Outlook notes): named in the title hover. */
  const elsewhere = (items) => items.filter((x) => !rowOfChannel(x.channel)).length;

  function build(s, board, today, nowMs = Date.parse(`${today}T00:00:00Z`)) {
    const mix = s?.quarter_plan?.purpose_mix;
    if (!mix?.items || !mix.window) return null;
    const win = mix.window;
    const ctx = { today: today < win.from ? win.from : today, now: nowMs, win, horizon: horizonOf(mix.items, win) };
    const rows = ROWS.map((def) => rowOut(def, mix, s, board, ctx));
    return { win, ctx, rows, mix: { deliveries: mix.deliveries, drafts: mix.draft?.deliveries || 0, covered: (mix.covered || []).length, superseded: (mix.superseded || []).length, elsewhere: elsewhere(mix.items) } };
  }

  /* ---------- render ---------- */

  const KEY = 'Sched = booked in the platform (Squarespace Scheduled, Meta, LinkedIn, Google, YouTube) · Waiting = content approved, waiting for the platform\'s scheduling window · Drafts = draft / in preparation: not yet scheduled on the platform (editorial approval and audience approval are tracked separately), not committed · Next = the next booked item · amber = a gap to fill · click a channel for its posts in the schedule.';
  /** Title hover: what this tile counts against the content-mix tile, so the two totals are expected to differ. */
  function titleTip(m) {
    const x = m.mix;
    const other = x.elsewhere ? ` ${plural(x.elsewhere, 'content-mix delivery', 'content-mix deliveries')} on other channels (e.g. personal Outlook email) are not one of these seven rows.` : '';
    return `${KEY}\n\nWhy this does not add up to the content mix: the content mix counts campaign deliveries (${n(x.deliveries)} + ${n(x.drafts)} drafts); this tile counts posts per channel. One shared Facebook + Instagram campaign post is one delivery there, but a Facebook post, an Instagram post and often a Story here. Google Business exception posts and YouTube Shorts are not content-mix deliveries.${other} Both tiles leave out ${plural(x.superseded, 'superseded step')} and ${plural(x.covered, 'generated step')} already covered by a GPT post on that channel and day.`;
  }
  const cell = (v, cls) => `<td><span class="${cls}">${n(v)}</span></td>`;
  const flagHtml = (fs) => fs.map((f) => `<span class="mkch-gap" data-mkch-flag="${f.kind}" title="${esc(f.tip)}">${esc(f.text)}</span>`).join('');
  function rowTip(r) {
    const cov = r.covered?.length ? `\n${plural(r.covered.length, 'generated step')} not counted again (GPT's own ${r.label} post that day covers them):\n${r.covered.map((c) => `${ukDay(c.day)}: "${c.title}" → GPT post "${c.covered_by_title || c.covered_by}"`).join('\n')}` : '';
    const sent = r.sent ? `\n${plural(r.sent, 'item')} already sent / published in the window (today): not counted as Sched.` : '';
    return `Open the schedule: ${r.label}${sent}${cov}`;
  }
  function missingNote(board) {
    const loading = board === undefined;
    return { note: loading ? 'loading…' : 'not available', why: loading ? 'Loading the delivery-status board (placements and Shorts)…' : `The delivery-status board (placements and Shorts) could not be read: ${board?.error || 'status board unavailable'}` };
  }
  const nameCell = (r, extra = '') => `<td class="left"><span class="mkch-name">${esc(r.label)}</span>${extra}</td>`;
  function rowHtml(r, board) {
    const attrs = `class="mkch-r" data-mkch-go="${r.go}" data-mkch-row="${r.key}"`;
    if (r.missing) {
      const x = missingNote(board);
      return `<tr ${attrs} title="${esc(x.why)}">${nameCell(r)}<td>—</td><td>—</td><td>—</td><td class="mkch-n">${esc(x.note)}</td></tr>`;
    }
    return `<tr ${attrs} title="${esc(rowTip(r))}">${nameCell(r, flagHtml(r.flags))}${cell(r.sched, 's')}${cell(r.waiting, 'w')}${cell(r.drafts, 'd')}<td class="mkch-n">${esc(ukDay(r.next))}</td></tr>`;
  }
  const loadingTile = (why) => `<div class="mko-tile mkch r-grey" id="mk-channels"><div class="mko-num">6b</div><div class="mko-title" title="${esc(KEY)}">Next 12 weeks: by channel</div><div class="mko-head"><span class="mko-loading">${esc(why)}</span></div></div>`;

  window.mkChannelsTileHtml = function mkChannelsTileHtml(s, board, today, nowMs = Date.now()) {
    const m = s ? build(s, board, today, nowMs) : null;
    if (!m) return loadingTile(s ? 'content-mix list not available' : 'Loading…');
    const flagged = m.rows.some((r) => r.flags?.length);
    const head = `<thead><tr><th class="left">Channel</th><th><span class="s">Sched</span></th><th><span class="w">Waiting</span></th><th><span class="d">Drafts</span></th><th>Next</th></tr></thead>`;
    return `<div class="mko-tile mkch r-${flagged ? 'amber' : 'green'}" id="mk-channels"><div class="mko-num">6b</div><div class="mko-title" title="${esc(titleTip(m))}">Next 12 weeks: by channel</div>`
      + `<div class="mko-head">${n(m.rows.length)} <span class="mko-unit">channels · next post and gaps</span></div>`
      + `<table class="mkch-t">${head}<tbody>${m.rows.map((r) => rowHtml(r, board)).join('')}</tbody></table>`
      + '<div class="mko-src">Sched = booked in the platform · Waiting = content approved, waiting for the platform\'s scheduling window · Drafts = draft / in preparation · amber = a gap to fill · click a channel → that channel\'s posts in the schedule</div></div>';
  };

  /** Every cell sits on its row's first-line baseline: the numbers line up with the channel name, notes hang below it. */
  window.mkChannelsStyle = `<style>
    .mkch { cursor: default; } .mkch:hover { background: #111827; } .mkch .mko-title { cursor: help; }
    .mko-grid.c5 { container-type: inline-size; } .mko-grid.c5 > .mkch { grid-column: 1 / -1; }
    @container (min-width: 78rem) { .mko-grid.c5 > .mkch { grid-column: span 2; } }
    .mkch-t { width: 100%; border-collapse: collapse; font-size: 0.8rem; line-height: 1.25; margin-top: 0.2rem; }
    .mkch-t th { color: #94a3b8; font-weight: 400; text-align: right; padding: 3px 5px; border-bottom: 1px solid var(--dark-border); }
    .mkch-t td { text-align: right; padding: 5px 5px; border-bottom: 1px solid #1f283a; color: #fff; vertical-align: baseline; }
    .mkch-t th.left, .mkch-t td.left { text-align: left; }
    .mkch-r { cursor: pointer; } .mkch-r:hover td { background: #142033; }
    .mkch-t td.mkch-n { color: #94a3b8; font-size: 0.74rem; white-space: nowrap; }
    .mkch-t .s { color: #4ade80; font-weight: 700; } .mkch-t .w { color: #60a5fa; font-weight: 700; } .mkch-t .d { color: #fbbf24; font-weight: 700; }
    .mkch-gap { display: block; color: #fbbf24; font-size: 0.7rem; font-weight: 600; line-height: 1.3; cursor: help; }
  </style>`;

  window.mkChannels = { build, bucketOf, gapOf, placementRow, gbpRow, shortsRow, ROWS: ROWS.map((r) => [r.key, r.label]) };
})();
