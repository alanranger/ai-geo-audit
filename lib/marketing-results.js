/**
 * Marketing & Campaigns → "3 · Results" (mock-up marketing-clean-v1): one row per email or post that actually went
 * out, newest first, from GET /api/aigeo/marketing-results (lib/marketing/results.mjs: provider evidence only; counts
 * and list names, never members or names). Bookings after + £ come with each row from the server
 * (lib/marketing/results-bookings.mjs: places booked on the promoted event(s) from the send day, Booking Sheet, the old
 * results panel's rule; assisted, inferred). "—" only when no event is linked; a linked event with none booked = 0 / £0.
 * Unknown is never 0: "tomorrow" = opens not collected yet, "collecting" = post not read back yet, "Mon entry" =
 * LinkedIn until GPT's weekly entry, "—" = does not apply (Stories have no figures).
 */
(function () {
  const PROP = 'https://www.alanranger.com';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => Number(v).toLocaleString('en-GB');
  const gbp = (v) => `£${Math.round(Number(v) || 0).toLocaleString('en-GB')}`;
  const stamp = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(/,/g, '');
  const CH = { email: ['Email', 'e'], facebook: ['FB', 'f'], instagram: ['IG', 'i'], story: ['Story', 's'], linkedin: ['LinkedIn', 'l'] };
  const DIM = (t) => `<span class="mkr-dim">${esc(t)}</span>`;
  const view = { days: 7, event: '', channel: '', open: null };
  const state = { host: null, rows: [], error: null };

  /** The first promoted event's short name (filter); titles like "… - Week 1 of 3 -12-11" lose their date tail. */
  const cleanEvent = (t) => String(t || '').replace(/\s*-\s*\d{1,2}-\d{1,2}$/, '').replace(/\s*\|.*$/, '').trim();
  const eventOf = (r) => cleanEvent(r.bookings?.events?.[0]?.title);

  /* ---------- cells ---------- */

  const chips = (r) => r.channels.map((c) => `<span class="mkw-ch mkw-ch-${CH[c.ch][1]}">${CH[c.ch][0]}</span>`).join('');
  /** A post channel's unknown figure: LinkedIn waits for GPT's Monday entry; FB / IG are being read back. */
  const unknownPost = (c) => (c.ch === 'linkedin' ? 'Mon entry' : 'collecting');
  const figured = (r) => r.channels.filter((c) => c.ch !== 'story');
  function reachCell(r) {
    if (r.kind === 'email') return r.sent_to == null ? DIM('—') : n(r.sent_to);
    const list = figured(r);
    if (!list.length) return DIM('—');
    return list.map((c) => (c.reach == null ? DIM(unknownPost(c)) : n(c.reach))).join(' · ');
  }
  const OPEN_STATE = { collecting: 'collecting' };
  const dayMonth = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  /** A sent email: the opens with "collected {date}" under them, else "collecting" (never a promise like "tomorrow"). */
  function openedCell(r) {
    if (r.kind !== 'email') return DIM('—');
    if (r.opens_state !== 'collected' || r.opened == null) return DIM(OPEN_STATE[r.opens_state] || 'collecting');
    const pct = r.sent_to ? ` (${Math.round((r.opened / r.sent_to) * 100)}%)` : '';
    return `${n(r.opened)}${pct}${r.opens_at ? `<div class="mkr-sub">collected ${esc(dayMonth(r.opens_at))}</div>` : ''}`;
  }
  function clickedCell(r) {
    if (r.kind !== 'email') return DIM('—');
    return r.opens_state === 'collected' && r.clicked != null ? n(r.clicked) : DIM(OPEN_STATE[r.opens_state] || 'collecting');
  }
  function reactCell(r) {
    if (r.kind === 'email') return DIM('—');
    const list = figured(r);
    if (!list.length) return DIM('—');
    return list.map((c) => (c.likes == null && c.comments == null ? DIM(unknownPost(c)) : `${n(c.likes ?? 0)}·${n(c.comments ?? 0)}`)).join(' · ');
  }
  /** "—" only when no event is linked; a linked event with nothing booked is a real 0 / £0. */
  function bookCells(r) {
    const a = r.bookings?.after;
    return a ? `<td>${n(a.bookings)}</td><td>${gbp(a.revenue)}</td>` : `<td>${DIM('—')}</td><td>${DIM('—')}</td>`;
  }
  /* ---------- shared delivery status (lib/marketing/delivery-status.mjs; same words as the schedule List) ---------- */

  const TONE = { green: 'ok', blue: 'sch', amber: 'amb', grey: 'prep', red: 'late', neutral: 'chk' };
  /** The List's own badge (window.mkScheduleList.badge) so every view shows the same word + icon + colour. */
  const badge = (s) => (window.mkScheduleList?.badge ? window.mkScheduleList.badge(s) : `<span class="mkl-st mkl-${TONE[s.tone] || 'chk'}"><i>${esc(s.icon)}</i>${esc(s.label)}</span>`);
  /** The status board (GET ?action=delivery-status) wins when it has this send: by provider id (email) or step (post). */
  function boardStatus(r) {
    const b = state.board;
    if (!b) return null;
    if (r.provider_id) return (b.emails || []).find((e) => e.email_id === r.provider_id)?.status || null;
    const pls = (b.placements || []).filter((p) => r.step_keys.includes(p.step_key)).map((p) => p.status);
    return pls.find((s) => s?.code === 'published') || null;
  }
  const statusOf = (r) => boardStatus(r) || r.status || null;
  function statusCell(r) {
    const s = statusOf(r);
    if (!s) return `<td class="mkr-when">${esc(stamp(r.sent_at))}</td>`;
    const when = String(s.when || '').replace(/^(Sent|Published|Due|Scheduled|Planned)\s+/, '') || stamp(r.sent_at);
    const link = s.link ? ` <a href="${esc(s.link)}" target="_blank" rel="noopener" title="${esc(s.evidence || 'open')}">↗</a>` : '';
    return `<td class="mkr-when left">${badge(s)}${link}<div class="mkr-sub">${esc(when)}</div></td>`;
  }

  function rowHtml(r) {
    const open = view.open === r.id;
    return `<tr data-mkr-row="${esc(r.id)}" class="${open ? 'on' : ''}">${statusCell(r)}<td class="left"><b>${esc(r.what || 'Post (no text)')}</b></td><td class="left">${chips(r)}</td>`
      + `<td>${reachCell(r)}</td><td>${openedCell(r)}</td><td>${clickedCell(r)}</td><td>${reactCell(r)}</td>${bookCells(r)}</tr>${open ? detailRow(r) : ''}`;
  }

  /* ---------- detail ---------- */

  const ukDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function bookingsHtml(r) {
    const b = r.bookings;
    if (!b) return DIM('No event linked to this one: bookings not measured.');
    const a = b.after;
    const evs = b.events.map((e) => `<li>${esc(cleanEvent(e.title))} · ${esc(ukDate(e.date))} <span class="mkr-dim">(${esc(e.basis)})</span></li>`).join('');
    return `<div>After the send (assisted, inferred): <b>${n(a.bookings)} place${a.bookings === 1 ? '' : 's'} · ${gbp(a.revenue)}</b></div><ul>${evs}</ul>`
      + '<div class="mkr-dim">Booking Sheet: a place counts when its booking falls between the send day and the event date. No booking carries a campaign tag.</div>';
  }
  function audienceHtml(r) {
    if (r.kind !== 'email') return esc(r.audience?.note || 'Followers of each channel');
    const lists = (r.audience?.lists || []).map(esc).join(' + ') || 'Squarespace list';
    return `${lists}${r.audience?.count != null ? ` · ${n(r.audience.count)} sent` : ''}`;
  }
  function detailRow(r) {
    const links = r.channels.filter((c) => c.url).map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${CH[c.ch][0]} post</a>`).join(' · ');
    return `<tr class="mkr-detail"><td colspan="9"><div class="mkr-grid">`
      + `<div><h5>Audience</h5>${audienceHtml(r)}</div><div><h5>Copy</h5><div class="mkr-copy">${esc(String(r.copy || '').slice(0, 600))}</div>${r.plan ? `<div class="mkr-dim">Plan: ${esc(r.plan)}</div>` : ''}</div>`
      + `<div><h5>Evidence</h5><ul>${r.evidence.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${links}</div><div><h5>Bookings</h5>${bookingsHtml(r)}</div></div></td></tr>`;
  }

  /* ---------- filters + paint ---------- */

  function filtered() {
    const since = Date.now() - view.days * 864e5;
    return state.rows.filter((r) => Date.parse(r.sent_at) >= since)
      .filter((r) => !view.channel || r.channels.some((c) => c.ch === view.channel))
      .filter((r) => !view.event || eventOf(r) === view.event);
  }
  function filtersHtml() {
    const days = [7, 30].map((k) => `<button type="button" class="mks-tab${view.days === k ? ' on' : ''}" data-mkr-days="${k}">${k} days</button>`).join('');
    const events = [...new Set(state.rows.map(eventOf).filter(Boolean))].sort();
    const ev = `<select data-mkr-event><option value="">Every event</option>${events.map((e) => `<option${view.event === e ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>`;
    const ch = `<select data-mkr-channel><option value="">Every channel</option>${Object.entries(CH).map(([k, [l]]) => `<option value="${k}"${view.channel === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<div class="mkr-filters">${days} ${ev} ${ch}</div>`;
  }
  function paint() {
    if (!state.host?.isConnected) return;
    const head = '<h3 class="mk-sec-h">3 · Results <span class="mkr-dim mkr-h">everything already sent or posted, newest first</span></h3><div class="mkw-sub">One row per email or post. Bookings after = places booked for the promoted event after the send (assisted, not proven).</div>';
    if (state.error) { state.host.innerHTML = `${head}<div class="rt-error">${esc(state.error)}</div>`; return; }
    const rows = filtered();
    const empty = state.loaded ? '<tr><td colspan="9" class="mkr-dim">Nothing sent in this filter.</td></tr>' : `<tr><td colspan="9" class="mkr-dim">Loading…</td></tr>${'<tr class="mkw-skel"><td colspan="9"><span></span></td></tr>'.repeat(3)}`;
    const body = rows.map(rowHtml).join('') || empty;
    state.host.innerHTML = `${head}${filtersHtml()}<div class="mkw-wrap"><table class="rt-table mkr-table"><thead><tr><th class="left">Status</th><th class="left">What</th><th class="left">Channel</th><th>Sent to / reach</th><th>Opened</th><th>Clicked</th><th>Reactions · comments</th><th>Bookings after</th><th>£</th></tr></thead><tbody>${body}</tbody></table></div>`
      + '<div class="mkw-sub mkr-foot">Filters: last 7 days · 30 days · by event · by channel. Click a row for the detail (audience, copy, evidence, bookings).</div>';
  }

  async function load() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`/api/aigeo/marketing-results?days=30&propertyUrl=${encodeURIComponent(PROP)}`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.error || `status ${r.status}`);
    return j.rows || [];
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#mk-results')) return;
    const d = e.target.closest('[data-mkr-days]');
    if (d) { view.days = Number(d.dataset.mkrDays); paint(); return; }
    const row = e.target.closest('[data-mkr-row]');
    if (row && !e.target.closest('a')) { view.open = view.open === row.dataset.mkrRow ? null : row.dataset.mkrRow; paint(); }
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest?.('#mk-results [data-mkr-event], #mk-results [data-mkr-channel]');
    if (!el) return;
    if (el.hasAttribute('data-mkr-event')) view.event = el.value; else view.channel = el.value;
    paint();
  });
  const reload = () => load().then((rows) => { state.rows = rows; state.loaded = true; state.error = null; paint(); }, (e) => { state.error = `Results unavailable: ${e.message}`; paint(); });
  const useBoard = (b) => { if (b) { state.board = b; paint(); } };
  /** After "Refresh status" (a real provider check): the new board and the Results rows, re-read. */
  document.addEventListener('mk-status-refreshed', (e) => {
    if (!state.host?.isConnected) return;
    useBoard(e.detail);
    reload();
  });
  window.mkMountResults = function mkMountResults(host) {
    if (!host) return;
    Object.assign(state, { host, rows: [], error: null, loaded: false, board: null });
    paint();
    reload();
    if (typeof window.mkLoadDeliveryStatus === 'function') window.mkLoadDeliveryStatus().then(useBoard, () => {});
  };
  window.mkResultsCells = { reachCell, openedCell, clickedCell, reactCell, bookCells, statusCell };

  const CSS = `
  .mkr-h { font-size: 0.8rem; font-weight: 400; } .mkr-dim { color: #94a3b8; }
  .mkr-filters { display: flex; gap: 6px; align-items: center; margin: 4px 0 8px; flex-wrap: wrap; }
  .mkr-filters select { background: #0b1118; color: #e5e7eb; border: 1px solid #334155; border-radius: 6px; padding: 3px 6px; font-size: 0.8rem; }
  .mkr-table { width: 100%; margin: 0 !important; } .mkr-table th { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.04em; color: #94a3b8; }
  .mkr-table tbody tr[data-mkr-row] { cursor: pointer; } .mkr-table tbody tr[data-mkr-row]:hover td, .mkr-table tbody tr.on td { background: #151c2b; }
  .mkr-when { white-space: nowrap; } .mkr-detail td { background: #0b1118; text-align: left; }
  .mkr-grid { display: grid; grid-template-columns: 1fr 1.4fr 1.4fr 1.2fr; gap: 14px; font-size: 0.82rem; padding: 6px 4px; text-align: left; white-space: normal; }
  .mkr-grid h5 { margin: 0 0 4px; color: #fff; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .mkr-grid ul { margin: 0; padding-left: 16px; } .mkr-copy { white-space: pre-wrap; color: #cbd5e1; max-height: 9rem; overflow: auto; }
  .mkr-foot { margin-top: 6px; } .mkr-sub { color: #94a3b8; font-size: 0.72rem; }
  .mkr-when a { color: #93c5fd; text-decoration: none; font-size: 0.8rem; }`;
  if (!document.getElementById('mkr-css')) {
    const st = document.createElement('style');
    st.id = 'mkr-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
})();
