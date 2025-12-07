/**
 * Trustpilot Review Snapshot Configuration
 * 
 * This is a fixed snapshot of Trustpilot review metrics used in the Authority score calculation.
 * Update these values manually when Trustpilot metrics change significantly.
 */

export const TRUSTPILOT_SNAPSHOT = {
  rating: 4.6,   // Trustpilot current average
  count: 610,     // Total Trustpilot reviews at snapshot time
  snapshotDate: '2025-12-07', // Date when this snapshot was taken
  notes: 'Fixed Trustpilot snapshot for Authority score calculation. Update manually when Trustpilot metrics change significantly.'
} as const;

