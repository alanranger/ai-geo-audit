/**
 * Marketing & Campaigns → Contact clean-up (Stage C). Steps: choose who and the action → review (exact counts,
 * protected records worked out on the server) → freeze a manifest → approve (typed, plus who approved) → execute →
 * verify. Execute is a dry run except for an approved "Unsubscribe in Squarespace" manifest carrying Alan's recorded
 * approval (checked on the server), which Alan's PC works through in batches. Nothing is ever deleted.
 */
(function () {
  const API = '/api/aigeo/marketing';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const REASON = { relationship_hold: 'relationship hold', owner: 'owner / test address (Alan)', buyer: 'has bought', booking: 'has a booking', academy_member: 'Academy member / trial running', active_plan: 'active Pick n Mix plan', organisation: 'organisation / system record', unknown_history: 'history incomplete or probable match', probable_buyer: 'probable purchase', squarespace_order: 'Squarespace order on record (incl. cancelled / refunded)', credit_held: 'credit held', opened_or_clicked: 'opened or clicked since', suppressed_now: 'suppressed since', profile_missing: 'Squarespace profile missing', already_unsubscribed: 'already unsubscribed', record_missing: 'record missing' };
  const COHORTS = { never_opened_4plus: 'Never opened or clicked, 4+ campaigns delivered (server cohort)' };
  const S = { host: null, review: null, manifest: null, actions: {} };

  async function api(method, qs, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    const r = await fetch(`${API}${qs || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function choice() {
    const who = S.host.querySelector('#mc-mode').value;
    const action = S.host.querySelector('#mc-action').value;
    if (who.startsWith('cohort:')) return { mode: 'review', cohort: who.slice(7), cleanup_action: action, query: null };
    return { mode: who, cleanup_action: action, query: who === 'test' ? null : window.mkCurrentQuery?.() };
  }
  const out = (html) => { S.host.querySelector('#mc-out').innerHTML = html; };
  const err = (e) => out(`<div class="rt-error">${esc(e.message)}</div>`);

  function stepsBar(active) {
    const steps = ['1 Choose', '2 Review', '3 Freeze manifest', '4 Approve', '5 Execute', '6 Verify'];
    return `<div class="mc-steps">${steps.map((s, i) => `<span class="mc-step ${i + 1 === active ? 'on' : ''} ${i + 1 < active ? 'done' : ''}">${esc(s)}</span>`).join('')}</div>`;
  }
  function reviewHtml(r) {
    const prot = Object.entries(r.counts.protected_by_reason || {}).map(([k, v]) => `${n(v)} ${esc(REASON[k] || k)}`).join(' · ') || 'none';
    const B = window.mkBadge;
    const head = (why) => `<thead><tr><th class="left">Name</th><th class="left">Email</th>${B ? B.head() : ''}${why ? '<th class="left">Protected because</th>' : ''}</tr></thead>`;
    const rows = (list, why) => list.map((x) => `<tr><td class="left">${esc(x.name || '—')}</td><td class="left">${esc(x.email || '—')}</td>${B ? B.cells(x.badges) : ''}${why ? `<td class="left">${esc(REASON[x.protected_reason] || x.protected_reason)}</td>` : ''}</tr>`).join('');
    return `${stepsBar(2)}<p><b>${esc(r.action_label)}</b> · ${esc(r.mode === 'test' ? 'TEST: Alan\'s own @alanranger.com records only' : r.english)} · ${B ? B.watermark(r.health) : ''}</p>`
      + `<p><b>${n(r.counts.matched)}</b> match · <b>${n(r.counts.eligible)}</b> eligible for the action · <b>${n(r.counts.protected)}</b> protected (${prot}) · ${n(r.counts.undecided)} undecided (not included)${r.counts.no_person_record ? ` · ${n(r.counts.no_person_record)} without a contact record (not included)` : ''}</p>`
      + `<details><summary class="rt-sub">First eligible records (${n(Math.min(50, r.counts.eligible))} of ${n(r.counts.eligible)})</summary><div class="mk-wide"><table class="rt-table">${head(false)}<tbody>${rows(r.eligible_sample) || '<tr><td class="rt-sub">None.</td></tr>'}</tbody></table></div></details>`
      + `<details><summary class="rt-sub">Protected (kept out by the server)</summary><div class="mk-wide"><table class="rt-table">${head(true)}<tbody>${rows(r.protected_sample, true) || '<tr><td class="rt-sub">None.</td></tr>'}</tbody></table></div></details>`
      + `<p><button type="button" class="rf-btn" data-mc="freeze">Freeze this as a manifest</button> <span class="rt-sub">Freezing re-reads everyone and stores the exact eligible set; new or changed records later need a new review.</span></p>`;
  }
  const EXEC_NOTE = {
    test: 'Dry run: re-checks every record and records what would happen. Nothing changes.',
    review: 'Real only for "Unsubscribe in Squarespace" with Alan\'s recorded approval (checked on the server; refused otherwise). Alan\'s PC then works through it in batches of 25, re-checking each person right before the opt-out.'
  };
  function manifestHtml(m) {
    const c = m.counts || {};
    const approve = m.status === 'frozen' ? `<p>Approve: type <code>APPROVE ${n(c.eligible).replace(/,/g, '')}</code> <input id="mc-confirm" type="text" style="width:10rem"> approved by <input id="mc-note" type="text" style="width:22rem" placeholder="who approved, when, which option"> <button type="button" class="rf-btn" data-mc="approve">Approve manifest</button></p>` : '';
    const exec = m.status === 'approved' ? `<p><button type="button" class="rf-btn" data-mc="execute">${m.mode === 'test' ? 'Execute (dry run)' : 'Execute (queue for Alan\'s PC)'}</button> <span class="rt-sub">${esc(EXEC_NOTE[m.mode] || EXEC_NOTE.review)}</span></p>` : '';
    const prog = ['executing', 'executed', 'verified'].includes(m.status) && m.mode !== 'test' ? '<p><button type="button" class="rf-btn rf-btn-secondary" data-mc="progress">Refresh progress</button></p>' : '';
    const verify = ['executed_dry_run', 'executed', 'verified'].includes(m.status) ? '<p><button type="button" class="rf-btn" data-mc="verify">Verify</button></p>' : '';
    const step = { frozen: 4, approved: 5, executing: 5, executed: 6, executed_dry_run: 6, verified: 6 }[m.status] || 3;
    return `${stepsBar(step)}<p>Manifest <code>${esc(String(m.manifest_id).slice(0, 8))}</code> · ${esc(m.status)} · ${n(c.eligible)} eligible · ${n(c.protected)} protected</p>${approve}${exec}${prog}${verify}<div id="mc-prog"></div>`;
  }
  const kv = (o) => Object.entries(o || {}).map(([k, v]) => `${esc(REASON[k] || k)} ${n(v)}`).join(' · ') || 'none';
  function progressHtml(p) {
    const b = p.before ? `Before: All Subscribers ${n(p.before.all_subscribers_sqs)} (Squarespace) · subscribed ${n(p.before.subscribed)} · can be emailed ${n(p.before.can_email)}` : 'Not started on Alan\'s PC yet.';
    return `<p>${esc(p.status)} · outcomes: ${kv(p.outcomes)} · not started ${n(p.not_started)} of ${n(p.eligible)}</p><p class="rt-sub">Skipped because: ${kv(p.skip_reasons)}</p><p class="rt-sub">${b}${p.after_sqs != null ? ` · after: All Subscribers ${n(p.after_sqs)}` : ''}</p>${p.refusal && p.status !== 'verified' ? `<div class="rt-error">${esc(p.refusal)}</div>` : ''}`;
  }
  function verifyHtml(r) {
    if (r.done == null) return `<p>Verified: ${esc(JSON.stringify(r.outcomes))} · protected still protected ${n(r.protected_still_protected)} of ${n(r.protected)} · subscribed now ${n(r.subscribed_now)} · nothing changed.</p>`;
    const line = (ok, s) => `<li>${ok ? '✅' : '❌'} ${s}</li>`;
    return `<p><b>${r.ok ? 'Verified' : 'Check failed — see below'}</b> (${stamp(r.at)})</p><ul>`
      + line(r.done_still_subscribed === 0, `${n(r.done_unsubscribed_now)} of ${n(r.done)} done are unsubscribed in a fresh Squarespace read (${n(r.done_still_subscribed)} still subscribed)`)
      + line(r.buyers_still_subscribed === r.buyers_subscribed_before, `buyers kept: ${n(r.buyers_still_subscribed)} of ${n(r.buyers_subscribed_before)} still subscribed; all protected ${n(r.protected_still_subscribed)} of ${n(r.protected_subscribed_before)}`)
      + line(r.others_unsubscribed === 0 && r.others_subscribed === 0, `no other contact changed: ${n(r.others_unsubscribed)} others unsubscribed, ${n(r.others_subscribed)} newly subscribed`)
      + line(r.done_with_suppression === r.done, `${n(r.done_with_suppression)} of ${n(r.done)} have a suppression row; ${esc(r.nightly_sync)}`)
      + `</ul><p class="rt-sub">All Subscribers ${n(r.all_subscribers.sqs_before ?? r.all_subscribers.before)} → ${n(r.all_subscribers.sqs_after ?? r.all_subscribers.after)} · can be emailed ${n(r.can_email.before)} → ${n(r.can_email.after)} · outcomes ${kv(r.outcomes)} · skipped ${kv(r.skip_reasons)}</p>`;
  }
  function verifiedTail(m) {
    const v = m.verify_result;
    if (v.done == null) return `, protected still protected ${n(v.protected_still_protected)} of ${n(v.protected)}, changed anything: no`;
    return ` (${v.ok ? 'ok' : 'CHECK FAILED'}): ${n(v.done)} unsubscribed · buyers kept ${n(v.buyers_still_subscribed)} of ${n(v.buyers_subscribed_before)} · other contacts changed ${n(v.others_unsubscribed + v.others_subscribed)}`;
  }
  function ledgerHtml(list) {
    const rows = list.map((m) => `<tr><td>${stamp(m.created_at)}</td><td>${esc(m.mode)}</td><td class="left">${esc(S.actions[m.action] || m.action)}<div class="rt-sub">${esc(m.query_english || '')}</div></td><td>${n(m.counts?.eligible)} / ${n(m.counts?.protected)}</td><td>${esc(m.status)}</td><td class="left rt-sub">${esc(m.approval_text || '')}${m.verify_result ? `<br>verified ${stamp(m.verified_at)}: ${esc(JSON.stringify(m.verify_result.outcomes))}${verifiedTail(m)}` : ''}</td><td><button type="button" class="rf-btn rf-btn-secondary" data-mc-open="${esc(m.manifest_id)}">Open</button></td></tr>`).join('');
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
      try { await api('POST', '', { action: 'cleanup-approve', manifest_id: S.manifest.manifest_id, confirm: S.host.querySelector('#mc-confirm').value, approval_note: S.host.querySelector('#mc-note').value }); } catch (e) { out(`${manifestHtml(S.manifest)}<div class="rt-error">${esc(e.message)}</div>`); return; }
      S.manifest.status = 'approved'; out(manifestHtml(S.manifest)); await loadLedger();
    },
    execute: async () => {
      try {
        const r = await api('POST', '', { action: 'cleanup-execute', manifest_id: S.manifest.manifest_id });
        S.manifest.status = r.status === 'executing' ? 'executing' : 'executed_dry_run';
        out(`${manifestHtml(S.manifest)}<p class="rt-sub">${r.status === 'executing' ? esc(r.note) : `${n(r.processed)} records re-checked (${esc(r.note)}).`}</p>`);
      } catch (e) { out(`${manifestHtml(S.manifest)}<div class="rt-error">${esc(e.message)}</div>`); return; }
      await loadLedger();
    },
    progress: async () => {
      const p = await api('GET', `?action=cleanup-progress&manifest_id=${encodeURIComponent(S.manifest.manifest_id)}`);
      S.manifest.status = p.status; out(manifestHtml(S.manifest)); S.host.querySelector('#mc-prog').innerHTML = progressHtml(p);
    },
    verify: async () => { const r = await api('POST', '', { action: 'cleanup-verify', manifest_id: S.manifest.manifest_id }); S.manifest.status = 'verified'; out(`${manifestHtml(S.manifest)}${verifyHtml(r)}`); await loadLedger(); }
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
    const cohortOpts = Object.entries(COHORTS).map(([k, l]) => `<option value="cohort:${k}">${esc(l)}</option>`).join('');
    host.innerHTML = '<h3>Contact clean-up</h3><p class="rt-sub">Separate from marketing segments. Choose who (the current Customers filter, a server-side cohort, or TEST = your own @alanranger.com records) and one action. Relationship holds, credit held, your own (owner / test) addresses, buyers (any Squarespace order too), bookings, Academy members, active plans, organisations and anyone with incomplete or probable history are protected on the server and never in the eligible set. Approval binds the exact records, action and query version. "Execute" is a dry run, except "Unsubscribe in Squarespace" for a manifest carrying your recorded approval: your PC opts people out with Squarespace\'s own opt-out (contacts and orders are never deleted).</p>'
      + `${stepsBar(1)}<div class="mk-params"><label class="st-ov-f mk-f">Who<select id="mc-mode"><option value="review">The current Customers filter</option>${cohortOpts}<option value="test">TEST: my own @alanranger.com records</option></select></label>`
      + '<label class="st-ov-f mk-f">Action<select id="mc-action"></select></label><button type="button" class="rf-btn" data-mc="review">Review</button></div><div id="mc-out"></div><div id="mc-ledger-box"><div class="rt-loading">Loading manifests…</div></div>'
      + '<style>#mk-cleanup select,#mk-cleanup #mc-confirm{background:#0b1118;color:#e5e7eb;border:1px solid #334155;border-radius:4px;padding:2px 4px;margin-left:4px}.mc-steps{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}.mc-step{font-size:11px;border:1px solid #334155;border-radius:999px;padding:1px 8px;color:#94a3b8}.mc-step.on{border-color:#3b82f6;color:#e5e7eb}.mc-step.done{color:#4ade80;border-color:#14532d}</style>';
    host.addEventListener('click', onClick);
    try {
      await loadLedger();
      host.querySelector('#mc-action').innerHTML = Object.entries(S.actions).map(([k, l]) => `<option value="${k}" ${k === 'exclude_routine' ? 'selected' : ''}>${esc(l)}</option>`).join('');
    } catch (e) { host.querySelector('#mc-ledger-box').innerHTML = `<div class="rt-error">${esc(e.message)}</div>`; }
  };
})();
