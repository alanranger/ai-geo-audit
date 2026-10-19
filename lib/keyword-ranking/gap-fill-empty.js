/**
 * End-of-ranking gap fill: list empty/incomplete/error captures for a retry pass.
 * DFS occasionally returns blank SERPs; one more single-keyword fetch often succeeds.
 */
import { isFailedCaptureQuality } from './dfs-serp-quality.js';

export const GAP_FILL_MAX_KEYWORDS = 20;
export const GAP_FILL_MAX_ROUNDS = 2;

export function listFailedCaptureKeywords(serpRows, { limit = GAP_FILL_MAX_KEYWORDS } = {}) {
  const out = [];
  const seen = new Set();
  for (const row of serpRows || []) {
    if (!isFailedCaptureQuality(row)) continue;
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
