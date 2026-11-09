/**
 * Pre-send sense-check for the Monday CEO brief (batch 8 task 8, Alan approved 2 Nov 2026).
 * The brief is held — Alan gets a short "held" note instead — when any check fails.
 */
import { SCAN_STABILITY } from '../keyword-ranking/scan-stability-config.js';

export const BRIEF_GATE = {
  /** Surface visibility or top-of-page moving more than this share week on week. */
  maxDialMoveShare: 0.3,
  /** Top-10 keyword count dropping by more than this share. */
  maxTop10DropShare: 1 / 3,
  /** Organic / local-pack owner slots still on google.com (same limit as the ranking "suspect: matching" guard). */
  maxGoogleOwnerShare: SCAN_STABILITY.unresolvedMaxShare,
  /** Brief data sources that must have refreshed this week (Monday refresh step keys). */
  requiredSteps: ['audit_scan', 'ranking_ai', 'trad_seo_render', 'revenue_sync', 'ga4_sync'],
};
