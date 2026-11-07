
  (function () {
    'use strict';

    const RF_PROPERTY = 'https://www.alanranger.com';
    let rfState = { summary: null, showDone: false, loading: false, fetchSeq: 0, aiMap: [], earningPages: [], history: [], moneyPages: [] };

    function rfApi(path) {
      const base = (typeof apiUrl === 'function') ? apiUrl(path) : path;
      return base;
    }

    function rfShowStatus(msg, kind) {
      const el = document.getElementById('rf-status-msg');
      if (!el) return;
      if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
      el.style.display = 'block';
      el.textContent = msg;
      el.style.background = kind === 'error' ? '#fee2e2' : '#fffbeb';
      el.style.borderColor = kind === 'error' ? '#fca5a5' : '#fcd34d';
      el.style.color = kind === 'error' ? '#7f1d1d' : '#78350f';
    }

    function rfFmtPct(v, digits) {
      if (v == null || !Number.isFinite(v)) return '—';
      const d = digits == null ? 2 : digits;
      return v.toFixed(d) + '%';
    }

    function rfFmtNum(v) {
      if (v == null || !Number.isFinite(Number(v))) return '—';
      return Number(v).toLocaleString('en-GB');
    }

    function rfFmtMoney(v, currency) {
      if (v == null || !Number.isFinite(Number(v))) return '—';
      const cur = currency || 'GBP';
      try { return Number(v).toLocaleString('en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0, minimumFractionDigits: 0 }); }
      catch { return cur + ' ' + Math.round(Number(v)).toLocaleString('en-GB'); }
    }

    function rfDeltaArrow(current, prior) {
      if (current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) {
        return { label: '—', cls: '' };
      }
      const change = ((current - prior) / prior) * 100;
      const arrow = change >= 0 ? '▲' : '▼';
      return { label: `${arrow} ${Math.abs(change).toFixed(1)}% vs prior`, cls: change >= 0 ? 'is-up' : 'is-down' };
    }

    function rfBuildKpiCard(label, value, sub, opts) {
      const delta = sub ? sub : { label: '', cls: '' };
      const o = opts || {};
      const rag = o.rag || '';
      const target = o.target ? `<div class="rf-kpi-target">Target: ${o.target}</div>` : '';
      const ragChip = rag ? `<span class="rf-rag rf-rag-${rag}">${rag.toUpperCase()}</span>` : '';
      return `
        <div class="rf-kpi rf-kpi-rag-${rag}">
          <div class="rf-kpi-label">${label} ${ragChip}</div>
          <div class="rf-kpi-value">${value}</div>
          ${target}
          <div class="rf-kpi-delta ${delta.cls}">${delta.label}</div>
        </div>`;
    }

    function rfKpiBadge(kpiTarget, formatter) {
      if (!kpiTarget) return { target: '', rag: '' };
      const t = kpiTarget.target != null ? formatter(kpiTarget.target) : '';
      return { target: t, rag: kpiTarget.rag || '' };
    }

    function rfRenderKpis(kpis) {
      const host = document.getElementById('rf-kpi-grid');
      if (!host) return;
      const targets = (rfState.summary && rfState.summary.kpi_targets) || {};
      const ctr = kpis.ctr_28d_pct;
      const ctrPrior = kpis.ctr_prior_pct != null ? kpis.ctr_prior_pct * 100 : null;
      const pctFmt = (v) => rfFmtPct(v, v >= 1 ? 1 : 2);
      const moneyFmt = (v) => rfFmtMoney(v, kpis.revenue_currency || 'GBP');
      const ctrB = rfKpiBadge(targets.ctr_28d_pct, pctFmt);
      const mpB = rfKpiBadge(targets.money_page_click_share_pct, pctFmt);
      const enqB = rfKpiBadge(targets.enquiry_to_sale_pct, pctFmt);
      const csB = rfKpiBadge(targets.click_to_sale_pct, pctFmt);
      const rpB = rfKpiBadge(targets.revenue_per_1k_impressions, moneyFmt);
      const enqLabel = kpis.enquiry_to_sale_pct != null
        ? (rfFmtNum(kpis.money_page_enquiry_events_28d) + ' money-page enquiries → ' + rfFmtNum(kpis.transactions_28d) + ' sales')
        : (kpis.money_page_enquiry_events_28d == null ? 'Sync GA4 for money-page events' : 'Add revenue window');
      const cards = [
        rfBuildKpiCard('CTR (28d)', rfFmtPct(ctr, 2), rfDeltaArrow(ctr, ctrPrior), ctrB),
        rfBuildKpiCard('Money-page click share', rfFmtPct(kpis.money_page_click_share_pct, 1), { label: rfFmtNum(kpis.total_money_clicks_28d) + ' of ' + rfFmtNum(kpis.total_clicks_28d), cls: '' }, mpB),
        rfBuildKpiCard('Enquiry → Sale', kpis.enquiry_to_sale_pct == null ? '—' : rfFmtPct(kpis.enquiry_to_sale_pct, 2), { label: enqLabel, cls: '' }, enqB),
        rfBuildKpiCard('Click → Sale (GSC)', kpis.click_to_sale_pct == null ? 'Add revenue' : rfFmtPct(kpis.click_to_sale_pct, 2), { label: kpis.click_to_sale_pct == null ? 'No revenue entry yet' : 'All clicks baseline', cls: '' }, csB),
        rfBuildKpiCard('Revenue / 1k impressions', kpis.revenue_per_1k_impressions == null ? '—' : rfFmtMoney(kpis.revenue_per_1k_impressions, kpis.revenue_currency), { label: kpis.revenue_per_1k_impressions == null ? 'Add revenue below' : (kpis.revenue_currency || 'GBP'), cls: '' }, rpB)
      ];
      // Bonus: 28d revenue vs annual-target slice
      if (targets.rolling_28d_target) {
        const ragRev = targets.rolling_28d_rag || 'amber';
        const ragChip = `<span class="rf-rag rf-rag-${ragRev}">${ragRev.toUpperCase()}</span>`;
        cards.unshift(`
          <div class="rf-kpi rf-kpi-rag-${ragRev}" style="grid-column: span 4;">
            <div class="rf-kpi-label">Revenue (last 28d, vs annual target ÷ 365 × 28) ${ragChip}</div>
            <div class="rf-kpi-value">${rfFmtMoney(targets.rolling_28d_actual, kpis.revenue_currency || 'GBP')}
              <span style="font-size:0.9rem; color:#9ca3af; font-weight:600; margin-left:0.5rem;">/ ${rfFmtMoney(targets.rolling_28d_target, kpis.revenue_currency || 'GBP')}</span>
            </div>
            <div class="rf-kpi-delta">Annual target £${rfFmtNum(targets.annual_target)} from Booking Sheet 2026 (Workshops £30k + Courses £8k + 1-2-1/Services £10.4k + Hire £4.2k + Academy £8k)</div>
          </div>`);
      }
      host.innerHTML = cards.join('');
    }

    function rfRenderFunnel(funnel) {
      const host = document.getElementById('rf-funnel');
      if (!host) return;
      let prev = null;
      const cells = funnel.map(stage => {
        const value = stage.value;
        const empty = value == null;
        let dropoff = '';
        if (!empty && prev && prev > 0) {
          const pct = (1 - (value / prev)) * 100;
          if (pct >= 1) dropoff = `<div class="rf-stage-dropoff">−${pct.toFixed(1)}%</div>`;
        }
        if (!empty) prev = value;
        return `
          <div class="rf-funnel-stage ${empty ? 'is-empty' : ''}">
            <div class="rf-stage-name">${stage.stage}</div>
            <div class="rf-stage-value">${empty ? 'Awaiting data' : rfFmtNum(value)}</div>
            ${dropoff}
          </div>`;
      });
      host.innerHTML = cells.join('');
    }

    // -----------------------------------------------------------------
    // Generic sortable-table helper. Keeps each renderer simple by
    // delegating click handling + dataset sort state to a shared fn.
    // -----------------------------------------------------------------
    function rfSortRows(rows, key, dir) {
      const sign = dir === 'asc' ? 1 : -1;
      const sorted = rows.slice();
      sorted.sort((a, b) => {
        const av = a[key];
        const bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
        return String(av).localeCompare(String(bv)) * sign;
      });
      return sorted;
    }
    function rfUpdateSortIndicators(table, key, dir) {
      table.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('rf-sort-asc', 'rf-sort-desc');
        const ind = th.querySelector('.rf-sort-ind');
        if (ind) ind.textContent = '↕';
        if (th.getAttribute('data-sort') === key) {
          th.classList.add(dir === 'asc' ? 'rf-sort-asc' : 'rf-sort-desc');
          if (ind) ind.textContent = dir === 'asc' ? '↑' : '↓';
        }
      });
    }
    function rfBindSort(tableId, defaultKey, render) {
      const table = document.getElementById(tableId);
      if (!table || table.dataset.rfSortBound === '1') return;
      table.dataset.rfSortBound = '1';
      table.dataset.sortKey = defaultKey || '';
      table.dataset.sortDir = 'desc';
      table.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-sort');
          if (!key) return;
          if (table.dataset.sortKey === key) {
            table.dataset.sortDir = table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            table.dataset.sortKey = key;
            table.dataset.sortDir = 'desc';
          }
          render();
        });
      });
    }

    // Strip tracking params + protocol/host for display. Keeps the path
    // readable so the user can tell which page it is without clicking.
    function rfPrettyUrlPath(url) {
      if (!url) return '';
      return String(url)
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/[?&](srsltid|utm_[^=]+|gclid|fbclid|mc_eid|_gl)=[^&]*/gi, '')
        .replace(/[?&]+$/, '')
        .replace(/^\?/, '');
    }
    function rfPrettyUrlLabel(url) {
      const path = rfPrettyUrlPath(url).split('?')[0];
      if (!path || path === '/') return 'Home';
      const segs = path.replace(/^\/+|\/+$/g, '').split('/');
      const last = segs.at(-1) || '';
      const friendly = last.replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
      if (segs[0] === 'blog-on-photography') return `Blog – ${friendly}`;
      return friendly;
    }
    function rfPageCell(url) {
      if (!url) return '—';
      return `<div style="line-height:1.3;">
        <div style="font-weight:600;">${rfPrettyUrlLabel(url)}</div>
        <a class="rf-page-url" href="${url}" target="_blank" rel="noopener" style="font-size:0.72rem; color:#6b7280; word-break:break-all;">${rfPrettyUrlPath(url)}</a>
      </div>`;
    }

    function rfRenderLeakTable(rows) {
      const table = document.getElementById('rf-leak-table');
      const body = table ? table.querySelector('tbody') : null;
      if (!body) return;
      const list = rows || [];
      if (!list.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#6b7280;">No leaking pages found.</td></tr>'; return; }
      const key = table.dataset.sortKey || 'recoverable_clicks_28d';
      const dir = table.dataset.sortDir || 'desc';
      rfUpdateSortIndicators(table, key, dir);
      const sorted = rfSortRows(list, key, dir);
      body.innerHTML = sorted.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${rfPageCell(r.page_url)}</td>
          <td class="num">${rfFmtNum(r.impressions_28d)}</td>
          <td class="num">${rfFmtNum(r.clicks_28d)}</td>
          <td class="num">${rfFmtPct(r.ctr_28d_pct, 2)}</td>
          <td class="num">${r.position_28d != null ? r.position_28d.toFixed(1) : '—'}</td>
          <td class="num" style="color:#fca5a5; font-weight:700;">+${rfFmtNum(r.recoverable_clicks_28d)}</td>
        </tr>
      `).join('');
    }

    function rfTierPill(segment) {
      const s = String(segment || 'other').toLowerCase();
      const label = s.charAt(0).toUpperCase() + s.slice(1);
      return `<span class="rf-tier-pill rf-tier-${s}">${label}</span>`;
    }

    function rfRenderAiMap(items) {
      rfState.aiMap = items || [];
      const host = document.getElementById('rf-ai-summary');
      const counts = { overview_cited: 0, overview_uncited: 0, no_overview: 0 };
      rfState.aiMap.forEach(it => { counts[it.bucket] = (counts[it.bucket] || 0) + 1; });
      if (host) host.innerHTML = `
        <span class="rf-ai-bucket overview_cited">Cited in AI Overview: ${counts.overview_cited}</span>
        <span class="rf-ai-bucket overview_uncited">AI Overview steals click: ${counts.overview_uncited}</span>
        <span class="rf-ai-bucket no_overview">No AI Overview: ${counts.no_overview}</span>
      `;
      rfRedrawAiMap();
    }

    function rfAiMapFilters() {
      const q = (document.getElementById('rf-ai-filter')?.value || '').toLowerCase().trim();
      const bucket = document.getElementById('rf-ai-bucket-filter')?.value || '';
      const tier = document.getElementById('rf-ai-tier-filter')?.value || '';
      const moneyOnly = !!document.getElementById('rf-ai-money-only')?.checked;
      return { q, bucket, tier, moneyOnly };
    }

    function rfAiMapPasses(item, filters) {
      if (filters.bucket && item.bucket !== filters.bucket) return false;
      if (filters.tier && item.segment !== filters.tier) return false;
      if (filters.moneyOnly && !item.is_money_page) return false;
      if (filters.q) {
        const hay = (item.keyword + ' ' + (item.best_url || '')).toLowerCase();
        if (!hay.includes(filters.q)) return false;
      }
      return true;
    }

    function rfRedrawAiMap() {
      const table = document.getElementById('rf-ai-table');
      const body = table ? table.querySelector('tbody') : null;
      const countEl = document.getElementById('rf-ai-count');
      if (!body) return;
      const filters = rfAiMapFilters();
      const filtered = (rfState.aiMap || []).filter(it => rfAiMapPasses(it, filters));
      const key = table.dataset.sortKey || 'search_volume';
      const dir = table.dataset.sortDir || 'desc';
      rfUpdateSortIndicators(table, key, dir);
      const sorted = rfSortRows(filtered, key, dir).slice(0, 200);
      if (countEl) countEl.textContent = `${sorted.length} of ${(rfState.aiMap || []).length} keywords`;
      if (!sorted.length) { body.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#6b7280;">No keywords match.</td></tr>'; return; }
      body.innerHTML = sorted.map(it => {
        const cleanPath = it.clean_url || (it.best_url ? it.best_url.replace(/[?&](srsltid|utm_[^=]+|gclid|fbclid)=[^&]*/gi, '').replace(/^https?:\/\/[^/]+/, '') : '');
        const friendly = it.url_label || (cleanPath.split('/').filter(Boolean).pop() || 'Home').replace(/[-_]+/g, ' ');
        const urlCell = it.best_url
          ? `<div style="line-height:1.3;">
               <div style="font-weight:600; color:var(--dark-text);">${friendly}</div>
               <a class="rf-page-url" href="${it.best_url}" target="_blank" rel="noopener" style="font-size:0.72rem; color:#6b7280; word-break:break-all;">${cleanPath}</a>
             </div>${it.is_money_page ? ' <span class="rf-money-flag">£</span>' : ''}`
          : '—';
        return `
        <tr>
          <td>${it.keyword}</td>
          <td class="num">${it.rank != null ? it.rank : '—'}</td>
          <td class="num">${rfFmtNum(it.search_volume)}</td>
          <td>${rfTierPill(it.segment)}</td>
          <td><span class="rf-pagetype-pill">${it.page_type || 'Other'}</span></td>
          <td>${urlCell}</td>
          <td>${it.has_ai_overview ? 'Yes' : 'No'}</td>
          <td><span class="rf-ai-bucket ${it.bucket}">${it.bucket.replace('_', ' ')}</span></td>
        </tr>`;
      }).join('');
    }

    function rfFormatKpiTarget(p) {
      if (!p.primary_kpi) return 'No KPI set';
      const target = p.kpi_target_value;
      const dir = p.kpi_target_direction === 'down' ? '≤' : '≥';
      const label = String(p.primary_kpi).replace(/_/g, ' ');
      if (target == null) return label;
      return `${label} ${dir} ${target}`;
    }

    function rfPriorityActionButtons(p) {
      if (p.optimisation_task_id) {
        return `<a href="#optimisation" class="rf-btn rf-btn-secondary" style="text-decoration:none; display:inline-block;">Open task</a>
                <button type="button" class="rf-btn" data-rf-action="mark-done" data-id="${p.id}" ${p.status === 'done' ? 'disabled' : ''}>Mark done</button>`;
      }
      if (p.status === 'done') {
        return `<button type="button" class="rf-btn rf-btn-secondary" data-rf-action="reopen" data-id="${p.id}">Reopen</button>`;
      }
      return `<button type="button" class="rf-btn" data-rf-action="start" data-id="${p.id}">Start task</button>
              <button type="button" class="rf-btn rf-btn-secondary" data-rf-action="dismiss" data-id="${p.id}" title="Mark as cancelled">Skip</button>`;
    }

    function rfRenderPriorities(priorities) {
      const body = document.querySelector('#rf-priority-table tbody');
      if (!body) return;
      const filtered = rfState.showDone ? priorities : priorities.filter(p => p.status !== 'done' && p.status !== 'cancelled');
      if (!filtered.length) { body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8;">No priorities to show.</td></tr>'; return; }
      body.innerHTML = filtered.map((p, idx) => {
        const pages = (p.pages_affected || []).slice(0, 3).join(' · ');
        const more = (p.pages_affected || []).length > 3 ? ` (+${p.pages_affected.length - 3} more)` : '';
        const statusLabel = String(p.status).replace('_', ' ');
        return `
          <tr class="rf-priority-row" data-priority-id="${p.id}">
            <td>${idx + 1}</td>
            <td>
              <div class="rf-priority-title">${p.title}</div>
              ${p.description ? `<div class="rf-priority-desc">${p.description}</div>` : ''}
              ${pages ? `<div class="rf-priority-pages">${pages}${more}</div>` : ''}
            </td>
            <td>${rfFormatKpiTarget(p)}</td>
            <td>${p.estimated_lift || '—'}</td>
            <td><span class="rf-status-pill rf-status-${p.status}">${statusLabel}</span></td>
            <td>${rfPriorityActionButtons(p)}</td>
          </tr>
        `;
      }).join('');
    }

    function rfRenderEarning(rows) {
      rfState.earningPages = rows || [];
      rfRedrawEarning();
    }

    // -----------------------------------------------------------------
    // Money pages performance (per-tier roll-up)
    // -----------------------------------------------------------------
    function rfGpChip(tier) {
      const pct = tier.gross_profit_pct;
      if (pct == null) return '';
      const rag = tier.gross_profit_rag || 'unknown';
      const gp28 = tier.gross_profit_28d;
      const gp12 = tier.gross_profit_12m;
      const tip = `Gross-profit margin ${pct}% — keeps £${rfFmtNum(gp28 || 0)} of last-28d revenue and £${rfFmtNum(gp12 || 0)} of trailing 12-month revenue.`;
      return `<span class="rf-gp-chip rf-gp-${rag}" title="${tip}">GP ${pct}%</span>`;
    }
    function rfTierTile(tier) {
      const target = tier.monthly_target || 0;
      const potential = tier.revenue_potential_28d || 0;
      const actual28 = tier.revenue_actual_28d || 0;
      const actual12 = tier.revenue_actual_12m || 0;
      const targetCmp = Math.round(target * (28 / 30));
      const ratio = targetCmp > 0 ? actual28 / targetCmp : 0;
      const sign = ratio >= 1 ? 'ok' : 'bad';
      const ratioPct = (ratio * 100).toFixed(0);
      const rank = tier.best_rank_non_brand != null ? `#${tier.best_rank_non_brand}` : '—';
      const sv = rfFmtNum(tier.total_search_volume || 0);
      const vsPot = tier.actual_vs_potential_pct != null ? `${tier.actual_vs_potential_pct.toFixed(0)}% of potential` : '—';
      const gpChip = rfGpChip(tier);
      const gp28 = tier.gross_profit_28d;
      const gpLine = gp28 != null
        ? `<br/>↳ <strong>£${rfFmtNum(gp28)} gross profit kept</strong> @ ${tier.gross_profit_pct}% margin`
        : '';
      return `
        <div class="rf-tier-card rf-tier-card-gp-${tier.gross_profit_rag || 'unknown'}" data-tier="${tier.tier_id}">
          <div class="rf-tier-head">
            <div class="rf-tier-name">${tier.tier_label}</div>
            ${gpChip}
          </div>
          <div class="rf-tier-target">£${rfFmtNum(target)}/mo target · best rank ${rank} · SV ${sv}</div>
          <div class="rf-tier-potential">£${rfFmtNum(actual28)}</div>
          <div class="rf-tier-meta">
            28d actual revenue · 12mo £${rfFmtNum(actual12)}${gpLine}<br/>
            <span class="${sign}">${ratioPct}% of monthly target</span> · ${vsPot}<br/>
            potential 28d £${rfFmtNum(potential)} @ 1% conv · ${tier.clicks_28d} clicks · ${tier.page_count} pages
          </div>
        </div>`;
    }
    function rfMoneyPctOfTargetCell(pct) {
      if (pct == null) return '<td class="num">—</td>';
      const colour = pct >= 100 ? '#34d399' : (pct >= 70 ? '#facc15' : '#f87171');
      return `<td class="num" style="color:${colour}; font-weight:700;">${pct.toFixed(0)}%</td>`;
    }
    function rfBestRankCellHtml(t) {
      const r = t.best_rank_non_brand;
      if (r == null) {
        return '<span style="color:#6b7280;">—</span>';
      }
      const kw = t.best_rank_keyword || '';
      const kwShort = kw.length > 24 ? kw.slice(0, 22) + '…' : kw;
      const colour = r <= 3 ? '#34d399' : (r <= 10 ? '#facc15' : '#f87171');
      return `<div style="line-height:1.15;">
        <div style="color:${colour}; font-weight:700;">#${r}</div>
        <div style="font-size:0.7rem; color:#9ca3af; font-weight:400;">${kwShort}</div>
      </div>`;
    }
    function rfBestRankTooltip(t) {
      const curatedTotal = t.curated_keywords_total || 0;
      const missing = (t.curated_keywords_missing || []);
      const notRanking = (t.curated_keywords_not_ranking || []);
      const tracked = curatedTotal - missing.length;
      const parts = [];
      if (t.best_rank_non_brand != null) {
        parts.push(`Best curated keyword: "${t.best_rank_keyword || '(unknown)'}" at #${t.best_rank_non_brand}.`);
        if (t.median_rank != null && tracked > 1) {
          parts.push(`Median rank #${t.median_rank} across ${tracked} ranked curated keyword${tracked === 1 ? '' : 's'}.`);
        }
      } else if (curatedTotal === 0) {
        parts.push('No curated keywords defined for this tier yet — edit MONEY_PAGE_TIERS.keywords in api/aigeo/revenue-funnel-summary.js.');
      } else if (tracked === 0) {
        parts.push(`Curated list has ${curatedTotal} keyword${curatedTotal === 1 ? '' : 's'} but NONE are in keyword_rankings yet.`);
      } else {
        parts.push(`Curated keywords are tracked but none currently rank.`);
      }
      if (missing.length) {
        parts.push(`Missing from tracking: ${missing.map(s => '"' + s + '"').join(', ')}.`);
      }
      if (notRanking.length) {
        parts.push(`Tracked but not ranking: ${notRanking.map(s => '"' + s + '"').join(', ')}.`);
      }
      parts.push(`(${tracked}/${curatedTotal} curated keyword${curatedTotal === 1 ? '' : 's'} tracked.)`);
      return parts.join(' ');
    }
    function rfMoneyTableRow(t) {
      const aiMiss = t.ai_keywords_uncited > 0
        ? `<span style="color:#fca5a5; font-weight:600;">${t.ai_keywords_uncited}</span> / ${t.ai_keywords_total}`
        : (t.ai_keywords_total > 0 ? `0 / ${t.ai_keywords_total}` : '—');
      const bestRankTip = rfBestRankTooltip(t).replace(/"/g, '&quot;');
      return `
        <tr data-tier="${t.tier_id}">
          <td><a href="${t.hub_url}" target="_blank" rel="noopener" style="color:var(--dark-text); font-weight:700;">${t.tier_label}</a></td>
          <td>${t.page_count}</td>
          <td class="num">£${rfFmtNum(t.monthly_target)}</td>
          <td class="num" style="color:var(--dark-brand); font-weight:700;">£${rfFmtNum(t.revenue_actual_28d)}</td>
          <td class="num">£${rfFmtNum(t.revenue_actual_12m)}</td>
          ${rfMoneyPctOfTargetCell(t.actual_vs_target_28d_pct)}
          <td class="num" title="${bestRankTip}">${rfBestRankCellHtml(t)}</td>
          <td class="num">${rfFmtNum(t.total_search_volume)}</td>
          <td class="num">${rfFmtNum(t.impressions_28d)}</td>
          <td class="num">${rfFmtNum(t.clicks_28d)}</td>
          <td class="num">${rfFmtPct(t.ctr_28d_pct, 2)}</td>
          <td>${aiMiss}</td>
          <td class="num" style="color:#9ca3af;">£${rfFmtNum(t.revenue_potential_28d)}</td>
        </tr>`;
    }
    function rfRenderMoneyPages(tiers) {
      rfState.moneyPages = tiers || [];
      const grid = document.getElementById('rf-tier-grid');
      if (grid) grid.innerHTML = rfState.moneyPages.map(rfTierTile).join('');
      rfRedrawMoneyTable();
      // Click handler for tile-to-detail
      if (grid) {
        grid.querySelectorAll('.rf-tier-card').forEach(card => {
          card.addEventListener('click', () => {
            const id = card.getAttribute('data-tier');
            rfShowTierDetail(id);
            grid.querySelectorAll('.rf-tier-card').forEach(c => c.classList.toggle('is-active', c === card));
          });
        });
      }
    }
    function rfRedrawMoneyTable() {
      const table = document.getElementById('rf-money-table');
      const body = table ? table.querySelector('tbody') : null;
      if (!body) return;
      const rows = (rfState.moneyPages || []).slice();
      const key = table.dataset.sortKey || 'revenue_potential_28d';
      const dir = table.dataset.sortDir || 'desc';
      rfUpdateSortIndicators(table, key, dir);
      const sorted = rfSortRows(rows, key, dir);
      if (!sorted.length) { body.innerHTML = '<tr><td colspan="13" style="text-align:center; color:#6b7280;">No data.</td></tr>'; return; }
      body.innerHTML = sorted.map(rfMoneyTableRow).join('');
    }
    function rfBlockerRow(c) {
      const lift = c.estimated_lift ? `<div style="font-size:0.78rem; color:#9ca3af; margin-top:0.2rem;">${c.estimated_lift}</div>` : '';
      const pages = (c.pages_affected || []).map(rfPageCell).join('<br/>');
      return `<tr>
        <td style="vertical-align:top;"><strong>${c.title}</strong><br/><span style="font-size:0.8rem; color:var(--dark-text-muted);">${c.description}</span>${lift}</td>
        <td style="vertical-align:top; font-size:0.78rem;">${pages || '<span style="color:#6b7280;">—</span>'}</td>
      </tr>`;
    }
    function rfRenderTierBlockers(tierId) {
      const cands = (rfState.smartCandidates || []).filter(c => c.tier_id === tierId);
      if (!cands.length) return '<div style="font-size:0.78rem; color:#6b7280;">No major blockers detected for this tier from the live audit data.</div>';
      const rows = cands.map(rfBlockerRow).join('');
      return `
        <h5 style="margin:0 0 0.4rem; font-size:0.85rem; color:var(--dark-text);">Top blockers for this tier (auto-detected)</h5>
        <table class="rf-table" style="margin-bottom:0.8rem;">
          <thead><tr><th>What to do</th><th>Pages</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
    async function rfEnsureSmartCandidatesLoaded() {
      if (rfState.smartCandidates) return;
      try {
        const res = await fetch(rfApi('/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=' + encodeURIComponent(RF_PROPERTY)));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        rfState.smartCandidates = data.candidates || [];
      } catch (err) {
        rfState.smartCandidates = [];
      }
    }
    function rfShowTierDetail(tierId) {
      const host = document.getElementById('rf-tier-detail');
      if (!host) return;
      const tier = (rfState.moneyPages || []).find(t => t.tier_id === tierId);
      if (!tier) { host.innerHTML = ''; return; }
      const pageRows = (tier.pages || []).map(p => `
        <tr>
          <td>${rfPageCell(p.page_url)}</td>
          <td class="num">${rfFmtNum(p.impressions_28d)}</td>
          <td class="num">${rfFmtNum(p.clicks_28d)}</td>
          <td class="num">${rfFmtPct(p.ctr_28d_pct, 2)}</td>
          <td class="num">${p.position_28d != null ? p.position_28d.toFixed(1) : '—'}</td>
        </tr>`).join('');
      // Render synchronously with whatever blockers are cached, then trigger
      // a background load + re-render if we haven't fetched them yet.
      const blockersHtml = rfRenderTierBlockers(tierId);
      host.innerHTML = `
        <div style="background:#0b1118; border:1px solid var(--dark-border); border-radius:8px; padding:0.9rem 1rem;">
          <h4 style="margin:0 0 0.6rem;">${tier.tier_label} — top blockers and top pages</h4>
          ${blockersHtml}
          <h5 style="margin:0 0 0.4rem; font-size:0.85rem; color:var(--dark-text);">Top pages (last 28d GSC)</h5>
          <table class="rf-table" style="margin-top:0.2rem;">
            <thead><tr><th>Page</th><th class="num">Impressions</th><th class="num">Clicks</th><th class="num">CTR</th><th class="num">Pos</th></tr></thead>
            <tbody>${pageRows || '<tr><td colspan="5" style="text-align:center; color:#6b7280;">No pages in this tier had impressions in the last 28d.</td></tr>'}</tbody>
          </table>
        </div>`;
      if (!rfState.smartCandidates) {
        rfEnsureSmartCandidatesLoaded().then(() => {
          // Re-render only if the same tier is still selected
          const stillActive = document.querySelector(`.rf-tier-card[data-tier="${tierId}"].is-active`);
          if (stillActive) rfShowTierDetail(tierId);
        });
      }
    }

    function rfRedrawEarning() {
      const table = document.getElementById('rf-earning-table');
      const body = table ? table.querySelector('tbody') : null;
      if (!body) return;
      const moneyOnly = !!document.getElementById('rf-earn-money-only')?.checked;
      let rows = (rfState.earningPages || []).slice();
      if (moneyOnly) rows = rows.filter(r => r.is_money_page);
      const key = table.dataset.sortKey || 'clicks_28d';
      const dir = table.dataset.sortDir || 'desc';
      rfUpdateSortIndicators(table, key, dir);
      const sorted = rfSortRows(rows, key, dir);
      if (!sorted.length) { body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#6b7280;">No data.</td></tr>'; return; }
      body.innerHTML = sorted.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${rfPageCell(r.page_url)}</td>
          <td>${r.is_money_page ? '<span class="rf-money-flag">money</span>' : '<span class="rf-free-flag">free/info</span>'}</td>
          <td class="num">${rfFmtNum(r.clicks_28d)}</td>
          <td class="num">${rfFmtNum(r.impressions_28d)}</td>
          <td class="num">${rfFmtPct(r.ctr_28d_pct, 2)}</td>
        </tr>
      `).join('');
    }

    // -----------------------------------------------------------------
    // 12-month revenue history: KPI + sparkline + sortable table
    // -----------------------------------------------------------------
    const RF_MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function rfMonthLabel(period_start) {
      const [y, m] = period_start.split('-').map(Number);
      return `${RF_MONTH_LABELS[(m || 1) - 1]} ${String(y).slice(2)}`;
    }
    function rfBuildHistoryRows(history) {
      const rows = [];
      for (let i = 0; i < history.length; i += 1) {
        const cur = history[i];
        const prev = i > 0 ? history[i - 1] : null;
        const revenue = Number(cur.revenue_amount) || 0;
        const txn = Number(cur.transactions) || 0;
        const aov = txn > 0 ? revenue / txn : null;
        let mom = null;
        if (prev) {
          const prevRev = Number(prev.revenue_amount) || 0;
          if (prevRev > 0) mom = ((revenue - prevRev) / prevRev) * 100;
        }
        rows.push({
          month: rfMonthLabel(cur.period_start),
          month_sort: cur.period_start,
          revenue,
          target: cur.target != null ? Number(cur.target) : null,
          variance_pct: cur.variance_pct != null ? Number(cur.variance_pct) : null,
          is_partial: !!cur.is_partial,
          transactions: txn,
          aov,
          mom,
          currency: cur.currency || 'GBP'
        });
      }
      return rows;
    }

    // -----------------------------------------------------------------
    // Sparkline v2: proper SVG axes, year boundary marks, target line,
    // hover tooltips. ViewBox 720x180.
    // -----------------------------------------------------------------
    function rfSparkScale(history) {
      const values = history.map(r => Number(r.revenue_amount) || 0);
      const targets = history.map(r => Number(r.target) || 0).filter(v => v > 0);
      const max = Math.max(1, ...values, ...targets);
      return { max, min: 0 };
    }
    function rfSparkTickX(history, i, W, PAD_X) {
      const innerW = W - PAD_X * 2;
      return PAD_X + (history.length <= 1 ? innerW / 2 : (innerW * i) / (history.length - 1));
    }
    function rfSparkBuildAxes(svg, max, W, H, PAD_X, PAD_Y) {
      const yMax = PAD_Y;
      const yMin = H - PAD_Y;
      const yMid = (yMax + yMin) / 2;
      const lines = [];
      [yMin, yMid, yMax].forEach((y, idx) => {
        const v = idx === 0 ? 0 : (idx === 1 ? max / 2 : max);
        lines.push(`<line x1="${PAD_X}" y1="${y}" x2="${W - PAD_X}" y2="${y}" stroke="#1f2937" stroke-width="1" />`);
        lines.push(`<text x="${PAD_X - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="#6b7280">£${rfFmtNumShort(v)}</text>`);
      });
      return lines.join('');
    }
    function rfFmtNumShort(v) {
      if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
      return Math.round(v).toString();
    }
    function rfSparkBuildSeries(history, max, W, H, PAD_X, PAD_Y) {
      const yScale = (v) => PAD_Y + (H - PAD_Y * 2) - ((v - 0) / (max - 0 || 1)) * (H - PAD_Y * 2);
      const targetPath = history.map((r, i) => {
        const t = Number(r.target) || 0;
        return `${rfSparkTickX(history, i, W, PAD_X)},${yScale(t)}`;
      }).join(' ');
      const actualPoints = history.map((r, i) => ({
        x: rfSparkTickX(history, i, W, PAD_X),
        y: yScale(Number(r.revenue_amount) || 0),
        v: Number(r.revenue_amount) || 0,
        t: Number(r.target) || 0,
        label: rfMonthLabel(r.period_start),
        partial: !!r.is_partial
      }));
      return { targetPath, actualPoints };
    }
    const RF_HERO_DIMS = { W: 1200, H: 280, PAD_X: 70, PAD_Y: 34, FS_AXIS: 14, FS_LABEL: 13, R_DOT: 6, R_DOT_PARTIAL: 4 };
    function rfSparkBuildHeroAxes(max, dims) {
      const { W, H, PAD_X, PAD_Y, FS_AXIS } = dims;
      const yMax = PAD_Y;
      const yMin = H - PAD_Y;
      const yMid = (yMax + yMin) / 2;
      const lines = [];
      [yMin, yMid, yMax].forEach((y, idx) => {
        const v = idx === 0 ? 0 : (idx === 1 ? max / 2 : max);
        lines.push(`<line x1="${PAD_X}" y1="${y}" x2="${W - PAD_X}" y2="${y}" stroke="#1f2937" stroke-width="1" />`);
        lines.push(`<text x="${PAD_X - 8}" y="${y + 4}" text-anchor="end" font-size="${FS_AXIS}" fill="#94a3b8">£${rfFmtNumShort(v)}</text>`);
      });
      return lines.join('');
    }
    function rfSparkBuildMarkup(history) {
      if (!history.length) return '';
      const dims = RF_HERO_DIMS;
      const { W, H, PAD_X, PAD_Y, FS_LABEL, R_DOT, R_DOT_PARTIAL } = dims;
      const scale = rfSparkScale(history);
      const axes = rfSparkBuildHeroAxes(scale.max, dims);
      const { targetPath, actualPoints } = rfSparkBuildSeries(history, scale.max, W, H, PAD_X, PAD_Y);
      const actualPath = actualPoints.map(p => `${p.x},${p.y}`).join(' ');
      const labels = history.map((r, i) => {
        const x = rfSparkTickX(history, i, W, PAD_X);
        const lbl = rfMonthLabel(r.period_start);
        const isJan = lbl.startsWith('Jan');
        const cls = isJan ? 'font-weight:700; fill:#cbd5e1' : '';
        return `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="${FS_LABEL}" fill="#9ca3af" style="${cls}">${lbl}</text>` +
               (isJan && i > 0 ? `<line x1="${x}" y1="${PAD_Y}" x2="${x}" y2="${H - PAD_Y}" stroke="#374151" stroke-dasharray="3 3" stroke-width="1" />` : '');
      }).join('');
      const targetPoly = `<polyline points="${targetPath}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6 4" />`;
      const targetLabel = `<text x="${W - PAD_X - 6}" y="${PAD_Y - 8}" text-anchor="end" font-size="${FS_LABEL}" fill="#94a3b8">- - - monthly target</text>`;
      const actualArea = `<polygon points="${PAD_X},${H - PAD_Y} ${actualPath} ${W - PAD_X},${H - PAD_Y}" fill="rgba(245,158,11,0.15)" />`;
      const actualPoly = `<polyline points="${actualPath}" fill="none" stroke="#f59e0b" stroke-width="3" />`;
      const dots = actualPoints.map((p, i) => {
        const variancePct = p.t > 0 ? Math.round(((p.v - p.t) / p.t) * 100) : null;
        const varStr = variancePct == null ? '—' : `${variancePct >= 0 ? '+' : ''}${variancePct}%`;
        const partialNote = p.partial ? ' (partial month)' : '';
        const titleTxt = `${p.label}${partialNote}\nRevenue: £${Math.round(p.v).toLocaleString('en-GB')}\nTarget:  £${Math.round(p.t).toLocaleString('en-GB')}\nvs target: ${varStr}`;
        return `<circle data-i="${i}" class="rf-spark-dot" cx="${p.x}" cy="${p.y}" r="${p.partial ? R_DOT_PARTIAL : R_DOT}" fill="${p.partial ? '#6b7280' : '#f59e0b'}" stroke="#0b1118" stroke-width="2" style="cursor:pointer;"><title>${titleTxt}</title></circle>`;
      }).join('');
      const meta = JSON.stringify(actualPoints.map(p => ({ x: p.x, y: p.y, v: p.v, t: p.t, label: p.label, partial: p.partial })));
      return { svg: `${axes}${labels}${targetPoly}${actualArea}${actualPoly}${dots}${targetLabel}`, meta };
    }

    // -------------------------------------------------------------------
    // Per-tier mini sparklines (5 small charts under the hero)
    // -------------------------------------------------------------------
    const RF_TIER_SPARK_DIMS = { W: 200, H: 60, PAD_X: 4, PAD_Y: 6 };
    function rfTierSparkScale(points) {
      const vals = points.map(p => Number(p.revenue) || 0).filter(v => v > 0);
      const targets = points.map(p => Number(p.target) || 0).filter(v => v > 0);
      const max = Math.max(1, ...vals, ...targets);
      return max;
    }
    function rfTierSparkDotTitle(p) {
      const rev = Number(p.revenue) || 0;
      const tgt = Number(p.target) || 0;
      const variancePct = tgt > 0 ? Math.round(((rev - tgt) / tgt) * 100) : null;
      const varStr = variancePct == null ? '—' : `${variancePct >= 0 ? '+' : ''}${variancePct}%`;
      const partialNote = p.is_partial ? ' (partial)' : '';
      const monthLbl = p.month || rfMonthLabel(p.period_start) || '';
      return `${monthLbl}${partialNote}\nRevenue: £${Math.round(rev).toLocaleString('en-GB')}\nTarget:  £${Math.round(tgt).toLocaleString('en-GB')}\nvs target: ${varStr}`;
    }
    function rfTierSparkBuildSvg(points, dims) {
      const { W, H, PAD_X, PAD_Y } = dims;
      const max = rfTierSparkScale(points);
      const innerW = W - PAD_X * 2;
      const innerH = H - PAD_Y * 2;
      const x = (i) => PAD_X + (points.length <= 1 ? innerW / 2 : (innerW * i) / (points.length - 1));
      const y = (v) => PAD_Y + innerH - ((v - 0) / (max - 0 || 1)) * innerH;
      const targetY = points[0] ? y(Number(points[0].target) || 0) : PAD_Y + innerH;
      const targetLine = points[0] && points[0].target
        ? `<line x1="${PAD_X}" y1="${targetY}" x2="${W - PAD_X}" y2="${targetY}" stroke="#475569" stroke-dasharray="3 3" stroke-width="1" />`
        : '';
      const actualPts = points.map((p, i) => ({
        x: x(i),
        y: (Number(p.revenue) || 0) > 0 ? y(Number(p.revenue) || 0) : null,
        partial: !!p.is_partial,
        hasData: Number.isFinite(Number(p.revenue)),
        src: p
      }));
      const path = actualPts
        .filter(p => p.y !== null)
        .map(p => `${p.x},${p.y}`).join(' ');
      const area = path
        ? `<polygon points="${PAD_X},${H - PAD_Y} ${path} ${W - PAD_X},${H - PAD_Y}" fill="rgba(245,158,11,0.12)" />`
        : '';
      const poly = path ? `<polyline points="${path}" fill="none" stroke="#f59e0b" stroke-width="2" />` : '';
      const dots = actualPts
        .filter(p => p.y !== null)
        .map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.partial ? 2 : 2.5}" fill="${p.partial ? '#6b7280' : '#f59e0b'}" stroke="#0b1118" stroke-width="1" style="cursor:pointer;"><title>${rfTierSparkDotTitle(p.src)}</title></circle>`)
        .join('');
      return `${targetLine}${area}${poly}${dots}`;
    }
    function rfTierSparkLatestActual(points) {
      // Last closed-month (non-partial) value with data; falls back to last data point.
      for (let i = points.length - 1; i >= 0; i -= 1) {
        const p = points[i];
        if (!p.is_partial && Number.isFinite(Number(p.revenue))) return p;
      }
      for (let i = points.length - 1; i >= 0; i -= 1) {
        const p = points[i];
        if (Number.isFinite(Number(p.revenue))) return p;
      }
      return null;
    }
    function rfTierRagFromVariance(variancePct) {
      if (variancePct == null) return 'none';
      if (variancePct >= 0) return 'green';
      if (variancePct >= -25) return 'amber';
      return 'red';
    }
    function rfTierFmtVs(variancePct) {
      if (variancePct == null || !Number.isFinite(variancePct)) return '—';
      const sign = variancePct >= 0 ? '+' : '';
      return `${sign}${variancePct.toFixed(0)}%`;
    }
    function rfTierMonthLabelShort(monthStr) {
      if (!monthStr) return '';
      const parts = String(monthStr).split('-');
      if (parts.length < 2) return monthStr;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const yy = parts[0].slice(2);
      const mi = Number(parts[1]) - 1;
      return `${months[mi] || ''} ${yy}`;
    }
    function rfTierStatRow(label, actual, target, variancePct, tooltip) {
      const rag = rfTierRagFromVariance(variancePct);
      const vs = rfTierFmtVs(variancePct);
      const actualTxt = (actual == null || !Number.isFinite(actual)) ? '—' : `£${rfFmtNumShort(actual)}`;
      const targetTxt = (target == null || !Number.isFinite(target)) ? '' : `/ £${rfFmtNumShort(target)}`;
      const titleAttr = tooltip ? ` title="${tooltip.replace(/"/g, '&quot;')}"` : '';
      return `<div class="rf-tier-stat"${titleAttr}>
        <span class="rf-tier-stat-label">${label}</span>
        <span class="rf-tier-stat-numbers"><span class="rf-tier-stat-actual">${actualTxt}</span><span class="rf-tier-stat-target">${targetTxt}</span></span>
        <span class="rf-tier-stat-vs" data-rag="${rag}">${vs}</span>
      </div>`;
    }
    function rfSparkGpChip(series) {
      const pct = series.gross_profit_pct;
      if (pct == null) return '';
      const rag = series.gross_profit_rag || 'unknown';
      const gpYtd = series.ytd?.gross_profit_ytd_gbp;
      const annGp = series.ytd?.run_rate_annual_gp_gbp;
      const tip = `Gross-profit margin ${pct}%. YTD profit kept: £${rfFmtNum(gpYtd || 0)}.${annGp ? ` Projected annual profit at current pace: £${rfFmtNum(annGp)}.` : ''}`;
      return `<span class="rf-gp-chip rf-gp-${rag}" title="${tip}">${pct}% GP</span>`;
    }
    function rfTierSparkRender(card, series) {
      const points = Array.isArray(series.points) ? series.points : [];
      const hasAnyData = points.some(p => Number.isFinite(Number(p.revenue)));
      const targetTxt = series.monthly_target ? `£${rfFmtNumShort(series.monthly_target)}/mo target` : '';
      const gpChip = rfSparkGpChip(series);
      card.classList.toggle('rf-tier-spark-card-gp-red', series.gross_profit_rag === 'red');
      card.classList.toggle('rf-tier-spark-card-gp-amber', series.gross_profit_rag === 'amber');
      card.classList.toggle('rf-tier-spark-card-gp-green', series.gross_profit_rag === 'green');
      if (!points.length || !hasAnyData) {
        card.innerHTML = `
          <div class="rf-tier-spark-header">
            <span class="rf-tier-spark-label">${series.tier_label}${gpChip}</span>
            <span class="rf-tier-spark-target">${targetTxt}</span>
          </div>
          <div class="rf-tier-spark-empty">Sync Squarespace to see per-tier split</div>`;
        return;
      }
      const cm = series.current_month || null;
      const ytd = series.ytd || null;
      const cmLabel = cm ? `This month (${rfTierMonthLabelShort(cm.month)}${cm.is_partial ? ' so far' : ''})` : 'This month';
      const cmTooltip = cm
        ? `${rfTierMonthLabelShort(cm.month)}${cm.is_partial ? ' — partial month (target pro-rated by day-of-month)' : ' — full month'}\nActual: £${Math.round(cm.revenue_gbp).toLocaleString('en-GB')}\nTarget: £${Math.round(cm.target_gbp).toLocaleString('en-GB')}${cm.is_partial ? ` (full month £${Math.round(cm.target_full_gbp).toLocaleString('en-GB')})` : ''}\nvs target: ${rfTierFmtVs(cm.variance_pct)}`
        : '';
      const ytdLabel = ytd ? `YTD ${String(ytd.year).slice(2)}` : 'YTD';
      const ytdTooltip = ytd
        ? `Year-to-date ${ytd.year} (${ytd.months_with_data} month${ytd.months_with_data === 1 ? '' : 's'} with data)\nActual: £${Math.round(ytd.revenue_gbp).toLocaleString('en-GB')}\nPro-rated target: £${Math.round(ytd.target_prorata_gbp).toLocaleString('en-GB')}\nFull-year target: £${Math.round(ytd.target_full_year_gbp).toLocaleString('en-GB')}\nvs target: ${rfTierFmtVs(ytd.variance_pct)}${ytd.gross_profit_ytd_gbp != null ? `\nGross profit YTD: £${Math.round(ytd.gross_profit_ytd_gbp).toLocaleString('en-GB')} @ ${series.gross_profit_pct}% margin` : ''}`
        : '';
      const cmRow = cm ? rfTierStatRow(cmLabel, cm.revenue_gbp, cm.target_gbp, cm.variance_pct, cmTooltip) : '';
      const ytdRow = ytd ? rfTierStatRow(ytdLabel, ytd.revenue_gbp, ytd.target_prorata_gbp, ytd.variance_pct, ytdTooltip) : '';
      const svgBody = rfTierSparkBuildSvg(points, RF_TIER_SPARK_DIMS);
      card.innerHTML = `
        <div class="rf-tier-spark-header">
          <span class="rf-tier-spark-label">${series.tier_label}${gpChip}</span>
          <span class="rf-tier-spark-target">${targetTxt}</span>
        </div>
        <div class="rf-tier-stats">
          ${cmRow}
          ${ytdRow}
        </div>
        <svg class="rf-tier-spark-svg" viewBox="0 0 ${RF_TIER_SPARK_DIMS.W} ${RF_TIER_SPARK_DIMS.H}" preserveAspectRatio="none">${svgBody}</svg>`;
    }
    function rfRenderTierSparklines(tierHistory) {
      const grid = document.getElementById('rf-tier-spark-grid');
      if (!grid) return;
      const byId = new Map();
      (tierHistory || []).forEach(series => byId.set(series.tier_id, series));
      const cards = grid.querySelectorAll('.rf-tier-spark-card');
      cards.forEach(card => {
        const id = card.getAttribute('data-tier-id');
        const series = byId.get(id);
        if (!series) {
          card.innerHTML = '<div class="rf-tier-spark-empty">No data</div>';
          return;
        }
        rfTierSparkRender(card, series);
      });
    }

    // ----- Survival Cockpit (Phase B) ----------------------------------
    // Pivots the same tier_history payload that powers the per-tier
    // sparkline cards into a single compact table so the user can scan
    // all six revenue tiers' month-to-date and YTD performance in one
    // glance. Each row is clickable - clicking jumps the viewport to
    // the matching sparkline card so the user can drill into the trend.
    const RF_COCKPIT_TIER_ORDER = [
      'academy', 'courses', 'workshops_nonres', 'workshops_residential', 'services', 'hire'
    ];
    function rfCockpitProjectedMonthEnd(cm) {
      // Month-end projection from the pro-rated target. cm.target_gbp is
      // pro-rated by days elapsed, cm.target_full_gbp is the full-month
      // target. The ratio is (days_in_month / days_elapsed), so applying
      // it to revenue_gbp gives a same-pace month-end projection. If the
      // month has just started and target_gbp is 0, the ratio is
      // undefined - we fall back to leaving revenue as the projection.
      if (!cm || !Number.isFinite(Number(cm.revenue_gbp))) return null;
      const tgt = Number(cm.target_gbp) || 0;
      const tgtFull = Number(cm.target_full_gbp) || tgt;
      if (tgt > 0) return Number(cm.revenue_gbp) * (tgtFull / tgt);
      return Number(cm.revenue_gbp);
    }
    function rfCockpitRagFromProjected(projected, target) {
      if (!Number.isFinite(target) || target <= 0) return 'none';
      const ratio = projected / target;
      if (ratio >= 1.0) return 'green';
      if (ratio >= 0.7) return 'amber';
      return 'red';
    }
    function rfCockpitTrend(points) {
      // Compare the latest (partial or full) month to the previous full
      // month. Up if >+5%, down if <-5%, flat otherwise. Bails out if
      // there are fewer than two months of data.
      if (!Array.isArray(points) || points.length < 2) return 'flat';
      const last = points[points.length - 1];
      const prev = points[points.length - 2];
      const lastRev = Number(last && last.revenue);
      const prevRev = Number(prev && prev.revenue);
      if (!Number.isFinite(lastRev) || !Number.isFinite(prevRev) || prevRev <= 0) return 'flat';
      const delta = (lastRev - prevRev) / prevRev;
      if (delta > 0.05) return 'up';
      if (delta < -0.05) return 'down';
      return 'flat';
    }
    function rfCockpitFmtGbp(v) {
      if (!Number.isFinite(Number(v))) return '\u2014';
      const n = Number(v);
      if (n >= 10000) return '£' + Math.round(n / 1000) + 'k';
      return '£' + rfFmtNum(Math.round(n));
    }
    function rfCockpitFmtPct(v) {
      if (!Number.isFinite(Number(v))) return '\u2014';
      const n = Number(v);
      const sign = n > 0 ? '+' : '';
      return sign + n.toFixed(0) + '%';
    }
    function rfCockpitVsClass(pct) {
      if (!Number.isFinite(Number(pct))) return '';
      if (pct >= 0)   return 'is-good';
      if (pct >= -10) return 'is-warn';
      return 'is-bad';
    }
    function rfCockpitRowHtml(series) {
      const cm  = series.current_month || null;
      const ytd = series.ytd || null;
      const mtd       = cm ? Number(cm.revenue_gbp) : null;
      const projected = rfCockpitProjectedMonthEnd(cm);
      const target    = cm ? Number(cm.target_full_gbp) : null;
      const ytdRev    = ytd ? Number(ytd.revenue_gbp) : null;
      const ytdTgt    = ytd ? Number(ytd.target_prorata_gbp) : null;
      const ytdVar    = ytd ? Number(ytd.variance_pct) : null;
      const rag       = rfCockpitRagFromProjected(projected, target);
      const trend     = rfCockpitTrend(series.points);
      const gpPct     = Number(series.gross_profit_pct);
      const gpYtd     = ytd ? Number(ytd.gross_profit_ytd_gbp) : null;
      const gpCell    = Number.isFinite(gpYtd)
        ? `${rfCockpitFmtGbp(gpYtd)} <span style="color:#94a3b8; font-size:0.72rem;">@ ${Number.isFinite(gpPct) ? gpPct.toFixed(0) : '?'}%</span>`
        : (Number.isFinite(gpPct) ? `<span style="color:#94a3b8;">@ ${gpPct.toFixed(0)}%</span>` : '\u2014');
      const trendIcon = trend === 'up' ? '\u2191' : (trend === 'down' ? '\u2193' : '\u2192');
      const trendTitle = trend === 'up' ? 'This month outpacing previous month (>+5%)'
                       : trend === 'down' ? 'This month behind previous month (<-5%)'
                       : 'This month within \u00b15% of previous month';
      return `<tr data-tier="${series.tier_id}" title="Click to scroll to ${series.tier_label} tier card below">
        <td>
          <span class="rf-survival-tier">${series.tier_label}</span>
          <span class="rf-survival-tier-sub">${series.gross_profit_pct || '?'}% GP \u00b7 ${series.tier_id}</span>
        </td>
        <td class="num">${rfCockpitFmtGbp(mtd)}</td>
        <td class="num">${rfCockpitFmtGbp(projected)}</td>
        <td class="num">${rfCockpitFmtGbp(target)}</td>
        <td class="rag-col"><span class="rf-survival-rag is-${rag}" title="Projected/target ratio: ${target ? ((projected / target) * 100).toFixed(0) + '%' : 'n/a'}"></span></td>
        <td class="trend-col"><span class="rf-survival-trend is-${trend}" title="${trendTitle}">${trendIcon}</span></td>
        <td class="num">${rfCockpitFmtGbp(ytdRev)}</td>
        <td class="num">${rfCockpitFmtGbp(ytdTgt)}</td>
        <td class="num"><span class="rf-survival-vs ${rfCockpitVsClass(ytdVar)}">${rfCockpitFmtPct(ytdVar)}</span></td>
        <td class="num">${gpCell}</td>
      </tr>`;
    }
    function rfRenderSurvivalCockpit(tierHistory) {
      const host = document.getElementById('rf-survival-cockpit');
      const tbody = document.getElementById('rf-survival-tbody');
      const tfoot = document.getElementById('rf-survival-tfoot');
      const foot  = document.getElementById('rf-survival-foot');
      if (!host || !tbody) return;
      if (!Array.isArray(tierHistory) || !tierHistory.length) {
        host.style.display = 'none';
        return;
      }
      // Restrict to commercial tiers + preserve a stable order so the
      // user always sees them in the same sequence. "Unidentified" is
      // skipped here - it's a safety net for the cards, not part of the
      // survival picture.
      const byId = new Map();
      for (const s of tierHistory) byId.set(s.tier_id, s);
      const rows = RF_COCKPIT_TIER_ORDER
        .map(id => byId.get(id))
        .filter(Boolean);
      if (!rows.length) {
        host.style.display = 'none';
        return;
      }
      host.style.display = '';
      tbody.innerHTML = rows.map(rfCockpitRowHtml).join('');

      // Totals row - sum MTD, projected, target, YTD, YTD target across
      // visible commercial tiers. RAG/trend cells are blank in the
      // total because they don't aggregate cleanly.
      let mtdT = 0, projT = 0, tgtT = 0, ytdT = 0, ytdTgtT = 0, gpYtdT = 0;
      for (const s of rows) {
        const cm = s.current_month;
        const yt = s.ytd;
        if (cm) {
          mtdT  += Number(cm.revenue_gbp) || 0;
          projT += rfCockpitProjectedMonthEnd(cm) || 0;
          tgtT  += Number(cm.target_full_gbp) || 0;
        }
        if (yt) {
          ytdT    += Number(yt.revenue_gbp) || 0;
          ytdTgtT += Number(yt.target_prorata_gbp) || 0;
          gpYtdT  += Number(yt.gross_profit_ytd_gbp) || 0;
        }
      }
      const ytdVarT = ytdTgtT > 0 ? ((ytdT - ytdTgtT) / ytdTgtT) * 100 : null;
      if (tfoot) {
        tfoot.innerHTML = `<tr>
          <td>Total (commercial tiers)</td>
          <td class="num">${rfCockpitFmtGbp(mtdT)}</td>
          <td class="num">${rfCockpitFmtGbp(projT)}</td>
          <td class="num">${rfCockpitFmtGbp(tgtT)}</td>
          <td class="rag-col"><span class="rf-survival-rag is-${rfCockpitRagFromProjected(projT, tgtT)}"></span></td>
          <td class="trend-col"></td>
          <td class="num">${rfCockpitFmtGbp(ytdT)}</td>
          <td class="num">${rfCockpitFmtGbp(ytdTgtT)}</td>
          <td class="num"><span class="rf-survival-vs ${rfCockpitVsClass(ytdVarT)}">${rfCockpitFmtPct(ytdVarT)}</span></td>
          <td class="num">${rfCockpitFmtGbp(gpYtdT)}</td>
        </tr>`;
      }
      if (foot) {
        const monthGap = Math.max(0, tgtT - projT);
        const gapTxt = monthGap > 0
          ? `<strong style="color:#fca5a5;">\u2212£${rfFmtNum(Math.round(monthGap))}</strong> short of monthly target at current pace`
          : `<strong style="color:#4ade80;">+£${rfFmtNum(Math.round(-monthGap))}</strong> ahead of monthly target at current pace`;
        foot.innerHTML = gapTxt;
      }

      // Row click handler: scroll to the matching sparkline card below.
      tbody.querySelectorAll('tr[data-tier]').forEach(tr => {
        tr.addEventListener('click', () => {
          const id = tr.getAttribute('data-tier');
          const card = document.querySelector(`.rf-tier-spark-card[data-tier-id="${id}"]`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
    }

    // ----- Profit Pyramid renderer --------------------------------------
    // Maps the API's profit_pyramid block into a stacked bar (share of
    // annualised profit by tier) + a per-tier table. Bar is sorted by
    // size, table is sorted by GP £ descending; the "GP-Rev gap" column
    // colour-codes which tiers earn more of the profit than their share
    // of revenue (green) vs which are revenue vanity (red).
    //
    // Each tier also carries a strategic ROLE — not the same as GP RAG.
    // The role explains WHY the tier exists in the business mix, sourced
    // from Alan's own brain-dump on 18 May 2026:
    //  - retention:  low margin but high lifetime value (residential)
    //  - workhorse:  high margin, low effort, scalable (nonres, courses)
    //  - high-margin-time: pure time-for-money, near-zero overhead (1-2-1)
    //  - passive-broken: hardest work done, conversion bottleneck (academy)
    //  - sporadic:   high per-gig but no reliable pipeline (hire/commercial)
    const RF_TIER_ROLE = {
      workshops_residential: { id: 'retention', label: 'Retention engine', tip: 'Low margin (35%) and a real time-drain — 1+ day to plan a 2-3 day trip — but excellent service generates repeat business and long-term clients. Treat as a loss-leader for LTV, not a primary profit source.' },
      workshops_nonres:      { id: 'workhorse', label: 'Workhorse', tip: 'High margin (75%), small prep (repeat locations you know well). Just travel + time. This is your most efficient direct-revenue tier.' },
      courses:               { id: 'workhorse', label: 'Workhorse', tip: 'High margin (90%), home-based, repeat curriculum. Easy to deliver if you can get bookings.' },
      services:              { id: 'workhorse', label: 'High-margin time', tip: '1-2-1 + mentoring + Zoom editing sessions = pure time-for-money. At-home delivery, near-zero overhead, ~95% GP. Most scalable for hours-you-have-anyway.' },
      academy:               { id: 'broken',    label: 'Conversion bottleneck', tip: '99% GP and 190 articles already written — should be the easiest profit but conversion is broken. Trial → paid is not working despite shortened 14-day trial and email follow-ups. Highest-priority experiment area.' },
      hire:                  { id: 'sporadic',  label: 'Sporadic but valuable', tip: '90-99% GP — well paid because it is time-focused, low overhead — but pipeline is unreliable. Product/hire-me + corporate training pushed but limited regular income.' }
    };
    function rfTierRoleBadge(tierId) {
      const role = RF_TIER_ROLE[tierId];
      if (!role) return '';
      return `<span class="rf-tier-role rf-tier-role-${role.id}" title="${role.tip}">${role.label}</span>`;
    }
    function rfPyramidBarColour(rag) {
      if (rag === 'green') return '#34d399';
      if (rag === 'amber') return '#fbbf24';
      if (rag === 'red') return '#f87171';
      return '#6b7280';
    }
    function rfPyramidGoalMarkup(p) {
      const lowMo = p.monthly_gp_target_low_gbp || 4000;
      const annLow = p.annual_gp_target_low_gbp || 48000;
      const annHi = p.annual_gp_target_high_gbp || 60000;
      const totalGp = p.annualised_gp_total_gbp || 0;
      const moRun = totalGp / 12;
      const progress = annLow > 0 ? Math.round((totalGp / annLow) * 100) : 0;
      const shortBy = Math.max(0, annLow - totalGp);
      const rag = progress >= 100 ? 'green' : (progress >= 70 ? 'amber' : 'red');
      const colour = rfPyramidBarColour(rag);
      return `<div>Annualised profit pace: <strong style="color:${colour};">£${rfFmtNum(Math.round(totalGp))}</strong> <span style="color:#9ca3af;">(£${rfFmtNum(Math.round(moRun))}/mo)</span> · target <strong>£${rfFmtNum(annLow)}–£${rfFmtNum(annHi)}/yr</strong> <span style="color:#9ca3af;">(£${rfFmtNum(lowMo)}/mo+)</span>.<br/>Progress vs £${rfFmtNum(annLow)}: <strong style="color:${colour};">${progress}%</strong>${shortBy > 0 ? ` <span style="color:#9ca3af;">— short by</span> <strong>£${rfFmtNum(Math.round(shortBy))}/yr</strong>` : ' <span style="color:#34d399;">— on track</span>'}.</div>`;
    }
    function rfPyramidShortLabel(tierLabel) {
      const s = String(tierLabel || '');
      if (/residential/i.test(s)) return 'Res W/shops';
      if (/non-?res/i.test(s)) return 'Non-Res';
      if (/courses/i.test(s)) return 'Courses';
      if (/academy/i.test(s)) return 'Academy';
      if (/hire|commercial/i.test(s)) return 'Hire';
      if (/services|1-2-1|service/i.test(s)) return '1-2-1';
      return s.split(' ')[0];
    }
    function rfPyramidBarSegments(rows, total) {
      if (!total || total <= 0) return '';
      return rows.map(r => {
        const pct = (r.annualised_gp_gbp / total) * 100;
        if (pct <= 0) return '';
        const w = pct.toFixed(2);
        const bg = rfPyramidBarColour(r.gross_profit_rag);
        const short = rfPyramidShortLabel(r.tier_label);
        // Only show inline text if the segment is wide enough to fit it
        // without truncation (≥ 10% of bar). Smaller segments rely on
        // the tooltip + table beneath.
        const label = pct >= 10 ? `${short} ${Math.round(pct)}%` : (pct >= 6 ? `${Math.round(pct)}%` : '');
        return `<div class="rf-pyramid-bar-seg" style="width:${w}%; background:${bg};" title="${r.tier_label} — £${rfFmtNum(Math.round(r.annualised_gp_gbp))}/yr profit (${pct.toFixed(1)}% of total profit)">${label}</div>`;
      }).join('');
    }
    function rfPyramidTableRows(rows) {
      return rows.map(r => {
        const gap = r.share_gap_pp;
        const gapCls = gap > 0 ? 'rf-pyramid-row-gap-pos' : (gap < 0 ? 'rf-pyramid-row-gap-neg' : '');
        const gapTxt = `${gap > 0 ? '+' : ''}${gap.toFixed(1)} pp`;
        const gpChip = `<span class="rf-gp-chip rf-gp-${r.gross_profit_rag}">${r.gross_profit_pct}%</span>`;
        const roleBadge = rfTierRoleBadge(r.tier_id);
        return `<tr>
          <td class="tier-name">${r.tier_label}${roleBadge}</td>
          <td class="num">${gpChip}</td>
          <td class="num">£${rfFmtNum(Math.round(r.ytd_revenue_gbp))}</td>
          <td class="num">£${rfFmtNum(Math.round(r.ytd_gp_gbp))}</td>
          <td class="num">£${rfFmtNum(Math.round(r.annualised_revenue_gbp || 0))}</td>
          <td class="num"><strong style="color:var(--dark-brand);">£${rfFmtNum(Math.round(r.annualised_gp_gbp))}</strong></td>
          <td class="num">${r.share_of_gp_pct.toFixed(1)}%</td>
          <td class="num ${gapCls}">${gapTxt}</td>
        </tr>`;
      }).join('');
    }
    function rfPyramidTotalsRow(rows, p) {
      const ytdRev = rows.reduce((a, b) => a + (b.ytd_revenue_gbp || 0), 0);
      const ytdGp = rows.reduce((a, b) => a + (b.ytd_gp_gbp || 0), 0);
      const annRev = (p && p.annualised_revenue_total_gbp != null)
        ? p.annualised_revenue_total_gbp
        : rows.reduce((a, b) => a + (b.annualised_revenue_gbp || 0), 0);
      const annGp = (p && p.annualised_gp_total_gbp != null)
        ? p.annualised_gp_total_gbp
        : rows.reduce((a, b) => a + (b.annualised_gp_gbp || 0), 0);
      const blendedGp = ytdRev > 0 ? Math.round((ytdGp / ytdRev) * 100) : 0;
      const shareSum = Math.round(rows.reduce((a, b) => a + (b.share_of_gp_pct || 0), 0) * 10) / 10;
      const gapSum = Math.round(rows.reduce((a, b) => a + (b.share_gap_pp || 0), 0) * 10) / 10;
      return `<tr class="rf-pyramid-totals">
        <td class="tier-name"><strong>TOTAL (all tiers)</strong></td>
        <td class="num" title="Business-wide blended GP% = sum(YTD GP) / sum(YTD Rev). Useful sanity check vs the individual tier GP%s above.">
          <span class="rf-gp-chip rf-gp-${blendedGp >= 70 ? 'green' : (blendedGp >= 50 ? 'amber' : 'red')}">${blendedGp}%</span>
        </td>
        <td class="num"><strong>£${rfFmtNum(Math.round(ytdRev))}</strong></td>
        <td class="num"><strong>£${rfFmtNum(Math.round(ytdGp))}</strong></td>
        <td class="num"><strong>£${rfFmtNum(Math.round(annRev))}</strong></td>
        <td class="num"><strong style="color:var(--dark-brand);">£${rfFmtNum(Math.round(annGp))}</strong></td>
        <td class="num"><strong>${shareSum.toFixed(1)}%</strong></td>
        <td class="num"><strong>${gapSum > 0 ? '+' : ''}${gapSum.toFixed(1)} pp</strong></td>
      </tr>`;
    }
    // ----- Top 3 Actions hero card -------------------------------------
    // Pulls the GP-weighted smart-priorities queue (already sorted by
    // estimated_lift_gbp_profit DESC by the API) and renders the top 3
    // candidates that have a non-zero profit lift. Cards expand on click
    // to show the description, target pages, and which KPI we're moving.
    const RF_TIER_LABELS = {
      academy: 'Academy',
      services: '1-2-1 / Services',
      courses: 'Courses',
      hire: 'Hire / Commissions',
      workshops: 'Workshops',
      workshops_residential: 'Residential Workshops',
      workshops_nonres: 'Non-Res Workshops'
    };
    function rfActionTierBadge(tierId) {
      const cls = `rf-action-tier-${tierId}`;
      const label = RF_TIER_LABELS[tierId] || tierId;
      return `<span class="rf-action-tier-badge ${cls}">${label}</span>`;
    }
    function rfActionGpPct(tierId) {
      const gp = ({ academy: 99, hire: 92, courses: 90, services: 78, workshops_nonres: 75, workshops: 55, workshops_residential: 35 })[tierId];
      return gp != null ? `${gp}% GP` : '';
    }
    // Phase C: effort meter rendered below the lift row on each Top 3
    // card. Returns "" when no effort data is present so older
    // candidates (or future tiers without an effort heuristic) stay
    // visually clean.
    function rfActionEffortClass(annualLiftPerHour) {
      // Annual lift-per-hour is the right "yes/no" signal here: an
      // action that buys £6k/yr GP for 4 hours is great, one that buys
      // £600/yr for the same 4h is meh. Thresholds set against Alan's
      // £100/hr time-value floor.
      if (!Number.isFinite(annualLiftPerHour)) return '';
      if (annualLiftPerHour >= 2000) return 'rf-action-effort-hi';
      if (annualLiftPerHour >= 500)  return 'rf-action-effort-warn';
      return 'rf-action-effort-low';
    }
    // Lever-aware KPI evidence formatter for Revenue Funnel cards.
    // Mirrors the Auto-Optimise leverKpiHtml so both surfaces show the
    // same nice formatting (CTR -> "1.38% -> 2.07%", rank -> "#6 -> #3")
    // rather than the raw float that the picker stores in
    // kpi_baseline_value / kpi_target_value.
    function rfActionKpiEvidence(c) {
      const lever = c.lever_id;
      const base  = Number(c.kpi_baseline_value);
      const tgt   = Number(c.kpi_target_value);
      if (lever === 'ctr' && Number.isFinite(base) && Number.isFinite(tgt)) {
        return '<strong>CTR ' + base.toFixed(2) + '%</strong> &rarr; <strong>' + tgt.toFixed(2) + '%</strong>';
      }
      if (lever === 'rank' && Number.isFinite(base) && Number.isFinite(tgt)) {
        return '<strong>Rank #' + Math.round(base) + '</strong> &rarr; <strong>#' + Math.round(tgt) + '</strong>';
      }
      if (lever === 'aio') return '<strong>Capture an AI Overview citation</strong>';
      if (lever === 'schema') return '<strong>Add missing JSON-LD schema</strong>';
      if (lever === 'surfacing') return '<strong>Surface orphan product into hub nav</strong>';
      if (lever === 'conversion') return '<strong>Improve trial-to-paid conversion</strong>';
      if (c.primary_kpi && Number.isFinite(base) && Number.isFinite(tgt)) {
        const fmt = (v) => Math.abs(v) < 10 ? v.toFixed(2) : Math.round(v);
        return '<strong>' + String(c.primary_kpi).replace(/</g, '&lt;') + ' ' + fmt(base) + '</strong> &rarr; <strong>' + fmt(tgt) + '</strong>';
      }
      return '';
    }

    // 2026-05-20 phase H+: suppression pill - shows on cards whose URL
    // already has an active monitoring cycle for the matching KPI.
    // Blocks the user from being told to re-rewrite a title they
    // already changed last month.
    function rfSuppressionPill(c) {
      const s = c.suppression;
      if (!s || !s.note) return '';
      const path = (Array.isArray(c.pages_affected) ? c.pages_affected[0] : '')
        .replace(/^https?:\/\/[^/]+/i, '').replace(/\/$/, '') || '/';
      const delta = (rfState.trustDeltas || {})[path];
      const working = delta && delta.improved;
      const cls = working
        ? 'rf-supp-working'
        : (s.severity === 'block'
          ? 'rf-supp-block'
          : (s.severity === 'stale' ? 'rf-supp-stale' : 'rf-supp-down'));
      const label = working
        ? 'CHANGE IS WORKING'
        : (s.severity === 'block'
          ? 'ALREADY IN MONITORING'
          : (s.severity === 'stale' ? 'STALLED - TRY ANOTHER ANGLE' : 'STILL IN MONITORING'));
      let deltaLine = '';
      if (delta && (delta.ctr_delta_pp != null || delta.clicks_delta != null)) {
        const bits = [];
        if (delta.ctr_delta_pp != null) bits.push('CTR ' + (delta.ctr_delta_pp >= 0 ? '+' : '') + delta.ctr_delta_pp + 'pp since change');
        if (delta.clicks_delta != null) bits.push('clicks ' + (delta.clicks_delta >= 0 ? '+' : '') + delta.clicks_delta);
        if (delta.days_running != null) bits.push(delta.days_running + 'd in monitoring');
        deltaLine = '<span class="rf-supp-note">' + bits.join(' · ') + '</span>';
      }
      const note = working
        ? (deltaLine || '<span class="rf-supp-note">Metrics improved since your last change — hold steady and let attribution run.</span>')
        : ('<span class="rf-supp-note">' + String(s.note).replace(/</g, '&lt;') + '</span>' + (deltaLine ? deltaLine : ''));
      return ''
        + '<div class="rf-action-suppression ' + cls + '">'
        +   '<span class="rf-supp-label">' + label + '</span>'
        +   note
        + '</div>';
    }

    // 2026-05-20 phase H+: seasonality pill - shows the per-tier band
    // for the current calendar month so the user can see at a glance
    // whether the projected lift on this card is being scaled by a
    // peak (factor>1.0) or gap (factor<1.0) month.
    function rfSeasonalityPill(c) {
      if (c.seasonality_factor == null) return '';
      const band = c.seasonality_band || 'steady';
      const f = Number(c.seasonality_factor);
      if (band === 'steady') return '';
      const cls = 'rf-season-' + band;
      const sign = f >= 1 ? '+' : '';
      const pct = Math.round((f - 1) * 100);
      const title = 'Seasonality factor for this tier in the current month: x' + f.toFixed(2);
      return '<span class="rf-action-season ' + cls + '" title="' + title + '">SEASON ' + sign + pct + '%</span>';
    }

    // 2026-05-20 phase H: surfaces the modelling honesty line under the
    // big-number lift box. The user (correctly) challenged whether
    // changing a handful of page titles really delivers thousands a
    // year in GP. The answer depends on the lever and the data quality
    // of the inputs - we surface that here so it's obvious which
    // estimates are data-grounded vs industry-curve assumed.
    function rfLiftBasisLine(c) {
      const lever = c.lever_id;
      const liveTag = c.live_data_source === 'live'
        ? '<span class="rf-basis-tag is-live" title="Live HTML pulled from this URL just now">LIVE</span>'
        : '<span class="rf-basis-tag is-audit" title="Falling back to last audit row - live fetch failed or skipped">AUDIT</span>';
      let basis = '';
      if (lever === 'ctr') {
        basis = 'Modelled from <strong>this URL\'s actual 28d clicks &times; the CTR uplift target</strong> &times; the tier AOV &times; GP%. Real CTR lift depends on whether the new title matches the live SERP intent better than the current one.';
      } else if (lever === 'rank') {
        basis = 'Modelled from <strong>this keyword\'s actual search volume</strong> &times; the industry CTR-by-position curve &times; the tier AOV &times; GP%. Real lift depends on whether you can actually pass the page-1 competitors on this query.';
      } else if (lever === 'aio') {
        basis = 'Modelled at <strong>3% of the AIO query volume</strong> as a successful-citation click capture &times; the tier AOV &times; GP%. Citation is binary: you either win the AIO slot or you don\'t.';
      } else if (lever === 'schema') {
        basis = 'Schema gaps unlock SERP rich results but the click lift is qualitative, not a fixed &pound;-formula. Numbers reflect the typical 5-15% CTR uplift from FAQ/Review snippets.';
      } else {
        basis = 'Lift modelled from per-lever rule-of-thumb. Validate against your booking data over the first 6 weeks.';
      }
      return '<div class="rf-action-basis">' + liveTag + '<span class="rf-basis-text">' + basis + '</span></div>';
    }

    // 2026-05-20 phase H: renders the per-candidate, page-aware action
    // plan that the picker now emits (was a single hardcoded "Rewrite
    // title + meta description" line for every CTR card). Each item has
    // a step number, an effort estimate, a confidence pill, a one-line
    // headline and a detail paragraph. Empty array -> empty string so
    // the caller can fall back to legacy effort_label.
    function rfActionPlanMarkup(c) {
      const actions = Array.isArray(c.recommended_actions) ? c.recommended_actions : [];
      if (actions.length === 0) return '';
      const items = actions.map(a => {
        const confClass = a.confidence === 'high'
          ? 'rf-conf-high'
          : (a.confidence === 'medium' ? 'rf-conf-med' : 'rf-conf-low');
        const effort = (a.effort_hours != null) ? (a.effort_hours + 'h') : '';
        return ''
          + '<li class="rf-plan-item">'
          + '<div class="rf-plan-item-head">'
          +   '<span class="rf-plan-step">' + (a.step || '') + '</span>'
          +   '<span class="rf-plan-headline">' + String(a.headline || '').replace(/</g, '&lt;') + '</span>'
          +   '<span class="rf-plan-meta">'
          +     (effort ? '<span class="rf-plan-effort" title="Estimated hands-on hours">' + effort + '</span>' : '')
          +     '<span class="rf-plan-conf ' + confClass + '" title="Confidence based on data quality">' + String(a.confidence || '').toUpperCase() + '</span>'
          +   '</span>'
          + '</div>'
          + (a.detail ? '<div class="rf-plan-detail">' + String(a.detail).replace(/</g, '&lt;') + '</div>' : '')
          + '</li>';
      }).join('');
      return '<div class="rf-plan-head-row"><span class="rf-plan-title">Do this, in order:</span></div><ol class="rf-plan-list">' + items + '</ol>';
    }

    // Splits the picker's narrative description into scannable bullets
    // by hunting for known section markers (Top ranking keyword:,
    // Current title:, Current meta:, Schema..., Diagnosis:, Target:,
    // [live ...]). Everything before the first marker becomes the lead
    // bullet (URL + impressions/CTR/avg-pos summary). Each marker line
    // gets its own bullet for easier scanning vs the original wall of
    // text Alan flagged on 2026-05-20.
    function rfActionDescBullets(desc) {
      if (!desc) return '';
      const text = String(desc).trim();
      const markers = [
        /\bTop ranking keyword:/,
        /\bCurrent title:/,
        /\bCurrent meta:/,
        /\bMissing schema:/,
        /\bSchema present:/,
        /\bSchema missing:/,
        /\bSchema gaps?:/,
        /\bAIO coverage:/,
        /\bDiagnosis:/,
        /\bTarget:/,
        /\[live[^\]]*\]/
      ];
      const positions = new Set([0]);
      for (const m of markers) {
        const r = m.exec(text);
        if (r) positions.add(r.index);
      }
      const sorted = Array.from(positions).sort((a, b) => a - b);
      const chunks = [];
      for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i];
        const end = (i + 1 < sorted.length) ? sorted[i + 1] : text.length;
        const piece = text.slice(start, end).trim()
          .replace(/^[\u2014\u2013\-]\s*/, '')
          .replace(/[.,;\s]+$/, '');
        if (piece) chunks.push(piece);
      }
      return chunks
        .map(s => '<li>' + s.replace(/</g, '&lt;') + '</li>')
        .join('');
    }

    function rfActionEffortRow(c) {
      const eh = Number(c.effort_hours);
      const td = Number(c.time_to_realise_days);
      const profitMo = Number(c.estimated_lift_gbp_profit) || 0;
      if (!Number.isFinite(eh) && !Number.isFinite(td)) return '';
      const annualLiftPerHour = (Number.isFinite(eh) && eh > 0) ? (profitMo * 12) / eh : null;
      const cls = rfActionEffortClass(annualLiftPerHour);
      const effHr = Number.isFinite(eh) ? `<strong>${eh.toFixed(eh < 1 ? 1 : 0)}h</strong>` : '\u2014';
      const realiseLbl = Number.isFinite(td) ? (td >= 60 ? `<strong>${Math.round(td / 30)}mo</strong>` : `<strong>${td}d</strong>`) : '\u2014';
      const perHrLbl = annualLiftPerHour != null
        ? `<strong class="${cls}">£${rfFmtNum(Math.round(annualLiftPerHour))}</strong>/hr GP`
        : '\u2014';
      const effLabel = c.effort_label ? String(c.effort_label).replace(/</g, '&lt;') : '';
      const titleAttr = effLabel ? ` title="${effLabel.replace(/"/g, '&quot;')}"` : '';
      return `<div class="rf-action-effort"${titleAttr}>
        <span class="rf-action-effort-cell"><span class="rf-action-effort-icon">\u23f1</span>${effHr} effort</span>
        <span class="rf-action-effort-cell"><span class="rf-action-effort-icon">\u23f3</span>realise ${realiseLbl}</span>
        <span class="rf-action-effort-cell"><span class="rf-action-effort-icon">\u00a3</span>${perHrLbl} (annualised)</span>
      </div>`;
    }

    function rfActionCard(c, rank) {
      // API now returns MONTHLY values for both revenue and profit
      // (CTR generator was 28d, normalised to monthly server-side).
      const profitMo = Number(c.estimated_lift_gbp_profit) || 0;
      const revMo = Number(c.estimated_lift_gbp_revenue) || 0;
      const profitYr = profitMo * 12;
      const revYr = revMo * 12;
      const pages = Array.isArray(c.pages_affected) ? c.pages_affected.slice(0, 3) : [];
      const pagesHtml = pages.length
        ? pages.map(p => `<div class="rf-action-detail-pages">${String(p).replace(/^https?:\/\/[^/]+/, '')}</div>`).join('')
        : '<div class="rf-action-detail-pages">\u2014</div>';
      // 2026-05-20 phase H bug fix: the expanded Move row was rendering
      // the raw float from kpi_baseline_value (e.g. 1.3791198283006438).
      // Use the same lever-aware formatter as the at-a-glance Evidence
      // row so the user sees "CTR 1.38% -> 2.07%" everywhere.
      const moveMarkup = rfActionKpiEvidence(c);
      const kpiLine = moveMarkup
        ? `<div class="rf-action-detail-row"><div class="rf-action-detail-label">Move</div><div>${moveMarkup}</div></div>`
        : '';
      // 2026-05-20 phase H bug fix #2: the Why row was rendering the
      // picker description as a wall of text. Split on known section
      // markers (Top ranking keyword:, Current title:, Diagnosis: etc)
      // so each becomes its own scannable bullet.
      const bullets = rfActionDescBullets(c.description || '');
      // Phase H (2026-05-20): KPI evidence + "What to do" surfaced above
      // the expandable detail block so the card matches the Auto-Optimise
      // rich card density. Only emits rows that have data; cards without
      // a primary_kpi or effort_label stay visually clean. Uses the same
      // lever-aware formatter (CTR -> 2dp + %, rank -> #N) as Auto-Optimise
      // so the user sees ``CTR 1.38% -> 2.07%`` rather than the raw float.
      const evidenceMarkup = rfActionKpiEvidence(c);
      const evidenceRow = evidenceMarkup
        ? `<div class="rf-action-evidence-row"><span class="rf-action-evidence-label">Evidence</span><span class="rf-action-evidence-value">${evidenceMarkup}</span></div>`
        : '';
      // 2026-05-20 phase H: replace the single hardcoded effort_label
      // ("Rewrite title + meta description") with the per-page,
      // per-candidate recommended_actions[] the picker now emits. If the
      // picker didn't return actions (e.g. lever has no plan builder)
      // fall back to the legacy effort_label so we never render a blank.
      const planMarkup = rfActionPlanMarkup(c);
      const todoRow = planMarkup
        ? `<div class="rf-action-plan">${planMarkup}</div>`
        : (c.effort_label ? `<div class="rf-action-evidence-row"><span class="rf-action-evidence-label">Action</span><span class="rf-action-evidence-value rf-action-todo-line">${String(c.effort_label).replace(/</g, '&lt;')}</span></div>` : '');
      const evidenceBlock = (evidenceRow || todoRow)
        ? `<div class="rf-action-evidence">${evidenceRow}${todoRow}</div>`
        : '';
      // Phase F: scenario boost badge - tier_weight x lever_weight.
      // Only shown when the picker returned applied weights (i.e. an
      // active scenario exists) and the combined multiplier isn't a
      // trivial 1.00. Tells Alan the card was ranked WITH his scenario
      // levers, not in spite of them.
      const tw = Number(c.applied_tier_weight);
      const lw = Number(c.applied_lever_weight);
      let boostBadge = '';
      if (Number.isFinite(tw) && Number.isFinite(lw)) {
        const combined = tw * lw;
        const boostClass = combined >= 1.5 ? 'is-up' : (combined <= 0.7 ? 'is-down' : 'is-flat');
        const titleAttr = `Active scenario: tier weight \u00d7${tw.toFixed(2)}, lever weight \u00d7${lw.toFixed(2)}`;
        boostBadge = `<span class="rf-action-boost ${boostClass}" title="${titleAttr}">\u00d7${combined.toFixed(2)}</span>`;
      }
      const liftBasis = rfLiftBasisLine(c);
      const suppressionPill = rfSuppressionPill(c);
      const seasonalityPill = rfSeasonalityPill(c);
      return `<div class="rf-action-card" data-action-card role="button" tabindex="0" aria-label="Action ${rank}: ${String(c.title || '').replace(/"/g, '&quot;')}">
        <div class="rf-action-rank">${rank}</div>
        <div class="rf-action-tier-row">
          ${rfActionTierBadge(c.tier_id)}
          <span class="rf-action-gp-pct">${rfActionGpPct(c.tier_id)}</span>
          ${(c.academy_economics && c.academy_economics.badge) ? '<span class="rf-academy-econ-badge">' + String(c.academy_economics.badge).replace(/</g, '&lt;') + '</span>' : ''}
          ${seasonalityPill}
          ${boostBadge}
        </div>
        <div class="rf-action-title">${String(c.title || '').replace(/</g, '&lt;')}</div>
        ${suppressionPill}
        <div class="rf-action-lift-row">
          <div class="rf-action-lift-col">
            <div class="rf-action-lift-label">Revenue</div>
            <div class="rf-action-lift rf-action-lift-rev">+£${rfFmtNum(Math.round(revMo))}<span class="rf-action-lift-unit">/mo</span></div>
            <div class="rf-action-lift-sub">\u2248 <strong>£${rfFmtNum(Math.round(revYr))}/yr</strong></div>
          </div>
          <div class="rf-action-lift-col">
            <div class="rf-action-lift-label">Gross profit</div>
            <div class="rf-action-lift rf-action-lift-gp">+£${rfFmtNum(Math.round(profitMo))}<span class="rf-action-lift-unit">/mo</span></div>
            <div class="rf-action-lift-sub">\u2248 <strong>£${rfFmtNum(Math.round(profitYr))}/yr</strong></div>
          </div>
        </div>
        ${liftBasis}
        ${evidenceBlock}
        ${rfActionEffortRow(c)}
        <div class="rf-action-detail">
          ${bullets ? `<div class="rf-action-detail-row"><div class="rf-action-detail-label">Why</div><ul class="rf-action-detail-bullets">${bullets}</ul></div>` : ''}
          ${kpiLine}
          <div class="rf-action-detail-row"><div class="rf-action-detail-label">Pages</div><div>${pagesHtml}</div></div>
        </div>
      </div>`;
    }
    async function rfRenderTopActions() {
      const host = document.getElementById('rf-top-actions');
      const grid = document.getElementById('rf-top-actions-grid');
      const meta = document.getElementById('rf-top-actions-meta');
      if (!host || !grid) return;
      await rfEnsureSmartCandidatesLoaded();
      const all = (rfState.smartCandidates || []).filter(c => Number(c.estimated_lift_gbp_profit) > 0);
      host.style.display = '';
      if (!all.length) {
        grid.innerHTML = '<div class="rf-action-empty">No profit-weighted priorities right now — Smart Priorities engine has nothing actionable. Try running a fresh keyword sync.</div>';
        if (meta) meta.innerHTML = '';
        return;
      }
      const top3 = all.slice(0, 3);
      const totalMoGp = top3.reduce((sum, c) => sum + (Number(c.estimated_lift_gbp_profit) || 0), 0);
      const totalMoRev = top3.reduce((sum, c) => sum + (Number(c.estimated_lift_gbp_revenue) || 0), 0);
      // Frame the headline in terms of the actual GP gap from the profit
      // pyramid (cached on rfState.summary.profit_pyramid) so the user
      // sees "this closes X% of the gap" not abstract revenue figures.
      const pyramid = (rfState.summary || {}).profit_pyramid || {};
      const gpGapAnnual = Number(pyramid.gp_gap_to_min_annual_gbp) || 0;
      const gpGapMonthly = gpGapAnnual / 12;
      let gapLine = '';
      if (gpGapMonthly > 0) {
        const gapClosePct = Math.min(100, (totalMoGp / gpGapMonthly) * 100);
        const ragCol = gapClosePct >= 75 ? '#4ade80' : (gapClosePct >= 35 ? '#fbbf24' : '#fca5a5');
        gapLine = `<div style="margin-top:0.25rem;">Closes <strong style="color:${ragCol};">${gapClosePct.toFixed(0)}%</strong> of the £${rfFmtNum(Math.round(gpGapMonthly))}/mo (£${rfFmtNum(Math.round(gpGapAnnual))}/yr) GP gap from the tracker above.</div>`;
      } else {
        gapLine = `<div style="margin-top:0.25rem; color:#4ade80;">GP floor cleared — these actions push toward the stretch target.</div>`;
      }
      grid.innerHTML = top3.map((c, i) => rfActionCard(c, i + 1)).join('');
      if (meta) meta.innerHTML = `Top 3 of <strong>${all.length}</strong> · combined <strong>+£${rfFmtNum(Math.round(totalMoRev))}/mo revenue</strong> \u2192 <strong>+£${rfFmtNum(Math.round(totalMoGp))}/mo GP</strong>${gapLine}`;
      grid.querySelectorAll('[data-action-card]').forEach(card => {
        const toggle = () => card.classList.toggle('is-expanded');
        card.addEventListener('click', toggle);
        card.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
        });
      });
      // Re-render the Profit Goal Tracker so the scenario impact band
      // appears now that we have the Top 3 lifts in hand. Cheap because
      // it's pure DOM string assembly; the underlying pyramid fetch
      // doesn't re-run.
      if (rfState.profitPyramid) {
        try { rfRenderProfitGoal(rfState.profitPyramid); } catch (e) { /* swallow - cosmetic refresh */ }
      }
    }

    // ----- Academy Funnel renderer -------------------------------------
    // Pulls live trial / paying-member data from /api/aigeo/academy-funnel
    // (separate Supabase project). Renders 4 KPI tiles, a 12-month
    // trials-started sparkline, and a gap-analysis block that translates
    // the £/yr profit gap (passed from the profit pyramid) into a
    // trials/month target so the user knows exactly what number to chase.
    function rfAcademyKpiTile(label, value, sub, trend) {
      const trendAttr = trend ? ` data-trend="${trend}"` : '';
      return `<div class="rf-academy-kpi">
        <div class="rf-academy-kpi-label">${label}</div>
        <div class="rf-academy-kpi-value">${value}</div>
        <div class="rf-academy-kpi-sub"${trendAttr}>${sub || ''}</div>
      </div>`;
    }
    function rfAcademyRenderKpis(data) {
      const host = document.getElementById('rf-academy-kpis');
      if (!host) return;
      const c = data.current || {};
      const f = data.funnel || {};
      const trialTrend = (f.trials_started_30d || 0) < Math.round((f.trials_started_90d || 0) / 3) * 0.7 ? 'down' : null;
      const convPct = f.trials_started_90d > 0 ? Math.round((f.trial_conversions_90d / f.trials_started_90d) * 1000) / 10 : 0;
      const convRag = convPct >= 10 ? 'up' : (convPct >= 5 ? null : 'down');
      host.innerHTML = [
        rfAcademyKpiTile('Active paying members', c.paying_members || 0, `ARR £${rfFmtNum(Math.round(c.arr_gbp || 0))} · GP £${rfFmtNum(Math.round(c.annual_gp_gbp || 0))}/yr`),
        rfAcademyKpiTile('Active trials right now', c.active_trials || 0, `${f.trials_started_30d || 0} started in last 30d${trialTrend === 'down' ? ' — top-of-funnel is shrinking' : ''}`, trialTrend),
        rfAcademyKpiTile('Trial → paid (90d)', `${convPct.toFixed(1)}%`, `${f.trial_conversions_90d || 0} of ${f.trials_started_90d || 0} trials · ${convRag === 'up' ? 'above 10% benchmark' : (convRag === 'down' ? 'below 5% — fix the trial' : 'close to 5-10% baseline')}`, convRag),
        rfAcademyKpiTile('New paying (90d)', f.new_paying_90d || 0, `${f.direct_signups_90d || 0} direct (skip-trial) · ${f.cancellations_90d || 0} cancelled · ${f.invoice_failures_90d || 0} failed payments`, (f.cancellations_90d || 0) > 2 ? 'down' : null)
      ].join('');
    }
    // CSS-grid based bar chart. Bars are HTML elements that scale with
    // the container width, so labels never get squashed and bars never
    // look distorted regardless of viewport size.
    function rfAcademyChartSvg(months) {
      const host = document.getElementById('rf-academy-bars');
      if (!host) return;
      const maxVal = Math.max(1, ...months.map(m => m.trials_started || 0));
      const peakIdx = months.reduce((best, m, i) => (m.trials_started || 0) > (months[best]?.trials_started || 0) ? i : best, 0);
      const latestIdx = months.length - 1;
      const shortMonth = key => {
        if (!key || key.length < 7) return key || '';
        const [y, m] = key.split('-');
        const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${names[Number(m) - 1] || m} ${String(y).slice(2)}`;
      };
      host.innerHTML = months.map((m, i) => {
        const v = m.trials_started || 0;
        const paid = m.new_paid || 0;
        const convPct = v > 0 ? Math.round((paid / v) * 1000) / 10 : 0;
        const heightPct = v > 0 ? Math.max(8, (v / maxVal) * 92) : 0;
        const cls = v === 0 ? 'is-zero' : (i === latestIdx ? 'is-latest' : (i === peakIdx ? 'is-peak' : ''));
        const tooltip = `${m.month}\n${v} unique trial${v === 1 ? '' : 's'} started\n${paid} new paid member${paid === 1 ? '' : 's'} signed up (first-ever annual_start in this month)\n${convPct}% same-month conversion (delayed conversions land in later months)`;
        const paidBadge = paid > 0
          ? `<div class="rf-academy-bar-paid is-paid">→ ${paid} paid</div>`
          : `<div class="rf-academy-bar-paid is-zero-paid">→ 0 paid</div>`;
        return `<div class="rf-academy-bar-col">
          <div class="rf-academy-bar-value">${v}</div>
          <div class="rf-academy-bar-rect ${cls}" style="height:${heightPct.toFixed(1)}%;" title="${tooltip}"></div>
          ${paidBadge}
          <div class="rf-academy-bar-label">${shortMonth(m.month)}</div>
        </div>`;
      }).join('');
    }
    function rfAcademyTrendNarrative(months) {
      const nonZero = months.filter(m => m.trials_started > 0);
      if (nonZero.length < 2) return '';
      // Split the post-cutover window in half so we can describe momentum
      // without making a misleading "vs a year ago" claim — the new model
      // has only existed since Jan 2026.
      const half = Math.floor(nonZero.length / 2);
      const firstHalf = nonZero.slice(0, half).reduce((a, b) => a + b.trials_started, 0) / Math.max(1, half);
      const secondHalf = nonZero.slice(-half).reduce((a, b) => a + b.trials_started, 0) / Math.max(1, half);
      const peak = nonZero.reduce((mx, m) => m.trials_started > mx.trials_started ? m : mx, nonZero[0]);
      const latest = nonZero[nonZero.length - 1];
      const totalTrials = months.reduce((a, m) => a + (m.trials_started || 0), 0);
      const totalPaid = months.reduce((a, m) => a + (m.new_paid || 0), 0);
      const overallConv = totalTrials > 0 ? Math.round((totalPaid / totalTrials) * 1000) / 10 : 0;
      const deltaPct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
      const dir = deltaPct < -20 ? 'down' : (deltaPct > 20 ? 'up' : null);
      const verb = deltaPct < 0 ? 'down' : 'up';
      const cls = dir === 'down' ? 'down' : (dir === 'up' ? 'up' : '');
      const peakLabel = peak.month ? peak.month.slice(0, 7) : '';
      return `<strong>Two problems stacked:</strong> top-of-funnel collapsed from <strong>${peak.trials_started}</strong> trials in <strong>${peakLabel}</strong> to <strong>${latest.trials_started}</strong> last month (second-half avg <strong>${secondHalf.toFixed(0)}/mo</strong> vs first-half <strong>${firstHalf.toFixed(0)}/mo</strong>, <span class="${cls}">${verb} ${Math.abs(deltaPct)}%</span>) AND across the whole window only <strong>${totalPaid}</strong> of <strong>${totalTrials}</strong> trials converted — that is <strong>${overallConv}%</strong> trial→paid (industry healthy is 10–25%). Volume AND conversion both need fixing.`;
    }
    function rfAcademyGapMarkup(gap, data) {
      if (!gap || !gap.annual_gp_gap_gbp) {
        return `<p style="color:#9ca3af; font-style:italic;">No profit gap detected — annualised profit is hitting the £48k+ target. Focus shifts to retention + ARR consolidation.</p>`;
      }
      const convRag = gap.trial_conversion_pct_90d != null && gap.trial_conversion_pct_90d >= 10 ? 'good' : (gap.trial_conversion_pct_90d != null && gap.trial_conversion_pct_90d >= 5 ? 'warn' : 'bad');
      const multRag = gap.trial_volume_multiplier_needed != null && gap.trial_volume_multiplier_needed <= 2 ? 'good' : (gap.trial_volume_multiplier_needed != null && gap.trial_volume_multiplier_needed <= 4 ? 'warn' : 'bad');
      const annual = data.academy_annual_fee_gbp;
      return `
        <p>Profit shortfall: <span class="num">£${rfFmtNum(gap.annual_gp_gap_gbp)}/yr</span>.</p>
        <p>Academy GP per member: <span class="num">£${gap.gp_per_member_gbp}/yr</span> (£${annual} fee × ${data.academy_gp_pct}% GP).</p>
        <p>Members needed to close the gap: <span class="num num-rag-bad">+${gap.members_needed}</span></p>
        <p style="margin-top:0.5rem; border-top: 1px dashed #374151; padding-top:0.5rem;">At your current trial→paid rate of <span class="num num-rag-${convRag}">${gap.trial_conversion_pct_90d == null ? 'n/a' : gap.trial_conversion_pct_90d + '%'}</span>, you'd need <span class="num num-rag-${multRag}">${gap.trials_per_month_needed || 'n/a'} trials/mo</span> for 12 months.</p>
        <p>You're currently averaging <span class="num">${gap.current_trials_per_month}/mo</span> — a <span class="num num-rag-${multRag}">${gap.trial_volume_multiplier_needed || 'n/a'}×</span> increase in trial volume.</p>
        <p style="margin-top:0.5rem; color:#9ca3af; font-size:0.74rem; line-height:1.45;">Most-likely strategy: Academy alone cannot close the gap. Improve trial conversion (lifecycle emails, in-trial wins, social proof) AND supplement with higher-volume tiers (non-res workshops, 1-2-1) to share the load.</p>`;
    }
    function rfAcademyRenderConfigured(data) {
      const host = document.getElementById('rf-academy');
      const status = document.getElementById('rf-academy-status');
      const foot = document.getElementById('rf-academy-chart-foot');
      const gapHost = document.getElementById('rf-academy-gap');
      if (host) host.style.display = '';
      if (status) status.textContent = `Live · ${new Date(data.generated_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`;
      rfAcademyRenderKpis(data);
      rfAcademyChartSvg(data.monthly_trials || []);
      if (foot) foot.innerHTML = rfAcademyTrendNarrative(data.monthly_trials || []);
      if (gapHost) gapHost.innerHTML = rfAcademyGapMarkup(data.gap_analysis, data);
    }
    function rfAcademyRenderUnconfigured(msg) {
      const host = document.getElementById('rf-academy');
      const status = document.getElementById('rf-academy-status');
      if (host) host.style.display = '';
      if (status) status.textContent = 'Not configured';
      const kpis = document.getElementById('rf-academy-kpis');
      if (kpis) kpis.innerHTML = '';
      const gapHost = document.getElementById('rf-academy-gap');
      if (gapHost) gapHost.innerHTML = `<p class="rf-academy-empty">${msg || 'Set ACADEMY_SUPABASE_URL + ACADEMY_SUPABASE_SERVICE_ROLE_KEY env vars to enable.'}</p>`;
      const foot = document.getElementById('rf-academy-chart-foot');
      if (foot) foot.innerHTML = '';
    }
    async function rfFetchAcademyFunnel(profitPyramid) {
      const minGap = profitPyramid
        ? Math.max(0, (profitPyramid.annual_gp_target_low_gbp || 48000) - (profitPyramid.annualised_gp_total_gbp || 0))
        : 18000;
      try {
        const res = await fetch(rfApi(`/api/aigeo/academy-funnel?annual_gp_gap_gbp=${Math.round(minGap)}`));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.configured) {
          rfAcademyRenderUnconfigured(data.message);
          return;
        }
        rfAcademyRenderConfigured(data);
      } catch (err) {
        rfAcademyRenderUnconfigured(`Failed to load academy funnel: ${err.message}`);
      }
    }

    // ----- Profit Goal Tracker (revenue + GP bars) ---------------------
    // Two-bar thermometer. Each bar:
    //   - solid fill = YTD actual £
    //   - striped overlay = projected remainder-of-year (annualised - YTD)
    //   - markers = min target and stretch target
    // RAG is computed on the annualised pace vs the min target.
    function rfProfitGoalRag(pace, minTarget) {
      if (pace >= minTarget) return 'green';
      if (pace >= minTarget * 0.7) return 'amber';
      return 'red';
    }
    function rfProfitGoalRagColour(rag) {
      if (rag === 'green') return '#4ade80';
      if (rag === 'amber') return '#fbbf24';
      return '#f87171';
    }
    // Confidence multipliers applied to the Top 3 monthly lift estimates
    // when they are extrapolated into the scenario impact band. The min
    // end assumes only 30% of estimated lift lands; the max end assumes
    // 100%. These are intentionally conservative because the lifts come
    // from heuristic models, not measured outcomes.
    const RF_SCENARIO_BAND_MIN_CONFIDENCE = 0.3;
    const RF_SCENARIO_BAND_MAX_CONFIDENCE = 1.0;

    function rfProfitGoalBarBlock(opts) {
      // opts: { kind: 'rev'|'gp', name, ytd, projected, annualised,
      //         minTarget, maxScale, monthlyMin, monthlyMax,
      //         scenarioLiftAnnual, scenarioName }
      // scenarioLiftAnnual is the SUM of the active scenario's Top 3
      // actions' lift in this bar's metric (revenue or GP), grossed up
      // from monthly to annual. We render two overlays past the
      // projected line: a darker MIN band (30% of max), and a striped
      // MAX band (100%). Together they read as "if you do the Top 3
      // every month, projection rises by £X-Y/yr".
      const { kind, name, ytd, projected, annualised, minTarget, maxScale, monthlyMin, monthlyMax, scenarioLiftAnnual, scenarioName } = opts;
      const rag = rfProfitGoalRag(annualised, minTarget);
      const idColour = kind === 'rev' ? '#3b82f6' : '#22c55e';
      const idColourBright = kind === 'rev' ? '#60a5fa' : '#4ade80';
      const idColourFaded = kind === 'rev' ? 'rgba(59, 130, 246, 0.55)' : 'rgba(34, 197, 94, 0.55)';
      const fillColour = rag === 'red' ? idColourFaded : idColour;
      const ragLabel = rag === 'green' ? 'ON TARGET' : (rag === 'amber' ? 'BEHIND PACE' : 'OFF TARGET');
      const ragColour = rfProfitGoalRagColour(rag);
      const ytdPct = Math.max(0, Math.min(100, (ytd / maxScale) * 100));
      const annPct = Math.max(0, Math.min(100, (annualised / maxScale) * 100));
      const projPct = Math.max(0, annPct - ytdPct);
      const minPct = Math.max(0, Math.min(100, (minTarget / maxScale) * 100));
      const stretchPct = 100;
      const moPace = annualised / 12;
      const gap = minTarget - annualised;
      const gapLabel = gap > 0
        ? `<span class="gap gap-bad">−£${rfFmtNum(Math.round(gap))}/yr short</span>`
        : `<span class="gap gap-good">+£${rfFmtNum(Math.round(-gap))}/yr ahead</span>`;
      const ytdLabel = ytdPct >= 8 ? `£${rfFmtNum(Math.round(ytd))}` : '';
      const projLabel = projPct >= 8 ? `+£${rfFmtNum(Math.round(projected))} proj` : '';
      const unitLabel = kind === 'rev' ? 'revenue' : 'cash profit';

      // Scenario impact band - only rendered if the active scenario has
      // a non-zero Top 3 lift in this metric. Width is clamped at the
      // bar edge but the band itself is allowed to render past stretch
      // (it indicates upside beyond target).
      let scenarioMaxHtml = '';
      let scenarioMinHtml = '';
      let scenarioSummaryHtml = '';
      if (scenarioLiftAnnual > 0) {
        const lift = Number(scenarioLiftAnnual) || 0;
        const liftMax = lift * RF_SCENARIO_BAND_MAX_CONFIDENCE;
        const liftMin = lift * RF_SCENARIO_BAND_MIN_CONFIDENCE;
        const scMaxEndPct = Math.max(0, Math.min(100, ((annualised + liftMax) / maxScale) * 100));
        const scMinEndPct = Math.max(0, Math.min(100, ((annualised + liftMin) / maxScale) * 100));
        const scMaxWidth = Math.max(0, scMaxEndPct - annPct);
        const scMinWidth = Math.max(0, scMinEndPct - annPct);
        const liftMonthlyMin = liftMin / 12;
        const liftMonthlyMax = liftMax / 12;
        const bandLabel = scMaxWidth >= 6 ? `+£${rfFmtNum(Math.round(liftMin))}\u2013£${rfFmtNum(Math.round(liftMax))}/yr` : '';
        const tipLabel = scenarioName
          ? `${scenarioName}: Top 3 lift +£${rfFmtNum(Math.round(liftMonthlyMin))}\u2013£${rfFmtNum(Math.round(liftMonthlyMax))}/mo`
          : `Top 3 lift +£${rfFmtNum(Math.round(liftMonthlyMin))}\u2013£${rfFmtNum(Math.round(liftMonthlyMax))}/mo`;
        scenarioMaxHtml = `<div class="rf-profit-goal-bar-scenario" style="left:${annPct.toFixed(1)}%; width:${scMaxWidth.toFixed(1)}%;" title="${tipLabel}">${bandLabel}</div>`;
        if (scMinWidth > 0.5) {
          scenarioMinHtml = `<div class="rf-profit-goal-bar-scenario-min" style="left:${annPct.toFixed(1)}%; width:${scMinWidth.toFixed(1)}%;" title="Conservative end of band (30% of estimated lift): +£${rfFmtNum(Math.round(liftMin))}/yr"></div>`;
        }
        const scenarioPaceMin = (annualised + liftMin) / 12;
        const scenarioPaceMax = (annualised + liftMax) / 12;
        scenarioSummaryHtml = `<span class="sep">·</span><span style="color:#fbbf24;">Top 3 done: <strong style="color:#fef3c7;">£${rfFmtNum(Math.round(scenarioPaceMin))}\u2013£${rfFmtNum(Math.round(scenarioPaceMax))}/mo</strong> (+£${rfFmtNum(Math.round(liftMin))}\u2013£${rfFmtNum(Math.round(liftMax))}/yr)</span>`;
      }

      return `<div class="rf-profit-goal-bar-block is-${kind}">
        <div class="rf-profit-goal-bar-header">
          <div class="rf-profit-goal-bar-header-top">
            <div class="rf-profit-goal-bar-name"><span class="rf-profit-goal-bar-swatch"></span>${name} <span class="rf-profit-goal-target-pill">target £${rfFmtNum(monthlyMin)}\u2013£${rfFmtNum(monthlyMax)}/mo</span></div>
            <span class="rf-profit-goal-bar-status" data-rag="${rag}">${ragLabel}</span>
          </div>
          <div class="rf-profit-goal-bar-summary">
            <span>YTD ${unitLabel}: <strong>£${rfFmtNum(Math.round(ytd))}</strong></span>
            <span class="sep">·</span>
            <span>Projected full year: <strong style="color:${idColourBright};">£${rfFmtNum(Math.round(annualised))}</strong> (£${rfFmtNum(Math.round(moPace))}/mo)</span>
            <span class="sep">·</span>
            <span>${gapLabel}</span>
            ${scenarioSummaryHtml}
          </div>
        </div>
        <div class="rf-profit-goal-bar">
          <div class="rf-profit-goal-bar-fill" style="width:${ytdPct.toFixed(1)}%; background:${fillColour};">${ytdLabel}</div>
          <div class="rf-profit-goal-bar-proj is-${kind}" style="left:${ytdPct.toFixed(1)}%; width:${projPct.toFixed(1)}%;">${projLabel}</div>
          ${scenarioMaxHtml}
          ${scenarioMinHtml}
          <div class="rf-profit-goal-bar-marker" style="left:${minPct.toFixed(1)}%;" title="£${rfFmtNum(monthlyMin)}/mo (£${rfFmtNum(minTarget)}/yr) \u2014 minimum target"><span class="rf-profit-goal-bar-marker-label">£${rfFmtNum(monthlyMin)}/mo min</span></div>
          <div class="rf-profit-goal-bar-marker rf-profit-goal-bar-marker-high" style="left:${stretchPct.toFixed(1)}%;" title="£${rfFmtNum(monthlyMax)}/mo (£${rfFmtNum(maxScale)}/yr) \u2014 stretch target"><span class="rf-profit-goal-bar-marker-label">£${rfFmtNum(monthlyMax)}/mo stretch</span></div>
        </div>
        <div class="rf-profit-goal-scale">
          <span>£0</span><span>£${rfFmtNum(Math.round(maxScale / 4))}</span><span>£${rfFmtNum(Math.round(maxScale / 2))}</span><span>£${rfFmtNum(Math.round((maxScale * 3) / 4))}</span><span>£${rfFmtNum(maxScale)}</span>
        </div>
      </div>`;
    }
    // Aggregates the active scenario's Top 3 candidate lifts (monthly,
    // from /api/aigeo/revenue-funnel-smart-priorities) into annualised
    // revenue + GP totals used by the scenario impact band. Returns
    // zeros until the candidates have loaded so the Profit Goal Tracker
    // renders cleanly during the initial paint and then redraws when
    // rfRenderTopActions calls back in (see rfRenderTopActions tail).
    function rfScenarioLiftAggregate() {
      const cands = (rfState && rfState.smartCandidates) || [];
      const top3 = cands
        .filter(c => Number(c.estimated_lift_gbp_profit) > 0)
        .slice(0, 3);
      const monthlyRev = top3.reduce((s, c) => s + (Number(c.estimated_lift_gbp_revenue) || 0), 0);
      const monthlyGp  = top3.reduce((s, c) => s + (Number(c.estimated_lift_gbp_profit)  || 0), 0);
      return {
        annualRevLift: monthlyRev * 12,
        annualGpLift:  monthlyGp  * 12,
        loaded: cands.length > 0,
        top3Count: top3.length
      };
    }

    // Active scenario name comes from #rfActiveScenarioName which is
    // populated by the pill's own IIFE on init. Falls back to empty so
    // the band still renders.
    function rfActiveScenarioName() {
      const el = document.getElementById('rfActiveScenarioName');
      const txt = el ? (el.textContent || '').trim() : '';
      return (txt && !/loading|none/i.test(txt)) ? txt : '';
    }

    function rfRenderProfitGoal(pyramid) {
      const host = document.getElementById('rf-profit-goal');
      const bars = document.getElementById('rf-profit-goal-bars');
      const num = document.getElementById('rf-profit-goal-numbers');
      const foot = document.getElementById('rf-profit-goal-foot');
      if (!host || !pyramid || !pyramid.annualised_gp_total_gbp) {
        if (host) host.style.display = 'none';
        return;
      }
      // Cache last pyramid so rfRenderTopActions can re-render the
      // Profit Goal Tracker once Top 3 candidates finish loading. This
      // is the hook that adds the scenario impact band on the second
      // paint without re-running the underlying pyramid fetch.
      rfState.profitPyramid = pyramid;
      host.style.display = '';
      const annGp = pyramid.annualised_gp_total_gbp || 0;
      const annRev = pyramid.annualised_revenue_total_gbp || 0;
      const ytdGp = pyramid.ytd_gp_total_gbp || 0;
      const ytdRev = pyramid.ytd_revenue_total_gbp || 0;
      const projGp = pyramid.projected_remainder_gp_gbp || Math.max(0, annGp - ytdGp);
      const projRev = pyramid.projected_remainder_revenue_gbp || Math.max(0, annRev - ytdRev);
      const gpMin = pyramid.annual_gp_target_low_gbp || 30000;
      const gpMax = pyramid.annual_gp_target_high_gbp || 48000;
      const revMin = pyramid.annual_revenue_target_low_gbp || 48000;
      const revMax = pyramid.annual_revenue_target_high_gbp || 60000;
      const gpMoMin = pyramid.monthly_gp_target_low_gbp || 2500;
      const gpMoMax = pyramid.monthly_gp_target_high_gbp || 4000;
      const revMoMin = pyramid.monthly_revenue_target_low_gbp || 4000;
      const revMoMax = pyramid.monthly_revenue_target_high_gbp || 5000;
      const scenarioAgg = rfScenarioLiftAggregate();
      const scenarioName = rfActiveScenarioName();
      if (bars) {
        bars.innerHTML = [
          rfProfitGoalBarBlock({
            kind: 'rev', name: 'Revenue (gross)',
            ytd: ytdRev, projected: projRev, annualised: annRev,
            minTarget: revMin, maxScale: revMax,
            monthlyMin: revMoMin, monthlyMax: revMoMax,
            scenarioLiftAnnual: scenarioAgg.annualRevLift,
            scenarioName: scenarioName
          }),
          rfProfitGoalBarBlock({
            kind: 'gp', name: 'Cash profit (GP)',
            ytd: ytdGp, projected: projGp, annualised: annGp,
            minTarget: gpMin, maxScale: gpMax,
            monthlyMin: gpMoMin, monthlyMax: gpMoMax,
            scenarioLiftAnnual: scenarioAgg.annualGpLift,
            scenarioName: scenarioName
          })
        ].join('');
      }
      if (num) {
        const gpGap = Math.max(0, gpMin - annGp);
        const status = gpGap > 0
          ? `<span style="color:#fca5a5;">−£${rfFmtNum(Math.round(gpGap))}/yr short of GP floor</span>`
          : `<span style="color:#4ade80;">GP floor cleared</span>`;
        num.innerHTML = `<div style="display:flex; flex-direction:column; gap:0.15rem; align-items:flex-end;">
            <div><span style="display:inline-block; width:0.7rem; height:0.7rem; background:#22c55e; border-radius:2px; margin-right:0.4rem; vertical-align:middle;"></span><strong style="color:#86efac;">£${rfFmtNum(Math.round(annGp / 12))}/mo</strong> &nbsp;GP pace</div>
            <div><span style="display:inline-block; width:0.7rem; height:0.7rem; background:#3b82f6; border-radius:2px; margin-right:0.4rem; vertical-align:middle;"></span><strong style="color:#93c5fd;">£${rfFmtNum(Math.round(annRev / 12))}/mo</strong> &nbsp;revenue pace</div>
            <div style="margin-top:0.25rem;">${status}</div>
          </div>`;
      }
      if (foot) {
        const ph = pyramid.rows || [];
        const pickTier = id => ph.find(r => r.tier_id === id);
        const acad = pickTier('academy');
        const res = pickTier('workshops_residential');
        const gpGap = Math.max(0, gpMin - annGp);
        const bullets = [];
        if (gpGap > 0) {
          bullets.push({
            cls: 'is-headline',
            html: `<strong>£${rfFmtNum(Math.round(gpGap))}/yr GP gap</strong> (≈ £${rfFmtNum(Math.round(gpGap / 12))}/mo) — that is the number every "do this next" action below has to chase.`
          });
        } else {
          bullets.push({
            cls: 'is-headline-good',
            html: `<strong>GP floor cleared.</strong> Focus shifts from gap-closing to consolidation: lock in retention, push toward the £${rfFmtNum(gpMax)}/yr stretch target.`
          });
        }
        if (acad && acad.annualised_gp_gbp != null) {
          bullets.push({
            cls: 'is-lever',
            html: `<strong>Academy is at £${rfFmtNum(Math.round(acad.annualised_gp_gbp))}/yr</strong> (${acad.share_of_gp_pct.toFixed(1)}% of profit). At 99% GP, the trial→paid funnel is the <strong>lowest-effort lever</strong> on the £/yr GP gap.`
          });
        }
        if (res && res.share_gap_pp < -5) {
          bullets.push({
            cls: 'is-warn',
            html: `<strong>Residential workshops are ${Math.abs(res.share_gap_pp).toFixed(1)}pp under-indexed</strong> on profit vs revenue. Keep them for retention/LTV — they <strong>will not close</strong> the GP gap on their own.`
          });
        }
        foot.innerHTML = `<ul>${bullets.map(b => `<li class="${b.cls}"><span class="bullet">●</span><span>${b.html}</span></li>`).join('')}</ul>`;
      }
    }

    function rfRenderProfitPyramid(p) {
      const host = document.getElementById('rf-pyramid');
      if (!host) return;
      if (!p || !Array.isArray(p.rows) || !p.rows.length) {
        host.style.display = 'none';
        return;
      }
      host.style.display = '';
      const totalGp = p.annualised_gp_total_gbp || p.rows.reduce((a, b) => a + (b.annualised_gp_gbp || 0), 0);
      const bar = document.getElementById('rf-pyramid-bar');
      const tbody = document.getElementById('rf-pyramid-tbody');
      const tfoot = document.getElementById('rf-pyramid-tfoot');
      const goalHost = document.getElementById('rf-pyramid-goal-host');
      const sortedForBar = [...p.rows].sort((a, b) => b.annualised_gp_gbp - a.annualised_gp_gbp);
      if (bar) bar.innerHTML = rfPyramidBarSegments(sortedForBar, totalGp);
      if (tbody) tbody.innerHTML = rfPyramidTableRows(sortedForBar);
      if (tfoot) tfoot.innerHTML = rfPyramidTotalsRow(sortedForBar, p);
      if (goalHost) goalHost.innerHTML = rfPyramidGoalMarkup(p);
    }

    // -------------------------------------------------------------------
    // Tier classification review
    // -------------------------------------------------------------------
    function rfTierReviewRenderSummary(host, summary) {
      const totals = summary.totals || {};
      const order = ['workshops_residential', 'workshops_nonres', 'courses', 'services', 'hire', 'academy', 'unidentified'];
      const labels = { workshops_residential: 'Workshops (Res)', workshops_nonres: 'Workshops (Non-Res)', courses: 'Courses', services: 'Services', hire: 'Hire (Commercial)', academy: 'Academy', unidentified: 'Unidentified (needs review)' };
      host.innerHTML = order.map(id => {
        const n = totals[id] || 0;
        const colour = id === 'unidentified' ? '#fb923c' : 'var(--dark-brand)';
        return `<div style="background:#0f1827; border:1px solid var(--dark-border); border-radius:6px; padding:0.4rem 0.7rem;">
          <div style="font-size:0.7rem; text-transform:uppercase; color:#9ca3af; letter-spacing:0.04em;">${labels[id]}</div>
          <div style="font-size:1.15rem; font-weight:700; color:${colour};">${n}</div>
        </div>`;
      }).join('');
    }
    function rfTierReviewProductRow(p) {
      const price = p.price_gbp != null ? `£${p.price_gbp.toFixed(2)}` : '—';
      const titleEsc = String(p.product_title || '').replace(/</g, '&lt;');
      const path = String(p.product_url || '').replace(/^https?:\/\/[^/]+/, '');
      return `<tr>
        <td style="font-size:0.78rem;">${titleEsc}</td>
        <td><code style="color:#9ca3af; font-size:0.72rem;">${path}</code></td>
        <td class="num">${price}</td>
      </tr>`;
    }
    function rfTierReviewRenderGroups(host, tiers) {
      host.innerHTML = (tiers || []).map(group => {
        if (!group.products || !group.products.length) return '';
        const rows = group.products.map(rfTierReviewProductRow).join('');
        return `<div style="margin-top:0.7rem;">
          <h4 style="margin:0 0 0.3rem 0; font-size:0.85rem; color:var(--dark-text);">${group.tier_label} <span style="color:#9ca3af; font-weight:500;">(${group.products.length})</span></h4>
          <table class="rf-table" style="font-size:0.78rem;">
            <thead><tr>
              <th>Product</th><th>URL</th><th class="num">Price</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      }).join('');
    }
    async function rfTierReviewFetch() {
      const summaryHost = document.getElementById('rf-tier-review-summary');
      const bodyHost = document.getElementById('rf-tier-review-body');
      if (!summaryHost || !bodyHost) return;
      summaryHost.innerHTML = '<div style="color:#9ca3af; font-size:0.78rem;">Loading…</div>';
      bodyHost.innerHTML = '';
      try {
        const res = await fetch(rfApi('/api/aigeo/commercial-tier-products'));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        rfTierReviewRenderSummary(summaryHost, data.summary || {});
        rfTierReviewRenderGroups(bodyHost, data.tiers || []);
      } catch (err) {
        summaryHost.innerHTML = `<div style="color:#f87171; font-size:0.78rem;">Failed: ${err && err.message ? err.message : err}</div>`;
      }
    }
    function rfWireTierReview() {
      const btn = document.getElementById('rf-tier-review-refresh');
      if (btn && !btn.dataset.bound) {
        btn.addEventListener('click', rfTierReviewFetch);
        btn.dataset.bound = '1';
      }
      const details = btn && btn.closest('details');
      if (details && !details.dataset.bound) {
        details.addEventListener('toggle', () => {
          if (details.open && !details.dataset.loaded) {
            details.dataset.loaded = '1';
            rfTierReviewFetch();
          }
        });
        details.dataset.bound = '1';
      }
    }
    function rfRenderHistorySparkline(history) {
      const svg = document.getElementById('rf-spark-svg');
      const host = document.getElementById('rf-spark-host');
      const tip = document.getElementById('rf-spark-tooltip');
      if (!svg || !host) return;
      if (!history || !history.length) {
        svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#6b7280" font-size="14">No monthly revenue rows — run Sync everything</text>';
        return;
      }
      const built = rfSparkBuildMarkup(history);
      if (!built) { svg.innerHTML = ''; return; }
      svg.innerHTML = built.svg;
      const points = JSON.parse(built.meta);
      svg.querySelectorAll('.rf-spark-dot').forEach(dot => {
        dot.addEventListener('mouseenter', (e) => {
          const i = Number(dot.getAttribute('data-i'));
          const p = points[i];
          if (!p || !tip) return;
          const variance = p.t > 0 ? (((p.v - p.t) / p.t) * 100).toFixed(0) + '%' : '—';
          tip.innerHTML = `<strong>${p.label}</strong>${p.partial ? ' (partial)' : ''}<br/>Revenue: £${rfFmtNum(Math.round(p.v))}<br/>Target: £${rfFmtNum(Math.round(p.t))}<br/>vs target: <span style="color:${(p.v - p.t) >= 0 ? '#34d399' : '#f87171'}">${variance}</span>`;
          const hostBox = host.getBoundingClientRect();
          const svgBox = svg.getBoundingClientRect();
          const scaleX = svgBox.width / 720;
          const scaleY = svgBox.height / 180;
          tip.style.left = (p.x * scaleX + svgBox.left - hostBox.left + 12) + 'px';
          tip.style.top = (p.y * scaleY + svgBox.top - hostBox.top - 8) + 'px';
          tip.style.display = 'block';
        });
        dot.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
      });
    }
    function rfVarianceClass(pct) {
      if (pct == null) return '';
      if (pct >= -10) return 'rag-good';
      if (pct >= -25) return 'rag-mid';
      return 'rag-bad';
    }
    function rfFmtVariancePct(pct) {
      if (pct == null || !isFinite(pct)) return '—';
      const sign = pct >= 0 ? '+' : '';
      return `${sign}${pct.toFixed(0)}%`;
    }
    function rfRenderYtdSummary(ytd, currency) {
      const revEl = document.getElementById('rf-hist-ytd-revenue');
      const subEl = document.getElementById('rf-hist-ytd-vs-target');
      const labelEl = document.getElementById('rf-hist-ytd-label');
      const rateEl = document.getElementById('rf-hist-runrate');
      const rateSubEl = document.getElementById('rf-hist-runrate-vs');
      if (!ytd) {
        if (revEl) revEl.textContent = '—';
        if (subEl) subEl.textContent = '—';
        if (rateEl) rateEl.textContent = '—';
        if (rateSubEl) rateSubEl.textContent = '—';
        return;
      }
      const cur = currency || 'GBP';
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthLabel = monthNames[ytd.current_month_idx] || '';
      if (labelEl) labelEl.textContent = `YTD ${ytd.year} (Jan → ${monthLabel})`;
      if (revEl) revEl.textContent = ytd.ytd_revenue_gbp > 0 ? rfFmtMoney(ytd.ytd_revenue_gbp, cur) : '—';
      if (subEl) {
        const cls = rfVarianceClass(ytd.variance_pct);
        const tgt = rfFmtMoney(ytd.ytd_target_prorata_gbp, cur);
        const varTxt = rfFmtVariancePct(ytd.variance_pct);
        subEl.innerHTML = `target ${tgt}, <span class="${cls}">${varTxt}</span>`;
      }
      if (rateEl) rateEl.textContent = ytd.run_rate_annual_gbp > 0 ? rfFmtMoney(ytd.run_rate_annual_gbp, cur) : '—';
      if (rateSubEl) {
        const cls = rfVarianceClass(ytd.pace_variance_pct);
        const tgt = rfFmtMoney(ytd.annual_target_gbp, cur);
        const varTxt = rfFmtVariancePct(ytd.pace_variance_pct);
        rateSubEl.innerHTML = `vs ${tgt} annual, <span class="${cls}">${varTxt}</span>`;
      }
    }
    function rfRenderHistory(history) {
      rfState.history = rfBuildHistoryRows(history || []);
      const totalEl = document.getElementById('rf-hist-total-12m');
      const subEl = document.getElementById('rf-hist-total-12m-sub');
      const vsEl = document.getElementById('rf-hist-vs-target');
      const closedRows = rfState.history.filter(r => !r.is_partial);
      const total = closedRows.reduce((s, r) => s + (r.revenue || 0), 0);
      const targetTotal = closedRows.reduce((s, r) => s + (r.target || 0), 0);
      const txnTotal = closedRows.reduce((s, r) => s + (r.transactions || 0), 0);
      const currency = (rfState.history[0] && rfState.history[0].currency) || 'GBP';
      if (totalEl) totalEl.textContent = total > 0 ? rfFmtMoney(total, currency) : '—';
      if (subEl) subEl.textContent = closedRows.length
        ? `${closedRows.length} closed months · ${rfFmtNum(txnTotal)} transactions`
        : 'No monthly revenue rows yet';
      if (vsEl) {
        if (targetTotal > 0) {
          const variancePct = ((total - targetTotal) / targetTotal) * 100;
          const cls = rfVarianceClass(variancePct);
          vsEl.innerHTML = `target ${rfFmtMoney(targetTotal, currency)}, <span class="${cls}">${rfFmtVariancePct(variancePct)}</span>`;
        } else {
          vsEl.textContent = '—';
        }
      }
      rfRenderYtdSummary((rfState.summary && rfState.summary.ytd_summary) || null, currency);
      rfRenderHistorySparkline(history || []);
      rfRedrawHistoryTable();
      rfRenderSourceMix(history || [], currency);
    }

    // -------------------------------------------------------------------
    // 3-source breakdown table (Squarespace / Stripe / Booking Sheet)
    // -------------------------------------------------------------------
    function rfSourceMixRow(r, currency) {
      const sb = r.source_breakdown || {};
      const ss = (sb.squarespace_api && sb.squarespace_api.revenue) || 0;
      const st = (sb.stripe_supplemental && sb.stripe_supplemental.revenue) || 0;
      const bs = (sb.booking_sheet && sb.booking_sheet.revenue) || 0;
      const total = ss + st + bs;
      const fmt = (v) => v > 0
        ? `<span style="color:var(--dark-brand); font-weight:600;">${rfFmtMoney(v, currency)}</span>`
        : '<span style="color:#475569;">—</span>';
      const sources = (r.sources || []).map(s => s.replace('squarespace_api', 'SS').replace('stripe_supplemental', 'Stripe').replace('booking_sheet', 'Book')).join(' + ');
      const partialBadge = r.is_partial ? ' <span style="font-size:0.65rem; color:#9ca3af;">(partial)</span>' : '';
      const rowStyle = r.is_partial ? ' style="opacity:0.65;"' : '';
      return `<tr${rowStyle}>
        <td>${rfMonthLabel(r.period_start)}${partialBadge}</td>
        <td class="num">${fmt(ss)}</td>
        <td class="num">${fmt(st)}</td>
        <td class="num">${fmt(bs)}</td>
        <td class="num" style="color:var(--dark-text); font-weight:700;">${rfFmtMoney(total, currency)}</td>
        <td class="num" style="font-size:0.72rem; color:#9ca3af;">${sources || '—'}</td>
      </tr>`;
    }
    function rfRenderSourceMix(history, currency) {
      const table = document.getElementById('rf-source-mix-table');
      const body = table ? table.querySelector('tbody') : null;
      if (!body) return;
      if (!history.length) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#6b7280;">No monthly revenue rows yet.</td></tr>';
        return;
      }
      const sorted = history.slice().sort((a, b) => b.period_start.localeCompare(a.period_start));
      body.innerHTML = sorted.map(r => rfSourceMixRow(r, currency)).join('');
    }
    function rfRedrawHistoryTable() {
      const table = document.getElementById('rf-history-table');
      const body = table ? table.querySelector('tbody') : null;
      if (!body) return;
      const list = (rfState.history || []).slice();
      const key = table.dataset.sortKey || 'month';
      const dir = table.dataset.sortDir || 'asc';
      rfUpdateSortIndicators(table, key, dir);
      const sortKey = key === 'month' ? 'month_sort' : key;
      const sorted = rfSortRows(list, sortKey, dir);
      if (!sorted.length) { body.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#6b7280;">No monthly revenue rows yet. Run "Sync from Squarespace" with a 12-month window.</td></tr>'; return; }
      body.innerHTML = sorted.map(r => {
        const aov = r.aov != null ? rfFmtMoney(r.aov, r.currency) : '—';
        const momColor = r.mom == null ? '#6b7280' : (r.mom >= 0 ? '#34d399' : '#f87171');
        const momTxt = r.mom == null ? '—' : `${r.mom >= 0 ? '+' : ''}${r.mom.toFixed(1)}%`;
        const varColor = r.variance_pct == null ? '#6b7280' : (r.variance_pct >= 0 ? '#34d399' : '#f87171');
        const varTxt = r.variance_pct == null ? '—' : `${r.variance_pct >= 0 ? '+' : ''}${r.variance_pct.toFixed(0)}%`;
        const rowStyle = r.is_partial ? ' style="opacity:0.65;"' : '';
        const partialBadge = r.is_partial ? ' <span style="font-size:0.65rem; color:#9ca3af;">(partial)</span>' : '';
        return `
        <tr${rowStyle}>
          <td>${r.month}${partialBadge}</td>
          <td class="num" style="color:var(--dark-brand); font-weight:700;">${rfFmtMoney(r.revenue, r.currency)}</td>
          <td class="num">${r.target != null ? rfFmtMoney(r.target, r.currency) : '—'}</td>
          <td class="num" style="color:${varColor}; font-weight:600;">${varTxt}</td>
          <td class="num">${rfFmtNum(r.transactions)}</td>
          <td class="num">${aov}</td>
          <td class="num" style="color:${momColor}; font-weight:600;">${momTxt}</td>
        </tr>`;
      }).join('');
    }

    function rfRenderRevenueLatest(snap) {
      const el = document.getElementById('rf-rev-latest');
      if (!el) return;
      if (!snap) { el.textContent = 'No revenue entries yet — add one above to unlock the Click→Sale and Revenue/1k tiles.'; return; }
      el.innerHTML = `Latest: <strong>${rfFmtMoney(snap.revenue_amount, snap.currency)}</strong> for <strong>${snap.period_start}</strong> → <strong>${snap.period_end}</strong>${snap.transactions ? ` (${snap.transactions} transactions)` : ''}. Source: <em>${snap.source}</em>.`;
    }

    function rfSafeRender(label, fn) {
      try {
        fn();
      } catch (err) {
        console.error('[Revenue Funnel] render failed:', label, err);
      }
    }

    async function rfFetchSummary() {
      const reqId = (rfState.fetchSeq = (rfState.fetchSeq || 0) + 1);
      rfState.loading = true;
      rfShowStatus('Loading Revenue Funnel summary…', 'info');
      try {
        const res = await fetch(rfApi('/api/aigeo/revenue-funnel-summary?propertyUrl=' + encodeURIComponent(RF_PROPERTY)));
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error('HTTP ' + res.status + (errText ? ' — ' + errText.slice(0, 120) : ''));
        }
        const data = await res.json();
        if (reqId !== rfState.fetchSeq) return;
        rfState.summary = data;
        rfSafeRender('history', () => rfRenderHistory(data.revenue_history || []));
        rfSafeRender('profit-goal', () => rfRenderProfitGoal(data.profit_pyramid || null));
        rfSafeRender('survival-cockpit', () => rfRenderSurvivalCockpit(data.tier_history || []));
        rfSafeRender('tier-sparklines', () => rfRenderTierSparklines(data.tier_history || []));
        rfSafeRender('profit-pyramid', () => rfRenderProfitPyramid(data.profit_pyramid || null));
        rfFetchAcademyFunnel(data.profit_pyramid || null);
        try { await rfRenderTopActions(); } catch (err) { console.error('[Revenue Funnel] top actions', err); }
        rfEnsureSmartCandidatesLoaded().catch((err) => console.error('[Revenue Funnel] smart candidates', err));
        rfSafeRender('kpis', () => rfRenderKpis(data.kpis || {}));
        rfSafeRender('funnel', () => rfRenderFunnel(data.funnel || []));
        rfSafeRender('money-pages', () => rfRenderMoneyPages(data.money_page_performance || []));
        rfSafeRender('leak-pages', () => rfRenderLeakTable(data.top_leak_pages || []));
        rfSafeRender('ai-map', () => rfRenderAiMap(data.ai_overview_map || []));
        rfSafeRender('priorities', () => rfRenderPriorities(data.priorities || []));
        rfSafeRender('earning', () => rfRenderEarning(data.earning_pages || []));
        rfSafeRender('revenue-latest', () => rfRenderRevenueLatest(data.latest_revenue || null));
        rfSafeRender('funnel-note', () => {
          const note = document.getElementById('rf-funnel-note');
          if (!note) return;
          const parts = [];
          if (data.page_metrics_date_end) parts.push('GSC 28d ending ' + data.page_metrics_date_end);
          if (data.ga4_metrics_date_end) {
            const mp = data.ga4_metrics?.money_page_enquiry_events_28d;
            const site = data.ga4_metrics?.enquiry_events_28d;
            let ga4Part = '';
            if (mp != null) {
              ga4Part = ' (' + mp + ' money-page enquiries';
              if (site != null && site !== mp) ga4Part += ', ' + site + ' site-wide';
              ga4Part += ')';
            }
            parts.push('GA4 28d ending ' + data.ga4_metrics_date_end + ga4Part);
          } else {
            parts.push('GA4: click Sync GA4 to fill Add-to-cart / enquiry');
          }
          note.textContent = parts.join(' · ');
        });
        rfShowStatus('', null);
      } catch (err) {
        rfShowStatus('Failed to load Revenue Funnel summary: ' + (err && err.message ? err.message : err), 'error');
      } finally {
        if (reqId === rfState.fetchSeq) rfState.loading = false;
      }
    }

    async function rfStartTaskForPriority(priorityId) {
      const res = await fetch(rfApi('/api/aigeo/revenue-funnel-start-task'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priorityId, propertyUrl: RF_PROPERTY })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
      return data;
    }

    async function rfPatchPriority(id, fields) {
      const res = await fetch(rfApi('/api/aigeo/revenue-funnel-priorities'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
      return data;
    }

    async function rfHandlePriorityAction(action, id) {
      try {
        if (action === 'start') {
          await rfStartTaskForPriority(id);
        } else if (action === 'mark-done') {
          await rfPatchPriority(id, { status: 'done' });
        } else if (action === 'reopen') {
          await rfPatchPriority(id, { status: 'in_progress' });
        } else if (action === 'dismiss') {
          await rfPatchPriority(id, { status: 'cancelled' });
        }
        await rfFetchSummary();
      } catch (err) {
        rfShowStatus('Action failed: ' + (err && err.message ? err.message : err), 'error');
      }
    }

    function rfPromptAddPriority() {
      const title = window.prompt('Priority title');
      if (!title || !title.trim()) return null;
      const description = window.prompt('One-sentence description (optional)') || '';
      const lift = window.prompt('Estimated lift (optional, e.g. "+5pp CTR")') || '';
      return { title: title.trim(), description, estimated_lift: lift, propertyUrl: RF_PROPERTY };
    }

    async function rfAddPriority() {
      const payload = rfPromptAddPriority();
      if (!payload) return;
      try {
        const res = await fetch(rfApi('/api/aigeo/revenue-funnel-priorities'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
        await rfFetchSummary();
      } catch (err) {
        rfShowStatus('Add priority failed: ' + (err && err.message ? err.message : err), 'error');
      }
    }

    function rfDefaultSyncWindow() {
      const today = new Date();
      const ymd = (d) => d.toISOString().slice(0, 10);
      const start = new Date(today.getTime() - 27 * 86400000);
      return { start: ymd(start), end: ymd(today) };
    }

    function rfPrepSyncDefaults() {
      const win = rfDefaultSyncWindow();
      const startEl = document.getElementById('rf-sq-start');
      const endEl = document.getElementById('rf-sq-end');
      if (startEl && !startEl.value) startEl.value = win.start;
      if (endEl && !endEl.value) endEl.value = win.end;
      const stripeStart = document.getElementById('rf-stripe-start');
      const stripeEnd = document.getElementById('rf-stripe-end');
      if (stripeStart && !stripeStart.value) stripeStart.value = win.start;
      if (stripeEnd && !stripeEnd.value) stripeEnd.value = win.end;
    }

    // -------------------------------------------------------------------
    // Sync progress bar — visible feedback whenever any feed is syncing.
    // Used by:
    //   - rfSubmitSquarespaceSync (single feed)
    //   - rfSubmitStripeSync      (single feed)
    //   - rfSyncEverything        (master button at top of page)
    // -------------------------------------------------------------------
    function rfSyncProgressEls() {
      return {
        host: document.getElementById('rf-sync-progress'),
        step: document.getElementById('rf-sync-progress-step'),
        pct: document.getElementById('rf-sync-progress-pct'),
        fill: document.getElementById('rf-sync-progress-fill'),
        log: document.getElementById('rf-sync-progress-log')
      };
    }
    function rfSyncProgressShow(step) {
      const els = rfSyncProgressEls();
      if (!els.host) return;
      els.host.style.display = 'block';
      els.host.classList.remove('is-error', 'is-success');
      if (els.step) els.step.textContent = step || 'Starting…';
      if (els.pct) els.pct.textContent = '0%';
      if (els.fill) { els.fill.style.width = '0%'; els.fill.classList.add('is-indeterminate'); }
      if (els.log) els.log.innerHTML = '';
    }
    function rfSyncProgressUpdate(pct, step) {
      const els = rfSyncProgressEls();
      if (!els.host) return;
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      if (els.fill) { els.fill.classList.remove('is-indeterminate'); els.fill.style.width = clamped + '%'; }
      if (els.pct) els.pct.textContent = clamped + '%';
      if (step && els.step) els.step.textContent = step;
    }
    function rfSyncProgressLog(message, kind) {
      const els = rfSyncProgressEls();
      if (!els.log) return;
      const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
      const cls = kind === 'ok' ? 'rf-sync-log-ok' : (kind === 'err' ? 'rf-sync-log-err' : '');
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = `[${ts}] ${message}`;
      els.log.appendChild(line);
      els.log.scrollTop = els.log.scrollHeight;
    }
    function rfSyncProgressFinish(kind, summary) {
      const els = rfSyncProgressEls();
      if (!els.host) return;
      if (els.fill) { els.fill.classList.remove('is-indeterminate'); els.fill.style.width = '100%'; }
      if (els.pct) els.pct.textContent = '100%';
      els.host.classList.add(kind === 'error' ? 'is-error' : 'is-success');
      if (summary && els.step) els.step.textContent = summary;
    }

    async function rfRunSquarespaceSync(start, end) {
      rfSyncProgressLog('Squarespace: fetching orders from API…');
      const res = await fetch(rfApi('/api/aigeo/squarespace-revenue-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyUrl: RF_PROPERTY, period_start: start, period_end: end, modes: 'single,monthly' })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const detail = data?.missing ? `Missing env var: ${data.missing}` : (data?.message || ('HTTP ' + res.status));
        throw new Error('Squarespace: ' + detail);
      }
      const revFmt = rfFmtMoney(data.revenue_in_window, data.currency || 'GBP');
      rfSyncProgressLog(`Squarespace OK — ${data.orders_fetched} orders, ${data.orders_in_window} in window for ${revFmt}, ${data.months_synced} months upserted.`, 'ok');
      return data;
    }

    async function rfRunStripeSync(start, end) {
      rfSyncProgressLog('Stripe: fetching charges (Acuity + Subscriptions)…');
      const res = await fetch(rfApi('/api/aigeo/stripe-revenue-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyUrl: RF_PROPERTY, period_start: start, period_end: end, modes: 'single,monthly' })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const detail = data?.missing ? `Missing env var: ${data.missing}` : (data?.message || ('HTTP ' + res.status));
        throw new Error('Stripe: ' + detail);
      }
      const revFmt = rfFmtMoney(data.revenue_in_window, data.currency || 'GBP');
      const cls = rfFormatStripeClassifier(data.classifier_counts);
      rfSyncProgressLog(`Stripe OK — ${data.charges_classified} classified to ${revFmt}${cls}, ${data.charges_skipped} skipped, ${data.months_synced} months upserted.`, 'ok');
      return data;
    }

    async function rfSubmitSquarespaceSync(evt) {
      evt.preventDefault();
      const start = document.getElementById('rf-sq-start').value;
      const end = document.getElementById('rf-sq-end').value;
      const result = document.getElementById('rf-sq-result');
      const btn = document.getElementById('rf-sq-sync-btn');
      if (!start || !end) { if (result) result.textContent = 'Pick a date range first.'; return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
      if (result) { result.style.color = '#475569'; result.textContent = 'Fetching orders from Squarespace…'; }
      rfSyncProgressShow('Squarespace sync — fetching orders…');
      rfSyncProgressUpdate(15, 'Squarespace sync — fetching orders…');
      try {
        const data = await rfRunSquarespaceSync(start, end);
        if (result) {
          result.style.color = '#065f46';
          const revFmt = rfFmtMoney(data.revenue_in_window, data.currency || 'GBP');
          result.textContent = `Synced ${data.orders_fetched} orders. ${data.orders_in_window} in window for ${revFmt}. ${data.months_synced} month rows upserted.`;
        }
        rfSyncProgressUpdate(70, 'Reloading Revenue Funnel data…');
        rfSyncProgressLog('Reloading tables and charts…');
        await rfFetchSummary();
        if (typeof window.updateRevenueSyncBanner === 'function') {
          try { await window.updateRevenueSyncBanner(RF_PROPERTY); } catch (_e) { /* swallow */ }
        }
        if (typeof window.updateAuditTimestamp === 'function') window.updateAuditTimestamp();
        rfSyncProgressFinish('success', 'Squarespace sync complete.');
      } catch (err) {
        if (result) {
          result.style.color = '#991b1b';
          result.textContent = 'Sync failed: ' + (err && err.message ? err.message : err);
        }
        rfSyncProgressLog(err && err.message ? err.message : String(err), 'err');
        rfSyncProgressFinish('error', 'Squarespace sync failed.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
      }
    }

    function rfFormatStripeClassifier(counts) {
      if (!counts || typeof counts !== 'object') return '';
      const parts = [];
      for (const [k, v] of Object.entries(counts)) parts.push(`${k}=${v}`);
      return parts.length ? ` (${parts.join(', ')})` : '';
    }

    async function rfSubmitStripeSync(evt) {
      evt.preventDefault();
      const start = document.getElementById('rf-stripe-start').value;
      const end = document.getElementById('rf-stripe-end').value;
      const result = document.getElementById('rf-stripe-result');
      const btn = document.getElementById('rf-stripe-sync-btn');
      if (!start || !end) { if (result) result.textContent = 'Pick a date range first.'; return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
      if (result) { result.style.color = '#475569'; result.textContent = 'Fetching Stripe charges (Acuity + Subscriptions)…'; }
      rfSyncProgressShow('Stripe sync — fetching charges…');
      rfSyncProgressUpdate(15, 'Stripe sync — fetching charges…');
      try {
        const data = await rfRunStripeSync(start, end);
        if (result) {
          result.style.color = '#065f46';
          const revFmt = rfFmtMoney(data.revenue_in_window, data.currency || 'GBP');
          const cls = rfFormatStripeClassifier(data.classifier_counts);
          result.textContent = `Synced ${data.charges_fetched} charges. ${data.charges_classified} added to ${revFmt}${cls}. ${data.charges_skipped} skipped (Squarespace Commerce / refunded). ${data.months_synced} month rows upserted.`;
        }
        rfSyncProgressUpdate(70, 'Reloading Revenue Funnel data…');
        rfSyncProgressLog('Reloading tables and charts…');
        await rfFetchSummary();
        if (typeof window.updateRevenueSyncBanner === 'function') {
          try { await window.updateRevenueSyncBanner(RF_PROPERTY); } catch (_e) { /* swallow */ }
        }
        if (typeof window.updateAuditTimestamp === 'function') window.updateAuditTimestamp();
        rfSyncProgressFinish('success', 'Stripe sync complete.');
      } catch (err) {
        if (result) {
          result.style.color = '#991b1b';
          result.textContent = 'Sync failed: ' + (err && err.message ? err.message : err);
        }
        rfSyncProgressLog(err && err.message ? err.message : String(err), 'err');
        rfSyncProgressFinish('error', 'Stripe sync failed.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sync now'; }
      }
    }

    function rfDefaultSyncWindow() {
      // Last 13 months — wide enough for the rolling 12-month sparkline.
      const today = new Date();
      const end = today.toISOString().slice(0, 10);
      const startDt = new Date(today.getFullYear(), today.getMonth() - 12, 1);
      const start = startDt.toISOString().slice(0, 10);
      return { start, end };
    }

    // Convert a File (xlsm) into base64 the booking-sheet-upload endpoint
    // expects. Chunked so we don't blow the call stack on a large file
    // (String.fromCharCode on a 4MB Uint8Array can stack-overflow).
    function rfFileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('FileReader error'));
        reader.onload = () => {
          const result = String(reader.result || '');
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(file);
      });
    }

    // Open the hidden <input type="file"> and wait for a selection (or cancel).
    function rfPickBookingFile() {
      return new Promise((resolve) => {
        const input = document.getElementById('rf-booking-file');
        if (!input) { resolve(null); return; }
        // Reset value so picking the same file twice still fires `change`.
        input.value = '';
        const onChange = () => {
          input.removeEventListener('change', onChange);
          window.removeEventListener('focus', onFocus, true);
          resolve(input.files && input.files[0] ? input.files[0] : null);
        };
        // If the user cancels the dialog there's no `change` event - fall
        // back to detecting window-refocus and resolving with null.
        let focusTimer = null;
        const onFocus = () => {
          clearTimeout(focusTimer);
          focusTimer = setTimeout(() => {
            if (!input.files || !input.files[0]) {
              input.removeEventListener('change', onChange);
              window.removeEventListener('focus', onFocus, true);
              resolve(null);
            }
          }, 500);
        };
        input.addEventListener('change', onChange);
        window.addEventListener('focus', onFocus, true);
        input.click();
      });
    }

    function rfFmtFundingTotals(byFunding) {
      const parts = [];
      for (const [k, v] of Object.entries(byFunding || {})) {
        parts.push(`${k}=£${Math.round(v).toLocaleString('en-GB')}`);
      }
      return parts.length ? ` (${parts.join(', ')})` : '';
    }

    async function rfRunBookingSheetUpload(file) {
      if (!file) throw new Error('No file picked.');
      rfSyncProgressLog(`Reading "${file.name}" (${Math.round(file.size / 1024)} KB)…`);
      const contentBase64 = await rfFileToBase64(file);
      rfSyncProgressLog(`Uploading and parsing…`);
      const url = (typeof window.apiUrl === 'function')
        ? window.apiUrl('/api/aigeo/booking-sheet-upload')
        : '/api/aigeo/booking-sheet-upload';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentBase64 })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error('Booking Sheet: ' + (data?.error || ('HTTP ' + res.status)));
      }
      const fundingSummary = rfFmtFundingTotals(data.by_funding);
      rfSyncProgressLog(`Booking Sheet OK — ${data.records_kept} rows kept across ${data.months_upserted} months${fundingSummary}.`, 'ok');
      return data;
    }

    async function rfRunGa4Sync() {
      rfSyncProgressLog('GA4: fetching 28d event metrics…');
      const res = await fetch(rfApi('/api/aigeo/ga4-metrics'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyUrl: RF_PROPERTY, refresh: true })
      });
      const data = await res.json();
      if (!res.ok) throw new Error('GA4: ' + (data.message || data.error || ('HTTP ' + res.status)));
      const enq = data.metrics?.enquiry_events_28d;
      rfSyncProgressLog(`GA4 OK — 28d ending ${data.metrics?.date_end || '?'}${enq != null ? ` (${enq} enquiry events)` : ''}.`, 'ok');
      return data;
    }

    async function rfSubmitGa4Sync() {
      const btn = document.getElementById('rf-sync-ga4-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ GA4…'; }
      rfSyncProgressShow('Syncing GA4…');
      try {
        await rfRunGa4Sync();
        await rfFetchSummary();
        if (typeof window.updateRevenueSyncBanner === 'function') {
          try { await window.updateRevenueSyncBanner(RF_PROPERTY); } catch (_e) { /* swallow */ }
        }
        rfSyncProgressFinish('success', 'GA4 synced. Funnel updated.');
      } catch (err) {
        rfSyncProgressLog(err?.message || String(err), 'err');
        rfSyncProgressFinish('error', 'GA4 sync failed.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ Sync GA4'; }
      }
    }

    async function rfSyncEverything() {
      const btn = document.getElementById('rf-sync-all-btn');
      const { start, end } = rfDefaultSyncWindow();
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
      // Ask for the .xlsm BEFORE the long API calls so the user can do
      // both in one go. Cancel = skip Booking Sheet step.
      rfSyncProgressShow('Step 0 of 5 — Pick Booking Sheet (.xlsm) or cancel to skip…');
      rfSyncProgressUpdate(2, 'Step 0 of 5 — Pick Booking Sheet (.xlsm) or cancel to skip…');
      const file = await rfPickBookingFile();
      if (file) {
        rfSyncProgressLog(`Booking Sheet queued: ${file.name}`);
      } else {
        rfSyncProgressLog('Booking Sheet skipped (no file picked) — only Squarespace + Stripe will sync.');
      }
      let okSquarespace = false;
      let okStripe = false;
      let okBookingSheet = file ? false : null;
      try {
        rfSyncProgressUpdate(8, `Step 1 of 5 — Squarespace (${start} → ${end})`);
        try { await rfRunSquarespaceSync(start, end); okSquarespace = true; }
        catch (err) { rfSyncProgressLog(err?.message || String(err), 'err'); }
        rfSyncProgressUpdate(28, `Step 2 of 5 — Stripe (${start} → ${end})`);
        try { await rfRunStripeSync(start, end); okStripe = true; }
        catch (err) { rfSyncProgressLog(err?.message || String(err), 'err'); }
        if (file) {
          rfSyncProgressUpdate(48, `Step 3 of 5 — Booking Sheet (${file.name})`);
          try { await rfRunBookingSheetUpload(file); okBookingSheet = true; }
          catch (err) { rfSyncProgressLog(err?.message || String(err), 'err'); }
        }
        let okGa4 = false;
        rfSyncProgressUpdate(62, 'Step 4 of 5 — GA4 (28d enquiry events)');
        try { await rfRunGa4Sync(); okGa4 = true; }
        catch (err) { rfSyncProgressLog(err?.message || String(err), 'err'); }
        rfSyncProgressUpdate(85, 'Step 5 of 5 — Reloading all Revenue Funnel tables and charts…');
        rfSyncProgressLog('Reloading Revenue Funnel summary, money pages, tier sparklines, source mix…');
        await rfFetchSummary();
        if (typeof window.updateRevenueSyncBanner === 'function') {
          try { await window.updateRevenueSyncBanner(RF_PROPERTY); } catch (_e) { /* swallow */ }
        }
        if (typeof window.updateAuditTimestamp === 'function') window.updateAuditTimestamp();
        rfSyncProgressFinish(
          rfSyncOutcomeStatus(okSquarespace, okStripe, okBookingSheet) === 'success' && okGa4 ? 'success' : 'error',
          rfSyncOutcomeSummary(okSquarespace, okStripe, okBookingSheet) + ` GA4: ${okGa4 ? '✓' : '✗'}.`
        );
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '▶ Sync everything & refresh page'; }
      }
    }

    function rfSyncOutcomeStatus(ok1, ok2, ok3) {
      const flags = [ok1, ok2, ok3].filter(v => v !== null);
      if (flags.every(v => v === true)) return 'success';
      if (flags.some(v => v === true)) return 'error';
      return 'error';
    }
    function rfSyncOutcomeSummary(okSq, okSt, okBs) {
      const parts = [];
      parts.push(`Squarespace: ${okSq ? '✓' : '✗'}`);
      parts.push(`Stripe: ${okSt ? '✓' : '✗'}`);
      if (okBs !== null) parts.push(`Booking Sheet: ${okBs ? '✓' : '✗'}`);
      else parts.push('Booking Sheet: skipped');
      const allOk = (okSq && okSt && (okBs === null || okBs));
      return `${allOk ? 'Sync complete' : 'Sync finished with errors'} — ${parts.join(', ')}. Page refreshed.`;
    }

    async function rfUploadBookingSheetOnly() {
      const btn = document.getElementById('rf-upload-booking-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Picking file…'; }
      try {
        const file = await rfPickBookingFile();
        if (!file) {
          if (btn) { btn.disabled = false; btn.textContent = '📋 Upload Booking Sheet'; }
          return;
        }
        rfSyncProgressShow(`Booking Sheet upload — ${file.name}`);
        rfSyncProgressUpdate(20, 'Reading and uploading file…');
        try {
          await rfRunBookingSheetUpload(file);
          rfSyncProgressUpdate(70, 'Reloading Revenue Funnel data…');
          await rfFetchSummary();
          if (typeof window.updateRevenueSyncBanner === 'function') {
            try { await window.updateRevenueSyncBanner(RF_PROPERTY); } catch (_e) { /* swallow */ }
          }
          rfSyncProgressFinish('success', 'Booking Sheet imported successfully. Page refreshed.');
        } catch (err) {
          rfSyncProgressLog(err?.message || String(err), 'err');
          rfSyncProgressFinish('error', 'Booking Sheet upload failed — see error above.');
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📋 Upload Booking Sheet'; }
      }
    }

    async function rfSubmitRevenue(evt) {
      evt.preventDefault();
      const start = document.getElementById('rf-rev-start').value;
      const end = document.getElementById('rf-rev-end').value;
      const amount = Number(document.getElementById('rf-rev-amount').value);
      const txn = document.getElementById('rf-rev-txn').value;
      const notes = document.getElementById('rf-rev-notes').value;
      if (!start || !end || !Number.isFinite(amount)) { rfShowStatus('Period start/end and revenue are required.', 'error'); return; }
      try {
        const res = await fetch(rfApi('/api/aigeo/revenue-snapshot'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyUrl: RF_PROPERTY,
            period_start: start,
            period_end: end,
            revenue_amount: amount,
            transactions: txn ? Number(txn) : null,
            notes: notes || null,
            source: 'manual'
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
        await rfFetchSummary();
        document.getElementById('rf-revenue-form').reset();
      } catch (err) {
        rfShowStatus('Save revenue failed: ' + (err && err.message ? err.message : err), 'error');
      }
    }

    function rfWireEvents() {
      const refresh = document.getElementById('rf-refresh-btn');
      if (refresh) refresh.addEventListener('click', rfFetchSummary);
      const syncAll = document.getElementById('rf-sync-all-btn');
      if (syncAll) syncAll.addEventListener('click', rfSyncEverything);
      const syncGa4 = document.getElementById('rf-sync-ga4-btn');
      if (syncGa4) syncGa4.addEventListener('click', rfSubmitGa4Sync);
      const uploadBs = document.getElementById('rf-upload-booking-btn');
      if (uploadBs) uploadBs.addEventListener('click', rfUploadBookingSheetOnly);
      const addBtn = document.getElementById('rf-add-priority-btn');
      if (addBtn) addBtn.addEventListener('click', rfAddPriority);
      const toggleBtn = document.getElementById('rf-toggle-done-btn');
      if (toggleBtn) toggleBtn.addEventListener('click', () => {
        rfState.showDone = !rfState.showDone;
        toggleBtn.textContent = rfState.showDone ? 'Hide done items' : 'Show done items';
        if (rfState.summary) rfRenderPriorities(rfState.summary.priorities || []);
      });
      const form = document.getElementById('rf-revenue-form');
      if (form) form.addEventListener('submit', rfSubmitRevenue);
      const sqForm = document.getElementById('rf-sq-form');
      if (sqForm) sqForm.addEventListener('submit', rfSubmitSquarespaceSync);
      const stripeForm = document.getElementById('rf-stripe-form');
      if (stripeForm) stripeForm.addEventListener('submit', rfSubmitStripeSync);
      rfPrepSyncDefaults();

      // Bind sort handlers (idempotent — dataset flag prevents double-binding).
      rfBindSort('rf-history-table', 'month', rfRedrawHistoryTable);
      rfBindSort('rf-leak-table', 'recoverable_clicks_28d', () => rfRenderLeakTable(rfState.summary?.top_leak_pages || []));
      rfBindSort('rf-ai-table', 'search_volume', rfRedrawAiMap);
      rfBindSort('rf-earning-table', 'clicks_28d', rfRedrawEarning);
      rfBindSort('rf-money-table', 'revenue_potential_28d', rfRedrawMoneyTable);

      // AI map filters.
      ['rf-ai-filter', 'rf-ai-bucket-filter', 'rf-ai-tier-filter', 'rf-ai-money-only'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(evt, rfRedrawAiMap);
      });
      const earnFilter = document.getElementById('rf-earn-money-only');
      if (earnFilter) earnFilter.addEventListener('change', rfRedrawEarning);

      const priorityTable = document.getElementById('rf-priority-table');
      if (priorityTable) priorityTable.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-rf-action]');
        if (!btn) return;
        rfHandlePriorityAction(btn.getAttribute('data-rf-action'), btn.getAttribute('data-id'));
      });

      // Tier classification review (lazy-loaded on details open).
      rfWireTierReview();

      // Smart priorities regenerator.
      const smartBtn = document.getElementById('rf-smart-priorities-btn');
      if (smartBtn && !smartBtn.dataset.bound) {
        smartBtn.addEventListener('click', rfRegenerateSmartPriorities);
        smartBtn.dataset.bound = '1';
      }
    }

    async function rfRegenerateSmartPriorities() {
      const btn = document.getElementById('rf-smart-priorities-btn');
      const msg = document.getElementById('rf-smart-priorities-msg');
      if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
      if (msg) { msg.style.color = '#9ca3af'; msg.textContent = 'Reading audit data and generating priorities from real CTR, AIO, schema and product gaps…'; }
      try {
        const res = await fetch(rfApi('/api/aigeo/revenue-funnel-smart-priorities'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyUrl: RF_PROPERTY, mode: 'replace' })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || ('HTTP ' + res.status));
        if (msg) { msg.style.color = '#34d399'; msg.textContent = `Replaced not-started priorities. ${data.candidate_count} candidates generated, ${data.saved_count} saved. Refreshing…`; }
        rfState.smartCandidates = null; // invalidate cache so tier drilldowns re-fetch
        await rfFetchSummary();
      } catch (err) {
        if (msg) { msg.style.color = '#f87171'; msg.textContent = 'Failed: ' + (err && err.message ? err.message : err); }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Regenerate smart priorities'; }
      }
    }

    function rfRenderProfitGoalBarsToHost(hostEl, pyramid, scenarioAgg, scenarioName) {
      if (!hostEl || !pyramid || !pyramid.annualised_gp_total_gbp) {
        if (hostEl) hostEl.innerHTML = '';
        return false;
      }
      const agg = scenarioAgg || { annualRevLift: 0, annualGpLift: 0 };
      const annGp = pyramid.annualised_gp_total_gbp || 0;
      const annRev = pyramid.annualised_revenue_total_gbp || 0;
      const ytdGp = pyramid.ytd_gp_total_gbp || 0;
      const ytdRev = pyramid.ytd_revenue_total_gbp || 0;
      const projGp = pyramid.projected_remainder_gp_gbp || Math.max(0, annGp - ytdGp);
      const projRev = pyramid.projected_remainder_revenue_gbp || Math.max(0, annRev - ytdRev);
      hostEl.innerHTML = [
        rfProfitGoalBarBlock({
          kind: 'rev', name: 'Revenue (gross)',
          ytd: ytdRev, projected: projRev, annualised: annRev,
          minTarget: pyramid.annual_revenue_target_low_gbp || 48000,
          maxScale: pyramid.annual_revenue_target_high_gbp || 60000,
          monthlyMin: pyramid.monthly_revenue_target_low_gbp || 4000,
          monthlyMax: pyramid.monthly_revenue_target_high_gbp || 5000,
          scenarioLiftAnnual: agg.annualRevLift || 0,
          scenarioName: scenarioName || ''
        }),
        rfProfitGoalBarBlock({
          kind: 'gp', name: 'Cash profit (GP)',
          ytd: ytdGp, projected: projGp, annualised: annGp,
          minTarget: pyramid.annual_gp_target_low_gbp || 30000,
          maxScale: pyramid.annual_gp_target_high_gbp || 48000,
          monthlyMin: pyramid.monthly_gp_target_low_gbp || 2500,
          monthlyMax: pyramid.monthly_gp_target_high_gbp || 4000,
          scenarioLiftAnnual: agg.annualGpLift || 0,
          scenarioName: scenarioName || ''
        })
      ].join('');
      return true;
    }

    function rfInit() {
      if (window.rfInitialised) return;
      window.rfInitialised = true;
      rfWireEvents();
      rfFetchSummary();
      rfFetchSeasonality();
      rfFetchTrustLoop();
      // Expose so the Auto-Optimise "Save & Activate" flow (and any
      // future scenario-library activation) can ask Revenue Funnel to
      // re-read its data without forcing a full page reload.
      try { window.rfFetchSummary = rfFetchSummary; } catch (_) { /* ignore */ }
    }

    // 2026-05-20 phase H+: pulls the per-tier seasonality band for the
    // current calendar month + the count of URLs already in monitoring.
    // Renders the banner above the Top 3 cards so the user reads the
    // projected-lift numbers in seasonal context (e.g. "May = peak for
    // workshops, gap for courses winding down").
    function rfTierLabel(tier) {
      const map = {
        courses: 'Courses', academy: 'Academy', services: '1-2-1 / Services',
        hire: 'Hire / Commercial', workshops_nonres: 'Workshops (1-day)',
        workshops_residential: 'Workshops (residential)'
      };
      return map[tier] || tier;
    }
    function rfFmtMul(f) {
      const n = Number(f);
      if (!Number.isFinite(n)) return '';
      const sign = n >= 1 ? '+' : '';
      return sign + Math.round((n - 1) * 100) + '%';
    }
    async function rfFetchSeasonality() {
      const banner = document.getElementById('rf-seasonality-banner');
      if (!banner) return;
      try {
        const r = await fetch('/api/aigeo/revenue-funnel-seasonality?propertyUrl=' + encodeURIComponent('https://www.alanranger.com'));
        if (!r.ok) return;
        const j = await r.json();
        const monthEl = document.getElementById('rf-season-banner-month');
        const monEl   = document.getElementById('rf-season-banner-monitoring');
        const gridEl  = document.getElementById('rf-season-banner-grid');
        const subEl   = document.getElementById('rf-season-banner-sub');
        if (monthEl) monthEl.textContent = j.month_name + ' ' + new Date().getUTCFullYear();
        if (monEl) {
          const m = j.monitoring || {};
          const inMon = m.urls_in_monitoring || 0;
          const byKpi = m.by_kpi || {};
          const parts = [];
          for (const k of Object.keys(byKpi)) parts.push(byKpi[k] + ' ' + k);
          const tail = parts.length ? ' (' + parts.join(', ') + ')' : '';
          monEl.innerHTML = '<strong>' + inMon + ' URLs</strong> already in monitoring' + tail;
        }
        if (gridEl) {
          gridEl.innerHTML = (j.tier_bands || []).map(b => ''
            + '<div class="rf-season-banner-cell is-' + b.band + '">'
            +   '<span class="rf-season-banner-cell-tier">' + rfTierLabel(b.tier_id) + '</span>'
            +   '<span class="rf-season-banner-cell-band">' + (b.label || '') + '</span>'
            +   '<span class="rf-season-banner-cell-mul">x' + Number(b.factor).toFixed(2) + ' (' + rfFmtMul(b.factor) + ')</span>'
            + '</div>').join('');
        }
        if (subEl) {
          const peak = (j.tier_bands || []).filter(b => b.band === 'peak').map(b => rfTierLabel(b.tier_id));
          const gap  = (j.tier_bands || []).filter(b => b.band === 'gap').map(b => rfTierLabel(b.tier_id));
          const bits = [];
          if (peak.length) bits.push('Push: <strong>' + peak.join(', ') + '</strong> while they are in peak.');
          if (gap.length)  bits.push('Defer: <strong>' + gap.join(', ') + '</strong> work to their next peak window.');
          bits.push('Card projected-lift numbers are scaled by these per-tier factors for the current month.');
          if (j.seasonality_calibration) bits.push('<em>' + String(j.seasonality_calibration).replace(/</g, '&lt;') + '</em>');
          subEl.innerHTML = bits.join(' ');
        }
        banner.style.display = '';
      } catch (_) { /* leave banner hidden */ }
    }

    async function rfFetchTrustLoop() {
      const host = document.getElementById('rf-recent-edits');
      const list = document.getElementById('rf-recent-edits-list');
      if (!host || !list) return;
      try {
        const r = await fetch(rfApi('/api/aigeo/revenue-funnel-trust-loop?propertyUrl=' + encodeURIComponent(RF_PROPERTY)));
        if (!r.ok) return;
        const j = await r.json();
        rfState.trustDeltas = j.gsc_deltas_by_path || {};
        const edits = j.recent_edits || [];
        if (edits.length) {
          list.innerHTML = edits.slice(0, 12).map(e => {
            const path = (e.path || e.page_url || '').replace(/^https?:\/\/[^/]+/i, '');
            const d = e.fetched_at ? new Date(e.fetched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
            const delta = (rfState.trustDeltas || {})[path.replace(/\/$/, '') || '/'];
            let tail = '';
            if (delta && delta.ctr_delta_pp != null) {
              tail = ' <span class="rf-edit-meta">CTR ' + (delta.ctr_delta_pp >= 0 ? '+' : '') + delta.ctr_delta_pp + 'pp since monitoring</span>';
            }
            return '<li><strong>' + path + '</strong> edited ' + d + tail + '</li>';
          }).join('');
          host.style.display = '';
        } else {
          host.style.display = 'none';
        }
        const stale = j.urls_needing_gsc_refresh || [];
        if (stale.length && typeof window.refreshGSCDataOnly === 'function' && !rfState.gscTrustRefreshDone) {
          rfState.gscTrustRefreshDone = true;
          try { await window.refreshGSCDataOnly({ silent: true }); } catch (_) { /* non-fatal */ }
        }
        if (typeof rfRenderTopActions === 'function' && rfState.smartCandidates) {
          rfRenderTopActions();
        }
      } catch (_) { /* trust panel optional */ }
    }

    // Initialise when the Revenue Funnel panel becomes visible (it is also the
    // default landing panel, so this fires on first paint too).
    function rfMaybeInitOnPanel() {
      const panel = document.querySelector('.aigeo-panel[data-panel="revenue-funnel"]');
      if (panel && panel.classList.contains('is-active')) rfInit();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', rfMaybeInitOnPanel);
    } else {
      rfMaybeInitOnPanel();
    }

    // Also init on sidebar click (in case the user navigates away and back).
    document.addEventListener('click', (e) => {
      const navBtn = e.target.closest('.aigeo-nav-item[data-panel="revenue-funnel"]');
      if (navBtn) setTimeout(rfMaybeInitOnPanel, 0);
    });

    // Expose for the existing setActivePanel function in case it wants to refresh.
    window.renderRevenueFunnelTab = function () {
      if (window.rfInitialised) {
        rfFetchSummary();
      } else {
        rfInit();
      }
    };

    try { window.rfRenderProfitGoalBarsToHost = rfRenderProfitGoalBarsToHost; } catch (_) { /* ignore */ }
  })();
