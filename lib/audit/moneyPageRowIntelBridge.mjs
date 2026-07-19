/**
 * Browser bridge for Money tab Stage 3 row intel (imports shared lib).
 * Owns the overrides fetch for the Money panel — does not rely on TradSEO tab init.
 */
import {
  enrichMoneyPageRow,
  buildKeywordRowLookup,
  loadLocked151Keywords,
  pathOnly,
  normKw
} from './moneyPageRowIntel.js';

let locked151Cache = null;

async function getLocked151Set() {
  if (locked151Cache) return locked151Cache;
  const res = await fetch('/config/keyword-tracking-locations-and-class-LOCKED-v4.csv', { cache: 'no-store' });
  const text = await res.text();
  locked151Cache = loadLocked151Keywords(text);
  return locked151Cache;
}

function moneyPropertyUrl() {
  return String(
    document.getElementById('propertyUrl')?.value
    || localStorage.getItem('gsc_property_url')
    || localStorage.getItem('last_property_url')
    || 'https://www.alanranger.com'
  ).trim();
}

function ensureTradSeoState() {
  if (!window.TRADITIONAL_SEO_STATE || typeof window.TRADITIONAL_SEO_STATE !== 'object') {
    window.TRADITIONAL_SEO_STATE = {};
  }
  return window.TRADITIONAL_SEO_STATE;
}

function applyOverrideRowsToState(rows, prop) {
  const state = ensureTradSeoState();
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();
  list.forEach((o) => {
    const kw = String(o.target_keyword || o.keyword || '').trim();
    const pu = String(o.page_url || o.page || o.url || '').trim();
    if (!pu || !kw) return;
    map.set(pu, kw);
    const p = pathOnly(pu);
    if (p) map.set(p, kw);
  });
  state.targetKeywordOverrideRows = list;
  state.targetKeywordOverridesByPage = map;
  state.targetKeywordOverridesProperty = prop;
  return list;
}

/**
 * Money-panel guarantee: overrides are loaded even if TradSEO tab never ran
 * and even if traditionalSeoEnsureTargetKeywordOverridesLoaded is missing.
 */
async function ensureMoneyTargetKeywordOverridesLoaded(options = {}) {
  const force = options.forceRefresh === true;
  const prop = moneyPropertyUrl();
  const state = ensureTradSeoState();
  const rowsReady = Array.isArray(state.targetKeywordOverrideRows) && state.targetKeywordOverrideRows.length > 0;
  if (!force && rowsReady && state.targetKeywordOverridesProperty === prop) {
    return state.targetKeywordOverrideRows;
  }

  // Prefer TradSEO helper when present (keeps comparable-URL aliases in sync)
  if (typeof window.traditionalSeoEnsureTargetKeywordOverridesLoaded === 'function') {
    try {
      await window.traditionalSeoEnsureTargetKeywordOverridesLoaded({ forceRefresh: force });
      if (Array.isArray(state.targetKeywordOverrideRows) && state.targetKeywordOverrideRows.length > 0) {
        return state.targetKeywordOverrideRows;
      }
    } catch (_err) {
      // Fall through to Money-owned fetch
    }
  }

  const params = new URLSearchParams();
  if (prop) params.set('propertyUrl', prop);
  const url = `/api/aigeo/traditional-seo-target-keyword-overrides?${params.toString()}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || String(json?.status || '').toLowerCase() !== 'ok') {
    throw new Error(json?.message || `overrides HTTP ${res.status}`);
  }
  return applyOverrideRowsToState(json.overrides, prop);
}

function overrideMetaForUrl(pageUrl, metaByPath) {
  const p = pathOnly(pageUrl);
  return metaByPath.get(p) || metaByPath.get(p.replace(/\/$/, '')) || null;
}

function buildOverrideMetaMap() {
  const map = new Map();
  const state = ensureTradSeoState();
  const rows = state.targetKeywordOverrideRows;
  if (Array.isArray(rows)) {
    rows.forEach((o) => {
      const p = pathOnly(o.page_url || o.page || o.url);
      if (!p) return;
      map.set(p, {
        target_keyword: String(o.target_keyword || o.keyword || '').trim(),
        target_class: o.target_class || null,
        notes: String(o.notes || '')
      });
    });
  }
  const byPage = state.targetKeywordOverridesByPage;
  if (map.size === 0 && byPage instanceof Map) {
    byPage.forEach((kw, pageKey) => {
      const p = pathOnly(pageKey);
      const keyword = String(kw || '').trim();
      if (!p || !keyword || map.has(p)) return;
      map.set(p, { target_keyword: keyword, target_class: null, notes: '' });
    });
  }
  return map;
}

async function enrichMoneyPagesRowsWithIntel(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  try {
    await ensureMoneyTargetKeywordOverridesLoaded({ forceRefresh: false });
  } catch (err) {
    console.warn('[Money Stage3] overrides load failed:', err?.message || err);
  }
  let metaByPath = buildOverrideMetaMap();
  if (metaByPath.size === 0) {
    try {
      await ensureMoneyTargetKeywordOverridesLoaded({ forceRefresh: true });
      metaByPath = buildOverrideMetaMap();
    } catch (err) {
      console.warn('[Money Stage3] overrides force-refresh failed:', err?.message || err);
    }
  }
  if (metaByPath.size === 0) {
    console.warn('[Money Stage3] overrides map empty after load — Stage-3 cells will be dashes');
  }
  const locked151 = await getLocked151Set();
  let combinedRows = [];
  if (typeof window.fetchLatestAuditAndCombinedRows === 'function') {
    try {
      const { combinedRows: kr } = await window.fetchLatestAuditAndCombinedRows();
      combinedRows = Array.isArray(kr) ? kr : [];
    } catch (err) {
      combinedRows = window.rankingAiData?.combinedRows || window.rankingAiData || [];
    }
  } else {
    combinedRows = window.rankingAiData?.combinedRows || window.rankingAiData || [];
  }
  if (!Array.isArray(combinedRows)) combinedRows = [];
  const byKw = buildKeywordRowLookup(combinedRows);
  return rows.map((row) => {
    const meta = overrideMetaForUrl(row.url || row.page, metaByPath) || {};
    const kwKey = normKw(meta.target_keyword);
    const kr = kwKey ? byKw.get(kwKey) : null;
    return enrichMoneyPageRow(row, meta, kr, locked151);
  });
}

window.ensureMoneyTargetKeywordOverridesLoaded = ensureMoneyTargetKeywordOverridesLoaded;
window.enrichMoneyPagesRowsWithIntel = enrichMoneyPagesRowsWithIntel;
