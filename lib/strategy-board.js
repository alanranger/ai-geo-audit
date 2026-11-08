/**
 * Strategy & Actions S3c "Next 4 weeks" board + "When your clients book" table, and S3d "Campaign steps" per week.
 * Both read the same week rows (strategy-summary `campaign.weeks[].rows / more / steps`, lib/strategy-board-rows.mjs).
 * Ticks: moments / steps → PATCH /api/aigeo/strategy-ticks (strategy_campaign_ticks); plan actions → window.stTickAction
 * (strategy_quarter_actions.is_ticked). Ticking a step also ticks the moments it covers. Brief = paste-ready text.
 * Step state (`step.state`, lib/strategy-step-status.mjs): done (who / when) · done automatically (evidence + time) ·
 * not needed (reason) · skipped (reason) · "link this email?" · waiting for evidence · amber "late · planned <day>"
 * with Done / Skip / Move. Earlier weeks' steps still to do (`campaign.carried.late`) sit at the top of this week;
 * more than 14 days past (`carried.older`) go in a collapsed "Older, not done" list.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const utc = (iso) => new Date(`${iso}T12:00:00Z`);
  const day = (iso) => utc(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dm = (iso) => utc(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
  let activeWeek = 0;
  let current = null;

  const ticked = (key) => !!current?.campaign?.ticks?.[key]?.is_ticked;
  const ov = (e) => (window.stOverrideHtml ? window.stOverrideHtml(e) : '');
  const offerPill = (o) => (window.stOfferHtml ? window.stOfferHtml(o) : '');
  const TAG = { 'Announce': 'ann', 'Main push': 'push', 'Last places': 'last', 'Last chance': 'chance', 'Weekly mention': 'weekly', 'Plan': 'plan' };
  const stageTag = (s) => `<span class="st-tag st-tag-${TAG[s] || 'weekly'}">${esc(s)}</span>`;
  const CHIP = { Email: 'email', 'FB+IG': 'fbig', LinkedIn: 'li', Outlook: 'ol' };
  const chip = (c) => `<span class="st-ch st-ch-${CHIP[c] || 'email'}">${esc(c)}</span>`;

  /* ---------- When your clients book ---------- */

  function leadTable(lt) {
    const w = (n) => (n == null ? '—' : `${n} wk${n === 1 ? '' : 's'}`);
    const dd = (n) => (n == null ? '—' : `${n} days`);
    const row = (label, v) => `<tr><td class="left">${label}</td><td>${v?.n ?? 0}</td><td>${dd(v?.q25_days)}</td><td>${dd(v?.median_days)}</td><td>${dd(v?.q75_days)}</td><td>${w(v?.announce_weeks)}</td><td>${w(v?.main_push_weeks)}</td><td>${w(v?.last_places_weeks)}</td></tr>`;
    return `<table class="rt-table" id="st-leadtimes"><thead><tr><th class="left">When your clients book</th><th>Bookings</th><th>¼ book within</th><th>Half book within</th><th>¾ book within</th><th>Announce</th><th>Main push</th><th>Last places</th></tr></thead>`
      + `<tbody>${row('Beginners / Lightroom courses', lt.course)}${row('Day workshops &amp; walks', lt.day)}${row('Residentials', lt.residential)}</tbody></table>`
      + '<p class="rt-sub">Weeks before the start date. Announce is when the earliest quarter of your clients book, Main push is the halfway point, and Last places is when the final quarter book. Worked out from your Booking Sheet bookings over the last 24 months (JLR left out), and updated every time the page loads.</p>';
  }

  /* ---------- Next 4 weeks ---------- */

  function placesLine(r) {
    const bits = [];
    if (r.cap) bits.push(`${r.booked} of ${r.cap} booked`);
    if (r.gain) bits.push(`<span class="st-gain">+${gbp(r.gain)} GP if full</span>`);
    return bits.join(' · ');
  }
  /** Evidence rule on a quarter action (lib/strategy-action-evidence.mjs): it ticks itself, so no hand tick is offered. */
  const actionEvidence = (id) => (current?.actions || []).find((a) => String(a.id) === String(id))?.evidence || null;
  function qaTick(id, checked) {
    const ev = actionEvidence(id);
    if (ev) return `<span class="${ev.state === 'done' ? 'st-done' : 'rt-sub'}" title="Ticks itself from evidence: ${esc(ev.label)}">${ev.state === 'done' ? '✓' : 'auto'}</span>`;
    return `<input type="checkbox" class="st-qa-tick" data-id="${esc(id)}" ${checked ? 'checked' : ''} aria-label="Done">`;
  }
  function planItem(r) {
    const due = r.overdue ? `<span class="st-overdue">${esc(r.when)}</span>` : `due ${esc(day(r.due))}`;
    return `<li class="st-row">${qaTick(r.id, r.is_ticked)}`
      + `<div><div class="st-row-l1">${esc(day(r.due))} · ${stageTag('Plan')}</div><div class="st-row-name">${esc(r.name)}</div><div class="rt-sub">${due} · quarter card</div></div></li>`;
  }
  function eventItem(r) {
    const on = r.keys.every(ticked);
    const evRef = r.type === 'moment' ? { date: r.date, url: r.url, title: r.title } : null;
    return `<li class="st-row"><input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify(r.keys))}" ${on ? 'checked' : ''} aria-label="Done">`
      + `<div><div class="st-row-l1">${esc(day(r.due))} · ${r.chips.map(chip).join(' ')} · ${stageTag(r.stage)}</div>`
      + `<div class="st-row-name">${esc(r.type === 'announce_group' ? r.name : `${r.name} · ${r.when}`)}</div>`
      + `<div class="rt-sub">${placesLine(r)}${offerPill(r.offer)}${evRef ? ov(evRef) : ''}</div></div></li>`;
  }
  const item = (r) => (r.type === 'plan' ? planItem(r) : eventItem(r));
  function weekColumn(w, i) {
    const head = i === 0 ? 'This week' : (i === 1 ? 'Next week' : '');
    const more = w.more?.length ? `<details class="st-more"><summary>+${w.more.length} more</summary><ul>${w.more.map(item).join('')}</ul></details>` : '';
    return `<div class="st-n4-col${i === 0 ? ' st-n4-now' : ''}"><h4>${head ? `${head} ` : ''}<span class="rt-sub">w/c ${esc(dm(w.week))}</span></h4>`
      + `<ul>${w.rows.map(item).join('') || '<li class="rt-sub">Nothing due</li>'}</ul>${more}</div>`;
  }
  function next4Html(data) {
    const c = data.campaign;
    return '<h3>Next 4 weeks</h3><p class="rt-sub">What to do each week: every date on the site gets its Announce, Main push and Last places moment in the right week, from when your clients actually book. Each row shows the day it\'s due, where it goes, the date it promotes, places booked and the GP still to win. Quarter-card actions sit alongside. Ticking here also ticks the quarter card and the campaign step.</p>'
      + `${leadTable(c.lead_times)}<div class="st-n4">${c.weeks.map(weekColumn).join('')}</div>`;
  }

  /* ---------- Campaign steps ---------- */

  const UTM = { email: ['squarespace-email', 'email'], facebook: ['facebook', 'social'], instagram: ['instagram', 'social'], linkedin: ['linkedin', 'social'], outlook: ['outlook', 'email'] };
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function channelKeys(channel) {
    if (/Facebook/.test(channel)) return ['facebook', 'instagram'];
    if (/LinkedIn/.test(channel)) return ['linkedin'];
    if (/Outlook/.test(channel)) return ['outlook'];
    return ['email'];
  }
  /** Campaign-tagged link: weekly email links carry the week's email campaign; other channels the event's own campaign. */
  function tagged(f, ch, week) {
    const [source, medium] = UTM[ch];
    const camp = ch === 'email' ? `weekly-email-${week}` : `ev-${f.date}-${slug(f.title)}`;
    const base = /^https?:/.test(f.url) ? f.url : `https://www.alanranger.com${f.url}`;
    return `${base}?utm_source=${source}&utm_medium=${medium}&utm_campaign=${camp}&utm_content=${slug(f.title)}`;
  }
  function briefLine(f, chans, week) {
    const offer = f.offer ? ` — OFFER: ${f.offer.note}${f.offer.code ? ` (code ${f.offer.code})` : ''}${f.offer.ends ? `, ends ${day(f.offer.ends)}` : ''}` : '';
    const places = f.cap ? `, ${f.booked} of ${f.cap} booked` : '';
    const links = f.url ? chans.map((ch) => `\n    ${chans.length > 1 ? `${ch} link: ` : 'Link: '}${tagged(f, ch, week)}`).join('') : '';
    return `- ${f.moment}: ${f.name || f.title} (${f.when || f.date})${places}${offer}${links}`;
  }
  const expand = (list) => list.flatMap((f) => (f.items ? f.items.map((i) => ({ ...i, moment: 'Announce' })) : [f]));
  function briefText(s, rules, week) {
    const chans = channelKeys(s.channel);
    const ev = expand(s.featured).map((f) => briefLine(f, chans, week)).join('\n');
    return `Write the ${s.channel} piece for Alan Ranger Photography, to go out ${day(tickOf(s.key)?.moved_to || s.day)}.\nTask: ${s.step}.${s.brief ? `\nBrief: ${s.brief}.` : ''}\n`
      + `Feature these (first two lead, the rest as supporting mentions):\n${ev || '- (no events this week: use a useful tip and the Pick n Mix plans)'}\n`
      + `Rules: British English; real prices and dates only from the pages linked; use the tagged links exactly as given; no offers or codes except the OFFER lines above.${/LinkedIn/.test(s.channel) ? ` Angle: ${rules.linkedin.angle}.` : ''}${/email/i.test(s.channel) ? ` One email this week, to the audience chosen on the step; Light & Logic is folded into the week of the ${rules.email.light_and_logic_day}th, never a separate send.` : ''}`;
  }
  /** Compact feature line (S3d): one moment label per group, then "Name date · Name date"; an offer is a short marker. */
  const offerMark = (f) => (f.offer ? ` <span class="st-offer-mk" title="${esc(`${f.offer.note}${f.offer.code ? ` · code ${f.offer.code}` : ''}`)}">offer to ${esc(dm(f.offer.ends || f.date))}</span>` : '');
  function featuredCell(list) {
    const items = expand(list);
    if (!items.length) return '<span class="rt-sub">—</span>';
    const groups = new Map();
    items.forEach((f) => { const k = f.moment || f.stage || 'Weekly mention'; (groups.get(k) || groups.set(k, []).get(k)).push(f); });
    const line = ([stage, fs]) => `<div class="st-fl">${stageTag(stage)} ${fs.map((f) => `${esc(f.name || f.title)} ${esc(String(f.when || '').replace(/^starts /, ''))}${offerMark(f)}`).join(' · ')}</div>`;
    return [...groups].map(line).join('');
  }
  function tickBox(keys, label) {
    return `<label class="st-pub"><input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify(keys))}" ${ticked(keys[0]) ? 'checked' : ''} aria-label="${esc(label)}"> ${esc(label)}</label>`;
  }
  const isDone = (s) => ['done', 'auto_done'].includes(s.state?.status);
  /** Facebook + Instagram: one prep task, two publish ticks. Weekly email: its campaign record's stage. */
  function doneCell(s, week) {
    if (s.fixed_state) return '<span class="st-done" title="Done from the send evidence">✓</span>';
    if (s.plan_id) return qaTick(s.plan_id, isDone(s));
    if (/Facebook/.test(s.channel)) return tickBox([s.key], 'Prep') + tickBox([`${s.key}|fb`, ...s.covers], 'FB') + tickBox([`${s.key}|ig`, ...s.covers], 'IG');
    if (s.is_email && window.stStageChip && emailRecord(week)) return window.stStageChip(emailRecord(week));
    return `<input type="checkbox" class="st-mo-tick" data-keys="${esc(JSON.stringify([s.key, ...s.covers]))}" ${ticked(s.key) || isDone(s) ? 'checked' : ''} aria-label="Done">`;
  }
  const emailRecord = (week) => current.campaign.campaigns?.find((r) => r.campaign_key === `email|${week}`);
  const CHANNEL_CHIPS = { 'Facebook + Instagram': '<span class="st-ch st-ch-fbig">Facebook</span> <span class="st-ch st-ch-fbig">Instagram</span>', LinkedIn: '<span class="st-ch st-ch-li">LinkedIn</span>', 'Squarespace email': '<span class="st-ch st-ch-email">Squarespace email</span>', 'Outlook personal notes': '<span class="st-ch st-ch-ol">Outlook (BCC)</span>', 'Quarter action': '<span class="st-ch st-ch-plan">Quarter action</span>', 'Google Business': '<span class="st-ch st-ch-gbp">Google Business</span>', 'Squarespace email (targeted)': '<span class="st-ch st-ch-email">Squarespace email</span> <span class="rt-sub">targeted</span>' };
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const tickOf = (key) => current?.campaign?.ticks?.[key] || null;
  const stamp = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '');
  const byWhen = (st) => [st.by, stamp(st.at)].filter(Boolean).join(' · ');
  const tail = (st) => (byWhen(st) ? ` · ${esc(byWhen(st))}` : '');
  function askLine(st) {
    const btn = (m) => `<button type="button" class="rf-btn rf-btn-secondary st-sbtn st-step-link" data-ck="${esc(st.campaign_key)}" data-email="${esc(m.email_id)}">${esc(stamp(m.sent_at))} · ${esc(String(m.subject || '').slice(0, 50))} (${esc(m.why)})</button>`;
    return `<span class="st-ask">link this email? ${st.candidates.length} sent emails could be this week's</span><br>${st.candidates.map(btn).join('<br>')}`;
  }
  /** One line per state: who / when for manual, evidence + time for automatic, amber "late · planned <day>". */
  const STATE_LINE = {
    done: (st) => `<span class="st-done">done${st.evidence ? ` · evidence: ${esc(st.evidence)}` : ''}${tail(st)}</span>`,
    auto_done: (st) => `<span class="st-done">done automatically · evidence: ${esc(st.evidence)} · ${esc(stamp(st.at))}</span>`,
    not_needed: (st) => `<span class="st-nn">not needed · ${esc(st.reason || '')}${st.auto ? ` · checked ${esc(stamp(st.at))}` : tail(st)}</span>`,
    skipped: (st, s) => `<span class="st-nn">skipped · ${esc(st.reason || '')}${tail(st)}</span> <button type="button" class="rf-btn rf-btn-secondary st-sbtn st-unskip" data-key="${esc(s.key)}">undo</button>`,
    ask: askLine,
    awaiting: (st) => `<span class="rt-sub">waiting for evidence: ${esc(st.evidence_rule)}</span>`,
    late: (st) => `<span class="st-late-a">${esc(st.label)}</span>`,
    older: (st) => `<span class="st-late-a">${esc(st.label)}</span>`,
    pending: (st) => (st.label ? `<span class="rt-sub">${esc(st.label)}</span>` : '')
  };
  /** Late steps get one-click Done / Skip (reason) / Move; any step still to do can be skipped or moved. */
  function actionsHtml(s, st) {
    const late = (st.status === 'late' || st.status === 'older') && !(s.plan_id && actionEvidence(s.plan_id));
    const done = late ? `<button type="button" class="rf-btn rf-btn-secondary st-sbtn st-step-done" data-key="${esc(s.key)}" data-id="${esc(s.plan_id || '')}">Done</button>` : '';
    const skip = `<details class="st-move-l"><summary class="rt-sub">skip</summary><input type="text" class="st-skip-reason" maxlength="300" placeholder="reason"> <button type="button" class="rf-btn rf-btn-secondary st-sbtn st-skip-save" data-key="${esc(s.key)}">Skip</button></details>`;
    const move = `<details class="st-move-l"><summary class="rt-sub">move</summary><input type="date" class="st-move" data-key="${esc(s.key)}" value="${esc(tickOf(s.key)?.moved_to || '')}"></details>`;
    return `<span class="st-acts">${done}${skip}${move}</span>`;
  }
  /** Planned day; a moved day beside it (Alan's move, or the next day left while still pending); then the state. Late shows only "late · planned <day>". */
  function dayLines(s, st) {
    const userMoved = tickOf(s.key)?.moved_to || null;
    const late = st.status === 'late' || st.status === 'older';
    if (late && !userMoved) return [];
    const moved = userMoved || (s.moved && st.status === 'pending' ? s.day : null);
    const planned = s.scheduled_day || s.day;
    const lines = [`<b>${esc(day(moved || planned))}</b>`];
    if (moved && moved !== planned && !late) lines.push(`<span class="rt-sub">planned ${esc(day(planned))}</span>`);
    return lines;
  }
  function dayCell(s) {
    const st = s.state || { status: 'pending' };
    const lines = dayLines(s, st);
    lines.push(`<span class="st-state">${(STATE_LINE[st.status] || STATE_LINE.pending)(st, s)}</span>`);
    if (!st.resolved && st.status !== 'ask') lines.push(actionsHtml(s, st));
    return lines.filter(Boolean).join('<br>');
  }
  /** After a manual change: manual state, else the evidence state from the server, else late / pending by date. */
  function localState(s) {
    const t = [s.key, `${s.key}|fb`, `${s.key}|ig`].map(tickOf).find((x) => x?.is_ticked);
    if (t) return { status: 'done', by: t.set_by, at: t.set_at || t.ticked_at, resolved: true };
    const k = tickOf(s.key);
    if (k?.status === 'skipped' || k?.status === 'not_needed') return { status: k.status, reason: k.reason, by: k.set_by, at: k.set_at, resolved: true };
    if (s.auto_state) return s.auto_state;
    const eff = k?.moved_to || s.scheduled_day || s.day;
    return eff >= todayIso() ? { status: 'pending' } : { status: 'late', label: `late · planned ${day(s.scheduled_day || s.day)}` };
  }
  const allSteps = () => [...current.campaign.weeks.flatMap((w) => w.steps), ...(current.campaign.carried?.late || []), ...(current.campaign.carried?.older || [])];
  function restate(keys) {
    const set = new Set(keys);
    allSteps().filter((s) => set.has(s.key) || set.has(`${s.key}|fb`) || set.has(`${s.key}|ig`)).forEach((s) => { s.state = localState(s); });
  }
  function rememberAuto() {
    allSteps().forEach((s) => { if (s.state && s.auto_state === undefined) s.auto_state = s.state.auto || ['ask', 'awaiting'].includes(s.state.status) ? s.state : null; });
  }
  /** The weekly email names its audience; nothing defaults to the full list. */
  function audienceLine(week) {
    const rec = emailRecord(week);
    const segs = window.mkSegmentsList || [];
    const names = (rec?.segment_ids || []).map((id) => segs.find((x) => x.segment_id === id)?.name || 'segment').join(' + ');
    const now = rec?.audience === 'full_list' ? 'To: the full list (chosen)' : (rec?.audience === 'segments' ? `To: ${esc(names)}` : '<span class="st-aud-none">Audience not chosen yet</span>');
    const opts = `<option value="">Choose audience…</option><option value="full_list">Full list (deliberate)</option>${segs.map((x) => `<option value="seg:${esc(x.segment_id)}">${esc(x.name)}${x.count != null ? ` (${x.count})` : ''}</option>`).join('')}`;
    return `<div class="st-aud">${now} <select class="st-aud-sel" data-week="${esc(week)}" aria-label="Email audience">${opts}</select>${segs.length ? '' : ' <span class="rt-sub">(open Marketing → Segments once to list segments)</span>'}</div>`;
  }
  /** The step's initiative + purpose (Quarter plan links); quarter actions show the initiative of their task. */
  function initiativeLine(s) {
    if (!window.stInitiativePill) return '';
    if (s.plan_id) return window.stInitiativePill('action-id', s.plan_id);
    return window.stInitiativePill('delivery', s.key) || (s.link?.campaign_key ? window.stInitiativePill('delivery', `send|${s.link.campaign_key}`) : '');
  }
  function stepRow(s, ref, week) {
    const wk = s.week || week;
    return `<tr><td>${doneCell(s, wk)}</td><td class="st-day">${dayCell(s)}</td><td class="left">${CHANNEL_CHIPS[s.channel] || esc(s.channel)}</td>`
      + `<td class="left"><div class="st-step">${esc(s.step)}</div>${s.brief ? `<div class="rt-sub">${esc(s.brief)}</div>` : ''}${s.is_email && !s.state?.resolved && emailRecord(wk) ? audienceLine(wk) : ''}${initiativeLine(s)}</td>`
      + `<td class="left st-feat">${featuredCell(s.featured)}</td>`
      + `<td>${s.plan_id || s.gbp || s.targeted ? '' : `<button type="button" class="rf-btn rf-btn-secondary st-brief-btn" data-brief="${ref}">Brief</button>`}</td></tr>`;
  }
  /** This week's tab: earlier weeks' steps still to do (≤14 days) in the table, older ones in a collapsed list. */
  function carriedRows(c) {
    const late = c.carried?.late || [];
    if (!late.length) return '';
    return `<tr class="st-carried-h"><td colspan="6" class="left rt-sub">Earlier weeks, still to do (${late.length})</td></tr>${late.map((s, i) => stepRow(s, `c|late|${i}`, s.week)).join('')}`;
  }
  function olderHtml(c) {
    const older = c.carried?.older || [];
    if (!older.length) return '';
    return `<details class="st-th"><summary>Older, not done (${older.length}): more than 14 days past, no action</summary><div class="st-diary-scroll"><table class="rt-table"><tbody>${older.map((s, i) => stepRow(s, `c|older|${i}`, s.week)).join('')}</tbody></table></div></details>`;
  }
  function statusSummary(c) {
    const ss = c.step_status;
    if (!ss) return '';
    const bits = [`${ss.this_week?.done || 0} done`, `${ss.auto_done} done automatically`, `${ss.not_needed} not needed`, `${ss.late} late`];
    if (ss.ask) bits.push(`${ss.ask} to link`);
    if (ss.older) bits.push(`${ss.older} older, not done`);
    return `<div class="rt-sub">This week: ${bits.join(' · ')}.</div>`;
  }
  /** The billing-cycle meter (Marketing tab) replaces the old calendar-month estimate; stale is shown, never zero. */
  function sendsLine(s) {
    const m = window.mkMeter;
    if (!m || m.state === 'never_read') return `<div class="st-sends">Send budget: no Squarespace meter reading yet (calendar-month estimate retired; ${s.emails_sent} weekly email${s.emails_sent === 1 ? '' : 's'} marked sent this month).</div>`;
    const when = new Date(m.captured_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const reset = new Date(m.cycle.reset).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    return `<div class="st-sends ${m.after_reservations < 0 ? 'over' : ''}">Billing cycle: <b>${m.used.toLocaleString('en-GB')}</b> of ${m.quota.toLocaleString('en-GB')} sends used, ${m.reserved.toLocaleString('en-GB')} reserved, <b>${m.after_reservations.toLocaleString('en-GB')}</b> left after reservations · resets ${reset} · ${m.state === 'fresh' ? 'read' : 'STALE, last read'} ${when}</div>`;
  }
  function campaignHtml(data) {
    const c = data.campaign;
    const r = c.rules;
    const tabs = c.weeks.map((w, i) => `<button type="button" class="st-al-chip" data-cw="${i}" aria-pressed="${i === activeWeek}">${i === 0 ? 'This week · ' : ''}w/c ${esc(dm(w.week))}</button>`).join('');
    const w = c.weeks[activeWeek] || c.weeks[0];
    const s = c.sends;
    return `<h3>Campaign steps</h3><p class="rt-sub">One plan per week: what to send or post, where, which day, featuring which dates, each with a one-line brief. One Squarespace email a week (${esc(r.email.day)}) to the audience you choose on it; Facebook + Instagram ${esc(r.facebook_instagram.days.join(' + '))}; LinkedIn ${esc(r.linkedin.days.join(', '))}; an Outlook note only for last places / last chance; quarter-card actions due this week. The planned day never changes: a step whose day has passed shows the day it moved to. "Brief" gives the ready-made brief. Ticking a step also ticks the dates it features.</p>`
      + '<p class="rt-sub">Done automatically where the dashboard can see it: the weekly email only when a Squarespace email that week went to the audience chosen on it (two or more: "link this email?", never guessed); a targeted send linked to an event campaign is its own done step and never completes the weekly email; a post for a date that has since sold out or been withdrawn is "not needed"; the Pick n Mix launch newsletter by the relaunch email. Posts, LinkedIn, Outlook notes and the weekly Google Business check are ticked by hand (who and when is recorded; unticking is logged). Viking Local posts to Google Business automatically; a "Google Business update" appears at most once per campaign, only for an approved offer (code + end date) or last places, and is optional. A step still to do after its planned day is amber "late" with Done / Skip / Move; after 14 days it moves to "Older, not done".</p>'
      + sendsLine(s) + statusSummary(c)
      + `<div class="st-al-chips">${tabs}</div>`
      + `<div class="st-diary-scroll"><table class="rt-table" id="st-campaign-table"><thead><tr><th>Done</th><th>Day</th><th class="left">Channel</th><th class="left">Step</th><th class="left">Features</th><th></th></tr></thead>`
      + `<tbody>${activeWeek === 0 ? carriedRows(c) : ''}${w.steps.map((st, si) => stepRow(st, `${activeWeek}|${si}`, w.week)).join('')}</tbody></table></div>`
      + (activeWeek === 0 ? olderHtml(c) : '')
      + '<div id="st-brief-box" hidden><textarea id="st-brief-text" rows="9" style="width:100%"></textarea><button type="button" class="rf-btn" id="st-brief-copy">Copy brief</button></div>'
      + (window.stCampaignRecordsHtml ? window.stCampaignRecordsHtml(c, w.week) : '');
  }

  function ensureSection(root, id) {
    let el = root.querySelector(`#${id}`);
    if (!el) { el = document.createElement('div'); el.className = 'rt-section'; el.id = id; root.appendChild(el); }
    return el;
  }
  /** Strategy keeps a one-line pointer; the steps themselves live on Marketing & Campaigns. */
  function nextCampaignHtml(data) {
    const w = data.campaign.weeks[0];
    const email = w?.steps?.find((s) => s.is_email);
    const rec = data.campaign.campaigns?.find((r) => r.campaign_key === `email|${w?.week}`);
    const lead = email?.featured?.slice(0, 2).map((f) => esc(f.name || f.title)).join(' + ');
    const ss = data.campaign.step_status;
    const status = ss ? ` (${ss.this_week?.done || 0} done, ${ss.auto_done} automatically, ${ss.not_needed} not needed, ${ss.late} late${ss.ask ? `, ${ss.ask} to link` : ''})` : '';
    const line = email ? `${esc(day(email.day))} Squarespace email${lead ? ` featuring ${lead}` : ''}${rec ? ` · stage ${esc(rec.stage)}${rec.stage_source === 'auto' ? ' (send found automatically)' : ''}` : ''} · ${w.steps.length} steps this week${status}` : 'Nothing planned this week';
    return `<h3>Next campaign</h3><p class="rt-sub">${line}. Campaign steps, customers &amp; segments and the email send budget are on <a href="#marketing" data-goto-marketing>Marketing &amp; Campaigns →</a></p>`;
  }
  function paint(root) {
    if (!current?.campaign?.weeks) return;
    if (root) {
      ensureSection(root, 'st-next4').innerHTML = next4Html(current);
      ensureSection(root, 'st-campaign').innerHTML = nextCampaignHtml(current);
    }
    const mk = document.getElementById('mk-campaign-host');
    if (mk?.dataset.mounted === '1') mk.innerHTML = campaignHtml(current);
  }
  const repaintAll = () => {
    const root = document.getElementById('strategy-root');
    paint(root?.dataset.loaded === '1' ? root : null);
    document.dispatchEvent(new CustomEvent('st-steps-repainted'));
  };

  /** Local copy of what the API wrote (who / when / state), then the affected steps are re-stated. */
  function noteTick(keys, fields, by) {
    const now = new Date().toISOString();
    keys.forEach((k) => { current.campaign.ticks[k] = { ...(current.campaign.ticks[k] || { is_ticked: false }), ...fields, set_by: by, set_at: now }; });
    restate(keys);
  }
  async function saveTicks(keys, isTicked) {
    const j = await adminPost('/api/aigeo/strategy-ticks', 'PATCH', { keys, is_ticked: isTicked });
    const prevStatus = (k) => current.campaign.ticks[k]?.status;
    keys.forEach((k) => { if (!isTicked && prevStatus(k) === 'done') current.campaign.ticks[k].status = null; });
    noteTick(keys, { is_ticked: isTicked, ticked_at: isTicked ? new Date().toISOString() : null, ...(isTicked ? { status: 'done' } : {}) }, j.set_by);
  }
  async function saveStatus(key, status, reason) {
    const j = await adminPost('/api/aigeo/strategy-ticks', 'PATCH', { keys: [key], status, reason });
    noteTick([key], { status, reason: status ? reason : null, ...(status ? { is_ticked: false } : {}) }, j.set_by);
  }
  async function planDone(s, id) {
    await window.stTickAction(id, true);
    s.state = { status: 'done', by: 'Alan (quarter card)', at: new Date().toISOString(), resolved: true };
  }
  const stepByKey = (key) => allSteps().find((s) => s.key === key);
  async function markDone(btn) {
    const s = stepByKey(btn.dataset.key);
    if (!s) return;
    if (btn.dataset.id) await planDone(s, btn.dataset.id);
    else await saveTicks([s.key, ...(s.covers || [])], true);
  }
  async function skipStep(btn) {
    const reason = btn.parentElement.querySelector('.st-skip-reason')?.value.trim();
    if (!reason) throw new Error('give a reason to skip');
    await saveStatus(btn.dataset.key, 'skipped', reason);
  }
  /** "link this email?": links the chosen Squarespace send to the week's email record (send evidence). */
  async function linkStepEmail(btn) {
    const week = btn.dataset.ck.split('|')[1];
    const end = new Date(Date.parse(`${week}T12:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
    await adminPost('/api/aigeo/strategy-campaigns', 'POST', { type: 'link-send', campaign_key: btn.dataset.ck, kind: 'weekly_email', title: `Weekly email w/c ${week}`, window_start: week, window_end: end, event_keys: [], sqs_email_id: btn.dataset.email });
    await window.stRefreshSummary?.();
  }
  const STEP_CLICKS = [['.st-step-done', markDone], ['.st-skip-save', skipStep], ['.st-unskip', (b) => saveStatus(b.dataset.key, null, null)], ['.st-step-link', linkStepEmail]];
  async function runStep(el, fn) {
    el.disabled = true;
    try { await fn(el); repaintAll(); } catch (err) { el.disabled = false; el.insertAdjacentHTML('afterend', `<span class="st-err">${esc(err.message || String(err))}</span>`); }
  }
  function onStepClick(e) {
    const hit = STEP_CLICKS.map(([sel, fn]) => [e.target.closest?.(sel), fn]).find(([el]) => el);
    if (!hit || !current) return false;
    runStep(hit[0], hit[1]);
    return true;
  }
  async function adminPost(url, method, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: JSON.stringify({ propertyUrl: PROP, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `not saved (${r.status})`);
    return j;
  }
  /** Choosing the email's audience stores the campaign record (V02) with that audience. */
  async function saveAudience(sel) {
    const rec = emailRecord(sel.dataset.week);
    if (!rec || !sel.value) return;
    const seg = sel.value.startsWith('seg:') ? sel.value.slice(4) : null;
    await adminPost('/api/aigeo/strategy-campaigns', 'POST', { type: 'audience', campaign_key: rec.campaign_key, kind: rec.kind, title: rec.title, window_start: rec.window_start, window_end: rec.window_end, event_keys: rec.covers || [], stage: rec.stage, audience: seg ? 'segments' : 'full_list', segment_ids: seg ? [seg] : [] });
    Object.assign(rec, { audience: seg ? 'segments' : 'full_list', segment_ids: seg ? [seg] : [], stored: true });
  }
  async function saveMove(input) {
    const j = await adminPost('/api/aigeo/strategy-ticks', 'PATCH', { keys: [input.dataset.key], moved_to: input.value || null });
    noteTick([input.dataset.key], { moved_to: input.value || null }, j.set_by);
  }
  async function onSideChange(e) {
    const aud = e.target.closest?.('.st-aud-sel');
    const mv = e.target.closest?.('.st-move');
    if (!current || (!aud && !mv)) return false;
    e.target.disabled = true;
    try { await (aud ? saveAudience(aud) : saveMove(mv)); repaintAll(); } catch (err) { e.target.disabled = false; e.target.insertAdjacentHTML('afterend', `<span class="st-err">${esc(err.message || String(err))}</span>`); }
    return true;
  }
  async function onChange(e) {
    if (await onSideChange(e)) return;
    const mo = e.target.closest?.('.st-mo-tick');
    const qa = e.target.closest?.('.st-qa-tick');
    if (!current || (!mo && !qa)) return;
    e.target.disabled = true;
    try {
      if (qa) { await tickQuarter(qa); return; }
      await saveTicks(JSON.parse(mo.getAttribute('data-keys')), mo.checked);
      repaintAll();
    } catch (_err) {
      e.target.checked = !e.target.checked;
      e.target.disabled = false;
    }
  }
  /** Quarter action checkbox (board or step): ticks the card; the step shows done / goes back to its date state. */
  async function tickQuarter(qa) {
    const id = qa.getAttribute('data-id');
    await window.stTickAction(id, qa.checked);
    allSteps().filter((s) => String(s.plan_id) === String(id)).forEach((s) => { s.state = qa.checked ? { status: 'done', by: 'Alan (quarter card)', at: new Date().toISOString(), resolved: true } : localState(s); });
    repaintAll();
  }
  function goToMarketing(e) {
    e.preventDefault();
    document.querySelector('.aigeo-nav-item[data-panel="marketing"]')?.click();
  }
  function onClick(e) {
    if (onStepClick(e)) return;
    const tab = e.target.closest?.('[data-cw]');
    const brief = e.target.closest?.('[data-brief]');
    if (e.target.closest?.('[data-goto-marketing]')) { goToMarketing(e); return; }
    if (tab && current) { activeWeek = Number(tab.getAttribute('data-cw')); repaintAll(); return; }
    if (brief) showBrief(brief.getAttribute('data-brief'));
    if (e.target.id === 'st-brief-copy') navigator.clipboard?.writeText(document.getElementById('st-brief-text').value).catch(() => {});
  }
  function showBrief(ref) {
    const parts = ref.split('|');
    const s = parts[0] === 'c' ? current.campaign.carried?.[parts[1]]?.[Number(parts[2])] : current.campaign.weeks[Number(parts[0])]?.steps[Number(parts[1])];
    if (!s) return;
    const week = s.week || current.campaign.weeks[Number(parts[0])].week;
    document.getElementById('st-brief-text').value = briefText(s, current.campaign.rules, week);
    document.getElementById('st-brief-box').hidden = false;
  }
  const CSS = '.st-late-a{color:#fbbf24;font-weight:600;font-size:11px}.st-nn{color:#94a3b8;font-size:11px}.st-ask{color:#fbbf24;font-weight:600;font-size:11px}'
    + '.st-day .st-state{display:inline-block;white-space:normal;max-width:17rem}.st-acts{display:inline-flex;gap:4px;flex-wrap:wrap;align-items:center}.st-sbtn{font-size:11px;padding:1px 6px}'
    + '.st-skip-reason{font-size:11px;width:9rem;background:#0b1118;color:#cbd5e1;border:1px solid #334155;border-radius:4px}.st-carried-h td{background:rgba(251,191,36,0.08)}'
    + '.st-ch-gbp{background:#0c4a6e;color:#bae6fd}';
  function ensureCss() {
    if (document.getElementById('st-step-css')) return;
    const el = document.createElement('style');
    el.id = 'st-step-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  function prepare(data) {
    if (!data.campaign.ticks) data.campaign.ticks = {};
    ensureCss();
    rememberAuto();
  }

  window.mountStrategyBoard = function mountStrategyBoard(root, data) {
    current = data;
    if (!data?.campaign) return;
    prepare(current);
    paint(root);
  };
  /** Marketing & Campaigns: the Campaign steps section (same data, ticks and briefs as before). */
  window.mountMarketingCampaign = function mountMarketingCampaign(host, data) {
    if (!current || data !== current) current = data;
    if (!current?.campaign) { host.innerHTML = '<p class="rt-sub">No campaign data.</p>'; return; }
    prepare(current);
    host.dataset.mounted = '1';
    host.innerHTML = campaignHtml(current);
    document.dispatchEvent(new CustomEvent('st-steps-repainted'));
  };
  /** Marketing schedule side panel: this step's own Done / Skip / Move controls (same markup, handlers and writes). */
  const panelExtras = (s, st, week) => ({
    audience: s.is_email && !st.resolved && emailRecord(week) ? audienceLine(week) : '',
    brief: s.plan_id || s.gbp || s.targeted ? '' : briefText(s, current.campaign.rules, week)
  });
  window.stStepControls = function stStepControls(key) {
    const s = current?.campaign ? allSteps().find((x) => x.key === key) : null;
    if (!s) return null;
    const st = s.state || { status: 'pending' };
    const week = s.week || current.campaign.weeks.find((w) => w.steps.includes(s))?.week;
    const open = !st.resolved && st.status !== 'ask';
    return { step: s, week, done: doneCell(s, week), state: (STATE_LINE[st.status] || STATE_LINE.pending)(st, s), actions: open ? actionsHtml(s, st) : '', ...panelExtras(s, st, week) };
  };
  window.stRepaintBoard = repaintAll;
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
})();
