/**
 * Site AI Health overall = weighted Surface + Top of page + Brand.
 * Needles stay per-metric; centre score is this composite.
 */
export const SITE_AI_HEALTH_WEIGHTS = Object.freeze({
  surface: 0.4,
  top: 0.4,
  brand: 0.2,
});

function finiteOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{ surface?: number|null, top?: number|null, brand?: number|null }} parts
 * @returns {{ score: number|null, rag: 'green'|'amber'|'red'|null, weights: object, formula: string }}
 */
export function computeSiteAiHealthComposite(parts = {}) {
  const surface = finiteOrNull(parts.surface);
  const top = finiteOrNull(parts.top);
  const brand = finiteOrNull(parts.brand);
  const used = [];
  if (surface != null) used.push({ key: 'surface', w: SITE_AI_HEALTH_WEIGHTS.surface, v: surface });
  if (top != null) used.push({ key: 'top', w: SITE_AI_HEALTH_WEIGHTS.top, v: top });
  if (brand != null) used.push({ key: 'brand', w: SITE_AI_HEALTH_WEIGHTS.brand, v: brand });
  if (!used.length) {
    return {
      score: null,
      rag: null,
      weights: SITE_AI_HEALTH_WEIGHTS,
      formula: 'Surface 40% · Top of page 40% · Brand 20%',
    };
  }
  const wSum = used.reduce((s, p) => s + p.w, 0);
  const score = Math.round(used.reduce((s, p) => s + p.v * (p.w / wSum), 0));
  const rag = score >= 70 ? 'green' : score >= 40 ? 'amber' : 'red';
  return {
    score,
    rag,
    weights: SITE_AI_HEALTH_WEIGHTS,
    formula: 'Surface 40% · Top of page 40% · Brand 20%',
    used,
  };
}
