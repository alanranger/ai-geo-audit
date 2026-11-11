/**
 * Marketing & Campaigns → Overview: "Squarespace campaigns by billing cycle" (beside Email capacity, approved mock-up
 * sqs-campaigns-tile-v1, 10 Nov). Three cycles split at Squarespace's own reset instant (d.meter.cycle). Every row is a
 * delivery from d.meter.deliveries, with the same amount the capacity tile counts, so the two tiles always agree:
 * SCHED = in Squarespace's Scheduled tab (its scheduled recipient count), DRAFT = a planned record (its live segment
 * count at the last customer sync, else the plan estimate when no segment is chosen), never reserved. Read-only.
 */
(function () {
  const LONDON = 'Europe/London';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB').replace('-', '−'));
  const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
  const dm = (day) => (day ? new Date(`${String(day).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const ukDayTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }).replace(',', '') : '—');
  const ukStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }) : 'not yet');
  const plural = (k, one) => `${n(k)} ${one}${k === 1 ? '' : 's'}`;

  /** The cycle after next ends one calendar month after the next reset, at the same instant (as cycleOf on the server). */
  function boundsOf(cycle) {
    const after = new Date(cycle.next_reset);
    after.setUTCMonth(after.getUTCMonth() + 1);
    return { start: cycle.start, reset: cycle.reset, next_reset: cycle.next_reset, after: after.toISOString() };
  }

  /** Column 0 / 1 / 2 from the server's own cycle side (the capacity tile's split); "later" is cut at the cycle after. */
  function columnOf(d, b) {
    if (d.side === 'current') return 0;
    if (d.side === 'next') return 1;
    if (d.side !== 'later') return null;
    if (d.send_at) return Date.parse(d.send_at) < Date.parse(b.after) ? 2 : null;
    return d.send_day && d.send_day < dayOf(b.after) ? 2 : null;
  }

  /** Still to send and counted once: released sends and plans already counted as a schedule are left out. */
  const OPEN = new Set(['committed', 'provisional', 'draft', 'unbudgeted']);
  const isOpen = (d) => OPEN.has(d.bucket) && !d.scheduled_as;

  function tagOf(d) {
    if (d.sent) return 'SENT';
    if (d.not_in_scheduled) return 'DRAFT';
    if (d.provider?.state === 'scheduled' || d.operator || d.kind === 'squarespace_schedule') return 'SCHED';
    return d.bucket === 'committed' ? 'FROZEN' : 'DRAFT';
  }
  const RESERVED = new Set(['SCHED', 'FROZEN', 'SENT']);

  const segName = (id, segs) => (segs.find((s) => s.segment_id === id) || {}).name || id;
  /** Audience group for the per-segment breakdown, and the plain-English basis of the row's number. */
  function draftAudience(d, segs, sync) {
    if (d.audience === 'full_list' && d.estimate?.live) return { group: 'Full list', basis: `live: full Squarespace subscribed list, counted on this read (${sync})` };
    if (d.estimate?.live) {
      const group = (d.segment_ids || []).map((id) => segName(id, segs)).join(' + ') || 'chosen segment';
      return { group, basis: `live: ${group}, counted on this read (${sync})` };
    }
    const q = d.aud?.query_group && d.aud.query_now != null ? ` · saved group ${segName(d.aud.query_group, segs)} now ${n(d.aud.query_now)}, not attached` : '';
    if (d.amount == null) return { group: 'No audience chosen', basis: 'no audience chosen: not counted' };
    return { group: 'Plan estimate (no segment chosen)', basis: `plan estimate${d.estimate?.as_of ? ` as of ${dm(d.estimate.as_of)}` : ''}: no segment chosen on the record${q}` };
  }
  function audienceOf(d, tag, segs, syncAt) {
    const lists = (d.provider?.lists || []).join(' + ');
    if (tag === 'SENT') return { group: lists || 'Sent', basis: `sent: ${n(d.amount)} recipients, still reserved until the next meter read` };
    if (tag === 'SCHED') return { group: lists || 'Squarespace list', basis: d.provider?.state === 'scheduled' ? `Squarespace scheduled recipients${lists ? ` · ${lists}` : ''}` : 'operator-verified schedule (recipients on the record)' };
    if (tag === 'FROZEN') return { group: d.snapshot?.list_name || 'Frozen snapshot', basis: `frozen snapshot, not scheduled yet (reserved)${d.snapshot?.list_name ? ` · ${d.snapshot.list_name}` : ''}` };
    return draftAudience(d, segs, syncAt);
  }

  function rowOf(d, segs, syncAt) {
    const tag = tagOf(d);
    const day = d.send_at ? dayOf(d.send_at) : d.send_day;
    return { key: d.campaign_key || d.key, day, at: d.send_at || null, tag, title: d.title || d.key, amount: d.amount ?? null, reserved: RESERVED.has(tag), bucket: d.bucket, alert: alertOf(d), ...audienceOf(d, tag, segs, syncAt) };
  }
  /** Red: marked scheduled, Squarespace doesn't list it (counted as a DRAFT). Amber: a draft with no audience chosen. */
  function alertOf(d) {
    if (d.not_in_scheduled) return { level: 'red', text: 'Not in Squarespace Scheduled — check', tip: `${d.not_in_scheduled.reason}; counted as a draft, not reserved, until Squarespace lists it again` };
    if (d.audience || tagOf(d) !== 'DRAFT') return null;
    return { level: 'amber', text: 'audience not chosen', tip: d.amount == null ? 'no audience yet: not costed (no size assumed, nothing reserved)' : 'no segment chosen on the record: the number is the plan estimate, not a live count' };
  }

  /**
   * Sums for one column: every row counted (reserved = SCHED / FROZEN / SENT; drafts), with the per-group breakdown.
   * A row with no number (a draft with no audience yet, or a schedule with no recipient count) is counted as a row but
   * never costed: no size is invented and nothing is reserved for it.
   */
  function totalsOf(rows) {
    const t = { reserved: 0, drafts: 0, n_reserved: 0, n_drafts: 0, draft_bucket: 0, no_audience: 0, uncosted_reserved: 0, groups: new Map() };
    for (const r of rows) {
      if (r.reserved) t.n_reserved += 1; else t.n_drafts += 1;
      if (r.amount == null) { t[r.reserved ? 'uncosted_reserved' : 'no_audience'] += 1; continue; }
      if (r.reserved) t.reserved += r.amount; else t.drafts += r.amount;
      if (r.bucket === 'draft') t.draft_bucket += r.amount;
      const g = t.groups.get(r.group) || { emails: 0, sends: 0 };
      t.groups.set(r.group, { emails: g.emails + 1, sends: g.sends + r.amount });
    }
    t.total = t.reserved + t.drafts;
    t.uncosted = t.no_audience + t.uncosted_reserved;
    return t;
  }

  /**
   * This cycle: provider remaining − reserved (= free after commitments). Later cycles: the allowance − everything.
   * "Left if all go" only when every row is costed; otherwise "Left after costed sends" (the un-costed ones are not in it).
   */
  const ALL_GO = 'Left if all go';
  const COSTED = 'Left after costed sends';
  function leftOf(i, t, meter) {
    if (i === 0) {
      const left = meter.quota - meter.used - t.reserved;
      const label = t.uncosted_reserved ? COSTED : 'Left after these';
      return { label, value: left, if_drafts: t.n_drafts ? left - t.drafts : null, drafts_label: t.no_audience ? COSTED : 'Left if the drafts go too' };
    }
    return { label: t.uncosted ? COSTED : ALL_GO, value: meter.quota - t.total, if_drafts: null };
  }

  const sortRows = (a, b) => String(a.at || a.day).localeCompare(String(b.at || b.day)) || a.title.localeCompare(b.title);

  /** The customer rebuild the live counts stand on: the latest one, or "running" while one is rebuilding. */
  function syncLabel(r) {
    if (!r) return 'customer sync time not read';
    if (r.status === 'running') return `customer sync running since ${ukStamp(r.started_at)}`;
    return `last customer sync ${ukStamp(r.finished_at || r.started_at)}`;
  }

  /** Open deliveries into the three columns; the rest counted (reset day without a send time; beyond the cycle after). */
  function place(deliveries, b, segs, syncAt) {
    const cols = [[], [], []];
    const outside = { unallocated: 0, beyond: 0, beyond_rows: [] };
    for (const x of deliveries.filter(isOpen)) {
      const i = columnOf(x, b);
      if (i != null) cols[i].push(rowOf(x, segs, syncAt));
      else if (x.side === 'unallocated') outside.unallocated += 1;
      else if (x.side === 'later') outside.beyond_rows.push(rowOf(x, segs, syncAt));
    }
    outside.beyond = outside.beyond_rows.sort(sortRows).length;
    return { cols, outside };
  }

  function build(d) {
    const meter = d?.meter;
    if (!meter?.cycle || !meter.capacity || meter.quota == null) return null;
    const b = boundsOf(meter.cycle);
    const syncAt = syncLabel(d.runs?.['sync:customers']);
    const { cols, outside } = place(meter.deliveries || [], b, d.segments || [], syncAt);
    const columns = cols.map((rows, i) => {
      const sorted = rows.sort(sortRows);
      const t = totalsOf(sorted);
      return { i, rows: sorted, totals: t, left: leftOf(i, t, meter) };
    });
    return { bounds: b, quota: meter.quota, used: meter.used, remaining: meter.quota - meter.used, columns, outside, sync_at: syncAt, read_at: meter.schedule_read?.last_ok_at || null, meter_at: meter.captured_at };
  }

  /* ---------- render ---------- */

  function timeLeft(resetIso, nowMs) {
    const h = (Date.parse(resetIso) - nowMs) / 3600000;
    if (h <= 0) return 'resetting now';
    if (h < 24) return `${Math.ceil(h)} h left`;
    const k = Math.ceil(h / 24);
    return `${k} day${k === 1 ? '' : 's'} left`;
  }
  function headOf(i, b, nowMs) {
    if (i === 0) return ['This cycle', `to ${ukDayTime(b.reset)} · ${timeLeft(b.reset, nowMs)}`];
    if (i === 1) return ['Next cycle', `${dm(dayOf(b.reset))} → ${dm(dayOf(b.next_reset))}`];
    return ['Cycle after', `${dm(dayOf(b.next_reset))} → ${dm(dayOf(b.after))}`];
  }

  const TAG_TIP = { SCHED: 'in Squarespace Scheduled: reserved', DRAFT: 'planned, not reserved', FROZEN: 'frozen snapshot, not scheduled yet: reserved', SENT: 'sent, waiting for the next meter read: still reserved' };
  function rowHtml(r) {
    const tip = `${r.title} · ${TAG_TIP[r.tag]} · ${r.basis} · click to open the campaign record`;
    const alert = r.alert ? `<span class="mkc-al a-${r.alert.level}" title="${esc(r.alert.tip)}">${r.alert.level === 'red' ? '⚠ ' : ''}${esc(r.alert.text)}</span>` : '';
    return `<div class="mkc-e" role="link" tabindex="0" data-mkc-open="${esc(r.key)}" data-mkc-tag="${r.tag}" title="${esc(tip)}"><span class="mkc-dt">${esc(dm(r.day))}</span>`
      + `<span class="mkc-t"><span class="mkc-tag t-${r.tag.toLowerCase()}">${r.tag}</span>${esc(r.title)}${alert}</span><b class="mkc-n">${n(r.amount)}</b></div>`;
  }
  function breakdownTip(t) {
    const lines = [...t.groups].map(([g, x]) => `${g}: ${plural(x.emails, 'email')} · ${n(x.sends)} sends`);
    if (t.no_audience) lines.push(`${plural(t.no_audience, 'draft')} without an audience yet (not costed)`);
    return lines.join('\n') || 'nothing in this cycle';
  }
  /** "2 drafts without an audience yet (not costed)" (and the rare schedule with no recipient count), else nothing. */
  function uncostedHtml(t) {
    const parts = [];
    if (t.no_audience) parts.push(`${plural(t.no_audience, 'draft')} without an audience yet (not costed)`);
    if (t.uncosted_reserved) parts.push(`${plural(t.uncosted_reserved, 'scheduled email')} with no recipient count yet (not costed)`);
    return parts.length ? `<div class="mkc-unc" data-mkc-uncosted="${t.uncosted}" title="Counted as rows, not in the sends total or the left figure: no audience size is assumed and nothing is reserved for them">${esc(parts.join(' · '))}</div>` : '';
  }
  function totalHtml(c, m) {
    const t = c.totals;
    const label = c.i === 0 ? `Used so far ${n(m.used)} + scheduled` : `${n(t.n_reserved)} scheduled · ${plural(t.n_drafts, 'draft')}`;
    const value = c.i === 0 ? t.reserved : t.total;
    const extra = c.i === 0 && t.n_drafts ? `<div class="mkc-tot" title="${esc(breakdownTip(t))}"><span>+ ${plural(t.n_drafts, 'draft')} (not reserved)</span><b>${n(t.drafts)}</b></div>` : '';
    return `<div class="mkc-tot" data-mkc-total title="${esc(breakdownTip(t))}"><span>${esc(label)}</span><b>${n(value)}</b></div>${extra}${uncostedHtml(t)}`;
  }
  function leftHtml(c) {
    const l = c.left;
    const cls = l.value < 0 ? ' neg' : '';
    const ifDrafts = l.if_drafts != null ? `<div class="mkc-tot" data-mkc-left-drafts><span>${esc(l.drafts_label)}</span><b>${n(l.if_drafts)}</b></div>` : '';
    return `<div class="mkc-left${cls}" data-mkc-left><span>${esc(l.label)}</span><span>${n(l.value)}</span></div>${ifDrafts}`;
  }
  function columnHtml(c, m, nowMs) {
    const [h, sub] = headOf(c.i, m.bounds, nowMs);
    const rows = c.rows.map(rowHtml).join('') || '<div class="mkc-none">No scheduled or draft campaigns</div>';
    return `<div class="mkc-c" data-mkc-col="${c.i}"><div class="mkc-h">${h}</div><div class="mkc-d">${esc(sub)}</div>${rows}${totalHtml(c, m)}${leftHtml(c)}</div>`;
  }

  const TITLE_TIP = 'SCHED = in Squarespace\'s Scheduled tab (read by the collector): its scheduled recipient count is reserved against that cycle. DRAFT = a planned campaign record, not reserved: its audience is the live eligible count for its segment(s) at the last customer sync (the plan estimate when no segment is chosen), so it moves as the list changes. FROZEN = a frozen snapshot not scheduled yet (reserved); SENT = sent, still reserved until the next meter read. Cycles split at Squarespace\'s own reset instant. Click a row for its campaign record; hover a total for the per-segment breakdown.';

  function ragOf(m) {
    const lows = m.columns.map((c) => c.left.value);
    if (lows.some((v) => v < 0) || m.columns.some((c) => c.rows.some((r) => r.alert?.level === 'red'))) return 'red';
    return lows.some((v) => v < m.quota * 0.1) ? 'amber' : 'green';
  }
  /** Emails after the three cycles shown: count, dates and costed sends, each listed in the hover (they move into view at the next reset). */
  function beyondText(rows, b) {
    if (!rows.length) return null;
    const costed = rows.filter((r) => r.amount != null).reduce((t, r) => t + r.amount, 0);
    const uncosted = rows.filter((r) => r.amount == null).length;
    const span = `${dm(rows[0].day)} → ${dm(rows[rows.length - 1].day)}`;
    const text = `${plural(rows.length, 'email')} after these three cycles (${span} · ${n(costed)} sends${uncosted ? `, ${n(uncosted)} not costed` : ''}): in the cycle from ${dm(dayOf(b.after))}, shown once this cycle resets`;
    return { text, tip: rows.map((r) => `${dm(r.day)} · ${r.tag} · ${r.title} · ${n(r.amount)}`).join('\n') };
  }
  function outsideLine(o, b) {
    const parts = [];
    if (o.unallocated) parts.push({ text: `${plural(o.unallocated, 'email')} on a reset day with no send time (not placed in a cycle)`, tip: '' });
    const beyond = beyondText(o.beyond_rows || [], b);
    if (beyond) parts.push(beyond);
    return parts.map((p) => `<div class="mkc-foot" data-mkc-outside title="${esc(p.tip)}">${esc(p.text)}</div>`).join('');
  }

  window.mkSqsCyclesTileHtml = function mkSqsCyclesTileHtml(d, nowMs = Date.now()) {
    const m = build(d);
    if (!m) return '';
    const src = `Squarespace Scheduled read ${ukStamp(m.read_at)} · ${m.sync_at} · meter ${ukStamp(m.meter_at)}`;
    return `<div class="mko-tile mkc r-${ragOf(m)}" id="mk-sqs-cycles"><div class="mko-title" title="${esc(TITLE_TIP)}">Squarespace campaigns by billing cycle <span class="mkc-i">ⓘ</span></div>`
      + `<div class="mko-line mkc-sub">Every scheduled and draft campaign, with its audience, against each cycle's ${n(m.quota)} sends</div>`
      + `<div class="mkc-cols">${m.columns.map((c) => columnHtml(c, m, nowMs)).join('')}</div>${outsideLine(m.outside, m.bounds)}`
      + `<div class="mko-src">${esc(src)} · click a row → campaign record</div></div>`;
  };

  window.mkSqsCyclesStyle = `<style>
    .mko-grid.c5 { container-type: inline-size; }
    .mkc { cursor: default; grid-column: 1 / -1; } .mkc:hover { background: #111827; }
    @container (min-width: 78rem) { .mkc { grid-column: 3 / span 3; } }
    .mkc .mko-title { cursor: help; } .mkc-i { font-size: 0.8rem; color: #64748b; font-weight: 400; }
    .mkc-sub { color: var(--dark-text-muted); font-size: 0.82rem; }
    .mkc-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; margin-top: 0.35rem; }
    .mkc-c { background: #0b1118; border: 1px solid var(--dark-border); border-radius: 8px; padding: 0.55rem 0.6rem; display: flex; flex-direction: column; min-width: 0; }
    .mkc-h { color: #fff; font-weight: 700; font-size: 0.86rem; } .mkc-d { color: #94a3b8; font-size: 0.74rem; margin-bottom: 0.3rem; }
    .mkc-e { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.4rem; align-items: baseline; font-size: 0.78rem; padding: 3px 2px; border-bottom: 1px solid #1f283a; cursor: pointer; border-radius: 3px; }
    .mkc-e:hover { background: #142033; } .mkc-e:focus-visible { outline: 2px solid var(--dark-brand); }
    .mkc-dt { color: #94a3b8; white-space: nowrap; } .mkc-t { color: #cbd5e1; overflow-wrap: anywhere; line-height: 1.3; } .mkc-n { color: #fff; }
    .mkc-tag { font-size: 0.62rem; font-weight: 700; border-radius: 3px; padding: 0 4px; margin-right: 4px; vertical-align: 1px; }
    .mkc-tag.t-sched { background: #132a1e; color: #4ade80; } .mkc-tag.t-draft { background: #2a2412; color: #fbbf24; }
    .mkc-tag.t-frozen { background: #1e3a8a; color: #bfdbfe; } .mkc-tag.t-sent { background: #1f2937; color: #94a3b8; }
    .mkc-c > [data-mkc-total] { margin-top: auto; padding-top: 0.35rem; }
    .mkc-tot { display: flex; justify-content: space-between; gap: 0.4rem; margin-top: 0.35rem; font-size: 0.8rem; color: #cbd5e1; cursor: help; } .mkc-tot b { color: #fff; }
    .mkc-left { margin-top: 0.35rem; padding: 4px 7px; border-radius: 6px; background: #132038; display: flex; justify-content: space-between; font-weight: 700; color: #fff; font-size: 0.84rem; }
    .mkc-left.neg { background: #3b1219; color: #fecaca; }
    .mkc-al { display: block; font-size: 0.7rem; font-weight: 700; margin-top: 1px; } .mkc-al.a-red { color: #f87171; } .mkc-al.a-amber { color: #fbbf24; font-weight: 600; }
    .mkc-unc { font-size: 0.74rem; color: #fbbf24; margin-top: 0.25rem; cursor: help; }
    .mkc-none { color: #64748b; font-size: 0.78rem; padding: 3px 0; } .mkc-foot { color: #94a3b8; font-size: 0.76rem; margin-top: 0.3rem; }
  </style>`;

  window.mkSqsCycles = { build, boundsOf, columnOf, tagOf, totalsOf, leftOf, timeLeft, isOpen };
})();
