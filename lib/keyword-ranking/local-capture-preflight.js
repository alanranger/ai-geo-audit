/**
 * Pre-flight: every Local-tier keyword must resolve to Coventry city
 * location_code (9215523). Ranking uses city-level SERP only — no GBP pin.
 */

import { resolveTrackingLocation, LOCATION_LOCAL } from './tracking-location.js';

export function resolveLocalCaptureFields(keyword) {
  const loc = resolveTrackingLocation(keyword);
  if (loc.tier !== 'L') {
    return {
      location_name: loc.location_name,
      location_code: loc.location_code,
      location_coordinate: null,
      tier: loc.tier,
      ready: true,
    };
  }
  const codeOk = Number(loc.location_code) === Number(LOCATION_LOCAL.location_code);
  return {
    location_name: loc.location_name || LOCATION_LOCAL.location_name,
    location_code: LOCATION_LOCAL.location_code,
    location_coordinate: null,
    tier: 'L',
    ready: codeOk,
  };
}

/** Returns { ok, pin: null, missingKeywords } — missing = Local-tier without Coventry code. */
export function preflightLocalCapture(keywords) {
  const missingKeywords = [];
  for (const kw of keywords || []) {
    const meta = resolveLocalCaptureFields(kw);
    if (meta.tier === 'L' && !meta.ready) missingKeywords.push(String(kw));
  }
  return {
    ok: missingKeywords.length === 0,
    pin: null,
    location_code: LOCATION_LOCAL.location_code,
    missingKeywords,
  };
}

/** Stamp local capture fields onto a row when missing (save-path defense). */
export function stampLocalCaptureOnRow(row) {
  if (!row?.keyword) return row;
  const meta = resolveLocalCaptureFields(row.keyword);
  if (meta.tier !== 'L') {
    if (row.location_code == null && meta.location_code != null) {
      row.location_code = meta.location_code;
    }
    return row;
  }
  row.location_name = row.location_name || meta.location_name;
  row.location_code = meta.location_code;
  // City-level only — never persist / invent a GBP pin on ranking rows.
  row.location_coordinate = null;
  return row;
}
