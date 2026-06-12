/**
 * Unit test: trend chart authority resolution logic (no network).
 * Run: node scripts/test-authority-trend-logic.mjs
 */
import { recomputeAuthorityTotal } from '../lib/audit/authorityScore.js';

const AUTHORITY_COMPONENT_WEIGHTS = { behaviour: 0.4, ranking: 0.2, backlinks: 0.2, reviews: 0.2 };
function clampScore(v) {
  return Math.max(0, Math.min(100, Math.round(v)));
}
function recomputeAuthorityTotalFromComponents(b, r, bl, rv) {
  return recomputeAuthorityTotal(b, r, bl, rv);
}

function resolveTrendLiveAuthorityScore(mode, scores) {
  const bySegment = scores?.authority?.bySegment;
  const components = scores?.authorityComponents || {};
  const seg = (bySegment && bySegment[mode]) || (bySegment && bySegment.all) || null;
  if (seg) {
    if (typeof seg.total === 'number' && Number.isFinite(seg.total)) return seg.total;
    if (typeof seg.score === 'number' && Number.isFinite(seg.score)) return seg.score;
    const recomputed = recomputeAuthorityTotalFromComponents(
      seg.behaviour ?? components.behaviour,
      seg.ranking ?? components.ranking,
      seg.backlinks ?? components.backlinks,
      seg.reviews ?? components.reviews
    );
    if (recomputed !== null) return recomputed;
  }
  const authObj = scores?.authority;
  if (typeof authObj === 'object' && authObj !== null) {
    if (typeof authObj.score === 'number' && Number.isFinite(authObj.score)) return authObj.score;
  }
  return null;
}

// Case: stale components sum to 45 but bySegment.total is 52 (scorecard scenario)
const liveScores = {
  authority: {
    score: 52,
    bySegment: {
      all: { total: 52, behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 },
    },
  },
  authorityComponents: { behaviour: 5, ranking: 41, backlinks: 87, reviews: 86 },
};

const staleLocalStorage = {
  authority: {
    score: 45,
    bySegment: { all: { total: 45, behaviour: 5, ranking: 41, backlinks: 87, reviews: 86 } },
  },
  authorityComponents: { behaviour: 5, ranking: 41, backlinks: 87, reviews: 86 },
};

const fromLatest = resolveTrendLiveAuthorityScore('all', liveScores);
const fromStale = resolveTrendLiveAuthorityScore('all', staleLocalStorage);
const fromLatestNotStale = resolveTrendLiveAuthorityScore('all', liveScores);

let failed = 0;
if (fromLatest !== 52) {
  console.error('FAIL: live bySegment.total should win → 52, got', fromLatest);
  failed += 1;
} else {
  console.log('PASS: live total 52 preferred over stale components');
}

if (fromStale !== 45) {
  console.error('FAIL: when only stale data, expected 45, got', fromStale);
  failed += 1;
} else {
  console.log('PASS: stale segment total 45 when no live override');
}

// Simulate isLatestAudit choosing window.latestAuditScores over localStorage
const currentScores = liveScores || staleLocalStorage;
const latestPoint = resolveTrendLiveAuthorityScore('all', currentScores);
if (latestPoint !== 52) {
  console.error('FAIL: latestAuditScores path expected 52, got', latestPoint);
  failed += 1;
} else {
  console.log('PASS: latestAuditScores path → 52 on last GSC day');
}

console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll authority trend logic tests PASSED');
process.exit(failed ? 1 : 0);
