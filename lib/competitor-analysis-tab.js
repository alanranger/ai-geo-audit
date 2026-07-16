/**
 * Competitor Analysis tab — client UI (loaded by audit-dashboard.html).
 * Baseline: competitor-analysis-v1
 */
(function () {
  'use strict';

  const BASELINE = Object.freeze({
    schema_version: 1,
    baseline_name: 'competitor-analysis-v1',
    baseline_date: '2026-07-16',
  });

  const MONEY_CLASSES = ['local-money', 'national-money'];
  const NOISE_TYPES = new Set(['platform', 'directory', 'government', 'institution', 'publisher']);
  const AUTO_SUGGEST_THRESHOLD = 10;
  const TOP_RIVALS = 12;

  function api(path) {
    return typeof window.apiUrl === 'function' ? window.apiUrl(path) : path;
  }

  function normDomain(raw) {
    if (!raw) return null;
    let d = String(raw).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!d || !d.includes('.')) return null;
    return d;
  }

  function moneyRows(rows) {
    return (rows || []).filter((r) => MONEY_CLASSES.includes(r.keyword_class || 'national-money'));
  }

  function rivalBeatsUs(el, owner) {
    if (!el || !owner || owner.ours) return false;
    const pos = owner.position != null ? Number(owner.position) : null;
    const ourPos = el.our_position != null ? Number(el.our_position) : null;
    if (pos == null || !Number.isFinite(pos)) return false;
    if (ourPos == null || !Number.isFinite(ourPos)) return true;
    return pos < ourPos;
  }

  function aggregateMoneyRivals(rows) {
    const self = normDomain(typeof getSelfDomainForDomainStrength === 'function'
      ? getSelfDomainForDomainStrength() : 'alanranger.com');
    const rivals = new Map();

    for (const row of moneyRows(rows)) {
      const kw = String(row.keyword || '').trim();
      const stack = Array.isArray(row.serp_surface_stack) ? row.serp_surface_stack : [];
      for (const el of stack) {
        if (!el?.slot || (el.type !== 'organic' && el.type !== 'local_pack')) continue;
        for (const owner of (el.owners || [])) {
          if (owner?.ours) continue;
          const domain = normDomain(owner.domain || owner.name);
          if (!domain || domain === self) continue;
          if (!rivals.has(domain)) {
            rivals.set(domain, {
              domain, beaten: new Set(), organic: 0, pack: 0, hasO: false, hasP: false,
            });
          }
          const rec = rivals.get(domain);
          if (el.type === 'organic') { rec.organic += 1; rec.hasO = true; }
          if (el.type === 'local_pack') { rec.pack += 1; rec.hasP = true; }
          if (rivalBeatsUs(el, owner) && kw) rec.beaten.add(kw);
        }
      }
    }

    return Array.from(rivals.values()).map((r) => ({
      domain: r.domain,
      moneyKwBeaten: r.beaten.size,
      organicAppearances: r.organic,
      packAppearances: r.pack,
      where: r.hasO && r.hasP ? 'both' : r.hasP ? 'pack' : r.hasO ? 'organic' : '—',
    })).sort((a, b) => b.moneyKwBeaten - a.moneyKwBeaten || b.organicAppearances - a.organicAppearances);
  }

  function passesNoise(type, flagged, on) {
    if (!on) return true;
    if (flagged) return true;
    return !NOISE_TYPES.has(type || 'unmapped');
  }

  async function fetchStrengthFull(domains) {
    const out = {};
    const list = [...new Set(domains.map(normDomain).filter(Boolean))];
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25);
      try {
        const qs = encodeURIComponent(chunk.join(','));
        const resp = await fetch(api(`/api/domain-strength/history?domains=${qs}`));
        if (!resp.ok) continue;
        const json = await resp.json();
        const rows = json?.data || [];
        const byDom = {};
        for (const r of rows) {
          const d = normDomain(r.domain);
          if (!d) continue;
          if (!byDom[d]) byDom[d] = { count: 0, latest: null };
          byDom[d].count += 1;
          const prev = byDom[d].latest;
          if (!prev || String(r.snapshot_date) > String(prev.snapshot_date)) {
            byDom[d].latest = r;
          }
        }
        Object.assign(out, byDom);
      } catch (_e) { /* non-fatal */ }
    }
    return out;
  }

  async function fetchTier2(domains) {
    if (!domains.length) return { reviews: [], onpage: [] };
    try {
      const qs = encodeURIComponent(domains.join(','));
      const resp = await fetch(api(`/api/competitor-analysis/tier2?domains=${qs}`));
      if (!resp.ok) return { reviews: [], onpage: [] };
      const json = await resp.json();
      return { reviews: json.reviews || [], onpage: json.onpage || [] };
    } catch (_e) {
      return { reviews: [], onpage: [] };
    }
  }

  function verdictLine(you, them, rival) {
    const gaps = [];
    if ((them.top10 || 0) > (you.top10 || 0) * 1.2) gaps.push('more top-10 keywords');
    if ((them.top3 || 0) > (you.top3 || 0)) gaps.push('more top-3 slots');
    if ((them.score || 0) > (you.score || 0) + 5) gaps.push('stronger domain score');
    if (rival.packAppearances > rival.organicAppearances) gaps.push('local pack presence');
    const gap = gaps[0] || 'surface coverage';
    let attack = 'dedicated local course landing pages with Course/Service schema';
    if (gap.includes('top-10')) attack = 'targeted money-page content clusters for shared keywords';
    if (gap.includes('domain score')) attack = 'authority building + internal links to money pages';
    return `Biggest gap: they have ${gap}. Attack: ${attack}.`;
  }

  function whereBadgeHtml(where) {
    const labels = { both: 'Organic + Pack', organic: 'Organic', pack: 'Pack' };
    return `<span class="ca-where-badge">${labels[where] || where}</span>`;
  }

  function fmtNum(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString();
  }

  function rowBeatenByRival(row) {
    const stack = Array.isArray(row.serp_surface_stack) ? row.serp_surface_stack : [];
    for (const el of stack) {
      if (!el?.slot || (el.type !== 'organic' && el.type !== 'local_pack')) continue;
      for (const owner of (el.owners || [])) {
        if (rivalBeatsUs(el, owner)) return true;
      }
    }
    return false;
  }

  function renderKeywordSurfaces(row) {
    const stack = Array.isArray(row.serp_surface_stack) ? row.serp_surface_stack : [];
    const parts = [];
    for (const type of ['local_pack', 'organic']) {
      const el = stack.find((e) => e.type === type && e.slot != null);
      if (!el) continue;
      const owners = (el.owners || []).slice(0, 3);
      const chips = owners.map((o) => {
        const label = o.name || o.domain || '?';
        const cls = o.ours ? 'ca-own' : 'ca-rival';
        const pos = o.position != null ? `#${o.position}` : '';
        return `<span class="ca-owner ${cls}">${label} ${pos}</span>`;
      }).join('');
      const title = type === 'local_pack' ? 'Map' : 'Organic';
      parts.push(`<div class="ca-kw-surface"><strong>${title}:</strong> ${chips || '—'}</div>`);
    }
    return parts.join('');
  }

  async function confirmFlag(domain, btn) {
    if (!domain) return;
    btn.disabled = true;
    try {
      const resp = await fetch(api('/api/domain-strength/update-domain'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, is_competitor: true }),
      });
      if (!resp.ok) throw new Error('update failed');
      const prev = window.__domainMetadataCache?.get?.(domain) || {};
      if (window.__domainMetadataCache) {
        window.__domainMetadataCache.set(domain, { ...prev, is_competitor: true });
      }
      btn.textContent = 'Flagged';
      btn.classList.add('ca-flagged');
    } catch (_e) {
      btn.disabled = false;
      alert('Could not flag competitor. Try again.');
    }
  }

  async function queueSnapshot(domain, btn) {
    btn.disabled = true;
    btn.textContent = 'Queued…';
    try {
      await fetch(api('/api/competitor-analysis/enqueue-snapshot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      btn.textContent = 'Queued — run snapshot';
    } catch (_e) {
      btn.textContent = 'Queue failed';
      btn.disabled = false;
    }
  }

  async function renderCompetitorAnalysisTab() {
    const state = window.competitorAnalysisState || { independentsOnly: true, kwFilter: 'rival-beats' };
    window.competitorAnalysisState = state;

    const rows = window.RankingAiModule?.state?.()?.combinedRows
      || window.aiSourcesDomainStats && window.RankingAiModule?.getCombinedRows?.()
      || [];
    const mod = window.RankingAiModule;
    const dataRows = mod?.state?.()?.combinedRows || rows;

    const empty = document.getElementById('ca-empty-state');
    const main = document.getElementById('ca-main-sections');
    if (!dataRows.length) {
      if (empty) empty.style.display = 'block';
      if (main) main.style.display = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (main) main.style.display = 'block';

    const rivals = aggregateMoneyRivals(dataRows);
    const domains = rivals.map((r) => r.domain);
    const meta = typeof fetchDomainMetadataForDomains === 'function'
      ? await fetchDomainMetadataForDomains(domains) : {};
    const filtered = rivals.filter((r) => {
      const m = meta[normDomain(r.domain)] || {};
      return passesNoise(m.domain_type, m.is_competitor, state.independentsOnly);
    });

    const top = filtered.slice(0, TOP_RIVALS);
    const topDomains = top.map((r) => r.domain);
    const strength = await fetchStrengthFull(['alanranger.com', ...topDomains]);
    const tier2 = await fetchTier2(topDomains);
    const revMap = new Map((tier2.reviews || []).map((r) => [r.domain, r]));
    const pageMap = new Map();
    for (const p of tier2.onpage || []) {
      if (!pageMap.has(p.domain)) pageMap.set(p.domain, p);
    }

    const selfKey = normDomain(typeof getSelfDomainForDomainStrength === 'function'
      ? getSelfDomainForDomainStrength() : 'alanranger.com');
    const you = strength[selfKey]?.latest || {};

    // Section A — leaderboard
    const lb = document.getElementById('ca-leaderboard-body');
    if (lb) {
      lb.innerHTML = top.length ? top.map((r) => {
        const m = meta[normDomain(r.domain)] || {};
        const suggest = r.moneyKwBeaten >= AUTO_SUGGEST_THRESHOLD && !m.is_competitor;
        const flagBadge = m.is_competitor
          ? '<span class="ca-flag ca-flag--on">Flagged</span>'
          : suggest
            ? `<button type="button" class="ca-suggest-btn" data-domain="${r.domain}">Suggest flag</button>`
            : '';
        return `<tr>
          <td><strong>${r.domain}</strong></td>
          <td>${r.moneyKwBeaten}</td>
          <td>${r.organicAppearances}</td>
          <td>${r.packAppearances}</td>
          <td>${whereBadgeHtml(r.where)}</td>
          <td>${flagBadge}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" class="ranking-table-empty">No rivals on money keywords yet.</td></tr>';

      lb.querySelectorAll('.ca-suggest-btn').forEach((btn) => {
        btn.addEventListener('click', () => confirmFlag(btn.dataset.domain, btn));
      });
    }

    // Section B — authority head-to-head
    const hb = document.getElementById('ca-headtohead-body');
    if (hb) {
      hb.innerHTML = top.length ? top.map((r) => {
        const rec = strength[r.domain];
        const snap = rec?.latest;
        const unmeasured = !rec || rec.count === 0;
        const them = snap ? {
          score: snap.score,
          top3: snap.top3_keywords_raw,
          top10: snap.top10_keywords_raw,
          etv: snap.organic_etv_raw,
          kw: snap.organic_keywords_total_raw,
        } : {};
        const youRow = {
          score: you.score,
          top3: you.top3_keywords_raw,
          top10: you.top10_keywords_raw,
          etv: you.organic_etv_raw,
          kw: you.organic_keywords_total_raw,
        };
        const rev = revMap.get(r.domain);
        const page = pageMap.get(r.domain);
        const revCell = rev?.review_count != null
          ? `Them ${rev.review_count}/${rev.rating ?? '—'}`
          : '<span class="ca-collecting">collecting reviews</span>';
        const pageCell = page?.title
          ? `${page.title.slice(0, 40)}… (${page.word_count || '?'}w)`
          : '<span class="ca-collecting">collecting on-page</span>';

        if (unmeasured) {
          return `<tr class="ca-unmeasured">
            <td><strong>${r.domain}</strong></td>
            <td colspan="5"><em>not yet measured</em>
              <button type="button" class="btn btn-small ca-queue-btn" data-domain="${r.domain}">Queue snapshot</button></td>
            <td>${revCell}</td><td>${pageCell}</td>
            <td>—</td>
          </tr>`;
        }

        const cmp = (a, b) => {
          const av = Number(a) || 0; const bv = Number(b) || 0;
          if (av > bv) return 'ca-lead-you';
          if (bv > av) return 'ca-lead-them';
          return '';
        };
        const v = verdictLine(youRow, them, r);
        return `<tr>
          <td><strong>${r.domain}</strong></td>
          <td class="${cmp(youRow.score, them.score)}">${fmtNum(them.score)} vs ${fmtNum(youRow.score)}</td>
          <td class="${cmp(youRow.kw, them.kw)}">${fmtNum(them.kw)} vs ${fmtNum(youRow.kw)}</td>
          <td class="${cmp(youRow.top3, them.top3)}">${fmtNum(them.top3)} vs ${fmtNum(youRow.top3)}</td>
          <td class="${cmp(youRow.top10, them.top10)}">${fmtNum(them.top10)} vs ${fmtNum(youRow.top10)}</td>
          <td class="${cmp(youRow.etv, them.etv)}">${fmtNum(them.etv)} vs ${fmtNum(youRow.etv)}</td>
          <td>${revCell}</td>
          <td>${pageCell}</td>
          <td class="ca-verdict">${v}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="9" class="ranking-table-empty">No rivals to compare.</td></tr>';

      hb.querySelectorAll('.ca-queue-btn').forEach((btn) => {
        btn.addEventListener('click', () => queueSnapshot(btn.dataset.domain, btn));
      });
    }

    // Section C — per-keyword surfaces
    const kwBody = document.getElementById('ca-keyword-body');
    if (kwBody) {
      let kws = moneyRows(dataRows);
      if (state.kwFilter === 'rival-beats') kws = kws.filter(rowBeatenByRival);
      kws = kws.slice(0, 60);
      kwBody.innerHTML = kws.length ? kws.map((row) => `
        <tr>
          <td>${row.keyword}</td>
          <td>${row.keyword_class || '—'}</td>
          <td>${renderKeywordSurfaces(row)}</td>
        </tr>`).join('') : '<tr><td colspan="3" class="ranking-table-empty">No keywords match filter.</td></tr>';
    }

    // Trigger background Tier-2 collection for top rivals missing data
    const needRev = top.filter((r) => !revMap.has(r.domain)).slice(0, 3);
    const needPage = top.filter((r) => !pageMap.has(r.domain)).slice(0, 2);
    if (needRev.length) {
      fetch(api('/api/competitor-analysis/collect-reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: needRev.map((r) => ({ domain: r.domain })), max: 3 }),
      }).catch(() => {});
    }
    if (needPage.length) {
      fetch(api('/api/competitor-analysis/collect-onpage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: needPage.map((r) => ({ domain: r.domain, url: `https://www.${r.domain}/` })),
          max: 2,
        }),
      }).catch(() => {});
    }

    // Preserve AI citation rollup in collapsed section
    if (typeof renderAiSourcesTab === 'function') renderAiSourcesTab();
  }

  function wireCompetitorAnalysisUi() {
    const toggle = document.getElementById('ca-noise-toggle');
    if (toggle && !toggle.dataset.wired) {
      toggle.dataset.wired = '1';
      toggle.checked = window.competitorAnalysisState?.independentsOnly !== false;
      toggle.addEventListener('change', () => {
        window.competitorAnalysisState = window.competitorAnalysisState || {};
        window.competitorAnalysisState.independentsOnly = toggle.checked;
        renderCompetitorAnalysisTab();
      });
    }
    const kwFilter = document.getElementById('ca-kw-filter');
    if (kwFilter && !kwFilter.dataset.wired) {
      kwFilter.dataset.wired = '1';
      kwFilter.addEventListener('change', () => {
        window.competitorAnalysisState = window.competitorAnalysisState || {};
        window.competitorAnalysisState.kwFilter = kwFilter.value;
        renderCompetitorAnalysisTab();
      });
    }
  }

  window.COMPETITOR_ANALYSIS_BASELINE = BASELINE;
  window.aggregateMoneyRivals = aggregateMoneyRivals;
  window.renderCompetitorAnalysisTab = renderCompetitorAnalysisTab;
  window.wireCompetitorAnalysisUi = wireCompetitorAnalysisUi;
})();
