/**
 * Money tab row intel (Stage 3): target keyword, fight-type, cannibal flag.
 */
import { extractKeywordSurfaces, keywordStatus, topRivalsForKeyword } from '../competitor-analysis/rivals.js';
import { pathOnly } from './moneyPageRoles.js';

function normKw(kw) {
  return String(kw || '').trim().toLowerCase();
}

function bestUrlPath(raw) {
  if (!raw) return '';
  try {
    return pathOnly(raw);
  } catch {
    return String(raw).toLowerCase().replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  }
}

/** @returns {string} fight-type label for Money tab */
export function deriveFightType(keywordRow, trackedIn151) {
  if (!trackedIn151) return 'Not tracked';
  if (!keywordRow) return 'Tracked (no ranking row)';
  if (keywordRow.has_ai_overview || keywordRow.ai_overview_present_any) {
    return 'AI Overview present';
  }
  const extracted = extractKeywordSurfaces(keywordRow, 'alanranger.com');
  if (extracted.packContested) return 'Pack contested';
  const top = topRivalsForKeyword(extracted, {}, false, 1)[0];
  if (keywordStatus(extracted, top) === 'rival-beats') return 'Organic fight';
  return 'Tracked';
}

/** @returns {string|null} cannibal flag label */
export function deriveCannibalFlag(pageUrl, overrideMeta, keywordRow) {
  const pagePath = pathOnly(pageUrl);
  const cls = String(overrideMeta?.target_class || '').toLowerCase();
  const notes = String(overrideMeta?.notes || '').trim();
  if (cls === 'cannibal_candidate') {
    const owner = notes.match(/owned by (\/[^\s—]+)/i)?.[1]
      || notes.match(/→ (\/[^\s]+)/)?.[1];
    return owner ? `CANNIBAL-CANDIDATE → ${owner}` : (notes || 'CANNIBAL-CANDIDATE');
  }
  const kw = String(overrideMeta?.target_keyword || '').trim();
  if (!kw || !keywordRow?.best_url) return null;
  const bestPath = bestUrlPath(keywordRow.best_url);
  if (!bestPath || bestPath === pagePath) return null;
  return `Google prefers: ${bestPath}`;
}

/** Enrich one money row with Stage 3 intel fields. */
export function enrichMoneyPageRow(row, overrideMeta, keywordRow, locked151) {
  const targetKeyword = String(overrideMeta?.target_keyword || '').trim();
  const kwKey = normKw(targetKeyword);
  const trackedIn151 = kwKey ? locked151.has(kwKey) : false;
  const kr = keywordRow || null;
  return {
    ...row,
    targetKeyword,
    targetClass: overrideMeta?.target_class || null,
    targetNotes: overrideMeta?.notes || '',
    fightType: targetKeyword ? deriveFightType(kr, trackedIn151) : '—',
    cannibalFlag: deriveCannibalFlag(row.url, overrideMeta, kr)
  };
}

export function buildKeywordRowLookup(combinedRows) {
  const byKw = new Map();
  for (const r of combinedRows || []) {
    const k = normKw(r.keyword);
    if (!k) continue;
    if (!byKw.has(k)) byKw.set(k, r);
  }
  return byKw;
}

export function loadLocked151Keywords(csvText) {
  const set = new Set();
  const lines = String(csvText || '').trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const kw = line.split(',')[0]?.replace(/^"|"$/g, '').trim().toLowerCase();
    if (kw) set.add(kw);
  }
  return set;
}

export { pathOnly, normKw, bestUrlPath };
