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

export function hasRealGrowth(series) {
  const y24 = series?.y2024 || 0;
  const y25 = series?.y2025 || 0;
  const y26ann = series?.y2026_annualised || 0;
  const y26closed = series?.y2026_ytd_closed || 0;
  if (y26closed <= 0 && y26ann <= 0) return false;
  if (y24 === 0 && y25 > 0 && y26ann < y25 * 0.5) return false;
  return y26ann > y25 || (y26closed > 0 && y26ann > y25);
}

export function deltaKeyForWindow(window, includeJlr) {
  const wk = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  return `${includeJlr ? 'total' : 'nonjlr'}_${wk}`;
}

export function isRankableFinding(f, key, mode, series = null) {
  if (isExcludedFromMovers(f)) return false;
  if (f.flags.includes('retired_wound_down') && mode === 'decline') return false;
  const d = f.deltas[key]?.delta_gbp;
  if (d == null) return false;
  const s = series || f.series_nonjlr;
  if (mode === 'decline') return d < 0;
  return d > 0 && hasRealGrowth(s);
}

export function rankTopFindings(allFindings, window, mode, includeJlr, topN = 5) {
  const key = deltaKeyForWindow(window, includeJlr);
  const candidates = allFindings.filter((f) =>
    isRankableFinding(f, key, mode, includeJlr ? f.series_total : f.series_nonjlr));
  candidates.sort((a, z) => {
    const da = a.deltas[key]?.delta_gbp || 0;
    const dz = z.deltas[key]?.delta_gbp || 0;
    return mode === 'decline' ? da - dz : dz - da;
  });
  return candidates.slice(0, topN);
}
