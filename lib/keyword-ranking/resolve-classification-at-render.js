/**
 * Resolve keyword_class, segment, and tracking location from locked config at read/render.
 * Stored row values remain historical; config wins for display and client-side computation.
 */

import { resolveKeywordClass } from './tracking-class.js';
import { resolveTrackingLocation } from './tracking-location.js';
import { resolveTrackedSegment } from './tracked-set-v3.js';
import {
  resolveClassFromMap,
  resolveLocationFromMap,
} from './locked-config-merge.js';

export function resolveClassificationAtRender(row, lockedByKeyword = null) {
  if (!row || !row.keyword) return row;
  const kw = String(row.keyword).trim();
  const cls = lockedByKeyword
    ? resolveClassFromMap(kw, lockedByKeyword)
    : resolveKeywordClass(kw);
  const loc = lockedByKeyword
    ? resolveLocationFromMap(kw, lockedByKeyword)
    : resolveTrackingLocation(kw);
  const segment = resolveTrackedSegment(kw, cls.keyword_class, row.segment);
  return {
    ...row,
    keyword_class: cls.keyword_class,
    class_unmapped: cls.class_unmapped === true,
    location_name: loc.location_name || row.location_name || null,
    location_unmapped: loc.unmapped === true,
    target_page: cls.target_page || loc.target_page || row.target_page || null,
    segment,
    segment_source: 'manual',
  };
}

export function resolveRowsClassificationAtRender(rows, lockedByKeyword = null) {
  return (Array.isArray(rows) ? rows : []).map((row) => resolveClassificationAtRender(row, lockedByKeyword));
}
