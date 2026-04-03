/**
 * Resolve each batched URL to the correct GSC inspect row (browser dashboard must stay in sync).
 * Tests: test/gsc-inspection-batch-merge.test.js
 */

import { toComparableUrl } from './gscInspectKeys.js';

export function buildInspectionRowByUrlMap(rows) {
  const byUrl = new Map();
  for (let ri = 0; ri < rows.length; ri += 1) {
    const r = rows[ri];
    if (!r || typeof r !== 'object') continue;
    const k = String(r?.inspectionUrl || '').trim();
    if (k && !byUrl.has(k)) byUrl.set(k, r);
  }
  return byUrl;
}

export function pickInspectionRowForUrl(rows, byUrl, uReq, propertyUrl) {
  const t = String(uReq || '').trim();
  const direct = byUrl.get(t);
  if (direct && typeof direct === 'object') return direct;
  const cmp = toComparableUrl(t, propertyUrl);
  for (let jj = 0; jj < rows.length; jj += 1) {
    const r = rows[jj];
    if (!r || typeof r !== 'object') continue;
    const ins = String(r?.inspectionUrl || '').trim();
    if (!ins) continue;
    if (ins === t) return r;
    if (cmp && toComparableUrl(ins, propertyUrl) === cmp) return r;
  }
  return null;
}

export function resolveInspectionHitForBatchSlot(rows, byUrl, slotIndex, uReq, propertyUrl) {
  const cmpReq = toComparableUrl(String(uReq || '').trim(), propertyUrl);
  let hit = null;
  const ord = rows[slotIndex];
  if (ord && typeof ord === 'object') {
    const ins = String(ord.inspectionUrl || '').trim();
    if (
      ins &&
      (ins === String(uReq).trim() || (cmpReq && toComparableUrl(ins, propertyUrl) === cmpReq))
    ) {
      hit = ord;
    }
  }
  if (!hit) hit = pickInspectionRowForUrl(rows, byUrl, uReq, propertyUrl);
  return hit;
}
