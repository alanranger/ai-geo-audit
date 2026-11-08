/**
 * Marketing & Campaigns → Client list health (8 Nov 2026, approved mock-up v2). Three separate questions per person —
 * when did they last buy (evidenced), do they respond to emails (recorded), can we email them (consent) — as four
 * cards, the purchase × consent matrix, the email-health bar and the versioned rules. Every number opens its exact
 * query in Customers (no "can be emailed" gate added). Counts only come from /api/aigeo/marketing?action=client-health.
 * Exposes mkMountClientHealth(host), mkOpenClientHealth() and mkClientHealthSummary() (tile 9).
 */
(function () {
  const API = '/api/aigeo/marketing';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const gbp = (v) => (Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(1)}k` : `£${Math.round(v).toLocaleString('en-GB')}`);
  const ukDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const S = { data: null, loading: null, nums: [], host: null };

  async function fetchHealth() {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`${API}?action=client-health`, { headers: { 'x-arp-admin-key': key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function load(force) {
    if (S.data && !force) return Promise.resolve(S.data);
    if (!S.loading) S.loading = fetchHealth().then((d) => { S.data = d; return d; }).finally(() => { S.loading = null; });
    return S.loading;
  }

  /** A clickable number: opens its exact query in Customers. */
  function num(o, text) {
    if (!o) return '—';
    S.nums.push(o);
    return `<button type="button" class="ch-num" data-ch-q="${S.nums.length - 1}" title="Open in Customers: ${esc(o.name)}">${text ?? n(o.n)}</button>`;
  }

  /* ---------- cards ---------- */

  function cardRecent(c) {
    return `<div class="ch-card amber"><div class="ch-ct">Recent buyers not email-eligible</div><div class="ch-big">${num(c.total)}</div>`
      + `<div class="ch-cs">bought in the last 12 months: ${num(c.not_subscribed)} not subscribed · ${num(c.blocked)} blocked · ${num(c.no_email)} no email held (source not recorded)${c.email_no_contact.n ? ` · ${num(c.email_no_contact)} email, no Squarespace contact` : ''} · ${num(c.booked_ahead)} have a booking coming up</div></div>`;
  }
  function cardLapsed(c) {
    return `<div class="ch-card green"><div class="ch-ct">Lapsed buyers with recorded engagement</div><div class="ch-big">${num(c.total)}</div>`
      + `<div class="ch-cs">last bought 2+ years ago, can be emailed, a recorded open or click in 90 days: <b>${num(c.click_supported)} click-supported</b> · ${num(c.open_only)} open-only</div></div>`;
  }
  function cardProspects(c, cov) {
    const from = [cov?.booking_sheet_from ? `Booking Sheet from ${cov.booking_sheet_from.slice(0, 4)}` : '', cov?.squarespace_from ? `Squarespace from ${cov.squarespace_from.slice(0, 4)}` : ''].filter(Boolean).join(', ');
    return `<div class="ch-card blue"><div class="ch-ct">Subscribers with no evidenced purchase</div><div class="ch-big">${num(c.total)}</div>`
      + `<div class="ch-cs">no purchase in covered history${from ? ` (${esc(from)})` : ''} · ${num(c.engaged)} engaged in 90 days · nurture, not waste · ${num(c.unknown_history)} more are "unknown"</div></div>`;
  }
  function cardUnknown(c) {
    return `<div class="ch-card amber"><div class="ch-ct">Purchase history unknown</div><div class="ch-big">${num(c.total)}</div>`
      + `<div class="ch-cs">no confirmed purchase but probable (name-match) or incomplete history · ${num(c.can_email)} can be emailed · never treated as "never bought"</div></div>`;
  }
  const cardsHtml = (d) => `<div class="ch-cards">${cardRecent(d.cards.recent_not_eligible)}${cardLapsed(d.cards.lapsed_engaged)}${cardProspects(d.cards.subscribers_no_purchase, d.coverage)}${cardUnknown(d.cards.purchase_unknown)}</div>`;

  /* ---------- matrix ---------- */

  const COL_SUB = { can_email: 'subscribed, not blocked', not_subscribed: 'Squarespace contact, opted out / never opted in', blocked: 'on suppression list', email_no_contact: '', no_email: '' };
  const ROW_SUB = { p_none: 'covered history only', p_unknown: 'probable-only or incomplete' };
  const ROW_LABEL = { p0_6: '0–6 months', p6_12: '6–12 months', p12_24: '12–24 months', p24_plus: '24+ months (lapsed)', p_none: 'No evidenced purchase', p_unknown: 'Unknown / insufficient history' };

  function cellHtml(c) {
    if (!c.highlight) return `<td>${num(c.people)}</td>`;
    const extra = [c.net.n ? num(c.net, gbp(c.net.n)) : '', c.booked_ahead.n ? `${num(c.booked_ahead)} booked ahead` : ''].filter(Boolean).join(' · ');
    return `<td class="hl">${num(c.people)}${extra ? `<div class="ch-sub">${extra}</div>` : ''}</td>`;
  }
  function rowHtml(r, cols) {
    const label = `<b>${esc(ROW_LABEL[r.band] || r.label)}</b>${ROW_SUB[r.band] ? `<div class="ch-sub">${ROW_SUB[r.band]}</div>` : ''}`;
    return `<tr><td class="left">${label}</td>${cols.map((c) => cellHtml(r.cells[c])).join('')}<td class="tot">${num(r.total.people)}<div class="ch-sub">${n(r.total.addresses)} addresses</div></td></tr>`;
  }
  function matrixHtml(m) {
    const cols = m.columns;
    const head = cols.map((c) => `<th>${esc(m.labels[c])}${COL_SUB[c] ? `<div class="ch-sub">${esc(COL_SUB[c])}</div>` : ''}</th>`).join('');
    const foot = cols.map((c) => `<td>${num(m.cols[c].people)}<div class="ch-sub">${n(m.cols[c].addresses)} addr.</div></td>`).join('');
    return `<div class="ch-mwrap"><table class="ch-matrix"><thead><tr><th class="left">Last evidenced purchase</th>${head}<th>Total</th></tr></thead><tbody>${m.rows.map((r) => rowHtml(r, cols)).join('')}</tbody>`
      + `<tfoot><tr><td class="left"><b>Total</b></td>${foot}<td class="tot">${num(m.total.people)}<div class="ch-sub">${n(m.total.addresses)} addresses</div></td></tr></tfoot></table></div>`;
  }
  function reconHtml(d) {
    const r = d.reconciliation;
    const a = d.apart;
    const ok = r.gap === 0 ? '<span class="ch-ok">✓ reconciles</span>' : `<span class="ch-warn">gap ${n(r.gap)} (${esc(JSON.stringify(r.tile9_by_record))})</span>`;
    const admin = a.admin ? ` Your own address is in ${esc(ROW_LABEL[a.admin.band])} × ${esc(d.matrix.labels[a.admin.consent])}.` : '';
    return `<p class="ch-note">Can email ${n(r.can_email_people + r.admin_address)} = ${n(r.can_email_people)} people + your own address; add ${n(r.organisations)} organisation client${r.organisations === 1 ? '' : 's'} = ${n(r.sum)} · tile 9 count ${n(r.tile9)} ${ok}.${admin} `
      + `Organisations (${num({ n: a.organisations.total, root: a.organisations.query, name: 'Organisations' })}) and ${n(a.system_labels)} system / ledger labels are counted apart. Totals reconcile to the people list.</p>`;
  }

  /* ---------- email health ---------- */

  const STATES = [
    ['hot', 'Hot', 'recorded click in last 30 days', '#4ade80'], ['warm_click', 'Warm, click-supported', '', '#86efac'], ['warm_open', 'Warm, open-only', 'open or click in 90 days', '#d1fae5'],
    ['cooling', 'Cooling', 'last known response 91–180 days ago', '#f59e0b'], ['cold', 'Cold', 'last known response over 180 days ago', '#94a3b8'],
    ['no_response', 'No recorded response', '', '#475569'], ['too_few', 'Too few emails', '', '#334155'], ['e_unknown', 'Unknown', 'no email, coverage incomplete or not emailed yet', '#1e293b']
  ];
  function emailHtml(e) {
    const total = Math.max(1, e.denominator.n);
    const bar = STATES.map(([k, , , col]) => { const v = e.states[k].n; return v ? `<span class="ch-seg" style="width:${(v / total) * 100}%;background:${col}" title="${esc(k)} ${n(v)}">${v / total > 0.04 ? n(v) : ''}</span>` : ''; }).join('');
    const sub = { no_response: `${e.rule.min_delivered}+ delivered in covered campaigns, no open or click`, too_few: `fewer than ${e.rule.min_delivered} delivered, no response` };
    const legend = STATES.map(([k, label, note, col]) => `<span class="ch-leg"><i style="background:${col}"></i>${esc(label)} ${num(e.states[k])}${note || sub[k] ? ` <span class="ch-sub">· ${esc(note || sub[k])}</span>` : ''}</span>`).join('');
    return `<h4>Email health of the ${num(e.denominator)} people you can email <span class="ch-sub">(states sum to ${n(e.sum)}${e.sums_exactly ? ' ✓' : ' — does not match'})</span></h4><div class="ch-bar">${bar}</div><div class="ch-legend">${legend}</div>`;
  }

  function footerHtml(d) {
    const cov = d.coverage || {};
    const emailCov = cov.engagement ? `email events ${cov.engagement.is_complete ? 'complete' : 'incomplete'} for ${n(cov.engagement.complete)} of ${n(cov.engagement.campaigns)} campaigns (last collected ${ukDate(cov.last_collected_campaign)})` : '';
    const v = d.versions || {};
    return `<div class="ch-rules"><p><b>Rules (versioned: purchase v${v.purchase_band}, email health v${v.email_health}, consent v${v.consent_state}).</b></p>${(d.rules || []).map((t) => `<p>${esc(t)}</p>`).join('')}`
      + `<p>Coverage: Booking Sheet from ${ukDate(cov.booking_sheet_from)}, Squarespace orders from ${ukDate(cov.squarespace_from)}; ${esc(emailCov)}. As of ${esc(d.as_of_day)} (Europe/London).</p><p><b>${esc(d.never)}</b></p></div>`;
  }

  const STYLE = `<style>
    #mk-client-health .ch-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; margin: 0.6rem 0; }
    .ch-card { border: 1px solid #1f2937; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 8px 10px; background: #111827; }
    .ch-card.amber { border-left-color: #f59e0b; } .ch-card.green { border-left-color: #22c55e; } .ch-card.blue { border-left-color: #3b82f6; }
    .ch-ct { font-weight: 700; color: #f8fafc; font-size: 13px; } .ch-big { font-size: 22px; font-weight: 700; margin: 2px 0; } .ch-big .ch-num { font-size: 22px; color: #f8fafc; }
    .ch-cs { font-size: 12px; color: #94a3b8; } .ch-sub { font-size: 11px; color: #94a3b8; font-weight: 400; }
    .ch-num { background: none; border: none; padding: 0; color: #93c5fd; text-decoration: underline dotted; cursor: pointer; font: inherit; }
    .ch-num:hover { color: #bfdbfe; } .ch-mwrap { overflow-x: auto; border: 1px solid #1f2937; border-radius: 8px; }
    .ch-matrix { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 720px; } .ch-matrix th, .ch-matrix td { padding: 6px 8px; border-bottom: 1px solid #1f2937; text-align: right; vertical-align: top; }
    .ch-matrix th { font-size: 11px; text-transform: uppercase; color: #cbd5e1; font-weight: 600; } .ch-matrix .left { text-align: left; }
    .ch-matrix td.hl { background: rgba(245,158,11,0.16); } .ch-matrix td.hl > .ch-num { color: #fbbf24; font-weight: 700; } .ch-matrix tfoot td { font-weight: 700; border-top: 2px solid #334155; }
    .ch-matrix td.tot { color: #e5e7eb; } .ch-note { font-size: 12px; color: #94a3b8; margin: 0.4rem 0; } .ch-ok { color: #4ade80; } .ch-warn { color: #fbbf24; }
    .ch-bar { display: flex; height: 22px; border-radius: 4px; overflow: hidden; border: 1px solid #334155; background: #0b1118; }
    .ch-seg { display: flex; align-items: center; justify-content: center; font-size: 11px; color: #0b1118; font-weight: 600; min-width: 2px; }
    .ch-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0; font-size: 12px; } .ch-leg i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; border: 1px solid #475569; }
    .ch-rules { font-size: 12px; color: #94a3b8; border-top: 1px solid #1f2937; margin-top: 0.6rem; padding-top: 0.4rem; } .ch-rules p { margin: 0.25rem 0; }
    .ch-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  </style>`;

  function render(d) {
    S.nums = [];
    const body = `${cardsHtml(d)}<h4>When they last bought × can we email them</h4><p class="ch-note">People, not addresses. Each person sits in one row and one column; columns follow this order: blocked first, then can email, then not subscribed, then no Squarespace contact. Click any number for the list (overlapping reasons are shown on each person).</p>${matrixHtml(d.matrix)}${reconHtml(d)}${emailHtml(d.email_health)}${footerHtml(d)}`;
    return `${STYLE}<div class="ch-head"><h3>Client list health</h3><span class="ch-sub">as of ${esc(new Date(d.as_of).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }))} · <button type="button" class="ch-num" data-ch-act="refresh">refresh</button></span></div>`
      + `<p class="ch-note">Three separate questions about each person: <b>when did they last buy (evidenced)</b>, <b>do they respond to emails (recorded)</b>, and <b>can we email them (consent)</b>. People only; organisations and system labels are counted apart (your own address is marked). A purchase, booking or membership never counts as permission to email.</p>${body}`;
  }

  async function paint(host, force) {
    host.innerHTML = '<div class="rt-loading">Loading client list health…</div>';
    try {
      host.innerHTML = render(await load(force));
    } catch (e) {
      host.innerHTML = `<h3>Client list health</h3><div class="rt-error">${esc(e.message)}</div>`;
    }
  }

  function onClick(e) {
    const q = e.target.closest('[data-ch-q]');
    if (q) {
      const o = S.nums[Number(q.dataset.chQ)];
      if (o && typeof window.mkOpenQuery === 'function') window.mkOpenQuery(o.root, o.name, { gate: false, preset: 'health' });
      return;
    }
    if (e.target.closest('[data-ch-act="refresh"]')) paint(S.host, true);
  }

  window.mkMountClientHealth = async function mkMountClientHealth(host) {
    S.host = host;
    if (!host.dataset.chMounted) { host.addEventListener('click', onClick); host.dataset.chMounted = '1'; }
    await paint(host, false);
  };

  /** Lazy-mount into #mk-client-health (created just before Customers, #mk-query), then scroll to it. */
  window.mkOpenClientHealth = async function mkOpenClientHealth() {
    let host = document.getElementById('mk-client-health');
    if (!host) {
      const query = document.getElementById('mk-query');
      if (!query) { console.warn('Client list health: open the Marketing tab first'); return null; }
      host = document.createElement('div');
      host.id = 'mk-client-health';
      host.className = 'rt-section';
      query.parentNode.insertBefore(host, query);
    }
    if (!host.dataset.chMounted) await window.mkMountClientHealth(host);
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return host;
  };

  /** Tile 9: recent buyers (12 months) not email-eligible, split, and the can-email count (shared fetch with the panel). */
  window.mkClientHealthSummary = () => load(false).then((d) => d.summary);
})();
