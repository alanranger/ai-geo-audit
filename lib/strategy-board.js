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
    const span = c.weeks.length ? ` <span class="rt-sub">(current week + next ${c.weeks.length - 1}: w/c ${esc(dm(c.weeks[0].week))} – w/c ${esc(dm(c.weeks[c.weeks.length - 1].week))})</span>` : '';
    return `<h3>Next 4 weeks${span}</h3><p class="rt-sub"><b>Recommended moments</b> from the plan rules, not deliveries: actual sends, drafts and posts are on Marketing &amp; Campaigns. A moment is only ticked by its own tick, never because another campaign ran.</p>`
      + '<p class="rt-sub">What to do each week: every date on the site gets its Announce, Main push and Last places moment in the right week, from when your clients actually book. Each row shows the day it\'s due, where it goes, the date it promotes, places booked and the GP still to win. Quarter-card actions sit alongside. Ticking here also ticks the quarter card and the campaign step.</p>'
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
    superseded: (st) => `<span class="st-nn">superseded by ${esc((st.covered_by || []).join(', '))} · ${esc(st.reason || '')}${tail(st)}</span>`,
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
  /* ---------- one source of truth for delivered steps; old steps GPT's plan replaced (QUESTION w, 9 Nov) ---------- */

  /**
   * A step GPT delivers (its own placement, the email a quarter action waits for, a task on the board) reads the shared
   * delivery status (strategy summary `delivery_status.by_key`, lib/marketing/delivery-status.mjs): same words as the
   * List. An old generated FB / IG or LinkedIn step is superseded by the GPT post on the same channel in the same week
   * that features the same event (its days are GPT's own). Computed on every paint; nothing is stored or rewritten.
   */
  const isGptStep = (s) => /^gpt-/.test(String(s.key || ''));
  const ownerOf = (s) => (/Outlook/.test(s.channel || '') ? 'Alan' : (isGptStep(s) || /Facebook|Instagram|LinkedIn|Google Business/.test(s.channel || '') ? 'GPT' : null));
  const STOP = new Set(['photography', 'photographic', 'photo', 'workshop', 'workshops', 'near', 'the', 'and', 'for', 'with', 'from', 'your', 'what', 'course', 'courses', 'classes', 'week', 'places', 'last', 'post', 'offer', 'ends', 'saturday', 'landscape', 'coventry', 'warwickshire', 'solihull', 'nov', 'dec', 'jan', 'https', 'www', 'alanranger', 'com', 'give', 'direction', 'actually', 'helps']);
  const words = (t) => String(t || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
  /** Distinctive words of the events a step features (name, title, page slug): "norfolk", "macro", "lightroom". */
  const eventWords = (s) => new Set(expand(s.featured || []).flatMap((f) => [...words(f.name), ...words(f.title), ...words(String(f.url || '').split('/').pop())]));
  const sameChannel = (a, b) => ['Facebook|Instagram', 'LinkedIn'].some((c) => new RegExp(c).test(a.channel || '') && new RegExp(c).test(b.channel || ''));
  const gapDays = (a, b) => Math.abs(Date.parse(`${a.day}T12:00:00Z`) - Date.parse(`${b.day}T12:00:00Z`));
  const replaceable = (s) => String(s.key || '').startsWith('step|') && /Facebook|LinkedIn/.test(s.channel || '') && !s.state?.resolved;
  /** The GPT post that replaced an old generated step (same week + channel, shared event; closest day), or null. */
  function replacementOf(s, weekSteps, byKey) {
    if (!replaceable(s)) return null;
    const ev = eventWords(s);
    const hits = weekSteps.filter((g) => isGptStep(g) && byKey[g.key] && sameChannel(s, g) && [...eventWords(g)].some((w) => ev.has(w)));
    return hits.sort((a, b) => gapDays(s, a) - gapDays(s, b))[0] || null;
  }
  const statusByKey = () => current?.delivery_status?.by_key || {};
  /** The shared status loaded: without it (summary read failed) every step keeps its plan state and controls, as before. */
  const statusReady = () => !!current?.delivery_status?.by_key && !current.delivery_status.error;
  function weekGroups() {
    const out = new Map();
    const add = (s, wk) => out.set(wk, [...(out.get(wk) || []), s]);
    current.campaign.weeks.forEach((w) => w.steps.forEach((s) => add(s, w.week)));
    [...(current.campaign.carried?.late || []), ...(current.campaign.carried?.older || [])].forEach((s) => add(s, s.week));
    return out;
  }
  /** step key → the GPT step that replaced it. */
  function supersededMap() {
    const by = statusByKey();
    const out = new Map();
    for (const list of weekGroups().values()) for (const s of list) { const g = replacementOf(s, list, by); if (g) out.set(s.key, g); }
    return out;
  }
  const holdOf = (key) => (current?.delivery_status?.holds || []).find((h) => new RegExp(h.match).test(String(key || ''))) || null;
  const FINAL = new Set(['published', 'sent']);
  const holdStatus = (h) => ({ code: 'on_hold', label: 'On hold (Alan)', icon: '⏸', line: `⏸ On hold (Alan) · ${h.reason}`, evidence: `planned dependency kept: ${h.dependency}` });
  /** The shared status for a step: its own key, or (quarter action) the email its evidence rule waits for; Alan's hold wins unless published. */
  function deliveryStatusOf(s) {
    const ck = s.plan_id ? actionEvidence(s.plan_id)?.campaign_key : null;
    const ds = s.plan_id ? (ck ? statusByKey()[`send|${ck}`] || statusByKey()[ck] : null) : statusByKey()[s.key];
    const h = holdOf(s.key);
    return h && !(ds && FINAL.has(ds.code)) ? holdStatus(h) : ds || null;
  }
  /**
   * How a step row reads: superseded (hidden by default) · delivery (the shared status, no tick for GPT's delivery) ·
   * gpt_open (GPT's channel, not in GPT's schedule: owner GPT, no tick) · plan (the plan's own state, as before).
   */
  /** The GPT step a server-superseded step names (covered_by: [gpt-…]); campaign sends (theme|…) are not steps. */
  const coveringStep = (s) => { const k = (s.state?.covered_by || []).find((x) => /^gpt-/.test(x)); return k ? allSteps().find((x) => x.key === k) || null : null; };
  /** Done automatically from the placement (server) still reads the List's word ("Published"); a hand state is kept as is. */
  const liveView = (s) => !s.state?.resolved || s.state.status === 'auto_done';
  /**
   * The status a step row shows. A step done automatically from its feed posts reads "Published" with that evidence,
   * even while its Story (its own GPT task) is still being confirmed; the step index keeps the least-advanced placement.
   */
  function shownStatus(s) {
    const live = liveView(s) ? deliveryStatusOf(s) : null;
    if (s.state?.status !== 'auto_done' || !live || FINAL.has(live.code)) return live;
    return { code: 'published', label: 'Published', icon: '✅', line: `✅ Published (feed posts) · ${s.state.evidence || ''}`.trim(), evidence: live.line ? `whole post: ${live.line}` : null };
  }
  function stepView(s, sup) {
    if (s.state?.status === 'superseded') return { kind: 'superseded', by: coveringStep(s) };
    if (sup.has(s.key)) return { kind: 'superseded', by: sup.get(s.key) };
    const ds = shownStatus(s);
    if (ds && !(s.optional && ds.code === 'in_preparation')) return { kind: 'delivery', ds, owner: ownerOf(s) };
    if (statusReady() && !s.state?.resolved && ownerOf(s) === 'GPT' && !s.plan_id) return { kind: 'gpt_open', owner: 'GPT', optional: !!s.optional || !!s.gbp };
    return { kind: 'plan', owner: ownerOf(s) };
  }
  let showSuperseded = false;
  const DS_CLS = { scheduled: 'wait', published: 'ok', sent: 'ok', done: 'ok', checked: 'ok', checking: 'wait', waiting_window: 'wait', in_progress: 'wait', late: 'warn', needs_attention: 'warn', needs_approval: 'warn', verification_unavailable: 'warn' };
  const ON_PLATFORM = new Set(['scheduled', 'published', 'sent', 'checking']);
  /** Short chip words (the column is narrow); the full List wording ("Scheduled on platform · Instagram …") is the sub-line. */
  const CHIP_WORD = { scheduled: 'Scheduled', published: 'Published', sent: 'Sent', deferred: 'Deferred (Alan)', checking: 'Checking', waiting_window: 'Window', story_ready: 'Story pending' };
  /** GPT's stale "DRAFT — Alan review required" brief is not shown once the post is approved or on the platform (display only). */
  const staleDraft = (s, v) => v?.kind === 'delivery' && /^DRAFT\b/.test(String(s.brief || '')) && (ON_PLATFORM.has(v.ds.code) || v.ds.approved);
  function viewChip(v) {
    if (v.kind === 'superseded') return '<span class="st-chip st-chip-nn" title="replaced by GPT\'s plan">superseded</span>';
    if (v.kind === 'gpt_open') return `<span class="st-chip st-chip-todo" title="GPT's channel; not in GPT's schedule">${v.optional ? 'optional' : 'not scheduled'}</span><div class="st-chip-by">owner GPT</div>`;
    const ds = v.ds;
    return `<span class="st-chip st-chip-${DS_CLS[ds.code] || 'nn'}" title="${esc([ds.line, ds.evidence].filter(Boolean).join(' · '))}">${esc(`${ds.icon || ''} ${CHIP_WORD[ds.code] || ds.label}`.trim())}</span>${v.owner ? `<div class="st-chip-by">owner ${esc(v.owner)}</div>` : ''}`;
  }
  /** The replacing GPT post, one click from the old step (Marketing schedule side panel when it is open, else the tab). */
  const replacedLink = (g) => (g ? ` <a href="#marketing" class="st-repl" data-st-open-step="${esc(g.key)}">replaced by “${esc(g.step)}” · ${esc(day(g.day))} →</a>` : '');
  /** This week from real statuses (platform / provider / task), never from ticks alone; superseded rows are counted apart. */
  function weekCounts(steps, sup) {
    const n = { scheduled: 0, published: 0, done: 0, deferred: 0, on_hold: 0, superseded: 0, gpt_open: 0, due: 0, to_do: 0, late: 0 };
    for (const s of steps) {
      const v = stepView(s, sup);
      const st = s.state?.status;
      if (v.kind === 'superseded' || v.kind === 'gpt_open') n[v.kind] += 1;
      else if (v.kind === 'delivery') n[countKey(v.ds.code)] += 1;
      else if (['done', 'auto_done'].includes(st)) n.done += 1;
      else if (st === 'late' || st === 'older') n.late += 1;
      else if (!s.state?.resolved) n.to_do += 1;
    }
    return n;
  }
  const COUNT_OF = { scheduled: 'scheduled', checking: 'scheduled', published: 'published', sent: 'published', done: 'done', checked: 'done', deferred: 'deferred', on_hold: 'on_hold', late: 'late', due: 'due', in_progress: 'due' };
  const countKey = (code) => COUNT_OF[code] || 'to_do';
  function weekLine(n) {
    const bits = [`${n.scheduled + n.published} on the platform (${n.scheduled} scheduled · ${n.published} published / sent)`, `${n.done} done`];
    const more = [[n.deferred, 'deferred (Alan)'], [n.on_hold, 'on hold (Alan)'], [n.due, 'due (GPT task)'], [n.gpt_open, 'GPT, optional or not in its schedule'], [n.to_do, 'to do'], [n.late, 'late'], [n.superseded, `superseded (${showSuperseded ? 'shown' : 'hidden'})`]];
    return [...bits, ...more.filter(([k]) => k).map(([k, t]) => `${k} ${t}`)].join(' · ');
  }
  const thisWeekSteps = () => [...(current.campaign.carried?.late || []), ...(current.campaign.weeks[0]?.steps || [])];

  /* ---------- compact row: one status chip, controls in one actions row, short step + feature chips ---------- */
  const CHIP_STATE = { done: ['done', 'ok'], auto_done: ['done · auto', 'ok'], not_needed: ['not needed', 'nn'], superseded: ['superseded', 'nn'], skipped: ['skipped', 'nn'], ask: ['link email?', 'warn'], awaiting: ['waiting', 'wait'], late: ['late', 'warn'], older: ['late 14+ days', 'warn'], pending: ['to do', 'todo'] };
  const londonDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const shortBy = (by) => String(by || '').replace(/\s*\(.*\)$/, '').replace(/^gpt$/i, 'GPT').replace(/^chatgpt$/i, 'ChatGPT');
  /** The full reason / evidence: tooltip only, never wrapped into the cell. */
  function stateTip(st) {
    const sup = st.covered_by?.length ? `superseded by ${st.covered_by.join(', ')}` : '';
    const wait = st.evidence_rule ? `waiting for evidence: ${st.evidence_rule}` : '';
    return [st.label, sup, st.reason, st.evidence, wait, byWhen(st)].filter(Boolean).join(' · ');
  }
  let sup = new Map();
  function statusChip(s) {
    const v = stepView(s, sup);
    if (v.kind !== 'plan') return viewChip(v);
    const st = s.state || { status: 'pending' };
    const [label, cls] = CHIP_STATE[st.status] || CHIP_STATE.pending;
    const who = [shortBy(st.by) || (st.auto ? 'auto' : ''), st.at ? dm(londonDate(st.at)) : ''].filter(Boolean).join(' · ');
    return `<span class="st-chip st-chip-${cls}" title="${esc(stateTip(st))}">${esc(label)}</span>${who ? `<div class="st-chip-by">${esc(who)}</div>` : ''}`;
  }
  function compactDay(s) {
    const lines = dayLines(s, s.state || { status: 'pending' });
    return lines.length ? lines.join('<br>') : `<b>${esc(day(s.scheduled_day || s.day))}</b>`;
  }
  /** Same controls and handlers as before (ticks, stage, Done / Skip / Move, undo, link email), aligned in one row. */
  /** GPT's delivery has no tick here (its status comes from the platform); Alan's own steps keep their controls. */
  function deliveredCell(s, v) {
    if (v.kind === 'superseded') return `<span class="rt-sub">${v.by ? 'GPT\'s post replaced it' : esc(s.state?.reason || 'superseded')}</span>`;
    const when = v.ds?.when && v.ds.when !== v.ds.label ? v.ds.when : '';
    return `<span class="rt-sub">${esc([v.owner ? `owner ${v.owner}` : '', when].filter(Boolean).join(' · '))}</span>`;
  }
  const noTick = (v) => v.kind === 'superseded' || v.kind === 'gpt_open' || (v.kind === 'delivery' && v.owner !== 'Alan');
  function actionsCell(s, wk, ref) {
    const v = stepView(s, sup);
    if (noTick(v)) return `<div class="st-actrow">${deliveredCell(s, v)}${v.kind === 'gpt_open' ? actionsHtml(s, s.state || { status: 'pending' }) : ''}</div>`;
    const st = s.state || { status: 'pending' };
    const open = !st.resolved && st.status !== 'ask';
    const undo = st.status === 'skipped' ? `<button type="button" class="rf-btn rf-btn-secondary st-sbtn st-unskip" data-key="${esc(s.key)}">undo</button>` : '';
    const ask = st.status === 'ask' ? `<div class="st-actsub">${askLine(st)}</div>` : '';
    const brief = s.plan_id || s.gbp || s.targeted ? '' : `<button type="button" class="rf-btn rf-btn-secondary st-sbtn st-brief-btn" data-brief="${ref}">Brief</button>`;
    const aud = s.is_email && !st.resolved && emailRecord(wk) ? `<div class="st-actsub">${audienceLine(wk)}</div>` : '';
    return `<div class="st-actrow">${doneCell(s, wk)}${undo}${open ? actionsHtml(s, st) : ''}${brief}</div>${ask}${aud}`;
  }
  const clip = (t, k) => (String(t).length > k ? `${String(t).slice(0, k - 1).trimEnd()}…` : String(t));
  function stepCell(s) {
    const v = stepView(s, sup);
    const brief = staleDraft(s, v) ? '' : s.brief;
    const sub = brief ? `<span title="${esc(brief)}">${esc(clip(brief, 90))}</span>` : '';
    const line = v.kind === 'delivery' && v.ds.line ? `<span title="${esc(v.ds.evidence || '')}">${esc([v.ds.line, v.ds.evidence].filter(Boolean).join(' · '))}</span>` : '';
    return `<div class="st-step">${esc(s.step)}</div><div class="st-sub">${line || sub}${initiativeLine(s)}${v.kind === 'superseded' ? replacedLink(v.by) : ''}</div>`;
  }
  /** At most 3 chips ("Last chance · Norfolk 20–22 Nov · offer to 14 Nov"), then "+N more" with the rest in a tooltip. */
  const featText = (f) => [`${f.name || f.title} ${String(f.when || '').replace(/^starts /, '')}`.trim(), f.offer ? `offer to ${dm(f.offer.ends || f.date)}` : ''].filter(Boolean).join(' · ');
  const featStage = (f) => f.moment || f.stage || 'Weekly mention';
  function featureChips(list) {
    const items = expand(list);
    if (!items.length) return '<span class="rt-sub">—</span>';
    const chipOf = (f) => `<span class="st-fchip" title="${esc(`${featStage(f)} · ${featText(f)}`)}">${stageTag(featStage(f))} ${esc(featText(f))}</span>`;
    const rest = items.slice(3);
    const more = rest.length ? `<span class="st-fmore" title="${esc(rest.map((f) => `${featStage(f)} · ${featText(f)}`).join('\n'))}">+${rest.length} more</span>` : '';
    return `<div class="st-fchips">${items.slice(0, 3).map(chipOf).join('')}${more}</div>`;
  }
  /** Superseded steps (GPT's plan replaced them, or a send fulfilled them) are hidden unless "show superseded" is on. */
  const shown = (s) => showSuperseded || stepView(s, sup).kind !== 'superseded';
  function stepRow(s, ref, week) {
    const wk = s.week || week;
    if (!shown(s)) return '';
    const v = stepView(s, sup);
    const feats = v.kind === 'delivery' && ON_PLATFORM.has(v.ds.code) ? (s.featured || []).map((f) => (f.stage === 'drafted' ? { ...f, stage: null, moment: CHIP_WORD[v.ds.code] } : f)) : s.featured;
    return `<tr class="st-row${v.kind === 'superseded' ? ' st-sup' : ''}"><td class="left">${statusChip(s)}</td><td class="st-day">${compactDay(s)}</td><td class="left">${CHANNEL_CHIPS[s.channel] || esc(s.channel)}</td>`
      + `<td class="left">${stepCell(s)}</td><td class="left st-feat">${featureChips(feats)}</td><td class="left">${actionsCell(s, wk, ref)}</td></tr>`;
  }
  /** This week's tab: earlier weeks' steps still to do (≤14 days) in the table, older ones in a collapsed list. */
  function carriedRows(c) {
    const late = (c.carried?.late || []).filter(shown);
    if (!late.length) return '';
    return `<tr class="st-carried-h"><td colspan="6" class="left rt-sub">Earlier weeks, still to do (${late.length})</td></tr>${late.map((s, i) => stepRow(s, `c|late|${i}`, s.week)).join('')}`;
  }
  function olderHtml(c) {
    const older = c.carried?.older || [];
    if (!older.length) return '';
    return `<details class="st-th"><summary>Older, not done (${older.length}): more than 14 days past, no action</summary><div class="st-diary-scroll"><table class="rt-table st-steps">${STEP_COLS}<tbody>${older.map((s, i) => stepRow(s, `c|older|${i}`, s.week)).join('')}</tbody></table></div></details>`;
  }
  /** "This week: 6 on the platform (5 scheduled · 1 published / sent) · 0 done · …" from the real statuses + "show superseded". */
  function statusSummary(c) {
    const n = weekCounts(thisWeekSteps(), sup);
    const extra = [c.step_status?.not_needed ? `${c.step_status.not_needed} not needed` : '', c.step_status?.ask ? `${c.step_status.ask} to link` : ''].filter(Boolean).join(' · ');
    const toggle = n.superseded ? ` <button type="button" class="rf-btn rf-btn-secondary st-sbtn" data-st-show-sup aria-pressed="${showSuperseded}">${showSuperseded ? 'hide' : 'show'} superseded (${n.superseded})</button>` : '';
    return `<div class="rt-sub" id="st-week-count">This week: ${esc(weekLine(n))}${extra ? ` · ${esc(extra)}` : ''}.${toggle}</div>`;
  }
  /** The billing-cycle meter (Marketing tab) replaces the old calendar-month estimate; stale is shown, never zero. */
  function sendsLine(s) {
    const m = window.mkMeter;
    if (!m || m.state === 'never_read') return `<div class="st-sends">Send budget: no Squarespace meter reading yet (calendar-month estimate retired; ${s.emails_sent} weekly email${s.emails_sent === 1 ? '' : 's'} marked sent this month).</div>`;
    const when = new Date(m.captured_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const reset = new Date(m.cycle.reset).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
    const k = (v) => Number(v).toLocaleString('en-GB');
    const stale = m.state === 'fresh' ? '' : ' · <span class="st-late-a">stale</span>';
    return `<div class="st-sends-chip ${m.after_reservations < 0 ? 'over' : ''}" title="Squarespace billing cycle: sends used of the allowance, reserved for booked emails, free after reservations · meter ${m.state === 'fresh' ? 'read' : 'STALE, last read'} ${esc(when)}">Billing cycle: <b>${k(m.used)}</b> / ${k(m.quota)} used · ${k(m.reserved)} reserved · <b>${k(m.after_reservations)} free</b> · resets ${esc(reset)}${stale}</div>`;
  }
  const STEP_COLS = '<colgroup><col class="c-st"><col class="c-day"><col class="c-ch"><col><col class="c-feat"><col class="c-act"></colgroup>';
  function campaignHtml(data) {
    const c = data.campaign;
    sup = supersededMap();
    const r = c.rules;
    const tabs = c.weeks.map((w, i) => `<button type="button" class="st-al-chip" data-cw="${i}" aria-pressed="${i === activeWeek}">${i === 0 ? 'This week · ' : ''}w/c ${esc(dm(w.week))}</button>`).join('');
    const w = c.weeks[activeWeek] || c.weeks[0];
    const s = c.sends;
    return `<h3>Campaign steps</h3><p class="rt-sub">One plan per week: what to send or post, where, which day, featuring which dates, each with a one-line brief. One Squarespace email a week (${esc(r.email.day)}) to the audience you choose on it; Facebook + Instagram ${esc(r.facebook_instagram.days.join(' + '))}; LinkedIn ${esc(r.linkedin.days.join(', '))}; an Outlook note only for last places / last chance; quarter-card actions due this week. The planned day never changes: a step whose day has passed shows the day it moved to. "Brief" gives the ready-made brief. Ticking a step also ticks the dates it features.</p>`
      + '<p class="rt-sub">Done automatically where the dashboard can see it: the weekly email only when a Squarespace email that week went to the audience chosen on it (two or more: "link this email?", never guessed); a targeted send linked to an event campaign is its own done step and never completes the weekly email; a post for a date that has since sold out or been withdrawn is "not needed"; the Pick n Mix launch newsletter by the relaunch email. Posts, LinkedIn, Outlook notes and the weekly Google Business check are ticked by hand (who and when is recorded; unticking is logged). Viking Local posts to Google Business automatically; a "Google Business update" appears at most once per campaign, only for an approved offer (code + end date) or last places, and is optional. A step still to do after its planned day is amber "late" with Done / Skip / Move; after 14 days it moves to "Older, not done".</p>'
      + sendsLine(s) + statusSummary(c)
      + `<div class="st-al-chips">${tabs}</div>`
      + `<div class="st-diary-scroll"><table class="rt-table st-steps" id="st-campaign-table">${STEP_COLS}<thead><tr><th class="left">Status</th><th>Day</th><th class="left">Channel</th><th class="left">Step</th><th class="left">Features</th><th class="left">Actions</th></tr></thead>`
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
  /** The next stored campaign still to send (server: quarter_plan.next_campaign); recommendations stay in Next 4 weeks. */
  const ukWhen = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '');
  function campaignWhen(n) {
    const at = n.scheduled_for ? ukWhen(n.scheduled_for) : day(n.day);
    return `${esc(at)} · ${esc(n.title || n.campaign_key)} · ${n.provider_scheduled ? 'scheduled in Squarespace' : esc(n.stage)}`;
  }
  function nextCampaignHtml(data) {
    const n = data.quarter_plan?.next_campaign;
    sup = supersededMap();
    const status = ` This week's steps: ${weekLine(weekCounts(thisWeekSteps(), sup))}.`;
    const line = n ? `${campaignWhen(n)}${n.then ? `; then ${campaignWhen(n.then)}` : ''}` : 'No stored campaign still to send';
    return `<h3>Next campaign</h3><p class="rt-sub" title="${esc(n?.basis || '')}">${line}.${status} Campaign steps, customers &amp; segments and the email send budget are on <a href="#marketing" data-goto-marketing>Marketing &amp; Campaigns →</a></p>`;
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
  /** The replacing GPT post: its review panel on the Marketing schedule when available, else the Marketing tab. */
  function openReplacement(e, el) {
    e.preventDefault();
    if (typeof window.mkOpenSocialReview === 'function' && window.mkOpenSocialReview(el.getAttribute('data-st-open-step'))) return;
    goToMarketing(e);
  }
  function onSupClick(e) {
    const repl = e.target.closest?.('[data-st-open-step]');
    if (repl) { openReplacement(e, repl); return true; }
    if (!e.target.closest?.('[data-st-show-sup]') || !current) return false;
    showSuperseded = !showSuperseded;
    repaintAll();
    return true;
  }
  function onClick(e) {
    if (onStepClick(e) || onSupClick(e)) return;
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
    + '.st-ch-gbp{background:#0c4a6e;color:#bae6fd}tr.st-sup{opacity:.6}.st-repl{color:#93c5fd;font-size:11px}'
    + 'table.st-steps{table-layout:fixed;width:100%}table.st-steps td,table.st-steps th{vertical-align:top;padding:6px 8px}table.st-steps col.c-st{width:7.5rem}table.st-steps col.c-day{width:7.5rem}table.st-steps col.c-ch{width:8.5rem}table.st-steps col.c-feat{width:27%}table.st-steps col.c-act{width:14rem}'
    + 'table.st-steps td.left,table.st-steps th.left{text-align:left}table.st-steps td.st-day{white-space:nowrap;color:#e2e8f0;font-size:12px}table.st-steps td.st-day .rt-sub{font-size:10.5px}.st-actrow .st-pub{color:#cbd5e1}.st-chip{display:inline-block;font-size:11px;font-weight:700;border-radius:999px;padding:1px 8px;white-space:nowrap;cursor:help}'
    + '.st-chip-ok{background:#14532d;color:#bbf7d0}.st-chip-nn{background:#1f2937;color:#cbd5e1;border:1px solid #374151}.st-chip-warn{background:#422006;color:#fde68a;border:1px solid #b45309}.st-chip-wait{background:#172554;color:#bfdbfe}.st-chip-todo{border:1px dashed #64748b;color:#cbd5e1}'
    + '.st-chip-by{font-size:10.5px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.st-steps .st-step{font-weight:600;color:#f1f5f9;line-height:1.3}.st-sub{font-size:11.5px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.st-sub>*{margin-right:6px}'
    + '.st-fchips{display:flex;flex-wrap:wrap;gap:4px}.st-fchip{display:inline-flex;align-items:center;gap:4px;max-width:100%;font-size:11.5px;color:#e2e8f0;background:#111827;border:1px solid #334155;border-radius:6px;padding:1px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.st-fmore{font-size:11px;color:#94a3b8;border:1px dashed #475569;border-radius:6px;padding:1px 6px;cursor:help;white-space:nowrap}'
    + '.st-actrow{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.st-actrow .st-pub{white-space:nowrap;font-size:12px}.st-actrow details.st-move-l{display:inline-block}.st-actsub{margin-top:4px;font-size:11px}.st-actsub select{max-width:100%}'
    + '.st-sends-chip{display:inline-block;font-size:12px;color:#cbd5e1;background:#111827;border:1px solid #334155;border-radius:999px;padding:2px 10px;margin:4px 0}.st-sends-chip.over{border-color:#ef4444}';
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
    const v = stepView(s, supersededMap());
    if (noTick(v)) return { step: s, week, done: deliveredCell(s, v), state: v.kind === 'superseded' ? viewChip(v) : esc(v.ds?.line || 'GPT · not in its schedule'), actions: '', audience: '', brief: staleDraft(s, v) ? '' : panelExtras(s, st, week).brief };
    return { step: s, week, done: doneCell(s, week), state: (STATE_LINE[st.status] || STATE_LINE.pending)(st, s), actions: open ? actionsHtml(s, st) : '', ...panelExtras(s, st, week) };
  };
  /** Tests / acceptance: each step's view (kind, status code, owner, replaced-by) and this week's counts. */
  window.stStepViews = function stStepViews() {
    if (!current?.campaign) return null;
    const m = supersededMap();
    const view = (s) => { const v = stepView(s, m); return { key: s.key, kind: v.kind, code: v.ds?.code || s.state?.status || null, owner: v.owner || null, by: v.by?.key || null, stale_draft_hidden: staleDraft(s, v) }; };
    return { steps: thisWeekSteps().map(view), counts: weekCounts(thisWeekSteps(), m) };
  };
  window.stRepaintBoard = repaintAll;
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);
})();
