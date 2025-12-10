/**
 * One-off script to calculate and backfill historical Authority and Visibility scores
 * 
 * This script uses MCP Supabase tools directly (no env vars needed)
 * 
 * Usage: Run this through Cursor with MCP Supabase enabled
 */

// Helper functions (same as dashboard logic)
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function calculatePositionScore(position) {
  const clampedPos = Math.max(1, Math.min(40, position));
  const scale = (clampedPos - 1) / 39;
  return 100 - scale * 90;
}

function calculateCtrScore(ctr) {
  // GSC timeseries stores CTR as decimal (0-1), but audit_results might store as percentage
  let ctrDecimal = ctr;
  if (ctr > 1) {
    ctrDecimal = ctr / 100;
  }
  return Math.min((ctrDecimal / 0.10) * 100, 100);
}

function calculateVisibilityScore(position) {
  const posScore = calculatePositionScore(position);
  return clampScore(posScore);
}

function calculateAuthorityScore(position, ctr) {
  const posScore = calculatePositionScore(position);
  const ctrScore = calculateCtrScore(ctr);
  
  const estimatedBehaviourScore = Math.min(ctrScore * 0.7, 70);
  const estimatedRankingScore = posScore * 0.6;
  const estimatedShareScore = 20;
  const estimatedRanking = estimatedRankingScore + estimatedShareScore;
  
  const backlinkScore = 50;
  const reviewScore = 50;
  
  return clampScore(
    0.4 * estimatedBehaviourScore +
    0.2 * estimatedRanking +
    0.2 * backlinkScore +
    0.2 * reviewScore
  );
}

// This script should be run through Cursor with MCP Supabase
// The actual execution will be done via SQL updates

console.log(`
Backfill Script Instructions:
==============================

This script calculates Authority and Visibility scores for historical audit records.

The script will:
1. Query all audit_results records with NULL authority_score or visibility_score
2. For each record, try to get GSC data from gsc_timeseries
3. Calculate scores using the same formulas as the dashboard
4. Update the audit_results table

To run this, execute the SQL queries below in sequence.
`);

