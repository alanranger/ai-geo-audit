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
  // Independents-only hides aggregators + unclassified fallback sites
  const NOISE_TYPES = new Set(['platform', 'directory', 'government', 'institution', 'publisher', 'vendor']);
  const HARD_NOISE_DOMAINS = new Set([
    'skillshare.com', 'udemy.com', 'coursera.org', 'alison.com', 'edx.org', 'futurelearn.com',
    'eventbrite.com', 'eventbrite.co.uk', 'adobe.com', 'lightroom.adobe.com', 'visualeducation.com',
    'youtube.com', 'facebook.com', 'instagram.com', 'reddit.com', 'groupon.com', 'groupon.co.uk',
    'notonthehighstreet.com', 'virginexperiencedays.co.uk', 'classbento.co.uk', 'classbento.com',
    'photobox.co.uk', 'photobox.com',
  ]);
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

  function isHardNoiseDomain(domain) {
    if (!domain) return false;
    if (HARD_NOISE_DOMAINS.has(domain)) return true;
    for (const root of HARD_NOISE_DOMAINS) {
      if (domain.endsWith('.' + root)) return true;
    }
    return false;
  }

  function passesRealCompetitor(type, flagged, on, source) {
    if (!on) return true;
    if (flagged) return true;
    const t = type || 'unmapped';
    if (source === 'fallback') return false;
    if (t === 'unmapped') return false;
    if (NOISE_TYPES.has(t)) return false;
    return t === 'site';
  }

  function passesNoise(type, flagged, on, source, domain) {
    if (!on) return true;
    if (isHardNoiseDomain(domain)) return false;
    return passesRealCompetitor(type, flagged, on, source);
  }

  function topRivals(extracted, meta, independentsOnly, n) {
    const list = (extracted.rivals || []).filter((r) => {
      if (!r.domain) return !independentsOnly;
      const m = meta[r.domain] || {};
      return passesNoise(
        m.domain_type,
        m.is_competitor === true,
        independentsOnly,
        m.domain_type_source,
        r.domain
      );
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
    return Math.round(Number(n)).toLocaleString();
  }

  function fmtStrength(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toFixed(1);
  }

  function buildAiCiteMap(combinedRows) {
    const citeBy = {};
    if (typeof aggregateAiDomainStats !== 'function') return citeBy;
    const stats = aggregateAiDomainStats(combinedRows, selfDomain()) || [];
    for (const s of stats) {
      const d = normDomain(s.domain);
      if (d) citeBy[d] = s;
    }
    return citeBy;
  }

  async function fetchOverviewItems() {
    if (typeof fetchDomainStrengthOverview === 'function') {
      return fetchDomainStrengthOverview();
    }
    try {
      const resp = await fetch(api(`/api/domain-strength/overview?ts=${Date.now()}`), { cache: 'no-store' });
      if (!resp.ok) return [];
      const json = await resp.json();
      return json?.status === 'ok' ? (json.items || []) : [];
    } catch (_e) {
      return [];
    }
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

  function posLabel(type) {
    if (type === 'local_pack') return 'Map pack';
    if (type === 'organic') return 'Organic';
    return type || 'Surface';
  }

  function isOurOwner(owner, self) {
    if (!owner) return false;
    if (owner.ours === true) return true;
    const d = normDomain(owner.domain);
    return d && self && (d === self || d.endsWith('.' + self));
  }

  /** Per-surface you + rival positions from serp_surface_stack (mock v5). */
  function buildSurfaceSplit(row, self, meta, independentsOnly) {
    const stack = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack : [];
    const surfaces = [];
    for (const type of ['local_pack', 'organic']) {
      const slots = stack.filter((e) => e?.type === type && e.slot != null);
      if (!slots.length) continue;
      let youPos = null;
      const rivalMap = new Map();
      for (const el of slots) {
        if (el.ours || el.our_position != null) {
          const p = Number(el.our_position);
          if (Number.isFinite(p) && (youPos == null || p < youPos)) youPos = p;
        }
        for (const owner of Array.isArray(el.owners) ? el.owners : []) {
          if (isOurOwner(owner, self)) {
            const p = Number(owner.position);
            if (Number.isFinite(p) && (youPos == null || p < youPos)) youPos = p;
            continue;
          }
          const domain = normDomain(owner.domain);
          const name = String(owner.name || domain || '').trim();
          if (!domain && !name) continue;
          if (domain) {
            const m = meta[domain] || {};
            if (!passesNoise(m.domain_type, m.is_competitor === true, independentsOnly, m.domain_type_source, domain)) continue;
          }
          const p = Number(owner.position);
          if (!Number.isFinite(p)) continue;
          const key = domain || name.toLowerCase();
          const prev = rivalMap.get(key);
          if (!prev || p < prev.position) {
            rivalMap.set(key, { domain, name: name || domain, position: p });
          }
        }
      }
      const rivals = Array.from(rivalMap.values()).sort((a, b) => a.position - b.position);
      surfaces.push({ type, label: posLabel(type), youPos, rivals });
    }
    return surfaces;
  }

  function compareSurface(youPos, rivalPos) {
    if (youPos == null && rivalPos == null) return 'tie';
    if (youPos == null) return 'lose';
    if (rivalPos == null) return 'win';
    if (youPos < rivalPos) return 'win';
    if (youPos > rivalPos) return 'lose';
    return 'tie';
  }

  function howTheyBeatYou(surfaces, topRivalDomain) {
    const pack = surfaces.find((s) => s.type === 'local_pack');
    const organic = surfaces.find((s) => s.type === 'organic');
    const topR = (surf) => {
      const hit = surf?.rivals?.find((r) => r.domain === topRivalDomain) || surf?.rivals?.[0];
      return hit?.position ?? null;
    };
    const packCmp = pack ? compareSurface(pack.youPos, topR(pack)) : null;
    const orgCmp = organic ? compareSurface(organic.youPos, topR(organic)) : null;
    const packLose = packCmp === 'lose';
    const orgLose = orgCmp === 'lose';
    const packWin = packCmp === 'win';
    const orgWin = orgCmp === 'win';
    if (packLose && orgWin) {
      return 'They beat you purely in the map pack — GBP problem. Lever: GBP categories, review cadence, proximity/NAP.';
    }
    if (orgLose && (packWin || packCmp === 'tie' || pack?.youPos != null)) {
      return 'They beat you in organic — content/authority. Lever: ranking pages, on-page, links.';
    }
    if (packLose && orgLose) {
      return 'They beat you on both map pack and organic. Levers: GBP signals plus money-page content and authority.';
    }
    if (packLose) {
      return 'Map pack gap — GBP problem (local signals, not domain authority). Lever: GBP categories, review cadence, proximity/NAP.';
    }
    if (orgLose) {
      return 'Organic gap — content/authority. Lever: ranking pages, on-page, links.';
    }
    return 'No clear surface loss on this keyword — defend with freshness and GBP signals.';
  }

  function fmtPosCell(pos, outcome) {
    if (pos == null) return '<span class="ca-pos ca-pos--lose">not present</span>';
    const cls = outcome === 'win' ? 'ca-pos--win' : outcome === 'lose' ? 'ca-pos--lose' : 'ca-pos--tie';
    return `<span class="ca-pos ${cls}">#${pos}</span>`;
  }

  function renderSurfaceSplitHtml(surfaces, topRivalDomain) {
    if (!surfaces.length) {
      return '<p class="ranking-table-empty">No SERP surface data for this keyword.</p>';
    }
    const rows = surfaces.map((s) => {
      const ordered = [...(s.rivals || [])].sort((a, b) => {
        if (a.domain === topRivalDomain) return -1;
        if (b.domain === topRivalDomain) return 1;
        return a.position - b.position;
      }).slice(0, 3);
      const topR = ordered[0];
      const rPos = topR?.position ?? null;
      const youOutcome = compareSurface(s.youPos, rPos);
      const rivalLabel = ordered.length
        ? ordered.map((r) => {
          const outcome = compareSurface(s.youPos, r.position);
          const rOut = outcome === 'win' ? 'lose' : outcome === 'lose' ? 'win' : 'tie';
          return `${r.domain || r.name} ${fmtPosCell(r.position, rOut)}`;
        }).join('<br>')
        : '<span class="ca-pos ca-pos--tie">no rival</span>';
      return `<tr>
        <td style="text-align:left">${s.label}</td>
        <td>${fmtPosCell(s.youPos, youOutcome)}</td>
        <td style="text-align:left">${rivalLabel}</td>
      </tr>`;
    }).join('');
    return `<table class="ca-surface-table ranking-table">
      <thead><tr>
        <th style="text-align:left !important"><div style="text-align:left !important;justify-content:flex-start !important">Surface</div></th>
        <th><div>You</div></th>
        <th style="text-align:left !important"><div style="text-align:left !important;justify-content:flex-start !important">Top rival(s)</div></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function googleSerpUrl(keyword) {
    const q = encodeURIComponent(String(keyword || '').trim());
    return `https://www.google.co.uk/search?q=${q}&hl=en&gl=uk&pws=0&num=10`;
  }

  function chromeIncognitoCommand(url) {
    return `start chrome --incognito "${url}"`;
  }

  function wireDetailSerpActions(keyword) {
    const url = googleSerpUrl(keyword);
    const serpBtn = document.getElementById('ca-detail-serp-btn');
    if (serpBtn) {
      serpBtn.href = url;
      serpBtn.setAttribute('aria-label', `Check Google SERP for ${keyword}`);
    }
    const incognitoBtn = document.getElementById('ca-detail-incognito-btn');
    if (incognitoBtn && !incognitoBtn.dataset.wired) {
      incognitoBtn.dataset.wired = '1';
      incognitoBtn.addEventListener('click', async () => {
        const href = document.getElementById('ca-detail-serp-btn')?.href || googleSerpUrl(getState().selectedKeyword);
        const cmd = chromeIncognitoCommand(href);
        try {
          await navigator.clipboard.writeText(cmd);
          const prev = incognitoBtn.textContent;
          incognitoBtn.textContent = 'Copied — paste in Win+R';
          setTimeout(() => { incognitoBtn.textContent = prev; }, 2200);
        } catch (_e) {
          window.prompt('Copy this command, then paste into Win+R:', cmd);
        }
      });
    }
  }

  function rivalDeltaMarker(youVal, themVal) {
    if (youVal == null || themVal == null) return '';
    if (themVal > youVal) {
      return '<span class="ca-delta ca-delta--lose" title="beats you">▲</span>'
        + '<span class="ca-delta-hint ca-delta-hint--lose">beats you</span>';
    }
    if (themVal < youVal) {
      return '<span class="ca-delta ca-delta--win" title="you lead">▼</span>'
        + '<span class="ca-delta-hint ca-delta-hint--win">you lead</span>';
    }
    return '';
  }

  function authMetricRow(label, valueHtml) {
    return `<div class="ca-auth-row"><span class="ca-auth-label">${label}</span><strong class="ca-auth-value">${valueHtml}</strong></div>`;
  }

  function renderAuthorityTile(opts) {
    const {
      label, domain, snap, measured, review, page, isYou, suggest, youSnap,
      aiCite, isFlagged, needsQueue,
    } = opts;
    const rows = [];
    const delta = (youVal, themVal) => (isYou ? '' : rivalDeltaMarker(youVal, themVal));

    if (measured && snap?.score != null) {
      const them = Number(snap.score);
      const you = youSnap?.score != null ? Number(youSnap.score) : null;
      rows.push(authMetricRow('Domain strength', `${fmtStrength(them)}${delta(you, them)}`));
    } else if (!isYou && domain?.includes('.')) {
      rows.push(authMetricRow(
        'Domain strength',
        '<em class="ca-muted">not yet measured</em>'
      ));
    } else if (isYou && !measured) {
      rows.push(authMetricRow('Domain strength', '<em class="ca-muted">not yet measured</em>'));
    }

    if (measured && snap?.organic_keywords_total_raw != null) {
      const them = Number(snap.organic_keywords_total_raw);
      const you = youSnap?.organic_keywords_total_raw != null ? Number(youSnap.organic_keywords_total_raw) : null;
      rows.push(authMetricRow('Total keywords', `${fmtNum(them)}${delta(you, them)}`));
    }
    if (measured && snap?.top3_keywords_raw != null) {
      const them = Number(snap.top3_keywords_raw);
      const you = youSnap?.top3_keywords_raw != null ? Number(youSnap.top3_keywords_raw) : null;
      rows.push(authMetricRow('Top-3 keywords', `${fmtNum(them)}${delta(you, them)}`));
    }
    if (measured && snap?.top10_keywords_raw != null) {
      const them = Number(snap.top10_keywords_raw);
      const you = youSnap?.top10_keywords_raw != null ? Number(youSnap.top10_keywords_raw) : null;
      rows.push(authMetricRow('Top-10 keywords', `${fmtNum(them)}${delta(you, them)}`));
    }

    const citeCount = aiCite?.total_citations;
    if (citeCount != null && Number(citeCount) > 0) {
      const them = Number(citeCount);
      const you = aiCite?.youCitations;
      rows.push(authMetricRow(
        'AI citations',
        `${fmtNum(them)}${!isYou && you != null ? delta(you, them) : ''}`
      ));
    } else if (domain) {
      rows.push(authMetricRow('AI citations', '<em class="ca-muted">—</em>'));
    }

    if (!isYou) {
      if (review?.review_count != null) {
        rows.push(authMetricRow('GBP reviews', `${fmtNum(review.review_count)} · ${review.rating ?? '?'}★`));
      } else if (review && review.reason === 'no_pack_match_or_rating') {
        rows.push(authMetricRow('GBP reviews', '<em class="ca-muted">no GBP listing</em>'));
      }
      if (page?.title) {
        const fullTitle = String(page.title).replace(/"/g, '&quot;');
        const shortTitle = fullTitle.length > 42 ? `${fullTitle.slice(0, 42)}…` : fullTitle;
        rows.push(authMetricRow(
          'Page',
          `<span class="ca-page-title" title="${fullTitle}">${shortTitle}</span>`
        ));
        rows.push(authMetricRow('On-page (words)', fmtNum(page.word_count)));
      }
    }

    const footer = [];
    if (needsQueue && domain?.includes('.')) {
      footer.push(`<button type="button" class="btn btn-small btn-secondary ca-queue-btn" data-domain="${domain}">Queue snapshot</button>`);
    }
    if (suggest) {
      footer.push(`<button type="button" class="ca-suggest-btn" data-domain="${domain}">Suggest flag</button>`);
    }
    if (isFlagged) {
      footer.push('<span class="ca-flagged-chip" title="Confirmed competitor">Flagged</span>');
    }

    return `<div class="ca-vs-card${isYou ? ' ca-vs-you' : ''}">
      <div class="ca-vs-label">${label}</div>
      <div class="ca-vs-domain">${domain || '—'}</div>
      <div class="ca-vs-rows">${rows.join('') || '<p class="ca-vs-empty">No authority data yet.</p>'}</div>
      ${footer.length ? `<div class="ca-tile-footer">${footer.join('')}</div>` : ''}
    </div>`;
  }

  function defaultState() {
    return {
      independentsOnly: true,
      classFilter: 'all',
      preset: null,
      selectedKeyword: '',
      sortColumn: 'status',
      sortDir: 'asc',
      lbSortColumn: 'strength',
      lbSortDir: 'desc',
      tableRows: [],
      currentPage: 1,
      rowsPerPage: 25,
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
      const volRaw = row?.search_volume;
      const searchVolume = (volRaw == null || volRaw === '') ? null : Number(volRaw);
      return {
        keyword: kw,
        keyword_class: className,
        tracking_location: cfg.tracking_location || null,
        search_volume: Number.isFinite(searchVolume) ? searchVolume : null,
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

  function typeLabel(t) {
    if (typeof getDomainTypeLabel === 'function') return getDomainTypeLabel(t) || t || '—';
    if (!t || t === 'unmapped') return 'Unmapped';
    return String(t).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }

  async function enrichRivalColumns(universe, meta, combinedRows) {
    const domains = [...new Set(universe.map((r) => r.topRival?.domain).filter(Boolean))];
    const strength = await fetchStrengthFull(domains);
    const citeBy = buildAiCiteMap(combinedRows);
    for (const r of universe) {
      const d = r.topRival?.domain || null;
      const m = d ? (meta[d] || {}) : {};
      const cite = d ? (citeBy[d] || {}) : {};
      const snap = d ? strength[d]?.latest : null;
      r.rivalCols = {
        domain_type: m.domain_type || (d ? 'unmapped' : null),
        is_competitor: m.is_competitor === true,
        rank: snap?.score != null && Number.isFinite(Number(snap.score)) ? Number(snap.score) : null,
        citations: Number(cite.total_citations) || 0,
        ai_keywords: Number(cite.keyword_count) || 0,
        share: Number(cite.share_of_citations) || 0,
      };
    }
  }

  function sortRows(rows, col, dir) {
    const mul = dir === 'desc' ? -1 : 1;
    const statusOrder = { 'rival-beats': 0, tied: 1, 'you-win': 2, 'no-rival': 3, 'no-serp': 4 };
    return rows.slice().sort((a, b) => {
      let av;
      let bv;
      const ac = a.rivalCols || {};
      const bc = b.rivalCols || {};
      switch (col) {
        case 'keyword': av = a.keyword; bv = b.keyword; break;
        case 'class': av = a.keyword_class; bv = b.keyword_class; break;
        case 'volume': av = a.search_volume ?? -1; bv = b.search_volume ?? -1; break;
        case 'yours': av = a.yourBest?.position ?? 999; bv = b.yourBest?.position ?? 999; break;
        case 'rival': av = a.topRival?.domain || a.topRival?.name || ''; bv = b.topRival?.domain || b.topRival?.name || ''; break;
        case 'theirs': av = a.topRival?.position ?? 999; bv = b.topRival?.position ?? 999; break;
        case 'domain_type': av = ac.domain_type || ''; bv = bc.domain_type || ''; break;
        case 'competitor': av = ac.is_competitor ? 1 : 0; bv = bc.is_competitor ? 1 : 0; break;
        case 'rank': av = ac.rank ?? -1; bv = bc.rank ?? -1; break;
        case 'citations': av = ac.citations || 0; bv = bc.citations || 0; break;
        case 'ai_keywords': av = ac.ai_keywords || 0; bv = bc.ai_keywords || 0; break;
        case 'share': av = ac.share || 0; bv = bc.share || 0; break;
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

  function volumeBadgeHtml(vol) {
    if (vol == null || !Number.isFinite(Number(vol))) {
      return '<span class="ranking-badge-volume ranking-badge-volume--none">—</span>';
    }
    const n = Number(vol);
    let rag = 'ranking-badge-volume--low';
    let label = 'Low';
    if (n > 200) { rag = 'ranking-badge-volume--high'; label = 'High'; }
    else if (n > 50) { rag = 'ranking-badge-volume--med'; label = 'Med'; }
    return `<span class="ranking-badge-volume ${rag}">${n.toLocaleString()} ${label}</span>`;
  }

  function classPillHtml(cls) {
    const c = cls || 'national-money';
    let mod = '';
    if (c === 'local-money') mod = ' ca-class-pill--local';
    if (c === 'brand') mod = ' ca-class-pill--brand';
    const short = c === 'local-money' ? 'Local' : c === 'national-money' ? 'National' : c === 'brand' ? 'Brand' : c;
    return `<span class="ca-class-pill${mod}">${short}</span>`;
  }

  function updateSortIndicators(state) {
    document.querySelectorAll('#ca-keyword-table th[data-sort]').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === state.sortColumn) {
        th.classList.add(state.sortDir === 'desc' ? 'sort-desc' : 'sort-asc');
      }
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

  function buildLeaderboardRows(overviewItems, citeBy, self) {
    const engineItems = (overviewItems || []).filter(
      (it) => String(it?.searchEngine || 'google').toLowerCase() === 'google'
    );
    const selfItem = engineItems.find((it) => normDomain(it.domain) === self) || null;
    const rivals = engineItems.filter(
      (it) => it?.isCompetitor === true && normDomain(it.domain) !== self
    );

    const toRow = (item, isYou) => {
      const d = normDomain(item?.domain);
      const latest = item?.latest || {};
      const cite = citeBy[d] || {};
      return {
        domain: d,
        label: item?.label || d,
        isYou,
        strength: latest.score != null ? Number(latest.score) : null,
        totalKw: latest.organicKeywordsTotal ?? latest.organic_keywords_total_raw ?? null,
        top3: latest.top3Keywords ?? latest.top3_keywords_raw ?? null,
        top10: latest.top10Keywords ?? latest.top10_keywords_raw ?? null,
        aiCitations: Number(cite.total_citations) || 0,
        citeShare: Number(cite.share_of_citations) || 0,
      };
    };

    const rows = [];
    if (selfItem) rows.push(toRow(selfItem, true));
    for (const item of rivals) rows.push(toRow(item, false));
    return rows;
  }

  function sortLeaderboardRows(rows, col, dir) {
    const mul = dir === 'desc' ? -1 : 1;
    const rivals = rows.filter((r) => !r.isYou);
    const selfRow = rows.find((r) => r.isYou);
    rivals.sort((a, b) => {
      let av;
      let bv;
      switch (col) {
        case 'domain': av = a.domain || ''; bv = b.domain || ''; break;
        case 'totalKw': av = a.totalKw ?? -1; bv = b.totalKw ?? -1; break;
        case 'top3': av = a.top3 ?? -1; bv = b.top3 ?? -1; break;
        case 'top10': av = a.top10 ?? -1; bv = b.top10 ?? -1; break;
        case 'aiCitations': av = a.aiCitations || 0; bv = b.aiCitations || 0; break;
        case 'strength':
        default: av = a.strength ?? -1; bv = b.strength ?? -1; break;
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return (a.domain || '').localeCompare(b.domain || '');
    });
    return selfRow ? [selfRow, ...rivals] : rivals;
  }

  function updateLeaderboardSortIndicators(state) {
    document.querySelectorAll('#ca-leaderboard-table th[data-lb-sort]').forEach((th) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.lbSort === state.lbSortColumn) {
        th.classList.add(state.lbSortDir === 'desc' ? 'sort-desc' : 'sort-asc');
      }
    });
  }

  function renderLeaderboardTable(rows, state) {
    const body = document.getElementById('ca-leaderboard-body');
    if (!body) return;
    updateLeaderboardSortIndicators(state);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="ranking-table-empty">No flagged competitors yet. Check a rival in the keyword table or approve the classification queue.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((r) => {
      const cls = r.isYou ? ' ca-lb-you' : '';
      const strength = r.strength != null ? fmtStrength(r.strength) : '<em class="ca-muted">not yet measured</em>';
      const totalKw = r.totalKw != null ? fmtNum(r.totalKw) : '—';
      const top3 = r.top3 != null ? fmtNum(r.top3) : '—';
      const top10 = r.top10 != null ? fmtNum(r.top10) : '—';
      const cite = r.aiCitations > 0
        ? `${fmtNum(r.aiCitations)} <span class="ca-muted ca-lb-share">(${r.citeShare.toFixed(1)}%)</span>`
        : '<em class="ca-muted">—</em>';
      const name = r.isYou ? `${r.label || r.domain} <span class="ca-lb-you-tag">You</span>` : (r.label || r.domain);
      return `<tr class="ca-lb-row${cls}">
        <td>${name}</td>
        <td>${strength}</td>
        <td>${totalKw}</td>
        <td>${top3}</td>
        <td>${top10}</td>
        <td>${cite}</td>
      </tr>`;
    }).join('');
  }

  async function renderCompetitorLeaderboard(state, combinedRows) {
    const overviewItems = await fetchOverviewItems();
    const citeBy = buildAiCiteMap(combinedRows);
    const self = selfDomain();
    let rows = buildLeaderboardRows(overviewItems, citeBy, self);
    rows = sortLeaderboardRows(rows, state.lbSortColumn || 'strength', state.lbSortDir || 'desc');
    state.leaderboardRows = rows;
    renderLeaderboardTable(rows, state);
  }

  function fillKeywordDropdown(universe, selected) {
    const sel = document.getElementById('ca-keyword-select');
    if (!sel) return;
    const cur = selected || '';
    sel.innerHTML = '<option value="">All keywords (pick one for detail)</option>'
      + universe.map((r) => `<option value="${r.keyword.replace(/"/g, '&quot;')}">${r.keyword}</option>`).join('');
    sel.value = cur;
  }

  function pageSlice(rows, state) {
    const total = rows.length;
    const per = state.rowsPerPage === 'all' ? total || 1 : Number(state.rowsPerPage) || 25;
    const totalPages = Math.max(1, Math.ceil((total || 1) / per));
    state.currentPage = Math.min(Math.max(1, state.currentPage || 1), totalPages);
    if (state.rowsPerPage === 'all' || !total) {
      return { pageRows: rows, total, start: total ? 1 : 0, end: total, totalPages: 1, per };
    }
    const startIdx = (state.currentPage - 1) * per;
    const endIdx = Math.min(startIdx + per, total);
    return {
      pageRows: rows.slice(startIdx, endIdx),
      total,
      start: total ? startIdx + 1 : 0,
      end: endIdx,
      totalPages,
      per,
    };
  }

  function updatePaginationUi(state, pageMeta) {
    const controls = document.getElementById('ca-pagination-controls');
    const info = document.getElementById('ca-pagination-info');
    const pageInfo = document.getElementById('ca-pagination-page-info');
    if (controls) controls.style.display = 'flex';
    if (info) info.textContent = `Showing ${pageMeta.start}-${pageMeta.end} of ${pageMeta.total}`;
    if (pageInfo) pageInfo.textContent = `Page ${state.currentPage} of ${pageMeta.totalPages}`;
    const atStart = state.currentPage <= 1;
    const atEnd = state.currentPage >= pageMeta.totalPages;
    const first = document.getElementById('ca-pagination-first');
    const prev = document.getElementById('ca-pagination-prev');
    const next = document.getElementById('ca-pagination-next');
    const last = document.getElementById('ca-pagination-last');
    if (first) first.disabled = atStart;
    if (prev) prev.disabled = atStart;
    if (next) next.disabled = atEnd;
    if (last) last.disabled = atEnd;
    const rpp = document.getElementById('ca-rows-per-page');
    if (rpp && String(rpp.value) !== String(state.rowsPerPage)) rpp.value = String(state.rowsPerPage);
  }

  function renderTable(rows, state) {
    const body = document.getElementById('ca-keyword-table-body');
    if (!body) return;
    updateSortIndicators(state);
    const pageMeta = pageSlice(rows, state);
    updatePaginationUi(state, pageMeta);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="13" class="ranking-table-empty">No keywords match the current filters.</td></tr>';
      return;
    }
    body.innerHTML = pageMeta.pageRows.map((r) => {
      const rivalLabel = r.topRival
        ? (r.topRival.domain || r.topRival.name)
        : (state.independentsOnly !== false ? 'no independent rival' : '—');
      const c = r.rivalCols || {};
      const d = r.topRival?.domain || '';
      const typeCell = d ? typeLabel(c.domain_type) : '—';
      const rankCell = c.rank != null ? fmtStrength(c.rank) : '—';
      const citeCell = d ? String(c.citations || 0) : '—';
      const aiKwCell = d ? String(c.ai_keywords || 0) : '—';
      const shareCell = d ? `${(c.share || 0).toFixed(1)}%` : '—';
      const compCell = d
        ? `<input type="checkbox" class="ca-comp-check" data-domain="${d}" ${c.is_competitor ? 'checked' : ''} title="Flag as competitor">`
        : '—';
      const sel = state.selectedKeyword && normKw(state.selectedKeyword) === normKw(r.keyword);
      const selCls = sel ? ' is-selected ranking-table-row--selected' : '';
      return `<tr class="ca-kw-row${selCls}" data-keyword="${r.keyword.replace(/"/g, '&quot;')}">
        <td>${r.keyword}</td>
        <td>${classPillHtml(r.keyword_class)}</td>
        <td>${volumeBadgeHtml(r.search_volume)}</td>
        <td>${fmtSurface(r.yourBest)}</td>
        <td>${rivalLabel}</td>
        <td>${fmtSurface(r.topRival)}</td>
        <td>${typeCell}</td>
        <td style="text-align:center">${compCell}</td>
        <td>${rankCell}</td>
        <td>${citeCell}</td>
        <td>${aiKwCell}</td>
        <td>${shareCell}</td>
        <td>${statusBadge(r.status, r.packContested)}</td>
      </tr>`;
    }).join('');

    body.querySelectorAll('.ca-kw-row').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.ca-comp-check')) return;
        state.selectedKeyword = tr.dataset.keyword || '';
        const sel = document.getElementById('ca-keyword-select');
        if (sel) sel.value = state.selectedKeyword;
        renderTable(rows, state);
        renderDetail(state);
      });
    });
    body.querySelectorAll('.ca-comp-check').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', async () => {
        const domain = cb.dataset.domain;
        if (!domain) return;
        cb.disabled = true;
        try {
          const resp = await fetch(api('/api/domain-strength/update-domain'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, is_competitor: cb.checked }),
          });
          if (!resp.ok) throw new Error('update failed');
          const prev = window.__domainMetadataCache?.get?.(domain) || {};
          if (window.__domainMetadataCache) {
            window.__domainMetadataCache.set(domain, { ...prev, is_competitor: cb.checked });
          }
          for (const row of state.universeRows || []) {
            if (row.topRival?.domain === domain && row.rivalCols) {
              row.rivalCols.is_competitor = cb.checked;
            }
          }
        } catch (_e) {
          cb.checked = !cb.checked;
          alert('Could not update competitor flag.');
        } finally {
          cb.disabled = false;
        }
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
    const kwEl = document.getElementById('ca-detail-kw');
    const surfaceEl = document.getElementById('ca-detail-surface');
    const howBeatEl = document.getElementById('ca-detail-how-beat');
    const tiles = document.getElementById('ca-detail-tiles');
    if (!panel || !tiles) return;

    const kw = state.selectedKeyword;
    if (!kw) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    if (kwEl) kwEl.textContent = kw;
    wireDetailSerpActions(kw);

    const row = (state.tableRows || []).find((r) => normKw(r.keyword) === normKw(kw))
      || (state.universeRows || []).find((r) => normKw(r.keyword) === normKw(kw));
    if (!row || !row.row) {
      tiles.innerHTML = '<p class="ranking-table-empty">Keyword not in current universe.</p>';
      if (surfaceEl) surfaceEl.innerHTML = '';
      if (howBeatEl) howBeatEl.textContent = '';
      return;
    }

    const self = selfDomain();
    const meta = typeof fetchDomainMetadataForDomains === 'function'
      ? await fetchDomainMetadataForDomains(
        row.top3.map((t) => t.domain).filter(Boolean)
      )
      : {};
    const surfaces = buildSurfaceSplit(row.row, self, meta, state.independentsOnly !== false);
    const topDomain = row.top3[0]?.domain || null;

    if (surfaceEl) surfaceEl.innerHTML = renderSurfaceSplitHtml(surfaces, topDomain);

    const domains = [self, ...row.top3.map((t) => t.domain).filter(Boolean)];
    const strength = await fetchStrengthFull(domains);
    const tier2 = await fetchTier2(domains.filter((d) => d !== self));
    const citeBy = buildAiCiteMap(
      (window.RankingAiModule?.state?.()?.combinedRows) || []
    );
    const youCite = citeBy[self]?.total_citations;
    const revMap = new Map((tier2.reviews || []).map((r) => [r.domain, r]));
    const pageMap = new Map();
    for (const p of tier2.onpage || []) {
      if (!pageMap.has(p.domain)) pageMap.set(p.domain, p);
    }

    const youSnap = strength[self]?.latest;
    if (howBeatEl) {
      if (!topDomain) {
        howBeatEl.textContent = 'No independent rival on this keyword.';
      } else {
        let line = howTheyBeatYou(surfaces, topDomain);
        const themSnap = strength[topDomain]?.latest;
        const pack = surfaces.find((s) => s.type === 'local_pack');
        const packRival = pack?.rivals?.find((r) => r.domain === topDomain) || pack?.rivals?.[0];
        const packLose = pack && compareSurface(pack.youPos, packRival?.position ?? null) === 'lose';
        if (
          packLose
          && youSnap?.score != null
          && themSnap?.score != null
          && Number(youSnap.score) >= Number(themSnap.score)
        ) {
          line += ' Note: your domain strength is as strong or stronger — this is a local-signals gap, not authority.';
        }
        howBeatEl.textContent = line;
      }
    }
    const cards = [];
    cards.push(renderAuthorityTile({
      label: 'You',
      domain: self,
      snap: youSnap,
      measured: !!(strength[self]?.count),
      review: null,
      page: null,
      isYou: true,
      suggest: false,
      youSnap,
      aiCite: { total_citations: youCite, youCitations: youCite },
      isFlagged: false,
      needsQueue: !(strength[self]?.count) && self.includes('.'),
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
      cards.push(renderAuthorityTile({
        label: `Rival #${i + 1}`,
        domain: d || rival.name,
        snap,
        measured,
        review: d ? revMap.get(d) : null,
        page: d ? pageMap.get(d) : null,
        isYou: false,
        suggest: d && beaten >= AUTO_SUGGEST_THRESHOLD && !m.is_competitor,
        youSnap,
        aiCite: d ? { ...citeBy[d], youCitations: youCite } : null,
        isFlagged: m.is_competitor === true,
        needsQueue: d && !measured && d.includes('.'),
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
  }

  async function renderClassificationQueue(meta) {
    const el = document.getElementById('ca-classification-queue');
    if (!el) return;

    let queue = [];
    try {
      const res = await fetch('/competitor-classification-queue.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        queue = (data.queue || [])
          .filter((q) => !(meta[q.domain]?.is_competitor))
          .map((q) => ({
            domain: q.domain,
            moneyKw: q.money_kw || 0,
            type: q.proposed_type || 'site',
            reason: q.reason || '',
            propose: q.proposed || 'Flag as competitor',
          }));
      }
    } catch (_e) { /* fall through */ }

    if (!queue.length) {
      el.innerHTML = '<p class="ca-queue-empty">No domains awaiting competitor approval.</p>';
      return;
    }

    el.innerHTML = `<p class="ca-queue-empty" style="margin-bottom:0.75rem;">${queue.length} MED-conf independents — approve to set <code>is_competitor</code> (manual authority).</p>
      <table class="ranking-table ca-queue-table"><thead><tr>
      <th>Domain</th><th>Money KWs</th><th>Type</th><th>Proposed</th><th>Reason</th><th></th>
    </tr></thead><tbody>${queue.slice(0, 40).map((q) => `<tr>
      <td>${q.domain}</td><td>${q.moneyKw}</td><td>${q.type}</td><td>${q.propose}</td>
      <td>${q.reason}</td>
      <td><button type="button" class="ca-queue-approve btn btn-small" data-domain="${q.domain}">Approve</button>
      <button type="button" class="ca-queue-reject btn btn-small" data-domain="${q.domain}">Reject</button></td>
    </tr>`).join('')}</tbody></table>`;

    el.querySelectorAll('.ca-queue-approve').forEach((btn) => {
      btn.addEventListener('click', () => confirmFlag(btn.dataset.domain, btn));
    });
    el.querySelectorAll('.ca-queue-reject').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Dismissed';
      });
    });
  }

  function setPresetActive(preset) {
    document.querySelectorAll('.ca-preset').forEach((btn) => {
      const on = btn.dataset.preset === preset;
      btn.classList.toggle('is-active', on);
      btn.classList.toggle('preset-active', on);
    });
  }

  async function renderCompetitorAnalysisTab() {
    const state = getState();
    wireCompetitorAnalysisUi();
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
    await enrichRivalColumns(universe, meta, combinedRows);
    state.universeRows = universe;

    let filtered = applyFilters(universe, state);
    filtered = sortRows(filtered, state.sortColumn, state.sortDir);
    state.tableRows = filtered;

    renderTiles(universe, filtered, state);
    await renderClassificationQueue(meta);
    await renderCompetitorLeaderboard(state, combinedRows);
    fillKeywordDropdown(universe, state.selectedKeyword);
    renderTable(filtered, state);
    await renderDetail(state);

    const countEl = document.getElementById('ca-universe-count');
    if (countEl) {
      countEl.textContent = `${universe.length} tracked keywords from locked-config · ${filtered.length} match filters`;
    }

    if (typeof renderAiSourcesTab === 'function') renderAiSourcesTab();
  }

  function wireCompetitorAnalysisUi() {
    const state = getState();
    const resetPage = () => { state.currentPage = 1; };

    const noise = document.getElementById('ca-noise-toggle');
    if (noise && !noise.dataset.wired) {
      noise.dataset.wired = '1';
      noise.checked = state.independentsOnly !== false;
      noise.addEventListener('change', () => {
        state.independentsOnly = noise.checked;
        resetPage();
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
        resetPage();
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
        resetPage();
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
        resetPage();
        renderCompetitorAnalysisTab();
      });
    }

    // Event delegation — survives inner header <div>/<span> clicks
    const table = document.getElementById('ca-keyword-table');
    if (table && !table.dataset.sortWired) {
      table.dataset.sortWired = '1';
      table.addEventListener('click', (e) => {
        const th = e.target.closest('thead th[data-sort]');
        if (!th || !table.contains(th)) return;
        e.preventDefault();
        const col = th.dataset.sort;
        if (state.sortColumn === col) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortColumn = col;
          state.sortDir = col === 'volume' || col === 'yours' || col === 'theirs' ? 'asc' : 'asc';
        }
        resetPage();
        renderCompetitorAnalysisTab();
      });
    }

    const lbTable = document.getElementById('ca-leaderboard-table');
    if (lbTable && !lbTable.dataset.sortWired) {
      lbTable.dataset.sortWired = '1';
      lbTable.addEventListener('click', (e) => {
        const th = e.target.closest('thead th[data-lb-sort]');
        if (!th || !lbTable.contains(th)) return;
        e.preventDefault();
        const col = th.dataset.lbSort;
        if (state.lbSortColumn === col) {
          state.lbSortDir = state.lbSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.lbSortColumn = col;
          state.lbSortDir = col === 'domain' ? 'asc' : 'desc';
        }
        const rows = sortLeaderboardRows(
          state.leaderboardRows || [],
          state.lbSortColumn,
          state.lbSortDir
        );
        state.leaderboardRows = rows;
        renderLeaderboardTable(rows, state);
      });
    }

    const go = (page) => {
      state.currentPage = page;
      renderTable(state.tableRows || [], state);
    };
    const wireBtn = (id, fn) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', fn);
    };
    wireBtn('ca-pagination-first', () => go(1));
    wireBtn('ca-pagination-prev', () => go((state.currentPage || 1) - 1));
    wireBtn('ca-pagination-next', () => go((state.currentPage || 1) + 1));
    wireBtn('ca-pagination-last', () => {
      const total = (state.tableRows || []).length;
      const per = state.rowsPerPage === 'all' ? total || 1 : Number(state.rowsPerPage) || 25;
      go(Math.max(1, Math.ceil((total || 1) / per)));
    });
    const rpp = document.getElementById('ca-rows-per-page');
    if (rpp && !rpp.dataset.wired) {
      rpp.dataset.wired = '1';
      rpp.value = String(state.rowsPerPage);
      rpp.addEventListener('change', () => {
        state.rowsPerPage = rpp.value === 'all' ? 'all' : Number(rpp.value) || 25;
        resetPage();
        renderTable(state.tableRows || [], state);
      });
    }
  }

  window.COMPETITOR_ANALYSIS_BASELINE = BASELINE;
  window.renderCompetitorAnalysisTab = renderCompetitorAnalysisTab;
  window.wireCompetitorAnalysisUi = wireCompetitorAnalysisUi;
})();
