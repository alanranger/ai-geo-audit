/**
 * Shared Authority pillar scoring (4 components → total).
 * Used by save-audit, backfill scripts, and kept in sync with audit-dashboard.html.
 */

export const AUTHORITY_WEIGHTS = {
  behaviour: 0.35,
  ranking: 0.15,
  backlinks: 0.3,
  reviews: 0.2,
};

export const AUTHORITY_WEIGHTS_LEGACY = {
  behaviour: 0.4,
  ranking: 0.2,
  backlinks: 0.2,
  reviews: 0.2,
};

export const AUTHORITY_WEIGHTS_CHANGED_DATE = '2026-07-15';

export function getAuthorityWeightsForDate(dateStr) {
  const d = typeof dateStr === 'string' ? dateStr.split('T')[0] : '';
  return d && d < AUTHORITY_WEIGHTS_CHANGED_DATE ? AUTHORITY_WEIGHTS_LEGACY : AUTHORITY_WEIGHTS;
}

export function clampAuthorityScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function recomputeAuthorityTotalWithWeights(weights, behaviour, ranking, backlinks, reviews) {
  const parts = [behaviour, ranking, backlinks, reviews];
  if (parts.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return clampAuthorityScore(
    weights.behaviour * behaviour +
      weights.ranking * ranking +
      weights.backlinks * backlinks +
      weights.reviews * reviews
  );
}

export function recomputeAuthorityTotal(behaviour, ranking, backlinks, reviews) {
  return recomputeAuthorityTotalWithWeights(AUTHORITY_WEIGHTS, behaviour, ranking, backlinks, reviews);
}

export function extractAuthorityComponentsFromScores(scores) {
  if (!scores || typeof scores !== 'object') return null;
  const ac = scores.authorityComponents;
  if (ac && typeof ac === 'object') {
    const total = recomputeAuthorityTotal(ac.behaviour, ac.ranking, ac.backlinks, ac.reviews);
    if (total !== null) {
      return {
        behaviour: clampAuthorityScore(ac.behaviour),
        ranking: clampAuthorityScore(ac.ranking),
        backlinks: clampAuthorityScore(ac.backlinks),
        reviews: clampAuthorityScore(ac.reviews),
        total,
      };
    }
  }
  const seg = scores.authority?.bySegment?.all;
  if (seg && typeof seg === 'object') {
    const total = recomputeAuthorityTotal(seg.behaviour, seg.ranking, seg.backlinks, seg.reviews);
    if (total !== null) {
      return {
        behaviour: clampAuthorityScore(seg.behaviour),
        ranking: clampAuthorityScore(seg.ranking),
        backlinks: clampAuthorityScore(seg.backlinks),
        reviews: clampAuthorityScore(seg.reviews),
        total,
      };
    }
  }
  return null;
}

/**
 * Resolve authority fields for audit_results row.
 * Prefers recomputed total from components; falls back to stored authority_score.
 */
export function normalizeAuthorityForAuditRecord(scores, existingRecord = {}) {
  const fromScores = extractAuthorityComponentsFromScores(scores);
  if (fromScores) {
    return {
      authority_score: fromScores.total,
      authority_behaviour_score: fromScores.behaviour,
      authority_ranking_score: fromScores.ranking,
      authority_backlink_score: fromScores.backlinks,
      authority_review_score: fromScores.reviews,
      source: 'components',
    };
  }

  const behaviour = existingRecord.authority_behaviour_score;
  const ranking = existingRecord.authority_ranking_score;
  const backlinks = existingRecord.authority_backlink_score;
  const reviews = existingRecord.authority_review_score;
  const fromExisting = recomputeAuthorityTotal(behaviour, ranking, backlinks, reviews);
  if (fromExisting !== null) {
    return {
      authority_score: fromExisting,
      authority_behaviour_score: clampAuthorityScore(behaviour),
      authority_ranking_score: clampAuthorityScore(ranking),
      authority_backlink_score: clampAuthorityScore(backlinks),
      authority_review_score: clampAuthorityScore(reviews),
      source: 'existing_components',
    };
  }

  const raw =
    typeof scores?.authority === 'object' && scores?.authority !== null
      ? scores.authority.score
      : scores?.authority;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { authority_score: clampAuthorityScore(raw), source: 'legacy_total_only' };
  }

  return null;
}

export function resolveAuthorityFromHistoryRecord(record, lastGood = {}) {
  const pick = (snake, camel) => {
    const v = record[snake] ?? record[camel];
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v > 0) lastGood[snake] = v;
      return v;
    }
    if (typeof lastGood[snake] === 'number' && Number.isFinite(lastGood[snake])) {
      return lastGood[snake];
    }
    return null;
  };

  const behaviour = pick('authority_behaviour_score', 'authorityBehaviourScore');
  const ranking = pick('authority_ranking_score', 'authorityRankingScore');
  const backlinks = pick('authority_backlink_score', 'authorityBacklinkScore');
  const reviews = pick('authority_review_score', 'authorityReviewScore');
  const stored = record.authorityScore ?? record.authority_score;
  const dateStr = record.date ? String(record.date).split('T')[0] : '';
  const useLegacy = dateStr && dateStr < AUTHORITY_WEIGHTS_CHANGED_DATE;

  const parts = [behaviour, ranking, backlinks, reviews];
  if (parts.every((p) => p === null)) {
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      return { total: stored, behaviour: 0, ranking: 0, backlinks: 0, reviews: 0, stored, usedSmoothing: false };
    }
    return null;
  }

  const filled = parts.map((p) => (p === null ? 0 : p));
  if (useLegacy && typeof stored === 'number' && Number.isFinite(stored)) {
    return {
      total: stored,
      behaviour: filled[0],
      ranking: filled[1],
      backlinks: filled[2],
      reviews: filled[3],
      stored,
      usedSmoothing: false,
    };
  }

  const weights = getAuthorityWeightsForDate(dateStr);
  const total = recomputeAuthorityTotalWithWeights(weights, filled[0], filled[1], filled[2], filled[3]);
  if (total === null) {
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      return { total: stored, behaviour: filled[0], ranking: filled[1], backlinks: filled[2], reviews: filled[3], stored, usedSmoothing: false };
    }
    return null;
  }

  const usedSmoothing =
    typeof stored === 'number' &&
    Number.isFinite(stored) &&
    stored !== total &&
    parts.some((p, i) => p === null || (record[['authority_behaviour_score', 'authority_ranking_score', 'authority_backlink_score', 'authority_review_score'][i]] === 0));

  return {
    total,
    behaviour: filled[0],
    ranking: filled[1],
    backlinks: filled[2],
    reviews: filled[3],
    stored,
    usedSmoothing,
  };
}
