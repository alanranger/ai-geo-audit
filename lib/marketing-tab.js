/**
 * Marketing & Campaigns tab (Planning & Optimisation). Everything personal comes from /api/aigeo/marketing with the
 * admin key; nothing is sent, scheduled or changed in Squarespace from here. Campaign steps are the same records and
 * ticks as before (lib/strategy-board.js paints them here); Strategy & Actions shows a one-line "Next campaign" link.
 */
(function () {
  const API = '/api/aigeo/marketing';
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const ukDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '—');
  const ukStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const hoursAgo = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity);
  const STALE_H = 26;
  const state = { data: null, params: {}, picked: new Set(), customers: { page: 0, q: '', segment_id: '' } };

  const CAT_LABEL = { beginners: 'Beginners', lightroom: 'Lightroom', course: 'Course', abstract_macro: 'Abstract/macro', woodland: 'Woodland', day_workshop: 'Day workshop', residential: 'Residential', one_to_one: '1-2-1', mentoring: 'Mentoring', academy: 'Academy', voucher_bought: 'Voucher bought', voucher_redeemed: 'Voucher redeemed', pick_n_mix: 'Pick n Mix' };
  const REASON = {
    not_subscribed: 'not subscribed', no_email: 'no email (Booking Sheet name only)', no_squarespace_profile: 'no Squarespace contact', deleted_in_squarespace: 'deleted in Squarespace',
    no_matching_history: 'no matching history', history_incomplete: 'history incomplete (shown separately)', too_far: 'too far', distance_unknown: 'distance unknown (no postcode)',
    has_future_booking: 'already booked ahead', already_booked_that_date: 'already booked on the promoted date', booked_recently: 'booked recently', no_evidenced_booking: 'no evidenced booking',
    academy_member: 'already an Academy member', not_academy_trial: 'no Academy trial', fewer_bookings: 'fewer than 2 bookings', not_a_gift_buyer: 'not a gift buyer', duplicate_email: 'duplicate email (counted once)',
    recently_emailed: 'emailed recently', no_longer_in_sources: 'no longer in sources', 'query:unknown': 'undecided (unknown data)', 'query:not_matched': 'does not match the filter'
  };
  const reasonText = (k) => REASON[k] || String(k).replace(/^suppressed:/, 'suppressed: ').replace(/^has_history:/, 'has ').replace(/^recent:/, 'recent ').replace(/^engagement:/, 'engagement: ').replace(/_/g, ' ');

  async function api(method, query, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) throw new Error('NO_KEY');
    const r = await fetch(`${API}${query || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const qs = (o) => `?${new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`;
  const paramQuery = () => ({ centre: state.params.centre, max_miles: state.params.max_miles, promoted_date: state.params.promoted_date, warm_days: state.params.warm_days, cooling_days: state.params.cooling_days });

  /* ---------- data health (Overview tile 10) ---------- */

  function sourceWarnings(d) {
    const out = [];
    for (const step of ['profiles', 'orders', 'postcodes', 'customers']) {
      const r = d.runs[`sync:${step}`];
      if (!r || r.status !== 'ok') out.push(`Squarespace sync (${step}) ${r ? r.status : 'never run'}`);
      else if (hoursAgo(r.finished_at) > STALE_H) out.push(`Squarespace sync (${step}) last ran ${ukStamp(r.finished_at)}`);
    }
    const c = d.runs.collector_latest;
    if (!c) out.push('Email-report collector not set up yet on Alan\'s PC');
    else if (c.status !== 'ok' || hoursAgo(c.finished_at || c.heartbeat_at) > STALE_H) out.push(`Email-report collector ${c.status === 'ok' ? 'stale' : c.status} (${ukStamp(c.finished_at || c.heartbeat_at)})`);
    if (d.meter.state !== 'fresh') out.push(`Send meter ${d.meter.state.replace('_', ' ')}`);
    if (d.identity.suppressed_but_subscribed > 0) out.push(`Suppressed contacts showing as subscribed again in Squarespace: ${blockedSplit(d.identity)}`);
    return out;
  }
  /** "3 total · 2 decided (keep blocked) · 1 new" (shared decision state counts); the decided ones are never reopened. */
  const blockedSplit = (i) => (i.suppressed_decided != null ? `${n(i.suppressed_total)} total · ${n(i.suppressed_decided)} decided (keep blocked) · ${n(i.suppressed_new)} new` : n(i.suppressed_but_subscribed));
  function listWarnings(d) {
    const out = [];
    const blocked = (d.exports || []).filter((e) => e.status === 'blocked_do_not_send' && !e.is_test).length;
    if (blocked) out.push(`${blocked} Squarespace list(s) BLOCKED after import — do not send`);
    if (d.reconcile?.flagged) out.push(`${d.reconcile.flagged} campaign recipient(s) outside the checked audience`);
    const dirty = (d.reconcile?.no_pass || 0) - (d.reconcile?.no_pass_clean ?? d.reconcile?.no_pass ?? 0);
    if (dirty > 0) out.push(`${dirty} campaign(s) sent without a Pre-send PASS reached people outside the checked audience`);
    return out;
  }
  /** Past sends with no Pre-send PASS whose after-send check is clean: a rule gap to note, nothing to stop. */
  function passGapWarnings(d) {
    const clean = d.reconcile?.no_pass_clean || 0;
    if (!clean) return [];
    const after = d.reconcile.unsubscribed_after ? ` (${d.reconcile.unsubscribed_after} unsubscribed afterwards, from the email itself)` : '';
    return [`${clean} sent campaign(s) had no Pre-send PASS in the 30 minutes before (Squarespace schedule); every recipient was in the checked audience${after}`];
  }
  /** Blocked = a list or delivery problem that stops sending; attention = a source stale, failed or never run, or a past rule gap. */
  window.mkHealthIssues = (d) => ({ blocked: listWarnings(d), attention: [...sourceWarnings(d), ...passGapWarnings(d)] });

  /* ---------- send budget ---------- */

  const STAGE_TXT = { scheduled: 'Squarespace schedule', snapshot: 'frozen snapshot', review_snapshot: 'review snapshot (provisional, awaiting send approval)', reserved: 'typed reservation (provisional)', estimate: 'live estimate (provisional)', unbudgeted: 'UNBUDGETED — choose audience', sent: 'sent' };
  const SIDE_TXT = { current: 'this cycle', next: 'next cycle', unallocated: 'unallocated (no send time on a reset day)', later: 'later', previous: 'previous cycle' };
  const RELEASE_TXT = { released: 'released (in the meter)', pending_reconciliation: 'pending reconciliation', cancel_unconfirmed: 'cancelled — not confirmed in Squarespace' };
  const EV_TXT = { seen: 'seen (collector)', operator_verified: 'operator-verified', manual: 'manual' };
  const evText = (e) => (e ? `${EV_TXT[e.kind] || e.kind} · ${ukStamp(e.at)}` : 'planned / unverified');
  const sendText = (x) => (x.send_at ? ukStamp(x.send_at) : (x.send_day ? `${ukDate(x.send_day)} (no time)` : 'no time'));
  const sentLists = (x) => (x.sent && x.sent.lists && x.sent.lists.length ? `sent to ${x.sent.lists.join(' + ')}` : '');
  const audText = (x) => sentLists(x) || (x.provider && x.provider.lists ? x.provider.lists.join(' + ') : '') || (x.snapshot && x.snapshot.list_name) || x.audience || (x.estimate ? 'audience by rule (estimate)' : 'audience not chosen');
  const stageText = (x) => (x.stage === 'estimate' && x.estimate && !x.estimate.live ? `estimate${x.estimate.as_of ? ` as of ${ukDate(x.estimate.as_of)}` : ''} (provisional, not frozen)` : STAGE_TXT[x.stage] || x.stage);
  const ruleText = (x) => (x.estimate && x.estimate.rule ? ` · ${x.estimate.rule}` : '');
  function deliveryRow(x) {
    const amt = x.amount == null ? '<span class="mk-chip warn">UNBUDGETED</span>' : n(x.amount);
    return `<tr><td class="left">${esc(x.title)}${x.review ? ' <span class="mk-chip warn">not linked</span>' : ''}<div class="rt-sub">${esc(audText(x) + ruleText(x))}</div></td>`
      + `<td class="left">${esc(stageText(x))}</td><td>${amt}</td><td class="left">${esc(sendText(x))}<div class="rt-sub">${esc(SIDE_TXT[x.side] || x.side)}</div></td>`
      + `<td class="left">${esc(evText(x.evidence))}</td><td class="left">${esc(x.cancelled && x.release === 'released' ? 'cancelled (released)' : RELEASE_TXT[x.release] || x.bucket)}</td></tr>`;
  }
  /** Squarespace schedules not matched to one campaign: budgeted once meanwhile; link (or mark external) here. */
  function reviewQueueHtml(m) {
    const q = (m.deliveries || []).filter((x) => x.review && !x.sent && !x.cancelled);
    if (!q.length) return '';
    const camps = (m.deliveries || []).filter((x) => x.campaign_key && !x.review).map((x) => x.campaign_key);
    const opts = [...new Set([...camps, ...q.flatMap((x) => x.provider?.link_candidates || [])])].map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    return `<h4>Squarespace schedules to link (${n(q.length)})</h4><table class="rt-table"><tbody>${q.map((x) => `<tr><td class="left">${esc(x.title)} · ${ukStamp(x.send_at)} · ${n(x.amount)}<div class="rt-sub">${esc(x.provider?.link_state === 'ambiguous' ? `could be ${x.provider.link_candidates.join(' or ')}` : 'no campaign record has this email or its list')}</div></td>`
      + `<td><select data-mk-slink-sel="${esc(x.provider.email_id)}"><option value="">Link to…</option>${opts}<option value="__external">Not a dashboard campaign (keep budgeted)</option></select> <button type="button" class="rf-btn rf-btn-secondary" data-mk-slink="${esc(x.provider.email_id)}">Link</button></td></tr>`).join('')}</tbody></table><div id="mk-slink-out" class="rt-sub"></div>`;
  }
  function capacityTable(m, s) {
    const cap = typeof window.mkCapacity === 'function' ? window.mkCapacity(state.data || { meter: m }, s) : null;
    if (!cap) return '';
    const rows = window.mkCapacityRows(cap).map(([label, value, title]) => `<tr title="${esc(title)}"><td class="left">${esc(label)}</td><td>${value}</td></tr>`).join('');
    const note = cap.projected_incomplete ? '<p class="rt-sub">Projected is <b>incomplete</b>: a missing audience (or a send with no time on a reset day) is not deducted.</p>' : '';
    return `<table class="rt-table mk-kv"><tbody>${rows}</tbody></table>${note}`;
  }
  function budgetHtml(m, s) {
    if (m.state === 'never_read') return `<div class="rt-section" id="mk-budget"><h3>Email send budget (billing cycle)</h3><p class="rt-sub">${esc(m.note)}</p></div>`;
    const live = (m.deliveries || []).filter((x) => x.bucket !== 'released' || x.side === 'current');
    const sent = m.sent_this_cycle.length ? m.sent_this_cycle.map((x) => `<tr><td class="left">${esc(x.subject)}</td><td>${n(x.recipients)}</td><td>${ukStamp(x.sent_on)}</td></tr>`).join('') : '<tr><td class="left rt-sub" colspan="3">None collected yet for this cycle (filled by the email-report collector).</td></tr>';
    const stale = m.state === 'fresh' ? '' : '<span class="rt-pill warn">STALE</span>';
    const over = m.capacity?.overage ? `<div class="mk-note bad"><b>Over capacity: committed sends this cycle exceed what Squarespace has left by ${n(m.capacity.overage)}.</b> No delivery in this cycle can be READY until a send is moved after the reset or made smaller.</div>` : '';
    const read = m.schedule_read;
    return `<div class="rt-section" id="mk-budget"><h3>Email send budget (billing cycle) ${stale}</h3>`
      + `<p class="rt-sub">Cycle ${ukStamp(m.cycle?.start)} → resets ${ukStamp(m.cycle?.reset)} (Squarespace's own reset instant; never a calendar month, no rollover, no borrowing). Meter read ${ukStamp(m.captured_at)} (${m.age_hours} h ago) · Squarespace Scheduled tab ${read?.last_ok_at ? `read ${ukStamp(read.last_ok_at)}` : 'not read yet'}${read?.failed_since_ok ? ` (latest read ${esc(read.last_status)} — last good read kept)` : ''}. Every campaign on the account uses this allowance, including ones scheduled outside this dashboard.</p>`
      + `${over}${capacityTable(m, s)}`
      + `<h4>Deliveries holding or needing a reservation</h4><div class="mk-wide"><table class="rt-table"><thead><tr><th class="left">Email</th><th class="left">Reservation from</th><th>Recipients</th><th class="left">Send</th><th class="left">Evidence</th><th class="left">State</th></tr></thead><tbody>${live.map(deliveryRow).join('') || '<tr><td class="left rt-sub" colspan="6">No email deliveries recorded yet.</td></tr>'}</tbody></table></div>`
      + reviewQueueHtml(m)
      + `<h4>Sent this cycle</h4><table class="rt-table"><thead><tr><th class="left">Email</th><th>Recipients</th><th>Sent</th></tr></thead><tbody>${sent}</tbody></table></div>`;
  }
  /** Over capacity this cycle and this campaign's email is committed in it: never READY. */
  function overFor(campaignKey) {
    const m = state.data?.meter;
    if (!m?.capacity?.overage) return null;
    const dl = (m.deliveries || []).find((x) => x.campaign_key === campaignKey && x.bucket === 'committed' && x.side === 'current');
    return dl ? m.capacity.overage : null;
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-mk-slink]');
    if (!btn) return;
    const id = btn.dataset.mkSlink;
    const v = document.querySelector(`[data-mk-slink-sel="${CSS.escape(id)}"]`)?.value;
    const out = document.getElementById('mk-slink-out');
    if (!v) { if (out) out.textContent = 'Choose a campaign (or "not a dashboard campaign") first.'; return; }
    api('POST', '', v === '__external' ? { action: 'schedule-link', email_id: id, external: true } : { action: 'schedule-link', email_id: id, campaign_key: v })
      .then(() => render(document.getElementById('marketing-root')))
      .catch((err) => { if (out) out.innerHTML = `<span class="mk-chip warn">${esc(err.message)}</span>`; });
  });

  /* ---------- segments + audience snapshot ---------- */

  function topReasons(ex) {
    const skip = /^(not_subscribed|no_email|no_squarespace_profile|suppressed|deleted_in_squarespace|no_longer)/;
    return Object.entries(ex || {}).filter(([k]) => !skip.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${n(v)} ${esc(reasonText(k))}`).join(' · ') || '—';
  }
  function settingsRow() {
    const p = state.params;
    const inp = (k, ph, type, w) => `<label class="st-ov-f mk-f">${ph}<input data-mkp="${k}" type="${type}" value="${esc(p[k] || '')}" placeholder="${esc(ph)}" style="width:${w}"></label>`;
    return `<div class="mk-params">${inp('centre', 'Centre postcode (default CV4 9HW)', 'text', '9rem')}${inp('max_miles', 'Radius miles (default 30)', 'number', '6rem')}${inp('promoted_date', 'Promoted date', 'date', '10rem')}${inp('warm_days', 'Warm ≤ days (90)', 'number', '5rem')}${inp('cooling_days', 'Cooling ≤ days (180)', 'number', '5rem')}<button type="button" class="rf-btn rf-btn-secondary" data-mk="apply-params">Apply</button></div>`;
  }
  /** "+ N owner address(es)": Alan's own business / personal addresses get a copy but are never counted as clients. */
  function ownerSub(count, kinds) {
    if (!count) return '';
    const k = Object.entries(kinds || {}).map(([x, v]) => `${v} ${x}`).join(', ');
    return `<div class="rt-sub" title="Your own addresses (owner / test) that match this segment: they get an owner copy and are never counted as clients">+ ${n(count)} owner address${count === 1 ? '' : 'es'}${k ? ` (${esc(k)})` : ''}</div>`;
  }
  /** Alan's business address always gets a copy even when it doesn't match: shown on its own, never in a count. */
  const copyLine = (c) => (c ? '<div class="rt-sub" title="Your business @alanranger.com address always receives a copy of the campaign, even when it doesn\'t match the segment; not counted">· business copy to your @alanranger.com address on</div>' : '');
  function segmentsHtml(d) {
    const rows = d.segments.map((s) => `<tr><td><input type="checkbox" data-mk-pick="${esc(s.segment_id)}" ${state.picked.has(s.segment_id) ? 'checked' : ''} aria-label="Pick"></td>`
      + `<td class="left"><b>${esc(s.name)}</b> <span class="mk-chip" title="${esc(s.english || '')}">v${esc(s.version || 1)}</span><div class="rt-sub">${esc(s.description || '')}</div><div class="rt-sub">as of ${ukStamp(s.as_of)}</div></td>`
      + `<td><b>${n(s.count)}</b> <span class="rt-sub">people</span>${ownerSub(s.owner_included ?? s.admin_included, s.owner_kinds)}${copyLine(s.business_copy)}</td><td class="left rt-sub">${topReasons(s.exclusions)}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-mk-view="${esc(s.segment_id)}">People</button> <button type="button" class="rf-btn rf-btn-secondary" data-mk-openq="${esc(s.segment_id)}" title="Open this exact definition in Customers (same count)">Open in Customers</button></td></tr>`).join('');
    return `<div class="rt-section" id="mk-segments"><h3>Customers &amp; segments</h3>`
      + '<p class="rt-sub">Only people who are subscribed in Squarespace, not suppressed and still in Squarespace can be in a segment. "Booked" is not "attended" (the Booking Sheet has no attendance column). History from Booking Sheet names alone is probable, never merged; people with incomplete history are counted apart, not as "never". Booking Sheet coverage is 2024 onward; Squarespace orders go back to 2014.</p>'
      + settingsRow()
      + `<table class="rt-table" id="mk-seg-table"><thead><tr><th></th><th class="left">Segment</th><th>People</th><th class="left">Main reasons others are out</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      + snapshotForm(d) + '</div>';
  }
  function snapshotForm(d) {
    const block = d.import_block?.blocked ? `<div class="mk-note warn"><b>Squarespace list import is blocked.</b> ${esc(d.import_block.reason)} (controlled test ${esc(ukDate(d.import_block.tested_on))}).</div>`
      : `<p class="rt-sub"><b>About list imports:</b> ${esc(d.import_block?.reason || '')}</p>`;
    return `<div class="mk-snap"><h4>Audience snapshot for a campaign</h4><p class="rt-sub">Tick one or more segments: people in several are counted once. Making a snapshot re-reads consent from Squarespace first, then saves the audience (server-side only) for planning and send reservations. Give it a campaign record key to load it into a Squarespace list.</p>${block}`
      + `<label class="st-ov-f mk-f">Campaign short name<input id="mk-snap-camp" type="text" placeholder="e.g. Jan beginners" style="width:12rem"></label>`
      + `<label class="st-ov-f mk-f">Campaign record key (optional)<input id="mk-snap-key" type="text" placeholder="email|2026-11-09" style="width:12rem"></label>`
      + `<label class="st-ov-f mk-f">List name<input id="mk-snap-name" type="text" maxlength="75" style="width:22rem"></label>`
      + '<label class="rt-sub" title="Your own business / personal addresses get a copy as a separate owner line; never counted as clients"><input id="mk-snap-owner" type="checkbox" checked> include owner copy + business copy (your own addresses, not counted)</label> '
      + `<button type="button" class="rf-btn" data-mk="preview">Count &amp; review picked</button> <button type="button" class="rf-btn" data-mk="snapshot">Make snapshot</button><div id="mk-snap-out" class="rt-sub"></div><div id="mk-snap-review"></div></div>`;
  }

  /* ---------- exports ---------- */

  const LOAD_STEPS = 4;
  const minsAgo = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 60000 : Infinity);
  const tallyText = (o) => Object.entries(o || {}).map(([k, v]) => `${n(v)} ${esc(reasonText(k.replace(/^(dropped|after):/, '')))}`).join(' · ');

  /** Queued / running load: % bar, step, elapsed, alive or stalled (the PC heartbeats every step). */
  function loadProgress(r) {
    const done = r.items_done || 0;
    const pct = Math.round((done / LOAD_STEPS) * 100);
    const beat = r.heartbeat_at || r.started_at;
    const alive = r.status === 'queued' ? (minsAgo(r.started_at) < 10 ? 'waiting for Alan\'s PC (checks every 5 min)' : '<b>no pick-up for 10+ min — is Alan\'s PC on?</b>')
      : (minsAgo(beat) < 4 ? 'alive' : '<b>stalled</b> — no update for 4+ min');
    return `<div class="mk-prog"><div style="width:${pct}%"></div></div><div class="rt-sub">${pct}% · step ${Math.min(done + 1, LOAD_STEPS)} of ${LOAD_STEPS}: ${esc(r.checkpoint?.step || '')} · ${Math.round(minsAgo(r.started_at))} min · ${alive}</div>`;
  }
  function loadedText(e) {
    const l = e.load_result || {};
    const sub = l.all_subscribers_before != null ? ` · All Subscribers ${n(l.all_subscribers_before)} → ${n(l.all_subscribers_after)}${l.all_subscribers_after_fix != null ? ` → ${n(l.all_subscribers_after_fix)} after fix` : ''}` : '';
    const fix = l.fixed ? ` · <b>${n(l.fixed)} switched on by the import, set back to unsubscribed and taken off the list</b> (${ukStamp(l.fixed_at)})` : '';
    return `${n(l.imported)} imported · list shows ${n(l.list_count_after_fix ?? l.list_count)}${l.dropped && Object.keys(l.dropped).length ? ` · dropped before import: ${tallyText(l.dropped)}` : ''}${sub}${fix}`;
  }
  /** Repair queue state: stays until every switched-on person is confirmed unsubscribed again (retried every 5 min). */
  function repairText(e) {
    const r = e.load_result?.repair;
    if (e.load_result?.unreadable) return '<div class="rt-sub">Some subscription records could not be read after the import: load again (the repair queue cannot rule out a re-subscribe).</div>';
    if (!r) return '<div class="rt-sub">Repair queue: waiting for Alan\'s PC (checks every 5 minutes, retries until confirmed).</div>';
    return `<div class="rt-sub">Repair queue: ${n(r.waiting ?? e.load_result?.flips)} waiting · attempt ${n(r.attempts)} · last try ${ukStamp(r.last_try_at)}${r.last_error ? ` (${esc(r.last_error)})` : ''} · Alan's PC retries every 5 minutes until each is confirmed.</div>`;
  }
  function loadCell(e) {
    const r = e.load_run;
    if (r && ['queued', 'running'].includes(r.status)) return `<div data-mk-run="${esc(r.run_id)}">${loadProgress(r)}</div>`;
    if (e.status === 'blocked_do_not_send') return `<span class="rt-pill bad">BLOCKED — DO NOT SEND</span><div class="rt-sub">${n(e.load_result?.flips)} person(s) switched to subscribed by the import. ${esc(e.load_result?.action || '')}</div>${repairText(e)}<div class="rt-sub">${loadedText(e)}</div>`;
    if (e.status === 'loaded') return `<span class="rt-pill ok">LOADED</span> <span class="rt-sub">${ukStamp(e.loaded_at)}</span><div class="rt-sub">${loadedText(e)}</div>`;
    if (e.status === 'load_failed') return `<span class="rt-pill warn">LOAD FAILED</span><div class="rt-sub">${esc(r?.error || (e.status_history || []).slice(-1)[0]?.note || '')}</div>`;
    return '<span class="rt-sub">not loaded</span>';
  }
  /** Send rule on every loaded list and its campaign record; once PASS, a live mm:ss countdown to the end of the 30 minutes. */
  const SEND_RULE = 'Press Pre-send check, then send in Squarespace within 30 minutes';
  const PASS_MS = 30 * 60000;
  const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const passLeft = (end) => (end - Date.now() > 0 ? `PASS valid ${mmss(end - Date.now())} more` : 'PASS expired — check again');
  function sendRule(p) {
    const end = p.state === 'pass' ? Date.parse(p.at) + PASS_MS : null;
    return `<div class="mk-send-rule"><b>${SEND_RULE}.</b>${end ? ` <b class="mk-countdown" data-mk-countdown="${end}">${passLeft(end)}</b>` : ''}</div>`;
  }
  function tickCountdowns() {
    document.querySelectorAll('[data-mk-countdown]').forEach((el) => {
      const end = Number(el.dataset.mkCountdown);
      el.textContent = passLeft(end);
      if (end > Date.now()) return;
      el.removeAttribute('data-mk-countdown');
      el.classList.add('expired');
      const pill = el.closest('[data-mk-pass]')?.querySelector('.rt-pill');
      if (pill) { pill.className = 'rt-pill warn'; pill.textContent = pill.dataset.expired || 'NOT CHECKED'; }
    });
  }
  setInterval(tickCountdowns, 1000);

  /** "1 later opt-out, already excluded by Squarespace (native 575 = manifest 576 − 1)" (or why it did not reconcile). */
  const presendNote = (r) => (r?.note ? `<div class="rt-sub" data-mk-presend-note>${esc(r.note)}${r.recipients_now != null ? ` · Squarespace will send to ${n(r.recipients_now)}` : ''}</div>` : '');
  function presendPill(e, p) {
    if (p.state === 'pass') return `<span class="rt-pill ok" data-expired="NOT CHECKED">PASS</span> <span class="rt-sub">${ukStamp(p.at)}</span>${presendNote(e.presend_result)}`;
    if (p.state === 'fail') return `<span class="rt-pill bad">FAIL</span> <span class="rt-sub">${ukStamp(p.at)} · ${tallyText(e.presend_result?.failures)}</span>${presendNote(e.presend_result)}`;
    return `<span class="rt-pill warn">NOT CHECKED</span>${p.expired_at ? ` <span class="rt-sub">last PASS ${ukStamp(p.expired_at)} (over 30 min)</span>` : ''}`;
  }
  function presendCell(e) {
    const p = e.presend || {};
    if (!e.sqs_list_id) return '<span class="rt-sub">—</span>';
    if (e.status === 'blocked_do_not_send') return '<span class="rt-pill bad">DO NOT SEND</span> <span class="rt-sub">list blocked</span>';
    const closed = e.campaign_key ? closedState(e.campaign_key) : null;
    if (closed) return `<span class="rt-sub">${closed} · no pre-send needed</span>`;
    return `<div data-mk-pass>${presendPill(e, p)}${e.status === 'loaded' ? sendRule(p) : ''}</div>`;
  }
  function exportActions(e) {
    const b = (attr, label) => `<button type="button" class="rf-btn rf-btn-secondary" ${attr}="${e.export_id}">${label}</button>`;
    const canLoad = ['pending_import', 'load_failed'].includes(e.status) && (e.is_test || e.campaign_key);
    return [b('data-mk-review', 'Review people'), canLoad ? b('data-mk-load', 'Load into Squarespace list') : '', e.sqs_list_id ? b('data-mk-presend', 'Pre-send check') : '', e.status !== 'cancelled' ? b('data-mk-cancel', 'Cancel') : ''].join(' ');
  }
  function reconcileHtml(rec) {
    if (!rec?.checked) return '<p class="rt-sub">After-send check: no campaign has been sent to a list loaded from here yet. When one is, its delivered list (from the email-report collector) is checked against the people who passed for that list.</p>';
    const bad = rec.rows.filter((r) => r.flagged);
    const noPass = rec.rows.filter((r) => !r.is_test && !r.pass_before);
    const noPassNote = noPass.length ? `<div class="mk-note bad"><b>Sent without a Pre-send PASS in the 30 minutes before:</b> ${noPass.map((r) => `"${esc(r.subject)}" (${ukStamp(r.sent_on)}) → ${esc(r.list_name)}`).join('; ')}</div>` : '';
    if (!bad.length) return `<p class="rt-sub">After-send check: ${n(rec.checked)} campaign(s) sent to lists loaded from here; every recipient was in the checked audience.</p>${noPassNote}`;
    return `<div class="mk-note bad"><b>After-send check: ${n(rec.flagged)} recipient(s) outside the checked audience.</b> ${bad.map((r) => `"${esc(r.subject)}" (${ukDate(r.sent_on)}) → ${esc(r.list_name)}: ${n(r.flagged)} of ${n(r.recipients)}`).join('; ')}</div>${noPassNote}`;
  }
  const RESIDUAL_RISK = 'Residual risk: these checks only cover sends prepared here. Starting a campaign in Squarespace outside the dashboard, or sending to a list after its 30-minute PASS has run out, skips the pre-send check; Squarespace automations that fire when someone joins a list or subscribes could also send during the minutes an import has switched someone on (check Marketing → Email Campaigns → Automations before every load).';
  const preFix = (o) => (o && o.frozen_rule ? '' : '<div class="rt-sub" title="frozen before 8 Nov 2026 20:28: may include an organisation and a second owner address; not changed">pre-fix snapshot</div>');
  const snapOwner = (o) => (!o ? preFix(o) : (o.included ? `${ownerSub(o.count, o.kinds)}${copyLine(o.business_copy)}` : '<div class="rt-sub">owner copy left out</div>') + preFix(o));
  function exportsHtml(d) {
    const tests = d.exports.filter((e) => e.is_test).length;
    const shown = d.exports.filter((e) => state.showTests || !e.is_test);
    const accepted = d.import_block?.residual_risk_accepted_by ? ` <b>Accepted by ${esc(d.import_block.residual_risk_accepted_by)}.</b>` : '';
    const block = d.import_block?.production_load_blocked ? `<div class="mk-note">${esc(d.import_block.production_load_reason)}</div>` : '';
    const toggle = tests ? `<button type="button" class="rf-btn rf-btn-secondary" data-mk-tests="1">${state.showTests ? 'Hide' : 'Show'} test snapshots (${n(tests)})</button>` : '';
    const rows = shown.map((e) => `<tr><td class="left">${esc(e.list_name)}${e.is_test ? ' <span class="mk-chip">test</span>' : ''}<div class="rt-sub">${e.campaign_key ? `campaign ${esc(e.campaign_key)}` : (e.is_test ? 'business addresses only' : 'no campaign record — link one to load')}</div></td>`
      + `<td>${n(e.eligible_count)}${snapOwner(e.owner)}</td><td>${statusPill(e.status)}</td><td class="left mk-load">${loadCell(e)}</td><td class="left">${presendCell(e)}</td><td>${ukStamp(e.created_at)}</td><td>${exportActions(e)}</td></tr>`).join('');
    return `<div class="rt-section" id="mk-exports"><h3>Audience snapshots</h3>`
      + '<p class="rt-sub">"Load into Squarespace list" runs on Alan\'s PC: consent is re-read from Squarespace just before the import, only people who pass go in, and consent is re-read straight after. Anyone the import switched to subscribed is set back with Squarespace\'s own opt-out (which also takes them off the list) and confirmed; if that can\'t be confirmed the list is BLOCKED (do not send). Run "Pre-send check" just before sending: a PASS is valid for 30 minutes, and a campaign only shows READY TO SEND while it lasts. A list name already used (here or in Squarespace) is refused, never renamed or added to. Test snapshots are hidden here and can never be used for a campaign.</p>'
      + `${block}<p class="rt-sub">${esc(RESIDUAL_RISK)}${accepted}</p><div class="mk-params">${toggle}</div><div class="mk-wide"><table class="rt-table" id="mk-exp-table"><thead><tr><th class="left">List name</th><th>People</th><th>Status</th><th class="left">Load</th><th class="left">Pre-send</th><th>Made</th><th></th></tr></thead><tbody>${rows || '<tr><td class="left rt-sub" colspan="7">None yet.</td></tr>'}</tbody></table></div>`
      + `${reconcileHtml(d.reconcile)}<div id="mk-exp-out" class="rt-sub"></div><div id="mk-exp-review"></div></div>`;
  }
  const PILL = { loaded: 'ok', imported: 'ok', blocked_do_not_send: 'bad', blocked: 'warn', load_failed: 'warn' };
  const statusPill = (s) => `<span class="rt-pill ${PILL[s] || 'current'}">${esc(String(s).replace(/_/g, ' ').toUpperCase())}</span>`;

  /** Campaign record chip (Marketing tab campaign steps): latest pre-send state of the record's audience list. */
  /** READY TO SEND only with a PASS under 30 minutes old on a non-test list; anything else says why not. */
  /** Sent / cancelled / superseded records have nothing left to send: the server delivery, else the record itself. */
  function closedState(campaignKey, rec) {
    const dl = (state.data?.meter?.deliveries || []).find((x) => x.campaign_key === campaignKey);
    if (dl?.sent || ['sent', 'measured'].includes(rec?.stage)) return 'sent';
    if (dl?.cancelled || rec?.stage === 'cancelled') return 'cancelled';
    return rec?.covered_by?.length ? 'superseded' : null;
  }
  window.mkClosedState = closedState;
  window.mkPresendChip = function mkPresendChip(campaignKey, rec) {
    if (closedState(campaignKey, rec)) return '';
    const e = (state.data?.exports || []).find((x) => x.campaign_key === campaignKey && x.sqs_list_id && !x.is_test);
    if (!e) return /^email\|/.test(campaignKey) ? '<div><span class="rt-pill warn">NOT READY TO SEND</span> <span class="rt-sub">no checked audience list</span></div>' : '';
    if (e.status === 'blocked_do_not_send') return '<div><span class="rt-pill bad">LIST BLOCKED — DO NOT SEND</span></div>';
    const over = overFor(campaignKey);
    if (over) return `<div><span class="rt-pill bad">NOT READY — OVER ALLOWANCE BY ${n(over)}</span> <span class="rt-sub">move a send after the reset or make one smaller</span></div>`;
    const p = e.presend || {};
    if (p.state === 'pass') return `<div data-mk-pass><span class="rt-pill ok" data-expired="NOT READY TO SEND">READY TO SEND</span> <span class="rt-sub">pre-send PASS ${ukStamp(p.at)}</span>${presendNote(e.presend_result)}${sendRule(p)}</div>`;
    if (p.state === 'fail') return `<div><span class="rt-pill bad">NOT READY — PRE-SEND FAIL</span>${presendNote(e.presend_result)}${sendRule(p)}</div>`;
    return `<div><span class="rt-pill warn">NOT READY TO SEND</span>${sendRule(p)}</div>`;
  };

  /* ---------- customers ---------- */

  function histChips(cats) {
    return Object.entries(cats || {}).filter(([, v]) => v.c > 0 || v.p > 0).map(([k, v]) => `<span class="mk-chip ${v.c > 0 ? '' : 'prob'}" title="${v.c} confirmed · ${v.p} probable${v.future_c ? ` · ${v.future_c} ahead` : ''}">${esc(CAT_LABEL[k] || k)}${v.c > 0 ? '' : '?'}</span>`).join(' ');
  }
  const engChip = (e) => `<span class="mk-eng mk-eng-${esc(e.open)}" title="Opens: ${esc(e.open)} · clicks: ${esc(e.click)} · last opened ${esc(ukDate(e.last_opened_at))} · last clicked ${esc(ukDate(e.last_clicked_at))} · ${esc(e.last5 || 'no tracked emails')}">${esc(e.open.replace('_', ' '))} / ${esc(e.click.replace('_', ' '))}</span>`;
  function customerRow(r) {
    const flags = [r.history_incomplete ? '<span class="mk-chip prob" title="Some history is probable (Booking Sheet name match) or Squarespace shows more orders than are linked">incomplete</span>' : '', r.bought_for_others ? `<span class="mk-chip" title="Bought places for someone else">gift buyer ×${r.bought_for_others}</span>` : '', r.suppressed ? `<span class="mk-chip warn">${esc(r.suppressed)}</span>` : ''].join(' ');
    const b = state.badges?.[r.person_id];
    const badges = window.mkBadge ? window.mkBadge.cells(b) : '';
    return `<tr data-mk-person="${r.person_id}"><td class="left">${esc(r.name || '—')}${kindChip(b)}<div class="rt-sub">${esc(r.email || r.kind)}</div></td>${badges}<td>${r.subscribed ? '<span class="rt-pill ok">YES</span>' : '<span class="rt-pill">NO</span>'}</td>`
      + `<td>${r.miles == null ? '<span class="rt-sub">unknown</span>' : `${r.miles} mi`}</td><td class="left">${histChips(r.cats)}</td><td>${ukDate(r.last_booking)}</td><td>${r.future.length || ''}</td><td>${esc(r.academy || '')}</td><td>${engChip(r.engagement)}</td><td class="left">${flags}</td></tr>`;
  }
  function customersShell(d) {
    const opts = d.segments.map((s) => `<option value="${esc(s.segment_id)}">${esc(s.name)}</option>`).join('');
    return `<div class="rt-section" id="mk-customers"><h3>Segment members</h3><p class="rt-sub">Who is in each built-in segment (use Customers above for any other mix of filters). One row per person. Grey "?" history = probable only (a Booking Sheet name that exactly matches one Squarespace contact). Distance is from the profile postcode (else the latest billing postcode) to the centre above — where someone attended is not where they live. Engagement = opens / clicks band (Release 2; "unknown" until the email-report collector has read their emails).</p>`
      + `<div class="mk-params"><input id="mk-cust-q" type="search" placeholder="Search name or email" style="width:16rem"> <select id="mk-cust-seg"><option value="">Everyone</option>${opts}</select> <label class="rt-sub"><input id="mk-cust-sub" type="checkbox"> subscribed only</label> <button type="button" class="rf-btn rf-btn-secondary" data-mk="cust-search">Show</button></div>`
      + '<div id="mk-cust-body"><p class="rt-sub">Pick a segment or search, then Show.</p></div><div id="mk-detail"></div></div>';
  }
  const kindChip = (b) => (b?.owner ? ` <span class="mk-chip" title="Your own address: never counted as a client">${b.business ? 'business copy' : 'owner address'}</span>` : (b?.organisation ? ' <span class="mk-chip">organisation</span>' : ''));
  const COPY_LINE = ' · business copy to your @alanranger.com address on';
  const ownerText = (k) => (k ? ` · + ${n(k)} owner address${k === 1 ? '' : 'es'}` : '');
  /** "39 people · + 1 owner address · business copy …": the segment's own split when the list is that whole segment. */
  function countLine(j) {
    const c = state.customers;
    const seg = c.segment_id && !c.q && !c.sub ? state.data.segments.find((s) => s.segment_id === c.segment_id) : null;
    if (seg && seg.count + (seg.owner_included || 0) + (seg.business_copy || 0) === j.total) return `${n(seg.count)} people${ownerText(seg.owner_included)}${seg.business_copy ? COPY_LINE : ''}`;
    if (j.total > j.page_size) return `${n(j.total)} records (owner and organisation rows are marked)`;
    const bs = j.rows.map((r) => state.badges?.[r.person_id]).filter(Boolean);
    const owners = bs.filter((x) => x.owner && !x.business).length;
    const copies = bs.filter((x) => x.owner && x.business).length;
    const orgs = bs.filter((x) => !x.owner && x.organisation).length;
    return `${n(j.total - owners - copies - orgs)} people${orgs ? ` · + ${n(orgs)} organisation${orgs === 1 ? '' : 's'}` : ''}${ownerText(owners)}${copies ? COPY_LINE : ''}`;
  }
  function customersTable(j) {
    const pages = Math.ceil(j.total / j.page_size);
    const nav = pages > 1 ? `<div class="mk-params"><button type="button" class="rf-btn rf-btn-secondary" data-mk-page="${j.page - 1}" ${j.page <= 0 ? 'disabled' : ''}>‹ Prev</button> <span class="rt-sub">Page ${j.page + 1} of ${pages} · ${countLine(j)}</span> <button type="button" class="rf-btn rf-btn-secondary" data-mk-page="${j.page + 1}" ${j.page + 1 >= pages ? 'disabled' : ''}>Next ›</button></div>` : `<p class="rt-sub">${countLine(j)}</p>`;
    const B = window.mkBadge;
    const mark = B ? `<p class="rt-sub">${B.watermark(state.badgeHealth)} · open the segment in Customers to sort or filter by badge.</p>` : '';
    return nav + mark + `<div class="st-diary-scroll"><table class="rt-table" id="mk-cust-table"><thead><tr><th class="left">Person</th>${B ? B.head() : ''}<th>Subscribed</th><th>Distance</th><th class="left">History</th><th>Last booking</th><th>Ahead</th><th>Academy</th><th>Opens / clicks</th><th class="left">Flags</th></tr></thead><tbody>${j.rows.map(customerRow).join('') || '<tr><td colspan="12" class="rt-sub">No one.</td></tr>'}</tbody></table></div>`;
  }
  function detailHtml(p) {
    const bookings = p.bookings.map((b) => `<tr><td>${ukDate(b.event_date || b.date)}</td><td class="left">${esc(b.title || '')}</td><td class="left">${(b.cats || []).map((c) => esc(CAT_LABEL[c] || c)).join(', ')}</td><td>${esc(b.role)}</td><td class="left">${(b.src || []).map((s) => `<span class="mk-chip">${esc(s)}</span>`).join(' ')}${(b.src || []).length > 1 ? ' <span class="rt-sub">(one booking, both sources)</span>' : ''}</td></tr>`).join('');
    const links = p.links.map((l) => `<tr><td class="left">${esc(l.source)}</td><td class="left">${esc(l.match_method)}${l.confirmed ? '' : ' <span class="mk-chip prob">probable</span>'}</td><td class="left rt-sub">${esc(l.raw_ref || '')}</td></tr>`).join('');
    const prob = p.probable_records.length ? `<p class="rt-sub">${p.probable_records.length} Booking Sheet record(s) by exact name match are shown as probable history for this person; they are never merged.</p>` : '';
    const segs = p.segments.map((s) => `<li>${s.reason ? '<span class="rt-sub">✗</span>' : '<b>✓</b>'} ${esc(s.name)}${s.reason ? ` <span class="rt-sub">— ${esc(reasonText(s.reason))}</span>` : ''}</li>`).join('');
    return `<div class="mk-detail"><h4>${esc(p.name || '—')} <span class="rt-sub">${esc(p.email || '')}</span></h4><div class="two"><div><h4>Bookings &amp; orders</h4><table class="rt-table"><thead><tr><th>Date</th><th class="left">What</th><th class="left">Category</th><th>Role</th><th class="left">Sources</th></tr></thead><tbody>${bookings || '<tr><td colspan="5" class="rt-sub">None evidenced.</td></tr>'}</tbody></table>${prob}</div>`
      + `<div><h4>Segments</h4><ul class="mk-seglist">${segs}</ul><h4>How this person was matched</h4><table class="rt-table"><tbody>${links}</tbody></table></div></div></div>`;
  }

  /* ---------- engagement + collector ---------- */

  function bandCells(b) { return ['warm', 'cooling', 'cold', 'none_recorded', 'insufficient', 'unknown'].map((k) => `<td>${n(b?.[k] || 0)}</td>`).join(''); }
  /** Backfill line from the real campaign totals; the run row only adds when it last ran and whether it stalled. */
  /** The shared freshness message (lib/marketing/overview.mjs freshnessOf): "failed" + recovery only on a real failure. */
  const freshText = (f) => `${f.state === 'failed' ? '<b>failed</b> — ' : ''}${esc(f.text)}${f.action ? ` — ${esc(f.action)}` : ''}`;
  const backfillState = (cov, bf, f) => (f ? freshText(f) : (cov.is_complete ? 'complete' : (bf?.status === 'running' ? 'running' : 'incomplete')));
  function backfillLine(cov, bf, f) {
    const pct = cov.campaigns ? Math.round((cov.complete / cov.campaigns) * 100) : 0;
    const state = backfillState(cov, bf, f);
    const stalled = bf?.status === 'running' && hoursAgo(bf.heartbeat_at) > 1 ? ' — <b>stalled (PC asleep / closed?)</b>; re-run to resume' : '';
    const etaMin = bf?.status === 'running' && bf.items_done ? Math.round(((Date.parse(bf.heartbeat_at) - Date.parse(bf.started_at)) / bf.items_done) * (bf.items_total - bf.items_done) / 60000) : null;
    return `<div class="mk-prog"><div style="width:${pct}%"></div></div><p class="rt-sub">Backfill: ${n(cov.complete)} of ${n(cov.campaigns)} campaigns · ${state}${etaMin != null ? ` · about ${etaMin} min left` : ''} · last run ${ukStamp(bf?.finished_at || bf?.heartbeat_at)}${stalled}</p>`;
  }
  /** "164 collected of 166 known · 2 awaiting next collector": sends the collector hasn't read yet are never hidden. */
  const collectorLag = (cov) => `${n(cov.collected ?? cov.campaigns)} collected of ${n(cov.known ?? cov.campaigns)} known${cov.awaiting_collector ? ` · ${n(cov.awaiting_collector)} awaiting next collector` : ''}`;
  function engagementHtml(d) {
    const e = d.engagement;
    const cov = e.coverage;
    const prog = cov.campaigns ? backfillLine(cov, d.runs['collector:backfill'], e.freshness) : '<p class="rt-sub">Backfill not started.</p>';
    return `<div class="rt-section" id="mk-engagement"><h3>Email engagement (Release 2)</h3><p class="rt-sub">From the email-report collector on Alan's PC (dedicated browser profile; Alan signs in once, his password is never stored or typed). ${collectorLag(cov)} · ${n(cov.complete)} of ${n(cov.campaigns)} sent campaigns have complete recipient lists${cov.is_complete ? '' : (cov.covered ? ' — the uncollected ones are only new sends, so signals are as of the last collected campaign' : ' — until all are read, older signals show as unknown, never cold')}. Warm ≤ ${e.windows.warm_days} days, cooling ≤ ${e.windows.cooling_days}, cold beyond, from the real time of each person's latest recorded open / click (Squarespace records the first open and first click of each email); the email's send date is kept separately. An open is a recorded signal, not proof the email was read.</p>${prog}`
      + `<table class="rt-table"><thead><tr><th class="left">Subscribed people by</th><th>Warm</th><th>Cooling</th><th>Cold</th><th>None recorded</th><th>Too few emails</th><th>Unknown</th></tr></thead><tbody><tr><td class="left">Opens</td>${bandCells(e.bands.open)}</tr><tr><td class="left">Clicks</td>${bandCells(e.bands.click)}</tr></tbody></table>`
      + '<p class="rt-sub">First time on this PC: <code>npm run marketing:collector-login</code> (sign in, close the window), then <code>npm run marketing:collector-backfill</code> once. The nightly task runs <code>npm run marketing:collector</code>.</p></div>';
  }

  /* ---------- review and clear (suppressed but subscribed again) ---------- */

  function reviewRow(p) {
    return `<tr><td class="left">${esc(p.name || '—')}${p.admin ? ' <span class="mk-chip">Alan / business admin</span>' : ''}<div class="rt-sub">${esc(p.email)}</div></td><td class="left">${esc(reasonText(`suppressed:${p.reason}`))}</td>`
      + `<td>${ukDate(p.last_unsubscribe || p.suppressed_since)}</td><td>${p.subscribed_now ? '<span class="rt-pill ok">YES</span>' : 'no'}</td><td>${n(p.opens_since)}</td><td>${n(p.clicks_since)}</td><td>${n(p.orders_since)}</td><td>${ukDate(p.last_open)}</td>`
      + `<td class="left"><input type="text" data-mk-reason="${esc(p.email_hash)}" placeholder="Reason (required)" style="width:12rem"> <button type="button" class="rf-btn rf-btn-secondary" data-mk-clear="${esc(p.email_hash)}">Clear</button></td></tr>`;
  }
  function reviewShell(d) {
    return `<div class="rt-section" id="mk-review"><h3>Review and clear: suppressed but subscribed again (${blockedSplit(d.identity)})</h3>`
      + '<p class="rt-sub">People on the permanent suppression list (unsubscribed or deleted at some point) who show as subscribed again in Squarespace. They stay out of every targeted group until cleared here: one person at a time, with a typed reason, logged. Nothing clears automatically and nothing changes in Squarespace. A later unsubscribe puts the block back.</p>'
      + `<div id="mk-review-body">${d.identity.suppressed_but_subscribed ? '<div class="rt-loading">Loading evidence…</div>' : '<p class="rt-sub">No one to review.</p>'}</div></div>`;
  }
  async function loadReview(d) {
    const body = document.getElementById('mk-review-body');
    if (!body || !d.identity.suppressed_but_subscribed) return;
    const j = await api('GET', '?action=suppression-review');
    body.innerHTML = `<div style="overflow-x:auto"><table class="rt-table" id="mk-review-table"><thead><tr><th class="left">Person</th><th class="left">Why blocked</th><th>Last unsubscribe</th><th>Subscribed now</th><th>Opens since</th><th>Clicks since</th><th>Orders since</th><th>Last open</th><th class="left">Clear</th></tr></thead><tbody>${j.people.map(reviewRow).join('')}</tbody></table></div><div id="mk-review-out" class="rt-sub"></div>`;
  }
  async function clearOne(hash) {
    const box = document.querySelector(`[data-mk-reason="${hash}"]`);
    const out = document.getElementById('mk-review-out');
    out.textContent = 'Clearing… (rebuilding the customer view, about 15 seconds)';
    await api('POST', '', { action: 'suppression-resolve', email_hash: hash, reason: box?.value || '' });
    await render(document.getElementById('marketing-root'));
  }

  /* ---------- sources + sync ---------- */

  /**
   * The one-off historical backfill: once it finished OK with every campaign read it is "completed historical backfill",
   * never STALE (current collector health is its own row); running / failed / incomplete show as before.
   */
  function backfillRow(r, cov) {
    const done = r?.status === 'ok' && !!cov?.campaigns && !cov.incomplete_older;
    if (!done) return runRow('Collector backfill (PC)', r);
    const note = `completed historical backfill · ${n(cov.complete)}/${n(cov.campaigns)} campaigns read · one-off, nothing to re-run; newer sends and current collector health are the row above`;
    return `<tr><td class="left">Collector backfill (PC)</td><td><span class="rt-pill ok">COMPLETED</span></td><td>${ukStamp(r.finished_at || r.heartbeat_at)}</td><td class="left rt-sub">${esc(note)}</td></tr>`;
  }
  function runRow(label, r, extra) {
    const stale = r && r.status === 'ok' && hoursAgo(r.finished_at) > STALE_H;
    const pill = !r ? '<span class="rt-pill warn">NEVER RUN</span>' : (r.status === 'ok' ? (stale ? '<span class="rt-pill warn">STALE</span>' : '<span class="rt-pill ok">OK</span>') : `<span class="rt-pill ${r.status === 'failed' ? 'bad' : 'warn'}">${esc(String(r.status).toUpperCase())}</span>`);
    return `<tr><td class="left">${label}</td><td>${pill}</td><td>${ukStamp(r?.finished_at || r?.heartbeat_at)}</td><td class="left rt-sub">${esc(r?.error || extra || '')}</td></tr>`;
  }
  const planNote = (r) => (r?.summary ? `${n(r.summary.plans)} plans · ${n(r.summary.payments)} payments (${gbpNote(r.summary.paid_total)}) · ${n(r.summary.unparsed)} sheets not parsed (listed, never guessed)` : '');
  const gbpNote = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;

  /** Re-read plan files: queued for Alan's PC; progress window polls the run until it finishes. */
  async function planImport() {
    const box = document.getElementById('mk-plan-progress');
    const { run_id: runId } = await api('POST', '', { action: 'plan-import-request' });
    const t0 = Date.now();
    for (;;) {
      const { run } = await api('GET', qs({ action: 'run', run_id: runId }));
      const pct = run.items_total ? Math.round((run.items_done / run.items_total) * 100) : 0;
      const alive = run.status === 'queued' ? 'waiting for Alan\'s PC' : (hoursAgo(run.heartbeat_at) * 60 < 3 ? 'alive' : '<b>stalled</b>');
      box.innerHTML = `<div class="mk-prog"><div style="width:${pct}%"></div></div><p class="rt-sub">${pct}% · ${esc(run.checkpoint?.step || run.status)} · ${Math.round((Date.now() - t0) / 1000)} s · ${alive}</p>`;
      if (!['queued', 'running'].includes(run.status)) {
        box.innerHTML = `<p class="rt-sub"><span class="rt-pill ${run.status === 'ok' ? 'ok' : 'bad'}">${esc(run.status.toUpperCase())}</span> ${run.status === 'ok' ? esc(planNote(run)) : esc(run.error || '')}</p>`;
        return;
      }
      await new Promise((ok) => setTimeout(ok, 5000));
    }
  }

  function sourcesHtml(d) {
    const c = d.coverage;
    const cov = (x, label) => `<tr><td class="left">${label}</td><td>${n(x.rows)}</td><td>${ukDate(x.from)}</td><td>${ukStamp(x.last_import)}</td></tr>`;
    const s = d.runs;
    return `<div class="rt-section" id="mk-sources"><h3>Sources &amp; sync health</h3><button type="button" class="rf-btn" data-mk="sync" title="${esc(window.mkSyncRun?.TIPS.sync || '')}">Sync now</button> <span class="rt-sub">Reads Squarespace (profiles, orders), looks up postcodes and rebuilds the customer view. Runs nightly by itself.</span>`
      + '<h4>Channels</h4><div id="mk-gbp-line" class="mk-kv">Google Business: checking…</div>'
      + `<table class="rt-table"><thead><tr><th class="left">Step</th><th>State</th><th>Last run</th><th class="left">Note</th></tr></thead><tbody>${runRow('Squarespace profiles (consent)', s['sync:profiles'], s['sync:profiles']?.summary ? `${n(s['sync:profiles'].summary.profiles)} contacts, ${n(s['sync:profiles'].summary.subscribed)} subscribed` : '')}${runRow('Squarespace orders', s['sync:orders'], s['sync:orders']?.summary ? `${n(s['sync:orders'].summary.orders)} orders read (${esc(s['sync:orders'].summary.mode)})` : '')}${runRow('Postcode lookup', s['sync:postcodes'])}${runRow('Customer view rebuild', s['sync:customers'], s['sync:customers']?.summary ? `${n(s['sync:customers'].summary.persons)} people · ${n(s['sync:customers'].summary.workshop_sqs_refs)} workshop #0xxxx refs` : '')}${runRow('Email-report collector (PC)', s.collector)}${backfillRow(s['collector:backfill'], d.engagement?.coverage)}${runRow('Pick n Mix plan files (PC)', s['plan-import'], planNote(s['plan-import']))}</tbody></table>`
      + `<div class="mk-params"><button type="button" class="rf-btn rf-btn-secondary" data-mk="plan-import">Re-read plan files</button> <span class="rt-sub">Reads the Pick n Mix plan statements on Alan's PC (read-only), then rebuilds the customer view. Runs on the PC within 5 minutes.</span></div><div id="mk-plan-progress"></div>`
      + `<table class="rt-table"><thead><tr><th class="left">Data</th><th>Rows</th><th>From</th><th>Last import</th></tr></thead><tbody>${cov(c.squarespace_orders, 'Squarespace orders')}${cov(c.booking_sheet_transactions, 'Booking Sheet transactions')}${cov(c.booking_sheet_workshops, 'Booking Sheet workshop attendees')}${cov(c.booking_sheet_courses, 'Booking Sheet course attendees')}</tbody></table>`
      + `<p class="rt-sub">People: ${n(d.identity.persons)} (${n(d.identity.squarespace_profiles)} Squarespace contacts, ${n(d.identity.booking_sheet_name_only)} Booking Sheet name-only records, ${n(d.identity.academy_linked)} Academy members linked by email) · ${n(d.identity.with_location)} contacts have a located postcode · suppression list ${n(d.suppression.active)} (${Object.entries(d.suppression.by_reason).map(([k, v]) => `${esc(k.replace(/_/g, ' '))} ${n(v)}`).join(', ')}).</p></div>`;
  }

  /* ---------- channels: Google Business (Viking Local posts automatically), read-only ---------- */

  async function gbpStatus() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/strategy-campaigns?view=gbp&propertyUrl=${encodeURIComponent(PROP)}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    return j.ok ? j.gbp : { reachable: false, error: j.error || `status ${r.status}` };
  }
  /** Never green without evidence: unreachable = "not visible from here"; no post in 14 days = amber. */
  function gbpLineHtml(g, exceptions) {
    const exc = `exceptions awaiting Alan: ${exceptions == null ? '—' : n(exceptions)}`;
    if (!g?.reachable) return `<span class="rt-pill warn">NOT VISIBLE</span> Google Business: Viking Local automated · last post: not visible from here · ${exc}<div class="rt-sub">${esc(g?.error || '')}</div>`;
    const days = g.last_post_at ? (Date.now() - Date.parse(g.last_post_at)) / 864e5 : null;
    const pill = days == null || days > 14 ? '<span class="rt-pill warn">NO RECENT POST</span>' : '<span class="rt-pill ok">POSTING</span>';
    const rv = g.reviews?.available ? `reviews feed readable (read-only): ${n(g.reviews.total)} reviews, ${esc(g.reviews.average)}★, newest ${ukDate(g.reviews.latest_at)}; no replies or review requests built` : 'reviews feed: not available';
    return `${pill} Google Business: Viking Local automated · last post seen ${ukStamp(g.last_post_at)} · ${n(g.posts_28d)} posts in 28 days · ${exc}<div class="rt-sub">Source: ${esc(g.source)} · ${rv}</div>`;
  }
  async function mountGbpLine(strategy) {
    const el = document.getElementById('mk-gbp-line');
    if (!el) return;
    const [g, s] = await Promise.all([gbpStatus().catch((e) => ({ reachable: false, error: e.message })), strategy.catch(() => null)]);
    el.innerHTML = gbpLineHtml(g, s?.campaign?.step_status?.gbp_exceptions_open ?? null);
  }

  /* ---------- settings (campaign channels, moved from the Targets panel) ---------- */

  function settingsHtml(t, d) {
    const c = t?.campaign_targets;
    if (!c) return '';
    return `<div class="rt-section" id="mk-settings"><h3>Marketing settings</h3><p class="rt-sub">The campaign channel timetable (moved here from the Targets panel, which now shows it read-only). The email list size and send cap are no longer typed in: they come from Squarespace (${n(d.identity.subscribed_unsuppressed)} subscribed now; allowance ${n(d.meter.quota)} a billing cycle).</p>`
      + `<label class="st-ov-f mk-f">Email day<input data-mk-set="email.day" type="text" value="${esc(c.email.day)}" style="width:8rem"></label>`
      + `<label class="st-ov-f mk-f">Light &amp; Logic folded into the week of the (day of month)<input data-mk-set="email.light_and_logic_day" type="number" value="${esc(c.email.light_and_logic_day)}" style="width:5rem"></label>`
      + `<label class="st-ov-f mk-f" title="Sends set aside each billing cycle for the monthly Light &amp; Logic full-list email (billing-cycle tile and Email capacity)">Light &amp; Logic budget (sends a cycle)<input data-mk-set="email.light_and_logic_budget_sends" type="number" min="0" value="${esc(c.email.light_and_logic_budget_sends ?? '')}" style="width:5rem"></label>`
      + `<label class="st-ov-f mk-f" title="Sends kept back each billing cycle for ad-hoc emails (billing-cycle tile and Email capacity)">Kept back for ad-hoc (sends a cycle)<input data-mk-set="email.adhoc_reserve_sends" type="number" min="0" value="${esc(c.email.adhoc_reserve_sends ?? '')}" style="width:5rem"></label>`
      + `<p class="rt-sub">Facebook + Instagram ${esc(c.facebook_instagram.days.join(' + '))} · LinkedIn ${esc(c.linkedin.days.join(', '))} (${esc(c.linkedin.angle)}) · YouTube: ${esc(c.youtube)} · Google Business Profile: ${esc(c.google_business_profile)} · Outlook: ${esc(c.outlook_notes)}</p>`
      + '<button type="button" class="rf-btn" data-mk="save-settings">Save settings</button> <span id="mk-set-status" class="rt-sub"></span></div>';
  }

  /* ---------- render ---------- */

  const STYLE = `<style>
    section[data-panel="marketing"] { background: var(--dark-bg) !important; min-height: calc(100vh - 4rem); color: var(--dark-text) !important; padding: 2rem; box-sizing: border-box; }
    section[data-panel="marketing"] h2 { color: var(--dark-brand) !important; margin: 0; font-size: 1.75rem; font-weight: 800; }
    section[data-panel="marketing"] h3 { margin: 0 0 0.4rem; color: var(--dark-text); font-size: 1.15rem; font-weight: 800; }
    section[data-panel="marketing"] h4 { margin: 0.6rem 0 0.35rem; color: var(--dark-text); font-size: 0.95rem; }
    section[data-panel="marketing"] .rt-sub { color: var(--dark-text-muted); font-size: 0.88rem; margin: 0 0 0.6rem; line-height: 1.5; }
    section[data-panel="marketing"] .rt-table td.left, section[data-panel="marketing"] .rt-table th.left { text-align: left; }
    section[data-panel="marketing"] .rt-table td { vertical-align: top; }
    section[data-panel="marketing"] .rt-pill.ok { background: #14532d; color: #bbf7d0; } section[data-panel="marketing"] .rt-pill.bad { background: #7f1d1d; color: #fecaca; }
    section[data-panel="marketing"] .rt-pill.warn { background: #78350f; color: #fde68a; } section[data-panel="marketing"] .rt-pill.current { background: #1e3a8a; color: #bfdbfe; }
    section[data-panel="marketing"] .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); gap: 1rem; }
    .mk-params { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; margin: 0.5rem 0 0.8rem; }
    .mk-f { display: inline-block; margin-right: 0.4rem; }
    .mk-chip { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #1e293b; color: #e5e7eb; margin: 0 2px 2px 0; white-space: nowrap; }
    .mk-chip.prob { background: transparent; border: 1px dashed #64748b; color: #94a3b8; } .mk-chip.warn { background: #78350f; color: #fde68a; }
    .mk-eng { font-size: 11px; white-space: nowrap; color: #94a3b8; } .mk-eng-warm { color: #4ade80; } .mk-eng-cooling, .mk-eng-cooling_partial { color: #fbbf24; } .mk-eng-cold { color: #f59e0b; }
    .mk-note { border-left: 4px solid #f59e0b; background: #1c1917; padding: 0.6rem 0.8rem; margin: 0.5rem 0; font-size: 0.85rem; }
    .mk-note.bad { border-left-color: #ef4444; background: #1f1215; }
    .mk-send-rule { margin-top: 4px; padding: 3px 6px; border-left: 3px solid #f59e0b; background: #1c1917; color: #fde68a; font-size: 12px; line-height: 1.35; }
    .mk-send-rule .mk-countdown { color: #bbf7d0; white-space: nowrap; font-variant-numeric: tabular-nums; } .mk-send-rule .mk-countdown.expired { color: #fca5a5; }
    .mk-wide { overflow-x: auto; } #mk-exp-table td.mk-load { min-width: 16rem; max-width: 26rem; } #mk-exp-table td:first-child { min-width: 13rem; } #mk-exp-table td .rf-btn { margin: 1px 0; white-space: nowrap; }
    .mk-snap { margin-top: 1rem; border-top: 1px solid var(--dark-border); padding-top: 0.6rem; }
    .mk-detail { margin-top: 1rem; border: 1px solid var(--dark-border); border-radius: 8px; padding: 0.8rem 1rem; background: #0b1118; }
    .mk-seglist { list-style: none; padding: 0; margin: 0; font-size: 0.85rem; } .mk-seglist li { padding: 2px 0; }
    #mk-cust-table tbody tr { cursor: pointer; } #mk-cust-table tbody tr:hover td { background: #111827; }
    #mk-seg-table { table-layout: fixed; width: 100%; } #mk-seg-table td, #mk-seg-table th { white-space: normal; overflow-wrap: anywhere; }
    section[data-panel="marketing"] .rt-table td.left { white-space: normal; } #mk-seg-table th:nth-child(1) { width: 2rem; } #mk-seg-table th:nth-child(3) { width: 5rem; } #mk-seg-table th:nth-child(4) { width: 34%; } #mk-seg-table th:nth-child(5) { width: 6rem; }
    .mk-kv { max-width: 34rem; } .mk-kv td:last-child { text-align: right; }
    .mk-prog { height: 8px; background: #1f2937; border-radius: 4px; overflow: hidden; margin: 0.4rem 0; } .mk-prog div { height: 100%; background: var(--dark-brand); }
    #mk-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9998; display: flex; align-items: center; justify-content: center; }
    #mk-modal .box { width: 30rem; background: #0b1118; border: 1px solid #334155; border-radius: 10px; padding: 1rem 1.2rem; color: #e5e7eb; }
  </style>`;

  /** The page frame, painted at once (before any data): sections with clear "Loading…" placeholders, never error-looking. */
  const shellHtml = () => `${STYLE}<div class="card--section-header"><h2>Marketing &amp; Campaigns <button type="button" class="mks-i" data-mks-rules title="Campaign steps, customers &amp; segments, the email send budget and campaign results. Same campaign records as Strategy &amp; Actions. Read-only: the schedule, tiles, customers, segments and results only read. Two buttons write to Squarespace, each after its own checks: Send to Squarespace list (Alan\'s PC loads a new list; consent re-read before and after) and Contact clean-up → Unsubscribe in Squarespace (approved manifests only). Nothing here sends or schedules an email.">ⓘ</button></h2><div id="mk-head-actions">${typeof window.mkSyncRunHead === 'function' ? window.mkSyncRunHead() : ''}</div></div>`
    + '<div id="mk-overview-tiles"><div class="rt-loading">Loading the overview…</div></div><div class="rt-section" id="mk-waiting"></div>'
    + '<div class="rt-section" id="mk-planned"><h3 class="mk-sec-h">2 · Planned <span class="mk-sec-act"><button type="button" class="rf-btn rf-btn-secondary mk-health-btn" data-mk-open-health title="Purchase × consent matrix, email health bands and the click-through queries (the existing view, Behind the scenes)">Client list health ›</button></span></h3><div class="mkw-sub">The Days / Weeks schedule you approved (unchanged). Every future email and post, its status (draft · scheduled) and audience size.</div><div class="rt-section" id="mk-schedule"><div class="rt-loading">Loading the marketing schedule…</div></div></div>'
    + '<div class="rt-section" id="mk-results"></div>'
    + behindHtml('<div class="rt-loading">Loading…</div>');
  const behindBody = (d, targets) => foldsHtml(d)
    + '<div class="rt-section" id="mk-query"><div class="rt-loading">Loading customer search…</div></div>'
    + '<div class="rt-section" id="mk-cleanup"><div class="rt-loading">Loading clean-up…</div></div>'
    + engagementHtml(d) + reviewShell(d) + sourcesHtml(d) + settingsHtml(targets, d);
  function setGlobals(d) {
    state.data = d;
    window.mkLiveListSize = d.identity.subscribed_unsuppressed;
    window.mkMeter = d.meter;
    window.mkSegmentsList = (d.segments || []).map((s) => ({ segment_id: s.segment_id, name: s.name, count: s.count }));
  }
  const NO_KEY_HTML = () => `${STYLE}<div class="rt-section"><h3>Marketing &amp; Campaigns</h3><p class="rt-sub">Customer data needs the admin key in this browser: Configuration &amp; Reporting → "Optimisation Tracking Security" → Save Admin Key, then open this tab again.</p></div>`;

  /**
   * Cold load: the frame first; the Strategy summary (the slowest read) starts at once, in parallel with the overview;
   * Waiting on you and Results need neither, so they fill in first. The folded sections (Behind the scenes: customers,
   * clean-up, suppression review, delivery tables) are mounted only when that fold is opened.
   */
  async function render(root) {
    root.innerHTML = shellHtml();
    const strategy = loadStrategy();
    mountSections(null, strategy);
    if (typeof window.mkMountScheduleEarly === 'function') window.mkMountScheduleEarly(document.getElementById('mk-schedule'));
    try {
      const [d, targets] = await Promise.all([api('GET', qs({ action: 'overview', ...paramQuery() })), fetch(`/api/aigeo/targets-master?propertyUrl=${encodeURIComponent(PROP)}`).then((r) => r.json()).catch(() => null)]);
      setGlobals(d);
      if (typeof window.mkSyncRunPaint === 'function') window.mkSyncRunPaint(d);
      const body = document.getElementById('mk-behind-body');
      if (body) body.innerHTML = behindBody(d, targets);
      if (typeof window.mkWaitingSetData === 'function') window.mkWaitingSetData(d);
      mountOverview(d, strategy);
      mountCampaignSteps(strategy);
      mountSchedule(d, strategy);
      whenBehindOpens(() => mountFolded(d, strategy));
      root.dataset.loaded = '1';
    } catch (e) {
      if (e.message === 'NO_KEY') root.innerHTML = NO_KEY_HTML();
      else document.getElementById('mk-overview-tiles').innerHTML = `<div class="rt-error">Marketing overview unavailable: ${esc(e.message)}</div>`;
    }
  }
  /** Behind the scenes, mounted once on first open (tile links, Client list health and ⓘ links open it too). */
  function mountFolded(d, strategy) {
    mountDelivery(d, strategy);
    mountGbpLine(strategy);
    if (typeof window.mkMountQuery === 'function') window.mkMountQuery(document.getElementById('mk-query'));
    if (typeof window.mkMountCleanup === 'function') window.mkMountCleanup(document.getElementById('mk-cleanup'));
    pollLoads();
    loadReview(d).catch((e) => { const b = document.getElementById('mk-review-body'); if (b) b.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; });
  }
  function whenBehindOpens(fn) {
    const fold = document.getElementById('mk-behind');
    if (!fold) return;
    let done = false;
    const run = () => { if (!done && fold.open) { done = true; fn(); } };
    fold.addEventListener('toggle', run);
    run();
  }

  /** One Strategy summary fetch per render, shared by the Overview tiles and the campaign steps. */
  function loadStrategy() {
    if (typeof window.stLoadStrategySummary !== 'function') return Promise.reject(new Error('Strategy script not loaded'));
    const p = window.stLoadStrategySummary();
    p.catch(() => {});
    return p;
  }
  function mountOverview(d, strategy) {
    const host = document.getElementById('mk-overview-tiles');
    if (!host) return;
    if (typeof window.mkMountOverviewTiles === 'function') window.mkMountOverviewTiles(host, d, strategy);
    else host.innerHTML = '<div class="rt-error">Overview tiles script not loaded — refresh the page.</div>';
  }
  /** Delivery section above the campaign steps; the send budget is repainted once the week plan (audiences) is in. */
  function mountDelivery(d, strategy) {
    const host = document.getElementById('mk-delivery');
    if (host && typeof window.mkMountDelivery === 'function') window.mkMountDelivery(host, d, strategy);
    else if (host) host.innerHTML = '<div class="rt-error">Delivery script not loaded — refresh the page.</div>';
    strategy.then((s) => { const b = document.getElementById('mk-budget'); if (b && d.meter.state !== 'never_read') b.outerHTML = budgetHtml(d.meter, s); }, () => {});
  }
  async function mountCampaignSteps(strategy) {
    const host = document.getElementById('mk-campaign-host');
    if (!host || typeof window.mountMarketingCampaign !== 'function') return;
    try { window.mountMarketingCampaign(host, await strategy); } catch (e) { host.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
  }
  /** The cross-channel schedule (lib/marketing-schedule.js) at the top of the tab. */
  function mountSchedule(d, strategy) {
    const host = document.getElementById('mk-schedule');
    if (host && typeof window.mkMountSchedule === 'function') window.mkMountSchedule(host, d, strategy);
    else if (host) host.innerHTML = '<div class="rt-error">Schedule script not loaded — refresh the page.</div>';
  }
  /** "Waiting on you" (lib/marketing-waiting.js) and "Results" (lib/marketing-results.js) around the schedule. */
  function mountSections(d, strategy) {
    const wait = document.getElementById('mk-waiting');
    if (typeof window.mkMountWaiting === 'function') window.mkMountWaiting(wait, d, strategy);
    else wait.innerHTML = '<div class="rt-error">Waiting-on-you script not loaded — refresh the page.</div>';
    const res = document.getElementById('mk-results');
    if (typeof window.mkMountResults === 'function') window.mkMountResults(res, strategy);
    else res.innerHTML = '<div class="rt-error">Results script not loaded — refresh the page.</div>';
  }
  /** One closed fold at the bottom: campaign records, step history, superseded items, rules, data sources (nothing removed). */
  const behindHtml = (body) => '<details class="mks-fold" id="mk-behind"><summary>Behind the scenes: campaign records, step history, superseded items, rules, data sources <span>· for checking only, never needed day to day</span></summary>'
    + `<div class="mks-fold-body" id="mk-behind-body">${body}</div></details>`;
  /** Folded at the bottom of the schedule, closed by default: same sections, same write paths, nothing removed. */
  function foldsHtml(d) {
    const fold = (id, title, sub, body) => `<details class="mks-fold" id="${id}"><summary>${title} <span>· ${sub}</span></summary><div class="mks-fold-body" id="${id}-body">${body}</div></details>`;
    const rules = (typeof window.mkScheduleRulesHtml === 'function' ? window.mkScheduleRulesHtml() : '')
      + (window.mkDeliveryRules ? `<h4>Email deliveries and reservations</h4><ul class="mks-rules"><li>${esc(window.mkDeliveryRules)}</li></ul>` : '')
      + '<h4>Explanations moved off the page (also behind each ⓘ)</h4><ul class="mks-rules" id="mk-rules-moved"></ul>';
    return '<div class="mks-folds">'
      + fold('mk-fold-results', 'Campaign results', 'what each campaign sold (stages, bookings, opens), with the full campaign-steps table', '<div class="rt-section" id="mk-campaign-host"><div class="rt-loading">Loading campaign steps…</div></div>')
      + fold('mk-fold-audiences', 'Audiences', 'segments and counts', segmentsHtml(d) + exportsHtml(d) + customersShell(d))
      + fold('mk-fold-rules', 'Rules &amp; data sources', 'how counts and reservations work', `<div class="rt-section"><h3>How the schedule is worked out</h3>${rules}</div>${budgetHtml(d.meter, null)}<div class="rt-section" id="mk-delivery"><div class="rt-loading">Loading scheduled &amp; planned delivery…</div></div>`)
      + '</div>';
  }

  /* ---------- actions ---------- */

  function readParams(root) {
    root.querySelectorAll('[data-mkp]').forEach((el) => { state.params[el.dataset.mkp] = el.value || undefined; });
  }
  function defaultListName() {
    const camp = document.getElementById('mk-snap-camp')?.value || 'Campaign';
    const seg = state.data.segments.filter((s) => state.picked.has(s.segment_id)).map((s) => s.name.split(/[(:,]/)[0].trim()).join(' + ');
    return `ARP | ${camp} | ${seg} | ${new Date().toISOString().slice(0, 10)}`.slice(0, 75);
  }
  const includeOwner = () => document.getElementById('mk-snap-owner')?.checked !== false;

  /* ---------- audience review: people with health badges; saved snapshots also take manual exclusions ---------- */

  function reviewRowHtml(r, x, editable) {
    const B = window.mkBadge;
    const act = editable ? `<button type="button" class="rf-btn rf-btn-secondary" data-mk-excl="${esc(x.export_id)}|${esc(r.person_id)}|${r.reason ? 'restore' : 'exclude'}">${r.reason ? 'Put back' : 'Exclude from this snapshot'}</button>` : '';
    const chip = r.business_copy ? ' <span class="mk-chip">business copy</span>' : (r.owner ? ' <span class="mk-chip">owner copy</span>' : '');
    return `<tr><td class="left">${esc(r.name || '—')}${chip}<div class="rt-sub">${esc(r.email || '')}</div></td>${B ? B.cells(r.badges) : ''}<td class="left rt-sub">${r.reason ? `excluded by hand: ${esc(r.reason)} (${ukStamp(r.set_at)})` : ''}</td><td>${act}</td></tr>`;
  }
  function reviewHtml(x) {
    const B = window.mkBadge;
    const clients = x.members.filter((r) => !r.owner);
    const owners = x.members.filter((r) => r.owner && !r.business_copy);
    const copies = x.members.filter((r) => r.business_copy);
    const head = `<thead><tr><th class="left">Person</th>${B ? B.head() : ''}<th class="left">Note</th><th></th></tr></thead>`;
    const body = [...clients, ...owners, ...copies].map((r) => reviewRowHtml(r, x, x.editable)).join('') + (x.excluded || []).map((r) => reviewRowHtml(r, x, x.editable)).join('');
    const title = x.mode === 'snapshot' ? `<b>${esc(x.list_name)}</b> · ${statusPill(x.status)} · frozen ${ukStamp(x.frozen_at)} with ${n(x.frozen_count)} people · <span class="rt-sub">${esc(x.frozen_rule || '')}</span>` : '<b>Picked segments (not saved yet)</b>';
    const counts = `<b>${n(clients.length)}</b> people${B ? B.ownerLine(owners.length) : ''}${copies.length ? ' · business copy on' : ''}${x.excluded?.length ? ` · ${n(x.excluded.length)} excluded by hand` : ''}`;
    const edit = x.mode === 'snapshot' ? (x.editable ? 'Exclude one-offs below (reason required, logged); nobody can be added here, and the load re-checks consent for everyone.' : 'This snapshot is loaded or in progress: its people can\'t be changed (make a new snapshot instead).') : 'Save it with "Make snapshot", then exclude one-offs from the saved snapshot.';
    return `<div class="mk-detail"><p>${title} · ${counts} · ${B ? B.watermark(x.health) : ''}</p><p class="rt-sub">${esc(edit)} ${esc(x.note || '')}</p><div class="mk-wide"><table class="rt-table">${head}<tbody>${body || '<tr><td colspan="6" class="rt-sub">No one.</td></tr>'}</tbody></table></div></div>`;
  }
  async function showReview(boxId, body) {
    const box = document.getElementById(boxId);
    box.innerHTML = '<div class="rt-loading">Loading people with health badges…</div>';
    const x = await api('POST', '', { action: 'snapshot-review', params: paramQuery(), ...body });
    state.lastReview = { boxId, body };
    box.innerHTML = reviewHtml(x);
    return x;
  }
  async function exclusion(spec) {
    const [exportId, personId, mode] = spec.split('|');
    const reason = window.prompt(mode === 'exclude' ? 'Why leave this person out of this snapshot? (10+ characters, logged)' : 'Why put this person back? (10+ characters, logged)');
    if (!reason) return;
    await api('POST', '', { action: mode === 'exclude' ? 'snapshot-exclude' : 'snapshot-restore', export_id: exportId, person_id: personId, reason });
    await showReview(state.lastReview.boxId, state.lastReview.body);
  }

  async function preview(out) {
    out.textContent = 'Counting…';
    const x = await showReview('mk-snap-review', { segment_ids: [...state.picked], include_owner: includeOwner() });
    out.innerHTML = `<b>${n(x.count)}</b> people (deduplicated)${window.mkBadge ? window.mkBadge.ownerLine(x.owner_addresses) : ''}${x.business_copy ? ' · business copy on' : ''} · ${topReasons(x.exclusions)}`;
  }
  async function snapshot(out) {
    const name = document.getElementById('mk-snap-name').value || defaultListName();
    out.textContent = 'Re-reading consent from Squarespace, then saving the audience… (about 30 seconds)';
    const j = await api('POST', '', { action: 'export-create', segment_ids: [...state.picked], params: paramQuery(), campaign_key: document.getElementById('mk-snap-key').value || null, list_name: name, include_owner: includeOwner() });
    out.innerHTML = `Saved <b>${esc(j.list_name)}</b>: ${n(j.eligible_count)} people${window.mkBadge ? window.mkBadge.ownerLine(j.owner_included) : ''}${j.business_copy ? ' · business copy on' : ''} · status ${statusPill(j.status)}${j.import_block ? ' — list import blocked (see note above)' : ''}`;
  }

  async function requestLoad(id) {
    const e = state.data.exports.find((x) => x.export_id === id);
    if (!window.confirm(`Load "${e?.list_name}" into a new Squarespace list?\n\nAlan's PC re-reads consent first and imports only the people who pass (about ${n(e?.eligible_count)}). Nothing is sent.`)) return;
    const automations = e?.is_test ? false : window.confirm('Automations check: in Squarespace → Marketing → Email Campaigns → Automations, is NOTHING triggered by joining this list or by a new subscriber?\n\nOK = checked, nothing triggers. Cancel = not checked (the load is refused).');
    await api('POST', '', { action: 'list-load-request', export_id: id, automations_checked: automations });
    await render(document.getElementById('marketing-root'));
  }

  /** Poll queued / running loads; repaint their cell, re-render the tab when one finishes. */
  let pollTimer = null;
  function pollLoads() {
    clearTimeout(pollTimer);
    const cells = [...document.querySelectorAll('#mk-exp-table [data-mk-run]')];
    if (!cells.length) return;
    pollTimer = setTimeout(async () => {
      for (const cell of cells) {
        const { run } = await api('GET', qs({ action: 'run', run_id: cell.dataset.mkRun })).catch(() => ({}));
        if (run && !['queued', 'running'].includes(run.status)) return render(document.getElementById('marketing-root'));
        if (run) cell.innerHTML = loadProgress(run);
      }
      pollLoads();
    }, 8000);
  }

  /** Pre-send check with a progress window (consent re-read from Squarespace takes ~20-40 s). */
  async function presend(id) {
    const modal = document.createElement('div');
    modal.id = 'mk-modal';
    document.body.appendChild(modal);
    const t0 = Date.now();
    const paint = () => { modal.innerHTML = `<div class="box"><h4>Pre-send check…</h4><div class="mk-prog"><div style="width:${Math.min(95, Math.round(((Date.now() - t0) / 40000) * 100))}%"></div></div><p class="rt-sub">Re-reading consent from Squarespace and the suppression list for everyone in the list · ${Math.round((Date.now() - t0) / 1000)} s (usually under 40 s)</p></div>`; };
    paint();
    const tick = setInterval(paint, 1000);
    try {
      const r = await api('POST', '', { action: 'presend-check', export_id: id });
      clearInterval(tick);
      modal.innerHTML = `<div class="box"><h4>Pre-send check: <span class="rt-pill ${r.result === 'PASS' ? 'ok' : 'bad'}">${r.result}</span></h4><p class="rt-sub">${n(r.checked)} checked at ${ukStamp(r.at)}${r.result === 'PASS' ? ' · valid for 30 minutes' : ` · ${tallyText(r.failures)} — do not send`}</p>${presendNote(r)}<button type="button" class="rf-btn" onclick="this.closest('#mk-modal').remove()">Close</button></div>`;
      await render(document.getElementById('marketing-root'));
    } catch (e) {
      clearInterval(tick);
      modal.innerHTML = `<div class="box"><h4>Pre-send check: <span class="rt-pill bad">FAILED TO RUN</span></h4><p class="rt-sub">${esc(e.message)}</p><button type="button" class="rf-btn" onclick="this.closest('#mk-modal').remove()">Close</button></div>`;
    }
  }
  async function showCustomers(page) {
    const body = document.getElementById('mk-cust-body');
    state.customers = { page: page || 0, q: document.getElementById('mk-cust-q').value, segment_id: document.getElementById('mk-cust-seg').value, sub: document.getElementById('mk-cust-sub').checked ? '1' : '' };
    body.innerHTML = '<div class="rt-loading">Loading people…</div>';
    const j = await api('GET', qs({ action: 'customers', q: state.customers.q, segment_id: state.customers.segment_id, page: state.customers.page, subscribed_only: state.customers.sub, ...paramQuery() }));
    const b = await api('POST', '', { action: 'health-badges', person_ids: j.rows.map((r) => r.person_id), params: paramQuery() }).catch(() => null);
    state.badges = b?.badges || {};
    state.badgeHealth = b?.health || null;
    body.innerHTML = customersTable(j);
  }
  async function showDetail(id) {
    const box = document.getElementById('mk-detail');
    box.innerHTML = '<div class="rt-loading">Loading…</div>';
    box.innerHTML = detailHtml(await api('GET', qs({ action: 'customer', person_id: id, ...paramQuery() })));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function downloadCsv(id) {
    const key = window.getAdminKey();
    const r = await fetch(`${API}?action=export-csv&export_id=${encodeURIComponent(id)}`, { headers: { 'x-arp-admin-key': key } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob());
    a.download = `${id}.csv`;
    a.click();
  }

  /** Same run as the header's "Sync customers" (lib/marketing-sync-run.js: progress, result window, then reload). */
  async function syncNow() {
    if (!window.mkSyncRun) throw new Error('Sync script not loaded — refresh the page.');
    return window.mkSyncRun.customers();
  }

  async function saveSettings(root) {
    const status = root.querySelector('#mk-set-status');
    status.textContent = 'Saving…';
    const t = await fetch(`/api/aigeo/targets-master?propertyUrl=${encodeURIComponent(PROP)}`).then((r) => r.json());
    const c = JSON.parse(JSON.stringify(t.campaign_targets));
    const budgets = JSON.stringify([c.email.light_and_logic_budget_sends, c.email.adhoc_reserve_sends]);
    root.querySelectorAll('[data-mk-set]').forEach((el) => {
      const [g, k] = el.dataset.mkSet.split('.');
      if (el.type === 'number' && el.value.trim() === '') return;
      c[g][k] = el.type === 'number' ? Number(el.value) : el.value.trim();
    });
    if (JSON.stringify([c.email.light_and_logic_budget_sends, c.email.adhoc_reserve_sends]) !== budgets) c.email.email_budget_note = `Edited in Marketing settings ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const r = await fetch('/api/aigeo/targets-master', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': window.getAdminKey() }, body: JSON.stringify({ propertyUrl: PROP, campaign_targets: c }) });
    const j = await r.json().catch(() => ({}));
    status.textContent = j.ok ? `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : `Not saved: ${j.error || r.status}`;
  }

  const ACTIONS = {
    'apply-params': (root) => { readParams(root); return render(root); },
    preview: () => preview(document.getElementById('mk-snap-out')),
    snapshot: () => snapshot(document.getElementById('mk-snap-out')),
    'cust-search': () => showCustomers(0),
    sync: () => syncNow(),
    'plan-import': () => planImport(),
    'save-settings': (root) => saveSettings(root)
  };

  function targetAction(t) {
    if (t.closest('[data-mk]')) return [ACTIONS[t.closest('[data-mk]').dataset.mk]];
    if (t.closest('[data-mk-view]')) return [() => { document.getElementById('mk-cust-seg').value = t.closest('[data-mk-view]').dataset.mkView; return showCustomers(0); }];
    if (t.closest('[data-mk-page]')) return [() => showCustomers(Number(t.closest('[data-mk-page]').dataset.mkPage))];
    if (t.closest('[data-mk-person]')) return [() => showDetail(t.closest('[data-mk-person]').dataset.mkPerson)];
    if (t.closest('[data-mk-csv]')) return [() => downloadCsv(t.closest('[data-mk-csv]').dataset.mkCsv)];
    if (t.closest('[data-mk-load]')) return [() => requestLoad(t.closest('[data-mk-load]').dataset.mkLoad)];
    if (t.closest('[data-mk-tests]')) return [() => { state.showTests = !state.showTests; document.getElementById('mk-exports').outerHTML = exportsHtml(state.data); }];
    if (t.closest('[data-mk-openq]')) return [() => { const s = state.data.segments.find((x) => x.segment_id === t.closest('[data-mk-openq]').dataset.mkOpenq); return window.mkOpenQuery?.(s.definition.query.root, s.name); }];
    if (t.closest('[data-mk-presend]')) return [() => presend(t.closest('[data-mk-presend]').dataset.mkPresend)];
    if (t.closest('[data-mk-review]')) return [() => showReview('mk-exp-review', { export_id: t.closest('[data-mk-review]').dataset.mkReview })];
    if (t.closest('[data-mk-excl]')) return [() => exclusion(t.closest('[data-mk-excl]').dataset.mkExcl)];
    if (t.closest('[data-mk-clear]')) return [() => clearOne(t.closest('[data-mk-clear]').dataset.mkClear)];
    if (t.closest('[data-mk-cancel]')) return [() => api('POST', '', { action: 'export-status', export_id: t.closest('[data-mk-cancel]').dataset.mkCancel, status: 'cancelled' }).then(() => render(document.getElementById('marketing-root')))];
    return [];
  }

  document.addEventListener('click', (e) => {
    const root = document.getElementById('marketing-root');
    if (!root || !root.contains(e.target)) return;
    const [fn] = targetAction(e.target);
    if (!fn) return;
    Promise.resolve(fn(root)).catch((err) => {
      const out = document.getElementById(e.target.closest('#mk-review') ? 'mk-review-out' : (e.target.closest('#mk-exports') ? 'mk-exp-out' : 'mk-snap-out'));
      if (out) out.innerHTML = `<span class="mk-chip warn">${esc(err.message)}</span>`;
    });
  });
  document.addEventListener('change', (e) => {
    const pick = e.target.closest?.('[data-mk-pick]');
    if (!pick) return;
    if (pick.checked) state.picked.add(pick.dataset.mkPick); else state.picked.delete(pick.dataset.mkPick);
    const nameBox = document.getElementById('mk-snap-name');
    if (nameBox) nameBox.value = defaultListName();
  });

  /** Nav activation and the panel watcher both call this; only one render may run, and a loaded tab is kept. */
  window.renderMarketingTab = function renderMarketingTab(force) {
    const root = document.getElementById('marketing-root');
    if (!root || root.dataset.loading === '1' || (!force && root.dataset.loaded === '1')) return;
    root.dataset.loading = '1';
    render(root).finally(() => { root.dataset.loading = ''; });
  };
  /** The tab can become active without a nav click (opened on #marketing, refresh, the Strategy link). */
  function watchPanel() {
    const panel = document.querySelector('.aigeo-panel[data-panel="marketing"]');
    const check = () => { if (panel?.classList.contains('is-active')) window.renderMarketingTab(); };
    if (panel) new MutationObserver(check).observe(panel, { attributes: true, attributeFilter: ['class'] });
    check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPanel);
  else setTimeout(watchPanel, 0);
})();
