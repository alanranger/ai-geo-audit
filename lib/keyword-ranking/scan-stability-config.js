/**
 * Ranking scan guard limits (9 Nov 2026), as read by the acceptance gate and the CEO brief gate.
 * The values live in scan-stability-guard.js (MATCHING_FAILURE_SHARE, VOLATILE_FLIP_RATE).
 *
 * unresolvedMaxShare — PRIMARY "suspect: matching" hold. Share of organic + local-pack owner slots still on
 *   google.com after the redirect links are decoded.
 * volatileFlipShare — SECONDARY, non-blocking "volatile capture" note. Share of comparable keywords flipping
 *   between #1–3 and not found since the last published scan.
 */
import { MATCHING_FAILURE_SHARE, VOLATILE_FLIP_RATE } from './scan-stability-guard.js';

export const SCAN_STABILITY = Object.freeze({
  unresolvedMaxShare: MATCHING_FAILURE_SHARE,
  volatileFlipShare: VOLATILE_FLIP_RATE,
});
