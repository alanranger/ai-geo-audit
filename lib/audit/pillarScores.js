import { PageSegment, classifyPageSegment } from '../../api/aigeo/pageSegment.js';
import { calculateBrandMetrics, computeBrandOverlay } from './brandOverlay.js';

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

const normalisePct = (value, max) => {
  const pct = Math.max(0, Math.min(1, value / max));
  return pct * 100;
};

const normalisePosition = (pos, minPos, maxPos) => {
  const clamped = Math.max(minPos, Math.min(maxPos, pos));
  const t = (clamped - minPos) / (maxPos - minPos);
  return 100 - t * 90;
};

const computeBehaviourScoreRaw = (queries) => {
  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return 50;
  }

  const ranking = queries.filter((q) => q.position > 0 && q.position <= 20 && q.impressions > 0);
  if (ranking.length === 0) return 50;

  const totalClicks = ranking.reduce((s, q) => s + q.clicks, 0);
  const totalImpr = ranking.reduce((s, q) => s + q.impressions, 0);
  const ctrAll = totalImpr > 0 ? totalClicks / totalImpr : 0;

  const top10 = ranking.filter((q) => q.position <= 10);
  const top10Clicks = top10.reduce((s, q) => s + q.clicks, 0);
  const top10Impr = top10.reduce((s, q) => s + q.impressions, 0);
  const ctrTop10 = top10Impr > 0 ? top10Clicks / top10Impr : ctrAll;

  const ctrScoreAll = normalisePct(ctrAll, 0.05);
  const ctrScoreTop10 = normalisePct(ctrTop10, 0.1);

  return 0.5 * ctrScoreAll + 0.5 * ctrScoreTop10;
};

const computeBehaviourScoreWithSegment = (queryPages) => {
  if (!queryPages || !Array.isArray(queryPages) || queryPages.length === 0) {
    return { all: 50, nonBlog: 50, money: 50 };
  }

  const withSegment = queryPages.map((row) => {
    const segment = classifyPageSegment(row.page || row.url || '/');
    return { ...row, __segment: segment };
  });

  const toQueryFormat = (rows) => rows.map((r) => ({
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: (r.ctr || 0) / 100,
    position: r.position || 0
  }));

  const all = computeBehaviourScoreRaw(toQueryFormat(withSegment));
  const nonBlog = computeBehaviourScoreRaw(
    toQueryFormat(withSegment.filter((r) => r.__segment !== PageSegment.EDUCATION))
  );
  const money = computeBehaviourScoreRaw(
    toQueryFormat(withSegment.filter((r) => r.__segment === PageSegment.MONEY))
  );

  return { all, nonBlog, money };
};

const computeRankingScoreRaw = (queries) => {
  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    return 50;
  }

  const ranking = queries.filter((q) => q.position > 0 && q.position <= 20 && q.impressions > 0);
  if (ranking.length === 0) return 50;

  const totalImpr = ranking.reduce((s, q) => s + q.impressions, 0);
  const avgPos = totalImpr > 0
    ? ranking.reduce((s, q) => s + q.position * q.impressions, 0) / totalImpr
    : 0;

  const clampedPos = Math.max(1, Math.min(20, avgPos));
  const posScore = normalisePosition(clampedPos, 1, 20);

  const top10Impr = ranking.filter((q) => q.position <= 10).reduce((s, q) => s + q.impressions, 0);
  const top10Share = totalImpr > 0 ? top10Impr / totalImpr : 0;
  const top10Score = top10Share * 100;

  return 0.5 * posScore + 0.5 * top10Score;
};

const computeRankingScoreWithSegment = (queryPages) => {
  if (!queryPages || !Array.isArray(queryPages) || queryPages.length === 0) {
    return { all: 50, nonBlog: 50, money: 50 };
  }

  const withSegment = queryPages.map((row) => {
    const segment = classifyPageSegment(row.page || row.url || '/');
    return { ...row, __segment: segment };
  });

  const toQueryFormat = (rows) => rows.map((r) => ({
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: (r.ctr || 0) / 100,
    position: r.position || 0
  }));

  const all = computeRankingScoreRaw(toQueryFormat(withSegment));
  const nonBlog = computeRankingScoreRaw(
    toQueryFormat(withSegment.filter((r) => r.__segment !== PageSegment.EDUCATION))
  );
  const money = computeRankingScoreRaw(
    toQueryFormat(withSegment.filter((r) => r.__segment === PageSegment.MONEY))
  );

  return { all, nonBlog, money };
};

const computeReviewScore = (opts = {}) => {
  const {
    gbpRating = null,
    gbpCount = null,
    siteRating = null,
    siteCount = null
  } = opts;

  const hasGBP = (gbpRating != null && gbpRating > 0) || (gbpCount != null && gbpCount > 0);
  const hasSite = (siteRating != null && siteRating > 0) || (siteCount != null && siteCount > 0);

  if (!hasGBP && !hasSite) return 50;

  const gbpScore = hasGBP ? clampScore(((gbpRating || 0) / 5) * 100) : null;
  const siteScore = hasSite ? clampScore(((siteRating || 0) / 5) * 100) : null;

  if (gbpScore != null && siteScore != null) return clampScore((gbpScore + siteScore) / 2);
  return gbpScore != null ? gbpScore : siteScore;
};

const computeBacklinkScore = (m) => {
  if (!m) return 0;
  const referringDomains = Number(m.referringDomains || 0);
  const totalBacklinks = Number(m.totalBacklinks || 0);
  const followRatio = Number(m.followRatio || 0);

  if (!referringDomains && !totalBacklinks) return 0;

  const domainScore = Math.min(100, referringDomains);
  const backlinkScore = Math.min(100, totalBacklinks / 10);
  const followScore = Math.min(100, followRatio * 100);

  return clampScore(0.5 * domainScore + 0.3 * backlinkScore + 0.2 * followScore);
};

const getTrustpilotSnapshot = (siteReviews = null) => {
  const snapshot = {
    siteRating: 4.6,
    siteReviewCount: 610,
    lastUpdated: '2025-12-07',
    notes: 'Fixed Trustpilot snapshot for Authority score calculation. Update manually when Trustpilot metrics change significantly.'
  };

  if (!siteReviews) return snapshot;

  const rating = Number(siteReviews.siteRating);
  const count = Number(siteReviews.siteReviewCount);
  if (!Number.isFinite(rating) || !Number.isFinite(count)) return snapshot;

  return {
    siteRating: rating,
    siteReviewCount: count,
    lastUpdated: siteReviews.lastUpdated || snapshot.lastUpdated,
    notes: siteReviews.notes || snapshot.notes
  };
};

const calculateSnippetReadiness = (scores) => {
  const authorityScore = typeof scores.authority === 'object' ? scores.authority.score : scores.authority;
  const readiness = (
    scores.contentSchema * 0.4 +
    scores.visibility * 0.35 +
    authorityScore * 0.25
  );
  return Math.round(Math.min(100, Math.max(0, readiness)));
};

const computeVisibility = (position) => {
  const clampedPos = Math.max(1, Math.min(40, position || 40));
  const scale = (clampedPos - 1) / 39;
  return clampScore(100 - scale * 90);
};

const computeSegmentedScores = (queryPages, topQueries) => {
  if (Array.isArray(queryPages) && queryPages.length > 0) {
    const behaviourScoresSegmented = computeBehaviourScoreWithSegment(queryPages);
    const rankingScoresSegmented = computeRankingScoreWithSegment(queryPages);
    return {
      behaviourScore: behaviourScoresSegmented.all,
      rankingScore: rankingScoresSegmented.all,
      behaviourScoresSegmented,
      rankingScoresSegmented
    };
  }

  const queriesForCalculation = (topQueries || []).map((q) => ({
    clicks: q.clicks || 0,
    impressions: q.impressions || 0,
    ctr: (q.ctr || 0) / 100,
    position: q.position || 0
  }));

  return {
    behaviourScore: computeBehaviourScoreRaw(queriesForCalculation),
    rankingScore: computeRankingScoreRaw(queriesForCalculation),
    behaviourScoresSegmented: null,
    rankingScoresSegmented: null
  };
};

const computeAuthorityScores = ({
  behaviourScore,
  rankingScore,
  behaviourScoresSegmented,
  rankingScoresSegmented,
  reviewScore,
  backlinkScore
}) => {
  const AUTHORITY_WEIGHTS = {
    behaviour: 0.4,
    ranking: 0.2,
    backlinks: 0.2,
    reviews: 0.2
  };

  const computeAuthorityFromComponents = (components) => {
    const total = clampScore(
      AUTHORITY_WEIGHTS.behaviour * components.behaviour +
      AUTHORITY_WEIGHTS.ranking * components.ranking +
      AUTHORITY_WEIGHTS.backlinks * components.backlinks +
      AUTHORITY_WEIGHTS.reviews * components.reviews
    );
    return {
      behaviour: clampScore(components.behaviour),
      ranking: clampScore(components.ranking),
      backlinks: clampScore(components.backlinks),
      reviews: clampScore(components.reviews),
      total
    };
  };

  const authorityAll = computeAuthorityFromComponents({
    behaviour: behaviourScore,
    ranking: rankingScore,
    backlinks: backlinkScore,
    reviews: reviewScore
  });

  let authorityBySegment = null;
  if (behaviourScoresSegmented && rankingScoresSegmented) {
    authorityBySegment = {
      all: computeAuthorityFromComponents({
        behaviour: behaviourScoresSegmented.all,
        ranking: rankingScoresSegmented.all,
        backlinks: backlinkScore,
        reviews: reviewScore
      }),
      nonEducation: computeAuthorityFromComponents({
        behaviour: behaviourScoresSegmented.nonBlog,
        ranking: rankingScoresSegmented.nonBlog,
        backlinks: backlinkScore,
        reviews: reviewScore
      }),
      money: computeAuthorityFromComponents({
        behaviour: behaviourScoresSegmented.money,
        ranking: rankingScoresSegmented.money,
        backlinks: backlinkScore,
        reviews: reviewScore
      })
    };
  }

  const authorityComponents = {
    behaviour: authorityAll.behaviour,
    ranking: authorityAll.ranking,
    backlinks: authorityAll.backlinks,
    reviews: authorityAll.reviews,
    behaviourScoreAll: behaviourScoresSegmented ? clampScore(behaviourScoresSegmented.all) : clampScore(behaviourScore),
    behaviourScoreNonBlog: behaviourScoresSegmented ? clampScore(behaviourScoresSegmented.nonBlog) : null,
    behaviourScoreMoney: behaviourScoresSegmented ? clampScore(behaviourScoresSegmented.money) : null,
    rankingScoreAll: rankingScoresSegmented ? clampScore(rankingScoresSegmented.all) : clampScore(rankingScore),
    rankingScoreNonBlog: rankingScoresSegmented ? clampScore(rankingScoresSegmented.nonBlog) : null,
    rankingScoreMoney: rankingScoresSegmented ? clampScore(rankingScoresSegmented.money) : null
  };

  return { authorityAll, authorityBySegment, authorityComponents };
};

const computeLocalEntityScore = (localSignals, ctr, visibilityScore) => {
  if (localSignals && localSignals.status === 'ok' && localSignals.data) {
    const localData = localSignals.data;
    let baseScore = localData.napConsistencyScore || 0;
    if (localData.knowledgePanelDetected) {
      baseScore = Math.min(100, baseScore + 10);
    }
    if (localData.locations && localData.locations.length > 0) {
      baseScore = Math.min(100, baseScore + 5);
    }
    return clampScore(baseScore);
  }

  const ctrDecimal = ctr / 100;
  const ctrScore = Math.min((ctrDecimal / 0.1) * 100, 100);
  return clampScore(60 + 0.3 * (visibilityScore - 50) + 0.2 * (ctrScore - 50));
};

const computeServiceAreaScore = (localSignals, localEntity) => {
  if (localSignals && localSignals.status === 'ok' && localSignals.data) {
    const localData = localSignals.data;
    const serviceAreasCount = localData.serviceAreas?.length || 0;
    let serviceArea;
    if (serviceAreasCount === 0) {
      serviceArea = 0;
    } else if (serviceAreasCount >= 8) {
      serviceArea = 100;
    } else {
      serviceArea = Math.min(100, serviceAreasCount * 12.5);
    }
    if (localData.napConsistencyScore != null && localData.napConsistencyScore < 100) {
      serviceArea = Math.round(serviceArea * (localData.napConsistencyScore / 100));
    }
    return clampScore(serviceArea);
  }

  return clampScore(localEntity - 5);
};

const collectSchemaTypes = (schemaData) => {
  const allTypes = new Set();
  if (schemaData.allDetectedTypes && Array.isArray(schemaData.allDetectedTypes)) {
    schemaData.allDetectedTypes.forEach((type) => {
      if (type) allTypes.add(type);
    });
    return allTypes;
  }
  if (schemaData.foundation && typeof schemaData.foundation === 'object') {
    Object.keys(schemaData.foundation).forEach((type) => {
      if (schemaData.foundation[type] === true) {
        allTypes.add(type);
      }
    });
    if (schemaData.richEligible && typeof schemaData.richEligible === 'object') {
      Object.keys(schemaData.richEligible).forEach((type) => {
        if (schemaData.richEligible[type] === true) {
          allTypes.add(type);
        }
      });
    }
    return allTypes;
  }
  if (schemaData.schemaTypes && Array.isArray(schemaData.schemaTypes)) {
    schemaData.schemaTypes.forEach((item) => {
      if (typeof item === 'string') {
        allTypes.add(item);
      } else if (item && typeof item === 'object' && item.type) {
        allTypes.add(item.type);
      }
    });
  }
  return allTypes;
};

const computeFoundationScore = (allTypes) => {
  const foundationTypes = ['Organization', 'Person', 'WebSite', 'BreadcrumbList'];
  const foundationPresent = foundationTypes.filter((type) => allTypes.has(type)).length;
  return (foundationPresent / foundationTypes.length) * 100;
};

const computeRichResultScore = (schemaData) => {
  const richResultTypes = ['Article', 'Event', 'FAQPage', 'Product', 'LocalBusiness', 'Course', 'Review', 'HowTo', 'VideoObject', 'ImageObject', 'ItemList'];
  let richEligibleCount = 0;
  if (schemaData.richEligible && typeof schemaData.richEligible === 'object') {
    richResultTypes.forEach((type) => {
      if (schemaData.richEligible[type] === true) richEligibleCount += 1;
    });
  }
  return (richEligibleCount / richResultTypes.length) * 100;
};

const computeCoverageScore = (schemaData) => {
  if (schemaData.coverage) return schemaData.coverage;
  if (schemaData.totalPages && schemaData.pagesWithSchema) {
    return schemaData.totalPages > 0
      ? (schemaData.pagesWithSchema / schemaData.totalPages) * 100
      : 0;
  }
  return 0;
};

const computeDiversityScore = (allTypes) => Math.min((allTypes.size / 15) * 100, 100);

const computeContentSchemaScore = (schemaAudit) => {
  if (!(schemaAudit && schemaAudit.status === 'ok' && schemaAudit.data)) {
    return { contentSchema: 0, coverageScore: 0, diversityScore: 0 };
  }

  const schemaData = schemaAudit.data;
  const allTypes = collectSchemaTypes(schemaData);
  const foundationScore = computeFoundationScore(allTypes);
  const richResultScore = computeRichResultScore(schemaData);
  const coverageScore = computeCoverageScore(schemaData);
  const diversityScore = computeDiversityScore(allTypes);

  const contentSchema = clampScore(
    foundationScore * 0.3 +
    richResultScore * 0.35 +
    coverageScore * 0.2 +
    diversityScore * 0.15
  );

  return { contentSchema, coverageScore, diversityScore };
};

const computeBrandOverlayScore = (queryPages, topQueries, reviewScore, localEntity) => {
  const brandMetrics = calculateBrandMetrics(
    (queryPages && queryPages.length > 0)
      ? queryPages.map((row) => ({
        query: row.query || '',
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        position: row.position || 0
      }))
      : (topQueries || [])
  );

  return computeBrandOverlay({
    brandQueryShare: brandMetrics.brandQueryShare,
    brandCtr: brandMetrics.brandCtr,
    brandAvgPosition: brandMetrics.brandAvgPosition,
    reviewScore,
    entityScore: localEntity
  });
};

const calculatePillarScores = (data, schemaAudit = null, localSignals = null, siteReviews = null, backlinkMetrics = null) => {
  const position = data.averagePosition || 40;
  const ctr = data.ctr || 0;
  const topQueries = data.topQueries || [];
  const queryPages = data.queryPages || [];

  const visibility = computeVisibility(position);
  const segmentedScores = computeSegmentedScores(queryPages, topQueries);

  const localSignalsData = localSignals?.data || (localSignals && localSignals.status === undefined ? localSignals : null);
  const gbpRating = localSignalsData?.gbpRating ?? null;
  const gbpCount = localSignalsData?.gbpReviewCount ?? null;

  const normalizedSiteReviews = getTrustpilotSnapshot(siteReviews);
  const siteRating = normalizedSiteReviews?.siteRating ?? null;
  const siteCount = normalizedSiteReviews?.siteReviewCount ?? null;

  const reviewScore = computeReviewScore({
    gbpRating,
    gbpCount,
    siteRating,
    siteCount
  });

  const backlinkScore = computeBacklinkScore(backlinkMetrics);
  const authorityData = computeAuthorityScores({
    ...segmentedScores,
    reviewScore,
    backlinkScore
  });

  const localEntity = computeLocalEntityScore(localSignals, ctr, visibility);
  const serviceArea = computeServiceAreaScore(localSignals, localEntity);
  const { contentSchema, coverageScore, diversityScore } = computeContentSchemaScore(schemaAudit);
  const brandOverlay = computeBrandOverlayScore(queryPages, topQueries, reviewScore, localEntity);

  return {
    visibility,
    authority: {
      score: authorityData.authorityAll.total,
      bySegment: authorityData.authorityBySegment,
      behaviourScoresSegmented: segmentedScores.behaviourScoresSegmented,
      rankingScoresSegmented: segmentedScores.rankingScoresSegmented
    },
    authorityComponents: authorityData.authorityComponents,
    contentSchema,
    localEntity,
    serviceArea,
    brandOverlay,
    coverageScore,
    diversityScore
  };
};

export {
  calculatePillarScores,
  calculateSnippetReadiness,
  computeBacklinkScore,
  computeReviewScore,
  getTrustpilotSnapshot
};
