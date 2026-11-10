/**
 * Marketing & Campaigns → Overview: "Next 12 weeks: by channel" (mock-up channels-tile-v1, Alan 10 Nov 19:00), directly
 * after "Next 12 weeks: content mix". The delivery rows count the content mix's own list (quarter_plan.purpose_mix.items:
 * same window, same deliveries), so Sched + Waiting + planned-with-no-post = the content-mix deliveries and Drafts = its
 * drafts. A shared Facebook + Instagram post is one delivery; its platform placements (board placements) are shown
 * beneath and are not added again. Google Business exception posts and YouTube Shorts are not in the content mix and are
 * listed apart. Read-only.
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

  /** On the platform's own schedule or further (booked); a closed "done" GBP step was posted / scheduled in Google. */
  const BOOKED = new Set(['scheduled', 'checking', 'late', 'sent', 'published', 'verification_unavailable', 'done']);
  const EMPTY = () => ({ sched: 0, waiting: 0, drafts: 0, planned: 0, items: [] });

  /** Content-mix delivery → its column: drafts apart; approved-waiting; booked; else planned with no post yet. */
  function bucketOf(x) {
    if (x.draft) return 'drafts';
    if (x.waiting) return 'waiting';
    return BOOKED.has(x.code) ? 'sched' : 'planned';
  }
  const GROUPS = [['email', /Squarespace|email/i], ['fbig', /Facebook|Instagram/], ['linkedin', /LinkedIn/], ['gbp', /Google/], ['outlook', /Outlook/]];
  const groupOf = (channel) => (GROUPS.find(([, re]) => re.test(channel || '')) || ['other'])[0];

  function addTo(row, x, bucket, day) {
    row[bucket] += 1;
    row.items.push({ key: x.key, day, at: x.at || null, bucket });
  }
  /** The content mix's deliveries by channel group (exactly the tile 6 list). */
  function mixRows(mix) {
    const rows = {};
    for (const x of mix?.items || []) {
      const g = groupOf(x.channel);
      addTo(rows[g] || (rows[g] = EMPTY()), x, bucketOf(x), x.day);
    }
    return rows;
  }

  /** Placements of the content mix's Facebook + Instagram posts (board), by platform; steps with none = planned, no post. */
  const PLACEMENTS = [['facebook_feed', 'Facebook', 'facebook'], ['instagram_feed', 'Instagram', 'instagram'], ['instagram_story', 'Instagram Stories', 'instagram']];
  function placementBucket(p, draftStep) {
    const code = p.status?.code;
    if (BOOKED.has(code)) return 'sched';
    if (code === 'waiting_window' || (p.approved && !draftStep)) return 'waiting';
    return 'drafts';
  }
  function placementRows(mix, board, win) {
    if (!board?.placements) return null;
    const steps = new Map((mix?.items || []).filter((x) => groupOf(x.channel) === 'fbig').map((x) => [x.key, x]));
    const out = Object.fromEntries(PLACEMENTS.map(([k]) => [k, EMPTY()]));
    for (const p of board.placements) {
      const step = steps.get(p.step_key);
      const day = p.planned_at ? dayOf(p.planned_at) : step?.day;
      if (!step || !out[p.placement] || !day || day < win.from || day > win.to) continue;
      addTo(out[p.placement], { key: `${p.step_key}|${p.placement}`, at: p.planned_at }, placementBucket(p, step.draft), day);
    }
    return out;
  }

  /** Google Business exception posts (campaign steps; GPT ticks them done once posted / scheduled in Google). */
  const SKIPPED = new Set(['skipped', 'not_needed']);
  function gbpRow(s, win) {
    const c = s?.campaign;
    const steps = [...(c?.weeks || []).flatMap((w) => w.steps || []), ...(c?.carried?.future || [])].filter((x) => x.gbp === 'exception' && !SKIPPED.has(x.state?.status));
    const row = EMPTY();
    for (const x of steps.filter((y) => y.day >= win.from && y.day <= win.to)) addTo(row, { key: x.key }, x.state?.status === 'done' ? 'sched' : 'planned', x.day);
    return row;
  }

  /** YouTube Shorts from the content records (board.content: release time + YouTube's own status). */
  function shortsRow(board, win) {
    if (!board?.content) return null;
    const row = EMPTY();
    for (const a of board.content.filter((y) => y.format === 'short_video')) {
      const at = a.release_at || a.provider?.publish_at;
      const day = at ? dayOf(at) : null;
      if (!day || day < win.from || day > win.to) continue;
      addTo(row, { key: a.asset_key, at }, BOOKED.has(a.status?.code) ? 'sched' : 'drafts', day);
    }
    return row;
  }

  /** First stretch of 14+ days with nothing booked or approved-waiting, from today to the plan's horizon. */
  function gapOf(row, from, horizon) {
    const covered = [...new Set(row.items.filter((i) => i.bucket === 'sched' || i.bucket === 'waiting').map((i) => i.day))].sort();
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
    if (row.planned) out.push({ kind: 'planned', text: `${plural(row.planned, 'planned step')} with no post yet`, tip: `${plural(row.planned, 'campaign step')} in the next 12 weeks with nothing created on the platform yet (no draft, no schedule): counted in the content mix, not booked` });
    const g = row.items.length ? gapOf(row, ctx.today, ctx.horizon) : null;
    if (g) out.push(gapFlag(g, ctx));
    return out;
  }

  /* ---------- model ---------- */

  const MIX_ROWS = [['email', 'Email', 'email'], ['fbig', 'Facebook + Instagram', 'facebook'], ['linkedin', 'LinkedIn', 'linkedin'], ['gbp', 'Google Business', 'google'], ['outlook', 'Personal email (Outlook)', 'outlook'], ['other', 'Other', 'all']];
  function horizonOf(mix, win) {
    const last = (mix?.items || []).map((x) => x.day).filter(Boolean).sort().pop() || win.to;
    return last > win.to ? win.to : last;
  }
  const rowOut = (key, label, go, r, ctx, extra = {}) => ({ key, label, go, ...r, next: nextOf(r, ctx), flags: flagsOf(r, ctx), ...extra });
  /** Generated weekly steps a GPT post already covers (server: purpose_mix.covered), per row: shown, never counted. */
  function coveredBy(mix) {
    const out = {};
    for (const c of mix?.covered || []) (out[groupOf(c.channel)] = out[groupOf(c.channel)] || []).push(c);
    return out;
  }

  /** Google Business: exception posts (not in the content mix) added to any GBP deliveries the content mix holds. */
  function gbpOut(byGroup, s, ctx) {
    const steps = gbpRow(s, ctx.win);
    const inMix = byGroup.gbp || EMPTY();
    const r = { sched: steps.sched + inMix.sched, waiting: inMix.waiting, drafts: inMix.drafts, planned: steps.planned + inMix.planned, items: [...steps.items, ...inMix.items] };
    return rowOut('gbp', 'Google Business', 'google', r, ctx, { in_mix: false, mix_part: inMix });
  }
  function shortsOut(board, ctx) {
    const sh = shortsRow(board, ctx.win);
    if (!sh) return { key: 'youtube', label: 'YouTube Shorts', go: 'youtube', missing: true, in_mix: false };
    return rowOut('youtube', 'YouTube Shorts', 'youtube', sh, ctx, { in_mix: false, flags: [] });
  }
  function totalsOf(rows, gbp) {
    const parts = [...rows, gbp.mix_part];
    const sum = (k) => parts.reduce((t, r) => t + (r[k] || 0), 0);
    return { sched: sum('sched'), waiting: sum('waiting'), drafts: sum('drafts'), planned: sum('planned') };
  }

  function build(s, board, today, nowMs = Date.parse(`${today}T00:00:00Z`)) {
    const mix = s?.quarter_plan?.purpose_mix;
    if (!mix?.items || !mix.window) return null;
    const win = mix.window;
    const ctx = { today: today < win.from ? win.from : today, now: nowMs, win, horizon: horizonOf(mix, win) };
    const byGroup = mixRows(mix);
    const cov = coveredBy(mix);
    const rows = MIX_ROWS.filter(([k]) => k !== 'gbp' && byGroup[k]).map(([k, label, go]) => rowOut(k, label, go, byGroup[k], ctx, { in_mix: true, covered: cov[k] || [] }));
    const pl = placementRows(mix, board, win);
    const subs = pl ? PLACEMENTS.map(([k, label, go]) => rowOut(k, label, go, pl[k], ctx, { sub: true, flags: [] })) : null;
    const gbp = gbpOut(byGroup, s, ctx);
    return { win, ctx, rows, subs, gbp, shorts: shortsOut(board, ctx), totals: totalsOf(rows, gbp), mix: { deliveries: mix.deliveries, waiting: mix.waiting?.deliveries || 0, drafts: mix.draft?.deliveries || 0, covered: (mix.covered || []).length, superseded: (mix.superseded || []).length } };
  }

  /* ---------- render ---------- */

  const TIP = 'Sched = booked in the platform (Squarespace Scheduled, Meta, LinkedIn, Google, YouTube) · Waiting = approved, waiting for the platform\'s scheduling window · Drafts = still being prepared, not committed · Next = the next booked item. Same 12-week window and deliveries as the content mix: a shared Facebook + Instagram post is one delivery, its placements are listed beneath it. Amber = a gap to fill. Click a channel for its posts in the schedule.';
  const cell = (v, cls) => `<td><span class="${cls}">${n(v)}</span></td>`;
  const flagHtml = (fs) => fs.map((f) => `<span class="mkch-gap" data-mkch-flag="${f.kind}" title="${esc(f.tip)}">${esc(f.text)}</span>`).join('');
  /** "2 covered by GPT post" (muted): generated weekly steps GPT's own post on that channel and day already covers. */
  function coveredHtml(list) {
    if (!list?.length) return '';
    const tip = `Generated weekly steps not counted again: GPT's own post on this channel that day covers them.\n${list.map((c) => `${ukDay(c.day)}: "${c.title}" → GPT post "${c.covered_by_title || c.covered_by}"`).join('\n')}`;
    return `<span class="mkch-cov" data-mkch-covered="${list.length}" title="${esc(tip)}">${plural(list.length, 'step')} covered by GPT post</span>`;
  }
  function shortsMissing(board) {
    const loading = board === undefined;
    return { note: loading ? 'loading…' : 'not available', why: loading ? 'Loading the Shorts schedule (content records with YouTube status)…' : `The Shorts schedule (content records with YouTube status) could not be read: ${board?.error || 'status board unavailable'}` };
  }
  function rowHtml(r, board) {
    if (r.missing) {
      const x = shortsMissing(board);
      return `<tr class="mkch-r" data-mkch-go="${r.go}" data-mkch-row="${r.key}" title="${esc(x.why)}"><td class="left">${esc(r.label)}</td><td>—</td><td>—</td><td>—</td><td class="mkch-n">${esc(x.note)}</td></tr>`;
    }
    const sep = r.key === 'gbp' ? ' mkch-apart' : '';
    return `<tr class="mkch-r${r.sub ? ' mkch-sub' : ''}${sep}" data-mkch-go="${r.go}" data-mkch-row="${r.key}" title="Open the schedule: ${esc(r.label)}"><td class="left">${r.sub ? '└ ' : ''}${esc(r.label)}${flagHtml(r.flags)}${coveredHtml(r.covered)}</td>${cell(r.sched, 's')}${cell(r.waiting, 'w')}${cell(r.drafts, 'd')}<td class="mkch-n">${esc(ukDay(r.next))}</td></tr>`;
  }
  function reconcileLine(m) {
    const t = m.totals;
    const ok = t.sched + t.waiting + t.planned === m.mix.deliveries && t.drafts === m.mix.drafts;
    const tip = `Each content-mix delivery is in exactly one of the Email / Facebook + Instagram / LinkedIn rows: booked, waiting, planned with no post yet, or draft. The platform lines under Facebook + Instagram, Google Business exception posts and YouTube Shorts are not added again (they are not content-mix deliveries). Not counted in either tile: ${plural(m.mix.superseded, 'superseded step')} and ${plural(m.mix.covered, 'generated step')} covered by a GPT post.`;
    return `<div class="mkch-rec${ok ? '' : ' bad'}" data-mkch-rec="${ok ? 'ok' : 'mismatch'}" title="${esc(tip)}">= content mix: ${n(m.mix.deliveries)} deliveries (${n(t.sched)} sched + ${n(t.waiting)} waiting + ${n(t.planned)} planned, no post yet) · ${n(t.drafts)} drafts${ok ? ' ✓' : ` (content mix says ${n(m.mix.drafts)})`}</div>`;
  }
  const loadingTile = (why) => `<div class="mko-tile mkch r-grey" id="mk-channels"><div class="mko-num">6b</div><div class="mko-title" title="${esc(TIP)}">Next 12 weeks: by channel</div><div class="mko-head"><span class="mko-loading">${esc(why)}</span></div></div>`;

  window.mkChannelsTileHtml = function mkChannelsTileHtml(s, board, today, nowMs = Date.now()) {
    const m = s ? build(s, board, today, nowMs) : null;
    if (!m) return loadingTile(s ? 'content-mix list not available' : 'Loading…');
    const flagged = [...m.rows, m.gbp].some((r) => r.flags.length);
    const list = [...m.rows.flatMap((r) => (r.key === 'fbig' && m.subs ? [r, ...m.subs] : [r])), m.gbp, m.shorts];
    const active = list.filter((r) => !r.missing && !r.sub && r.items.length).length;
    const head = `<thead><tr><th class="left">Channel</th><th><span class="s">Sched</span></th><th><span class="w">Waiting</span></th><th><span class="d">Drafts</span></th><th>Next</th></tr></thead>`;
    return `<div class="mko-tile mkch r-${flagged ? 'amber' : 'green'}" id="mk-channels"><div class="mko-num">6b</div><div class="mko-title" title="${esc(TIP)}">Next 12 weeks: by channel</div>`
      + `<div class="mko-head">${n(active)} <span class="mko-unit">channels · next post and gaps</span></div>`
      + `<table class="mkch-t">${head}<tbody>${list.map((r) => rowHtml(r, board)).join('')}</tbody></table>${reconcileLine(m)}`
      + `<div class="mko-src">Sched = booked in the platform · Waiting = approved, waiting for its window · Drafts = still being prepared · amber = a gap to fill · → click a channel</div></div>`;
  };

  window.mkChannelsStyle = `<style>
    .mkch { cursor: default; } .mkch:hover { background: #111827; } .mkch .mko-title { cursor: help; }
    .mko-grid.c5 { container-type: inline-size; } .mko-grid.c5 > .mkch { grid-column: 1 / -1; }
    @container (min-width: 78rem) { .mko-grid.c5 > .mkch { grid-column: span 2; } }
    .mkch-t { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 0.2rem; }
    .mkch-t th { color: #94a3b8; font-weight: 400; text-align: right; padding: 3px 5px; border-bottom: 1px solid var(--dark-border); }
    .mkch-t td { text-align: right; padding: 4px 5px; border-bottom: 1px solid #1f283a; color: #fff; vertical-align: top; }
    .mkch-t th.left, .mkch-t td.left { text-align: left; }
    .mkch-r { cursor: pointer; } .mkch-r:hover td { background: #142033; }
    .mkch-sub td { color: #cbd5e1; font-size: 0.75rem; padding-top: 2px; padding-bottom: 2px; } .mkch-sub td.left { padding-left: 0.9rem; }
    .mkch-apart td { border-top: 1px dashed #334155; }
    .mkch-t td.mkch-n { color: #94a3b8; font-size: 0.74rem; white-space: nowrap; }
    .mkch-t .s { color: #4ade80; font-weight: 700; } .mkch-t .w { color: #60a5fa; font-weight: 700; } .mkch-t .d { color: #fbbf24; font-weight: 700; }
    .mkch-gap { display: block; color: #fbbf24; font-size: 0.7rem; font-weight: 600; cursor: help; }
    .mkch-cov { display: block; color: #94a3b8; font-size: 0.7rem; cursor: help; }
    .mkch-rec { font-size: 0.74rem; color: #94a3b8; margin-top: 0.35rem; } .mkch-rec.bad { color: #f87171; font-weight: 700; }
  </style>`;

  window.mkChannels = { build, bucketOf, groupOf, gapOf, placementRows, gbpRow, shortsRow };
})();
