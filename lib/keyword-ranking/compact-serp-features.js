/**
 * serp_features for API responses. Keeps every capture/quality field the Ranking table reads
 * (capture_status, confirmation_state, organic_count, geo_method, …); only the per-check observation
 * list is capped, as it is the one field that grows.
 */

export const MAX_CONFIRMATION_OBSERVATIONS = 3;

export function compactSerpFeatures(raw) {
  let feats = raw || {};
  if (typeof feats === 'string') {
    try {
      feats = JSON.parse(feats);
    } catch {
      feats = {};
    }
  }
  if (typeof feats !== 'object' || feats === null || Array.isArray(feats)) return {};
  const out = { ...feats };
  if (Array.isArray(out.confirmation_observations) && out.confirmation_observations.length > MAX_CONFIRMATION_OBSERVATIONS) {
    out.confirmation_observations = out.confirmation_observations.slice(-MAX_CONFIRMATION_OBSERVATIONS);
  }
  return out;
}
