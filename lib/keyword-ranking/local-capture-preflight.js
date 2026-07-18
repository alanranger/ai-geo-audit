/**
 * Pre-flight: every Local-tier keyword must resolve with GBP pin + Coventry code
 * before any DataForSEO spend.
 */

import { resolveTrackingLocation, LOCATION_LOCAL } from './tracking-location.js';
import { getHyperlocalCoordinate } from './business-location.js';

const EXPECTED_PIN_PREFIX = '52.3991769,-1.5937149';

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
  const pin = getHyperlocalCoordinate();
  const codeOk = Number(loc.location_code) === Number(LOCATION_LOCAL.location_code);
  const pinOk = typeof pin === 'string' && pin.startsWith(EXPECTED_PIN_PREFIX);
  return {
    location_name: loc.location_name || LOCATION_LOCAL.location_name,
    location_code: LOCATION_LOCAL.location_code,
    location_coordinate: pinOk ? pin : null,
    tier: 'L',
    ready: codeOk && pinOk,
  };
}

/** Returns { ok, pin, missingKeywords } — missing = Local-tier without pin/code. */
export function preflightLocalCapture(keywords) {
  const pin = getHyperlocalCoordinate();
  const pinOk = typeof pin === 'string' && pin.startsWith(EXPECTED_PIN_PREFIX);
  const missingKeywords = [];
  for (const kw of keywords || []) {
    const meta = resolveLocalCaptureFields(kw);
    if (meta.tier === 'L' && !meta.ready) missingKeywords.push(String(kw));
  }
  return {
    ok: pinOk && missingKeywords.length === 0,
    pin: pinOk ? pin : null,
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
  row.location_coordinate = row.location_coordinate || meta.location_coordinate;
  return row;
}
