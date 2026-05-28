import { TIER_DEFINITIONS } from './revenue-tier-mapping.js';
import { isPlumbingProduct, VOLATILE_TIER_KEYS } from './revenue-truth-ui-core.mjs';

export function productTierKey(meta) {
  const cat = meta?.category;
  if (!cat) return null;
  for (const [key, def] of Object.entries(TIER_DEFINITIONS)) {
    if ((def.productCategories || []).includes(cat)) return key;
  }
  return null;
}

export function isExcludedFromMovers(finding) {
  if (finding.unit_type === 'product' && isPlumbingProduct(finding.unit_id)) return true;
  if (finding.unit_type === 'product') {
    const tier = productTierKey(finding.meta);
    if (tier && VOLATILE_TIER_KEYS.has(tier)) return true;
  }
  return false;
}

export function hasRealGrowth(nonjlr) {
  const y24 = nonjlr?.y2024 || 0;
  const y25 = nonjlr?.y2025 || 0;
  const y26ann = nonjlr?.y2026_annualised || 0;
  const y26closed = nonjlr?.y2026_ytd_closed || 0;
  if (y26closed <= 0 && y26ann <= 0) return false;
  if (y24 === 0 && y25 > 0 && y26ann < y25 * 0.5) return false;
  return y26ann > y25 || (y26closed > 0 && y26ann > y25);
}

export function isRankableFinding(f, key, mode) {
  if (isExcludedFromMovers(f)) return false;
  if (f.flags.includes('retired_wound_down') && mode === 'decline') return false;
  const d = f.deltas[key]?.delta_gbp;
  if (d == null) return false;
  if (mode === 'decline') return d < 0;
  return d > 0 && hasRealGrowth(f.series_nonjlr);
}
