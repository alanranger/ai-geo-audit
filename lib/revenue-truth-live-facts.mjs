/** Live tier / slug facts for hybrid UI blocks (curated strategy text + live numbers). */

export function pctChange(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

function pickRev(yearTrend, includeJlr) {
  if (!yearTrend) return 0;
  return Number(includeJlr ? yearTrend.total : yearTrend.non_jlr) || 0;
}

/** Map of tier_key -> live revenue/at-risk facts, derived from the diagnosis tier rollup. */
export function buildTierFactsMap(diagnosis, includeJlr) {
  const map = new Map();
  for (const t of diagnosis?.tier_rollup || []) {
    const rt = t.revenue_trend || {};
    const y2024 = pickRev(rt.y2024, includeJlr);
    const y2025 = pickRev(rt.y2025, includeJlr);
    const y2026 = pickRev(rt.y2026_ytd, includeJlr);
    map.set(t.tier_key, {
      tier_key: t.tier_key,
      label: t.label,
      y2024,
      y2025,
      y2026_ytd: y2026,
      y2026_nonjlr: Number(rt.y2026_ytd?.non_jlr) || 0,
      yoy_24_25: pctChange(y2025, y2024),
      yoy_25_26: pctChange(y2026, y2025),
      at_risk_gbp: Number(t.pages_at_risk_gbp) || 0,
      severity: t.severity || null
    });
  }
  return map;
}

function matchSlug(slugObj, norm) {
  return String(slugObj?.slug || '').replace(/^\/+/, '') === norm;
}

/** Find Jan-2025+ GSC totals for a slug across hub + product role overlays. */
export function findSlugFacts(diagnosis, slug) {
  if (!slug) return null;
  const norm = String(slug).replace(/^\/+/, '');
  for (const t of diagnosis?.tier_rollup || []) {
    for (const role of [t.hub_gsc_trend, t.product_gsc_trend]) {
      const hit = (role?.slugs || []).find((s) => matchSlug(s, norm));
      if (hit) {
        return {
          slug: norm,
          impressions: Number(hit.impressions) || 0,
          clicks: Number(hit.clicks) || 0,
          position: hit.best_avg_position == null ? null : Math.round(Number(hit.best_avg_position) * 10) / 10
        };
      }
    }
  }
  return null;
}

/** Percentage drift between a curated baseline figure and the live figure. */
export function driftPct(baseline, live) {
  const b = Number(baseline);
  if (!Number.isFinite(b) || b === 0) return null;
  const l = Number(live) || 0;
  return Math.round(((l - b) / Math.abs(b)) * 1000) / 10;
}
