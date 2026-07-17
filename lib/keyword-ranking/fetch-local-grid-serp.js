/**
 * Fetch one Local-tier keyword across the locked GBP 5×5 grid and aggregate.
 */

import {
  buildLocalGridPoints,
  getGridConfig,
  gridPointCoordinate,
} from './business-location.js';
import { aggregateLocalGrid } from './local-grid-aggregate.js';
import { fetchSerpForKeyword } from '../../api/aigeo/serp-rank-test.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @returns {Promise<object>} serp-shaped result + local_grid aggregate
 */
export async function fetchLocalGridSerp(keyword, auth, targetRoot, depth, opts = {}) {
  const points = buildLocalGridPoints();
  const cfg = getGridConfig();
  const samples = [];
  let anchor = null;
  let cost = 0;

  for (const point of points) {
    const serp = await fetchSerpForKeyword(keyword, auth, targetRoot, depth, {
      ...opts,
      tier: 'L',
      location_coordinate: gridPointCoordinate(point),
    });
    cost += 0.008;
    if (serp?.fatal) {
      return { ...serp, local_grid: null, grid_cost_usd: cost, error: serp.error || 'DFS fatal' };
    }
    samples.push({
      point,
      pack_position: serp.local_pack_position ?? null,
      organic_position: serp.best_rank_group ?? null,
      best_url: serp.best_url ?? null,
      serp,
    });
    if (!anchor) anchor = serp;
    // Prefer centroid cell (middle of grid) as stack/display anchor when available
    const mid = (cfg.grid_size - 1) / 2;
    if (point.row === mid && point.col === mid) anchor = serp;
    await sleep(opts.delayMs != null ? opts.delayMs : 250);
  }

  const grid = aggregateLocalGrid(samples);
  grid.grid_size = cfg.grid_size;
  grid.catchment_miles = cfg.catchment_miles;
  grid.point_radius_km = cfg.point_radius_km;
  grid.center = { lat: cfg.lat, lng: cfg.lng };

  const packPresent = grid.pack.present_count > 0;
  const avgPack = grid.pack.average_position;
  const avgOrganic = grid.organic.average_position;
  // Integer columns on keyword_rankings; precise averages live in local_grid JSON.
  const headlinePackInt = avgPack != null ? Math.round(avgPack) : null;
  const headlineOrganicInt = avgOrganic != null ? Math.round(avgOrganic) : null;

  // Patch centroid stack pack/organic our_position to grid averages for dials/UI
  const stack = Array.isArray(anchor?.serp_surface_stack)
    ? anchor.serp_surface_stack.map((el) => {
      if (el?.type === 'local_pack') {
        return {
          ...el,
          our_position: avgPack,
          ours: packPresent,
          grid_best: grid.pack.best_position,
          grid_coverage: grid.pack.coverage,
        };
      }
      if (el?.type === 'organic' && el.our_position != null) {
        return { ...el, our_position: avgOrganic, grid_best: grid.organic.best_position };
      }
      return el;
    })
    : [];

  return {
    ...(anchor || {}),
    keyword,
    local_pack_position: headlinePackInt,
    local_pack_present_any: packPresent || Boolean(anchor?.local_pack_present_any),
    best_rank_group: headlineOrganicInt,
    best_url: grid.best_url || anchor?.best_url || null,
    serp_surface_stack: stack,
    location_coordinate: `grid:${cfg.grid_size}x${cfg.grid_size}@${cfg.lat},${cfg.lng}`,
    local_grid: grid,
    grid_cost_usd: Math.round(cost * 1000) / 1000,
  };
}
