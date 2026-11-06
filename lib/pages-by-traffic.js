/**
 * Pipeline & Funnel · "Pages by search traffic" (P5): one table replacing "Top 5 leaking pages" and "What's earning
 * vs what's just getting traffic". Filter All / Money / Info, every column sortable, default All sorted by clicks.
 */
(function () {
  const LS_KEY = 'rf-pages-traffic-v1';
  const COLS = [
    ['page_url', 'Page', false], ['is_money_page', 'Type', false], ['impressions_28d', 'Impressions 28d', true],
    ['clicks_28d', 'Clicks 28d', true], ['ctr_28d_pct', 'CTR', true], ['position_28d', 'Avg position', true],
    ['recoverable_clicks_28d', 'Recoverable clicks', true]
  ];
  let state = loadState();
  let rows = [];

  function loadState() {
    try { return { filter: 'all', sort: 'clicks_28d', dir: -1, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch (_e) { return { filter: 'all', sort: 'clicks_28d', dir: -1 }; }
  }
  function saveState() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_e) { /* ignore */ } }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const n = (v) => Math.round(Number(v) || 0).toLocaleString('en-GB');
  const path = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/';

  function cell(key, r) {
    if (key === 'page_url') return `<td><a href="${esc(r.page_url)}" target="_blank" rel="noopener">${esc(path(r.page_url))}</a></td>`;
    if (key === 'is_money_page') return `<td><span class="rf-pt-tag ${r.is_money_page ? 'is-money' : 'is-info'}">${r.is_money_page ? 'money' : 'free info'}</span></td>`;
    if (key === 'ctr_28d_pct') return `<td class="num">${(Number(r.ctr_28d_pct) || 0).toFixed(2)}%</td>`;
    if (key === 'position_28d') return `<td class="num">${r.position_28d != null ? Number(r.position_28d).toFixed(1) : '—'}</td>`;
    return `<td class="num">${n(r[key])}</td>`;
  }

  function visible() {
    const f = state.filter;
    const list = rows.filter((r) => f === 'all' || (f === 'money') === !!r.is_money_page);
    const k = state.sort;
    return list.sort((a, b) => {
      const av = a[k] ?? -Infinity;
      const bv = b[k] ?? -Infinity;
      return (av > bv ? 1 : av < bv ? -1 : 0) * state.dir;
    });
  }

  function render(host) {
    const list = visible();
    const counts = { all: rows.length, money: rows.filter((r) => r.is_money_page).length, info: rows.filter((r) => !r.is_money_page).length };
    const chip = (v, l) => `<button type="button" class="rf-btn rf-btn-secondary rf-pt-chip" data-pt-filter="${v}" aria-pressed="${state.filter === v}">${l} (${counts[v]})</button>`;
    const th = COLS.map(([k, l, num]) => `<th class="${num ? 'num ' : ''}sortable" data-pt-sort="${k}">${l}<span class="rf-sort-ind">${state.sort === k ? (state.dir < 0 ? '↓' : '↑') : '↕'}</span></th>`).join('');
    host.innerHTML = `<div class="rf-sub">Last 28 days from Search Console. "Recoverable" = extra clicks in 28 days if CTR rose to the higher of 1.5% or 1.6× today's.</div>`
      + `<div class="rf-toolbar">${chip('all', 'All')}${chip('money', 'Money')}${chip('info', 'Info')}<span class="rf-sub" style="margin-left:auto">Showing ${list.length} of ${rows.length}</span></div>`
      + `<div style="overflow-x:auto;"><table class="rf-table" id="rf-pages-traffic-table"><thead><tr>${th}</tr></thead>`
      + `<tbody>${list.map((r) => `<tr>${COLS.map(([k]) => cell(k, r)).join('')}</tr>`).join('') || '<tr><td colspan="7">No pages.</td></tr>'}</tbody></table></div>`;
  }

  function onClick(e) {
    const host = document.getElementById('rf-pages-traffic-host');
    const f = e.target?.closest?.('[data-pt-filter]');
    const s = e.target?.closest?.('[data-pt-sort]');
    if (!host || (!f && !s)) return;
    if (f) state.filter = f.getAttribute('data-pt-filter');
    if (s) {
      const k = s.getAttribute('data-pt-sort');
      state.dir = state.sort === k ? -state.dir : -1;
      state.sort = k;
    }
    saveState();
    render(host);
  }

  window.addEventListener('rf:summary', (e) => {
    const host = document.getElementById('rf-pages-traffic-host');
    rows = Array.isArray(e.detail?.pages_by_traffic) ? e.detail.pages_by_traffic : [];
    if (host) render(host);
  });
  document.addEventListener('click', onClick);
})();
