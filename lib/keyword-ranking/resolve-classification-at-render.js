/**
 * Resolve keyword_class, segment, and tracking location from locked config at read/render.
 * Stored row values remain historical; config wins for display and client-side computation.
 */

import { resolveKeywordClass } from './tracking-class.js';
import { resolveTrackingLocation } from './tracking-location.js';
import { resolveSegmentOverride } from './tracked-set-v3.js';

export function resolveClassificationAtRender(row) {
  if (!row || !row.keyword) return row;
  const kw = String(row.keyword).trim();
  const cls = resolveKeywordClass(kw);
  const loc = resolveTrackingLocation(kw);
  const segOverride = resolveSegmentOverride(kw);
  return {
    ...row,
    keyword_class: cls.keyword_class,
    class_unmapped: cls.class_unmapped === true,
    location_name: loc.location_name || row.location_name || null,
    location_unmapped: loc.unmapped === true,
    target_page: cls.target_page || loc.target_page || row.target_page || null,
    segment: segOverride || row.segment,
    segment_source: segOverride ? 'manual' : row.segment_source,
  };
}

export function resolveRowsClassificationAtRender(rows) {
  return (Array.isArray(rows) ? rows : []).map(resolveClassificationAtRender);
}
