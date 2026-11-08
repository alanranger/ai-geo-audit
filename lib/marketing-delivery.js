/**
 * Marketing & Campaigns → "Scheduled & planned delivery" (directly above the campaign steps) and the email-capacity
 * lines shared by Overview tile 8 and the send budget. Read-only: nothing here sends, schedules, reschedules or deletes.
 * Email deliveries, reservations, Squarespace schedule reads and their warnings come from the Marketing overview
 * (d.meter, built by lib/marketing/delivery.mjs); posts, notes, weekly emails and their ticks from the Strategy summary.
 * Counts are deliveries (one email or one post), not campaigns. A database stage alone is planned / unverified.
 */
(function () {
  const LONDON = 'Europe/London';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB').replace('-', '−'));
  const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : (many || `${one}s`)}`;
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
  const dayOf = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
  const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const ukDay = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
  const ukDayTime = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }).replace(',', '') : '—');
  const zoneOf = (iso) => (new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName')?.value || 'UK');
  const CLOSED = ['sent', 'measured', 'cancelled'];
  const PERIODS = [7, 14, 28];

  /* ---------- email capacity (tile 8 + send budget) ---------- */

  const sideOfDay = (day, cap) => (day === cap.reset_day ? 'unallocated' : (day < cap.reset_day ? 'current' : 'next'));

  /** The planned day (a late step's send_day has moved to today; its step key keeps the planned day). */
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  function plannedEmailDay(c) {
    const fromKey = String((c.steps || [])[0]?.key || '').split('|').pop();
    return ISO_DAY.test(fromKey) ? fromKey : (c.window_start || c.send_day);
  }

  /** Weekly emails in the plan with no audience and no record on the server: UNBUDGETED (never 0). Late ones = backlog. */
  function unchosenEmails(d, s) {
    const known = new Set((d.meter?.deliveries || []).map((x) => x.campaign_key).filter(Boolean));
    const today = todayIso();
    return (s?.campaign?.campaigns || []).filter((c) => c.kind === 'weekly_email' && !c.audience && !CLOSED.includes(c.stage) && !known.has(c.campaign_key))
      .map((c) => ({ key: c.campaign_key, title: c.title, day: plannedEmailDay(c), late: plannedEmailDay(c) < today }));
  }

  /** Server capacity + the plan's audience-less weekly emails (current / unallocated / next by their planned day). */
  window.mkCapacity = function mkCapacity(d, s) {
    const cap = d?.meter?.capacity;
    if (!cap) return null;
    const open = unchosenEmails(d, s);
    const planned = open.filter((x) => !x.late).map((x) => ({ ...x, side: sideOfDay(x.day, cap) }));
    const thisCycle = planned.filter((x) => x.side !== 'next');
    const next = planned.filter((x) => x.side === 'next');
    return {
      ...cap, missing_audiences: cap.missing_audiences + thisCycle.length, projected_incomplete: cap.projected_incomplete || thisCycle.length > 0,
      next_cycle: { ...cap.next_cycle, unbudgeted: cap.next_cycle.unbudgeted + next.length }, unchosen: planned, backlog: open.filter((x) => x.late), strategy_read: !!s
    };
  };

  const red = (v) => `<span class="mkd-red">${v}</span>`;
  const amber = (v) => `<span class="mkd-amber">${v}</span>`;
  function provisionalCell(c) {
    const miss = c.missing_audiences ? ` ${amber(`+ ${plural(c.missing_audiences, 'audience')} not chosen`)}` : '';
    return `${n(c.provisional)}${miss}${c.strategy_read === false ? ' <span class="mkd-dim">(plan loading)</span>' : ''}`;
  }
  function projectedCell(c) {
    const v = c.projected_free < 0 ? red(n(c.projected_free)) : n(c.projected_free);
    return c.projected_incomplete ? `${v} · ${amber('incomplete')}` : v;
  }
  function nextCycleCell(c) {
    const x = c.next_cycle;
    return `${n(x.allowance - x.committed)} · ${n(x.committed)} committed${x.provisional ? ` · ${n(x.provisional)} provisional` : ''}${x.unbudgeted ? ` · ${amber(`${plural(x.unbudgeted, 'email')} without audience`)}` : ''}`;
  }

  /** The capacity lines in the agreed order: [label, value html, title]. */
  window.mkCapacityRows = function mkCapacityRows(c) {
    const reset = c.next_cycle.starts_at;
    const rows = [
      ['Used (Squarespace meter)', `${n(c.used)} / ${n(c.quota)}`, 'the provider\'s own count this billing cycle'],
      ['Provider remaining', n(c.remaining), 'allowance minus used, from the meter'],
      ['Committed (scheduled / frozen)', `${n(c.committed)}${c.pending_reconciliation ? ` <span class="mkd-dim">(${n(c.pending_reconciliation)} sent, pending reconciliation)</span>` : ''}`, 'scheduled in Squarespace or a frozen snapshot, this cycle'],
      ['Free after commitments', c.overage ? red(`${n(c.free_after_commitments)} · over by ${n(c.overage)}`) : n(c.free_after_commitments), 'provider remaining minus committed'],
      ['Provisional planned', provisionalCell(c), 'audience chosen, not frozen (estimate refreshed until a snapshot); a missing audience is not deducted'],
      ['Projected free after all plans', projectedCell(c), c.projected_incomplete ? 'incomplete: missing audience not deducted' : 'free after commitments minus provisional']
    ];
    const u = c.unallocated;
    if (u.items) rows.push(['Unallocated (no send time on a reset day)', `${n(u.committed + u.provisional)}${u.unbudgeted ? ` + ${plural(u.unbudgeted, 'unbudgeted email')}` : ''} · not deducted from either cycle`, 'give it a send time to place it before or after the reset']);
    rows.push([`Next cycle (from ${ukDayTime(reset)} ${zoneOf(reset)})`, nextCycleCell(c), 'a separate allowance: no rollover, no borrowing']);
    return rows;
  };

  /* ---------- delivery items ---------- */

  const tickOf = (c, k) => c?.ticks?.[k] || null;
  const DONE = new Set(['done', 'auto_done']);
  const SKIP = new Set(['skipped', 'not_needed']);
  const shortStep = (t) => String(t || '').replace(/^Post:\s*/, '').replace(/^Personal note to past clients:\s*/, '').replace(/^Main email of the week:\s*/, '').replace(/^"|"$/g, '').slice(0, 60);
  const plannedDay = (st, c) => tickOf(c, st.key)?.moved_to || st.scheduled_day || st.day;

  let stepTags = {};
  function baseItem(st, c, channel) {
    const tag = stepTags[st.key] || {};
    return { channel, key: `${st.key}|${channel}`, title: shortStep(st.step), planned: plannedDay(st, c), purpose: tag.purpose || null, initiative: tag.initiative || null, owner: st.owner || null, step: st.step };
  }
  function skipOf(st, c) {
    const t = tickOf(c, st.key);
    if (t && SKIP.has(t.status)) return `${t.status.replace('_', ' ')}${t.reason ? `: ${t.reason}` : ''}`;
    return SKIP.has(st.state?.status) ? `${st.state.status.replace('_', ' ')}${st.state.reason ? `: ${st.state.reason}` : ''}` : null;
  }
  const manualEv = (t) => ({ kind: 'manual', at: t.set_at || t.ticked_at || null, by: t.set_by || null });

  function socialItem(st, c, p) {
    const base = baseItem(st, c, p === 'fb' ? 'facebook' : 'instagram');
    const skip = skipOf(st, c);
    if (skip) return { ...base, status: 'resolved', note: skip };
    const pub = tickOf(c, `${st.key}|${p}`);
    if (pub?.is_ticked) return { ...base, status: 'done', done_at: pub.set_at || pub.ticked_at, evidence: manualEv(pub) };
    if (tickOf(c, st.key)?.is_ticked) return { ...base, status: 'ready', next: `publish on ${p === 'fb' ? 'Facebook' : 'Instagram'}, then tick ${p.toUpperCase()}` };
    return { ...base, status: 'prep', next: 'prepare the shared Facebook + Instagram post' };
  }

  function plainItem(st, c, channel) {
    const base = baseItem(st, c, channel);
    const skip = skipOf(st, c);
    if (skip) return { ...base, status: 'resolved', note: skip };
    const t = tickOf(c, st.key);
    if (t?.is_ticked) return { ...base, status: 'done', done_at: t.set_at || t.ticked_at, evidence: manualEv(t) };
    if (DONE.has(st.state?.status)) return { ...base, status: 'done', done_at: st.state.at, evidence: { kind: st.state.auto ? 'seen' : 'manual', at: st.state.at, by: st.state.by } };
    return { ...base, status: 'prep', next: channel === 'outlook' ? 'write the personal note (Alan approves first)' : 'prepare the post' };
  }

  /** Server delivery → status. Scheduled only with platform evidence (seen / operator-verified / manual). */
  function serverStatus(dl) {
    if (dl.sent) return { status: 'done', done_at: dl.sent.at, evidence: dl.evidence || { kind: 'manual', at: dl.sent.at, by: 'record' } };
    if (dl.cancelled && dl.release === 'released') return { status: 'resolved', note: 'cancelled' };
    if (dl.provider?.state === 'scheduled' || dl.operator) return { status: 'scheduled', planned_at: dl.send_at, evidence: dl.evidence, next: 'nothing until dispatch; the collector confirms the send' };
    if (dl.snapshot) return { status: 'ready', next: 'schedule it in Squarespace (Alan / ChatGPT)' };
    if (!dl.audience) return { status: 'prep', next: 'choose an audience so it can be budgeted' };
    return { status: 'prep', next: 'freeze a snapshot (Audience snapshots) when the content is approved' };
  }

  const amountTag = (x) => (x.amount != null ? ` · ${n(x.amount)} ${x.bucket === 'committed' ? 'committed' : 'provisional'}` : '');
  function segmentNames(ids) {
    const segs = window.mkSegmentsList || [];
    return ids.map((id) => (segs.find((x) => x.segment_id === id) || {}).name || 'segment').join(' + ');
  }
  function audienceText(dl, rec) {
    const x = dl || {};
    const r = rec || {};
    if (x.sent) return `sent to ${esc((x.sent.lists || []).join(' + ') || 'a Squarespace list')} · ${n(x.sent.count)} recipients`;
    if (x.snapshot && x.snapshot.list_name) return `${esc(x.snapshot.list_name)}${amountTag(x)}`;
    const aud = r.audience || x.audience;
    if (!aud) return amber('audience not chosen → unbudgeted');
    if (aud === 'full_list') return `full list${amountTag(x)}`;
    return `${esc(segmentNames(r.segment_ids || x.segment_ids || []) || aud)}${amountTag(x)}`;
  }

  function emailBase(st, c, rec, dl) {
    const r = rec || {};
    const x = dl || {};
    const b = baseItem(st, c, 'email');
    return {
      ...b, title: st.targeted ? shortStep(st.step).split(':')[0] : `Weekly email (${shortStep(st.step)})`, record_key: x.key || r.campaign_key || null,
      purpose: b.purpose || x.purpose || null, initiative: b.initiative || x.initiative || null, audience: audienceText(dl, rec)
    };
  }
  function doneEmail(base, st, state, dl) {
    const seen = dl && dl.sent && dl.sent.seen;
    const kind = state.auto || state.link || st.targeted ? 'seen' : 'manual';
    return { ...base, status: 'done', done_at: seen ? dl.sent.at : state.at, evidence: seen ? dl.evidence : { kind, at: state.at, by: state.by } };
  }
  function emailStepItem(st, c, srvByKey, srvBySent) {
    const rec = st.targeted ? null : (c.campaigns || []).find((r) => r.campaign_key === `email|${st.week}`);
    const dl = st.targeted ? srvBySent.get(String(st.key).split('|').pop()) : srvByKey.get(rec && rec.campaign_key);
    const base = emailBase(st, c, rec, dl);
    const state = st.fixed_state || st.state || {};
    if (DONE.has(state.status)) return doneEmail(base, st, state, dl);
    if (SKIP.has(state.status)) return { ...base, status: 'resolved', note: state.status };
    if (dl) return { ...base, ...serverStatus(dl) };
    if (!rec || !rec.audience) return { ...base, status: 'prep', next: 'choose the audience on the weekly email (Campaign steps)' };
    return { ...base, status: 'prep', next: 'approve the content and freeze a snapshot' };
  }

  function stepsOf(s) {
    const c = s?.campaign;
    if (!c?.weeks) return [];
    const all = [...c.weeks.flatMap((w) => w.steps.map((st) => ({ ...st, week: st.week || w.week }))), ...(c.carried?.late || []), ...(c.carried?.older || [])];
    return [...new Map(all.map((st) => [st.key, st])).values()];
  }

  function itemsOfStep(st, c, srvByKey, srvBySent) {
    const ch = st.channel;
    if (ch === 'Facebook + Instagram') return [socialItem(st, c, 'fb'), socialItem(st, c, 'ig')];
    if (ch === 'LinkedIn') return [plainItem(st, c, 'linkedin')];
    if (ch === 'Outlook personal notes') return [plainItem(st, c, 'outlook')];
    if (st.is_email || st.targeted) return [emailStepItem(st, c, srvByKey, srvBySent)];
    if (ch === 'Google Business') return [{ ...plainItem(st, c, 'gbp'), gbp: st.gbp, optional: !!st.optional }];
    return [];
  }

  /** Server email deliveries not already a plan step (theme / event records, Squarespace schedules). */
  function serverItems(d, used) {
    return (d.meter?.deliveries || []).filter((dl) => !used.has(dl.key)).map((dl) => {
      const st = serverStatus(dl);
      const lists = dl.provider?.lists?.join(' + ');
      return { channel: 'email', key: dl.key, record_key: dl.key, title: dl.title, planned: dl.send_at ? dayOf(dl.send_at) : dl.send_day, planned_at: dl.send_at || null, audience: lists ? `${esc(lists)} · ${n(dl.amount)} ${dl.bucket === 'committed' ? 'committed' : 'reserved'}` : audienceText(dl, null), purpose: dl.purpose, initiative: dl.initiative, owner: dl.owner, set_by: dl.set_by, delivery: dl, ...st };
    });
  }

  function deliveryItems(d, s) {
    const c = s?.campaign || {};
    stepTags = d.meter?.step_tags || {};
    const dls = d.meter?.deliveries || [];
    const srvByKey = new Map(dls.map((x) => [x.key, x]));
    const srvBySent = new Map(dls.filter((x) => x.sent?.email_id).map((x) => [x.sent.email_id, x]));
    const items = stepsOf(s).flatMap((st) => itemsOfStep(st, c, srvByKey, srvBySent));
    const used = new Set(items.map((x) => x.record_key).filter(Boolean));
    for (const it of items) if (it.record_key && srvByKey.get(it.record_key)) it.delivery = srvByKey.get(it.record_key);
    return [...items, ...serverItems(d, used)];
  }

  /** Where an item counts: done by actual publication time; others by planned / scheduled time; past + undone = late. */
  function placeOf(it, today, end) {
    if (it.status === 'resolved') return null;
    if (it.status === 'done') {
      const day = it.done_at ? dayOf(it.done_at) : null;
      return day && day >= today && day < end ? 'done' : null;
    }
    const day = it.planned_at ? dayOf(it.planned_at) : it.planned;
    if (!day) return 'undated';
    if (day < today) return 'late';
    return day < end ? it.status : null;
  }

  /* ---------- section ---------- */

  const ROWS = [['email', 'Email (Squarespace)'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['outlook', 'Outlook (personal note)']];
  const COLS = ['prep', 'ready', 'scheduled', 'done'];
  const BADGE = { seen: ['seen', 'collector-observed'], operator_verified: ['operator-verified', 'confirmed by Alan or ChatGPT in the platform'], manual: ['manual', 'manual confirmation'] };
  const badge = (ev) => (ev && BADGE[ev.kind] ? `<span class="mkd-b mkd-b-${esc(ev.kind)}" title="${esc(BADGE[ev.kind][1])}${ev.at ? ` · ${esc(ukDayTime(ev.at))}` : ''}${ev.by ? ` · ${esc(ev.by)}` : ''}">${BADGE[ev.kind][0]}</span>` : '<span class="mkd-b mkd-b-none" title="a database stage alone is not evidence">planned / unverified</span>');
  const state = { period: Number(localStorage.getItem('mkd-period')) || 7, open: new Set(['email']) };

  function rowCounts(items, today, end) {
    const out = { prep: 0, ready: 0, scheduled: 0, done: 0, late: 0, list: [], next: null, ev: new Set() };
    for (const it of items) {
      const p = placeOf(it, today, end);
      if (!p) continue;
      out.list.push({ ...it, place: p });
      if (p === 'undated') continue;
      out[p] += 1;
      if (p === 'scheduled' && it.evidence) out.ev.add(it.evidence.kind);
    }
    const nexts = out.list.filter((x) => !['done', 'late', 'undated'].includes(x.place)).sort((a, b) => String(a.planned_at || a.planned).localeCompare(String(b.planned_at || b.planned)));
    out.next = nexts[0] || null;
    return out;
  }

  const nextText = (x) => (x ? `${x.planned_at ? ukDayTime(x.planned_at) : ukDay(x.planned)} · ${esc(x.title)}` : '—');
  const num = (v, cls) => (v ? `<span class="${cls || ''}">${n(v)}</span>` : '0');

  function detailLine(x) {
    const when = x.place === 'done' ? `done ${ukDayTime(x.done_at)}` : (x.planned_at ? `${x.status === 'scheduled' ? 'platform schedule' : 'planned'} ${ukDayTime(x.planned_at)}` : `planned ${ukDay(x.planned)}`);
    const whenText = x.place === 'late' ? amber(`late · planned ${ukDay(x.planned)}`) : esc(when);
    const bits = [`<b>${esc(x.title)}</b>`, x.purpose ? esc([].concat(x.purpose).join(' + ')) : '', x.initiative ? `initiative: ${esc(x.initiative)}` : '', x.audience || '', whenText,
      x.status === 'scheduled' || x.place === 'done' ? badge(x.evidence) : badge(null), `owner ${esc(x.owner || (x.set_by ? `not set (last set by ${x.set_by})` : 'not set'))}`, x.next && x.place !== 'done' ? `next: ${esc(x.next)}` : ''];
    return `<li>${bits.filter(Boolean).join(' · ')}</li>`;
  }

  function channelRow(id, label, r) {
    const open = state.open.has(id);
    const ev = [...r.ev].map((k) => badge({ kind: k })).join(' ');
    const head = `<tr class="mkd-row" data-mkd-row="${id}"><td class="left"><b>${open ? '▼' : '▶'} ${esc(label)}</b></td><td>${num(r.prep)}</td><td>${num(r.ready, 'mkd-amber')}</td>`
      + `<td>${id === 'email' || r.scheduled ? `${num(r.scheduled)} ${ev}` : '<span class="mkd-dim" title="no Meta / LinkedIn schedule read; only manual confirmation">— not collected</span>'}</td><td>${num(r.done, 'mkd-green')}</td><td>${num(r.late, 'mkd-amber')}</td><td class="left">${nextText(r.next)}</td></tr>`;
    if (!open) return head;
    const lines = r.list.length ? r.list.map(detailLine).join('') : '<li class="mkd-dim">Nothing planned in this period.</li>';
    return `${head}<tr class="mkd-detail"><td colspan="7" class="left"><ul>${lines}</ul></td></tr>`;
  }

  function gbpRow(items, g, s, today, end) {
    const checks = items.filter((x) => x.gbp === 'check');
    const nextCheck = checks.filter((x) => x.status !== 'done' && x.planned >= today).sort((a, b) => a.planned.localeCompare(b.planned))[0];
    const late = checks.filter((x) => placeOf(x, today, end) === 'late').length;
    const exc = items.filter((x) => x.gbp === 'exception');
    const published = exc.filter((x) => placeOf(x, today, end) === 'done').length;
    const waiting = s?.campaign?.step_status?.gbp_exceptions_open;
    const last = g?.reachable ? `last post seen ${ukDay(dayOf(g.last_post_at))} ${badge({ kind: 'seen', at: g.last_post_at, by: 'Google Business Profile API' })}` : '<span class="mkd-dim">last post: not collected</span>';
    const text = `Viking Local automated · ${last} · ${nextCheck ? `weekly check due ${ukDay(nextCheck.planned)}` : 'weekly check: none planned'}${late ? ` · ${amber(`${plural(late, 'check')} late`)}` : ''} · exception posts ${n(published)}${waiting ? ` (${n(waiting)} awaiting approval, optional)` : ''}`;
    return `<tr class="mkd-row"><td class="left"><b>▶ Google Business</b></td><td colspan="5" class="left">${text}</td><td class="left">${nextCheck ? `${ukDay(nextCheck.planned)} · weekly check` : '—'}</td></tr>`;
  }

  /* ---------- warnings (server email warnings + plan-side ones) ---------- */

  const W = (level, text, action) => ({ level, text, action });
  function unbudgetedWarnings(cap, end) {
    const out = (cap?.unchosen || []).filter((x) => x.day < end).map((x) => W('amber', `${x.title} (${ukDay(x.day)}) has no audience: UNBUDGETED${x.side === 'unallocated' ? '; no send time yet on the reset day, so it is unallocated between cycles' : ''}`, 'Choose its audience on the weekly email in Campaign steps so it can be budgeted; give it a send time.'));
    if (cap?.backlog?.length) out.push(W('amber', `${plural(cap.backlog.length, 'late weekly email')} with no audience (${cap.backlog.map((x) => ukDay(x.day)).join(', ')}) — not budgeted`, 'Send it (choose an audience) or skip it in Campaign steps.'));
    return out;
  }

  const broad = (dl) => dl.audience === 'full_list' || (window.mkLiveListSize && dl.amount >= window.mkLiveListSize * 0.5);
  const overlap = (a, b) => (a.segment_ids || []).some((x) => (b.segment_ids || []).includes(x)) || (a.provider?.list_ids || []).some((x) => (b.provider?.list_ids || []).includes(x));
  function spacingWarnings(d) {
    const dls = (d.meter?.deliveries || []).filter((x) => !x.sent && !x.cancelled && x.send_at).sort((a, b) => a.send_at.localeCompare(b.send_at));
    const out = [];
    for (let i = 1; i < dls.length; i += 1) {
      const a = dls[i - 1];
      const b = dls[i];
      const days = (Date.parse(b.send_at) - Date.parse(a.send_at)) / 86400000;
      if (days < 7 && broad(a) && broad(b)) out.push(W('amber', `Two broad emails within a week: "${a.title}" ${ukDayTime(a.send_at)} and "${b.title}" ${ukDayTime(b.send_at)}`, 'Check the purpose mix and spacing; move one if they compete (never moved automatically).'));
      else if (days < 3 && overlap(a, b)) out.push(W('amber', `Overlapping audiences ${days.toFixed(1)} days apart: "${a.title}" and "${b.title}"`, 'Exclude recent recipients or space them further apart.'));
    }
    return out;
  }

  function warningsHtml(d, cap, end) {
    const all = [...(d.meter?.warnings || []), ...unbudgetedWarnings(cap, end), ...spacingWarnings(d)];
    if (!all.length) return '';
    const box = (list, cls) => (list.length ? `<div class="mkd-warn ${cls}">${list.map((w) => `<div>⚠ <b>${esc(w.text)}</b>${w.action ? `: ${esc(w.action)}` : ''}</div>`).join('')}</div>` : '');
    return box(all.filter((w) => w.level === 'red'), 'mkd-warn-red') + box(all.filter((w) => w.level !== 'red'), '');
  }

  const RULES = 'Rules: an email reserves its recipients once (estimate → frozen snapshot → Squarespace schedule replaces, never adds); committed = scheduled in Squarespace or a frozen snapshot; provisional = audience chosen, not yet frozen; sends split at the real reset time. Social, Outlook and Google have no allowance — only prep / scheduled / done / late. Squarespace\'s Scheduled tab is read by the collector so campaigns scheduled outside the dashboard are counted once and linked. Amber = needs action; red only if committed sends exceed what\'s left before the reset. A scheduled email never completes a quarter milestone: only the send does.';

  const STYLE = `<style id="mkd-style">
    #mk-delivery .mkd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
    #mk-delivery .mkd-period button { background: transparent; border: 1px solid #334155; color: #cbd5e1; padding: 2px 10px; border-radius: 6px; margin-left: 2px; cursor: pointer; font-size: 0.85rem; }
    #mk-delivery .mkd-period button[aria-pressed="true"] { background: #78350f; border-color: #f59e0b; color: #fde68a; font-weight: 700; }
    #mk-delivery .mkd-table { width: 100%; } #mk-delivery .mkd-table th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--dark-text-muted); }
    #mk-delivery .mkd-row { cursor: pointer; } #mk-delivery .mkd-row:hover td { background: #111827; }
    #mk-delivery .mkd-row td:last-child { min-width: 8.5rem; } #mk-delivery .mkd-table th { white-space: normal; }
    #mk-delivery .mkd-detail td { background: #0b1118; font-size: 0.84rem; } #mk-delivery .mkd-detail ul { margin: 0.2rem 0; padding-left: 1.1rem; } #mk-delivery .mkd-detail li { margin: 0.15rem 0; }
    .mkd-b { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 4px; white-space: nowrap; vertical-align: 1px; }
    .mkd-b-seen { background: #14532d; color: #bbf7d0; } .mkd-b-operator_verified { background: #1e3a8a; color: #bfdbfe; } .mkd-b-manual { background: #78350f; color: #fde68a; } .mkd-b-none { border: 1px dashed #64748b; color: #94a3b8; }
    .mkd-amber { color: #fbbf24; font-weight: 700; } .mkd-red { color: #f87171; font-weight: 700; } .mkd-green { color: #4ade80; font-weight: 700; } .mkd-dim { color: #94a3b8; font-weight: 400; }
    #mk-delivery .mkd-warn { border: 1px solid #a16207; background: #1c1917; border-radius: 6px; padding: 0.5rem 0.8rem; margin: 0.7rem 0; font-size: 0.85rem; color: #fde68a; }
    #mk-delivery .mkd-warn div + div { margin-top: 0.3rem; } #mk-delivery .mkd-warn-red { border-color: #ef4444; background: #1f1215; color: #fecaca; }
    #mk-delivery .mkd-rules { border-top: 1px dashed var(--dark-border); padding-top: 0.5rem; margin-top: 0.6rem; font-size: 0.8rem; color: var(--dark-text-muted); }
    .mkd-kv { width: 100%; border-collapse: collapse; font-size: 0.86rem; } .mkd-kv td { padding: 2px 0; color: #cbd5e1; } .mkd-kv td:last-child { text-align: right; font-weight: 700; color: #fff; }
  </style>`;
  function ensureStyle() {
    if (!document.getElementById('mkd-style')) document.head.insertAdjacentHTML('beforeend', STYLE);
  }
  ensureStyle();

  function sectionHtml(d, s, g, strategyError) {
    const today = todayIso();
    const end = addDays(today, state.period);
    const items = deliveryItems(d, s);
    const cap = window.mkCapacity(d, s);
    const chips = PERIODS.map((p) => `<button type="button" data-mkd-period="${p}" aria-pressed="${p === state.period}">${p === 7 ? '7 days' : p}</button>`).join('');
    const rows = ROWS.map(([id, label]) => channelRow(id, label, rowCounts(items.filter((x) => x.channel === id), today, end))).join('');
    const planNote = s ? '' : `<p class="rt-sub mkd-amber">${strategyError ? `Week plan unavailable (${esc(strategyError)}): only email deliveries from the send budget are shown.` : 'Loading the week plan…'}</p>`;
    return `<div class="mkd-head"><div><h3>Scheduled &amp; planned delivery</h3>`
      + `<p class="rt-sub">One row per channel; counts are deliveries (one email or one post), not campaigns. Times UK. "Scheduled" needs platform evidence ${badge({ kind: 'seen' })} or a confirmation ${badge({ kind: 'operator_verified' })} ${badge({ kind: 'manual' })}. Period ${ukDay(today)} → ${ukDay(addDays(end, -1))}: future deliveries by planned / scheduled time, done by actual publication time; late = earlier work still to do (a separate backlog, not in the other columns).</p></div>`
      + `<div class="mkd-period" role="group" aria-label="Period">${chips}</div></div>${planNote}`
      + `<div class="mk-wide"><table class="rt-table mkd-table"><thead><tr><th class="left">Channel</th><th>Needs prep</th><th>Ready, not scheduled</th><th>Scheduled</th><th>Done</th><th>Late</th><th class="left">Next</th></tr></thead>`
      + `<tbody>${rows}${gbpRow(items.filter((x) => x.channel === 'gbp'), g, s, today, end)}</tbody></table></div>`
      + `${warningsHtml(d, cap, end)}<div class="mkd-rules">${esc(RULES)}</div>`;
  }

  async function gbpStatus() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/strategy-campaigns?view=gbp&propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    return j.ok ? j.gbp : { reachable: false, error: j.error || `status ${r.status}` };
  }

  /** Paints straight away from the Marketing overview; the week plan and the Google Business line fill in after. */
  window.mkMountDelivery = function mkMountDelivery(host, d, strategy) {
    if (!host) return;
    const st = { s: null, error: null, g: null };
    const paint = () => { if (host.isConnected) host.innerHTML = sectionHtml(d, st.s, st.g, st.error); };
    host.addEventListener('click', (e) => {
      const p = e.target.closest('[data-mkd-period]');
      if (p) { state.period = Number(p.dataset.mkdPeriod); localStorage.setItem('mkd-period', String(state.period)); return paint(); }
      const row = e.target.closest('[data-mkd-row]');
      if (!row) return undefined;
      const id = row.dataset.mkdRow;
      if (state.open.has(id)) state.open.delete(id); else state.open.add(id);
      return paint();
    });
    paint();
    Promise.resolve(strategy).then((s) => { st.s = s || null; }, (e) => { st.error = e.message; }).then(paint);
    gbpStatus().catch((e) => ({ reachable: false, error: e.message })).then((g) => { st.g = g; paint(); });
  };
})();
