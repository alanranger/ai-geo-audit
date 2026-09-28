/**
 * Pre-flight: every Local-tier keyword must resolve with verified GBP pin
 * + Coventry location_code before any DataForSEO spend.
 *
 * Primary Local series = GBP pin (Sep21-verified locked config).
 * City-code-only is a separate opt-in method — never mixed into the pin series.
 */

import { resolveTrackingLocation, LOCATION_LOCAL } from './tracking-location.js';
import { getHyperlocalCoordinate } from './business-location.js';
import {
  GEO_METHOD_GBP_PIN,
  GEO_METHOD_CITY_CODE,
  METHOD_VERSION_LOCAL_PIN,
  METHOD_VERSION_LOCAL_CITY,
} from './dfs-serp-quality.js';

/** Verified Sep21 / locked-config pin prefix (config/business-location-LOCKED.json). */
export const EXPECTED_PIN_PREFIX = '52.3991769,-1.5937149';

/**
 * @param {string} keyword
 * @param {{ forceCityCode?: boolean }} [opts]
 */
export function resolveLocalCaptureFields(keyword, opts = {}) {
  const loc = resolveTrackingLocation(keyword);
  if (loc.tier !== 'L') {
    return {
      location_name: loc.location_name,
      location_code: loc.location_code,
      location_coordinate: null,
      tier: loc.tier,
      geo_method: null,
      method_version: null,
      ready: true,
    };
  }
  const codeOk = Number(loc.location_code) === Number(LOCATION_LOCAL.location_code);
  const forceCity = opts.forceCityCode === true;
  if (forceCity) {
    return {
      location_name: loc.location_name || LOCATION_LOCAL.location_name,
      location_code: LOCATION_LOCAL.location_code,
      location_coordinate: null,
      tier: 'L',
      geo_method: GEO_METHOD_CITY_CODE,
      method_version: METHOD_VERSION_LOCAL_CITY,
      ready: codeOk,
    };
  }
  const pin = getHyperlocalCoordinate();
  const pinOk = typeof pin === 'string' && pin.startsWith(EXPECTED_PIN_PREFIX);
  return {
    location_name: loc.location_name || LOCATION_LOCAL.location_name,
    location_code: LOCATION_LOCAL.location_code,
    location_coordinate: pinOk ? pin : null,
    tier: 'L',
    geo_method: GEO_METHOD_GBP_PIN,
    method_version: METHOD_VERSION_LOCAL_PIN,
    ready: codeOk && pinOk,
  };
}

/** Returns { ok, pin, missingKeywords } — missing = Local-tier without pin/code. */
export function preflightLocalCapture(keywords, opts = {}) {
  const forceCity = opts.forceCityCode === true;
  const pin = forceCity ? null : getHyperlocalCoordinate();
  const pinOk = forceCity || (typeof pin === 'string' && pin.startsWith(EXPECTED_PIN_PREFIX));
  const missingKeywords = [];
  for (const kw of keywords || []) {
    const meta = resolveLocalCaptureFields(kw, opts);
    if (meta.tier === 'L' && !meta.ready) missingKeywords.push(String(kw));
  }
  return {
    ok: pinOk && missingKeywords.length === 0,
    pin: pinOk && !forceCity ? pin : null,
    location_code: LOCATION_LOCAL.location_code,
    geo_method: forceCity ? GEO_METHOD_CITY_CODE : GEO_METHOD_GBP_PIN,
    method_version: forceCity ? METHOD_VERSION_LOCAL_CITY : METHOD_VERSION_LOCAL_PIN,
    missingKeywords,
  };
}

/**
 * Stamp local capture fields onto a row when missing (save-path defense).
 * Never invents a pin onto an explicit city-code observation.
 */
export function stampLocalCaptureOnRow(row, opts = {}) {
  if (!row?.keyword) return row;
  const explicitCity = row?.serp_features?.geo_method === GEO_METHOD_CITY_CODE
    || (row.location_coordinate == null
      && Number(row.location_code) === Number(LOCATION_LOCAL.location_code)
      && row?.serp_features?.method_version === METHOD_VERSION_LOCAL_CITY);
  const meta = resolveLocalCaptureFields(row.keyword, {
    forceCityCode: opts.forceCityCode === true || explicitCity,
  });
  if (meta.tier !== 'L') {
    if (row.location_code == null && meta.location_code != null) {
      row.location_code = meta.location_code;
    }
    return row;
  }
  row.location_name = row.location_name || meta.location_name;
  row.location_code = meta.location_code;
  if (meta.geo_method === GEO_METHOD_CITY_CODE) {
    // Preserve city-code series — do not overwrite with pin.
    row.location_coordinate = null;
  } else {
    row.location_coordinate = row.location_coordinate || meta.location_coordinate;
  }
  if (!row.serp_features || typeof row.serp_features !== 'object') row.serp_features = {};
  if (!row.serp_features.geo_method) row.serp_features.geo_method = meta.geo_method;
  if (!row.serp_features.method_version) row.serp_features.method_version = meta.method_version;
  return row;
}
