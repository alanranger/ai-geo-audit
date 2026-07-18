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
  const rows = window.TRADITIONAL_SEO_STATE?.targetKeywordOverrideRows;
  if (!Array.isArray(rows)) return map;
  rows.forEach((o) => {
    const p = pathOnly(o.page_url);
    if (!p) return;
    map.set(p, {
      target_keyword: String(o.target_keyword || '').trim(),
      target_class: o.target_class || null,
      notes: String(o.notes || '')
    });
  });
  return map;
}

async function enrichMoneyPagesRowsWithIntel(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  await window.traditionalSeoEnsureTargetKeywordOverridesLoaded?.({ forceRefresh: false });
  const metaByPath = buildOverrideMetaMap();
  const locked151 = await getLocked151Set();
  let combinedRows = [];
  if (typeof window.fetchLatestAuditAndCombinedRows === 'function') {
    try {
      const { combinedRows: kr } = await window.fetchLatestAuditAndCombinedRows();
      combinedRows = Array.isArray(kr) ? kr : [];
    } catch (err) {
      combinedRows = window.rankingAiData || [];
    }
  } else {
    combinedRows = window.rankingAiData || [];
  }
  const byKw = buildKeywordRowLookup(combinedRows);
  return rows.map((row) => {
    const meta = overrideMetaForUrl(row.url, metaByPath) || {};
    const kwKey = normKw(meta.target_keyword);
    const kr = kwKey ? byKw.get(kwKey) : null;
    return enrichMoneyPageRow(row, meta, kr, locked151);
  });
}

window.enrichMoneyPagesRowsWithIntel = enrichMoneyPagesRowsWithIntel;
