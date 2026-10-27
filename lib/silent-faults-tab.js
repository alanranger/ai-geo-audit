/**
 * Silent faults tab — open faults only (resolved ones drop off by themselves).
 * Data: GET /api/aigeo/silent-fault-monitor. Runs: POST action tick (multi-tick loop).
 */
(function () {
  const API = '/api/aigeo/silent-fault-monitor';
  const SEV_RANK = { red: 0, amber: 1 };
  const state = { data: null, sortK: 'sev', sortDir: 1, running: false };

  const url = (p) => (typeof window.apiUrl === 'function' ? window.apiUrl(p) : p);
  const $ = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shortPage(u) {
    if (!u) return '';
    return String(u).replace(/^https?:\/\/(www\.)?alanranger\.com/, '') || '/';
  }

  function pageName(f) {
    if (f.url) return shortPage(f.url).replace(/^\/blog-on-photography\//, '');
    return f.detail?.subject || f.fault_key.split('|')[1] || f.check_id;
  }

  function day(iso) {
    return iso ? String(iso).slice(0, 10) : '—';
  }

  function typeLabel(t) {
    return { money: 'Money', landing: 'Landing', blog: 'Blog', other: 'Event / product / other', tool: 'Tool', data: 'Data sync', site: 'Site-wide' }[t] || (t || '—');
  }

  async function fetchJson(path, init) {
    const res = await fetch(url(path), init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function filtered() {
    const f = state.data?.findings || [];
    const sev = $('sf-f-sev').value;
    const area = $('sf-f-area').value;
    const type = $('sf-f-type').value;
    const q = $('sf-f-q').value.trim().toLowerCase();
    const rows = f.filter((x) => (!sev || x.severity === sev) && (!area || x.area === area) && (!type || x.page_type === type)
      && (!q || `${x.url || ''} ${x.title} ${x.check_id} ${x.fault_key}`.toLowerCase().includes(q)));
    const key = (x) => ({ sev: SEV_RANK[x.severity] ?? 9, page: pageName(x), check: x.check_id, first: x.first_seen, last: x.last_checked }[state.sortK]);
    return rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * state.sortDir);
  }

  function chip(cls, n, label) {
    return `<div class="sf-chip ${cls}"><div class="n">${esc(n)}</div><div class="l">${esc(label)}</div></div>`;
  }

  function runChips(run) {
    if (!run) return [chip('green', '—', 'Pages checked (last run)'), chip('', 0, 'Not checked (429 / error)'), chip('', '—', 'Blog rotation slot')];
    const nc = run.pages_not_checked || 0;
    return [
      chip('green', `${run.pages_checked}/${run.pages_planned}`, 'Pages checked (last run)'),
      chip(nc ? 'amber' : '', nc, 'Not checked (429 / error)'),
      chip('', `${(run.rotation_slot || 0) + 1} / 4`, 'Blog rotation slot')
    ];
  }

  function runLine(run) {
    if (!run) return 'Last run: never.';
    const when = new Date(run.finished_at || run.started_at).toLocaleString('en-GB');
    const status = run.status === 'running' ? `running — ${run.cursor}/${run.pages_planned} pages` : run.status;
    return `Last run: ${when} (${status}, ${run.source || '—'}).`;
  }

  function renderChips() {
    const s = state.data?.summary || {};
    const run = state.data?.run;
    $('sf-chips').innerHTML = [chip('red', s.red_count || 0, 'Open red'), chip('amber', s.amber_count || 0, 'Open amber'), ...runChips(run)].join('');
    $('sf-sub').textContent = `Open faults only — a fault closes itself the first time its page passes. ${runLine(run)} Googlebot-smartphone render.`;
  }

  function rowHtml(f, i) {
    const stale = f.not_rechecked ? '<span class="sf-stale">not re-checked in the last run</span>' : '';
    const page = f.url
      ? `<a href="${esc(f.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(pageName(f))}</a>`
      : esc(pageName(f));
    return `<tr class="sf-row" data-i="${i}">
      <td><span class="sf-pill ${esc(f.severity)}">${esc(f.severity)}</span></td>
      <td class="sf-page">${page}<small>${esc(typeLabel(f.page_type))}</small></td>
      <td>${esc(f.check_id)}<div class="sf-area">${esc(f.area)}</div></td>
      <td class="sf-what">${esc(f.title)}</td>
      <td class="sf-ago">${esc(day(f.first_seen))}</td>
      <td class="sf-ago">${esc(day(f.last_checked))}${stale}</td>
      <td class="sf-fix">${esc(f.fix_hint || '')}</td></tr>`;
  }

  function renderTable() {
    const rows = filtered();
    state.visible = rows;
    $('sf-rows').innerHTML = rows.length
      ? rows.map(rowHtml).join('')
      : '<tr><td colspan="7" class="sf-empty">No open faults match these filters.</td></tr>';
    $('sf-count').textContent = `${rows.length} shown`;
    document.querySelectorAll('#sf-rows tr.sf-row').forEach((tr) => {
      tr.onclick = () => openDrawer(state.visible[Number(tr.dataset.i)]);
    });
  }

  function listBlock(title, items) {
    if (!Array.isArray(items) || !items.length) return '';
    const lis = items.slice(0, 60).map((x) => `<li>${esc(typeof x === 'string' ? shortPage(x) : `${shortPage(x.url)} — ${x.reason || ''}`)}</li>`).join('');
    return `<div class="sf-cmp"><div class="h">${esc(title)} (${items.length})</div><ul>${lis}</ul></div>`;
  }

  function drawerLinks(f) {
    if (!f.url) return '';
    const slug = shortPage(f.url).split('/').filter(Boolean).pop() || '';
    const schema = f.page_type === 'blog' ? ` <a class="sf-btn ghost" target="_blank" rel="noopener" href="https://schema.alanranger.com/${esc(slug)}_blogposting.json">Schema file</a>` : '';
    return `<a class="sf-btn ghost" target="_blank" rel="noopener" href="${esc(f.url)}">Open live page</a>
      <a class="sf-btn ghost" target="_blank" rel="noopener" href="https://search.google.com/test/rich-results?url=${encodeURIComponent(f.url)}">Rich Results Test</a>${schema}`;
  }

  function openDrawer(f) {
    if (!f) return;
    const d = f.detail || {};
    const accept = f.check_id === 'C1' ? '<button class="sf-btn ghost" id="sf-accept">Accept current layout</button>' : '';
    const recheck = f.url ? '<button class="sf-btn" id="sf-recheck">Re-check this page now</button>' : '';
    $('sf-drawer-body').innerHTML = `<span class="sf-pill ${esc(f.severity)}">${esc(f.severity)}</span>
      <h3>${esc(pageName(f))}</h3>
      <div class="sf-kv"><div>Check</div><div>${esc(f.check_id)} · ${esc(f.area)}</div>
        <div>What's wrong</div><div>${esc(f.title)}</div>
        <div>First seen</div><div>${esc(day(f.first_seen))}</div><div>Last checked</div><div>${esc(day(f.last_checked))}</div></div>
      ${d.expected ? `<div class="sf-cmp"><div class="h">Expected</div>${esc(d.expected)}</div>` : ''}
      ${d.found ? `<div class="sf-cmp"><div class="h">Found</div>${esc(d.found)}</div>` : ''}
      ${listBlock('Missing', d.missing)}${listBlock('Extra', d.extra)}${listBlock('Pages', d.pages)}${listBlock('Failed / skipped', d.failed)}${listBlock('Not published', d.not_published)}
      <p class="sf-fix"><b>Fix:</b> ${esc(f.fix_hint || '—')}</p>
      <p class="sf-actions">${recheck} ${accept} ${drawerLinks(f)}</p>
      <div id="sf-drawer-status" class="sf-fix"></div>`;
    $('sf-drawer').classList.add('open');
    if ($('sf-recheck')) $('sf-recheck').onclick = () => recheck(f.url);
    if ($('sf-accept')) $('sf-accept').onclick = () => acceptLayout(f.url);
  }

  async function recheck(pageUrl) {
    const st = $('sf-drawer-status');
    st.textContent = 'Rendering the page as Googlebot and re-running every check…';
    try {
      const r = await fetchJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recheck', url: pageUrl }) });
      st.innerHTML = r.open.length
        ? `Still open on this page: ${r.open.map((o) => `<b>${esc(o.check_id)}</b> ${esc(o.title)}`).join('; ')}`
        : '<b style="color:#34d399">✓ All checks pass on this page — fault closed.</b>';
      await load();
    } catch (e) {
      st.textContent = `Re-check failed: ${e.message}`;
    }
  }

  async function acceptLayout(pageUrl) {
    await fetchJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept-layout', url: pageUrl }) });
    $('sf-drawer-status').textContent = 'Layout accepted — the next check learns the current blocks.';
    await load();
  }

  function exportCsv() {
    const rows = filtered();
    const cells = (f) => [f.severity, f.url || pageName(f), f.check_id, f.area, f.title, day(f.first_seen), day(f.last_checked), f.fix_hint || '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    const csv = ['severity,page,check,area,whats_wrong,first_seen,last_checked,fix', ...rows.map(cells)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `silent-faults-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function load() {
    try {
      state.data = await fetchJson(API);
      renderChips();
      renderTable();
    } catch (e) {
      $('sf-rows').innerHTML = `<tr><td colspan="7" class="sf-empty">Could not load faults: ${esc(e.message)}</td></tr>`;
    }
  }

  /** Same loop the Full refresh step uses. Resolves with the last tick summary. */
  async function runMonitor({ source = 'dashboard_button', onProgress } = {}) {
    let runId = null;
    for (let tick = 0; tick < 60; tick += 1) {
      const r = await fetchJson(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tick', runId, source }) });
      runId = r.run_id;
      if (typeof onProgress === 'function') onProgress(r.summary || {});
      if (r.done) return r.summary;
      await new Promise((res) => setTimeout(res, r.waiting ? 15000 : 1000));
    }
    throw new Error('silent fault monitor did not finish in 60 ticks');
  }

  async function runFromButton() {
    if (state.running) return;
    state.running = true;
    const btn = $('sf-run');
    btn.disabled = true;
    try {
      await runMonitor({ onProgress: (s) => { btn.textContent = `Checking… ${s.pages_checked || 0}/${s.pages_planned || '?'}`; } });
    } catch (e) {
      alert(`Silent fault check failed: ${e.message}`);
    } finally {
      state.running = false;
      btn.disabled = false;
      btn.textContent = 'Run full check now';
      await load();
    }
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    ['sf-f-sev', 'sf-f-area', 'sf-f-type'].forEach((id) => { $(id).onchange = renderTable; });
    $('sf-f-q').oninput = renderTable;
    $('sf-export').onclick = exportCsv;
    $('sf-run').onclick = runFromButton;
    $('sf-drawer-x').onclick = () => $('sf-drawer').classList.remove('open');
    document.querySelectorAll('#sf-table th[data-k]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        state.sortDir = state.sortK === k ? -state.sortDir : 1;
        state.sortK = k;
        renderTable();
      };
    });
  }

  window.renderSilentFaultsTab = function () {
    if (!$('sf-root')) return;
    wire();
    load();
  };
  window.sfRunMonitor = runMonitor;
})();
