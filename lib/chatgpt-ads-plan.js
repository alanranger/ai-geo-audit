/** Live ChatGPT Ads card. Same block on Marketing and Strategy. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function locations(list) {
    if (!list || !list.length) return '';
    return `<ul class="rt-sub">${list.map((name) => `<li>${esc(name)}</li>`).join('')}</ul>`;
  }

  function campaignRow(row) {
    return `<tr><td class="left">${esc(row.name)}<div class="rt-sub">${esc(row.id)}</div></td>`
      + `<td>${esc(row.cap)}</td><td>${esc(row.state)}</td>`
      + `<td class="left">${esc(row.ads)}${locations(row.locations)}${row.held ? `<div class="rt-sub">${esc(row.held)}</div>` : ''}</td></tr>`;
  }

  function money(value) {
    if (value == null) return '\u2014';
    const amount = Number(value);
    return '\u00a3' + (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
  }

  function count(value) {
    return value == null ? '\u2014' : esc(value);
  }

  function html(data) {
    const figures = data.figures || {};
    return `<h3>ChatGPT Ads <span class="rt-sub">live</span></h3>`
      + `<p>LIVE since ${esc(data.since)}. Ends ${esc(data.ends)}.</p>`
      + `<p>${esc(data.tracking)}</p>`
      + `<p class="rt-sub">Total cap ${esc(data.total_cap)}.</p>`
      + `<table class="rt-table"><thead><tr><th>Visits</th><th>Purchases</th><th>Revenue</th><th>Trials</th><th>Clicks</th><th>Spend</th></tr></thead>`
      + `<tbody><tr><td>${count(figures.visits)}</td><td>${count(figures.purchases)}</td><td>${money(figures.revenue_gbp)}</td>`
      + `<td>${count(figures.trials)}</td><td>${count(figures.clicks)}</td><td>${money(figures.spend_gbp)}</td></tr></tbody></table>`
      + `<p class="rt-sub">Visits are GA4 sessions. Purchases and revenue are our own captured orders, with test orders left out. Clicks and spend stay blank until the provider figures are entered.</p>`
      + `<table class="rt-table"><thead><tr><th class="left">Campaign</th><th>Cap</th><th>State</th><th class="left">Ads</th></tr></thead>`
      + `<tbody>${(data.campaigns || []).map(campaignRow).join('')}</tbody></table>`;
  }

  async function mount(host) {
    if (!host) return;
    host.innerHTML = '<p class="rt-sub">Loading ChatGPT Ads…</p>';
    try {
      const res = await fetch('/api/aigeo/chatgpt-ads-plan');
      const data = await res.json();
      if (!data.ok) throw new Error('unavailable');
      host.innerHTML = html(data);
    } catch (err) {
      host.innerHTML = '<p class="rt-sub">ChatGPT Ads plan unavailable.</p>';
    }
  }

  window.mkMountChatgptAds = mount;
})();
