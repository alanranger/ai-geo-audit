/**
 * Competitor Analysis tab — keyword-driven v3 (loaded by audit-dashboard.html).
 * Baseline: competitor-analysis-v1
 * Keyword universe = live /api/keywords/locked-config (not a stale rankings snapshot).
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

  function api(path) {
    return typeof window.apiUrl === 'function' ? window.apiUrl(path) : path;
  }

  function normDomain(raw) {
    if (!raw) return null;
    let d = String(raw).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!d || !d.includes('.')) return null;
    if (d.endsWith('.google.com') || d === 'google.com' || d === 'youtube.com') return null;
    return d;
  }

  function normKw(kw) {
    return String(kw || '').trim().toLowerCase();
  }

  function selfDomain() {
    return normDomain(
      typeof getSelfDomainForDomainStrength === 'function'
        ? getSelfDomainForDomainStrength()
        : 'alanranger.com'
    ) || 'alanranger.com';
  }

  function surfaceLabel(type) {
    if (type === 'local_pack') return 'Map';
    if (type === 'organic') return 'Organic';
    return type || '—';
  }

  function betterSurface(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.position !== b.position) return a.position < b.position ? a : b;
    if (a.surface === 'local_pack') return a;
    if (b.surface === 'local_pack') return b;
    return a;
  }

  function extractKeywordSurfaces(row, self) {
    const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
    let yourBest = null;
    const rivals = new Map();
    let packHasUs = false;
    let packHasRival = false;
    let hasSerp = false;

    for (const type of ['local_pack', 'organic']) {
      const el = stack.find((e) => e?.type === type && e.slot != null);
      if (!el) continue;
      hasSerp = true;
      const owners = Array.isArray(el.owners) ? el.owners : [];

      if (el.ours || el.our_position != null) {
        const pos = el.our_position != null ? Number(el.our_position) : null;
        if (pos != null && Number.isFinite(pos)) {
          yourBest = betterSurface(yourBest, { surface: type, position: pos, label: surfaceLabel(type) });
          if (type === 'local_pack') packHasUs = true;
        }
      }

      for (const owner of owners) {
        const isOur = owner?.ours === true
          || (normDomain(owner?.domain) === self)
          || (owner?.domain && String(owner.domain).toLowerCase().endsWith('.' + self));
        if (isOur) {
          if (type === 'local_pack') packHasUs = true;
          const pos = owner.position != null ? Number(owner.position) : null;
          if (pos != null && Number.isFinite(pos)) {
            yourBest = betterSurface(yourBest, { surface: type, position: pos, label: surfaceLabel(type) });
          }
          continue;
        }
        const domain = normDomain(owner.domain);
        const name = String(owner.name || domain || '').trim();
        if (!domain && !name) continue;
        const key = domain || name.toLowerCase();
        const pos = owner.position != null ? Number(owner.position) : null;
        if (pos == null || !Number.isFinite(pos)) continue;
        if (type === 'local_pack') packHasRival = true;
        const cand = { domain, name: name || domain, surface: type, position: pos, label: surfaceLabel(type) };
        const prev = rivals.get(key);
        if (!prev || betterSurface(cand, prev) === cand) rivals.set(key, cand);
      }
    }

    return {
      hasSerp,
      yourBest,
      rivals: Array.from(rivals.values()),
      packContested: packHasUs && packHasRival,
    };
  }

  function passesNoise(type, flagged, on) {
    if (!on) return true;
    if (flagged) return true;
    return !NOISE_TYPES.has(type || 'unmapped');
  }

  function topRivals(extracted, meta, independentsOnly, n) {
    const list = (extracted.rivals || []).filter((r) => {
      if (!r.domain) return true;
      const m = meta[r.domain] || {};
      return passesNoise(m.domain_type, m.is_competitor === true, independentsOnly);
    });
    list.sort((a, b) => a.position - b.position || (a.surface === 'local_pack' ? -1 : 1));
    return list.slice(0, n || 3);
  }

  function statusFor(extracted, topRival) {
    if (!extracted.hasSerp) return 'no-serp';
    const you = extracted.yourBest;
    if (topRival && (!you || topRival.position < you.position)) return 'rival-beats';
    if (you && (!topRival || you.position < topRival.position)) return 'you-win';
    if (you && topRival && you.position === topRival.position) return 'tied';
    if (!you && !topRival) return 'no-rival';
    return 'rival-beats';
  }

  function fmtSurface(best) {
    if (!best || best.position == null) return '—';
    return `${best.label} #${best.position}`;
  }

  function statusBadge(status, packContested) {
    const map = {
      'rival-beats': ['Rival beats you', 'ca-status--lose'],
      'you-win': ['You win', 'ca-status--win'],
      tied: ['Tied', 'ca-status--tie'],
      'no-serp': ['No SERP data', 'ca-status--empty'],
      'no-rival': ['No rival', 'ca-status--ok'],
    };
    const [label, cls] = map[status] || [status, ''];
    const pack = packContested ? '<span class="ca-status ca-status--pack">Pack contested</span>' : '';
    return `<span class="ca-status ${cls}">${label}</span>${pack}`;
  }

  function fmtNum(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString();
  }

  async function refreshLockedConfig() {
    try {
      const res = await fetch(api('/api/keywords/locked-config'), { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.by_keyword && typeof applyLockedConfigMaps === 'function') {
        applyLockedConfigMaps(data.by_keyword);
      }
      return data?.by_keyword || null;
    } catch (_e) {
      return null;
    }
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
        for (const r of rows) {
          const d = normDomain(r.domain);
          if (!d) continue;
          if (!out[d]) out[d] = { count: 0, latest: null };
          out[d].count += 1;
          const prev = out[d].latest;
          if (!prev || String(r.snapshot_date) > String(prev.snapshot_date)) out[d].latest = r;
        }
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

  function attackLine(youSnap, themSnap, rivalBest) {
    const gaps = [];
    const you = {
      score: Number(youSnap?.score) || 0,
      top3: Number(youSnap?.top3_keywords_raw) || 0,
      top10: Number(youSnap?.top10_keywords_raw) || 0,
    };
    const them = {
      score: Number(themSnap?.score) || 0,
      top3: Number(themSnap?.top3_keywords_raw) || 0,
      top10: Number(themSnap?.top10_keywords_raw) || 0,
    };
    if (them.top10 > you.top10 * 1.2) gaps.push('more top-10 keywords');
    if (them.top3 > you.top3) gaps.push('more top-3 slots');
    if (them.score > you.score + 5) gaps.push('stronger domain score');
    if (rivalBest?.surface === 'local_pack') gaps.push('local pack presence');
    const gap = gaps[0] || 'surface coverage';
    let attack = 'dedicated local course landing pages with Course/Service schema';
    if (gap.includes('top-10')) attack = 'targeted money-page content clusters for shared keywords';
    if (gap.includes('domain score')) attack = 'authority building + internal links to money pages';
    if (gap.includes('local pack')) attack = 'GBP categories, reviews cadence, and map-pack landing page';
    return `Biggest gap: they have ${gap}. Attack: ${attack}.`;
  }

  function defaultState() {
    return {
      independentsOnly: true,
      classFilter: 'all',
      preset: null,
      selectedKeyword: '',
      sortColumn: 'status',
      sortDir: 'asc',
      tableRows: [],
    };
  }

  function getState() {
    window.competitorAnalysisState = window.competitorAnalysisState || defaultState();
    return window.competitorAnalysisState;
  }

  function buildUniverseRows(byKeyword, combinedRows, meta, independentsOnly) {
    const self = selfDomain();
    const byRow = new Map();
    for (const r of combinedRows || []) {
      byRow.set(normKw(r.keyword), r);
    }

    const keys = Object.keys(byKeyword || {});
    return keys.map((kw) => {
      const cfg = byKeyword[kw] || {};
      const className = cfg.keyword_class
        || window.__KEYWORD_CLASS_LOCKED_BY_KEYWORD?.[kw]
        || 'national-money';
      const row = byRow.get(normKw(kw));
      const extracted = row
        ? extractKeywordSurfaces(row, self)
        : { hasSerp: false, yourBest: null, rivals: [], packContested: false };
      const tops = topRivals(extracted, meta, independentsOnly, 3);
      const top = tops[0] || null;
      const status = statusFor(extracted, top);
      return {
        keyword: kw,
        keyword_class: className,
        tracking_location: cfg.tracking_location || null,
        yourBest: extracted.yourBest,
        topRival: top,
        top3: tops,
        status,
        packContested: extracted.packContested,
        hasSerp: extracted.hasSerp,
        row,
      };
    }).sort((a, b) => a.keyword.localeCompare(b.keyword));
  }

  function applyFilters(rows, state) {
    let out = rows.slice();
    if (state.classFilter && state.classFilter !== 'all') {
      out = out.filter((r) => r.keyword_class === state.classFilter);
    }
    if (state.preset === 'rivals-beating') out = out.filter((r) => r.status === 'rival-beats');
    if (state.preset === 'pack-battles') out = out.filter((r) => r.packContested);
    if (state.preset === 'winning') out = out.filter((r) => r.status === 'you-win');
    if (state.preset === 'coventry-money') {
      out = out.filter((r) => r.keyword_class === 'local-money');
    }
    if (state.selectedKeyword) {
      // Keep full filtered set for table; selection only drives detail panel
    }
    return out;
  }

  function sortRows(rows, col, dir) {
    const mul = dir === 'desc' ? -1 : 1;
    const statusOrder = { 'rival-beats': 0, tied: 1, 'you-win': 2, 'no-rival': 3, 'no-serp': 4 };
    return rows.slice().sort((a, b) => {
      let av;
      let bv;
      switch (col) {
        case 'keyword': av = a.keyword; bv = b.keyword; break;
        case 'class': av = a.keyword_class; bv = b.keyword_class; break;
        case 'yours': av = a.yourBest?.position ?? 999; bv = b.yourBest?.position ?? 999; break;
        case 'rival': av = a.topRival?.domain || a.topRival?.name || ''; bv = b.topRival?.domain || b.topRival?.name || ''; break;
        case 'theirs': av = a.topRival?.position ?? 999; bv = b.topRival?.position ?? 999; break;
        case 'status':
        default:
          av = statusOrder[a.status] ?? 9;
          bv = statusOrder[b.status] ?? 9;
          break;
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return a.keyword.localeCompare(b.keyword);
    });
  }

  function renderTiles(universe, filtered, state) {
    const el = document.getElementById('ca-tiles');
    if (!el) return;
    const total = universe.length || 120;
    const money = universe.filter((r) => MONEY_CLASSES.includes(r.keyword_class));
    const rivalWins = money.filter((r) => r.status === 'rival-beats').length;
    const youWin = universe.filter((r) => r.status === 'you-win').length;
    const pack = universe.filter((r) => r.packContested).length;

    const beatenCounts = new Map();
    for (const r of money) {
      if (r.status !== 'rival-beats' || !r.topRival?.domain) continue;
      const d = r.topRival.domain;
      beatenCounts.set(d, (beatenCounts.get(d) || 0) + 1);
    }
    let topRival = '—';
    let topN = 0;
    for (const [d, n] of beatenCounts) {
      if (n > topN) { topN = n; topRival = d; }
    }

    const pill = (value, label, footer) => `
      <div class="metric-pill metric-pill--neutral">
        <div class="metric-pill-value">${value}</div>
        <div class="metric-pill-label">${label}</div>
        <div class="metric-pill-footer">${footer}</div>
      </div>`;

    el.innerHTML = [
      pill(`${rivalWins}/${total}`, 'Money KWs a rival wins', 'Tracked keywords where a rival beats you on organic or map.'),
      pill(topRival === '—' ? '—' : topRival, 'Top independent rival', topN ? `Bests you on ${topN} money keywords` : 'No clear leader yet'),
      pill(String(youWin), 'You win outright', 'Keywords where your best surface position beats the top rival.'),
      pill(String(pack), 'Pack contested', 'Map pack shows both you and at least one rival.'),
    ].join('');
  }

  function fillKeywordDropdown(universe, selected) {
    const sel = document.getElementById('ca-keyword-select');
    if (!sel) return;
    const cur = selected || '';
    sel.innerHTML = '<option value="">All keywords (pick one for detail)</option>'
      + universe.map((r) => `<option value="${r.keyword.replace(/"/g, '&quot;')}">${r.keyword}</option>`).join('');
    sel.value = cur;
  }

  function renderTable(rows, state) {
    const body = document.getElementById('ca-keyword-table-body');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="ranking-table-empty">No keywords match the current filters.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => {
      const rivalLabel = r.topRival
        ? (r.topRival.domain || r.topRival.name)
        : '—';
      const sel = state.selectedKeyword && normKw(state.selectedKeyword) === normKw(r.keyword);
      return `<tr class="ca-kw-row${sel ? ' is-selected' : ''}" data-keyword="${r.keyword.replace(/"/g, '&quot;')}">
        <td>${r.keyword}</td>
        <td>${r.keyword_class}</td>
        <td>${fmtSurface(r.yourBest)}</td>
        <td>${rivalLabel}</td>
        <td>${fmtSurface(r.topRival)}</td>
        <td>${statusBadge(r.status, r.packContested)}</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.ca-kw-row').forEach((tr) => {
      tr.addEventListener('click', () => {
        state.selectedKeyword = tr.dataset.keyword || '';
        const sel = document.getElementById('ca-keyword-select');
        if (sel) sel.value = state.selectedKeyword;
        renderTable(rows, state);
        renderDetail(state);
      });
    });
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
      btn.textContent = 'Queued';
    } catch (_e) {
      btn.textContent = 'Queue failed';
      btn.disabled = false;
    }
  }

  async function renderDetail(state) {
    const panel = document.getElementById('ca-detail-panel');
    const title = document.getElementById('ca-detail-title');
    const tiles = document.getElementById('ca-detail-tiles');
    const attackEl = document.getElementById('ca-detail-attack');
    if (!panel || !tiles) return;

    const kw = state.selectedKeyword;
    if (!kw) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    if (title) title.textContent = `You vs top 3 — ${kw}`;

    const row = (state.tableRows || []).find((r) => normKw(r.keyword) === normKw(kw))
      || (state.universeRows || []).find((r) => normKw(r.keyword) === normKw(kw));
    if (!row) {
      tiles.innerHTML = '<p class="ranking-table-empty">Keyword not in current universe.</p>';
      return;
    }

    const self = selfDomain();
    const domains = [self, ...row.top3.map((t) => t.domain).filter(Boolean)];
    const strength = await fetchStrengthFull(domains);
    const tier2 = await fetchTier2(domains.filter((d) => d !== self));
    const revMap = new Map((tier2.reviews || []).map((r) => [r.domain, r]));
    const pageMap = new Map();
    for (const p of tier2.onpage || []) {
      if (!pageMap.has(p.domain)) pageMap.set(p.domain, p);
    }
    const meta = typeof fetchDomainMetadataForDomains === 'function'
      ? await fetchDomainMetadataForDomains(domains.filter((d) => d !== self))
      : {};

    const youSnap = strength[self]?.latest;
    const cards = [];

    cards.push(renderEntityCard({
      label: 'You',
      domain: self,
      best: row.yourBest,
      snap: youSnap,
      measured: !!(strength[self]?.count),
      review: null,
      page: null,
      isYou: true,
      suggest: false,
    }));

    for (let i = 0; i < 3; i++) {
      const rival = row.top3[i];
      if (!rival) {
        cards.push(`<div class="ca-vs-card ca-vs-empty"><div class="ca-vs-label">Rival #${i + 1}</div><p>No rival</p></div>`);
        continue;
      }
      const d = rival.domain;
      const snap = d ? strength[d]?.latest : null;
      const measured = d ? !!(strength[d]?.count) : false;
      const m = d ? (meta[d] || {}) : {};
      const beaten = (state.universeRows || []).filter(
        (u) => MONEY_CLASSES.includes(u.keyword_class) && u.status === 'rival-beats' && u.topRival?.domain === d
      ).length;
      cards.push(renderEntityCard({
        label: `Rival #${i + 1}`,
        domain: d || rival.name,
        best: rival,
        snap,
        measured,
        review: d ? revMap.get(d) : null,
        page: d ? pageMap.get(d) : null,
        isYou: false,
        suggest: d && beaten >= AUTO_SUGGEST_THRESHOLD && !m.is_competitor,
        beaten,
      }));
    }

    tiles.innerHTML = cards.join('');
    tiles.querySelectorAll('.ca-suggest-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmFlag(btn.dataset.domain, btn);
      });
    });
    tiles.querySelectorAll('.ca-queue-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        queueSnapshot(btn.dataset.domain, btn);
      });
    });

    const top = row.top3[0];
    const themSnap = top?.domain ? strength[top.domain]?.latest : null;
    if (attackEl) {
      attackEl.textContent = top
        ? attackLine(youSnap, themSnap, top)
        : 'No rival on this keyword — defend your position with content freshness and GBP signals.';
    }

    // Background Tier-2 for missing (small batches; cron fills the rest)
    const needRev = row.top3.filter((t) => t.domain && !revMap.has(t.domain)).slice(0, 2);
    if (needRev.length) {
      fetch(api('/api/competitor-analysis/collect-reviews'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domains: needRev.map((t) => ({ domain: t.domain, keyword: kw })),
          max: 2,
        }),
      }).catch(() => {});
    }
    const needPage = row.top3.filter((t) => t.domain && !pageMap.has(t.domain)).slice(0, 1);
    if (needPage.length) {
      fetch(api('/api/competitor-analysis/collect-onpage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pages: needPage.map((t) => ({
            domain: t.domain,
            url: `https://www.${t.domain}/`,
            keyword: kw,
          })),
          max: 1,
        }),
      }).catch(() => {});
    }
  }

  function renderEntityCard(opts) {
    const {
      label, domain, best, snap, measured, review, page, isYou, suggest,
    } = opts;
    const scoreCell = measured && snap
      ? `Score ${fmtNum(snap.score)} · Top3 ${fmtNum(snap.top3_keywords_raw)} · Top10 ${fmtNum(snap.top10_keywords_raw)}`
      : `<em>n/a — not yet measured</em>${!isYou && domain?.includes('.')
        ? ` <button type="button" class="btn btn-small ca-queue-btn" data-domain="${domain}">Queue snapshot</button>`
        : ''}`;
    const revCell = isYou
      ? '—'
      : (review?.review_count != null
        ? `${review.review_count} reviews · ${review.rating ?? '—'}★`
        : '<span class="ca-collecting">collecting reviews</span>');
    const pageCell = isYou
      ? '—'
      : (page?.title
        ? `${String(page.title).slice(0, 48)}${page.title.length > 48 ? '…' : ''} (${page.word_count || '?'}w)`
        : '<span class="ca-collecting">collecting on-page</span>');
    const suggestBtn = suggest
      ? `<button type="button" class="ca-suggest-btn" data-domain="${domain}">Suggest flag</button>`
      : '';

    return `<div class="ca-vs-card${isYou ? ' ca-vs-you' : ''}">
      <div class="ca-vs-label">${label}</div>
      <div class="ca-vs-domain">${domain || '—'}</div>
      <div class="ca-vs-pos">${fmtSurface(best)}</div>
      <div class="ca-vs-auth">${scoreCell}</div>
      <div class="ca-vs-meta">${revCell}</div>
      <div class="ca-vs-meta">${pageCell}</div>
      ${suggestBtn}
    </div>`;
  }

  function setPresetActive(preset) {
    document.querySelectorAll('.ca-preset').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.preset === preset);
    });
  }

  async function renderCompetitorAnalysisTab() {
    const state = getState();
    const empty = document.getElementById('ca-empty-state');
    const main = document.getElementById('ca-main-sections');

    const byKeyword = await refreshLockedConfig();
    const mod = window.RankingAiModule;
    const combinedRows = mod?.state?.()?.combinedRows || [];

    if (!byKeyword || !Object.keys(byKeyword).length) {
      if (empty) {
        empty.style.display = 'block';
        empty.innerHTML = '<div class="card"><div class="card-body ranking-table-empty">Could not load locked keyword config. Check <code>/api/keywords/locked-config</code>.</div></div>';
      }
      if (main) main.style.display = 'none';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (main) main.style.display = 'block';

    // Collect domains for metadata (noise filter)
    const probe = [];
    for (const r of combinedRows) {
      const ex = extractKeywordSurfaces(r, selfDomain());
      for (const riv of ex.rivals) if (riv.domain) probe.push(riv.domain);
    }
    const meta = typeof fetchDomainMetadataForDomains === 'function'
      ? await fetchDomainMetadataForDomains([...new Set(probe)])
      : {};

    const universe = buildUniverseRows(byKeyword, combinedRows, meta, state.independentsOnly);
    state.universeRows = universe;

    let filtered = applyFilters(universe, state);
    filtered = sortRows(filtered, state.sortColumn, state.sortDir);
    state.tableRows = filtered;

    renderTiles(universe, filtered, state);
    fillKeywordDropdown(universe, state.selectedKeyword);
    renderTable(filtered, state);
    await renderDetail(state);

    const countEl = document.getElementById('ca-universe-count');
    if (countEl) countEl.textContent = `${universe.length} tracked keywords from locked-config · showing ${filtered.length}`;

    if (typeof renderAiSourcesTab === 'function') renderAiSourcesTab();
  }

  function wireCompetitorAnalysisUi() {
    const state = getState();

    const noise = document.getElementById('ca-noise-toggle');
    if (noise && !noise.dataset.wired) {
      noise.dataset.wired = '1';
      noise.checked = state.independentsOnly !== false;
      noise.addEventListener('change', () => {
        state.independentsOnly = noise.checked;
        renderCompetitorAnalysisTab();
      });
    }

    const classSel = document.getElementById('ca-class-filter');
    if (classSel && !classSel.dataset.wired) {
      classSel.dataset.wired = '1';
      classSel.value = state.classFilter || 'all';
      classSel.addEventListener('change', () => {
        state.classFilter = classSel.value;
        state.preset = null;
        setPresetActive(null);
        renderCompetitorAnalysisTab();
      });
    }

    const kwSel = document.getElementById('ca-keyword-select');
    if (kwSel && !kwSel.dataset.wired) {
      kwSel.dataset.wired = '1';
      kwSel.addEventListener('change', () => {
        state.selectedKeyword = kwSel.value || '';
        renderTable(state.tableRows || [], state);
        renderDetail(state);
      });
    }

    document.querySelectorAll('.ca-preset').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const p = btn.dataset.preset;
        state.preset = state.preset === p ? null : p;
        setPresetActive(state.preset);
        if (state.preset === 'coventry-money') {
          state.classFilter = 'local-money';
          if (classSel) classSel.value = 'local-money';
        }
        renderCompetitorAnalysisTab();
      });
    });

    const clearBtn = document.getElementById('ca-filters-clear');
    if (clearBtn && !clearBtn.dataset.wired) {
      clearBtn.dataset.wired = '1';
      clearBtn.addEventListener('click', () => {
        state.preset = null;
        state.classFilter = 'all';
        state.selectedKeyword = '';
        state.independentsOnly = true;
        setPresetActive(null);
        if (classSel) classSel.value = 'all';
        if (noise) noise.checked = true;
        if (kwSel) kwSel.value = '';
        renderCompetitorAnalysisTab();
      });
    }

    document.querySelectorAll('#ca-keyword-table th[data-sort]').forEach((th) => {
      if (th.dataset.wired) return;
      th.dataset.wired = '1';
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.sortColumn === col) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = col;
          state.sortDir = col === 'status' ? 'asc' : 'asc';
        }
        renderCompetitorAnalysisTab();
      });
    });
  }

  window.COMPETITOR_ANALYSIS_BASELINE = BASELINE;
  window.renderCompetitorAnalysisTab = renderCompetitorAnalysisTab;
  window.wireCompetitorAnalysisUi = wireCompetitorAnalysisUi;
})();
