/**
 * Marketing & Campaigns → "1 · Waiting on you (n)": exactly the shared decision state's open list
 * (GET /api/aigeo/marketing-decisions → lib/marketing/decision-state.mjs), the same list Strategy's "Needs Alan" counts.
 * Recorded decisions close everywhere: the overall plan approval, kept-blocked contacts, deferred items and published
 * placements are never asked again; a release approval only appears when caption, rendered artwork and booking URL
 * are ready (otherwise the post is on GPT's production queue, Behind the scenes). Read-only.
 * Buttons reuse existing paths: data-mks-item(s) opens the schedule side panel (same Done / Skip / Move / stage
 * writes), data-mkw-review opens the review-first panel (window.mkOpenSocialReview), data-mkw-go opens a fold.
 * The schedule model's warnings about planned emails (duplicates, frequency, no platform evidence, allowance) are
 * schedule checks: shown above the schedule in Planned, not decisions. Items listed here and done items (Results)
 * are hidden from the schedule cards, so each item shows in one section only. While loading: a skeleton, never an
 * empty table that looks final.
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
  const CH = { email: ['Email', 'e'], fbig: ['FB + IG', 'f'], linkedin: ['LinkedIn', 'l'], outlook: ['Outlook', 'o'], gbp: ['Google', 'g'], all: ['All', 'a'], none: ['—', 'a'] };
  const chip = (ch) => (!CH[ch] || ch === 'all' || ch === 'none' ? `<span class="mkw-dim">${CH[ch]?.[0] || '—'}</span>` : `<span class="mkw-ch mkw-ch-${CH[ch][1]}">${esc(CH[ch][0])}</span>`);
  const KEYISH = /\b(email|event|theme|step|plan)\|[^\s,)]+/g;
  const clean = (t) => String(t || '').replace(KEYISH, 'a campaign').replace(/utm_\w+=\S+/g, '').trim();
  const state = { host: null, d: null, s: null, dec: null, error: null, moved: new Set(), loadingPlan: false };

  /* ---------- rows from the shared state ---------- */

  function model(d, s) {
    const M = window.mkScheduleModel;
    if (!M || !s || typeof window.mkDeliveryItems !== 'function') return null;
    const cap = typeof window.mkCapacity === 'function' ? window.mkCapacity(d, s) : null;
    return M.build({ items: window.mkDeliveryItems(d, s), d, s, cap });
  }
  const itemOf = (m, stepKey) => (stepKey && m ? m.items.find((x) => x.step_key === stepKey && x.state !== 'resolved') || null : null);
  const btn = (attrs, label) => `<button type="button" class="rf-btn rf-btn-secondary mkw-btn" ${attrs}>${esc(label)}</button>`;
  const draftIds = (m) => (m ? m.items.filter((x) => x.draft && x.day && x.day >= todayIso()).map((x) => x.id).join(',') : '');
  const BUTTON = {
    plan_approval: (o, m) => btn(`data-mks-items="${esc(draftIds(m))}"`, 'Review'),
    release_approval: (o, m) => btn(`data-mkw-review="${esc(o.step_key)}"${itemOf(m, o.step_key) ? ` data-mks-item="${esc(itemOf(m, o.step_key).id)}"` : ''}`, 'Review'),
    outlook_note: (o, m) => (itemOf(m, o.step_key) ? btn(`data-mks-item="${esc(itemOf(m, o.step_key).id)}"`, 'Open · Done') : btn('data-mkw-go="mk-campaign-host"', 'Open')),
    blocked_review: () => btn('data-mkw-go="mk-review"', 'Review'),
    quarter_action: () => btn('data-mkw-go="mk-campaign-host"', 'Open'),
    campaign_approval: () => btn('data-mkw-go="mk-campaign-host"', 'Approve')
  };
  const dueText = (o) => (o.due ? `${o.due === todayIso() ? 'Today' : ukDay(o.due)}${o.late ? ' · late' : ''}` : 'Now');
  /** An Outlook note reads its live title from the schedule (the stored step text can be an older register copy). */
  const whatOf = (o, m) => clean(o.type === 'outlook_note' && itemOf(m, o.step_key) ? itemOf(m, o.step_key).short : o.what);
  function rowsFor(dec, m) {
    const rows = (dec?.open || []).map((o) => ({ due: dueText(o), what: whatOf(o, m), ch: o.channel, why: o.why, btn: (BUTTON[o.type] || (() => ''))(o, m), id: itemOf(m, o.step_key)?.id || null }));
    return { rows, moved: new Set(rows.map((r) => r.id).filter(Boolean)) };
  }

  /* ---------- schedule checks (Planned) ---------- */

  const WARN = [/same email/, /emails in 7 days/, /no platform evidence/, /over the allowance/];
  function checksHtml(m) {
    const list = (m?.needs || []).filter((x) => WARN.some((re) => re.test(x.text)));
    if (!list.length) return '';
    return `<div class="mkw-checks"><b>Schedule checks (${list.length})</b><ul>${list.map((x) => `<li class="${x.level === 'red' ? 'mkw-red' : ''}"><a href="#" role="button" data-mks-items="${esc((x.ids || []).join(','))}">${esc(clean(x.text))}</a></li>`).join('')}</ul></div>`;
  }
  function paintPlanned(m) {
    const planned = document.getElementById('mk-planned');
    const sch = document.getElementById('mk-schedule');
    if (!planned || !sch) return;
    let box = document.getElementById('mkw-planned-extra');
    if (!box) { box = document.createElement('div'); box.id = 'mkw-planned-extra'; sch.parentNode.insertBefore(box, sch); }
    box.innerHTML = state.loadingPlan ? '<div class="mkw-loadbar">Loading the week plan… <span class="mkw-dim">(the schedule fills in when it arrives)</span></div>' : checksHtml(m);
    planned.classList.toggle('mkw-loading', state.loadingPlan);
  }

  /** GPT's production queue (Behind the scenes): posts due soon that are not ready for Alan's approval yet. */
  function paintProduction(dec) {
    const body = document.getElementById('mk-behind-body');
    if (!body || !dec) return;
    let box = document.getElementById('mkw-production');
    if (!box) { box = document.createElement('div'); box.id = 'mkw-production'; box.className = 'rt-section'; body.prepend(box); }
    const list = (dec.production_queue || []).map((p) => `<li><b>${esc(ukDay(p.due))}</b> ${esc(clean(p.title))} · missing: ${esc(p.blockers.join(', '))}</li>`).join('');
    box.innerHTML = `<h3>GPT's production queue</h3><div class="mkw-sub">Posts due by tomorrow that are not ready for approval yet (GPT / Cursor finish them; Alan is asked only when caption, artwork and link are ready).</div><ul class="mks-rules">${list || '<li class="mkw-dim">Nothing in production.</li>'}</ul>`;
  }

  /* ---------- paint ---------- */

  const SKELETON = `<tr class="mkw-skel">${'<td><span></span></td>'.repeat(5)}</tr>`.repeat(3);
  const tableHtml = (body) => `<div class="mkw-wrap"><table class="rt-table mkw-table"><thead><tr><th>Due</th><th class="left">What</th><th>Channel</th><th class="left">Why it's waiting</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  const rowHtml = (r) => `<tr><td class="mkw-due">${esc(r.due)}</td><td class="left"><b>${esc(r.what)}</b></td><td>${chip(r.ch)}</td><td class="left mkw-why">${esc(r.why)}</td><td class="mkw-act">${r.btn}</td></tr>`;
  function paint() {
    if (!state.host?.isConnected) return;
    const m = model(state.d, state.s);
    paintPlanned(m);
    const head = '<h3 class="mk-sec-h">1 · Waiting on you';
    if (state.error) { state.host.innerHTML = `${head}</h3><div class="rt-error">Decisions unavailable: ${esc(state.error)}</div>`; return; }
    if (!state.dec) { state.host.innerHTML = `${head} <span class="mkw-n mkw-dim">…</span></h3><div class="mkw-sub">Loading…</div>${tableHtml(SKELETON)}`; return; }
    const { rows, moved } = rowsFor(state.dec, m);
    state.moved = moved;
    paintProduction(state.dec);
    const body = rows.map(rowHtml).join('') || '<tr><td colspan="5" class="mkw-dim">Nothing is waiting on you.</td></tr>';
    state.host.innerHTML = `${head} <span class="mkw-n">${rows.length}</span></h3><div class="mkw-sub">Only things you have to do. Nothing else appears here.</div>${tableHtml(body)}`;
    hideMoved();
  }

  /* ---------- one section per item: hide listed / done cards in the schedule ---------- */

  function hideMoved() {
    const sch = document.getElementById('mk-schedule');
    if (!sch) return;
    sch.querySelectorAll('[data-mks-item]').forEach((el) => el.classList.toggle('mkw-moved', state.moved.has(el.dataset.mksItem)));
    sch.querySelectorAll('[data-mks-items]').forEach((el) => el.classList.toggle('mkw-moved', el.dataset.mksItems.split(',').every((id) => state.moved.has(id))));
  }
  function watchSchedule() {
    const sch = document.getElementById('mk-schedule');
    if (!sch || sch.dataset.mkwWatch) return;
    sch.dataset.mkwWatch = '1';
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(paint, 150); }).observe(sch, { childList: true, subtree: true });
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

  async function loadDecisions() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/marketing-decisions?propertyUrl=${encodeURIComponent(PROP)}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `status ${r.status}`);
    return j;
  }
  const refresh = () => loadDecisions().then((dec) => { state.dec = dec; state.error = null; window.mkDecisionState = dec; }, (e) => { state.error = e.message; }).then(paint);
  /** After Done / Skip / Move / stage (board repaint): same records re-read, so a closed decision leaves at once. */
  document.addEventListener('st-steps-repainted', () => {
    if (!state.host?.isConnected) return;
    state.s = (window.stLastData && window.stLastData()) || state.s;
    refresh();
  });

  window.mkMountWaiting = function mkMountWaiting(host, d, strategy) {
    if (!host) return;
    Object.assign(state, { host, d, s: null, dec: null, error: null, loadingPlan: true });
    paint();
    watchSchedule();
    Promise.resolve(strategy).then((s) => { state.s = s || null; }, () => { state.s = null; }).then(() => { state.loadingPlan = false; paint(); });
    refresh();
  };
  window.mkWaitingRows = rowsFor;

  const CSS = `
  #mk-waiting .mk-sec-h, #mk-planned .mk-sec-h, #mk-results .mk-sec-h { margin: 0 0 2px; font-size: 1.15rem; color: #fff; display: flex; align-items: center; gap: 8px; }
  .mkw-n { background: #3b2f0b; color: #fbbf24; border-radius: 10px; padding: 0 8px; font-size: 0.8rem; }
  .mkw-sub { color: #94a3b8; font-size: 0.8rem; margin-bottom: 8px; }
  .mkw-wrap { border: 1px solid #263045; border-radius: 10px; overflow-x: auto; background: #111827; }
  .mkw-table { width: 100%; margin: 0 !important; } .mkw-table th { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; color: #94a3b8; }
  .mkw-table td { vertical-align: middle; } .mkw-due { white-space: nowrap; color: #d6dbe4; } .mkw-why { color: #cbd5e1; } .mkw-act { text-align: right; white-space: nowrap; }
  .mkw-dim { color: #94a3b8; } .mkw-btn { padding: 2px 10px !important; font-size: 0.8rem !important; } .mkw-red { color: #fca5a5; }
  .mkw-ch { display: inline-block; border-radius: 4px; padding: 1px 7px; font-size: 0.72rem; font-weight: 600; color: #0b1118; margin-right: 3px; }
  .mkw-ch-e { background: #f0a500; } .mkw-ch-f { background: #4f7df3; color: #fff; } .mkw-ch-i { background: #e0569b; color: #fff; } .mkw-ch-s { background: #c2418a; color: #fff; }
  .mkw-ch-l { background: #2aa3c9; } .mkw-ch-o { background: #9b7bf0; color: #fff; } .mkw-ch-g { background: #3fbf74; }
  .mkw-skel td span { display: block; height: 10px; border-radius: 4px; background: linear-gradient(90deg, #1f2937 25%, #2b3648 50%, #1f2937 75%); background-size: 200% 100%; animation: mkw-sh 1.2s infinite; }
  @keyframes mkw-sh { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .mkw-loadbar { margin: 6px 0 8px; padding: 8px 12px; border: 1px dashed #334155; border-radius: 8px; color: #d6dbe4; font-size: 0.85rem; }
  #mk-planned.mkw-loading #mk-schedule .mks-body { opacity: 0.35; pointer-events: none; }
  .mkw-checks { margin: 6px 0 8px; padding: 8px 12px; border-left: 4px solid #f0b429; background: #151c2b; border-radius: 8px; font-size: 0.85rem; }
  .mkw-checks ul { margin: 4px 0 0; padding-left: 18px; } .mkw-checks a { color: #d6dbe4; text-decoration: none; } .mkw-checks a:hover { color: #fde68a; text-decoration: underline; }
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
