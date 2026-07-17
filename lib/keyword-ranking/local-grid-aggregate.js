/**
 * Aggregate pack + organic positions across a local SERP grid.
 * Not-present points: excluded from average; counted in coverage denominator.
 */

function mean(nums) {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 100) / 100;
}

function bestOf(nums) {
  if (!nums.length) return null;
  return Math.min(...nums);
}

function surfaceAgg(positions, totalPoints) {
  const present = positions.filter((p) => p != null && Number.isFinite(Number(p))).map(Number);
  return {
    best_position: bestOf(present),
    average_position: mean(present),
    present_count: present.length,
    points: totalPoints,
    coverage: totalPoints > 0 ? Math.round((present.length / totalPoints) * 1000) / 1000 : 0,
  };
}

/**
 * @param {Array<{ point: object, pack_position: number|null, organic_position: number|null, best_url?: string|null }>} samples
 */
export function aggregateLocalGrid(samples) {
  const total = samples.length;
  const pack = surfaceAgg(samples.map((s) => s.pack_position), total);
  const organic = surfaceAgg(samples.map((s) => s.organic_position), total);
  const urlHit = samples.find((s) => s.organic_position != null && s.best_url);
  return {
    grid_size: Math.round(Math.sqrt(total)) || null,
    points: total,
    pack,
    organic,
    headline: {
      // average = headline (LocalViking AGR-style); null if never present
      local_pack_position: pack.average_position,
      best_rank_group: organic.average_position,
    },
    best_url: urlHit?.best_url || null,
    per_point: samples.map((s, pointIndex) => ({
      point_index: pointIndex,
      row: s.point?.row,
      col: s.point?.col,
      lat: s.point?.lat,
      lng: s.point?.lng,
      pack_position: s.pack_position ?? null,
      organic_position: s.organic_position ?? null,
    })),
  };
}

/** Prefer grid averages as headline ranks when local_grid is present. */
export function resolveHeadlinePackPosition(row) {
  const avg = row?.local_grid?.pack?.average_position;
  if (avg != null && Number.isFinite(Number(avg))) return Number(avg);
  const pos = row?.local_pack_position;
  return pos != null && Number.isFinite(Number(pos)) ? Number(pos) : null;
}

export function resolveHeadlineOrganicPosition(row) {
  const avg = row?.local_grid?.organic?.average_position;
  if (avg != null && Number.isFinite(Number(avg))) return Number(avg);
  const pos = row?.best_rank_group;
  return pos != null && Number.isFinite(Number(pos)) ? Number(pos) : null;
}

export function resolvePackPresent(row) {
  if (row?.local_grid?.pack) {
    return Number(row.local_grid.pack.present_count || 0) > 0;
  }
  return row?.local_pack_present_any === true;
}
