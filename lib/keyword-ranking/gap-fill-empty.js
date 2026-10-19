/**
 * End-of-ranking gap fill: retry empty/incomplete/error captures and
 * unverified absences (confirm budget exhausted / unstable / partial).
 * DFS blanks and mid-run confirm-cap exhaustion are common; a dedicated
 * pass with a fresh spend budget often clears both.
 */
import { isFailedCaptureQuality, isUnverifiedAbsence } from './dfs-serp-quality.js';

export const GAP_FILL_MAX_KEYWORDS = 40;
export const GAP_FILL_MAX_ROUNDS = 2;

/** @deprecated Prefer listGapFillKeywords — kept for older callers/tests. */
export function listFailedCaptureKeywords(serpRows, { limit = GAP_FILL_MAX_KEYWORDS } = {}) {
  return listKeywordsByPredicate(serpRows, isFailedCaptureQuality, limit);
}

/** Failed captures + unverified absences (the provisional Top-of-Page buckets). */
export function listGapFillKeywords(serpRows, { limit = GAP_FILL_MAX_KEYWORDS } = {}) {
  return listKeywordsByPredicate(
    serpRows,
    (row) => isFailedCaptureQuality(row) || isUnverifiedAbsence(row),
    limit
  );
}

function listKeywordsByPredicate(serpRows, pred, limit) {
  const out = [];
  const seen = new Set();
  for (const row of serpRows || []) {
    if (!pred(row)) continue;
    const kw = String(row.keyword || row.query || '').trim();
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
    if (out.length >= limit) break;
  }
  return out;
}

export function mergeSerpRetryRows(serpRows, retryPerKeyword) {
  const byKey = new Map();
  for (const row of retryPerKeyword || []) {
    const kw = String(row?.keyword || row?.query || '').trim().toLowerCase();
    if (kw) byKey.set(kw, row);
  }
  if (!byKey.size) return serpRows || [];
  return (serpRows || []).map((row) => {
    const kw = String(row?.keyword || row?.query || '').trim().toLowerCase();
    return byKey.has(kw) ? byKey.get(kw) : row;
  });
}
