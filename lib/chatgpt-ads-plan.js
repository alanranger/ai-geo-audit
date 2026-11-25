/** ChatGPT Ads card. Same block on Marketing and Strategy. Renders the sync payload. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function when(iso) {
    if (!iso) return 'never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'never';
    return date.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function current(row) {
    return `<h3>${esc(row.title)} <span class="rt-sub">${esc(row.state)}</span></h3>`
      + `<p>${esc(row.id)} · ${esc(row.place)} · ${esc(row.budget)}/day · max CPC ${esc(row.bid)}</p>`
      + `<p>${esc(row.groups)}</p>`
      + `<p class="rt-sub">${esc(row.flight)}</p>`;
  }

  function historical(row) {
    return `<tr><td class="left">${esc(row.name)}<div class="rt-sub">${esc(row.id)}</div></td>`
      + `<td>${esc(row.state)}</td><td class="left">${esc(row.note)}</td></tr>`;
  }

  function html(data) {
    const live = (data.current || []).map(current).join('')
      || `<h3>ChatGPT Ads <span class="rt-sub">${esc(data.heading || 'unavailable')}</span></h3><p>${esc(data.message || 'Live campaign status unavailable.')}</p>`;
    const old = (data.historical || []).map(historical).join('');
    return live
      + (data.stale ? `<p class="rt-sub">${esc(data.message)}</p>` : '')
      + `<p class="rt-sub">${esc(data.monitoring)}</p>`
      + `<p>${esc(data.figures)}</p>`
      + `<p>${esc(data.ga4)}</p>`
      + `<p class="rt-sub">Last synced ${esc(when(data.synced_at))} London.</p>`
      + `<h3>Earlier campaigns</h3>`
      + `<p class="rt-sub">${esc(data.historical_note)}</p>`
      + `<table class="rt-table"><thead><tr><th class="left">Campaign</th><th>State</th><th class="left">Note</th></tr></thead><tbody>${old}</tbody></table>`;
  }

  async function mount(host) {
    if (!host) return;
    host.innerHTML = '<p class="rt-sub">Loading ChatGPT Ads…</p>';
    try {
      const res = await fetch('/api/aigeo/chatgpt-ads-plan');
      const data = await res.json();
      if (!data || data.ok === false) throw new Error('unavailable');
      host.innerHTML = html(data);
    } catch (err) {
      host.innerHTML = '<p class="rt-sub">Live campaign status unavailable.</p>';
    }
  }

  window.mkMountChatgptAds = mount;
})();
