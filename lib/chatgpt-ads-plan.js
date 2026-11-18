/** Paused ChatGPT Ads card. Same block on Marketing and Strategy. */
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

  function html(data) {
    const blockers = (data.blockers || []).map((item) => `<li>${esc(item)}</li>`).join('');
    return `<h3>ChatGPT Ads <span class="rt-sub">paused test</span></h3>`
      + `<p>${esc(data.tracking)}</p>`
      + `<p class="rt-sub">Total cap ${esc(data.total_cap)}. Provider credit deadline ${esc(data.credit_deadline)}.</p>`
      + `<table class="rt-table"><thead><tr><th class="left">Campaign</th><th>Cap</th><th>State</th><th class="left">Ads</th></tr></thead>`
      + `<tbody>${(data.campaigns || []).map(campaignRow).join('')}</tbody></table>`
      + `<p class="rt-sub">Still to clear before a launch</p><ul>${blockers}</ul>`;
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
