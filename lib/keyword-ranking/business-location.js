/**
 * Locked GBP centroid + local grid for Local-tier SERP capture.
 * Alan signed off 2026-07-16 (hyperlocal proof) and 5×5 grid brief.
 */

import locked from '../../config/business-location-LOCKED.json' with { type: 'json' };

const MILES_PER_DEG_LAT = 69.0;

export function getBusinessLocation() {
  return locked;
}

export function getBusinessCid() {
  return String(locked.cid || '');
}

export function getHyperlocalCoordinate() {
  const lat = Number(locked.lat);
  const lng = Number(locked.lng);
  const zoom = String(locked.coordinate_zoom || '14z');
  return `${lat},${lng},${zoom}`;
}

export function getBusinessDevice() {
  return String(locked.device || 'desktop');
}

export function getGridConfig() {
  const size = Math.max(1, Number(locked.grid_size) || 5);
  const catchmentMiles = Math.max(1, Number(locked.catchment_miles) || 16);
  const pointRadiusKm = Math.max(0.5, Number(locked.point_radius_km) || 2);
  return {
    grid_size: size,
    catchment_miles: catchmentMiles,
    point_radius_km: pointRadiusKm,
    points: size * size,
    lat: Number(locked.lat),
    lng: Number(locked.lng),
  };
}

/** 5×5 (etc.) lat/lng points centred on GBP across catchment_miles. */
export function buildLocalGridPoints() {
  const cfg = getGridConfig();
  const n = cfg.grid_size;
  const half = (n - 1) / 2;
  const stepMiles = cfg.catchment_miles / Math.max(1, n - 1);
  const stepLat = stepMiles / MILES_PER_DEG_LAT;
  const stepLng = stepLat / Math.cos((cfg.lat * Math.PI) / 180);
  const points = [];
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const di = row - half;
      const dj = col - half;
      points.push({
        row,
        col,
        lat: Number((cfg.lat + di * stepLat).toFixed(7)),
        lng: Number((cfg.lng + dj * stepLng).toFixed(7)),
      });
    }
  }
  return points;
}

/**
 * DFS location_coordinate for one grid point.
 * Prefer zoom token (e.g. 14z) — matches GeoGrid-fidelity organic compare (2026-07-16).
 * Fallback: point_radius_km → metres (DFS min 199, max 199999).
 */
export function gridPointCoordinate(point) {
  const zoom = String(locked.coordinate_zoom || '').trim();
  if (/^\d+z$/i.test(zoom)) {
    return `${point.lat},${point.lng},${zoom}`;
  }
  const km = getGridConfig().point_radius_km;
  const meters = Math.round(Number(km) * 1000);
  const radius = Math.max(199, Math.min(199999, meters || 2000));
  return `${point.lat},${point.lng},${radius}`;
}
