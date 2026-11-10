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
    late: ['Late', '⚠', 'late'], failed: ['Failed', '✖', 'late'], verification_unavailable: ['Verification unavailable', '?', 'chk'], cancelled: ['Cancelled', '—', 'chk'],
    done: ['Done', '✓', 'ok'], due: ['Due', '📋', 'prep'], in_progress: ['In progress', '◔', 'sch'], checked: ['Checked', '✓', 'ok'], needs_attention: ['Needs attention', '⚠', 'amb'],
    deferred: ['Deferred', '⏸', 'chk'], waiting_window: ['Ready, waiting for Meta\'s window', '⏳', 'chk'], story_ready: ['Story ready to publish', '📱', 'prep'],
    conditional: ['Conditional', '🔒', 'prep'], on_hold: ['On hold (Alan)', '⏸', 'chk'], partly_scheduled: ['Partly scheduled', '◐', 'sch'], loading: ['Checking status…', '…', 'chk'],
    not_in_scheduled: ['Not in Squarespace Scheduled — check', '⚠', 'late']
  };
  const TONE = { green: 'ok', blue: 'sch', amber: 'amb', grey: 'prep', neutral: 'chk', red: 'late' };
  const PLATFORM = { email: 'Squarespace', fbig: 'Meta', linkedin: 'LinkedIn', youtube: 'YouTube', gbp: 'Google', outlook: 'Outlook' };
  const YT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#ff0033"/><path fill="#fff" d="M9.8 8.2v7.6l6.4-3.8z"/></svg>';
  const make = (code, extra = {}) => ({ code, label: VOCAB[code]?.[0] || code, icon: VOCAB[code]?.[1] || '', ...extra });
  /** M's status object (lib/marketing/delivery-status.mjs), normalised for rendering; `server: true` marks the source. */
  const norm = (s) => ({ ...make(s.code), ...s, label: s.label || VOCAB[s.code]?.[0] || s.code, icon: s.icon || VOCAB[s.code]?.[1] || '', server: true });
  /** The server's shared status when it is on the item itself (emails: d.meter.deliveries[].status). */
  function serverStatus(x) {
    const s = x.raw?.status && typeof x.raw.status === 'object' ? x.raw.status : x.raw?.delivery?.status;
    return s && s.code ? norm(s) : null;
  }
  /* The shared board (GET ?action=delivery-status via window.mkLoadDeliveryStatus): emails, placements, tasks. */
  const PL_LABEL = { facebook_feed: 'FB feed', instagram_feed: 'IG feed', instagram_story: 'IG Story', linkedin_feed: 'LinkedIn' };
  /** Feed placements lead the row; a Story (its own task) never outranks them. */
  const PRECEDENCE = ['published', 'scheduled', 'needs_approval', 'late', 'failed', 'checking', 'verification_unavailable', 'conditional', 'waiting_window', 'in_preparation', 'story_ready', 'cancelled'];
  /** "FB feed scheduled · IG feed scheduled · IG Story pending (GPT)": every placement with its own status word. */
  const PL_WORD = { published: 'published', scheduled: 'scheduled', story_ready: 'pending (GPT)', waiting_window: 'waiting for Meta\'s window', in_preparation: 'in preparation', needs_approval: 'needs approval', conditional: 'conditional', checking: 'checking', late: 'late', cancelled: 'skipped' };
  const plName = (p) => PL_LABEL[p.placement] || p.placement;
  const PL_ORDER = ['facebook_feed', 'instagram_feed', 'instagram_story', 'linkedin_feed'];
  const byPlacement = (a, b) => PL_ORDER.indexOf(a.placement) - PL_ORDER.indexOf(b.placement);
  const perPlacement = (ps) => [...ps].sort(byPlacement).map((p) => `${plName(p)} ${PL_WORD[p.status.code] || String(p.status.label || p.status.code).toLowerCase()}`).join(' · ');
  const byPrecedence = (a, b) => PRECEDENCE.indexOf(a.status.code) - PRECEDENCE.indexOf(b.status.code);
  /**
   * One post, several placements, each named with its own status. All published → Published; some → "Published (FB feed)";
   * some scheduled and the rest not → "Partly scheduled"; never implies every channel is done because one is.
   */
  function combinePlacements(ps) {
    const line = perPlacement(ps);
    const pub = ps.filter((p) => p.status.code === 'published');
    if (pub.length && pub.length < ps.length) return { ...norm(pub[0].status), label: `Published (${pub.map(plName).join(', ')})`, blocker: line, placements: line };
    const best = [...ps].sort(byPrecedence)[0];
    const s = norm(best.status);
    if (ps.length < 2) return s;
    const same = ps.every((p) => p.status.code === best.status.code);
    const blocker = [line, s.blocker].filter(Boolean).join(' · ');
    if (same || best.status.code !== 'scheduled') return { ...s, blocker, placements: line };
    return { ...s, code: 'partly_scheduled', label: 'Partly scheduled', icon: '◐', blocker: line, placements: line };
  }
  /** Alan's holds from the board (lib/marketing/delivery-status.mjs HOLDS): "On hold (Alan)", dependency kept visible. */
  const holdFor = (stepKey, board) => (board?.holds || []).find((h) => new RegExp(h.match).test(String(stepKey || ''))) || null;
  function holdStatus(x, board) {
    const h = holdFor(x.step_key, board);
    return h ? make('on_hold', { server: true, when: `On hold since ${short(h.at)}`, blocker: h.reason, evidence: `planned dependency kept: ${h.dependency}` }) : null;
  }
  function boardStatus(x, board) {
    if (!board) return null;
    if (x.row === 'email') return board.emails?.find((e) => e.key === x.record_key && e.status?.code) ? norm(board.emails.find((e) => e.key === x.record_key).status) : null;
    if (x.row === 'outlook' || x.row === 'gbp') { const t = board.tasks?.find((y) => y.step_key === x.step_key && y.status?.code); return t ? norm(t.status) : null; }
    const ps = (board.placements || []).filter((p) => p.step_key === x.step_key && p.status?.code);
    return ps.length ? combinePlacements(ps) : null;
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
  const lightLogicStatus = (x, env) => publishedOf(env.placements ? env.placements(x) : []) || make('in_preparation', { blocker: 'edition not prepared · not scheduled on LinkedIn' });
  /** A step GPT recorded as PLANNED (Light & Logic editions and their promotion): "Planned — content to prepare" until published. */
  const PLANNED_LABEL = 'Planned — content to prepare';
  const plannedStatus = (x, env) => publishedOf(env.placements ? env.placements(x) : []) || make('in_preparation', { label: PLANNED_LABEL, blocker: 'not drafted, not scheduled', at: x.raw?.planned_at || null });
  const prepStatus = (x, r) => make('in_preparation', { blocker: x.draft ? `draft, not scheduled in ${PLATFORM[x.row] || 'the platform'}` : (r.next || null), at: r.planned_at || null });
  /** An email whose planned / scheduled time has passed with no send confirmed yet: "Checking delivery", never sent by time. */
  const releaseDue = (x, r, now) => x.row === 'email' && !x.draft && !!(r.planned_at || r.delivery?.send_at) && Date.parse(r.planned_at || r.delivery.send_at) <= now;
  function derived(x, env) {
    const r = x.raw || {};
    if (x.state === 'done') return doneStatus(x, r);
    if (releaseDue(x, r, env.now || Date.now())) return make('checking', { blocker: 'release time passed; waiting for Squarespace to confirm the send' });
    if (r.planned_record) return plannedStatus(x, env);
    if (isLightLogic(x)) return lightLogicStatus(x, env);
    if (x.row === 'fbig' || x.row === 'linkedin') return socialStatus(x, env);
    if (x.state === 'sch') return make('scheduled', { platform: PLATFORM[x.row], at: r.planned_at || null, evidence: r.evidence?.by || null });
    return x.state === 'warn' || x.state === 'late' ? dueStatus(x) : prepStatus(x, r);
  }
  const FINAL = new Set(['sent', 'published']);
  const BOARD_ROWS = new Set(['fbig', 'linkedin']);
  /** Social rows wait for the ONE status source (the board) instead of showing a contradictory plan-derived status. */
  const awaitingBoard = (x, env) => !env.board && env.boardLoading === true && BOARD_ROWS.has(x.row) && x.state !== 'done';
  /**
   * M's status (on the item, then the shared board) wins; Alan's hold wins over anything not yet sent / published.
   * Until the board arrives a social row reads "Checking status…"; the adapter is only used if the board failed.
   */
  function statusOf(x, env = {}) {
    if (x.state === 'resolved') return make('cancelled');
    const s = serverStatus(x) || boardStatus(x, env.board);
    if (s && FINAL.has(s.code)) return s;
    const held = holdStatus(x, env.board);
    if (held || s) return held || s;
    return awaitingBoard(x, env) ? make('loading', { blocker: 'loading the platform status' }) : derived(x, env);
  }
  const cls = (s) => VOCAB[s.code]?.[2] || TONE[s.tone] || 'prep';
  /** Word + icon + colour (never colour alone). */
  const badge = (s) => `<span class="mkl-st mkl-${cls(s)}"><i>${esc(s.icon)}</i>${esc(s.label)}</span>`;
  const badgeMini = (s) => `<span class="mkl-st mini mkl-${cls(s)}" title="${esc(s.label)}${s.blocker ? ` · ${esc(s.blocker)}` : ''}"><i>${esc(s.icon)}</i>${esc(s.label)}</span>`;

  /* ---------- channels + range ---------- */

  const CHANNELS = [['all', 'All'], ['email', 'Squarespace email'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['google', 'Google'], ['outlook', 'Personal email (Outlook)']];
  const ROWS_OF = { all: null, email: ['email'], facebook: ['fbig'], instagram: ['fbig'], linkedin: ['linkedin'], youtube: ['youtube'], google: ['gbp'], outlook: ['outlook'] };
  const matchChannel = (x, ch) => !ROWS_OF[ch] || ROWS_OF[ch].includes(x.row);
  const RANGES = [['this', 'This week', 0, 7], ['next', 'Next week', 7, 7], ['4w', '4 weeks', 0, 28], ['9', 'This week + 8', 0, 63]];
  function rangeOf(key, firstWeek) {
    const r = RANGES.find((x) => x[0] === key) || RANGES[0];
    return { from: addDays(firstWeek, r[2]), to: addDays(firstWeek, r[2] + r[3] - 1) };
  }
  const isTask = (x) => x.row === 'outlook' || (x.row === 'gbp' && !x.synthetic);
  /** The LinkedIn newsletter edition rows only (gpt-ll-newsletter-…); the edition's FB / IG promotion is an ordinary post row. */
  const isLightLogic = (x) => /light\s*&\s*logic newsletter/i.test(`${x.title || ''} ${x.step_key || ''}`) || /^gpt-ll-newsletter-/.test(String(x.step_key || ''));

  /* ---------- list rows ---------- */

  const CH_LINE = { email: 'Email · Squarespace', fbig: 'Facebook · Instagram · Story', linkedin: 'LinkedIn', youtube: 'YouTube · Short video / reel', gbp: 'Google Business', outlook: 'Personal email · Outlook' };
  const people = (x) => x.raw?.delivery?.aud?.people ?? x.people;
  const emailAt = (x) => x.raw?.delivery?.sent?.at || x.raw?.planned_at || x.raw?.delivery?.send_at || null;
  const recipients = (x) => (people(x) != null ? `${n(people(x))} recipients` : 'audience not counted');
  /** "5 since unsubscribed / removed from the Squarespace list (frozen: 370 people)": only when people left the list. */
  const sinceFrozen = (a) => (a && a.since_frozen > 0 && a.since_frozen_line ? `<small class="mkl-frozen">${esc(a.since_frozen_line)}</small>` : '');
  const sinceOf = (x) => sinceFrozen(x.raw?.delivery?.aud);
  function emailWhen(x) {
    const t = time12(emailAt(x));
    return esc([t || 'time not set', recipients(x)].join(' · '));
  }
  function socialWhen(x, s, env) {
    if (s.code === 'published') return `${esc(time12(s.at))}${s.link ? ` · <a href="${esc(s.link)}" target="_blank" rel="noopener">View post</a>` : ''}`;
    if (s.server && s.when) return esc(s.when);
    const at = s.at || (env.plan ? env.plan(x) : null);
    if (!at) return 'Time not set';
    return s.code === 'scheduled' ? esc(time12(at)) : `Planned ${esc(time12(at))}`;
  }
  /** A YouTube release: its time, the link, and where the status came from (YouTube's own read). */
  function youtubeWhen(x, s) {
    const at = s.at || x.raw?.planned_at;
    const link = s.link || x.raw?.link;
    return `${esc(at ? time12(at) : 'Time not set')}${link ? ` · <a href="${esc(link)}" target="_blank" rel="noopener">Open on YouTube</a>` : ''}${s.evidence ? `<small>${esc(s.evidence)}</small>` : ''}`;
  }
  function whenText(x, s, env) {
    if (x.row === 'email') return emailWhen(x);
    return x.row === 'youtube' ? youtubeWhen(x, s) : socialWhen(x, s, env);
  }
  function chLine(x, env = {}) {
    if (isLightLogic(x)) return `LinkedIn · Light &amp; Logic newsletter · ${holdFor(x.step_key, env.board) ? 'on hold (Alan): nothing is being produced until he resumes it' : 'GPT prepares, Alan approves'}`;
    return `${x.row === 'youtube' ? `<span class="mkl-ic">${YT_ICON}</span>` : ''}${esc(CH_LINE[x.row] || x.row)}`;
  }
  /** The subject Squarespace shows, under the friendly campaign name, so Alan can find the same campaign there. */
  const subjectOf = (x, board) => boardEmail(x, board)?.subject || x.raw?.delivery?.sent?.subject || x.raw?.delivery?.provider?.subject || null;
  const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const subjectHtml = (subject, title) => (subject && !sameText(subject, title) ? `<small class="mkl-subj">Squarespace subject: “${esc(subject)}”</small>` : '');
  const subjectLine = (x, env) => (x.row === 'email' ? subjectHtml(subjectOf(x, env.board), x.title) : '');

  /* ---------- Shorts carried by an email (board emails[].shorts / short_check) ---------- */

  const videoName = (t) => String(t || '').split(' | ')[0].trim();
  const boardEmail = (x, board) => (x.row === 'email' && board ? (board.emails || []).find((e) => e.key === x.record_key) || null : null);
  /** "▶ Check the Whole Frame · 0:24" (opens the content record) + "Short public ✓" / "Short not public yet ⚠". Never the email's status. */
  function shortChips(x, board) {
    const e = boardEmail(x, board);
    if (!e?.shorts?.length) return '';
    const chips = e.shorts.map((v) => `<span class="mkl-yt" role="button" tabindex="0" data-mkl-content="${esc(`youtube|${v.asset_key}`)}" title="Open the content record: every use and its status">▶ ${esc([videoName(v.title), v.duration].filter(Boolean).join(' · '))}</span>`).join('');
    const chk = e.short_check?.label ? `<span class="mkl-ytc ${e.short_check.public ? 'mkl-ok' : 'mkl-amb'}">${esc(e.short_check.label)}</span>` : '';
    return `<span class="mkl-yts">${chips}${chk}</span>`;
  }
  /* ---------- Light & Logic promotion modules (extras.promotions: module asset → email send + edition row) ---------- */

  const STAGE_WORD = { drafted: 'draft', approved: 'approved', scheduled: 'scheduled', sent: 'sent' };
  const dmOf = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'date not set');
  const monthOf = (day) => (day ? new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '');
  const promoWhere = (p) => `${dmOf(p.planned_send_on)} email (${STAGE_WORD[p.stage] || p.stage || 'draft'})`;
  /**
   * On a Light & Logic edition row: "promoted in: 19 Nov email (draft)", or that none is recorded. On hold: the planned
   * dependency stays visible, labelled paused (no implied promotion).
   */
  /**
   * A recorded module is only shown as in the email while no Squarespace edit of that email is newer than the record
   * (the provider's last edit wins: api/aigeo/marketing-schedule-extras.js `confirmed`); a removed record is never shown.
   */
  const REMOVED = new Set(['removed', 'cancelled', 'retired']);
  const liveModules = (promos) => (promos || []).filter((p) => !REMOVED.has(p.status));
  const confirmedOf = (promos) => liveModules(promos).filter((p) => p.confirmed !== false);
  const unconfirmedOf = (promos) => liveModules(promos).filter((p) => p.confirmed === false);
  const editedNote = (p) => `${promoWhere(p)}: module recorded ${stamp(p.recorded_at)}, not confirmed since the Squarespace edit ${stamp(p.provider_edited_at)}`;
  function promotedLine(x, promos, board) {
    if (!isLightLogic(x)) return '';
    const mine = (list) => list.filter((p) => p.edition_step_key === x.step_key);
    const ps = mine(confirmedOf(promos));
    const where = esc(ps.map(promoWhere).join(' · '));
    const stale = mine(unconfirmedOf(promos)).map((p) => ` · ${esc(editedNote(p))}`).join('');
    if (holdFor(x.step_key, board)) return `<small class="mkl-promo">${ps.length ? `planned dependency (paused while on hold): module in the ${where}` : 'planned dependency: none recorded'}${stale}</small>`;
    const none = stale ? 'promotion: planned, not confirmed in an email' : 'promotion: none recorded';
    return `<small class="mkl-promo">${ps.length ? `promoted in: ${where}` : none}${stale}</small>`;
  }
  /**
   * On an email carrying the module: "📰 Light & Logic Nov edition module" (rides on the email's own sends). Edited in
   * Squarespace since the module was recorded (the provider's edit wins): the label is not shown; an amber "re-check"
   * without the module's name flags it until GPT confirms the module or marks the record removed.
   */
  const RECHECK_TIP = 'A promotion module was recorded for this email, but Squarespace has edited the email since: it is not shown as in the email until GPT confirms it (or marks the record removed).';
  function promoChip(x, promos, board) {
    if (x.row !== 'email') return '';
    const mine = (list) => list.filter((p) => p.campaign_key === x.record_key);
    const held = (p) => holdFor(p.edition_step_key, board);
    const ok = mine(confirmedOf(promos)).map((p) => `<span class="mkl-llm" title="Light &amp; Logic promotion module in this email: budgeted once in this email's own sends; the newsletter never uses Squarespace credits">📰 Light &amp; Logic ${esc(monthOf(p.edition_day))} edition module${held(p) ? ' · on hold (Alan)' : ''}</span>`);
    const stale = mine(unconfirmedOf(promos)).filter((p) => !held(p)).map((p) => `<span class="mkl-llm mkl-amb" title="${esc(`${RECHECK_TIP} ${editedNote(p)}`)}">⚠ Module to re-check · email edited since it was recorded</span>`);
    return [...ok, ...stale].join('');
  }
  function promotionsLine(promos, board) {
    const live = confirmedOf(promos);
    const stale = unconfirmedOf(promos).map((p) => ` Not confirmed: ${esc(editedNote(p))}.`).join('');
    if (!live.length) return `Light &amp; Logic promotion: none recorded yet (GPT proposes a module or a separate send; it will be budgeted once here).${stale}`;
    const list = live.map((p) => `${monthOf(p.edition_day)} edition (${dmOf(p.edition_day)}) → module in the ${promoWhere(p)}${holdFor(p.edition_step_key, board) ? ' (on hold: Alan)' : ''}`).join(' · ');
    return `Light &amp; Logic promotion: ${esc(list)}. Budgeted once: each module rides on its email's own sends; the LinkedIn newsletter itself never uses Squarespace credits.${stale}`;
  }
  const extrasOf = (x, env) => `${subjectLine(x, env)}${shortChips(x, env.board)}${promoChip(x, env.promotions, env.board)}${promotedLine(x, env.promotions, env.board)}`;
  function itemRow(x, env) {
    const s = env.status(x);
    const when = whenText(x, s, env);
    return `<div class="mkl-row" data-mkl-item="${esc(x.id)}" role="button" tabindex="0"><div class="mkl-c"><b>${esc(x.title)}</b><small>${chLine(x, env)}</small>${extrasOf(x, env)}</div>`
      + `<div class="mkl-s">${badge(s)}${s.blocker ? `<small>${esc(s.blocker)}</small>` : ''}${s.platform && s.code === 'scheduled' ? `<small>${esc(s.platform)} confirmed</small>` : ''}${s.server && s.code === 'scheduled' && x.row !== 'email' && s.evidence ? `<small>${esc(s.evidence)}</small>` : ''}</div><div class="mkl-w">${when}${sinceOf(x)}</div></div>`;
  }
  /** Same-day emails: one block, each title, time and recipients, then the total labelled "recipient sends". */
  function emailBlock(xs, env) {
    const sts = xs.map((x) => env.status(x));
    const same = sts.every((s) => s.code === sts[0].code);
    const total = xs.reduce((t, x) => t + (Number(people(x)) || 0), 0);
    const lines = xs.map((x, i) => `<li data-mkl-item="${esc(x.id)}" role="button" tabindex="0">${esc(x.title)} — ${esc(time12(emailAt(x)) || 'time not set')} — ${esc(recipients(x))}${same ? '' : ` · ${badgeMini(sts[i])}`}${subjectLine(x, env)}${shortChips(x, env.board)}${promoChip(x, env.promotions, env.board)}${sinceOf(x)}</li>`).join('');
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
  /** The YouTube filter lists every scheduled release from the range start (a Short is scheduled weeks ahead). */
  const spanOf = (m, opts) => (opts.channel === 'youtube' ? { from: opts.range.from, to: [opts.range.to, ...m.items.filter((x) => x.row === 'youtube').map((x) => x.day)].sort().pop() } : opts.range);
  function listHtml(m, opts, env) {
    const { from, to } = spanOf(m, opts);
    const xs = m.items.filter((x) => x.day && x.day >= from && x.day <= to && x.state !== 'resolved' && !isTask(x) && matchChannel(x, opts.channel));
    const days = [...new Set(xs.map((x) => x.day))].sort();
    const head = '<div class="mkl-head"><span>Day</span><span>Campaign &amp; channel</span><span>Status</span><span>When / audience</span></div>';
    const body = days.map((d) => dayHtml(d, xs.filter((x) => x.day === d).sort(byTime), env, m.today)).join('') || '<p class="mks-dim mkl-empty">Nothing in this range for this channel.</p>';
    return `<div class="mkl">${head}${body}</div>`;
  }

  /* ---------- tasks & reminders ---------- */

  /** The weekly Google Business review: a GPT task (Due / In progress / Checked / Needs attention), never a publication. */
  const isGbpReview = (x) => x.row === 'gbp' && (x.raw?.gbp === 'check' || /Google Business (check|review)/i.test(x.title || ''));
  function taskWhat(x, s) {
    if (isGbpReview(x)) return `Weekly Google Business review · owner GPT · ${s.code === 'checked' ? (s.when || 'checked') : 'next: Review latest posts and reviews'}`;
    if (x.row === 'outlook') return `${x.title} · ${s.code === 'deferred' ? 'personal note · Alan is doing this himself' : 'personal note for Alan to review and send'}`;
    if (x.row === 'gbp') return `${x.title} · optional · owner ${x.raw?.owner || 'GPT'}: drafts and posts it (Alan only for a commercial approval)`;
    return x.title;
  }
  /** "a · b · c" with empty parts (and stray leading / trailing "·") dropped: never "· ·". */
  const dots = (parts) => parts.filter(Boolean).flatMap((p) => String(p).split('·')).map((p) => p.trim()).filter(Boolean).join(' · ');
  function taskLine(x, env) {
    const s = env.status(x);
    return `<li data-mkl-item="${esc(x.id)}" role="button" tabindex="0"><b>${esc(short(x.day))}</b> · ${esc(dots([taskWhat(x, s)]))} · ${badgeMini(s)}</li>`;
  }

  /* ---------- content record (one Short: format, purpose, every use with its own status and time) ---------- */

  const USE_LABEL = { youtube: 'YouTube release', email: 'Squarespace email module', social: 'Associated with an existing post', facebook: 'Facebook (native)', instagram: 'Instagram (native)', linkedin: 'LinkedIn (native)' };
  const PLACEMENT_LABEL = { facebook_feed: 'Facebook feed', instagram_feed: 'Instagram feed', instagram_story: 'Instagram Story', linkedin_feed: 'LinkedIn' };
  const cap1 = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : '');
  const useTime = (u) => (u.planned_at ? stamp(u.planned_at) : (u.planned_on ? `${short(u.planned_on)} · time not set` : 'time not set'));
  function associatedDetail(u) {
    const where = (u.placements || []).map((p) => PLACEMENT_LABEL[p] || p).join(' · ') || 'placement not found';
    return `${esc(u.title || u.step_key || u.ref || '')}<small>${esc(where)} · associated asset, no extra post</small>${u.note ? `<small>${esc(u.note)}</small>` : ''}`;
  }
  function youtubeDetail(u) {
    const link = u.link ? `<a href="${esc(u.link)}" target="_blank" rel="noopener">Open on YouTube</a>` : esc(u.ref || '');
    return `${link}${u.evidence ? `<small>evidence: ${esc(u.evidence)}</small>` : ''}${u.utm ? `<small>UTM ${esc(u.utm)}</small>` : ''}`;
  }
  /** A native post using the video: the post's title, its placement and its own platform link (never the YouTube link). */
  const PLATFORM_LINK = { facebook: 'Open in Meta', instagram: 'Open in Meta', linkedin: 'Open on LinkedIn' };
  function nativeDetail(u) {
    const where = (u.placements || []).map((p) => PLACEMENT_LABEL[p] || p).join(' · ') || 'placement not found';
    const own = u.link && !/youtu\.?be/i.test(u.link) ? u.link : null;
    const link = own ? ` · <a href="${esc(own)}" target="_blank" rel="noopener">${PLATFORM_LINK[u.channel] || 'Open post'}</a>` : '';
    return `${esc(u.title || u.step_key || u.ref || '')}<small>${esc(where)}${link}</small>${u.note ? `<small>${esc(u.note)}</small>` : ''}`;
  }
  const isNativePost = (u) => !!PLATFORM_LINK[u.channel] && !!(u.step_key || u.placement);
  function useDetail(u) {
    if (u.channel === 'email') return `${esc(u.title || u.campaign_key || '')}<small>module <b>${esc(u.module_state || 'proposed')}</b> · ${esc(u.campaign_key || '')}</small>`;
    if (u.channel === 'social') return associatedDetail(u);
    return isNativePost(u) ? nativeDetail(u) : youtubeDetail(u);
  }
  function useRow(u) {
    const s = norm(u.status?.code ? u.status : { code: 'in_preparation' });
    return `<tr data-mkl-use="${esc(u.use_key)}"><td>${esc(USE_LABEL[u.channel] || u.channel)}</td><td>${badge(s)}${s.blocker ? `<small>${esc(s.blocker)}</small>` : ''}</td><td>${esc(useTime(u))}</td><td>${useDetail(u)}</td></tr>`;
  }
  function providerLine(p) {
    if (!p) return 'not read from YouTube yet';
    const parts = [p.privacy && `privacy ${p.privacy}`, p.publish_at && `publish ${stamp(p.publish_at)}`, p.upload_status && `upload ${p.upload_status}`, p.processing_status && `processing ${p.processing_status}`, p.read_at && `read ${stamp(p.read_at)}`];
    return `${dots(parts)}${p.error ? ` · last read failed: ${p.error}` : ''}`;
  }
  /** c = board content[] record (lib/marketing/delivery-content.mjs). Read-only. */
  function contentHtml(c) {
    const s = norm(c.status?.code ? c.status : { code: 'in_preparation' });
    const native = (c.uses || []).some((u) => ['facebook', 'instagram', 'linkedin'].includes(u.channel)) ? '' : '<p class="mks-dim">Native Facebook / Instagram / LinkedIn uses: none planned or approved yet.</p>';
    const kv = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
    const rows = kv('Format', esc(c.format_label || c.format)) + kv('Purpose', `${esc(cap1(c.purpose) || 'not set')}${c.purpose_source ? `<small>source: ${esc(c.purpose_source)}</small>` : ''}`)
      + kv('Length', esc(c.duration || '')) + kv('Video', c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : '') + kv('YouTube status', `${badge(s)}<small>${esc(providerLine(c.provider))}</small>`);
    return `<div class="mks-pitem mkl-content s-${c.status?.code === 'published' ? 'done' : 'sch'}"><div class="mks-ph"><span class="mks-ic">${YT_ICON}</span><b>${esc(c.title)}</b></div><div class="mks-pstate">Content record · one video, every place it is used, each with its own status</div>`
      + `<table class="mks-kv">${rows}</table><h5>Uses (${(c.uses || []).length})</h5><table class="mkl-uses"><tr><th>Use</th><th>Status</th><th>Time</th><th>Detail</th></tr>${(c.uses || []).map(useRow).join('')}</table>${native}</div>`;
  }
  /** M's board tasks with no schedule item: Meta-window scheduling dates and each Story on its day (Facebook / Instagram). */
  const BOARD_TASK = new Set(['meta_window', 'story_publish']);
  const boardTasks = (board, opts) => (board?.tasks || []).filter((t) => BOARD_TASK.has(t.type) && t.day >= opts.range.from && t.day <= opts.range.to && ['all', 'facebook', 'instagram'].includes(opts.channel));
  function boardTaskLine(t) {
    const links = [t.png && `<a href="${esc(t.png)}" target="_blank" rel="noopener">Story PNG</a>`, t.type === 'story_publish' && t.link && `<a href="${esc(t.link)}" target="_blank" rel="noopener">Link</a>`].filter(Boolean).join(' · ');
    return `<li><b>${esc(short(t.day))}</b> · ${esc(t.title)} · owner ${esc(t.owner || 'GPT')}${links ? ` · ${links}` : ''} · ${badgeMini(norm(t.status))}</li>`;
  }
  function tasksHtml(m, opts, env) {
    const { from, to } = opts.range;
    const xs = m.items.filter((x) => isTask(x) && x.day >= from && x.day <= to && x.state !== 'resolved' && matchChannel(x, opts.channel)).sort((a, b) => a.day.localeCompare(b.day));
    const offers = opts.channel === 'all' ? Object.values(m.s?.campaign?.overrides || {}).filter((o) => o.offer_code && o.offer_ends && String(o.offer_ends).slice(0, 10) >= from && String(o.offer_ends).slice(0, 10) <= to) : [];
    const dated = [...xs.map((x) => [x.day, taskLine(x, env)]), ...boardTasks(env.board, opts).map((t) => [t.day, boardTaskLine(t)]), ...offers.map((o) => [String(o.offer_ends).slice(0, 10), `<li><b>${esc(short(String(o.offer_ends).slice(0, 10)))}</b> · ${esc(o.offer_code)} offer ends</li>`])];
    const lines = dated.sort((a, b) => a[0].localeCompare(b[0])).map((d) => d[1]);
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
  /** "648 client recipients + 5 business copies = 653 credits" beside the current cycle's commitments (lib/marketing-delivery.js). */
  function creditsLine(c, d) {
    if (c.side !== 'current' || typeof window.mkCapacity !== 'function' || typeof window.mkCreditsLabel !== 'function') return '';
    const split = window.mkCapacity(d, null)?.credit_split;
    return split ? `<p class="mks-dim mkl-credits">Committed: ${esc(window.mkCreditsLabel(split))}</p>` : '';
  }
  function budgetHtml(c, d) {
    const pct = (v) => Math.max(0, Math.min(100, (v / (c.cap || 1)) * 100)).toFixed(1);
    const afterUsed = c.cap - c.used;
    const afterCommitted = afterUsed - c.committed;
    const afterDrafts = afterCommitted - c.drafts;
    const seg = (v, k, l) => (v > 0 ? `<div class="${k}" style="width:${pct(v)}%" title="${esc(l)}">${pct(v) >= 9 ? esc(l) : ''}</div>` : '');
    return `<div class="mkl-budget"><div class="mks-bar">${seg(c.used, 'mks-used', `${n(c.used)} used`)}${seg(c.committed, 'mks-booked', `${n(c.committed)} committed`)}${seg(c.drafts, 'mkl-draftseg', `${n(c.drafts)} drafts`)}${seg(Math.max(0, afterDrafts), 'mks-free', `${n(afterDrafts)} left`)}</div>`
      + `<div class="mkl-kv"><span>Cap <b>${n(c.cap)}</b></span><span>Actual used <b>${n(c.used)}</b> → left ${n(afterUsed)}</span><span>Confirmed commitments (platform-scheduled) <b>${n(c.committed)}</b> → left ${n(afterCommitted)}</span><span>Draft estimates <b>${n(c.drafts)}</b> → left ${n(afterDrafts)}</span></div>`
      + `${creditsLine(c, d)}<p class="mks-dim">Each Squarespace send counts once (people + 1 business copy). LinkedIn newsletter editions never use Squarespace credits.</p></div>`;
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
    if (dl.status?.code) return norm(dl.status);
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
  const stateNote = (s) => s.blocker || s.when || (s.code === 'scheduled' ? `Squarespace confirmed${s.evidence ? ` · ${s.evidence}` : ''}` : '');
  function sendMore(dl, m, exp, day) {
    const a = dl.aud || {};
    return `<div class="mkl-more">${dl.estimate?.rule ? `<p>Criteria: ${esc(dl.estimate.rule)}</p>` : ''}<p>People ${n(a.people)} · business copy ${n(a.business_copy)} · owner addresses ${n(a.owner_addresses)} · organisations ${a.organisations == null ? 'not split out' : n(a.organisations)} · exclusions: ${esc(exclusionsOf(exp))}</p><p>${esc(overlapLine(m, day))}</p></div>`;
  }
  function sendRow(dl, m, d, opts = {}) {
    const ref = { row: 'email', record_key: dl.key };
    const s = sendState(dl);
    const exp = exportOf(d, dl);
    const day = dl.send_at ? ukDay(dl.send_at) : dl.send_day;
    const when = `${short(day)}${dl.send_at ? ` · ${time12(dl.send_at)}` : ''} · ${cohortOf(dl, exp)}`;
    return `<details class="mkl-send"><summary><span class="mkl-c"><b>${esc(dl.title)}</b><small>${esc(when)}</small>${subjectHtml(dl.sent?.subject || dl.provider?.subject, dl.title)}${shortChips(ref, opts.board)}${promoChip(ref, opts.promotions, opts.board)}</span><span class="mkl-s">${badge(s)}<small>${esc(stateNote(s))}</small></span>`
      + `<span class="mkl-w">${esc(sendsText(dl.aud || {}))}${sinceFrozen(dl.aud)}<small>${esc(audienceState(exp))} · content ${esc(dl.record_stage)}</small><small>${esc(creditsOf(dl))}</small></span></summary>${sendMore(dl, m, exp, day)}</details>`;
  }
  function emailViewHtml(m, d, opts) {
    const cap = d?.meter?.capacity;
    const c = cycleOf(cap, opts.cycle);
    if (!c) return '<p class="mks-dim">No Squarespace meter reading yet.</p>';
    const sends = (d.meter.deliveries || []).filter((x) => !x.cancelled && x.bucket !== 'released' && (x.side === c.side || (c.side === 'current' && x.side === 'unallocated'))).sort((a, b) => String(a.send_at || a.send_day).localeCompare(String(b.send_at || b.send_day)));
    const tabs = ['current', 'next'].map((k) => `<button type="button" class="mks-tab${opts.cycle === k ? ' on' : ''}" data-mkl-cycle="${k}" aria-pressed="${opts.cycle === k}">${esc(cycleOf(cap, k).label)}</button>`).join('');
    return `<div class="mkl-email"><div class="mks-tabs"><span class="mks-group">${tabs}</span></div>${budgetHtml(c, d)}<div class="mkl-sends">${sends.map((x) => sendRow(x, m, d, opts)).join('') || '<p class="mks-dim">No Squarespace sends in this cycle.</p>'}</div>`
      + `<p class="mks-dim mkl-promos">${promotionsLine(opts.promotions, opts.board)}</p></div>`;
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
  .mkl-frozen { display: block; color: #8b93a3; font-size: 11px; margin-top: 1px; }
  .mkl-block .mkl-c { background: #111724; border: 1px solid #263045; border-radius: 8px; padding: 6px 10px; } .mkl-block ul { margin: 4px 0 0; padding-left: 18px; color: #d6dbe4; font-size: 12px; } .mkl-block li { cursor: pointer; margin: 2px 0; } .mkl-block li:hover { color: #fff; text-decoration: underline; }
  .mkl-st { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; font-size: 13px; } .mkl-st i { font-style: normal; }
  .mkl-st.mini { font-size: 10.5px; font-weight: 600; gap: 3px; } .mks-card .mkl-st.mini { display: inline-flex; margin-top: 2px; }
  .mkl-ok { color: #5fd38d; } .mkl-sch { color: #6ea8fe; } .mkl-amb { color: #fbbf24; } .mkl-prep { color: #aab2c0; } .mkl-chk { color: #cbd5e1; } .mkl-late { color: #f87171; }
  .mkl-tasks { margin-top: 10px; border: 1px solid #263045; border-radius: 10px; padding: 8px 14px; background: #151c2b; } .mkl-tasks h4 { margin: 0 0 4px !important; color: #fff; font-size: 13px; }
  .mkl-tasks ul { margin: 0; padding-left: 18px; font-size: 12.5px; color: #d6dbe4; } .mkl-tasks li { margin: 2px 0; cursor: pointer; } .mkl-tasks li::marker { color: #f0b429; } .mkl-tasks a { color: #8ab4f8; }
  .mkl-empty { padding: 12px; }
  .mkl-budget { border: 1px solid #263045; border-radius: 10px; padding: 8px 12px; background: #151c2b; margin: 6px 0; } .mkl-draftseg { background: #a78bfa; }
  .mkl-budget p, .mkl-email > p { font-size: 12px; margin: 4px 0 0; }
  .mkl-kv { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #cbd5e1; } .mkl-kv b { color: #fff; }
  .mkl-send { border: 1px solid #263045; border-radius: 8px; margin: 6px 0; background: #111724; } .mkl-send > summary { display: grid; grid-template-columns: minmax(0, 1fr) 220px 290px; gap: 10px; padding: 8px 12px; cursor: pointer; list-style: none; }
  .mkl-more { padding: 0 12px 8px; font-size: 12px; color: #cbd5e1; } .mkl-more p { margin: 3px 0; }
  .mks-layout { display: inline-flex; gap: 4px; } .mks-filter { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px; } .mks-filter .mks-axl { margin-right: 4px; }
  #mk-schedule .mks-headrow { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; } .mkl-legend { margin: 2px 0 4px; } .mkl-legend .mkl-st { font-size: 12px; }
  .mks-refresh { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #8b93a3; margin-left: auto; }
  .mkl-ic { display: inline-flex; vertical-align: -3px; margin-right: 4px; } .mkl-ic svg, .mkl-content .mks-ic svg { width: 14px; height: 14px; }
  .mkl-yts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 3px; }
  .mkl-yt { display: inline-block; border: 1px solid #7f1d1d; background: #2a1215; color: #fecaca; border-radius: 999px; padding: 0 8px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; } .mkl-yt:hover { border-color: #ff0033; color: #fff; }
  .mkl-ytc { font-size: 11px; font-weight: 700; }
  .mkl-llm { display: inline-block; border: 1px solid #1e5a73; background: #0f2530; color: #bae6fd; border-radius: 999px; padding: 0 8px; font-size: 11px; font-weight: 600; margin-top: 3px; white-space: nowrap; }
  .mkl-c small.mkl-promo { color: #7dd3fc; } .mkl-c small.mkl-subj, .mkl-block small.mkl-subj { color: #a5b4c8; font-style: italic; display: block; }
  .mks-card .mkl-yts { width: 100%; gap: 3px; } .mks-card .mkl-yt { white-space: normal; max-width: 100%; overflow-wrap: anywhere; font-size: 10.5px; border-radius: 6px; } .mks-card .mkl-ytc { font-size: 10.5px; }
  .mkl-uses { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; } .mkl-uses th { text-align: left; color: #8b93a3; font-weight: 400; padding: 3px 4px; border-bottom: 1px solid #263045; }
  .mkl-uses td { padding: 4px; border-bottom: 1px dashed #263045; vertical-align: top; color: #e5e7eb; } .mkl-uses td:last-child { overflow-wrap: anywhere; } .mkl-uses small, .mkl-content .mks-kv small { display: block; color: #8b93a3; font-size: 11px; } .mkl-uses a { color: #93c5fd; }
  .mkl-content h5 { margin: 10px 0 2px; color: #fff; font-size: 12.5px; }
  `;
  if (typeof document !== 'undefined' && document.head && !document.getElementById('mkl-style')) {
    const st = document.createElement('style');
    st.id = 'mkl-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  window.mkScheduleList = { statusOf, badge, badgeMini, listHtml, tasksHtml, emailViewHtml, matchChannel, rangeOf, CHANNELS, RANGES, VOCAB, isLightLogic, isGbpReview, shortChips, contentHtml, YT_ICON, combinePlacements, holdFor, perPlacement };
})();
