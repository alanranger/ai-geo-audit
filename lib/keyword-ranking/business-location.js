/**
 * Locked GBP centroid for hyperlocal Local-tier SERP capture.
 * Alan signed off 2026-07-16 (Step 1 proof + green-light).
 */

import locked from '../../config/business-location-LOCKED.json' with { type: 'json' };

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
