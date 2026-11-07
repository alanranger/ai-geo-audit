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
    recently_emailed: 'emailed recently', no_longer_in_sources: 'no longer in sources'
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

  /* ---------- headline strip ---------- */

  function tile(label, value, meta, cls, tip) {
    return `<div class="rt-strip-card ${cls || ''}" title="${esc(tip)}"><div class="rt-strip-label">${label}</div><div class="rt-strip-value">${value}</div><div class="rt-strip-meta">${meta}</div></div>`;
  }
  function stripHtml(d) {
    const m = d.meter;
    const prof = d.runs['sync:profiles'];
    const budget = m.state === 'never_read' ? tile('Send budget', '—', 'no meter reading yet', 'band-survival', m.note)
      : tile('Send budget', n(m.after_reservations), `left after reservations · ${n(m.used)} of ${n(m.quota)} used · resets ${ukStamp(m.cycle?.reset)}<br>${m.state === 'fresh' ? 'read' : '<b>STALE</b> — read'} ${ukStamp(m.captured_at)}`, m.state === 'fresh' ? 'band-thrive' : 'band-survival', 'Squarespace send meter for this billing cycle (never a calendar month). Reservations are planned recipients on campaigns not yet sent.');
    const warn = healthWarnings(d);
    return `<div class="rt-strip">${tile('Subscribers', n(d.identity.subscribed_unsuppressed), `subscribed in Squarespace and not suppressed · as of ${ukStamp(prof?.finished_at)}`, 'band-thrive', 'Squarespace profiles with marketing consent, minus the permanent suppression list. Re-read from Squarespace every night and again when an audience is made.')}`
      + budget
      + tile('Segments', n(d.segments.length), `${d.segments.filter((s) => s.count > 0).length} with people · largest ${n(Math.max(...d.segments.map((s) => s.count)))}`, '', 'Day-one segments agreed with ChatGPT (only subscribed, unsuppressed people qualify) plus any you save.')
      + tile('Data health', warn.length ? `${warn.length} to check` : 'OK', warn.length ? esc(warn[0]) : 'all sources read in the last day', warn.length ? 'band-survival' : 'band-thrive', 'Last successful read of each source; anything older than a day, failed, or stale shows here.')
      + '</div>';
  }

  function healthWarnings(d) {
    const out = [];
    for (const step of ['profiles', 'orders', 'postcodes', 'customers']) {
      const r = d.runs[`sync:${step}`];
      if (!r || r.status !== 'ok') out.push(`Squarespace sync (${step}) ${r ? r.status : 'never run'}`);
      else if (hoursAgo(r.finished_at) > STALE_H) out.push(`Squarespace sync (${step}) last ran ${ukStamp(r.finished_at)}`);
    }
    const c = d.runs.collector;
    if (!c) out.push('Email-report collector not set up yet on Alan\'s PC');
    else if (c.status !== 'ok' || hoursAgo(c.finished_at || c.heartbeat_at) > STALE_H) out.push(`Email-report collector ${c.status === 'ok' ? 'stale' : c.status} (${ukStamp(c.finished_at || c.heartbeat_at)})`);
    if (d.meter.state !== 'fresh') out.push(`Send meter ${d.meter.state.replace('_', ' ')}`);
    if (d.identity.suppressed_but_subscribed > 0) out.push(`${d.identity.suppressed_but_subscribed} suppressed contact(s) show as subscribed again in Squarespace`);
    return out;
  }

  /* ---------- send budget ---------- */

  function budgetHtml(m) {
    if (m.state === 'never_read') return `<div class="rt-section"><h3>Email send budget (billing cycle)</h3><p class="rt-sub">${esc(m.note)}</p></div>`;
    const res = m.reservations.length ? m.reservations.map((r) => `<tr><td class="left">${esc(r.title || r.campaign_key)}</td><td>${n(r.reserved_sends)}</td><td>${esc(r.stage)}</td></tr>`).join('') : '<tr><td class="left rt-sub" colspan="3">No reservations — set planned recipients on a campaign record below.</td></tr>';
    const sent = m.sent_this_cycle.length ? m.sent_this_cycle.map((s) => `<tr><td class="left">${esc(s.subject)}</td><td>${n(s.recipients)}</td><td>${ukStamp(s.sent_on)}</td></tr>`).join('') : '<tr><td class="left rt-sub" colspan="3">None collected yet for this cycle (filled by the email-report collector).</td></tr>';
    const stale = m.state === 'fresh' ? '' : '<span class="rt-pill warn">STALE</span>';
    return `<div class="rt-section" id="mk-budget"><h3>Email send budget (billing cycle) ${stale}</h3>`
      + `<p class="rt-sub">Cycle ${ukStamp(m.cycle?.start)} → resets ${ukStamp(m.cycle?.reset)} (Squarespace's own reset; never a calendar month, no rollover). Meter read ${ukStamp(m.captured_at)} (${m.age_hours} h ago). Every campaign on the account uses this allowance, including ones made outside this dashboard.</p>`
      + `<table class="rt-table mk-kv"><tbody><tr><td class="left">Allowance this cycle</td><td>${n(m.quota)}</td></tr><tr><td class="left">Used (provider meter)</td><td>${n(m.used)}</td></tr><tr><td class="left">Remaining</td><td>${n(m.remaining)}</td></tr><tr><td class="left">Reserved for planned campaigns</td><td>${n(m.reserved)}</td></tr><tr><td class="left"><b>Left after reservations</b></td><td><b>${n(m.after_reservations)}</b></td></tr><tr><td class="left">Recipients of campaigns sent this cycle (collected)</td><td>${n(m.sent_recipients_this_cycle)}</td></tr></tbody></table>`
      + `<div class="two"><div><h4>Reservations</h4><table class="rt-table"><thead><tr><th class="left">Campaign</th><th>Recipients</th><th>Stage</th></tr></thead><tbody>${res}</tbody></table></div>`
      + `<div><h4>Sent this cycle</h4><table class="rt-table"><thead><tr><th class="left">Email</th><th>Recipients</th><th>Sent</th></tr></thead><tbody>${sent}</tbody></table></div></div></div>`;
  }

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
  function segmentsHtml(d) {
    const rows = d.segments.map((s) => `<tr><td><input type="checkbox" data-mk-pick="${esc(s.segment_id)}" ${state.picked.has(s.segment_id) ? 'checked' : ''} aria-label="Pick"></td>`
      + `<td class="left"><b>${esc(s.name)}</b><div class="rt-sub">${esc(s.description || '')}</div></td><td><b>${n(s.count)}</b></td><td class="left rt-sub">${topReasons(s.exclusions)}</td>`
      + `<td><button type="button" class="rf-btn rf-btn-secondary" data-mk-view="${esc(s.segment_id)}">People</button></td></tr>`).join('');
    return `<div class="rt-section" id="mk-segments"><h3>Customers &amp; segments</h3>`
      + '<p class="rt-sub">Only people who are subscribed in Squarespace, not suppressed and still in Squarespace can be in a segment. "Booked" is not "attended" (the Booking Sheet has no attendance column). History from Booking Sheet names alone is probable, never merged; people with incomplete history are counted apart, not as "never". Booking Sheet coverage is 2024 onward; Squarespace orders go back to 2014.</p>'
      + settingsRow()
      + `<table class="rt-table" id="mk-seg-table"><thead><tr><th></th><th class="left">Segment</th><th>People</th><th class="left">Main reasons others are out</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      + snapshotForm(d) + '</div>';
  }
  function snapshotForm(d) {
    const block = d.import_block?.blocked ? `<div class="mk-note warn"><b>Squarespace list import is blocked.</b> ${esc(d.import_block.reason)} (controlled test ${esc(ukDate(d.import_block.tested_on))}).</div>` : '';
    return `<div class="mk-snap"><h4>Audience snapshot for a campaign</h4><p class="rt-sub">Tick one or more segments: people in several are counted once. Making a snapshot re-reads consent from Squarespace first, then saves the audience (server-side only) for planning and send reservations.</p>${block}`
      + `<label class="st-ov-f mk-f">Campaign short name<input id="mk-snap-camp" type="text" placeholder="e.g. Jan beginners" style="width:12rem"></label>`
      + `<label class="st-ov-f mk-f">Campaign record key (optional)<input id="mk-snap-key" type="text" placeholder="email|2026-11-09" style="width:12rem"></label>`
      + `<label class="st-ov-f mk-f">List name<input id="mk-snap-name" type="text" maxlength="75" style="width:22rem"></label>`
      + `<button type="button" class="rf-btn" data-mk="preview">Count picked</button> <button type="button" class="rf-btn" data-mk="snapshot">Make snapshot</button><div id="mk-snap-out" class="rt-sub"></div></div>`;
  }

  /* ---------- exports ---------- */

  function exportsHtml(d) {
    const rows = d.exports.map((e) => `<tr><td class="left">${esc(e.list_name)}</td><td class="left rt-sub">${esc((e.segment_ids || []).join(', '))}</td><td>${n(e.eligible_count)}</td><td>${statusPill(e.status)}</td><td>${ukStamp(e.created_at)}</td>`
      + `<td>${e.status === 'pending_import' ? `<button type="button" class="rf-btn rf-btn-secondary" data-mk-csv="${e.export_id}">CSV</button>` : ''} ${e.status !== 'cancelled' ? `<button type="button" class="rf-btn rf-btn-secondary" data-mk-cancel="${e.export_id}">Cancel</button>` : ''}</td></tr>`).join('');
    return `<div class="rt-section" id="mk-exports"><h3>Audience snapshots</h3><table class="rt-table"><thead><tr><th class="left">List name</th><th class="left">Segments</th><th>People</th><th>Status</th><th>Made</th><th></th></tr></thead><tbody>${rows || '<tr><td class="left rt-sub" colspan="6">None yet.</td></tr>'}</tbody></table></div>`;
  }
  const statusPill = (s) => `<span class="rt-pill ${s === 'imported' ? 'ok' : (s === 'blocked' ? 'warn' : 'current')}">${esc(String(s).replace('_', ' ').toUpperCase())}</span>`;

  /* ---------- customers ---------- */

  function histChips(cats) {
    return Object.entries(cats || {}).filter(([, v]) => v.c > 0 || v.p > 0).map(([k, v]) => `<span class="mk-chip ${v.c > 0 ? '' : 'prob'}" title="${v.c} confirmed · ${v.p} probable${v.future_c ? ` · ${v.future_c} ahead` : ''}">${esc(CAT_LABEL[k] || k)}${v.c > 0 ? '' : '?'}</span>`).join(' ');
  }
  const engChip = (e) => `<span class="mk-eng mk-eng-${esc(e.open)}" title="Opens: ${esc(e.open)} · clicks: ${esc(e.click)} · ${esc(e.last5 || 'no tracked emails')}">${esc(e.open.replace('_', ' '))} / ${esc(e.click.replace('_', ' '))}</span>`;
  function customerRow(r) {
    const flags = [r.history_incomplete ? '<span class="mk-chip prob" title="Some history is probable (Booking Sheet name match) or Squarespace shows more orders than are linked">incomplete</span>' : '', r.bought_for_others ? `<span class="mk-chip" title="Bought places for someone else">gift buyer ×${r.bought_for_others}</span>` : '', r.suppressed ? `<span class="mk-chip warn">${esc(r.suppressed)}</span>` : ''].join(' ');
    return `<tr data-mk-person="${r.person_id}"><td class="left">${esc(r.name || '—')}<div class="rt-sub">${esc(r.email || r.kind)}</div></td><td>${r.subscribed ? '<span class="rt-pill ok">YES</span>' : '<span class="rt-pill">NO</span>'}</td>`
      + `<td>${r.miles == null ? '<span class="rt-sub">unknown</span>' : `${r.miles} mi`}</td><td class="left">${histChips(r.cats)}</td><td>${ukDate(r.last_booking)}</td><td>${r.future.length || ''}</td><td>${esc(r.academy || '')}</td><td>${engChip(r.engagement)}</td><td class="left">${flags}</td></tr>`;
  }
  function customersShell(d) {
    const opts = d.segments.map((s) => `<option value="${esc(s.segment_id)}">${esc(s.name)}</option>`).join('');
    return `<div class="rt-section" id="mk-customers"><h3>Customer view</h3><p class="rt-sub">One row per person. Grey "?" history = probable only (a Booking Sheet name that exactly matches one Squarespace contact). Distance is from the profile postcode (else the latest billing postcode) to the centre above — where someone attended is not where they live. Engagement = opens / clicks band (Release 2; "unknown" until the email-report collector has read their emails).</p>`
      + `<div class="mk-params"><input id="mk-cust-q" type="search" placeholder="Search name or email" style="width:16rem"> <select id="mk-cust-seg"><option value="">Everyone</option>${opts}</select> <label class="rt-sub"><input id="mk-cust-sub" type="checkbox"> subscribed only</label> <button type="button" class="rf-btn rf-btn-secondary" data-mk="cust-search">Show</button></div>`
      + '<div id="mk-cust-body"><p class="rt-sub">Pick a segment or search, then Show.</p></div><div id="mk-detail"></div></div>';
  }
  function customersTable(j) {
    const pages = Math.ceil(j.total / j.page_size);
    const nav = pages > 1 ? `<div class="mk-params"><button type="button" class="rf-btn rf-btn-secondary" data-mk-page="${j.page - 1}" ${j.page <= 0 ? 'disabled' : ''}>‹ Prev</button> <span class="rt-sub">Page ${j.page + 1} of ${pages} · ${n(j.total)} people</span> <button type="button" class="rf-btn rf-btn-secondary" data-mk-page="${j.page + 1}" ${j.page + 1 >= pages ? 'disabled' : ''}>Next ›</button></div>` : `<p class="rt-sub">${n(j.total)} people</p>`;
    return nav + `<div class="st-diary-scroll"><table class="rt-table" id="mk-cust-table"><thead><tr><th class="left">Person</th><th>Subscribed</th><th>Distance</th><th class="left">History</th><th>Last booking</th><th>Ahead</th><th>Academy</th><th>Opens / clicks</th><th class="left">Flags</th></tr></thead><tbody>${j.rows.map(customerRow).join('') || '<tr><td colspan="9" class="rt-sub">No one.</td></tr>'}</tbody></table></div>`;
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
  function engagementHtml(d) {
    const e = d.engagement;
    const cov = e.coverage;
    const bf = d.runs['collector:backfill'];
    const pct = bf?.items_total ? Math.round((bf.items_done / bf.items_total) * 100) : null;
    const etaMin = bf?.status === 'running' && bf.items_done ? Math.round(((Date.parse(bf.heartbeat_at) - Date.parse(bf.started_at)) / bf.items_done) * (bf.items_total - bf.items_done) / 60000) : null;
    const prog = bf ? `<div class="mk-prog"><div style="width:${pct || 0}%"></div></div><p class="rt-sub">Backfill: ${esc(bf.status)} · ${n(bf.items_done)} of ${n(bf.items_total)} campaigns (${pct ?? 0}%)${etaMin != null ? ` · about ${etaMin} min left` : ''} · last heartbeat ${ukStamp(bf.heartbeat_at)}${hoursAgo(bf.heartbeat_at) > 1 && bf.status === 'running' ? ' — <b>stalled (PC asleep / closed?)</b>; re-run to resume' : ''}</p>` : '<p class="rt-sub">Backfill not started.</p>';
    return `<div class="rt-section" id="mk-engagement"><h3>Email engagement (Release 2)</h3><p class="rt-sub">From the email-report collector on Alan's PC (dedicated browser profile; Alan signs in once, his password is never stored or typed). ${n(cov.complete)} of ${n(cov.campaigns)} sent campaigns have complete recipient lists${cov.is_complete ? '' : ' — until all are read, older signals show as unknown, never cold'}. Warm ≤ ${e.windows.warm_days} days, cooling ≤ ${e.windows.cooling_days}, cold beyond; dated by the campaign's send date. An open is a recorded signal, not proof the email was read.</p>${prog}`
      + `<table class="rt-table"><thead><tr><th class="left">Subscribed people by</th><th>Warm</th><th>Cooling</th><th>Cold</th><th>None recorded</th><th>Too few emails</th><th>Unknown</th></tr></thead><tbody><tr><td class="left">Opens</td>${bandCells(e.bands.open)}</tr><tr><td class="left">Clicks</td>${bandCells(e.bands.click)}</tr></tbody></table>`
      + '<p class="rt-sub">First time on this PC: <code>npm run marketing:collector-login</code> (sign in, close the window), then <code>npm run marketing:collector-backfill</code> once. The nightly task runs <code>npm run marketing:collector</code>.</p></div>';
  }

  /* ---------- sources + sync ---------- */

  function runRow(label, r, extra) {
    const stale = r && r.status === 'ok' && hoursAgo(r.finished_at) > STALE_H;
    const pill = !r ? '<span class="rt-pill warn">NEVER RUN</span>' : (r.status === 'ok' ? (stale ? '<span class="rt-pill warn">STALE</span>' : '<span class="rt-pill ok">OK</span>') : `<span class="rt-pill ${r.status === 'failed' ? 'bad' : 'warn'}">${esc(String(r.status).toUpperCase())}</span>`);
    return `<tr><td class="left">${label}</td><td>${pill}</td><td>${ukStamp(r?.finished_at || r?.heartbeat_at)}</td><td class="left rt-sub">${esc(r?.error || extra || '')}</td></tr>`;
  }
  function sourcesHtml(d) {
    const c = d.coverage;
    const cov = (x, label) => `<tr><td class="left">${label}</td><td>${n(x.rows)}</td><td>${ukDate(x.from)}</td><td>${ukStamp(x.last_import)}</td></tr>`;
    const s = d.runs;
    return `<div class="rt-section" id="mk-sources"><h3>Sources &amp; sync health</h3><button type="button" class="rf-btn" data-mk="sync">Sync now</button> <span class="rt-sub">Reads Squarespace (profiles, orders), looks up postcodes and rebuilds the customer view. Runs nightly by itself.</span>`
      + `<table class="rt-table"><thead><tr><th class="left">Step</th><th>State</th><th>Last run</th><th class="left">Note</th></tr></thead><tbody>${runRow('Squarespace profiles (consent)', s['sync:profiles'], s['sync:profiles']?.summary ? `${n(s['sync:profiles'].summary.profiles)} contacts, ${n(s['sync:profiles'].summary.subscribed)} subscribed` : '')}${runRow('Squarespace orders', s['sync:orders'], s['sync:orders']?.summary ? `${n(s['sync:orders'].summary.orders)} orders read (${esc(s['sync:orders'].summary.mode)})` : '')}${runRow('Postcode lookup', s['sync:postcodes'])}${runRow('Customer view rebuild', s['sync:customers'], s['sync:customers']?.summary ? `${n(s['sync:customers'].summary.persons)} people · ${n(s['sync:customers'].summary.workshop_sqs_refs)} workshop #0xxxx refs` : '')}${runRow('Email-report collector (PC)', s.collector)}${runRow('Collector backfill (PC)', s['collector:backfill'])}</tbody></table>`
      + `<table class="rt-table"><thead><tr><th class="left">Data</th><th>Rows</th><th>From</th><th>Last import</th></tr></thead><tbody>${cov(c.squarespace_orders, 'Squarespace orders')}${cov(c.booking_sheet_transactions, 'Booking Sheet transactions')}${cov(c.booking_sheet_workshops, 'Booking Sheet workshop attendees')}${cov(c.booking_sheet_courses, 'Booking Sheet course attendees')}</tbody></table>`
      + `<p class="rt-sub">People: ${n(d.identity.persons)} (${n(d.identity.squarespace_profiles)} Squarespace contacts, ${n(d.identity.booking_sheet_name_only)} Booking Sheet name-only records, ${n(d.identity.academy_linked)} Academy members linked by email) · ${n(d.identity.with_location)} contacts have a located postcode · suppression list ${n(d.suppression.active)} (${Object.entries(d.suppression.by_reason).map(([k, v]) => `${esc(k.replace(/_/g, ' '))} ${n(v)}`).join(', ')}).</p></div>`;
  }

  /* ---------- settings (campaign channels, moved from the Targets panel) ---------- */

  function settingsHtml(t, d) {
    const c = t?.campaign_targets;
    if (!c) return '';
    return `<div class="rt-section" id="mk-settings"><h3>Marketing settings</h3><p class="rt-sub">The campaign channel timetable (moved here from the Targets panel, which now shows it read-only). The email list size and send cap are no longer typed in: they come from Squarespace (${n(d.identity.subscribed_unsuppressed)} subscribed now; allowance ${n(d.meter.quota)} a billing cycle).</p>`
      + `<label class="st-ov-f mk-f">Email day<input data-mk-set="email.day" type="text" value="${esc(c.email.day)}" style="width:8rem"></label>`
      + `<label class="st-ov-f mk-f">Light &amp; Logic folded into the week of the (day of month)<input data-mk-set="email.light_and_logic_day" type="number" value="${esc(c.email.light_and_logic_day)}" style="width:5rem"></label>`
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
    section[data-panel="marketing"] .rt-strip { margin-bottom: 1.25rem; }
    .mk-params { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: flex-end; margin: 0.5rem 0 0.8rem; }
    .mk-f { display: inline-block; margin-right: 0.4rem; }
    .mk-chip { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #1e293b; color: #e5e7eb; margin: 0 2px 2px 0; white-space: nowrap; }
    .mk-chip.prob { background: transparent; border: 1px dashed #64748b; color: #94a3b8; } .mk-chip.warn { background: #78350f; color: #fde68a; }
    .mk-eng { font-size: 11px; white-space: nowrap; color: #94a3b8; } .mk-eng-warm { color: #4ade80; } .mk-eng-cooling, .mk-eng-cooling_partial { color: #fbbf24; } .mk-eng-cold { color: #f59e0b; }
    .mk-note { border-left: 4px solid #f59e0b; background: #1c1917; padding: 0.6rem 0.8rem; margin: 0.5rem 0; font-size: 0.85rem; }
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

  async function render(root) {
    root.innerHTML = '<div class="rt-loading">Loading Marketing &amp; Campaigns…</div>';
    try {
      const [d, targets] = await Promise.all([api('GET', qs({ action: 'overview', ...paramQuery() })), fetch(`/api/aigeo/targets-master?propertyUrl=${encodeURIComponent(PROP)}`).then((r) => r.json()).catch(() => null)]);
      state.data = d;
      window.mkLiveListSize = d.identity.subscribed_unsuppressed;
      window.mkMeter = d.meter;
      root.innerHTML = `${STYLE}<div class="card--section-header"><h2>Marketing &amp; Campaigns</h2><p class="rt-sub">Campaign steps, customers &amp; segments, the email send budget and campaign results. Same campaign records as Strategy &amp; Actions. Nothing here sends, schedules or changes anything in Squarespace.</p></div>`
        + stripHtml(d) + budgetHtml(d.meter) + '<div class="rt-section" id="mk-campaign-host"><div class="rt-loading">Loading campaign steps…</div></div>'
        + segmentsHtml(d) + exportsHtml(d) + customersShell(d) + engagementHtml(d) + sourcesHtml(d) + settingsHtml(targets, d);
      mountCampaignSteps();
      root.dataset.loaded = '1';
    } catch (e) {
      root.innerHTML = e.message === 'NO_KEY'
        ? `${STYLE}<div class="rt-section"><h3>Marketing &amp; Campaigns</h3><p class="rt-sub">Customer data needs the admin key in this browser: Configuration &amp; Reporting → "Optimisation Tracking Security" → Save Admin Key, then open this tab again.</p></div>`
        : `<div class="rt-error">${esc(e.message)}</div>`;
    }
  }

  async function mountCampaignSteps() {
    const host = document.getElementById('mk-campaign-host');
    if (!host || typeof window.stLoadStrategySummary !== 'function' || typeof window.mountMarketingCampaign !== 'function') return;
    try { window.mountMarketingCampaign(host, await window.stLoadStrategySummary()); } catch (e) { host.innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
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
  async function preview(out) {
    out.textContent = 'Counting…';
    const j = await api('POST', '', { action: 'segment-preview', segment_ids: [...state.picked], params: paramQuery() });
    out.innerHTML = `<b>${n(j.count)}</b> people (deduplicated) · ${topReasons(j.exclusions)}`;
  }
  async function snapshot(out) {
    const name = document.getElementById('mk-snap-name').value || defaultListName();
    out.textContent = 'Re-reading consent from Squarespace, then saving the audience… (about 30 seconds)';
    const j = await api('POST', '', { action: 'export-create', segment_ids: [...state.picked], params: paramQuery(), campaign_key: document.getElementById('mk-snap-key').value || null, list_name: name });
    out.innerHTML = `Saved <b>${esc(j.list_name)}</b>: ${n(j.eligible_count)} people · status ${statusPill(j.status)}${j.import_block ? ' — list import blocked (see note above)' : ''}`;
  }
  async function showCustomers(page) {
    const body = document.getElementById('mk-cust-body');
    state.customers = { page: page || 0, q: document.getElementById('mk-cust-q').value, segment_id: document.getElementById('mk-cust-seg').value, sub: document.getElementById('mk-cust-sub').checked ? '1' : '' };
    body.innerHTML = '<div class="rt-loading">Loading people…</div>';
    const j = await api('GET', qs({ action: 'customers', q: state.customers.q, segment_id: state.customers.segment_id, page: state.customers.page, subscribed_only: state.customers.sub, ...paramQuery() }));
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

  /** Sync with a progress window: one server call per step; % and ETA from the steps done so far. */
  async function syncNow(root) {
    const steps = [['profiles', 'Squarespace profiles (consent)'], ['orders', 'Squarespace orders'], ['postcodes', 'Postcode lookup'], ['customers', 'Rebuild customer view']];
    const modal = document.createElement('div');
    modal.id = 'mk-modal';
    document.body.appendChild(modal);
    const t0 = Date.now();
    try {
      for (let i = 0; i < steps.length; i += 1) {
        const eta = i ? Math.round(((Date.now() - t0) / i) * (steps.length - i) / 1000) : null;
        modal.innerHTML = `<div class="box"><h4>Syncing…</h4><div class="mk-prog"><div style="width:${Math.round((i / steps.length) * 100)}%"></div></div><p class="rt-sub">${Math.round((i / steps.length) * 100)}% · step ${i + 1} of ${steps.length}: ${steps[i][1]}${eta != null ? ` · about ${eta}s left` : ''}</p></div>`;
        await api('POST', '', { action: 'sync', step: steps[i][0] });
      }
      modal.remove();
      await render(root);
    } catch (e) {
      modal.innerHTML = `<div class="box"><h4>Sync stopped</h4><p class="rt-sub">${esc(e.message)}</p><button type="button" class="rf-btn" onclick="this.closest('#mk-modal').remove()">Close</button></div>`;
    }
  }

  async function saveSettings(root) {
    const status = root.querySelector('#mk-set-status');
    status.textContent = 'Saving…';
    const t = await fetch(`/api/aigeo/targets-master?propertyUrl=${encodeURIComponent(PROP)}`).then((r) => r.json());
    const c = JSON.parse(JSON.stringify(t.campaign_targets));
    root.querySelectorAll('[data-mk-set]').forEach((el) => { const [g, k] = el.dataset.mkSet.split('.'); c[g][k] = el.type === 'number' ? Number(el.value) : el.value.trim(); });
    const r = await fetch('/api/aigeo/targets-master', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': window.getAdminKey() }, body: JSON.stringify({ propertyUrl: PROP, campaign_targets: c }) });
    const j = await r.json().catch(() => ({}));
    status.textContent = j.ok ? `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : `Not saved: ${j.error || r.status}`;
  }

  const ACTIONS = {
    'apply-params': (root) => { readParams(root); return render(root); },
    preview: () => preview(document.getElementById('mk-snap-out')),
    snapshot: () => snapshot(document.getElementById('mk-snap-out')),
    'cust-search': () => showCustomers(0),
    sync: (root) => syncNow(root),
    'save-settings': (root) => saveSettings(root)
  };

  function targetAction(t) {
    if (t.closest('[data-mk]')) return [ACTIONS[t.closest('[data-mk]').dataset.mk]];
    if (t.closest('[data-mk-view]')) return [() => { document.getElementById('mk-cust-seg').value = t.closest('[data-mk-view]').dataset.mkView; return showCustomers(0); }];
    if (t.closest('[data-mk-page]')) return [() => showCustomers(Number(t.closest('[data-mk-page]').dataset.mkPage))];
    if (t.closest('[data-mk-person]')) return [() => showDetail(t.closest('[data-mk-person]').dataset.mkPerson)];
    if (t.closest('[data-mk-csv]')) return [() => downloadCsv(t.closest('[data-mk-csv]').dataset.mkCsv)];
    if (t.closest('[data-mk-cancel]')) return [() => api('POST', '', { action: 'export-status', export_id: t.closest('[data-mk-cancel]').dataset.mkCancel, status: 'cancelled' }).then(() => render(document.getElementById('marketing-root')))];
    return [];
  }

  document.addEventListener('click', (e) => {
    const root = document.getElementById('marketing-root');
    if (!root || !root.contains(e.target)) return;
    const [fn] = targetAction(e.target);
    if (!fn) return;
    Promise.resolve(fn(root)).catch((err) => {
      const out = document.getElementById('mk-snap-out');
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

  window.renderMarketingTab = function renderMarketingTab(force) {
    const root = document.getElementById('marketing-root');
    if (!root || (!force && root.dataset.loaded === '1')) return;
    render(root);
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
