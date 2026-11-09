/**
 * Marketing schedule → List view (Alan-approved mock-up, 9 Nov 2026) and the shared status vocabulary. Browser,
 * read-only, no fetches. Exposes window.mkScheduleList.
 *  - Status = word + icon + colour, the same in List and both grids: Sent / Published (green), Scheduled (blue, with
 *    the platform and confirmed time), Needs approval (amber, only when caption + artwork + URL are ready), In
 *    preparation / Draft (grey, one-line blocker, "Planned {time}"), Checking delivery (neutral: due, not confirmed),
 *    Late / Failed / Verification unavailable only from evidence. The server's shared status model (each delivery
 *    item's `status = { code, label, icon, at, link, evidence, blocker }`) wins when present; until then a small
 *    adapter derives the same shape from the schedule model.
 *  - List: compact rows grouped by day (Day | Campaign & channel | Status | When / audience); same-day emails in one
 *    block with the total "recipient sends"; a separate Tasks & reminders strip (Outlook notes, Google checks, offer ends).
 *  - Squarespace email view: billing-cycle selector (real reset boundaries from the meter), budget bar, one row per send
 *    with cohort, audience approval (apart from content approval) and credits estimated → committed → actual.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const LONDON = 'Europe/London';
  const ukDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
  const time12 = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: LONDON }).replace(/\s/g, '') : '');
  const dayParts = (day) => { const d = new Date(`${day}T12:00:00Z`); return [d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase(), d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()]; };
  const short = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: LONDON }).replace(',', '') : '');
  const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);

  /* ---------- status vocabulary ---------- */

  const VOCAB = {
    sent: ['Sent', '✅', 'ok'], published: ['Published', '✅', 'ok'], scheduled: ['Scheduled', '🕒', 'sch'], needs_approval: ['Needs approval', '⚠', 'amb'],
    in_preparation: ['In preparation', '📄', 'prep'], draft: ['Draft', '📄', 'prep'], checking: ['Checking delivery', '…', 'chk'],
    late: ['Late', '⚠', 'late'], failed: ['Failed', '✖', 'late'], verification_unavailable: ['Verification unavailable', '?', 'chk'], cancelled: ['Cancelled', '—', 'chk']
  };
  const PLATFORM = { email: 'Squarespace', fbig: 'Meta', linkedin: 'LinkedIn', gbp: 'Google', outlook: 'Outlook' };
  const make = (code, extra = {}) => ({ code, label: VOCAB[code]?.[0] || code, icon: VOCAB[code]?.[1] || '', ...extra });
  /** The server's shared status (lib/marketing/delivery*), when it is on the item. */
  function serverStatus(x) {
    const s = x.raw?.status && typeof x.raw.status === 'object' ? x.raw.status : x.raw?.delivery?.status;
    return s && s.code ? { ...make(s.code), ...s, label: s.label || VOCAB[s.code]?.[0] || s.code, icon: s.icon || VOCAB[s.code]?.[1] || '' } : null;
  }
  /** Social: from each placement's own evidence (never inferred across placements), then readiness. */
  const DONE_STAGES = new Set(['published', 'live_check', 'measured']);
  const linkOf = (list) => list.find((p) => p.provider_url)?.provider_url || null;
  /** Published from the placements' own evidence: all of them, or which ones (the others are named, never assumed). */
  function publishedOf(pl) {
    const done = pl.filter((p) => DONE_STAGES.has(p.stage));
    if (!done.length) return null;
    if (done.length === pl.length) return make('published', { at: done[0].actual_at, link: linkOf(done), evidence: done[0].source });
    return make('published', { label: `Published (${done.map((p) => p.label).join(', ')})`, at: done[0].actual_at, link: linkOf(done), blocker: `${pl.filter((p) => !done.includes(p)).map((p) => p.label).join(', ')} not yet` });
  }
  /** Social: from each placement's own evidence (never inferred across placements), then readiness. */
  function socialStatus(x, env) {
    const pl = env.placements ? env.placements(x) : [];
    const pub = publishedOf(pl);
    if (pub) return pub;
    const sch = pl.find((p) => p.stage === 'scheduled');
    if (sch) return make('scheduled', { platform: x.row === 'linkedin' ? 'LinkedIn' : 'Meta', at: sch.planned_at });
    const r = env.review ? env.review(x) : null;
    if (r && r.ready) return make('needs_approval', { at: r.planned_at });
    return make('in_preparation', { blocker: r?.blocker || 'not prepared yet', at: r?.planned_at || null });
  }
  const doneStatus = (x, r) => make(x.row === 'email' ? 'sent' : 'published', { at: r.done_at || null, link: r.link || null, evidence: r.evidence?.by || r.evidence?.kind || null });
  const dueStatus = (x) => make('checking', { blocker: x.state === 'late' ? `planned ${short(x.day)}, not confirmed yet` : 'marked scheduled; no platform confirmation yet' });
  /** Adapter from the schedule model's state to the shared shape (used until the server field is on every item). */
  const lightLogicStatus = (x, env) => publishedOf(env.placements ? env.placements(x) : []) || make('in_preparation', { blocker: 'edition being prepared by GPT · not scheduled on LinkedIn' });
  const prepStatus = (x, r) => make('in_preparation', { blocker: x.draft ? `draft, not scheduled in ${PLATFORM[x.row] || 'the platform'}` : (r.next || null), at: r.planned_at || null });
  /** An email whose planned / scheduled time has passed with no send confirmed yet: "Checking delivery", never sent by time. */
  const releaseDue = (x, r, now) => x.row === 'email' && !x.draft && !!(r.planned_at || r.delivery?.send_at) && Date.parse(r.planned_at || r.delivery.send_at) <= now;
  function derived(x, env) {
    const r = x.raw || {};
    if (x.state === 'done') return doneStatus(x, r);
    if (releaseDue(x, r, env.now || Date.now())) return make('checking', { blocker: 'release time passed; waiting for Squarespace to confirm the send' });
    if (isLightLogic(x)) return lightLogicStatus(x, env);
    if (x.row === 'fbig' || x.row === 'linkedin') return socialStatus(x, env);
    if (x.state === 'sch') return make('scheduled', { platform: PLATFORM[x.row], at: r.planned_at || null, evidence: r.evidence?.by || null });
    return x.state === 'warn' || x.state === 'late' ? dueStatus(x) : prepStatus(x, r);
  }
  function statusOf(x, env = {}) {
    if (x.state === 'resolved') return make('cancelled');
    return serverStatus(x) || derived(x, env);
  }
  const cls = (s) => VOCAB[s.code]?.[2] || 'prep';
  /** Word + icon + colour (never colour alone). */
  const badge = (s) => `<span class="mkl-st mkl-${cls(s)}"><i>${esc(s.icon)}</i>${esc(s.label)}</span>`;
  const badgeMini = (s) => `<span class="mkl-st mini mkl-${cls(s)}" title="${esc(s.label)}${s.blocker ? ` · ${esc(s.blocker)}` : ''}"><i>${esc(s.icon)}</i>${esc(s.label)}</span>`;

  /* ---------- channels + range ---------- */

  const CHANNELS = [['all', 'All'], ['email', 'Squarespace email'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['google', 'Google'], ['outlook', 'Personal email (Outlook)']];
  const ROWS_OF = { all: null, email: ['email'], facebook: ['fbig'], instagram: ['fbig'], linkedin: ['linkedin'], google: ['gbp'], outlook: ['outlook'] };
  const matchChannel = (x, ch) => !ROWS_OF[ch] || ROWS_OF[ch].includes(x.row);
  const RANGES = [['this', 'This week', 0, 7], ['next', 'Next week', 7, 7], ['4w', '4 weeks', 0, 28], ['9', 'This week + 8', 0, 63]];
  function rangeOf(key, firstWeek) {
    const r = RANGES.find((x) => x[0] === key) || RANGES[0];
    return { from: addDays(firstWeek, r[2]), to: addDays(firstWeek, r[2] + r[3] - 1) };
  }
  const isTask = (x) => x.row === 'outlook' || (x.row === 'gbp' && !x.synthetic);
  const isLightLogic = (x) => /light\s*&\s*logic newsletter/i.test(`${x.title || ''} ${x.step_key || ''}`) || /^gpt-ll-/.test(String(x.step_key || ''));

  /* ---------- list rows ---------- */

  const CH_LINE = { email: 'Email · Squarespace', fbig: 'Facebook · Instagram · Story', linkedin: 'LinkedIn', gbp: 'Google Business', outlook: 'Personal email · Outlook' };
  const people = (x) => x.raw?.delivery?.aud?.people ?? x.people;
  const emailAt = (x) => x.raw?.delivery?.sent?.at || x.raw?.planned_at || x.raw?.delivery?.send_at || null;
  const recipients = (x) => (people(x) != null ? `${n(people(x))} recipients` : 'audience not counted');
  function emailWhen(x) {
    const t = time12(emailAt(x));
    return esc([t || 'time not set', recipients(x)].join(' · '));
  }
  function socialWhen(x, s, env) {
    if (s.code === 'published') return `${esc(time12(s.at))}${s.link ? ` · <a href="${esc(s.link)}" target="_blank" rel="noopener">View post</a>` : ''}`;
    const at = s.at || (env.plan ? env.plan(x) : null);
    if (!at) return 'Time not set';
    return s.code === 'scheduled' ? esc(time12(at)) : `Planned ${esc(time12(at))}`;
  }
  const whenText = (x, s, env) => (x.row === 'email' ? emailWhen(x) : socialWhen(x, s, env));
  function chLine(x) {
    if (isLightLogic(x)) return 'LinkedIn · Light &amp; Logic newsletter · GPT prepares, Alan approves';
    return esc(CH_LINE[x.row] || x.row);
  }
  function itemRow(x, env) {
    const s = env.status(x);
    const when = whenText(x, s, env);
    return `<div class="mkl-row" data-mkl-item="${esc(x.id)}" role="button" tabindex="0"><div class="mkl-c"><b>${esc(x.title)}</b><small>${chLine(x)}</small></div>`
      + `<div class="mkl-s">${badge(s)}${s.blocker ? `<small>${esc(s.blocker)}</small>` : ''}${s.platform && s.code === 'scheduled' ? `<small>${esc(s.platform)} confirmed</small>` : ''}</div><div class="mkl-w">${when}</div></div>`;
  }
  /** Same-day emails: one block, each title, time and recipients, then the total labelled "recipient sends". */
  function emailBlock(xs, env) {
    const sts = xs.map((x) => env.status(x));
    const same = sts.every((s) => s.code === sts[0].code);
    const total = xs.reduce((t, x) => t + (Number(people(x)) || 0), 0);
    const lines = xs.map((x, i) => `<li data-mkl-item="${esc(x.id)}" role="button" tabindex="0">${esc(x.title)} — ${esc(time12(emailAt(x)) || 'time not set')} — ${esc(recipients(x))}${same ? '' : ` · ${badgeMini(sts[i])}`}</li>`).join('');
    return `<div class="mkl-row mkl-block"><div class="mkl-c"><b>✉ ${xs.length} targeted emails</b><ul>${lines}</ul></div>`
      + `<div class="mkl-s">${same ? badge(sts[0]) : '<span class="mkl-st mkl-chk">mixed status</span>'}<small>${n(total)} recipient sends · separate audiences</small></div><div class="mkl-w"></div></div>`;
  }
  function dayHtml(day, xs, env, today) {
    const emails = xs.filter((x) => x.row === 'email');
    const rest = xs.filter((x) => x.row !== 'email');
    const rows = [...(emails.length >= 2 ? [emailBlock(emails, env)] : emails.map((x) => itemRow(x, env))), ...rest.map((x) => itemRow(x, env))];
    const [wd, dm] = dayParts(day);
    return `<div class="mkl-day${day === today ? ' today' : ''}"><div class="mkl-d"><b>${wd}</b><span>${dm}</span>${day === today ? '<small>today</small>' : ''}</div><div class="mkl-rows">${rows.join('')}</div></div>`;
  }
  const byTime = (a, b) => String(a.raw?.planned_at || a.time || '').localeCompare(String(b.raw?.planned_at || b.time || ''));
  /** Publications in the range, by day (resolved and reminder items left out). */
  function listHtml(m, opts, env) {
    const { from, to } = opts.range;
    const xs = m.items.filter((x) => x.day && x.day >= from && x.day <= to && x.state !== 'resolved' && !isTask(x) && matchChannel(x, opts.channel));
    const days = [...new Set(xs.map((x) => x.day))].sort();
    const head = '<div class="mkl-head"><span>Day</span><span>Campaign &amp; channel</span><span>Status</span><span>When / audience</span></div>';
    const body = days.map((d) => dayHtml(d, xs.filter((x) => x.day === d).sort(byTime), env, m.today)).join('') || '<p class="mks-dim mkl-empty">Nothing in this range for this channel.</p>';
    return `<div class="mkl">${head}${body}</div>`;
  }

  /* ---------- tasks & reminders ---------- */

  function taskLine(x, env) {
    const s = env.status(x);
    const what = x.row === 'outlook' ? `${x.title} · personal note for Alan to review and send` : `${x.title}${x.raw?.gbp === 'check' ? ' · weekly check; posting status to confirm' : ''}`;
    const done = s.code === 'sent' || s.code === 'published' ? ' · done' : '';
    return `<li data-mkl-item="${esc(x.id)}" role="button" tabindex="0"><b>${esc(short(x.day))}</b> · ${esc(what)}${done}</li>`;
  }
  function tasksHtml(m, opts, env) {
    const { from, to } = opts.range;
    const xs = m.items.filter((x) => isTask(x) && x.day >= from && x.day <= to && x.state !== 'resolved' && matchChannel(x, opts.channel)).sort((a, b) => a.day.localeCompare(b.day));
    const offers = opts.channel === 'all' ? Object.values(m.s?.campaign?.overrides || {}).filter((o) => o.offer_code && o.offer_ends && String(o.offer_ends).slice(0, 10) >= from && String(o.offer_ends).slice(0, 10) <= to) : [];
    const lines = [...xs.map((x) => taskLine(x, env)), ...offers.map((o) => `<li><b>${esc(short(String(o.offer_ends).slice(0, 10)))}</b> · ${esc(o.offer_code)} offer ends</li>`)];
    if (!lines.length) return '';
    return `<div class="mkl-tasks"><h4>Tasks &amp; reminders</h4><ul>${lines.join('')}</ul></div>`;
  }

  /* ---------- Squarespace email view ---------- */

  function cycleOf(cap, which) {
    if (!cap) return null;
    if (which === 'next') {
      const x = cap.next_cycle || {};
      return { label: `Next cycle (${short(ukDay(x.starts_at))} → ${short(ukDay(x.ends_at))})`, cap: x.allowance, used: 0, committed: x.committed || 0, drafts: x.draft_proposals || 0, side: 'next' };
    }
    return { label: `Current cycle (resets ${stamp(cap.next_cycle?.starts_at)})`, cap: cap.quota, used: cap.used, committed: cap.committed || 0, drafts: cap.draft_proposals || 0, side: 'current' };
  }
  function budgetHtml(c) {
    const pct = (v) => Math.max(0, Math.min(100, (v / (c.cap || 1)) * 100)).toFixed(1);
    const afterUsed = c.cap - c.used;
    const afterCommitted = afterUsed - c.committed;
    const afterDrafts = afterCommitted - c.drafts;
    const seg = (v, k, l) => (v > 0 ? `<div class="${k}" style="width:${pct(v)}%" title="${esc(l)}">${pct(v) >= 9 ? esc(l) : ''}</div>` : '');
    return `<div class="mkl-budget"><div class="mks-bar">${seg(c.used, 'mks-used', `${n(c.used)} used`)}${seg(c.committed, 'mks-booked', `${n(c.committed)} committed`)}${seg(c.drafts, 'mkl-draftseg', `${n(c.drafts)} drafts`)}${seg(Math.max(0, afterDrafts), 'mks-free', `${n(afterDrafts)} left`)}</div>`
      + `<div class="mkl-kv"><span>Cap <b>${n(c.cap)}</b></span><span>Actual used <b>${n(c.used)}</b> → left ${n(afterUsed)}</span><span>Confirmed commitments (platform-scheduled) <b>${n(c.committed)}</b> → left ${n(afterCommitted)}</span><span>Draft estimates <b>${n(c.drafts)}</b> → left ${n(afterDrafts)}</span></div>`
      + '<p class="mks-dim">Each Squarespace send counts once (people + 1 business copy). LinkedIn newsletter editions never use Squarespace credits.</p></div>';
  }
  function exportOf(d, dl) {
    return (d?.exports || []).find((e) => (dl.snapshot?.export_id && e.export_id === dl.snapshot.export_id) || (e.campaign_key && e.campaign_key === dl.key)) || null;
  }
  /** Audience approval (separate from content approval): from the snapshot's own status history. */
  function audienceState(exp) {
    if (!exp) return 'audience not approved yet';
    const ok = (exp.status_history || []).find((h) => /pending_import|frozen|loaded|approved/.test(h.status || ''));
    if (ok) return `audience agreed ${short(ukDay(ok.at))}`;
    return exp.status === 'blocked' ? 'audience in review' : `audience: ${exp.status}`;
  }
  function sendState(dl) {
    if (dl.sent) return make('sent', { at: dl.sent.at });
    if (dl.provider?.state === 'scheduled' || dl.operator) return make('scheduled', { platform: 'Squarespace', at: dl.send_at, evidence: dl.evidence?.by || null });
    if (dl.record_stage === 'approved') return make('needs_approval', { blocker: 'content approved; not yet scheduled' });
    return make('draft', { blocker: dl.record_stage === 'drafted' ? 'content draft · not scheduled in Squarespace' : 'not scheduled in Squarespace' });
  }
  function overlapLine(m, day) {
    const w = m.freq?.weeks?.[addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))];
    if (!w) return 'rolling 7-day overlap: not counted for this week';
    const b = w.by_count || {};
    return `rolling 7 days ${short(w.from)}–${short(w.to)}: 0 emails not available · 1 email ${n(b[1] || 0)} · 2 emails ${n(b[2] || 0)} · 3 emails ${n(b[3] || 0)} (${n(w.approved_over || 0)} approved third) · 4+ ${n(b['4+'] || 0)}`;
  }
  const segName = (id) => ((typeof window !== 'undefined' && window.mkSegmentsList) || []).find((s) => s.segment_id === id)?.name || id;
  const cohortOf = (dl, exp) => dl.snapshot?.list_name || exp?.list_name || (dl.segment_ids || []).map(segName).join(' + ') || 'cohort not chosen';
  const creditsOf = (dl) => `${n(dl.estimate?.sends)} estimated → ${n(dl.bucket === 'committed' ? dl.amount : null)} committed → ${n(dl.sent?.count)} actual`;
  const exclusionsOf = (exp) => (exp?.exclusions ? Object.entries(exp.exclusions).map(([k, v]) => `${k.replace(/_/g, ' ')} ${n(v)}`).join(' · ') : 'none recorded');
  const sendsText = (a) => (a.people != null ? `${n(a.people)} people + ${n(a.business_copy || 0)} business copy = ${n(a.sends)} sends` : `${n(a.sends)} sends`);
  const stateNote = (s) => s.blocker || (s.code === 'scheduled' ? `Squarespace confirmed${s.evidence ? ` · ${s.evidence}` : ''}` : '');
  function sendMore(dl, m, exp, day) {
    const a = dl.aud || {};
    return `<div class="mkl-more">${dl.estimate?.rule ? `<p>Criteria: ${esc(dl.estimate.rule)}</p>` : ''}<p>People ${n(a.people)} · business copy ${n(a.business_copy)} · owner addresses ${n(a.owner_addresses)} · organisations ${a.organisations == null ? 'not split out' : n(a.organisations)} · exclusions: ${esc(exclusionsOf(exp))}</p><p>${esc(overlapLine(m, day))}</p></div>`;
  }
  function sendRow(dl, m, d) {
    const s = sendState(dl);
    const exp = exportOf(d, dl);
    const day = dl.send_at ? ukDay(dl.send_at) : dl.send_day;
    const when = `${short(day)}${dl.send_at ? ` · ${time12(dl.send_at)}` : ''} · ${cohortOf(dl, exp)}`;
    return `<details class="mkl-send"><summary><span class="mkl-c"><b>${esc(dl.title)}</b><small>${esc(when)}</small></span><span class="mkl-s">${badge(s)}<small>${esc(stateNote(s))}</small></span>`
      + `<span class="mkl-w">${esc(sendsText(dl.aud || {}))}<small>${esc(audienceState(exp))} · content ${esc(dl.record_stage)}</small><small>${esc(creditsOf(dl))}</small></span></summary>${sendMore(dl, m, exp, day)}</details>`;
  }
  function emailViewHtml(m, d, opts) {
    const cap = d?.meter?.capacity;
    const c = cycleOf(cap, opts.cycle);
    if (!c) return '<p class="mks-dim">No Squarespace meter reading yet.</p>';
    const sends = (d.meter.deliveries || []).filter((x) => !x.cancelled && x.bucket !== 'released' && (x.side === c.side || (c.side === 'current' && x.side === 'unallocated'))).sort((a, b) => String(a.send_at || a.send_day).localeCompare(String(b.send_at || b.send_day)));
    const tabs = ['current', 'next'].map((k) => `<button type="button" class="mks-tab${opts.cycle === k ? ' on' : ''}" data-mkl-cycle="${k}" aria-pressed="${opts.cycle === k}">${esc(cycleOf(cap, k).label)}</button>`).join('');
    return `<div class="mkl-email"><div class="mks-tabs"><span class="mks-group">${tabs}</span></div>${budgetHtml(c)}<div class="mkl-sends">${sends.map((x) => sendRow(x, m, d)).join('') || '<p class="mks-dim">No Squarespace sends in this cycle.</p>'}</div>`
      + '<p class="mks-dim">Light &amp; Logic promotion: none recorded in Squarespace yet (GPT proposes a module or a separate send; it will be budgeted once here).</p></div>';
  }

  const CSS = `
  .mkl { border: 1px solid #263045; border-radius: 10px; overflow: hidden; margin-top: 6px; }
  .mkl-head, .mkl-row { display: grid; grid-template-columns: minmax(0, 1fr) 210px 230px; gap: 10px; align-items: start; }
  .mkl-head { grid-template-columns: 96px minmax(0, 1fr) 210px 230px; background: #0f131b; color: #9aa3b2; font-size: 12px; font-weight: 700; padding: 8px 12px; border-bottom: 1px solid #263045; }
  .mkl-day { display: grid; grid-template-columns: 96px minmax(0, 1fr); border-bottom: 1px solid #263045; } .mkl-day:last-child { border-bottom: 0; }
  .mkl-day.today { border-left: 4px solid #f0a500; }
  .mkl-d { padding: 10px 12px; color: #fff; } .mkl-d b { display: block; font-size: 15px; letter-spacing: 0.02em; } .mkl-d span { font-size: 13px; color: #d6dbe4; font-weight: 700; } .mkl-d small { display: block; color: #f0a500; font-size: 11px; }
  .mkl-rows > .mkl-row { padding: 8px 12px 8px 0; border-bottom: 1px dashed #263045; cursor: pointer; } .mkl-rows > .mkl-row:last-child { border-bottom: 0; } .mkl-rows > .mkl-row:hover { background: #142033; }
  .mkl-c b { color: #fff; font-size: 13px; display: block; } .mkl-c small, .mkl-s small, .mkl-w small { display: block; color: #8b93a3; font-size: 11.5px; margin-top: 1px; }
  .mkl-w { color: #d6dbe4; font-size: 12.5px; } .mkl-w a { color: #f0b429; }
  .mkl-block .mkl-c { background: #111724; border: 1px solid #263045; border-radius: 8px; padding: 6px 10px; } .mkl-block ul { margin: 4px 0 0; padding-left: 18px; color: #d6dbe4; font-size: 12px; } .mkl-block li { cursor: pointer; margin: 2px 0; } .mkl-block li:hover { color: #fff; text-decoration: underline; }
  .mkl-st { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-size: 13px; } .mkl-st i { font-style: normal; }
  .mkl-st.mini { font-size: 10.5px; font-weight: 600; gap: 3px; } .mks-card .mkl-st.mini { display: inline-flex; margin-top: 2px; }
  .mkl-ok { color: #5fd38d; } .mkl-sch { color: #6ea8fe; } .mkl-amb { color: #fbbf24; } .mkl-prep { color: #aab2c0; } .mkl-chk { color: #cbd5e1; } .mkl-late { color: #f87171; }
  .mkl-tasks { margin-top: 10px; border: 1px solid #263045; border-radius: 10px; padding: 8px 14px; background: #151c2b; } .mkl-tasks h4 { margin: 0 0 4px !important; color: #fff; font-size: 13px; }
  .mkl-tasks ul { margin: 0; padding-left: 18px; font-size: 12.5px; color: #d6dbe4; } .mkl-tasks li { margin: 2px 0; cursor: pointer; } .mkl-tasks li::marker { color: #f0b429; }
  .mkl-empty { padding: 12px; }
  .mkl-budget { border: 1px solid #263045; border-radius: 10px; padding: 8px 12px; background: #151c2b; margin: 6px 0; } .mkl-draftseg { background: #a78bfa; }
  .mkl-budget p, .mkl-email > p { font-size: 12px; margin: 4px 0 0; }
  .mkl-kv { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #cbd5e1; } .mkl-kv b { color: #fff; }
  .mkl-send { border: 1px solid #263045; border-radius: 8px; margin: 6px 0; background: #111724; } .mkl-send > summary { display: grid; grid-template-columns: minmax(0, 1fr) 220px 290px; gap: 10px; padding: 8px 12px; cursor: pointer; list-style: none; }
  .mkl-more { padding: 0 12px 8px; font-size: 12px; color: #cbd5e1; } .mkl-more p { margin: 3px 0; }
  .mks-layout { display: inline-flex; gap: 4px; } .mks-filter { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px; } .mks-filter .mks-axl { margin-right: 4px; }
  #mk-schedule .mks-headrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } .mkl-legend { margin: 2px 0 4px; } .mkl-legend .mkl-st { font-size: 12px; }
  .mks-refresh { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #8b93a3; margin-left: auto; }
  `;
  if (typeof document !== 'undefined' && document.head && !document.getElementById('mkl-style')) {
    const st = document.createElement('style');
    st.id = 'mkl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  window.mkScheduleList = { statusOf, badge, badgeMini, listHtml, tasksHtml, emailViewHtml, matchChannel, rangeOf, CHANNELS, RANGES, VOCAB, isLightLogic };
})();
