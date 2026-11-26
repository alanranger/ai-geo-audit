/** ChatGPT Ads. Marketing shows the tables. Strategy shows the summary. */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function sumMetric(rows, key) {
    if (!rows || !rows.length) return null;
    let total = 0;
    for (const row of rows) {
      if (row?.[key] == null) return null;
      total += Number(row[key]);
    }
    return total;
  }

  function gbp(n) {
    if (n == null || Number.isNaN(Number(n))) return 'unavailable';
    return Number(n).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
  }
  function num(n) {
    if (n == null || Number.isNaN(Number(n))) return 'unavailable';
    return Number(n).toLocaleString('en-GB');
  }
  function rate(part, whole) {
    if (part == null || whole == null || whole === 0) return 'unavailable';
    return `${((part / whole) * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
  }
  function today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  function clock(iso) {
    if (!iso) return 'never';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'never';
    return date.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function dayLabel(iso) {
    const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
    return iso === today() ? `${label} so far` : label;
  }

  function choices(data) {
    const live = (data.current || []).map((row) => ({ ...row, name: row.title }));
    return live.concat(data.historical || []);
  }
  function adsFor(data, id) {
    return (data.ads || []).filter((row) => row.campaign_id === id).map((row) => row.id);
  }
  function inRange(row, from, to) {
    const day = String(row.date || '').slice(0, 10);
    return day && day >= from && day <= to;
  }
  function ga4(data, ids, from, to) {
    if (!data.ga4_rows) return { sessions: null, engaged: null };
    const rows = data.ga4_rows.filter((row) => ids.includes(row.content) && inRange(row, from, to));
    if (!rows.length) return { sessions: null, engaged: null };
    return { sessions: sumMetric(rows, 'sessions'), engaged: sumMetric(rows, 'engaged_sessions') };
  }
  function totals(rows) {
    const spend = sumMetric(rows, 'spend');
    const clicks = sumMetric(rows, 'clicks');
    const impressions = sumMetric(rows, 'impressions');
    return {
      spend, clicks, impressions, conversions: sumMetric(rows, 'conversions'),
      cpc: spend == null || clicks == null || clicks === 0 ? null : spend / clicks,
      ctr: clicks == null || impressions == null || impressions === 0 ? null : clicks / impressions
    };
  }

  function td(value, text, left) {
    return `<td${left ? ' class="left"' : ''} data-sort="${esc(value == null ? '' : value)}">${esc(text)}</td>`;
  }
  function head(labels) {
    return `<tr>${labels.map((label, i) => `<th data-col="${i}"${i === 0 ? ' class="left"' : ''}>${esc(label)}</th>`).join('')}</tr>`;
  }
  function table(labels, rows) {
    const body = rows.length ? rows.join('') : `<tr><td class="left rt-sub" colspan="${labels.length}">unavailable</td></tr>`;
    return `<table class="rt-table"><thead>${head(labels)}</thead><tbody>${body}</tbody></table>`;
  }
  function sortTables(root) {
    root.querySelectorAll('table').forEach((tableNode) => {
      tableNode.querySelectorAll('th[data-col]').forEach((th) => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
          const col = Number(th.dataset.col);
          const body = tableNode.tBodies[0];
          const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
          tableNode.querySelectorAll('th').forEach((item) => { item.dataset.dir = ''; });
          th.dataset.dir = dir;
          [...body.rows].sort((a, b) => {
            const av = a.cells[col]?.dataset.sort || a.cells[col]?.innerText || '';
            const bv = b.cells[col]?.dataset.sort || b.cells[col]?.innerText || '';
            const an = Number(av);
            const bn = Number(bv);
            const cmp = av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn) ? an - bn : String(av).localeCompare(String(bv));
            return dir === 'asc' ? cmp : -cmp;
          }).forEach((row) => body.appendChild(row));
        });
      });
    });
  }

  function summary(box, visits, choice, flightTotals) {
    const cells = [gbp(box.spend), num(box.clicks), gbp(box.cpc), rate(box.clicks, box.impressions), num(visits.sessions), `${num(visits.engaged)} (${rate(visits.engaged, visits.sessions)})`, num(box.conversions)];
    const labels = ['Spend', 'Clicks', 'CPC', 'CTR', 'GA4 visits', 'Engaged', 'Conversions'];
    const limits = choice.monitoring || {};
    const cap = limits.spend_stop ?? limits.spend_cap;
    if (cap != null) {
      labels.push(limits.spend_stop != null ? `Left to ${gbp(cap)} stop check (whole flight)` : `Left of ${gbp(cap)} total cap (whole flight)`);
      cells.push(flightTotals.spend == null ? 'unavailable' : gbp(cap - flightTotals.spend));
    }
    if (limits.click_stop != null) {
      labels.push(`Clicks vs ${num(limits.click_stop)} (whole flight)`);
      cells.push(flightTotals.clicks == null ? 'unavailable' : `${num(flightTotals.clicks)} of ${num(limits.click_stop)}`);
    }
    return table(labels, [`<tr>${cells.map((text) => `<td>${esc(text)}</td>`).join('')}</tr>`]);
  }

  function dayRows(data, id, from, to) {
    const ids = adsFor(data, id);
    return (data.days || []).filter((row) => row.campaign_id === id && inRange(row, from, to)).sort((a, b) => a.date.localeCompare(b.date)).map((row) => {
      const visits = ga4(data, ids, row.date, row.date);
      const box = totals([row]);
      return `<tr>${td(row.date, dayLabel(row.date), true)}${td(row.impressions, num(row.impressions))}${td(row.clicks, num(row.clicks))}${td(row.spend, gbp(row.spend))}${td(box.cpc, gbp(box.cpc))}${td(visits.sessions, num(visits.sessions))}${td(visits.engaged, num(visits.engaged))}${td(row.conversions, num(row.conversions))}</tr>`;
    });
  }
  function adRows(data, id, from, to) {
    const known = (data.ads || []).filter((row) => row.campaign_id === id);
    const metrics = (data.ad_metrics || []).filter((row) => row.campaign_id === id && row.ad_id && inRange(row, from, to));
    const ids = [...new Set(known.map((row) => row.id).concat(metrics.map((row) => row.ad_id)).filter(Boolean))];
    return ids.map((adId) => {
      const meta = known.find((row) => row.id === adId) || {};
      const rows = metrics.filter((row) => row.ad_id === adId);
      const box = totals(rows);
      const visits = ga4(data, [adId], from, to);
      const quiet = meta.status === 'paused' || meta.status === 'ended' ? ' class="rt-sub"' : '';
      const name = meta.name || rows.find((row) => row.name)?.name || adId;
      return `<tr${quiet}>${td(name, name, true)}${td(meta.status || 'unavailable', meta.status || 'unavailable')}${td(box.impressions, num(box.impressions))}${td(box.clicks, num(box.clicks))}${td(box.ctr, rate(box.clicks, box.impressions))}${td(box.spend, gbp(box.spend))}${td(box.cpc, gbp(box.cpc))}${td(visits.sessions, num(visits.sessions))}${td(visits.engaged, num(visits.engaged))}${td(box.conversions, num(box.conversions))}</tr>`;
    });
  }
  function flightEnd(row) {
    if (row.end && row.end < today()) return row.end;
    return today();
  }
  function campaignRows(data, labels, allTime) {
    return choices(data).map((row) => {
      const from = allTime ? '2026-11-01' : (row.start || '2026-11-01');
      const to = allTime ? '2099-01-01' : flightEnd(row);
      const box = totals((data.totals || []).filter((item) => item.campaign_id === row.id));
      const visits = ga4(data, adsFor(data, row.id), from, to);
      const cells = [td(row.name, row.name, true), td(row.state, row.state), td(box.spend, gbp(box.spend)), td(box.clicks, num(box.clicks))];
      if (labels.includes('Dates')) cells.splice(2, 0, td(row.flight, row.flight || 'unavailable'));
      if (labels.includes('CPC')) cells.push(td(box.cpc, gbp(box.cpc)));
      cells.push(td(visits.sessions, num(visits.sessions)), td(box.conversions, num(box.conversions)));
      return `<tr>${cells.join('')}</tr>`;
    });
  }

  function header(choice, synced) {
    return `<h3>${esc(choice?.name || 'ChatGPT Ads')} <span class="rt-pill">${esc(choice?.state || 'unavailable')}</span></h3>`
      + `<p>${esc(choice?.flight || 'schedule unavailable')} · ${esc(choice?.budget_display || 'Budget unavailable')} · ${esc(choice?.bid_display || 'Bid unavailable')} · last synced ${esc(clock(synced))}</p>`;
  }

  function fill(host, data, full, state) {
    const choice = choices(data).find((row) => row.id === state.id) || choices(data)[0] || {};
    const days = (data.days || []).filter((row) => row.campaign_id === choice.id && inRange(row, state.from, state.to));
    const box = totals(days);
    const visits = ga4(data, adsFor(data, choice.id), state.from, state.to);
    const body = host.querySelector('[data-ads-body]');
    const blocks = [header(choice, data.synced_at)];
    if (data.stale) blocks.push(`<p class="rt-sub">${esc(data.message)}</p>`);
    if (data.breakdown_error) blocks.push(`<p class="rt-sub">${esc(data.breakdown_error)}</p>`);
    if (!choice.id) blocks.push(`<p>${esc(data.message || 'Live campaign status unavailable.')}</p>`);
    const flightTotals = totals((data.totals || []).filter((row) => row.campaign_id === choice.id));
    const fresh = (data.report_fresh || {})[choice.id];
    if (fresh && !fresh.ok_at && !days.length) blocks.push(`<p class="rt-sub">${esc(fresh.error || 'Reporting pending for this campaign.')}</p>`);
    blocks.push(summary(box, visits, choice, flightTotals));
    if (full) {
      blocks.push('<h3>By day</h3>', table(['Date', 'Impressions', 'Clicks', 'Spend', 'CPC', 'GA4 visits', 'Engaged', 'Conversions'], dayRows(data, choice.id, state.from, state.to)));
      blocks.push('<h3>By ad</h3>', table(['Ad', 'Status', 'Impressions', 'Clicks', 'CTR', 'Spend', 'CPC', 'GA4 visits', 'Engaged', 'Conversions'], adRows(data, choice.id, state.from, state.to)));
      blocks.push('<h3>By campaign, all time</h3>', table(['Campaign', 'Status', 'Dates', 'Spend', 'Clicks', 'CPC', 'GA4 visits', 'Conversions'], campaignRows(data, ['Campaign', 'Status', 'Dates', 'Spend', 'Clicks', 'CPC', 'GA4 visits', 'Conversions'], true)));
      blocks.push(`<p class="rt-sub">${esc(data.historical_note || '')}</p>`);
    } else {
      blocks.push('<h3>By campaign, this flight</h3>', table(['Campaign', 'Status', 'Spend', 'Clicks', 'GA4 visits', 'Conversions'], campaignRows(data, ['Campaign', 'Status', 'Spend', 'Clicks', 'GA4 visits', 'Conversions'], false)));
      blocks.push('<p><button type="button" class="rf-btn rf-btn-secondary" data-ads-go>Details in Marketing &amp; Campaigns →</button></p>');
    }
    blocks.push(`<p class="rt-sub">${esc(choice.monitoring?.text || '')}</p>`);
    body.innerHTML = blocks.join('');
    const go = body.querySelector('[data-ads-go]');
    if (go) go.addEventListener('click', () => document.querySelector('button[data-panel="marketing"]')?.click());
    sortTables(body);
  }

  function paint(host, data, full) {
    const list = choices(data);
    const first = list.find((row) => row.state === 'active') || list[0] || {};
    const state = { id: first.id || '', from: first.start || '2026-11-01', to: first.end && first.end < today() ? first.end : today() };
    const filters = full ? `<p><label>Campaign <select data-ads-campaign>${list.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label> <label>From <input data-ads-from type="date" value="${esc(state.from)}"></label> <label>To <input data-ads-to type="date" value="${esc(state.to)}"></label></p>` : '';
    host.innerHTML = `${filters}<div data-ads-body></div>`;
    const campaign = host.querySelector('[data-ads-campaign]');
    const from = host.querySelector('[data-ads-from]');
    const to = host.querySelector('[data-ads-to]');
    if (campaign) campaign.addEventListener('change', () => {
      const next = list.find((row) => row.id === campaign.value) || first;
      state.id = next.id;
      state.from = next.start || '2026-11-01';
      state.to = next.end && next.end < today() ? next.end : today();
      if (from) from.value = state.from;
      if (to) to.value = state.to;
      fill(host, data, full, state);
    });
    if (from) from.addEventListener('change', () => { state.from = from.value; fill(host, data, full, state); });
    if (to) to.addEventListener('change', () => { state.to = to.value; fill(host, data, full, state); });
    fill(host, data, full, state);
  }

  async function mount(host) {
    if (!host) return;
    host.innerHTML = '<p class="rt-sub">Loading ChatGPT Ads…</p>';
    try {
      const res = await fetch('/api/aigeo/chatgpt-ads-plan');
      const data = await res.json();
      if (!data || data.ok === false) throw new Error('unavailable');
      paint(host, data, host.id !== 'st-chatgpt-ads');
    } catch (err) {
      host.innerHTML = '<p class="rt-sub">Live campaign status unavailable.</p>';
    }
  }

  window.mkMountChatgptAds = mount;
})();
