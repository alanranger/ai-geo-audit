/**
 * Marketing & Campaigns → "1 · Waiting on you (n)": only actions Alan himself must do (mock-up marketing-clean-v1).
 * Read-only; built from what already exists, no new status model:
 *  - the "Needs Alan" decision queue of tile 7 (window.mkNeedsAlanQueue in lib/marketing-overview-tiles.js: campaign
 *    decisions, list-load risk, clean-up approval, blocked contacts) and Alan-owned quarter actions due within 7 days
 *    or late (quarter_plan.action_owner; GPT / Claude / Cursor-owned actions never appear);
 *  - the schedule model's Needs-you lines (window.mkScheduleModel), merged here so the schedule's own box is hidden;
 *  - due by tomorrow or late: social posts with GPT's stored public caption ("Approve caption & artwork": GPT
 *    publishes, Alan approves; Review opens window.mkOpenSocialReview, caption + image first) and Outlook notes;
 *  - GPT's drafts as ONE "Approve GPT's plan" row (they stay on the schedule as planned drafts).
 * Superseded / cancelled / "not needed" items are resolved in the model and never listed. Each button reuses an
 * existing path: data-mks-item(s) opens the schedule side panel (Done / Skip / Move / caption / stage, same writes);
 * data-mkw-go opens the fold that holds the decision. Hands-on items listed here are hidden from the schedule cards,
 * and done cards are hidden there too (they are in Results), so each item shows in one section only.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const LONDON = 'Europe/London';
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: LONDON });
  const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
  const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  const CH = { email: ['Email', 'e'], fbig: ['FB + IG', 'f'], linkedin: ['LinkedIn', 'l'], outlook: ['Outlook', 'o'], gbp: ['Google', 'g'], all: ['All', 'a'], none: ['—', 'a'] };
  const chip = (ch) => (ch === 'all' || ch === 'none' ? `<span class="mkw-dim">${CH[ch][0]}</span>` : `<span class="mkw-ch mkw-ch-${CH[ch][1]}">${esc(CH[ch][0])}</span>`);
  const KEYISH = /\b(email|event|theme|step|plan)\|[^\s,)]+/g;
  const clean = (t) => String(t || '').replace(KEYISH, 'a campaign').replace(/utm_\w+=\S+/g, '').trim();
  const state = { host: null, d: null, s: null, moved: new Set() };

  /* ---------- sources ---------- */

  function model(d, s) {
    const M = window.mkScheduleModel;
    if (!M || typeof window.mkDeliveryItems !== 'function') return null;
    const cap = typeof window.mkCapacity === 'function' ? window.mkCapacity(d, s) : null;
    return M.build({ items: window.mkDeliveryItems(d, s), d, s, cap });
  }
  const timeOf = (x) => (String(x.time || '').match(/\d{2}:\d{2}/) || [''])[0];
  const dueOf = (x, today) => (x.state === 'late' ? `${ukDay(x.day)} · late` : `${x.day === today ? 'Today' : ukDay(x.day)}${timeOf(x) ? ` ${timeOf(x)}` : ''}`);
  const openBtn = (x, label) => `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mks-item="${esc(x.id)}">${esc(label)}</button>`;

  /**
   * A social post due by tomorrow whose public caption GPT has stored: GPT publishes, Alan approves the caption and
   * artwork. State from the stored caption only (window.mkSocialReviewState, lib/marketing-schedule.js), never the
   * production brief; no stored caption yet = still GPT's job, not listed. Review opens the review-first panel.
   */
  function socialRow(x, today) {
    const st = typeof window.mkSocialReviewState === 'function' ? window.mkSocialReviewState(x.step_key) : null;
    if (!st?.public_caption) return null;
    const why = st.ready ? 'Caption & artwork ready · GPT posts after you approve' : `Caption ready · missing: ${st.blockers[0] || 'a check'}`;
    return {
      sort: x.day, id: x.id, due: dueOf(x, today), what: `Approve caption & artwork: ${x.short}`, ch: x.row, why: x.state === 'late' ? `Late · ${why}` : why,
      btn: `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mkw-review="${esc(x.step_key)}" data-mks-item="${esc(x.id)}">Review</button>`
    };
  }
  /** Social posts to approve and Outlook notes, due by tomorrow or late. */
  function handsOn(m, today) {
    const end = addDays(today, 1);
    const due = m.items.filter((x) => ['linkedin', 'fbig', 'outlook'].includes(x.row) && ['late', 'pl', 'warn'].includes(x.state) && x.day && x.day <= end);
    return due.map((x) => (x.row === 'outlook'
      ? { sort: x.day, id: x.id, due: dueOf(x, today), what: x.short, ch: 'outlook', why: 'Personal note · approve and send', btn: openBtn(x, 'Open · Done') }
      : socialRow(x, today))).filter(Boolean);
  }

  /** GPT's drafts still to approve: one row; Review opens them all in the schedule side panel. */
  function approveRow(m, moved, today) {
    const drafts = m.items.filter((x) => x.draft && x.state !== 'resolved' && x.day && x.day >= today && !moved.has(x.id));
    if (!drafts.length) return null;
    const emails = drafts.filter((x) => x.row === 'email').length;
    const last = drafts.map((x) => x.day).sort().slice(-1)[0];
    const weeks = Math.max(1, Math.ceil((Date.parse(last) - Date.parse(today) + 864e5) / (7 * 864e5)));
    const ids = drafts.map((x) => x.id).join(',');
    return { sort: '0', due: 'This week', what: `Approve GPT's ${weeks}-week plan (${emails} email${emails === 1 ? '' : 's'} · ${drafts.length - emails} post${drafts.length - emails === 1 ? '' : 's'})`, ch: 'all', why: 'Drafts ready · nothing goes out until you approve', btn: `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mks-items="${esc(ids)}">Review</button>` };
  }

  /** "Choose the audience … <day>" only while a live (not superseded / cancelled) weekly email sits on that day. */
  const AUDIENCE = /choose (the|its) audience/i;
  const liveAudience = (m, text) => !AUDIENCE.test(text) || m.items.some((x) => x.row === 'email' && x.state !== 'resolved' && x.state !== 'done' && x.day && text.includes(ukDay(x.day)));
  const NEED_WHY = [[/same email/, 'Possible duplicate'], [/emails in 7 days/, 'Too many emails per person'], [/no platform evidence/, 'Not confirmed in Squarespace'], [/choose its audience/, 'Audience not chosen'], [/over the allowance/, 'Over the email allowance'], [/not matched|unmatched/, 'Not linked to a campaign']];
  const whyOf = (t) => (NEED_WHY.find(([re]) => re.test(t)) || [null, 'Check and decide'])[1];
  /** The schedule's Needs-you lines, except "N late" (hands-on late items are listed one by one above). */
  function needRows(m, hasAudienceDecision) {
    return (m.needs || []).filter((x) => !/^\d+ late \(/.test(x.text) && !(hasAudienceDecision && AUDIENCE.test(x.text)) && liveAudience(m, x.text)).map((x) => ({
      sort: '1', due: 'Now', what: clean(x.text), ch: 'email', why: whyOf(x.text),
      btn: x.go || x.link ? `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mkw-go="${esc(x.go || 'mk-budget')}">Review</button>` : `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mks-items="${esc((x.ids || []).join(','))}">Review</button>`
    }));
  }

  const GO = { campaign: 'mk-campaign-host', exports: 'mk-exports', cleanup: 'mk-cleanup', review: 'mk-review', budget: 'mk-budget', segments: 'mk-segments' };
  const goBtn = (go, label) => `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" data-mkw-go="${esc(GO[go] || 'mk-campaign-host')}">${esc(label)}</button>`;
  /** Tile 7's decisions + Alan-owned quarter actions due within 7 days or late (not waiting on a trigger). */
  function queueRows(m, d, s, today) {
    const q = typeof window.mkNeedsAlanQueue === 'function' ? window.mkNeedsAlanQueue(d, s) : { decisions: [], actions: [] };
    const dec = q.decisions.filter((x) => liveAudience(m, x.text)).map((x) => ({ sort: '1', due: 'Now', what: clean(x.text), ch: x.go === 'campaign' ? 'email' : 'none', why: 'Your decision', btn: goBtn(x.go, /^Approve/.test(x.text) ? 'Approve' : 'Review') }));
    const soon = addDays(today, 7);
    const acts = q.actions.filter((a) => a.due_week_start <= soon).map((a) => ({ sort: a.due_week_start, due: a.due_week_start < today ? `${ukDay(a.due_week_start)} · late` : `w/c ${ukDay(a.due_week_start)}`, what: clean(a.label), ch: 'none', why: a.due_week_start < today ? 'Late · quarter action' : 'Quarter action due', btn: goBtn('campaign', 'Open') }));
    return [...dec, ...acts];
  }

  /* ---------- render ---------- */

  function rowsFor(d, s) {
    const today = todayIso();
    const m = s ? model(d, s) : null;
    if (!m) return { rows: [], moved: new Set() };
    const hands = handsOn(m, today);
    const moved = new Set(hands.map((x) => x.id));
    const queue = queueRows(m, d, s, today);
    const rows = [approveRow(m, moved, today), ...hands, ...queue, ...needRows(m, queue.some((x) => AUDIENCE.test(x.what)))].filter(Boolean);
    return { rows: rows.sort((a, b) => String(a.sort).localeCompare(String(b.sort))), moved };
  }
  const rowHtml = (r) => `<tr><td class="mkw-due">${esc(r.due)}</td><td class="left"><b>${esc(r.what)}</b></td><td>${chip(r.ch)}</td><td class="left mkw-why">${esc(r.why)}</td><td class="mkw-act">${r.btn}</td></tr>`;
  function paint() {
    if (!state.host?.isConnected) return;
    const head = '<h3 class="mk-sec-h">1 · Waiting on you';
    if (!state.s) { state.host.innerHTML = `${head}</h3><div class="mkw-sub">Loading…</div>`; return; }
    const { rows, moved } = rowsFor(state.d, state.s);
    state.moved = moved;
    const body = rows.map(rowHtml).join('') || '<tr><td colspan="5" class="mkw-dim">Nothing is waiting on you.</td></tr>';
    state.host.innerHTML = `${head} <span class="mkw-n">${rows.length}</span></h3><div class="mkw-sub">Only things you have to do. Nothing else appears here.</div>`
      + `<div class="mkw-wrap"><table class="rt-table mkw-table"><thead><tr><th>Due</th><th class="left">What</th><th>Channel</th><th class="left">Why it's waiting</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
    hideMoved();
  }

  /* ---------- one section per item: hide moved / done cards in the schedule ---------- */

  function hideMoved() {
    const sch = document.getElementById('mk-schedule');
    if (!sch) return;
    sch.querySelectorAll('[data-mks-item]').forEach((el) => el.classList.toggle('mkw-moved', state.moved.has(el.dataset.mksItem)));
    sch.querySelectorAll('[data-mks-items]').forEach((el) => el.classList.toggle('mkw-moved', el.dataset.mksItems.split(',').every((id) => state.moved.has(id))));
  }
  let observer = null;
  function watchSchedule() {
    const sch = document.getElementById('mk-schedule');
    if (!sch || sch.dataset.mkwWatch) return;
    sch.dataset.mkwWatch = '1';
    let t = null;
    observer = new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 150); });
    observer.observe(sch, { childList: true, subtree: true });
  }

  /** Open every closed fold around an element (the Behind-the-scenes fold holds the older folds), then scroll to it. */
  function openTo(id) {
    const el = document.getElementById(id);
    for (let p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.mkOpenTo = openTo;
  const TILE_GO = { campaign: 'mk-campaign-host', segments: 'mk-segments', budget: 'mk-budget', exports: 'mk-exports', review: 'mk-review', sources: 'mk-sources', cleanup: 'mk-cleanup', customers: 'mk-query', health: 'mk-query' };
  function targetOf(el) {
    if (el.dataset.mkwGo) return el.dataset.mkwGo;
    if (el.dataset.mksOpen) return el.dataset.mksOpen;
    if (el.dataset.mkoGo) return TILE_GO[el.dataset.mkoGo] || null;
    return el.hasAttribute('data-mks-rules') ? 'mk-fold-rules-body' : null;
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mkw-go], [data-mks-open], [data-mko-go], [data-mks-rules]');
    if (!el || !el.closest('#marketing-root')) return;
    const id = targetOf(el);
    if (id) setTimeout(() => openTo(id), 0);
  }, true);
  /** Review on a social row: review-first panel (caption + image first); if the post isn't on the schedule, the normal panel opens. */
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mkw-review]');
    if (el && typeof window.mkOpenSocialReview === 'function' && window.mkOpenSocialReview(el.dataset.mkwReview)) e.stopPropagation();
  }, true);
  document.addEventListener('st-steps-repainted', () => {
    if (!state.host?.isConnected) return;
    state.s = (window.stLastData && window.stLastData()) || state.s;
    paint();
  });

  window.mkMountWaiting = function mkMountWaiting(host, d, strategy) {
    if (!host) return;
    Object.assign(state, { host, d, s: null });
    paint();
    watchSchedule();
    Promise.resolve(strategy).then((s) => { state.s = s || null; }, () => { state.s = null; }).then(paint);
  };
  window.mkWaitingRows = rowsFor;

  const CSS = `
  #mk-waiting .mk-sec-h, #mk-planned .mk-sec-h, #mk-results .mk-sec-h { margin: 0 0 2px; font-size: 1.15rem; color: #fff; display: flex; align-items: center; gap: 8px; }
  .mkw-n { background: #3b2f0b; color: #fbbf24; border-radius: 10px; padding: 0 8px; font-size: 0.8rem; }
  .mkw-sub { color: #94a3b8; font-size: 0.8rem; margin-bottom: 8px; }
  .mkw-wrap { border: 1px solid #263045; border-radius: 10px; overflow-x: auto; background: #111827; }
  .mkw-table { width: 100%; margin: 0 !important; } .mkw-table th { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; color: #94a3b8; }
  .mkw-table td { vertical-align: middle; } .mkw-due { white-space: nowrap; color: #d6dbe4; } .mkw-why { color: #cbd5e1; } .mkw-act { text-align: right; white-space: nowrap; }
  .mkw-dim { color: #94a3b8; } .mkw-btn { padding: 2px 10px !important; font-size: 0.8rem !important; }
  .mkw-ch { display: inline-block; border-radius: 4px; padding: 1px 7px; font-size: 0.72rem; font-weight: 600; color: #0b1118; margin-right: 3px; }
  .mkw-ch-e { background: #f0a500; } .mkw-ch-f { background: #4f7df3; color: #fff; } .mkw-ch-i { background: #e0569b; color: #fff; } .mkw-ch-s { background: #c2418a; color: #fff; }
  .mkw-ch-l { background: #2aa3c9; } .mkw-ch-o { background: #9b7bf0; color: #fff; } .mkw-ch-g { background: #3fbf74; }
  #mk-schedule .mkw-moved, #mk-schedule .mks-card.s-done, #mk-schedule .mks-need { display: none !important; }
  #mk-schedule .mks-top { grid-template-columns: 1fr; }
  #mk-behind > summary { font-size: 0.95rem; }`;
  if (!document.getElementById('mkw-css')) {
    const st = document.createElement('style');
    st.id = 'mkw-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
})();
