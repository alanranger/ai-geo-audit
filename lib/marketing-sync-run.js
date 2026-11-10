/**
 * Marketing & Campaigns: one progress / result window for the two data runs, and their buttons in the tab header.
 *   Sync customers        = Behind the scenes → Sources & sync health → "Sync now" (same function: customers()):
 *                           POST sync profiles → orders → postcodes → customers, one server call per step.
 *   Collect email results = the email-report collector on Alan's PC through the existing collect queue
 *                           (POST collect-request, then GET collect-queue read-only until the PC reports back).
 * Progress: % from the steps done plus the step's own progress where it has one, "step x of n", alive / stalled;
 * result: ✅ / ❌ (which step), one line per step, duration and OK; then the tab reloads and "Last run" updates.
 * Neither run sends anything. Exposes mkSyncRun.{customers, collectEmails, model, config}, mkSyncRunHead() (header
 * HTML, used by lib/marketing-tab.js shellHtml) and mkSyncRunPaint(overview) (called after each overview load).
 */
(function () {
  const API = '/api/aigeo/marketing';
  const COLLECT_KEY = 'dashboard|collect-email-results';
  const STALL_S = 45;
  const TIPS = {
    sync: 'Reads Squarespace contacts and orders, looks up postcodes and rebuilds the customer view, so consent and audience counts are up to date. Runs nightly at 05:15 by itself — use after importing contacts or when counts look stale. Never sends anything.',
    collect: 'Pulls the latest email campaign results (deliveries, opens, clicks, unsubscribes) from Squarespace into the dashboard. Runs automatically — use straight after a campaign send to see results sooner. Never sends anything.'
  };
  const config = { pollMs: 5000, pickupMs: 12 * 60000, readMs: 20 * 60000, reloadMs: 120000 };
  const S = { runs: null, busy: {}, waiters: [] };

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('en-GB'));
  const ukStamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '—');
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  /* ---------- model (pure; test/marketing-sync-run.test.js) ---------- */

  function duration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }
  /** p: { labels, i, frac, t0, beatAt, now, note } → bar %, "x% · step i of n: label · 12 s", alive / stalled. */
  function progressView(p) {
    const total = p.labels.length;
    const frac = Math.max(0, Math.min(1, p.frac || 0));
    const pct = Math.min(99, Math.round(((p.i + frac) / total) * 100));
    const elapsed = p.now - p.t0;
    const eta = p.i && !p.note ? Math.round(((elapsed / p.i) * (total - p.i)) / 1000) : null;
    const quiet = Math.round((p.now - p.beatAt) / 1000);
    const stalled = quiet >= STALL_S;
    return {
      pct, step: p.i + 1, total, stalled,
      text: `${pct}% · step ${p.i + 1} of ${total}: ${p.labels[p.i]} · ${duration(elapsed)}${eta != null ? ` · about ${eta} s left` : ''}`,
      alive: stalled ? `stalled — no reply for ${quiet} s` : 'alive',
      note: p.note || ''
    };
  }
  /** lines: [{ label, ok, text }] for the steps that ran → ✅ / ❌ (step k of n), one line per step, duration. */
  function resultView({ lines, total, t0, now }) {
    const bad = lines.findIndex((l) => !l.ok);
    const ok = bad < 0 && lines.length === total;
    const head = ok ? '✅ Success' : `❌ Failed at step ${bad + 1} of ${total}: ${lines[bad]?.label || 'not finished'}`;
    return { ok, head, lines: lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.label}: ${l.text}`), took: `Took ${duration(now - t0)}` };
  }

  const SYNC_LINES = {
    profiles: (o) => `${n(o.profiles)} contacts, ${n(o.subscribed)} subscribed`,
    orders: (o) => `${n(o.orders)} order${o.orders === 1 ? '' : 's'} read (${o.mode || 'incremental'})`,
    postcodes: (o) => `${n(o.looked_up)} looked up · ${n(o.known_postcodes)} known${o.remaining ? ` · ${n(o.remaining)} still to look up` : ''}`,
    customers: (o) => `${n(o.persons)} people`
  };
  const syncLine = (step, out) => (SYNC_LINES[step] ? SYNC_LINES[step](out || {}) : 'done');

  /** The email-report collector run's summary (posted by the PC): what it read. */
  function collectLine(run) {
    if (!run) return 'no collector run recorded';
    if (run.status !== 'ok') return `${String(run.status).toUpperCase()}${run.error ? `: ${run.error}` : ''}`;
    const s = run.summary || {};
    return `${n(s.campaigns_listed)} sent campaigns listed · ${n(s.summaries_refreshed)} reports refreshed · ${n(s.event_campaigns_done)} of ${n(s.event_campaigns_target)} recipient lists read (${n(s.events)} events)`;
  }

  function lastRunText(run) {
    if (!run) return 'Last run: never';
    if (run.status === 'running') return `Running since ${ukStamp(run.started_at)}`;
    const at = run.finished_at || run.heartbeat_at || run.started_at;
    return `Last run ${ukStamp(at)}${run.status === 'ok' ? '' : ` · ${String(run.status).toUpperCase()}`}`;
  }
  /** Sync customers: the latest Squarespace contacts read (step 1, only run by the full sync); emails: the collector. */
  const runOf = (runs, id) => (id === 'sync' ? runs?.['sync:profiles'] : runs?.collector) || null;

  /** Our manual queue row, only if it is the one this click queued (re-queuing resets the same row). */
  function queueRow(rows, dueNow) {
    const r = (rows || []).find((x) => x.campaign_key === COLLECT_KEY && x.slot === 'manual');
    return r && Date.parse(r.due_at) >= Date.parse(dueNow) - 1000 ? r : null;
  }
  /** waiting (queued) · reading (claimed by the PC) · done · skipped · retry (a failed attempt, re-queued) · failed. */
  function queuePhase(r) {
    if (!r) return 'waiting';
    if (r.status === 'queued') return r.attempts > 0 ? 'retry' : 'waiting';
    return r.status === 'running' ? 'reading' : r.status;
  }

  /* ---------- server calls ---------- */

  async function api(method, query, body) {
    const key = typeof window.getAdminKey === 'function' ? window.getAdminKey() : '';
    if (!key) throw new Error('admin key needed (Configuration & Reporting → Save Admin Key)');
    const r = await fetch(`${API}${query || ''}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /** Poll the queue until `until(phase)`; the step's bar moves with elapsed / expected, each reply is an alive beat. */
  async function waitQueue(ctx, beat, { until, expectMs, timeoutMs, note }) {
    const t0 = Date.now();
    for (;;) {
      const j = await api('GET', '?action=collect-queue').catch(() => null);
      const phase = j ? queuePhase(queueRow(j.requests, ctx.due)) : null;
      if (j) beat(Math.min(0.95, (Date.now() - t0) / expectMs), note);
      if (phase && until(phase)) return phase;
      if (Date.now() - t0 > timeoutMs) return 'timeout';
      await sleep(config.pollMs);
    }
  }
  const failedText = (phase) => (phase === 'retry' ? 'the collector run failed; Alan\'s PC retries in 10 minutes by itself' : 'the collector run failed (see Sources & sync health)');

  /* ---------- the two jobs ---------- */

  const SYNC_STEPS = [['profiles', 'Squarespace profiles (consent)'], ['orders', 'Squarespace orders'], ['postcodes', 'Postcode lookup'], ['customers', 'Rebuild customer view']];
  const syncJob = () => ({
    id: 'sync',
    title: 'Sync customers',
    footer: 'Squarespace was only read; nothing was sent.',
    steps: SYNC_STEPS.map(([step, label]) => ({ label, run: async () => syncLine(step, await api('POST', '', { action: 'sync', step })) }))
  });

  async function pickup(beat, ctx) {
    const phase = await waitQueue(ctx, beat, { until: (p) => p !== 'waiting', expectMs: 5 * 60000, timeoutMs: config.pickupMs, note: 'waiting for Alan\'s PC (checks every 5 minutes)' });
    if (phase === 'timeout') throw new Error('Alan\'s PC did not pick it up within 12 minutes — is it switched on? The request stays queued and runs when it is.');
    if (phase === 'failed' || phase === 'retry') throw new Error(failedText(phase));
    ctx.skipped = phase === 'skipped';
    ctx.picked = Date.now();
    return ctx.skipped ? 'not needed: a collector run finished after you asked' : `picked up after ${duration(ctx.picked - ctx.t0)}`;
  }
  async function readReports(beat, ctx) {
    if (ctx.skipped) return 'already read by the run that finished first';
    const phase = await waitQueue(ctx, beat, { until: (p) => p !== 'reading', expectMs: 4 * 60000, timeoutMs: config.readMs, note: 'Alan\'s PC is reading Squarespace (usually about 4 minutes)' });
    if (phase === 'timeout') throw new Error('still reading after 20 minutes; the result is recorded when it finishes');
    if (phase !== 'done' && phase !== 'skipped') throw new Error(failedText(phase));
    return `read in ${duration(Date.now() - ctx.picked)}`;
  }
  const collectJob = () => ({
    id: 'collect',
    title: 'Collect email results',
    footer: 'Squarespace was only read; nothing was sent. Alan\'s PC then rebuilds the customer view (about 30 s).',
    steps: [
      { label: 'Queue the read for Alan\'s PC', run: async (beat, ctx) => { ctx.due = (await api('POST', '', { action: 'collect-request', campaign_key: COLLECT_KEY })).due_now; return `queued ${ukStamp(ctx.due)} (Alan's PC checks every 5 minutes)`; } },
      { label: 'Alan\'s PC starts the email-report collector', run: pickup },
      { label: 'Read Squarespace email reports', run: readReports }
    ],
    /** After the reload: the collector's own summary replaces "read in …" when this run produced it. */
    afterReload: (runs, lines, t0) => {
      const run = runs?.collector;
      const last = lines[2];
      if (last?.ok && run && Date.parse(run.finished_at || run.started_at) >= t0) last.text = `${last.text} · ${collectLine(run)}`;
    }
  });

  /* ---------- window ---------- */

  function modal(html) {
    let m = document.getElementById('mk-run-modal');
    if (!m) { m = document.createElement('div'); m.id = 'mk-run-modal'; document.body.appendChild(m); }
    m.innerHTML = `<div class="box">${html}</div>`;
    return m;
  }
  const linesHtml = (lines) => lines.map((l) => `<div class="mksr-line">${l.ok ? '✓' : '✗'} ${esc(l.label)}: ${esc(l.text)}</div>`).join('');
  function progressHtml(title, v, lines) {
    return `<h4>${esc(title)}…</h4><div class="mksr-prog"><div style="width:${v.pct}%"></div></div>`
      + `<p class="mksr-sub" data-mksr-step="${v.step}" data-mksr-total="${v.total}">${esc(v.text)}</p>`
      + `<p class="mksr-sub ${v.stalled ? 'mksr-stall' : 'mksr-alive'}" data-mksr-alive>${esc(v.alive)}${v.note ? ` · ${esc(v.note)}` : ''}</p>${linesHtml(lines)}`;
  }
  function resultHtml(job, r, reload) {
    return `<h4 data-mksr-result="${r.ok ? 'ok' : 'failed'}">${esc(job.title)}: ${esc(r.head)}</h4>${r.lines.map((t) => `<div class="mksr-line">${esc(t)}</div>`).join('')}`
      + `<p class="mksr-sub">${esc(r.took)} · ${esc(job.footer)}</p><p class="mksr-sub" data-mksr-reload="${reload.state}">${esc(reload.text)}</p>`
      + '<button type="button" class="rf-btn" data-mksr-ok>OK</button>';
  }

  /** Reload the tab (tiles, header "Last run"); resolves when mkSyncRunPaint fires, false after the time-out. */
  function reloadTab() {
    return new Promise((resolve) => {
      if (typeof window.renderMarketingTab !== 'function') { resolve(false); return; }
      const timer = setTimeout(() => resolve(false), config.reloadMs);
      S.waiters.push(() => { clearTimeout(timer); resolve(true); });
      window.renderMarketingTab(true);
    });
  }

  async function runStep(step, live, ctx, lines) {
    const beat = (frac, note) => Object.assign(live, { frac: frac ?? live.frac, note: note || '', beatAt: Date.now() });
    try {
      lines.push({ label: step.label, ok: true, text: await step.run(beat, ctx) });
      return true;
    } catch (e) {
      lines.push({ label: step.label, ok: false, text: String(e?.message || e) });
      return false;
    }
  }
  async function runSteps(job, t0, lines) {
    const ctx = { t0 };
    const live = { i: 0, frac: 0, beatAt: t0, note: '' };
    const labels = job.steps.map((s) => s.label);
    const tick = () => modal(progressHtml(job.title, progressView({ labels, ...live, t0, now: Date.now() }), lines));
    const timer = setInterval(tick, 1000);
    try {
      for (let i = 0; i < job.steps.length; i += 1) {
        Object.assign(live, { i, frac: 0, beatAt: Date.now(), note: '' });
        tick();
        if (!(await runStep(job.steps[i], live, ctx, lines))) break;
      }
    } finally {
      clearInterval(timer);
    }
  }
  /** Progress window → result window (stays until OK) → tab reload → result line about the reload. */
  async function run(job) {
    if (S.busy[job.id]) return null;
    S.busy[job.id] = true;
    paintHead();
    const t0 = Date.now();
    const lines = [];
    try {
      await runSteps(job, t0, lines);
    } finally {
      S.busy[job.id] = false;
    }
    const view = () => resultView({ lines, total: job.steps.length, t0, now: Date.now() });
    const r = view();
    modal(resultHtml(job, r, { state: 'running', text: 'Reloading the Marketing tiles…' }));
    const reloaded = await reloadTab();
    if (job.afterReload) job.afterReload(S.runs, lines, t0);
    const m = document.getElementById('mk-run-modal');
    const text = reloaded ? `Marketing tiles reloaded ${ukStamp(new Date().toISOString())}.` : 'The tiles did not reload — refresh the page to see the new figures.';
    if (m) modal(resultHtml(job, { ...view(), took: r.took }, { state: reloaded ? 'done' : 'failed', text }));
    return { ok: r.ok, lines };
  }

  /* ---------- header buttons + "Last run" ---------- */

  function headButton(id, label) {
    const busy = !!S.busy[id];
    const last = S.runs ? lastRunText(runOf(S.runs, id)) : 'Last run: loading…';
    return `<div class="mksr-act"><button type="button" class="rf-btn" data-mksr="${id}" title="${esc(TIPS[id])}"${busy ? ' disabled' : ''}>${busy ? 'Running…' : label}</button>`
      + `<div class="mksr-last" data-mksr-last="${id}">${esc(last)}</div></div>`;
  }
  const headHtml = () => `<div class="mksr-head">${headButton('sync', 'Sync customers')}${headButton('collect', 'Collect email results')}</div>`;
  function paintHead() {
    const host = document.getElementById('mk-head-actions');
    if (host) host.innerHTML = headHtml();
  }

  const ACT = { sync: () => run(syncJob()), collect: () => run(collectJob()) };
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('[data-mksr-ok]')) { document.getElementById('mk-run-modal')?.remove(); return; }
    const btn = e.target.closest?.('[data-mksr]');
    if (!btn || !ACT[btn.dataset.mksr]) return;
    Promise.resolve(ACT[btn.dataset.mksr]()).catch((err) => modal(`<h4>Not started</h4><p class="mksr-sub">${esc(err.message)}</p><button type="button" class="rf-btn" data-mksr-ok>OK</button>`));
  });

  const STYLE = `
    section[data-panel="marketing"] .card--section-header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem 1.5rem; }
    .mksr-head { display: flex; gap: 0.75rem; align-items: flex-start; }
    .mksr-act { display: flex; flex-direction: column; gap: 2px; }
    .mksr-last { color: var(--dark-text-muted, #94a3b8); font-size: 0.75rem; }
    #mk-run-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9998; display: flex; align-items: center; justify-content: center; }
    #mk-run-modal .box { width: 34rem; max-height: 85vh; overflow: auto; background: #0b1118; border: 1px solid #334155; border-radius: 10px; padding: 1rem 1.2rem; color: #e5e7eb; }
    #mk-run-modal h4 { margin: 0 0 0.5rem; }
    #mk-run-modal .mksr-sub { color: #94a3b8; font-size: 0.85rem; margin: 0.3rem 0; line-height: 1.45; }
    #mk-run-modal .mksr-alive { color: #5fd38d; } #mk-run-modal .mksr-stall { color: #f0b429; font-weight: 700; }
    #mk-run-modal .mksr-line { font-size: 0.85rem; padding: 2px 0; }
    .mksr-prog { height: 8px; background: #1f2937; border-radius: 4px; overflow: hidden; margin: 0.4rem 0; } .mksr-prog div { height: 100%; background: var(--dark-brand, #f0a500); transition: width 0.4s; }`;
  if (document.head && !document.getElementById('mksr-style')) {
    const st = document.createElement('style');
    st.id = 'mksr-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  window.mkSyncRunHead = headHtml;
  /** After each overview load (lib/marketing-tab.js render): store the run log, repaint "Last run", release reload waits. */
  window.mkSyncRunPaint = function mkSyncRunPaint(d) {
    if (d?.runs) S.runs = d.runs;
    paintHead();
    const waiting = S.waiters;
    S.waiters = [];
    waiting.forEach((f) => f());
  };
  window.mkSyncRun = {
    customers: () => run(syncJob()),
    collectEmails: () => run(collectJob()),
    config,
    TIPS,
    model: { duration, progressView, resultView, syncLine, collectLine, lastRunText, runOf, queueRow, queuePhase, COLLECT_KEY }
  };
})();
