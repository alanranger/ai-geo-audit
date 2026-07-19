/**
 * Browser bridge for Money tab Stage 3 row intel (imports shared lib).
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

function overrideMetaForUrl(pageUrl, metaByPath) {
  const p = pathOnly(pageUrl);
  return metaByPath.get(p) || metaByPath.get(p.replace(/\/$/, '')) || null;
}

function buildOverrideMetaMap() {
  const map = new Map();
  const state = window.TRADITIONAL_SEO_STATE || {};
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
  // Fallback: comparable-URL Map → path keys (when rows array missing but Map loaded)
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
  await window.traditionalSeoEnsureTargetKeywordOverridesLoaded?.({ forceRefresh: false });
  let metaByPath = buildOverrideMetaMap();
  if (metaByPath.size === 0) {
    await window.traditionalSeoEnsureTargetKeywordOverridesLoaded?.({ forceRefresh: true });
    metaByPath = buildOverrideMetaMap();
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

window.enrichMoneyPagesRowsWithIntel = enrichMoneyPagesRowsWithIntel;
