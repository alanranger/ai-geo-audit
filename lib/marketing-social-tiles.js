/**
 * "Social channels" row (Facebook · Instagram · LinkedIn · YouTube · Google Business) directly under the Overview tiles
 * on Marketing & Campaigns, plus "Recent posts across channels" (last 10, sortable) and a "Social connections" block in
 * Rules & data sources. Self-mounting: it watches for #mk-overview-tiles (painted by lib/marketing-tab.js) and inserts
 * #mk-social after it, so marketing-tab.js is not edited. Data: GET /api/aigeo/social?action=summary (admin key);
 * viewing writes nothing. Buttons: Connect Facebook & Instagram (Meta login, read-only), Disconnect, Collect now
 * (progress window), Enter this week (LinkedIn manual entry). Nothing posts, sends or changes consent.
 */
(function () {
  const API = '/api/aigeo/social';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : '—');
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const state = { data: null, at: 0, sort: { key: 'posted_at', dir: -1 }, note: '' };
  const COLOR = { facebook: '#4f7df3', instagram: '#e0569b', linkedin: '#2aa3c9', youtube: '#e5484d', gbp: '#3fbf74' };
  const GLYPH = {
    facebook: '<circle cx="9" cy="10" r="2.3"/><circle cx="15.5" cy="10.5" r="1.9"/><path d="M5 17c.6-2.6 2.2-3.7 4-3.7s3.4 1.1 4 3.7M13.5 14.2c.6-.5 1.3-.8 2-.8 1.6 0 2.8 1 3.3 3.2"/>',
    instagram: '<rect x="5.5" y="7" width="13" height="10" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M9 7l1-1.6h4L15 7"/>',
    linkedin: '<rect x="5" y="8.5" width="14" height="9" rx="1.5"/><path d="M9.5 8.5V7a1 1 0 011-1h3a1 1 0 011 1v1.5M5 12.5h14"/>',
    gbp: '<path d="M12 18.5s-5-4.6-5-8.3a5 5 0 0110 0c0 3.7-5 8.3-5 8.3z"/><circle cx="12" cy="10.2" r="1.8"/>'
  };
  const icon = (k, size = 18) => (k === 'youtube'
    ? `<svg class="mksoc-ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="YouTube"><circle cx="12" cy="12" r="12" fill="${COLOR.youtube}"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>`
    : `<svg class="mksoc-ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="${esc(k)}"><circle cx="12" cy="12" r="12" fill="${COLOR[k]}"/><g fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPH[k] || ''}</g></svg>`);

  async function api(method, query, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) throw new Error('admin key needed');
    const r = await fetch(`${API}${query || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /* ---------- formatting ---------- */

  function pctText(p) {
    if (p == null) return '';
    const a = Math.abs(p);
    if (a < 0.05) return '0%';
    return `${a < 10 ? a.toFixed(1) : Math.round(a)}%`;
  }
  function arrow(d) {
    if (d.dir === 'up' || (d.dir === 'flat' && d.abs > 0)) return '▲';
    if (d.dir === 'down' || (d.dir === 'flat' && d.abs < 0)) return '▼';
    return '±';
  }
  function deltaHtml(d, pctOnly, suffix) {
    if (!d) return '';
    const cls = { up: 'up', down: 'dn', flat: 'fl' }[d.dir];
    const body = pctOnly || d.abs == null ? pctText(d.pct) : `${fmt(Math.abs(d.abs))}${d.pct == null ? '' : ` (${pctText(d.pct)})`}`;
    return `<span class="mksoc-d ${cls}">${arrow(d)}${pctOnly ? '' : ' '}${body}${suffix ? ` ${esc(suffix)}` : ''}</span>`;
  }
  function valueText(r) {
    if (r.text != null) return esc(r.text);
    if (r.value == null) return '—';
    if (r.unit === 'pct1') return `${Number(r.value).toFixed(1)}%`;
    return r.unit === 'hrs' ? `${fmt(r.value)} hrs` : fmt(r.value);
  }
  const rowHtml = (r) => `<div class="mksoc-r${r.wide ? ' wide' : ''}"${r.title ? ` title="${esc(r.title)}"` : ''}><span>${esc(r.label)}</span><b>${valueText(r)}${r.delta ? ` ${deltaHtml(r.delta, true)}` : ''}${r.note ? ` <i>${esc(r.note)}</i>` : ''}</b></div>`;
  const BADGE = { above: ['bg', 'above avg'], average: ['bn', 'average'], below: ['ba', 'below avg'] };
  const vsTitle = (vs) => `${vs.pct > 0 ? '+' : ''}${vs.pct}% vs this channel's 28-day average (${fmt(vs.avg)} over ${vs.n} posts${vs.basis ? `, ${vs.basis}` : ''})`;
  const badge = (vs) => (vs ? `<span class="mksoc-b ${BADGE[vs.badge][0]}" title="${esc(vsTitle(vs))}">${BADGE[vs.badge][1]}</span>` : '');
  function latestHtml(t) {
    const l = t.latest;
    if (!l) return '';
    const title = l.permalink ? `<a href="${esc(l.permalink)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title);
    return `<div class="mksoc-last"><div class="h">${esc(t.latest_label || 'Latest')} · ${day(l.date)}</div><div class="p">${title}</div>${esc(l.line)} ${badge(l.vs)}</div>`;
  }
  function sourceHtml(t) {
    const s = t.source;
    if (!s) return '';
    const prefix = s.tone === 'live' ? 'live · ' : '';
    return `<div class="mksoc-src ${esc(s.tone)}">${prefix}${esc(s.text)}${s.read_at ? ` · read ${stamp(s.read_at)}` : ''}</div>`;
  }
  function headlineHtml(t) {
    const h = t.headline;
    if (!h) return `<div class="mksoc-big mksoc-nc">${t.state === 'not_entered' ? 'Not entered' : 'Not connected'}</div>`;
    const delta = h.vs_label ? deltaHtml(h.delta, true, h.vs_label) : deltaHtml(h.delta, false);
    const since = !h.delta && h.since ? `<span class="mksoc-d fl">first read ${day(h.since)}: change shows after 28 days</span>` : '';
    return `<div class="mksoc-big">${fmt(h.value)} <small>${esc(h.unit)}</small></div><div>${delta || since}</div>`;
  }

  /* ---------- connection line + buttons (Facebook / Instagram tiles and Rules & data sources) ---------- */

  function connLine(c) {
    if (!c) return '';
    if (c.state === 'connected') return `<div class="mksoc-conn ok">Connected · Page ${esc(c.page_name || '—')} · ${c.ig_linked ? `IG @${esc(c.ig_username || '—')}` : 'no IG linked'} · since ${day(c.since)}</div>`;
    if (c.state === 'expired') return '<div class="mksoc-conn warn">Expired, reconnect</div>';
    if (c.state === 'error') return `<div class="mksoc-conn warn">Connection error (${esc(c.last_error || 'unknown')}), reconnect</div>`;
    return `<div class="mksoc-conn">Not connected${c.state === 'not_configured' ? ' · Meta app not set up yet' : ''}</div>`;
  }
  function connButtons(c) {
    if (!c) return '';
    const b = (act, label, cls = 'rf-btn-secondary') => `<button type="button" class="rf-btn ${cls}" data-mksoc="${act}">${label}</button>`;
    if (c.state === 'connected') return `<div class="mksoc-btns">${b('collect', 'Collect now')} ${b('disconnect', 'Disconnect')}</div>`;
    const off = c.state === 'not_configured' ? ' disabled title="Alan adds the Meta app ID, secret and token key in Vercel first"' : '';
    return `<div class="mksoc-btns"><button type="button" class="rf-btn" data-mksoc="connect"${off}>${c.state === 'expired' ? 'Reconnect' : 'Connect'} Facebook &amp; Instagram</button></div>`;
  }
  function tileExtras(t) {
    if (t.key === 'facebook' || t.key === 'instagram') return connLine(t.connection) + connButtons(t.connection);
    if (t.key === 'linkedin') return '<div class="mksoc-btns"><button type="button" class="rf-btn rf-btn-secondary" data-mksoc="linkedin">Enter this week</button></div>';
    return '';
  }
  function tileHtml(t) {
    const rows = (t.rows || []).map(rowHtml).join('');
    const needs = t.needs ? `<div class="mksoc-needs">${esc(t.needs)}</div>` : '';
    return `<div class="mksoc-t st-${esc(t.state)}" style="--c:${COLOR[t.key]}" data-mksoc-tile="${esc(t.key)}"><h4>${icon(t.key)}${esc(t.name)}</h4>${headlineHtml(t)}`
      + `${rows ? `<div class="mksoc-rows">${rows}</div>` : ''}${needs}${latestHtml(t)}${sourceHtml(t)}${tileExtras(t)}</div>`;
  }

  /* ---------- recent posts table (sortable, same table style as the tab) ---------- */

  const SORTERS = {
    posted_at: (p) => p.posted_at || '', channel: (p) => p.channel, title: (p) => (p.title || '').toLowerCase(), reach: (p) => p.reach ?? -1,
    likes: (p) => p.likes ?? -1, comments: (p) => p.comments ?? -1, shares: (p) => p.shares ?? -1, vs: (p) => p.vs?.pct ?? -1e9
  };
  const COLS = [['posted_at', 'Date', 'left'], ['channel', 'Channel', 'left'], ['title', 'Post', 'left'], ['reach', 'Reach / impr.'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares / saves'], [null, 'Website visits'], ['vs', 'vs channel avg']];
  function vsCell(vs) {
    if (!vs) return '<span class="mksoc-muted" title="Fewer than 2 posts from this channel in the 28 days up to this one">—</span>';
    const cls = { above: 'bg', average: 'bn', below: 'ba' }[vs.badge];
    return `<span class="mksoc-b ${cls}" title="${esc(vsTitle(vs))}">${vs.badge === 'average' ? '±' : (vs.pct > 0 ? '▲' : '▼')} ${Math.abs(vs.pct)}%</span>`;
  }
  function postRow(p) {
    const title = p.permalink ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.title || '(no text)')}</a>` : esc(p.title || '(no text)');
    const reach = p.reach == null ? '—' : `${fmt(p.reach)}${p.reach_label === 'views' ? ' views' : ''}`;
    return `<tr><td class="left">${day(p.posted_at)}</td><td class="left">${icon(p.channel, 16)}</td><td class="left mksoc-post">${title}${p.source === 'manual' ? ' <span class="mksoc-muted">manual</span>' : ''}</td>`
      + `<td>${reach}</td><td>${fmt(p.likes)}</td><td>${fmt(p.comments)}</td><td>${fmt(p.shares)}</td><td title="GA4 can't tie a visit to one post unless its link carries utm_content"><span class="mksoc-muted">—</span></td><td>${vsCell(p.vs)}</td></tr>`;
  }
  function postsTable(posts) {
    const s = state.sort;
    const sorted = [...posts].sort((a, b) => { const x = SORTERS[s.key](a); const y = SORTERS[s.key](b); return (x > y ? 1 : (x < y ? -1 : 0)) * s.dir; });
    const head = COLS.map(([k, label, cls]) => `<th class="${cls || ''}${k ? ' mksoc-sort' : ''}"${k ? ` data-mksoc-sort="${k}"` : ''}>${esc(label)}${k === s.key ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = sorted.map(postRow).join('') || '<tr><td class="left rt-sub" colspan="9">No posts collected yet.</td></tr>';
    return `<table class="rt-table mksoc-table" id="mksoc-posts"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  const postsHtml = (posts) => `<h3 class="mksoc-h3">Recent posts across channels</h3><p class="rt-sub">Last ${posts.length} posts · response compared with that channel's own 28-day average, so channels aren't compared with each other. Click a heading to sort.</p>`
    + `<div class="mk-wide" id="mksoc-posts-wrap">${postsTable(posts)}</div>`;

  /* ---------- paint ---------- */

  const NOTE = {
    ok: 'Connected. Running the first collection…', declined: 'Meta login was cancelled: nothing was connected.', state_invalid: 'The connect link had expired or was already used: press Connect again.',
    no_pages: 'Meta listed no Facebook Page for this login. If the Page sits in a Business portfolio, try again with business access.', extra_permissions: 'The login granted more than read-only access, so it was not stored. Remove extra permissions from the Meta app configuration and connect again.',
    not_configured: 'The Meta app details are not in Vercel yet.', meta_error: 'Meta returned an error while connecting: try again.', no_code: 'Meta did not return an authorisation code: try again.'
  };
  function noteHtml() {
    if (!state.note) return '';
    const retry = state.note === 'no_pages' ? ' <button type="button" class="rf-btn rf-btn-secondary" data-mksoc="connect-business">Try again with business access</button>' : '';
    return `<div class="mk-note${state.note === 'ok' ? '' : ' bad'}">${esc(NOTE[state.note] || `Connect failed (${state.note}).`)}${retry}</div>`;
  }
  function paint(host) {
    const d = state.data;
    const win = d.ga4_window ? ` · GA4 visits ${day(d.ga4_window.start)} – ${day(d.ga4_window.end)}` : '';
    host.innerHTML = `${styleTag()}<h3>Social channels</h3><p class="rt-sub">Last 28 days vs the 28 days before · each tile: audience, reach, response, the latest post and visits to the website${win}</p>${noteHtml()}`
      + `<div class="mksoc-g">${d.channels.map(tileHtml).join('')}</div>${postsHtml(d.posts || [])}`;
    paintRules();
  }
  function paintRules() {
    const box = document.getElementById('mk-social-rules');
    if (!box || !state.data) return;
    const c = state.data.connection;
    box.innerHTML = `<h3>Social connections</h3><p class="rt-sub">Facebook Page + linked Instagram business account through Meta login (read-only: ${esc('pages_show_list, pages_read_engagement, read_insights, instagram_basic, instagram_manage_insights')}; business_management only if the Page sits in a Business portfolio). The Page token is stored encrypted on the server and never shown. Collected nightly (08:05 UTC, with the other channel collectors) and with "Collect now"; a failed read never overwrites good figures. Disconnect deletes the stored token only. LinkedIn has no analytics API for personal profiles: weekly manual entry (amber after 10 days).</p>`
      + `${connLine(c)}${connButtons(c)}${c.last_collected_at ? `<p class="rt-sub">Last collection ${stamp(c.last_collected_at)}${c.last_error ? ` · last error ${esc(c.last_error)}` : ''}</p>` : ''}<div class="mksoc-btns"><button type="button" class="rf-btn rf-btn-secondary" data-mksoc="linkedin">LinkedIn: enter this week</button></div>`;
  }
  async function load(host, force) {
    if (!force && state.data && Date.now() - state.at < 120000) return paint(host);
    host.innerHTML = '<div class="rt-loading">Loading social channels…</div>';
    try {
      state.data = await api('GET', '?action=summary');
      state.at = Date.now();
      paint(host);
    } catch (e) {
      host.innerHTML = `<h3>Social channels</h3><div class="rt-error">${esc(e.message)}</div>`;
    }
  }
  const reload = () => { const host = document.getElementById('mk-social'); if (host) load(host, true); };

  /* ---------- progress window (collector) ---------- */

  function modal(html) {
    let m = document.getElementById('mksoc-modal');
    if (!m) { m = document.createElement('div'); m.id = 'mksoc-modal'; document.body.appendChild(m); }
    m.innerHTML = `<div class="box">${html}</div>`;
    return m;
  }
  const closeBtn = '<button type="button" class="rf-btn" data-mksoc="close">Close</button>';
  function progressHtml(steps, i, t0, stepT0, done) {
    const pct = Math.round((i / steps.length) * 100);
    const eta = i ? Math.round((((Date.now() - t0) / i) * (steps.length - i)) / 1000) : null;
    const quiet = (Date.now() - stepT0) / 1000;
    const alive = quiet < 45 ? 'alive' : `<b>stalled</b> — no reply for ${Math.round(quiet)} s`;
    return `<h4>Collecting Facebook &amp; Instagram…</h4><div class="mk-prog"><div style="width:${pct}%"></div></div><p class="rt-sub">${pct}% · step ${i + 1} of ${steps.length}: ${esc(steps[i].label)} · ${Math.round((Date.now() - t0) / 1000)} s${eta != null ? ` · about ${eta} s left` : ''} · ${alive}</p>${done}`;
  }
  const resultLine = (s, r) => `<div class="rt-sub">${r.ok ? '✓' : '✗'} ${esc(s.label)}: ${r.skipped ? esc(r.skipped.replace('_', ' ')) : (r.ok ? `${fmt(r.rows)} rows` : esc(r.error || 'failed'))}</div>`;
  async function collectNow() {
    const { steps } = await api('GET', '?action=steps');
    const t0 = Date.now();
    let done = '';
    let ok = true;
    for (let i = 0; i < steps.length && ok; i += 1) {
      const stepT0 = Date.now();
      const tick = setInterval(() => modal(progressHtml(steps, i, t0, stepT0, done)), 1000);
      modal(progressHtml(steps, i, t0, stepT0, done));
      const r = await api('POST', '', { action: 'collect', step: steps[i].id }).catch((e) => ({ ok: false, error: e.message }));
      clearInterval(tick);
      done += resultLine(steps[i], r);
      ok = r.ok && !r.skipped;
    }
    modal(`<h4>Collection: <span class="rt-pill ${ok ? 'ok' : 'bad'}">${ok ? 'SUCCESS' : 'FAILED'}</span></h4>${done}<p class="rt-sub">${Math.round((Date.now() - t0) / 1000)} s · figures saved are upserts only; nothing was posted.</p>${closeBtn}`);
    state.note = '';
    reload();
  }

  /* ---------- LinkedIn manual weekly entry ---------- */

  const lastSunday = () => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0, 10); };
  const numIn = (k, label) => `<label class="mksoc-f">${label}<input type="number" min="0" step="1" data-li="${k}"></label>`;
  const postIn = () => '<div class="mksoc-lipost"><input type="date" data-lp="posted_on"><input type="text" placeholder="Post title / first line" data-lp="title"><input type="number" min="0" placeholder="Impr." data-lp="impressions"><input type="number" min="0" placeholder="Reactions" data-lp="reactions"><input type="number" min="0" placeholder="Comments" data-lp="comments"><input type="number" min="0" placeholder="Reposts" data-lp="reposts"></div>';
  function linkedinForm() {
    modal(`<h4>LinkedIn: this week's figures</h4><p class="rt-sub">From LinkedIn → your profile → Analytics. Saves one row for the week (source: manual) plus one per post you add; re-entering a week corrects it.</p>`
      + `<label class="mksoc-f">Week ending<input type="date" data-li="week_ending" value="${lastSunday()}"></label>${numIn('followers', 'Followers')}${numIn('impressions_7d', 'Impressions (7 days)')}${numIn('reactions', 'Reactions')}${numIn('comments', 'Comments')}${numIn('reposts', 'Reposts')}`
      + `<h4>Posts this week (optional)</h4><div id="mksoc-liposts">${postIn()}</div><button type="button" class="rf-btn rf-btn-secondary" data-mksoc="li-addpost">+ post</button>`
      + '<p id="mksoc-li-out" class="rt-sub"></p><button type="button" class="rf-btn" data-mksoc="li-save">Save</button> <button type="button" class="rf-btn rf-btn-secondary" data-mksoc="close">Cancel</button>');
  }
  function linkedinBody() {
    const m = document.getElementById('mksoc-modal');
    const body = { action: 'linkedin-entry' };
    m.querySelectorAll('[data-li]').forEach((el) => { body[el.dataset.li] = el.value === '' ? null : el.value; });
    body.posts = [...m.querySelectorAll('.mksoc-lipost')].map((row) => Object.fromEntries([...row.querySelectorAll('[data-lp]')].map((el) => [el.dataset.lp, el.value === '' ? null : el.value]))).filter((p) => p.title || p.posted_on);
    return body;
  }
  async function linkedinSave() {
    const out = document.getElementById('mksoc-li-out');
    out.textContent = 'Saving…';
    const r = await api('POST', '', linkedinBody()).catch((e) => ({ ok: false, error: e.message }));
    if (!r.ok) { out.innerHTML = `<span class="mk-chip warn">${esc(r.error)}</span>`; return; }
    modal(`<h4>LinkedIn week ending ${esc(r.week_ending)} saved</h4><p class="rt-sub">${fmt(r.daily_rows)} week row · ${fmt(r.post_rows)} post rows (source: manual).</p>${closeBtn}`);
    reload();
  }

  /* ---------- actions ---------- */

  async function connect(withBusiness) {
    const r = await api('POST', '', { action: 'connect-start', with_business: !!withBusiness });
    if (r.ok && r.url) { window.location.href = r.url; return; }
    state.note = r.error || 'not_configured';
    reload();
  }
  async function disconnect() {
    if (!window.confirm('Disconnect Facebook & Instagram?\n\nThis deletes the stored Meta token only. Figures already collected stay. Nothing is posted or changed on Facebook or Instagram.')) return;
    await api('POST', '', { action: 'disconnect' });
    state.note = '';
    reload();
  }
  const ACT = {
    connect: () => connect(false), 'connect-business': () => connect(true), disconnect, collect: collectNow, linkedin: linkedinForm,
    'li-addpost': () => document.getElementById('mksoc-liposts')?.insertAdjacentHTML('beforeend', postIn()), 'li-save': linkedinSave,
    close: () => document.getElementById('mksoc-modal')?.remove()
  };
  document.addEventListener('click', (e) => {
    const sortTh = e.target.closest?.('[data-mksoc-sort]');
    if (sortTh && state.data) {
      const k = sortTh.dataset.mksocSort;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 };
      const wrap = document.getElementById('mksoc-posts-wrap');
      if (wrap) wrap.innerHTML = postsTable(state.data.posts || []);
      return;
    }
    const btn = e.target.closest?.('[data-mksoc]');
    if (!btn || !ACT[btn.dataset.mksoc]) return;
    Promise.resolve(ACT[btn.dataset.mksoc]()).catch((err) => modal(`<h4>Not done</h4><p class="rt-sub">${esc(err.message)}</p>${closeBtn}`));
  });

  /* ---------- self-mount + return from Meta login ---------- */

  function readReturn() {
    const q = new URLSearchParams(window.location.search);
    const v = q.get('social_connect');
    if (!v) return null;
    q.delete('social_connect');
    const reason = q.get('reason');
    q.delete('reason');
    window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}${window.location.hash}`);
    return v === 'ok' ? 'ok' : (reason || 'meta_error');
  }
  let pendingReturn = readReturn();
  function mount() {
    const tiles = document.getElementById('mk-overview-tiles');
    if (tiles && !document.getElementById('mk-social')) {
      tiles.insertAdjacentHTML('afterend', '<div class="rt-section" id="mk-social"></div>');
      if (pendingReturn) { state.note = pendingReturn; state.data = null; }
      const first = pendingReturn === 'ok';
      pendingReturn = null;
      load(document.getElementById('mk-social'), first).then(() => (first ? collectNow().catch(() => {}) : null));
    }
    const rules = document.getElementById('mk-fold-rules-body');
    if (rules && !document.getElementById('mk-social-rules')) {
      rules.insertAdjacentHTML('afterbegin', '<div class="rt-section" id="mk-social-rules"></div>');
      paintRules();
    }
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; mount(); }, 60); };
  function start() {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  function styleTag() {
    return `<style>
    #mk-social .mksoc-g { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    @media (max-width: 1200px) { #mk-social .mksoc-g { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    #mk-social .mksoc-t { background: #151c2b; border: 1px solid #263045; border-top: 3px solid var(--c); border-radius: 10px; padding: 12px 13px; font-size: 13px; color: #d6dbe4; display: flex; flex-direction: column; }
    #mk-social .mksoc-t h4 { margin: 0 0 8px; color: #fff; font-size: 15px; display: flex; align-items: center; gap: 6px; }
    #mk-social .mksoc-big { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.1; } #mk-social .mksoc-big small { font-size: 12px; font-weight: 400; color: #8b93a3; }
    #mk-social .mksoc-nc { font-size: 17px; color: #8b93a3; }
    .mksoc-d { font-size: 12px; font-weight: 700; } .mksoc-d.up { color: #5fd38d; } .mksoc-d.dn { color: #ff6b6b; } .mksoc-d.fl { color: #9aa3b2; }
    #mk-social .mksoc-rows { margin-top: 8px; border-top: 1px solid #263045; padding-top: 6px; }
    #mk-social .mksoc-r { display: flex; justify-content: space-between; gap: 6px; padding: 3px 0; font-size: 12.5px; } #mk-social .mksoc-r span { color: #8b93a3; } #mk-social .mksoc-r b { color: #fff; text-align: right; }
    #mk-social .mksoc-r i { color: #8b93a3; font-weight: 400; font-style: normal; font-size: 11px; }
    #mk-social .mksoc-r.wide { flex-direction: column; gap: 1px; } #mk-social .mksoc-r.wide b { text-align: left; font-weight: 600; }
    #mksoc-posts td:first-child { white-space: nowrap; }
    #mk-social .mksoc-last { margin-top: 8px; background: #10151f; border: 1px solid #263045; border-radius: 7px; padding: 7px 8px; font-size: 12px; }
    #mk-social .mksoc-last .h { color: #8b93a3; font-size: 11px; margin-bottom: 2px; } #mk-social .mksoc-last .p, #mk-social .mksoc-last .p a { color: #fff; font-weight: 700; text-decoration: none; }
    .mksoc-b { display: inline-block; font-size: 10.5px; font-weight: 700; border-radius: 4px; padding: 1px 6px; margin-left: 4px; white-space: nowrap; }
    .mksoc-b.bg { background: #11251a; color: #5fd38d; } .mksoc-b.ba { background: #2a2108; color: #f0b429; } .mksoc-b.bn { background: #1d2333; color: #9aa3b2; }
    #mk-social .mksoc-src { color: #6b7385; font-size: 10.5px; margin-top: 7px; } #mk-social .mksoc-src.live { color: #5fd38d; } #mk-social .mksoc-src.warn { color: #f0b429; font-weight: 700; }
    #mk-social .mksoc-needs { margin-top: 8px; color: #f0b429; font-size: 12px; line-height: 1.4; }
    .mksoc-conn { margin-top: 7px; font-size: 11.5px; color: #8b93a3; } .mksoc-conn.ok { color: #5fd38d; } .mksoc-conn.warn { color: #f0b429; font-weight: 700; }
    .mksoc-btns { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; } .mksoc-btns .rf-btn { font-size: 12px; padding: 4px 10px; }
    #mk-social .st-manual_stale .mksoc-src, #mk-social .st-stale .mksoc-src { color: #f0b429; font-weight: 700; }
    .mksoc-h3 { margin-top: 1.1rem !important; } .mksoc-sort { cursor: pointer; user-select: none; } .mksoc-muted { color: #6b7385; font-size: 11px; }
    #mksoc-posts td.mksoc-post a { color: #fff; font-weight: 700; text-decoration: none; } #mksoc-posts td.mksoc-post { color: #fff; font-weight: 700; } #mksoc-posts .mksoc-ic { vertical-align: -4px; }
    #mksoc-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9998; display: flex; align-items: center; justify-content: center; }
    #mksoc-modal .box { width: 34rem; max-height: 85vh; overflow: auto; background: #0b1118; border: 1px solid #334155; border-radius: 10px; padding: 1rem 1.2rem; color: #e5e7eb; }
    #mksoc-modal .mk-prog { height: 8px; background: #1f2937; border-radius: 4px; overflow: hidden; margin: 0.4rem 0; } #mksoc-modal .mk-prog div { height: 100%; background: var(--dark-brand, #f0a500); }
    .mksoc-f { display: inline-flex; flex-direction: column; font-size: 12px; color: #9aa3b2; margin: 0 8px 8px 0; } .mksoc-f input { width: 9rem; }
    #mksoc-modal .box:has(.mksoc-lipost) { width: 44rem; }
    .mksoc-lipost { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; } .mksoc-lipost input { width: 5.5rem; } .mksoc-lipost input[data-lp="title"] { width: 11rem; } .mksoc-lipost input[type="date"] { width: 8.5rem; }
    #mksoc-modal .rt-sub { color: #94a3b8; font-size: 0.85rem; margin: 0.2rem 0 0.5rem; line-height: 1.45; } #mksoc-modal h4 { margin: 0.4rem 0; }
    #mksoc-modal .rt-pill.ok { background: #14532d; color: #bbf7d0; } #mksoc-modal .rt-pill.bad { background: #7f1d1d; color: #fecaca; }
  </style>`;
  }
})();
