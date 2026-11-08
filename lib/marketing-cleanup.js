/**
 * Marketing & Campaigns → Contact clean-up (Stage C, review only). Steps: choose who and the action → review (exact
 * counts, protected records worked out on the server) → freeze a manifest → approve (typed) → execute (dry run, TEST
 * records only) → verify. Nothing is deleted, unsubscribed or archived by this build.
 */
(function () {
  const API = '/api/aigeo/marketing';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const REASON = { relationship_hold: 'relationship hold', owner: 'owner / test address (Alan)', buyer: 'has bought', booking: 'has a booking', academy_member: 'Academy member / trial running', active_plan: 'active Pick n Mix plan', organisation: 'organisation / system record', unknown_history: 'history incomplete or probable match' };
  const S = { host: null, review: null, manifest: null, actions: {} };

  async function api(method, qs, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`${API}${qs || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const choice = () => ({ mode: S.host.querySelector('#mc-mode').value, cleanup_action: S.host.querySelector('#mc-action').value, query: S.host.querySelector('#mc-mode').value === 'test' ? null : window.mkCurrentQuery?.() });
  const out = (html) => { S.host.querySelector('#mc-out').innerHTML = html; };
  const err = (e) => out(`<div class="rt-error">${esc(e.message)}</div>`);

  function stepsBar(active) {
    const steps = ['1 Choose', '2 Review', '3 Freeze manifest', '4 Approve', '5 Execute (dry run)', '6 Verify'];
    return `<div class="mc-steps">${steps.map((s, i) => `<span class="mc-step ${i + 1 === active ? 'on' : ''} ${i + 1 < active ? 'done' : ''}">${esc(s)}</span>`).join('')}</div>`;
  }
  function reviewHtml(r) {
    const prot = Object.entries(r.counts.protected_by_reason || {}).map(([k, v]) => `${n(v)} ${esc(REASON[k] || k)}`).join(' · ') || 'none';
    const B = window.mkBadge;
    const head = (why) => `<thead><tr><th class="left">Name</th><th class="left">Email</th>${B ? B.head() : ''}${why ? '<th class="left">Protected because</th>' : ''}</tr></thead>`;
    const rows = (list, why) => list.map((x) => `<tr><td class="left">${esc(x.name || '—')}</td><td class="left">${esc(x.email || '—')}</td>${B ? B.cells(x.badges) : ''}${why ? `<td class="left">${esc(REASON[x.protected_reason] || x.protected_reason)}</td>` : ''}</tr>`).join('');
    return `${stepsBar(2)}<p><b>${esc(r.action_label)}</b> · ${esc(r.mode === 'test' ? 'TEST: Alan\'s own @alanranger.com records only' : r.english)} · ${B ? B.watermark(r.health) : ''}</p>`
      + `<p><b>${n(r.counts.matched)}</b> match · <b>${n(r.counts.eligible)}</b> eligible for the action · <b>${n(r.counts.protected)}</b> protected (${prot}) · ${n(r.counts.undecided)} undecided (not included)</p>`
      + `<details><summary class="rt-sub">First eligible records (${n(Math.min(50, r.counts.eligible))} of ${n(r.counts.eligible)})</summary><div class="mk-wide"><table class="rt-table">${head(false)}<tbody>${rows(r.eligible_sample) || '<tr><td class="rt-sub">None.</td></tr>'}</tbody></table></div></details>`
      + `<details><summary class="rt-sub">Protected (kept out by the server)</summary><div class="mk-wide"><table class="rt-table">${head(true)}<tbody>${rows(r.protected_sample, true) || '<tr><td class="rt-sub">None.</td></tr>'}</tbody></table></div></details>`
      + `<p><button type="button" class="rf-btn" data-mc="freeze">Freeze this as a manifest</button> <span class="rt-sub">Freezing re-reads everyone and stores the exact eligible set; new or changed records later need a new review.</span></p>`;
  }
  function manifestHtml(m) {
    const c = m.counts || {};
    const approve = m.status === 'frozen' ? `<p>Approve: type <code>APPROVE ${n(c.eligible).replace(/,/g, '')}</code> <input id="mc-confirm" type="text" style="width:10rem"> <button type="button" class="rf-btn" data-mc="approve">Approve manifest</button></p>` : '';
    const exec = m.status === 'approved' ? `<p><button type="button" class="rf-btn" data-mc="execute">Execute (dry run)</button> <span class="rt-sub">${m.mode === 'test' ? 'Re-checks every record and records what would happen. Nothing changes.' : 'Refused for real records in this build: Alan approves an exact manifest in a later question first.'}</span></p>` : '';
    const verify = ['executed_dry_run', 'verified'].includes(m.status) ? '<p><button type="button" class="rf-btn" data-mc="verify">Verify</button></p>' : '';
    return `${stepsBar({ frozen: 4, approved: 5, executed_dry_run: 6, verified: 6 }[m.status] || 3)}<p>Manifest <code>${esc(String(m.manifest_id).slice(0, 8))}</code> · ${esc(m.status)} · ${n(c.eligible)} eligible · ${n(c.protected)} protected</p>${approve}${exec}${verify}`;
  }
  function ledgerHtml(list) {
    const rows = list.map((m) => `<tr><td>${stamp(m.created_at)}</td><td>${esc(m.mode)}</td><td class="left">${esc(S.actions[m.action] || m.action)}<div class="rt-sub">${esc(m.query_english || '')}</div></td><td>${n(m.counts?.eligible)} / ${n(m.counts?.protected)}</td><td>${esc(m.status)}</td><td class="left rt-sub">${esc(m.approval_text || '')}${m.verify_result ? `<br>verified ${stamp(m.verified_at)}: ${esc(JSON.stringify(m.verify_result.outcomes))}, protected still protected ${n(m.verify_result.protected_still_protected)} of ${n(m.verify_result.protected)}, changed anything: no` : ''}</td><td><button type="button" class="rf-btn rf-btn-secondary" data-mc-open="${esc(m.manifest_id)}">Open</button></td></tr>`).join('');
    return `<h4>Manifests &amp; ledger</h4><div class="mk-wide"><table class="rt-table" id="mc-ledger"><thead><tr><th>Made</th><th>Mode</th><th class="left">Action</th><th>Eligible / protected</th><th>Status</th><th class="left">Approval · verification</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="rt-sub">None yet.</td></tr>'}</tbody></table></div>`;
  }

  async function loadLedger() {
    const j = await api('GET', '?action=cleanup-list');
    S.actions = j.actions;
    S.list = j.manifests;
    S.host.querySelector('#mc-ledger-box').innerHTML = ledgerHtml(j.manifests);
  }
  const RUN = {
    review: async () => { out('<div class="rt-loading">Reviewing…</div>'); S.review = await api('POST', '', { action: 'cleanup-review', ...choice() }); out(reviewHtml(S.review)); },
    freeze: async () => { const r = await api('POST', '', { action: 'cleanup-freeze', ...choice() }); S.manifest = { manifest_id: r.manifest_id, status: 'frozen', counts: r.counts, mode: choice().mode }; out(manifestHtml(S.manifest)); await loadLedger(); },
    approve: async () => {
      try { await api('POST', '', { action: 'cleanup-approve', manifest_id: S.manifest.manifest_id, confirm: S.host.querySelector('#mc-confirm').value }); } catch (e) { out(`${manifestHtml(S.manifest)}<div class="rt-error">${esc(e.message)}</div>`); return; }
      S.manifest.status = 'approved'; out(manifestHtml(S.manifest)); await loadLedger();
    },
    execute: async () => { const r = await api('POST', '', { action: 'cleanup-execute', manifest_id: S.manifest.manifest_id }); S.manifest.status = 'executed_dry_run'; out(`${manifestHtml(S.manifest)}<p class="rt-sub">${n(r.processed)} records re-checked (${esc(r.note)}).</p>`); await loadLedger(); },
    verify: async () => { const r = await api('POST', '', { action: 'cleanup-verify', manifest_id: S.manifest.manifest_id }); S.manifest.status = 'verified'; out(`${manifestHtml(S.manifest)}<p>Verified: ${esc(JSON.stringify(r.outcomes))} · protected still protected ${n(r.protected_still_protected)} of ${n(r.protected)} · subscribed now ${n(r.subscribed_now)} · nothing changed.</p>`); await loadLedger(); }
  };
  function onClick(e) {
    const act = e.target.closest('[data-mc]')?.dataset.mc;
    if (act) return RUN[act]().catch(err);
    const open = e.target.closest('[data-mc-open]')?.dataset.mcOpen;
    if (open) { S.manifest = S.list.find((m) => m.manifest_id === open); out(manifestHtml(S.manifest)); }
    return null;
  }

  window.mkMountCleanup = async function mkMountCleanup(host) {
    S.host = host;
    host.innerHTML = '<h3>Contact clean-up (review only)</h3><p class="rt-sub">Separate from marketing segments. Choose who (the current Customers filter, or TEST = your own @alanranger.com records) and one action. Relationship holds, your own (owner / test) addresses, buyers, bookings, Academy members, active plans, organisations and anyone with incomplete or probable history are protected on the server and never in the eligible set. Approval binds the exact records, action and query version. In this build "execute" is a dry run: nothing is deleted, unsubscribed or archived.</p>'
      + `${stepsBar(1)}<div class="mk-params"><label class="st-ov-f mk-f">Who<select id="mc-mode"><option value="review">The current Customers filter</option><option value="test">TEST: my own @alanranger.com records</option></select></label>`
      + '<label class="st-ov-f mk-f">Action<select id="mc-action"></select></label><button type="button" class="rf-btn" data-mc="review">Review</button></div><div id="mc-out"></div><div id="mc-ledger-box"><div class="rt-loading">Loading manifests…</div></div>'
      + '<style>#mk-cleanup select,#mk-cleanup #mc-confirm{background:#0b1118;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:2px 4px;margin-left:4px}.mc-steps{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.mc-step{font-size:11px;border:1px solid #334155;border-radius:999px;padding:1px 8px;color:#94a3b8}.mc-step.on{border-color:#3b82f6;color:#e5e7eb}.mc-step.done{color:#4ade80;border-color:#14532d}</style>';
    host.addEventListener('click', onClick);
    try {
      await loadLedger();
      host.querySelector('#mc-action').innerHTML = Object.entries(S.actions).map(([k, l]) => `<option value="${k}" ${k === 'exclude_routine' ? 'selected' : ''}>${esc(l)}</option>`).join('');
    } catch (e) { host.querySelector('#mc-ledger-box').innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
  };
})();
