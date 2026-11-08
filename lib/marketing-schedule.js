/**
 * Marketing & Campaigns → "Marketing schedule" (approved mock-ups v2, 8 Nov 2026): Needs you, the email allowance bar,
 * a channel legend and one cross-channel schedule with a Days ⇄ Weeks toggle. Cards: title + people + time, status by
 * fill (green done with evidence, blue scheduled in the platform, dashed planned, amber late / needs you). A card opens
 * a side panel with the detail and the SAME controls as the campaign-steps table (window.stStepControls in
 * lib/strategy-board.js; stage chip and pre-send chip for campaign records), so Done / Skip / Move / stage / audience
 * write exactly what they wrote before. Read-only otherwise: the model is lib/marketing-schedule-model.js on the
 * delivery builder's items (lib/marketing-delivery.js). Also: folded sections at the bottom open when an Overview
 * tile points into them, and long explanatory paragraphs move behind an ⓘ (text listed in Rules & data sources).
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const M = () => window.mkScheduleModel;
  const utcDay = (iso) => new Date(`${iso}T12:00:00Z`);
  const wd = (iso) => utcDay(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const dm = (iso) => utcDay(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '') : '');

  /* ---------- channel identity (inline SVG brand marks; colours from the mock-ups) ---------- */

  const svg = (bg, inner) => `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="${bg}"/>${inner}</svg>`;
  const ICON = {
    email: svg('#f0a500', '<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M5.5 8l6.5 5 6.5-5"/></g>'),
    facebook: svg('#4f7df3', '<path fill="#fff" d="M13.2 19v-6h2.1l.3-2.5h-2.4V9c0-.7.2-1.2 1.2-1.2h1.3V5.6c-.2 0-1-.1-1.9-.1-1.9 0-3.1 1.1-3.1 3.2v1.8H8.6V13h2.1v6z"/>'),
    instagram: svg('#e0569b', '<g fill="none" stroke="#fff" stroke-width="1.7"><rect x="6" y="6" width="12" height="12" rx="3.6"/><circle cx="12" cy="12" r="2.9"/></g><circle cx="15.7" cy="8.3" r=".95" fill="#fff"/>'),
    linkedin: svg('#2aa3c9', '<g fill="#fff"><rect x="7" y="10" width="2.3" height="7.2"/><circle cx="8.15" cy="7.5" r="1.35"/><path d="M11 10h2.2v1c.4-.7 1.3-1.2 2.4-1.2 2 0 2.7 1.3 2.7 3.2v4.2h-2.3v-3.8c0-.9-.2-1.7-1.2-1.7s-1.5.7-1.5 1.7v3.8H11z"/></g>'),
    outlook: svg('#9b7bf0', '<path d="M13 8.5h5v7h-5" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M13 9.5l2.5 2 2.5-2" fill="none" stroke="#fff" stroke-width="1.1"/><rect x="5.5" y="6.8" width="8.3" height="10.4" rx="1.2" fill="#fff"/><ellipse cx="9.65" cy="12" rx="2.1" ry="2.6" fill="none" stroke="#9b7bf0" stroke-width="1.5"/>'),
    gbp: svg('#3fbf74', '<path fill="#fff" d="M12.2 10.9v2.4h3.3c-.3 1.4-1.5 2.6-3.3 2.6-2 0-3.6-1.7-3.6-3.8s1.6-3.8 3.6-3.8c.9 0 1.7.3 2.3.9l1.7-1.7C15.2 6.6 13.8 6 12.2 6 8.9 6 6.2 8.7 6.2 12s2.7 6 6 6c3.5 0 5.8-2.4 5.8-5.9 0-.4 0-.8-.1-1.2z"/>')
  };
  const ROW = {
    email: { label: 'Email', sub: 'Squarespace', icons: ['email'], color: '#f0a500' },
    fbig: { label: 'Facebook + Instagram', sub: '', icons: ['facebook', 'instagram'], color: '#4f7df3' },
    linkedin: { label: 'LinkedIn', sub: '', icons: ['linkedin'], color: '#2aa3c9' },
    outlook: { label: 'Outlook', sub: 'personal note', icons: ['outlook'], color: '#9b7bf0' },
    gbp: { label: 'Google Business', sub: 'Viking Local', icons: ['gbp'], color: '#3fbf74' }
  };
  const WEEK_HEAD = { email: 'Email', fbig: 'Facebook + Instagram', linkedin: 'LinkedIn', outlook: 'Outlook note', gbp: 'Google' };
  const icons = (row, cls) => `<span class="${cls || 'mks-ic'}">${ROW[row].icons.map((k) => ICON[k]).join('')}</span>`;
  const LEGEND = [['email', 'Email'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['outlook', 'Outlook note'], ['gbp', 'Google Business']];

  /* ---------- state ---------- */

  const view = { mode: localStorage.getItem('mks-view') === 'weeks' ? 'weeks' : 'days', range: 'this', wrange: '9', panel: null, review: null };
  const ctx = { host: null, d: null, s: null, g: null, x: null, sv: null, error: null, model: null, social: null };

  function buildModel() {
    const items = typeof window.mkDeliveryItems === 'function' ? window.mkDeliveryItems(ctx.d, ctx.s) : [];
    const cap = typeof window.mkCapacity === 'function' ? window.mkCapacity(ctx.d, ctx.s) : null;
    ctx.model = M().build({ items, d: ctx.d, s: ctx.s, cap, g: ctx.g, moments: ctx.x?.moments || [] });
    ctx.social = window.SocialStandard ? window.SocialStandard.context(ctx.s, ctx.sv) : null;
    return ctx.model;
  }
  /* ---------- AR-social-v1 (lib/social-standard/schedule-social.js + social-panel.js) ---------- */

  const SOCIAL_ROWS = new Set(['fbig', 'linkedin']);
  const socialOn = (x) => !!(ctx.social && window.SocialPanel && SOCIAL_ROWS.has(x.row) && x.step_key);
  /** One status chip per placement (FB feed / IG feed / IG Story / LinkedIn), each from its own evidence. */
  const socialChips = (x) => (socialOn(x) ? window.SocialPanel.chips(window.SocialStandard.placementsOf(x, ctx.social)) : '');
  const socialSection = (x) => (socialOn(x) ? window.SocialPanel.html(window.SocialStandard.panelFor(x, ctx.social), x.step_key) : '');
  function socialFolds(m) {
    if (!ctx.social || !ctx.sv) return '';
    const checks = ctx.sv.checks || [];
    const props = window.SocialStandard.proposals(ctx.s, ctx.social, m.today);
    const gone = (ctx.sv.withdrawn || []).map((w) => `<li class="mks-dim"><b>${esc(w.event_id)}</b>: withdrawn · ${esc(w.notes || '')}</li>`).join('');
    const checkList = (checks.map((c) => `<li>${c.event_id ? `<b>${esc(c.event_id)}</b>: ` : ''}${esc(c.text)}</li>`).join('') || '<li class="mks-dim">No missing or contradictory facts flagged.</li>') + gone;
    const propList = props.map((p) => `<li><b>${esc(p.event.title)}</b> ${esc(dm(p.event.date))}: ${p.stages.map((x) => `${esc(x.stage)} w/c ${esc(dm(x.week))} (FB+IG Tue ${esc(dm(x.fbig))}, LinkedIn Wed ${esc(dm(x.linkedin))})`).join(' · ')}</li>`).join('') || '<li class="mks-dim">Every confirmed future event already has social rows.</li>';
    return `<details class="mks-fold" id="mks-facts-check"><summary>Facts check (${checks.length}) <span>missing or contradictory event facts: flagged, never chosen</span></summary><div class="mks-fold-body"><ul class="mks-rules">${checkList}</ul></div></details>`
      + `<details class="mks-fold" id="mks-proposals"><summary>New event dates: proposed social stages (${props.length}) <span>at the observed lead times, on the existing weekly slots · proposals only, nothing is created</span></summary><div class="mks-fold-body"><ul class="mks-rules">${propList}</ul></div></details>`;
  }
  async function adminJson(method, url, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(url, { method, headers: { 'x-arp-admin-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `status ${r.status}`);
    return j;
  }
  const socialView = () => adminJson('GET', `/api/aigeo/social-standard?view=all&propertyUrl=${encodeURIComponent(PROP)}`);
  /** "Render": queued for Alan's PC (scripts/social-render/render-job.mjs --jobs); the progress window polls the run. */
  async function renderJob(el) {
    const box = document.getElementById('mks-render-prog');
    el.disabled = true;
    try {
      const { run_id: runId } = await adminJson('POST', '/api/aigeo/social-standard', { action: 'render-request', event_id: el.dataset.mksRender, step_key: el.dataset.mksRenderStep, propertyUrl: PROP });
      const t0 = Date.now();
      for (;;) {
        const { run } = await adminJson('GET', `/api/aigeo/marketing?action=run&run_id=${encodeURIComponent(runId)}`);
        const pct = run.items_total ? Math.round((run.items_done / run.items_total) * 100) : 0;
        if (box) box.innerHTML = `<div class="mk-prog"><div style="width:${pct}%"></div></div><p class="rt-sub">${pct}% · ${esc(run.checkpoint?.step || run.status)} · ${Math.round((Date.now() - t0) / 1000)} s</p>`;
        if (!['queued', 'running'].includes(run.status)) { if (box) box.innerHTML = `<p class="rt-sub"><span class="rt-pill ${run.status === 'ok' ? 'ok' : 'bad'}">${esc(run.status.toUpperCase())}</span> ${esc(run.error || run.checkpoint?.step || '')}</p>`; break; }
        await new Promise((ok) => setTimeout(ok, 4000));
      }
      ctx.sv = await socialView().catch(() => ctx.sv);
      paint();
    } catch (e) {
      if (box) box.innerHTML = `<p class="rt-sub mks-red">Render request failed: ${esc(e.message)}</p>`;
    } finally {
      el.disabled = false;
    }
  }

  /* ---------- top: needs you + allowance ---------- */

  function needsHtml(m) {
    const items = m.needs.map((x, i) => `<li class="${x.level === 'red' ? 'mks-red' : ''}"><a href="#" role="button" class="mks-need-l" data-mks-need="${i}">${esc(x.text)}</a></li>`).join('');
    const wait = ctx.s ? '' : `<li class="mks-dim">${ctx.error ? `Week plan unavailable (${esc(ctx.error)}): emails only.` : 'Loading the week plan…'}</li>`;
    return `<div class="mks-box mks-need"><h4>Needs you (${m.needs.length})</h4><ul>${items || (ctx.s ? '<li class="mks-dim">Nothing needs you right now.</li>' : '')}${wait}</ul></div>`;
  }
  const pct = (v, q) => Math.max(0, Math.min(100, (v / q) * 100));
  function allowanceHtml(a) {
    if (!a) return '<div class="mks-box"><h4>Email allowance</h4><p class="mks-dim">No Squarespace meter reading yet.</p></div>';
    const seg = (v, cls, label) => (v > 0 ? `<div class="${cls}" style="width:${pct(v, a.quota).toFixed(1)}%" title="${esc(label)}">${pct(v, a.quota) >= 12 ? esc(label) : ''}</div>` : '');
    const free = a.over ? `<div class="mks-over">over by ${n(-a.free)}</div>` : seg(a.free, 'mks-free', `${n(a.free)} free`);
    const miss = a.missing ? ` · <span class="mks-amber">+ ${n(a.missing)} email${a.missing === 1 ? '' : 's'} without an audience (not counted)</span>` : '';
    return `<div class="mks-box"><h4>Email allowance${a.reset ? ` · resets ${esc(stamp(a.reset))}` : ''}</h4>`
      + `<div class="mks-bar">${seg(a.used, 'mks-used', `${n(a.used)} used`)}${seg(a.booked, 'mks-booked', `${n(a.booked)} booked`)}${free}</div>`
      + `<div class="mks-dim">${n(a.used)} used · ${n(a.booked)} booked · ${a.over ? `<span class="mks-red">${n(-a.free)} over</span>` : `${n(a.free)} free`} of ${n(a.quota)} · <b>booked</b> = scheduled or planned emails in this cycle${miss}</div></div>`;
  }
  const legendHtml = () => `<div class="mks-legend">${LEGEND.map(([k, l]) => `<span>${ICON[k]}${esc(l)}</span>`).join('')}</div>`;

  /* ---------- tabs ---------- */

  const chip = (attr, val, label, on) => `<button type="button" class="mks-tab${on ? ' on' : ''}" ${attr}="${esc(val)}" aria-pressed="${on}">${esc(label)}</button>`;
  function tabsHtml() {
    const toggle = chip('data-mks-view', 'days', 'Days', view.mode === 'days') + chip('data-mks-view', 'weeks', 'Weeks', view.mode === 'weeks');
    const custom = view.range.startsWith('week:') ? chip('data-mks-range', view.range, `w/c ${dm(view.range.slice(5))}`, true) : '';
    const ranges = view.mode === 'days'
      ? [['this', 'This week'], ['next', 'Next week'], ['4w', '4 weeks']].map(([k, l]) => chip('data-mks-range', k, l, view.range === k)).join('') + custom
      : [['9', 'This week + 8'], ['q', 'Quarter']].map(([k, l]) => chip('data-mks-wrange', k, l, view.wrange === k)).join('');
    return `<div class="mks-tabs"><span class="mks-group">${toggle}</span><span class="mks-group">${ranges}</span></div>`;
  }

  /* ---------- cards ---------- */

  /** People an email goes to: the reconciled audience (delivery.aud.people, lib/marketing/delivery-reserve.mjs) when known. */
  const peopleOf = (x) => x.raw?.delivery?.aud?.people ?? x.people;
  /** A social delivery's stored planned time (marketing_social_placements.planned_at), or null. */
  const socialPlan = (x) => (socialOn(x) ? window.SocialStandard.planOf(x, ctx.sv) : null);
  /** A draft card's time: GPT's proposed time from the record or the social plan ("draft · 17:30"), else the model's label. */
  function timeText(x) {
    const at = x.draft && x.record_key ? draftInfo(x).at : socialPlan(x)?.planned_at;
    if (!at) return x.time || '';
    return x.draft ? `draft · ${ukTime(at)}` : ukTime(at);
  }
  const meta = (x) => [peopleOf(x) != null ? `${x.estimate ? '~' : ''}${n(peopleOf(x))}` : '', timeText(x)].filter(Boolean).join(' · ');
  const draftBadge = (x) => (x.draft ? ' <span class="mks-dbadge">draft</span>' : '');
  function cardHtml(x) {
    const m = meta(x);
    return `<button type="button" class="mks-card s-${x.state}${x.dup ? ' dup' : ''}" data-mks-item="${esc(x.id)}" title="${esc(x.title)}">`
      + `<span class="mks-ct">${icons(x.row)}<b>${esc(x.short)}</b></span>${m ? `<span class="mks-meta">${esc(m)}</span>` : ''}${socialChips(x)}</button>`;
  }
  function lateCard(row, list) {
    const first = list.map((x) => x.day).sort()[0];
    const names = [...new Set(list.map((x) => x.short))].slice(0, 2).join(', ');
    return `<button type="button" class="mks-card s-late" data-mks-items="${esc(list.map((x) => x.id).join(','))}" title="${esc(list.map((x) => x.title).join('\n'))}">`
      + `<span class="mks-ct">${icons(row)}<b>${list.length} late</b></span><span class="mks-meta">${esc(names)}${first ? ` (from ${esc(dm(first))})` : ''}</span></button>`;
  }

  /* ---------- Days view ---------- */

  function rangeStart(m) {
    if (view.range === 'next') return [M().addDays(m.today, 7), 7];
    if (view.range === '4w') return [m.today, 28];
    if (view.range.startsWith('week:')) return [view.range.slice(5), 7];
    return [m.today, 7];
  }
  function dayHead(day, i, today) {
    const label = `${wd(day)} ${i === 0 || utcDay(day).getUTCDate() === 1 ? dm(day) : utcDay(day).getUTCDate()}`;
    return `<th class="${day === today ? 'today' : ''}">${esc(label)}${day === today ? ' · today' : ''}</th>`;
  }
  function chHead(row) {
    const r = ROW[row];
    return `<td class="mks-ch" style="border-left-color:${r.color}">${icons(row, 'mks-ic lg')}<b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</td>`;
  }
  function dayCell(r, i, day, ctxDays) {
    const cards = r.cells[i].map(cardHtml).join('');
    const late = day === ctxDays.today && r.late.length ? lateCard(r.row, r.late) : '';
    const offers = r.row === 'email' ? ctxDays.offers.filter((o) => o.offer_ends === day).map((o) => `<div class="mks-offer">${esc(o.offer_code)} ends</div>`).join('') : '';
    return `<td>${late}${cards}${offers}</td>`;
  }
  function daysBlock(dv, b, today) {
    const idx = Array.from({ length: 7 }, (_, k) => b * 7 + k).filter((k) => k < dv.days.length);
    const head = `<tr><th class="mks-chh">Channel</th>${idx.map((k, i) => dayHead(dv.days[k], i, today)).join('')}</tr>`;
    const body = dv.rows.map((r) => `<tr>${chHead(r.row)}${idx.map((k) => dayCell(r, k, dv.days[k], { today, offers: dv.offers })).join('')}</tr>`).join('');
    return `<table class="mks-grid mks-days">${head}${body}</table>`;
  }
  function daysHtml(m) {
    const [start, len] = rangeStart(m);
    const dv = M().days(m, start, len);
    return Array.from({ length: dv.blocks }, (_, b) => daysBlock(dv, b, m.today)).join('');
  }
  const KEY_DAYS = '<div class="mks-key"><span><i class="k-done"></i>done</span><span><i class="k-sch"></i>scheduled in the platform</span><span><i class="k-pl"></i>planned, not scheduled</span><span><i class="k-late"></i>late / needs you</span><span><i class="k-dup"></i>possible duplicate</span><span>number = people it goes to · click any card for the detail (audience, offer, brief, Done / Skip / Move)</span></div>';

  /* ---------- Weeks view ---------- */

  function sellingHtml(list) {
    if (!list.length) return '<span class="mks-dim">—</span>';
    return list.map((x) => (x.quiet ? `<span class="mks-dim">${esc(x.t)}</span>` : `<b>${esc(x.b)}</b>${x.t ? ` ${esc(x.t)}` : ''}`)).join(' · ');
  }
  /** "9 emails · 1,351 sends" (drafts never inside sends). */
  function emailsHead(e) {
    if (!e.count) return '';
    return `${n(e.count)} email${e.count === 1 ? '' : 's'} · ${e.estimate ? '~' : ''}${n(e.sends)} sends${e.unknown ? ` + ${e.unknown} not drafted` : ''}`;
  }
  /** Per person in the week's worst rolling 7 days (server counts): "613×2 · 39×3 (approved)", "estimate" for draft audiences. */
  function perPersonLine(e) {
    if (!e.per_person) return '';
    const cls = e.red ? 'mks-red' : (e.amber ? 'mks-amber' : '');
    return `<small class="${cls}">per person: ${esc(e.per_person)}${e.freq_estimate ? ' · estimate' : ''}</small>`;
  }
  function emailSubs(e, w) {
    const subs = [];
    if (e.drafts) subs.push(`<span class="mks-dim">+${n(e.drafts)} draft${e.drafts === 1 ? '' : 's'}${e.draft_people ? ` (~${n(e.draft_people)}, not booked)` : ''}</span>`);
    if (e.late) subs.push(`<span class="mks-amber">${e.late} late</span>`);
    if (e.skipped) subs.push(`${e.skipped} skipped`);
    if (!e.count && !e.drafts && !e.late && !w.past) subs.push('<span class="mks-dim">none planned</span>');
    return subs.map((x) => `<small>${x}</small>`).join('');
  }
  function emailsHtml(e, w) {
    const level = e.red ? ' rd' : (e.amber ? ' am' : '');
    const title = e.window ? `per person, worst rolling 7 days ${dm(e.window.from)}–${dm(e.window.to)}: amber = 3+ emails without an approved exception, red = 4+` : 'per-person counts not available for this week';
    const head = emailsHead(e);
    return `<td class="mks-em" title="${esc(title)}">${head ? `<span class="mks-n${level}">${esc(head)}</span>` : ''}${perPersonLine(e)}${emailSubs(e, w)}</td>`;
  }
  function miniCard(c, m, row) {
    if (c.late) return `<button type="button" class="mks-card mini s-late" data-mks-items="${esc(c.ids.join(','))}">${icons(row)}<b>${c.ids.length} late</b> ${esc(c.names.slice(0, 2).join(', '))}</button>`;
    if (c.group) return `<button type="button" class="mks-card mini s-${c.state}${c.dup ? ' dup' : ''}" data-mks-items="${esc(c.ids.join(','))}">${icons(row)}<b>${esc(wd(c.day))}</b> ${c.count} emails · ${n(c.people)}</button>`;
    const x = m.byId.get(c.id);
    const tail = row === 'email' && peopleOf(x) != null ? ` · ${x.estimate ? '~' : ''}${n(peopleOf(x))}` : '';
    return `<button type="button" class="mks-card mini s-${x.state}${x.dup ? ' dup' : ''}" data-mks-item="${esc(x.id)}" title="${esc(x.title)}">${icons(row)}<b>${esc(wd(x.day))}</b> ${esc(x.short)}${esc(tail)}${draftBadge(x)}${socialChips(x)}</button>`;
  }
  function emptyCell(row, w) {
    if (w.gaps[row]) return '<span class="mks-gap">nothing planned</span>';
    if (row === 'gbp' && !w.past) return '<span class="mks-dim"><i>auto</i></span>';
    return '<span class="mks-dim">—</span>';
  }
  function weekRowHtml(w, m) {
    const label = w.tag || '';
    const cells = M().ROWS.map((row) => `<td>${w.cells[row].length ? w.cells[row].map((c) => miniCard(c, m, row)).join('') : emptyCell(row, w)}</td>`).join('');
    return `<tr class="${w.now ? 'now' : ''}"><td class="mks-wkc"><button type="button" class="mks-wk" data-mks-week="${esc(w.week)}" title="Open in the Days view">w/c ${esc(dm(w.week))}${label ? `<small>${label}</small>` : ''}</button></td>`
      + `<td class="mks-sell">${sellingHtml(w.selling)}</td>${emailsHtml(w.emails, w)}${cells}</tr>`;
  }
  function weeksHtml(m) {
    const list = view.wrange === 'q' ? M().weeks(m, 20, M().quarterEnd(m.s)) : M().weeks(m, 9);
    const heads = M().ROWS.map((row) => `<th class="mks-wh" style="border-top-color:${ROW[row].color}">${icons(row)}${esc(WEEK_HEAD[row])}</th>`).join('');
    return `<table class="mks-grid mks-weeks"><colgroup><col class="c-wk"><col class="c-sell"><col class="c-em"><col span="4"><col class="c-gbp"></colgroup>`
      + `<tr><th>Week</th><th>Selling this week</th><th>Emails<small>per person in 7 days</small></th>${heads}</tr>${list.map((w) => weekRowHtml(w, m)).join('')}</table>`;
  }
  const KEY_WEEKS = `<div class="mks-key"><span><i class="k-done"></i>done</span><span><i class="k-sch"></i>scheduled in the platform</span><span><i class="k-pl"></i>planned</span><span><i class="k-late"></i>late / gap</span><span><b class="mks-amber">amber</b> = someone gets 3+ emails in 7 days without an approved exception · <b class="mks-red">red</b> = anyone gets 4+</span><span>drafts are listed apart, never in sends</span><span>"Selling this week" comes from the quarter plan and event / offer dates · click a week to open it in the Days view</span></div>`;

  /* ---------- section ---------- */

  function sectionHtml() {
    const m = buildModel();
    const body = view.mode === 'weeks' ? `<div class="mks-scroll">${weeksHtml(m)}</div>${KEY_WEEKS}` : `<div class="mks-scroll">${daysHtml(m)}</div>${KEY_DAYS}`;
    return `<div class="mks-headrow"><h3>Marketing schedule <button type="button" class="mks-i" data-mks-rules title="How the schedule is worked out: Rules &amp; data sources (below)">ⓘ</button></h3></div>`
      + `<div class="mks-top">${needsHtml(m)}${allowanceHtml(m.allowance)}</div>${legendHtml()}${tabsHtml()}<div class="mks-body mks-${view.mode}">${body}</div>${socialFolds(m)}`;
  }
  function paint() {
    if (!ctx.host?.isConnected) return;
    ctx.host.innerHTML = sectionHtml();
    if (view.panel) openPanel(view.panel, true);
  }

  /* ---------- side panel ---------- */

  const BADGE = { seen: ['seen', 'collector-observed'], operator_verified: ['operator-verified', 'confirmed by Alan or ChatGPT in the platform'], manual: ['manual', 'manual confirmation'] };
  function badge(ev) {
    if (!ev || !BADGE[ev.kind]) return '<span class="mkd-b mkd-b-none" title="a database stage alone is not evidence">planned / unverified</span>';
    return `<span class="mkd-b mkd-b-${esc(ev.kind)}" title="${esc(BADGE[ev.kind][1])}">${BADGE[ev.kind][0]}</span>${ev.at ? ` ${esc(stamp(ev.at))}` : ''}${ev.by ? ` · ${esc(ev.by)}` : ''}`;
  }
  const STATE_LABEL = { done: 'Done', sch: 'Scheduled in the platform', pl: 'Planned, not scheduled', late: 'Late', warn: 'Marked scheduled, no platform evidence', resolved: 'Resolved' };
  const kv = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${v}</td></tr>` : '');
  /** A sent email: the provider send time, and when the record was updated (S's recorded_at) if that differs. */
  function sentText(r) {
    const rec = r.recorded_at && stamp(r.recorded_at) !== stamp(r.done_at) ? ` · recorded ${esc(stamp(r.recorded_at))}` : '';
    return `Sent ${esc(stamp(r.done_at))}${rec}`;
  }
  function whenText(x) {
    const r = x.raw || {};
    if (x.state === 'done' && x.row === 'email' && r.delivery?.sent && r.done_at) return sentText(r);
    if (x.state === 'done') return `done ${esc(stamp(r.done_at) || dm(x.day))}`;
    if (x.state === 'late') return `<span class="mks-amber">late · planned ${esc(dm(x.day))}</span>`;
    return `${esc(x.day ? `${wd(x.day)} ${dm(x.day)}` : 'no date')}${timeText(x) ? ` · ${esc(timeText(x))}` : ''}`;
  }
  function offerOf(x, c) {
    const f = (c?.step?.featured || []).flatMap((y) => (y.items ? y.items : [y])).find((y) => y.offer)?.offer;
    const rec = recordOf(x);
    const o = f || rec?.offer || rec?.event?.offer;
    return o ? `${esc(o.note || '')}${o.code ? ` · code <b>${esc(o.code)}</b>` : ''}${o.ends ? ` · ends ${esc(dm(o.ends))}` : ''}` : '';
  }
  const recordOf = (x) => (x.record_key ? (ctx.s?.campaign?.campaigns || []).find((r) => r.campaign_key === x.record_key) : null);
  function initiativeText(x) {
    const r = x.raw || {};
    const tag = r.initiative ? `${esc(r.initiative)}${r.purpose ? ` · ${esc([].concat(r.purpose).join(' + '))}` : ''}` : '';
    if (tag || !window.stInitiativePill) return tag;
    return x.step_key ? window.stInitiativePill('delivery', x.step_key) : (x.record_key ? window.stInitiativePill('campaign', x.record_key) : '');
  }
  function warningsFor(x) {
    const ws = (ctx.d?.meter?.warnings || []).filter((w) => w.key && (w.key === x.record_key || w.key === x.key));
    const dup = x.dup ? ctx.model.byId.get(x.dup) : null;
    const lines = ws.map((w) => `<li><b>${esc(w.text)}</b>${w.action ? `: ${esc(w.action)}` : ''}</li>`);
    if (dup) lines.unshift(`<li><b>Possible duplicate</b> with “${esc(dup.title)}” (${n(peopleOf(dup))} people, same day). If they are the same email keep one; nothing is changed automatically.</li>`);
    return lines.length ? `<ul class="mks-warn">${lines.join('')}</ul>` : '';
  }
  function stepControls(x) {
    const c = x.step_key && typeof window.stStepControls === 'function' ? window.stStepControls(x.step_key) : null;
    if (!c) return { c: null, html: '' };
    const social = SOCIAL_ROWS.has(x.row);
    const label = social ? ['Production brief (internal, never published)', 'Copy production brief'] : ['Brief (paste-ready)', 'Copy brief'];
    const brief = c.brief ? `<details class="mks-brief"><summary>${label[0]}</summary><textarea readonly rows="8">${esc(c.brief)}</textarea><button type="button" class="rf-btn rf-btn-secondary" data-mks-copy>${label[1]}</button></details>` : '';
    const html = `<div class="mks-ctl"><div class="mks-ctl-row"><span class="mks-ctl-done">${c.done}</span> <span class="st-state">${c.state}</span></div>${c.actions ? `<div class="mks-ctl-row">${c.actions}</div>` : ''}${c.audience}</div>`;
    return { c, html, brief, text: c.step.brief || '' };
  }
  function recordControls(x) {
    const rec = recordOf(x);
    if (x.step_key || !rec) return '';
    return `<div class="mks-ctl"><div class="mks-ctl-row">${window.stStageChip ? window.stStageChip(rec) : ''} ${window.mkPresendChip ? window.mkPresendChip(rec.campaign_key) : ''}</div></div>`;
  }
  const unmatched = (x) => !!x.raw?.delivery?.review;
  const SQS_DRAFT = 'https://alan-ranger.squarespace.com/config/marketing/campaigns/composer/';
  const ukTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const ukDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  /** The latest stage_history entry with GPT's proposed time / Squarespace draft id (strategy summary record). */
  const proposedEntry = (x) => [...(recordOf(x)?.stage_history || [])].reverse().find((e) => e && (e.proposed_send_at || e.provider_draft_id)) || {};
  /** Draft details: GET /api/aigeo/marketing-schedule-extras first, else the campaign record's stage_history. */
  const proposedTime = (ex, h, x) => ex.proposed_send_at || h.proposed_send_at || socialPlan(x)?.planned_at || null;
  function draftInfo(x) {
    const ex = (ctx.x?.drafts || []).find((r) => r.campaign_key === x.record_key) || {};
    const h = proposedEntry(x);
    return { at: proposedTime(ex, h, x), day: ex.planned_send_on || x.day, id: ex.sqs_draft_id || h.provider_draft_id || null, brief: ex.brief || null, gate: ex.gate || h.gate || null };
  }
  /** "Thu 19 Nov 17:30" or "Thu 19 Nov · time not set". */
  function draftWhen(info) {
    const day = info.at ? ukDate(info.at) : info.day;
    return `${day ? `${wd(day)} ${dm(day)}` : 'no date'} ${info.at ? ukTime(info.at) : '· time not set'}`;
  }
  /** "Draft · proposed Thu 19 Nov 17:30 · not scheduled". */
  const draftLine = (info) => `Draft · proposed ${draftWhen(info)} · not scheduled`;
  function draftRows(x, info) {
    const link = info.id ? `<a href="${esc(SQS_DRAFT + encodeURIComponent(info.id))}" target="_blank" rel="noopener">Open Squarespace draft</a>` : '';
    return kv('Brief', [info.brief, info.gate ? `gate: ${info.gate}` : ''].filter(Boolean).map(esc).join('<br>')) + kv('Squarespace', link);
  }
  /** "X people + 1 business copy = Y sends" from lib/marketing-audience-line.js when loaded, else the audience text. */
  function audienceCell(x) {
    const line = window.MarketingAudienceLine && typeof window.MarketingAudienceLine.html === 'function' ? window.MarketingAudienceLine.html(x) : '';
    return line || x.raw?.audience || (peopleOf(x) != null ? `${n(peopleOf(x))} people` : '');
  }
  function detailRows(x, sc, info) {
    const r = x.raw || {};
    return kv('When', info ? esc(`proposed ${draftWhen(info)}`) : whenText(x)) + kv('Audience', audienceCell(x)) + kv('People', peopleOf(x) != null ? `${x.estimate ? '~' : ''}${n(peopleOf(x))}` : '')
      + kv('Offer / code', offerOf(x, sc.c)) + kv(SOCIAL_ROWS.has(x.row) ? 'Production brief' : 'Brief', sc.text ? esc(sc.text) : '') + (info ? draftRows(x, info) : '') + kv('Suggested modules', (x.suggested || []).map(esc).join('<br>'))
      + kv('Initiative', initiativeText(x)) + kv('Next', r.next && x.state !== 'done' ? esc(r.next) : '') + kv('Evidence', x.state === 'done' || x.state === 'sch' ? badge(r.evidence) : badge(null));
  }
  function itemDetail(x) {
    const sc = stepControls(x);
    const info = x.draft ? draftInfo(x) : null;
    const link = unmatched(x) ? '<div class="mks-ctl"><button type="button" class="rf-btn rf-btn-secondary" data-mks-open="mk-budget">Link it to its campaign (Email send budget)</button></div>' : '';
    const rows = detailRows(x, sc, info);
    const stateText = info ? draftLine(info) : (STATE_LABEL[x.state] || x.state);
    const body = `<table class="mks-kv">${rows}</table>${warningsFor(x)}${sc.html}${recordControls(x)}${link}${socialSection(x)}${sc.brief || ''}`;
    const review = view.review === x.step_key && socialOn(x);
    return `<div class="mks-pitem s-${info ? 'pl draft' : x.state}"><div class="mks-ph">${icons(x.row)}<b>${esc(x.title)}</b></div><div class="mks-pstate">${esc(stateText)}</div>`
      + (review ? `${window.SocialPanel.review(window.SocialStandard.panelFor(x, ctx.social))}<details class="mks-more"><summary>Production brief, placements, facts and internal fields</summary>${body}</details>` : body) + '</div>';
  }
  /**
   * Review-first (Agent X's "Waiting on you" Review button): opens the social post's panel with the finished public
   * caption and the rendered image FIRST, everything else collapsed. Returns false when the post isn't on the schedule.
   */
  window.mkOpenSocialReview = function mkOpenSocialReview(stepKey) {
    const x = (ctx.model?.items || []).find((y) => y.step_key === stepKey && SOCIAL_ROWS.has(y.row) && y.state !== 'resolved');
    if (!x || !ctx.social || !window.SocialPanel?.review) return false;
    view.review = stepKey;
    openPanel([x.id]);
    return true;
  };
  /** For "Waiting on you": is this social post ready to approve? From the stored public caption only (never the brief). */
  window.mkSocialReviewState = function mkSocialReviewState(stepKey) {
    const x = (ctx.model?.items || []).find((y) => y.step_key === stepKey && SOCIAL_ROWS.has(y.row) && y.state !== 'resolved');
    if (!x || !ctx.social) return null;
    const p = window.SocialStandard.panelFor(x, ctx.social);
    return { public_caption: !!p.caption, ready: p.readiness.every((r) => r.ok), blockers: p.readiness.filter((r) => !r.ok).map((r) => r.label) };
  };
  function openPanel(ids, keep) {
    const list = ids.map((id) => ctx.model?.byId.get(id)).filter(Boolean);
    let el = document.getElementById('mks-panel');
    if (!el) { el = document.createElement('aside'); el.id = 'mks-panel'; ctx.host.appendChild(el); }
    if (!list.length) { el.hidden = true; view.panel = null; return; }
    view.panel = ids;
    const head = list.length > 1 ? `${list.length} items` : 'Detail';
    el.innerHTML = `<div class="mks-ptop"><b>${esc(head)}</b><button type="button" class="mks-x" data-mks-close aria-label="Close">×</button></div>${list.map(itemDetail).join('')}`;
    el.hidden = false;
    if (!keep) el.scrollTop = 0;
  }
  function closePanel() {
    view.panel = null;
    view.review = null;
    const el = document.getElementById('mks-panel');
    if (el) el.hidden = true;
  }

  /* ---------- folds, ⓘ paragraphs, tile links ---------- */

  function openFold(id) {
    const el = document.getElementById(id);
    const fold = el?.closest('details.mks-fold');
    if (fold) fold.open = true;
    return el;
  }
  const GO = { campaign: 'mk-campaign-host', segments: 'mk-segments', budget: 'mk-budget', exports: 'mk-exports', review: 'mk-review', sources: 'mk-sources', cleanup: 'mk-cleanup', customers: 'mk-query', health: 'mk-query' };
  function onTileGo(e) {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const el = e.target.closest?.('[data-mko-go]');
    if (el && GO[el.dataset.mkoGo]) openFold(GO[el.dataset.mkoGo]);
  }
  document.addEventListener('click', onTileGo, true);
  document.addEventListener('keydown', onTileGo, true);

  const LONG = 200;
  const KEEP = '#mk-schedule, #mk-query, #mk-fold-rules .mks-rules';
  function sectionName(p) {
    const sec = p.closest('.rt-section, .mks-fold');
    return sec?.querySelector('h3, h4, summary')?.textContent.replace(/ⓘ/g, '').trim().slice(0, 60) || 'Marketing';
  }
  function moveParagraph(p, i) {
    p.dataset.mksMoved = String(i);
    p.hidden = true;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mks-i';
    btn.textContent = 'ⓘ';
    btn.title = p.textContent.trim().slice(0, 600);
    btn.dataset.mksPara = String(i);
    p.parentNode.insertBefore(btn, p);
  }
  let paraSig = '';
  function collapseParagraphs(root) {
    const all = [...root.querySelectorAll('p.rt-sub')].filter((p) => !p.closest(KEEP));
    const fresh = all.filter((p) => !p.dataset.mksMoved && p.textContent.trim().length > LONG);
    fresh.forEach((p, k) => moveParagraph(p, Date.now() + k));
    const moved = all.filter((p) => p.dataset.mksMoved);
    const sig = moved.map((p) => p.dataset.mksMoved).join(',');
    if (sig === paraSig) return;
    paraSig = sig;
    const box = document.getElementById('mk-rules-moved');
    if (box) box.innerHTML = moved.map((p) => `<li><b>${esc(sectionName(p))}:</b> ${esc(p.textContent.trim())}</li>`).join('') || '<li class="mks-dim">None.</li>';
  }
  function watchParagraphs(root) {
    if (root.dataset.mksWatch) return;
    root.dataset.mksWatch = '1';
    let t = null;
    new MutationObserver((list) => {
      if (list.every((r) => r.target.closest?.('#mk-schedule, #mk-rules-moved'))) return;
      clearTimeout(t);
      t = setTimeout(() => collapseParagraphs(root), 250);
    }).observe(root, { childList: true, subtree: true });
    collapseParagraphs(root);
  }

  /* ---------- events ---------- */

  function needIds(i) {
    const x = ctx.model?.needs[Number(i)];
    if (x?.link || x?.go) { const el = openFold(x.go || 'mk-budget'); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return x ? x.ids : [];
  }
  const CLICK = [
    ['[data-mks-view]', (el) => { view.mode = el.dataset.mksView; localStorage.setItem('mks-view', view.mode); paint(); }],
    ['[data-mks-range]', (el) => { view.range = el.dataset.mksRange; paint(); }],
    ['[data-mks-wrange]', (el) => { view.wrange = el.dataset.mksWrange; paint(); }],
    ['[data-mks-week]', (el) => { view.mode = 'days'; view.range = `week:${el.dataset.mksWeek}`; paint(); }],
    ['[data-mks-item]', (el) => { view.review = null; openPanel([el.dataset.mksItem]); }],
    ['[data-mks-items]', (el) => { view.review = null; openPanel(el.dataset.mksItems.split(',')); }],
    ['[data-mks-need]', (el) => openPanel(needIds(el.dataset.mksNeed))],
    ['[data-mks-close]', () => closePanel()],
    ['[data-mks-copy]', (el) => navigator.clipboard?.writeText(el.parentElement.querySelector('textarea').value).catch(() => {})],
    ['[data-mks-open]', (el) => { closePanel(); openFold(el.dataset.mksOpen)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }],
    ['[data-mks-rules]', () => openFold('mk-fold-rules-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' })],
    ['[data-mks-para]', (el) => { const p = el.nextElementSibling; if (p) p.hidden = !p.hidden; }],
    ['[data-mks-render]', (el) => renderJob(el)]
  ];
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#marketing-root')) return;
    const hit = CLICK.map(([sel, fn]) => [e.target.closest(sel), fn]).find(([el]) => el);
    if (!hit) return;
    if (hit[0].tagName === 'A') e.preventDefault();
    hit[1](hit[0]);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view.panel) closePanel(); });
  /** After Done / Skip / Move / stage / audience (board repaint) or a summary reload: same records, repainted. */
  document.addEventListener('st-steps-repainted', () => {
    if (!ctx.host?.isConnected) return;
    ctx.s = (window.stLastData && window.stLastData()) || ctx.s;
    paint();
  });

  async function gbpStatus() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/strategy-campaigns?view=gbp&propertyUrl=${encodeURIComponent(PROP)}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    return j.ok ? j.gbp : { reachable: false, error: j.error || `status ${r.status}` };
  }
  /** Fixed selling moments + Squarespace draft details (read-only: GET /api/aigeo/marketing-schedule-extras). */
  async function scheduleExtras() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/marketing-schedule-extras?propertyUrl=${encodeURIComponent(PROP)}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    return j.ok ? { moments: j.moments || [], drafts: j.drafts || [] } : null;
  }

  /** Paints from the Marketing overview straight away; the week plan and the Google Business status fill in after. */
  window.mkMountSchedule = function mkMountSchedule(host, d, strategy) {
    if (!host || !M()) return;
    Object.assign(ctx, { host, d, s: null, g: null, error: null });
    view.panel = null;
    paint();
    Promise.resolve(strategy).then((s) => { ctx.s = s || null; }, (e) => { ctx.error = e.message; }).then(paint);
    gbpStatus().catch(() => null).then((g) => { ctx.g = g; paint(); });
    scheduleExtras().catch(() => null).then((x) => { ctx.x = x; paint(); });
    socialView().catch(() => null).then((v) => { ctx.sv = v; paint(); });
    const root = document.getElementById('marketing-root');
    if (root) watchParagraphs(root);
  };
  window.mkScheduleRulesHtml = function mkScheduleRulesHtml() {
    return '<ul class="mks-rules">'
      + '<li><b>Marketing schedule:</b> one row per channel (Days) or one row per week (Weeks), read from the same records as before: campaign steps and their ticks, campaign records (strategy_campaigns), audience snapshots, the Squarespace Scheduled / Sent reads and the Google Business status. Nothing here sends, schedules or changes anything in Squarespace.</li>'
      + '<li><b>Status by fill:</b> green = done with evidence (sent / seen / ticked); blue = scheduled in the platform (collector-seen or operator-verified); dashed grey = planned, not scheduled; amber = late (planned day passed, not done) or needs you (marked scheduled with no platform evidence). Amber outline = possible duplicate.</li>'
      + '<li><b>Days:</b> This week = today and the next 6 days; Next week = the 7 days after; 4 weeks = 28 days from today. Late items gather in today\'s column. Times UK.</li>'
      + `<li><b>Weeks:</b> weeks start on Monday (w/c), like the campaign steps. Emails = emails done, scheduled or planned that week and their sends (late ones not sent and drafts are listed apart; drafts are never counted as sends). "Per person" = how many people get 1 / 2 / 3 / 4+ emails in the week\'s worst rolling 7 days, counted from the frozen or saved audience members (Squarespace scheduled and sent campaigns, plus the Academy re-engagement automation; owner copies counted apart, never as clients); "estimate" when a draft or estimate audience is in it. Amber when anyone gets more than 2 without an approved exception; red only for 4+. Exceptions are read per campaign and week from the snapshot\'s <code>frequency_policy</code>, never as a blanket exception. A future week with no step on Email, Facebook + Instagram or LinkedIn says "nothing planned" (no steps are invented); Outlook notes are ad hoc; Google Business posts automatically (Viking Local).</li>`
      + '<li><b>Selling this week:</b> the campaign moments (announce / main push / last places / last chance), offer end dates and event dates that week, open quarter-plan actions due that week and initiatives starting; otherwise the quarter-plan initiatives running.</li>'
      + '<li><b>Possible duplicate:</b> two emails on the same UK day to (nearly) the same people: the send budget\'s own check (90% or more shared people in the frozen snapshots), or a Squarespace schedule not matched to a campaign beside one of the records it could be. Flagged only.</li>'
      + '<li><b>Email allowance:</b> used = Squarespace\'s own meter this billing cycle; booked = committed (scheduled / frozen) + provisional (audience chosen) emails this cycle; free = allowance − used − booked. Detail: Email send budget below.</li></ul>';
  };

  const CSS = `
  #mk-schedule { position: relative; }
  #mk-schedule h3 { display: flex; align-items: center; gap: 6px; }
  .mks-i { background: transparent; border: 0; color: #94a3b8; cursor: pointer; font-size: 0.95rem; padding: 0 4px; vertical-align: 1px; }
  .mks-i:hover { color: var(--dark-brand, #f0a500); }
  .mks-top { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; margin: 8px 0 10px; }
  .mks-box { background: #151c2b; border: 1px solid #263045; border-radius: 10px; padding: 10px 14px; font-size: 0.85rem; }
  .mks-box h4 { margin: 0 0 6px !important; color: #fff; font-size: 0.92rem; }
  .mks-need { border-left: 4px solid #f0b429; } .mks-need ul { margin: 0; padding-left: 18px; } .mks-need li { margin: 3px 0; }
  .mks-need-l { color: #d6dbe4; text-decoration: none; cursor: pointer; } .mks-need-l:hover { color: #fde68a; text-decoration: underline; }
  .mks-need .mks-red .mks-need-l { color: #fca5a5; }
  .mks-bar { display: flex; height: 22px; border-radius: 5px; overflow: hidden; border: 1px solid #263045; margin: 6px 0; background: #0f131b; }
  .mks-bar div { font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; color: #0b0e14; white-space: nowrap; overflow: hidden; }
  .mks-used { background: #8b93a3; } .mks-booked { background: #f0b429; } .mks-free { background: #5fd38d; } .mks-over { background: #ef4444; color: #fff !important; flex: 1; }
  .mks-dim { color: #8b93a3; font-weight: 400; } .mks-amber { color: #fbbf24; font-weight: 700; } .mks-red { color: #f87171; font-weight: 700; }
  .mks-legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #c3c9d4; margin: 6px 0 6px; }
  .mks-legend span { display: inline-flex; align-items: center; gap: 5px; } .mks-legend svg { width: 18px; height: 18px; }
  .mks-tabs { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 6px; } .mks-group { display: inline-flex; gap: 4px; }
  .mks-tab { padding: 3px 10px; border: 1px solid #4a5263; border-radius: 6px; color: #8b93a3; font-size: 12px; background: transparent; cursor: pointer; }
  .mks-tab.on { background: #2a2108; color: #f0a500; border-color: #f0a500; font-weight: 700; }
  .mks-scroll { overflow-x: auto; }
  .mks-grid { border-collapse: collapse; width: 100%; table-layout: fixed; margin-top: 6px; }
  .mks-grid th { background: #0f131b; color: #9aa3b2; font-size: 12px; padding: 7px 6px; border: 1px solid #263045; text-align: left; font-weight: 700; }
  .mks-grid th small { display: block; font-weight: 400; color: #8b93a3; font-size: 10.5px; }
  .mks-grid th.today { color: #f0a500; }
  .mks-grid td { border: 1px solid #263045; vertical-align: top; padding: 5px; font-size: 12px; }
  .mks-days td { height: 58px; } .mks-days .mks-chh { width: 128px; }
  .mks-ch { background: #111724; color: #fff; border-left: 3px solid #263045 !important; font-size: 12.5px; }
  .mks-ch b { display: block; margin-top: 3px; } .mks-ch small { display: block; color: #8b93a3; font-weight: 400; }
  .mks-ic { display: inline-flex; gap: 2px; vertical-align: -3px; margin-right: 4px; flex: none; } .mks-ic svg { width: 13px; height: 13px; } .mks-ic.lg svg { width: 18px; height: 18px; }
  .mks-card { display: block; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 4px 6px; margin: 0 0 4px; font: inherit; font-size: 11.5px; line-height: 1.3; color: #d6dbe4; cursor: pointer; background: #1a1f2b; }
  .mks-card b { color: #fff; font-size: 12px; } .mks-card .mks-ct { display: block; } .mks-card .mks-ct b { overflow-wrap: break-word; }
  .mks-card .mks-meta { display: block; color: #aab2c0; margin-top: 1px; }
  .mks-card:hover { filter: brightness(1.25); }
  .mks-card.s-done { background: #11251a; border-left: 3px solid #5fd38d; }
  .mks-card.s-sch { background: #132038; border-left: 3px solid #6ea8fe; }
  .mks-card.s-pl { background: #1a1f2b; border: 1px dashed #4a5263; border-left: 3px dashed #8b93a3; }
  .mks-card.s-late, .mks-card.s-warn { background: #2a2108; border-left: 3px solid #f0b429; }
  .mks-card.dup { outline: 1px solid #f0b429; outline-offset: 0; }
  .mks-card.mini { font-size: 11px; padding: 3px 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; } .mks-card.mini b { font-size: 11px; }
  .mks-offer { color: #8b93a3; font-size: 11px; margin: 2px 0; }
  .mks-weeks .c-wk { width: 92px; } .mks-weeks .c-sell { width: 21%; } .mks-weeks .c-em { width: 128px; } .mks-weeks .c-gbp { width: 11%; }
  .mks-wh { border-top: 3px solid #263045 !important; color: #fff !important; } .mks-wh .mks-ic svg { width: 15px; height: 15px; }
  .mks-wkc { background: #111724; } .mks-weeks tr.now .mks-wkc { border-left: 4px solid #f0a500; }
  .mks-wk { background: none; border: 0; padding: 0; color: #fff; font-weight: 800; font-size: 12.5px; text-align: left; cursor: pointer; } .mks-wk:hover { color: #f0a500; }
  .mks-wk small { display: block; color: #8b93a3; font-weight: 400; margin-top: 2px; }
  .mks-sell { font-size: 11.5px; color: #d6dbe4; } .mks-sell b { color: #fff; }
  .mks-em .mks-n { font-weight: 800; font-size: 12.5px; color: #fff; display: block; } .mks-em .mks-n.rd { color: #f87171; } .mks-em .mks-n.am { color: #fbbf24; } .mks-em small { display: block; font-size: 10.5px; color: #8b93a3; }
  .mks-gap { color: #f0b429; font-weight: 700; font-size: 11.5px; }
  .mks-key { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; margin-top: 8px; color: #8b93a3; }
  .mks-key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .mks-key .k-done { background: #5fd38d; } .mks-key .k-sch { background: #6ea8fe; } .mks-key .k-pl { border: 1px dashed #8b93a3; } .mks-key .k-late { background: #f0b429; } .mks-key .k-dup { outline: 1px solid #f0b429; }
  #mks-panel { position: fixed; top: 0; right: 0; width: min(440px, 94vw); height: 100vh; overflow-y: auto; background: #0b1118; border-left: 1px solid #334155; box-shadow: -8px 0 24px rgba(0,0,0,0.45); z-index: 9990; padding: 0 14px 24px; color: #d6dbe4; font-size: 13px; }
  .mks-ptop { position: sticky; top: 0; background: #0b1118; display: flex; justify-content: space-between; align-items: center; padding: 12px 0 8px; border-bottom: 1px solid #263045; z-index: 1; }
  .mks-x { background: none; border: 0; color: #cbd5e1; font-size: 22px; cursor: pointer; line-height: 1; }
  .mks-pitem { border: 1px solid #263045; border-left-width: 3px; border-radius: 8px; padding: 10px 12px; margin: 10px 0; background: #111724; }
  .mks-pitem.s-done { border-left-color: #5fd38d; } .mks-pitem.s-sch { border-left-color: #6ea8fe; } .mks-pitem.s-pl { border-left-style: dashed; border-left-color: #8b93a3; } .mks-pitem.s-late, .mks-pitem.s-warn { border-left-color: #f0b429; }
  .mks-dbadge { border: 1px dashed #8b93a3; border-radius: 3px; padding: 0 3px; font-size: 10px; color: #cbd5e1; }
  .mks-pitem.draft .mks-pstate { color: #cbd5e1; font-weight: 700; } .mks-kv a { color: #93c5fd; }
  .mks-ph { display: flex; gap: 4px; align-items: flex-start; color: #fff; } .mks-ph .mks-ic svg { width: 16px; height: 16px; }
  .mks-pstate { font-size: 11.5px; color: #8b93a3; margin: 2px 0 6px; }
  .mks-kv { width: 100%; border-collapse: collapse; font-size: 12.5px; } .mks-kv th { text-align: left; color: #8b93a3; font-weight: 400; width: 6.5rem; vertical-align: top; padding: 2px 6px 2px 0; } .mks-kv td { padding: 2px 0; color: #e5e7eb; }
  .mks-warn { margin: 6px 0; padding: 6px 8px 6px 22px; border: 1px solid #a16207; border-radius: 6px; background: #1c1917; color: #fde68a; font-size: 12px; }
  .mks-ctl { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #334155; font-size: 12px; } .mks-ctl-row { margin: 3px 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mks-ctl .st-acts { gap: 6px; } .mks-ctl details.st-move-l { display: inline-block; }
  .mks-brief { margin-top: 8px; } .mks-brief textarea { width: 100%; background: #0f131b; color: #cbd5e1; border: 1px solid #334155; border-radius: 6px; font-size: 12px; }
  .mks-fold { background: #151c2b; border: 1px solid #263045; border-radius: 8px; margin: 0 0 8px; }
  .mks-fold > summary { padding: 9px 12px; color: #fff; font-weight: 700; cursor: pointer; list-style: none; } .mks-fold > summary::before { content: '▸ '; } .mks-fold[open] > summary::before { content: '▾ '; }
  .mks-fold > summary span { color: #8b93a3; font-weight: 400; font-size: 12px; }
  .mks-fold > .mks-fold-body { padding: 0 10px 10px; } .mks-rules { font-size: 12.5px; color: #cbd5e1; padding-left: 18px; } .mks-rules li { margin: 4px 0; line-height: 1.45; }
  @media (max-width: 1100px) { .mks-top { grid-template-columns: 1fr; } }
  @media (max-width: 1440px) {
    .mks-days .mks-chh { width: 96px; } .mks-ch { font-size: 11.5px; } .mks-ch small { display: none; }
    .mks-grid td { padding: 3px; } .mks-card { padding: 3px 4px; font-size: 10.5px; } .mks-card b { font-size: 11px; } .mks-ic svg { width: 11px; height: 11px; }
    .mks-weeks .c-wk { width: 74px; } .mks-weeks .c-em { width: 104px; } .mks-sell { font-size: 10.5px; }
  }
  `;
  if (!document.getElementById('mks-style')) {
    const st = document.createElement('style');
    st.id = 'mks-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
})();
