import { PageSegment, classifyPageSegment } from '../../api/aigeo/pageSegment.js';

const normalizeGscPageKey = (input) => {
  try {
    let url = String(input || '').trim().toLowerCase();
    if (!url) return '';
    url = url.replace(/^https?:\/\//, '');
    url = url.split('#')[0].split('?')[0];
    const slashIndex = url.indexOf('/');
    if (slashIndex > -1) {
      url = url.slice(slashIndex);
    } else {
      url = '/' + url;
    }
    url = url.replace(/^www\./, '');
    try { url = decodeURIComponent(url); } catch {}
    if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);
    return url;
  } catch {
    return String(input || '').trim();
  }
};

const normalizeUrlForMatching = (url) => {
  if (!url || typeof url !== 'string') return '';
  let cleanUrl = url.split('?')[0].split('#')[0];
  let normalized = cleanUrl.toLowerCase().trim();
  try {
    let urlToParse = normalized;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      urlToParse = 'https://www.alanranger.com' + (normalized.startsWith('/') ? normalized : '/' + normalized);
    }
    const urlObj = new URL(urlToParse);
    normalized = urlObj.pathname.toLowerCase().replace(/\/$/, '').trim();
    if (!normalized || normalized === '/') {
      normalized = '/';
    }
  } catch {
    normalized = cleanUrl.toLowerCase().replace(/\/$/, '').trim();
    if (normalized && !normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    if (!normalized || normalized === '/') {
      normalized = '/';
    }
  }
  return normalized;
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

  const ctrScoreAll = Math.min((ctrAll / 0.05) * 100, 100);
  const ctrScoreTop10 = Math.min((ctrTop10 / 0.10) * 100, 100);

  return 0.5 * ctrScoreAll + 0.5 * ctrScoreTop10;
};

const classifyMoneyPageSubSegment = (url) => {
  if (!url) return 'LANDING';
  const urlLower = url.toLowerCase();
  if (urlLower.includes('/beginners-photography-lessons') ||
      urlLower.includes('/photographic-workshops-near-me')) {
    return 'EVENT';
  }
  if (urlLower.includes('/photo-workshops-uk') ||
      urlLower.includes('/photography-services-near-me')) {
    return 'PRODUCT';
  }
  return 'LANDING';
};

const computeSiteAggregateFromTopPages = (topPages) => {
  if (!topPages || !Array.isArray(topPages) || topPages.length === 0) {
    return {
      totalClicks: 0,
      totalImpressions: 0,
      avgCtr: 0,
      avgPosition: null
    };
  }

  let totalClicks = 0;
  let totalImpressions = 0;
  let weightedPosSum = 0;

  topPages.forEach((page) => {
    const clicks = page.clicks || 0;
    const impressions = page.impressions || 0;
    const position = page.position || page.avgPosition || 0;
    totalClicks += clicks;
    totalImpressions += impressions;
    if (impressions > 0 && position > 0) {
      weightedPosSum += position * impressions;
    }
  });

  const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
  const avgPosition = totalImpressions > 0 ? weightedPosSum / totalImpressions : null;

  return {
    totalClicks,
    totalImpressions,
    avgCtr,
    avgPosition
  };
};

const classifyMoneyPageOpportunity = (metrics, siteAgg, hasSchema = null, schemaTypes = []) => {
  const { ctr, avgPosition, impressions } = metrics;

  const safePos = avgPosition || 99;
  const safeCtr = ctr || 0;
  const imp = impressions || 0;

  const MIN_IMPRESSIONS = 100;
  const HIGH_OPP_MAX_POS = 15;
  const MAINTAIN_MAX_POS = 8;

  const targetCtrHigh = 0.05;
  const targetCtrMid = 0.03;
  const lowCtrThreshold = 0.02;

  let category = 'VISIBILITY_FIX';
  let categoryLabel = 'Visibility fix (low impressions/rank)';
  let categoryColor = 'red';
  let recommendation = '';

  const desiredSchemaTypes = ['Product', 'Event', 'FAQPage'];
  const presentTypes = Array.isArray(schemaTypes) && schemaTypes.length > 0
    ? schemaTypes.map((t) => {
      if (typeof t === 'string') return t.trim().toLowerCase();
      if (t && typeof t === 'object' && t.type && typeof t.type === 'string') return t.type.trim().toLowerCase();
      return String(t).trim().toLowerCase();
    }).filter((t) => t && t !== '[object object]')
    : [];
  const missingTypes = desiredSchemaTypes.filter((type) => !presentTypes.includes(type.toLowerCase()));

  let schemaRecommendation = '';
  if (hasSchema === false) {
    schemaRecommendation = 'ensure Product/Event/FAQ schema is present, and ';
  } else if (missingTypes.length > 0) {
    if (missingTypes.length === desiredSchemaTypes.length) {
      schemaRecommendation = 'ensure Product/Event/FAQ schema is present, and ';
    } else {
      schemaRecommendation = `add ${missingTypes.join('/')} schema, and `;
    }
  }

  const hasDecentPosition = safePos >= 3 && safePos <= HIGH_OPP_MAX_POS;
  const hasVolume = imp >= MIN_IMPRESSIONS;
  const ctrBelowTargetForBand =
    (safePos <= 6 && safeCtr < targetCtrHigh) ||
    (safePos > 6 && safePos <= 10 && safeCtr < targetCtrMid) ||
    (safePos > 10 && safePos <= HIGH_OPP_MAX_POS && safeCtr < lowCtrThreshold);

  if (hasDecentPosition && hasVolume && ctrBelowTargetForBand) {
    category = 'HIGH_OPPORTUNITY';
    categoryLabel = 'High opportunity (improve CTR)';
    categoryColor = 'amber';
    let schemaNote = '';
    if (hasSchema === false) {
      schemaNote = ' Add Product/Event/FAQ schema to improve rich result eligibility. ';
    } else if (missingTypes.length > 0) {
      if (missingTypes.length === desiredSchemaTypes.length) {
        schemaNote = ' Add Product/Event/FAQ schema to improve rich result eligibility. ';
      } else {
        schemaNote = ` Add ${missingTypes.join('/')} schema to improve rich result eligibility. `;
      }
    }
    recommendation =
      `Good visibility (avg position ${safePos.toFixed(1)}) and ` +
      `${imp.toLocaleString()} impressions, but low CTR (${(safeCtr * 100).toFixed(1)}%). ` +
      `Prioritise title/meta improvements, "best" phrasing for this offer, ` +
      `${schemaNote}` +
      `and adding FAQs that address objections for this money page.`;
  } else if (safePos <= MAINTAIN_MAX_POS && safeCtr >= targetCtrMid && imp >= MIN_IMPRESSIONS) {
    category = 'MAINTAIN';
    categoryLabel = 'Maintain (performing well)';
    categoryColor = 'green';
    recommendation =
      `Strong performer with avg position ${safePos.toFixed(1)} and ` +
      `CTR ${(safeCtr * 100).toFixed(1)}%. Maintain current messaging and ` +
      `internal links; focus optimisation efforts on weaker money pages first.`;
  if (category === 'VISIBILITY_FIX') {
    recommendation =
      `Limited visibility (avg position ${Number.isFinite(safePos) ? safePos.toFixed(1) : '—'} ` +
      `and ${imp.toLocaleString()} impressions). Strengthen internal links from high-traffic ` +
      `educational posts, ${schemaRecommendation}` +
      `consider a clearer "best [topic]" section to signal value to searchers and AI.`;
  }

  return { category, categoryLabel, categoryColor, recommendation };
};

const buildMetadataMap = (pageTitleLookup) => {
  if (pageTitleLookup instanceof Map) {
    const firstValue = pageTitleLookup.values().next().value;
    if (firstValue && typeof firstValue === 'object' && (firstValue.title !== undefined || firstValue.metaDescription !== undefined)) {
      return pageTitleLookup;
    }
    const metadataMap = new Map();
    pageTitleLookup.forEach((title, url) => {
      metadataMap.set(url, { title, metaDescription: null });
    });
    return metadataMap;
  }

  if (pageTitleLookup) {
    const metadataMap = new Map();
    Object.entries(pageTitleLookup).forEach(([url, value]) => {
      if (typeof value === 'object' && value !== null) {
        metadataMap.set(url, { title: value.title || null, metaDescription: value.metaDescription || null });
      } else {
        metadataMap.set(url, { title: value || null, metaDescription: null });
      }
    });
    return metadataMap;
  }

  return null;
};

const buildSchemaLookups = (schemaAudit) => {
  const schemaLookup = new Map();
  const schemaTypesLookup = new Map();
  if (schemaAudit && schemaAudit.status === 'ok' && schemaAudit.data && schemaAudit.data.pages) {
    schemaAudit.data.pages.forEach((page) => {
      if (page.url) {
        const normalizedUrl = normalizeUrlForMatching(page.url);
        const hasSchema = page.hasSchema || page.hasInheritedSchema || false;
        schemaLookup.set(page.url, hasSchema);
        schemaLookup.set(normalizedUrl, hasSchema);
        schemaTypesLookup.set(page.url, page.schemaTypes || []);
        schemaTypesLookup.set(normalizedUrl, page.schemaTypes || []);
      }
    });
  }
  return { schemaLookup, schemaTypesLookup };
};

const buildMoneyRow = ({
  page,
  siteAgg,
  metadataMap,
  schemaLookup,
  schemaTypesLookup,
  summaryByCategory,
  summaryBySubSegment
}) => {
  const url = page.page || page.url || '';
  if (!url) return null;

  const segment = classifyPageSegment(url);
  if (segment !== PageSegment.MONEY) return null;

  const clicks = page.clicks || 0;
  const impressions = page.impressions || 0;
  const position = page.position || page.avgPosition || 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const avgPosition = position || null;

  const metadata = metadataMap?.get(url) || {};
  const title = metadata.title || null;
  const metaDescription = metadata.metaDescription || null;

  const normalizedUrl = normalizeUrlForMatching(url);
  const hasSchema = schemaLookup.has(url)
    ? schemaLookup.get(url)
    : (schemaLookup.has(normalizedUrl) ? schemaLookup.get(normalizedUrl) : null);
  const schemaTypes = schemaTypesLookup.get(url) || schemaTypesLookup.get(normalizedUrl) || [];

  const { category, categoryLabel, categoryColor, recommendation } =
    classifyMoneyPageOpportunity({ ctr, avgPosition, impressions }, siteAgg, hasSchema, schemaTypes);

  const subSegment = classifyMoneyPageSubSegment(url);

  const bucket = summaryByCategory[category];
  if (bucket) {
    bucket.count += 1;
    bucket.impressions += impressions;
    bucket.clicks += clicks;
  }

  const subBucket = summaryBySubSegment[subSegment];
  if (subBucket) {
    subBucket.count += 1;
    subBucket.impressions += impressions;
    subBucket.clicks += clicks;
  }

  return {
    url,
    title,
    metaDescription,
    clicks,
    impressions,
    ctr,
    avgPosition,
    category,
    categoryLabel,
    categoryColor,
    recommendation,
    schemaTypes,
    subSegment
  };
};

const collectMoneyRows = ({
  topPages,
  siteAgg,
  metadataMap,
  schemaLookup,
  schemaTypesLookup,
  summaryByCategory,
  summaryBySubSegment
}) => {
  const moneyRows = [];
  let moneyClicks = 0;
  let moneyImpressions = 0;
  let weightedPosSum = 0;
  const moneyActiveUrls = new Set();

  topPages.forEach((page) => {
    const row = buildMoneyRow({
      page,
      siteAgg,
      metadataMap,
      schemaLookup,
      schemaTypesLookup,
      summaryByCategory,
      summaryBySubSegment
    });

    if (!row) return;

    if (row.impressions > 0) {
      moneyClicks += row.clicks;
      moneyImpressions += row.impressions;
      weightedPosSum += (row.avgPosition || 0) * row.impressions;
      moneyActiveUrls.add(row.url);
    }

    moneyRows.push(row);
  });

  return {
    moneyRows,
    moneyClicks,
    moneyImpressions,
    weightedPosSum,
    moneyActiveUrls
  };
};

const computeMoneyPagesMetrics = (topPages, classifySegment, siteAgg, pageTitleLookup = null, schemaAudit = null) => {
  const summaryByCategory = {
    HIGH_OPPORTUNITY: { count: 0, impressions: 0, clicks: 0 },
    VISIBILITY_FIX: { count: 0, impressions: 0, clicks: 0 },
    MAINTAIN: { count: 0, impressions: 0, clicks: 0 }
  };

  const summaryBySubSegment = {
    PRODUCT: { count: 0, impressions: 0, clicks: 0 },
    EVENT: { count: 0, impressions: 0, clicks: 0 },
    LANDING: { count: 0, impressions: 0, clicks: 0 }
  };

  if (!topPages || !Array.isArray(topPages) || topPages.length === 0) {
    return {
      overview: {
        moneyClicks: 0,
        moneyImpressions: 0,
        moneyCtr: 0,
        moneyAvgPosition: null,
        moneyCoverageCount: 0,
        moneyTotalKnown: null,
        moneyCoveragePct: null,
        siteCtr: siteAgg.avgCtr || 0,
        siteAvgPosition: siteAgg.avgPosition || null,
        siteTotalClicks: siteAgg.totalClicks || 0,
        siteTotalImpressions: siteAgg.totalImpressions || 0
      },
      rows: [],
      summaryByCategory,
      summaryBySubSegment
    };
  }

  const metadataMap = buildMetadataMap(pageTitleLookup);
  const { schemaLookup, schemaTypesLookup } = buildSchemaLookups(schemaAudit);

  const {
    moneyRows,
    moneyClicks,
    moneyImpressions,
    weightedPosSum,
    moneyActiveUrls
  } = collectMoneyRows({
    topPages,
    siteAgg,
    metadataMap,
    schemaLookup,
    schemaTypesLookup,
    summaryByCategory,
    summaryBySubSegment
  });

  const moneyCtr = moneyImpressions > 0 ? moneyClicks / moneyImpressions : 0;
  const moneyAvgPosition = moneyImpressions > 0 ? weightedPosSum / moneyImpressions : null;

  const overview = {
    moneyClicks,
    moneyImpressions,
    moneyCtr,
    moneyAvgPosition,
    moneyCoverageCount: moneyActiveUrls.size,
    moneyTotalKnown: null,
    moneyCoveragePct: null,
    siteCtr: siteAgg.avgCtr || 0,
    siteAvgPosition: siteAgg.avgPosition || null,
    siteTotalClicks: siteAgg.totalClicks || 0,
    siteTotalImpressions: siteAgg.totalImpressions || 0
  };

  const categoryOrder = { HIGH_OPPORTUNITY: 0, VISIBILITY_FIX: 1, MAINTAIN: 2 };
  moneyRows.sort((a, b) => {
    const ca = categoryOrder[a.category] ?? 99;
    const cb = categoryOrder[b.category] ?? 99;
    if (ca !== cb) return ca - cb;
    return (b.impressions || 0) - (a.impressions || 0);
  });

  return { overview, rows: moneyRows, summaryByCategory, summaryBySubSegment };
};

const buildMoneyPagesSummary = (moneyPagesMetrics, overview) => {
  if (!moneyPagesMetrics || !moneyPagesMetrics.rows || !moneyPagesMetrics.rows.length) {
    return null;
  }

  const pages = moneyPagesMetrics.rows;
  const impressions = pages.reduce((sum, p) => sum + (p.impressions || 0), 0);
  const clicks = pages.reduce((sum, p) => sum + (p.clicks || 0), 0);
  const avgPosWeightedSum = pages.reduce((sum, p) =>
    sum + ((p.avgPosition || p.position || 0) * (p.impressions || 0)), 0
  );

  if (!impressions) return null;

  const avgPosition = avgPosWeightedSum / impressions;
  const ctr = clicks / impressions;

  const totalImpressions = overview?.siteTotalImpressions || overview?.totalImpressions || null;
  const totalClicks = overview?.siteTotalClicks || overview?.totalClicks || null;

  const shareOfImpressions = totalImpressions && totalImpressions > 0
    ? impressions / totalImpressions
    : null;

  const shareOfClicks = totalClicks && totalClicks > 0
    ? clicks / totalClicks
    : null;

  return {
    count: pages.length,
    impressions,
    clicks,
    ctr,
    avgPosition,
    shareOfImpressions,
    shareOfClicks,
    behaviourScore: moneyPagesMetrics.behaviour
      ? moneyPagesMetrics.behaviour.score
      : null
  };
};

const classifyMoneyPage = (url) => {
  if (!url) return { isMoney: false, segmentType: null };
  const segment = classifyPageSegment(url);
  const isMoney = segment === PageSegment.MONEY;
  if (!isMoney) {
    return { isMoney: false, segmentType: null };
  }
  const subSegment = classifyMoneyPageSubSegment(url);
  let segmentType = 'all';
  if (subSegment === 'PRODUCT') segmentType = 'product';
  else if (subSegment === 'EVENT') segmentType = 'event';
  else if (subSegment === 'LANDING') segmentType = 'landing';
  return { isMoney: true, segmentType };
};

const expectedCtrForPosition = (pos) => {
  if (!isFinite(pos) || pos <= 0) return 0.10;
  if (pos <= 3) return 0.10;
  if (pos <= 6) return 0.07;
  if (pos <= 10) return 0.05;
  if (pos <= 20) return 0.03;
  return 0.02;
};

const computeImpactLevels = (pages) => {
  let maxLost = 0;
  for (const p of pages) {
    const expectedCtr = expectedCtrForPosition(p.avgPosition);
    const gap = Math.max(0, expectedCtr - (p.ctr || 0));
    const lostClicks = (p.impressions || 0) * gap;
    p._lostClicks = lostClicks;
    if (lostClicks > maxLost) maxLost = lostClicks;
  }

  if (maxLost <= 0) {
    for (const p of pages) {
      p.impactLevel = 'LOW';
    }
    return;
  }

  const highThreshold = 0.75 * maxLost;
  const medThreshold = 0.35 * maxLost;

  for (const p of pages) {
    const lost = p._lostClicks || 0;
    if (lost >= highThreshold) p.impactLevel = 'HIGH';
    else if (lost >= medThreshold) p.impactLevel = 'MEDIUM';
    else p.impactLevel = 'LOW';
  }
};

const pageHasKeySchema = (url, segmentType, schemaAudit) => {
  if (!schemaAudit || !schemaAudit.data || !schemaAudit.data.pages) {
    return false;
  }

  const page = schemaAudit.data.pages.find((p) => p.url === url);
  if (!page) return false;

  const schemaTypes = page.schemaTypes || [];
  const typesLower = schemaTypes.map((t) => {
    if (typeof t === 'string') return t.toLowerCase();
    if (t && typeof t === 'object' && t.type && typeof t.type === 'string') return t.type.toLowerCase();
    return String(t).toLowerCase();
  }).filter((t) => t && t !== '[object object]');

  if (segmentType === 'event') {
    return typesLower.includes('event') || typesLower.includes('course');
  }
  if (segmentType === 'product') {
    return typesLower.includes('product') || typesLower.includes('offer');
  }
  if (segmentType === 'landing') {
    return typesLower.includes('itemlist') || typesLower.includes('faqpage') || typesLower.includes('article');
  }
  return false;
};

const computeDifficultyLevel = (p, hasKeySchema) => {
  const pos = p.avgPosition || 0;
  let base;
  if (pos > 0 && pos <= 5) base = 'LOW';
  else if (pos <= 10) base = 'MEDIUM';
  else base = 'HIGH';

  if (!hasKeySchema && (p.segmentType === 'event' || p.segmentType === 'product')) {
    if (base === 'LOW') base = 'MEDIUM';
    else if (base === 'MEDIUM') base = 'HIGH';
  }

  return base;
};

const derivePriorityLevel = (impact, difficulty) => {
  if (impact === 'HIGH' && (difficulty === 'LOW' || difficulty === 'MEDIUM')) {
    return 'HIGH';
  }
  if (
    (impact === 'HIGH' && difficulty === 'HIGH') ||
    (impact === 'MEDIUM' && (difficulty === 'LOW' || difficulty === 'MEDIUM'))
  ) {
    return 'MEDIUM';
  }
  return 'LOW';
};

const buildMoneyPageMetrics = (topPages, schemaAudit = null) => {
  const result = [];

  for (const row of topPages) {
    const url = row.page || row.url;
    const { isMoney, segmentType } = classifyMoneyPage(url);
    if (!isMoney) continue;

    let ctr = row.ctr || 0;
    if (ctr > 1) ctr = ctr / 100;

    const m = {
      url,
      title: row.title || url,
      segmentType: segmentType || 'all',
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr,
      avgPosition: row.position || row.avgPosition || 0,
      impactLevel: 'LOW',
      difficultyLevel: 'MEDIUM',
      priorityLevel: 'LOW'
    };

    const hasKeySchema = pageHasKeySchema(url, m.segmentType, schemaAudit);
    m.difficultyLevel = computeDifficultyLevel(m, hasKeySchema);
    result.push(m);
  }

  computeImpactLevels(result);

  for (const p of result) {
    p.priorityLevel = derivePriorityLevel(p.impactLevel, p.difficultyLevel);
  }

  return result;
};

const buildMoneySegmentSummary = (moneyPages, behaviourScores = {}) => {
  const pages = Array.isArray(moneyPages) ? moneyPages : [];
  const segments = {
    allMoney: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0, behaviourScore: 0 },
    landingPages: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0, behaviourScore: 0 },
    eventPages: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0, behaviourScore: 0 },
    productPages: { clicks: 0, impressions: 0, ctr: 0, avgPosition: 0, behaviourScore: 0 }
  };

  const groups = {
    allMoney: pages,
    landingPages: pages.filter((p) => p.segmentType === 'landing'),
    eventPages: pages.filter((p) => p.segmentType === 'event'),
    productPages: pages.filter((p) => p.segmentType === 'product')
  };

  for (const [key, groupPages] of Object.entries(groups)) {
    if (!groupPages || !groupPages.length) continue;
    const clicks = groupPages.reduce((s, p) => s + (p.clicks || 0), 0);
    const impressions = groupPages.reduce((s, p) => s + (p.impressions || 0), 0);
    const ctr = impressions > 0 ? clicks / impressions : 0;
    const avgPosition = groupPages.length > 0
      ? groupPages.reduce((s, p) => s + (p.avgPosition || 0), 0) / groupPages.length
      : 0;

    segments[key].clicks = clicks;
    segments[key].impressions = impressions;
    segments[key].ctr = ctr;
    segments[key].avgPosition = avgPosition;
    segments[key].behaviourScore = behaviourScores[key] || behaviourScores[key.toLowerCase()] || 0;
  }

  return segments;
};

const computeMoneyPagesBehaviour = (gscQueries, moneyPages, useAllPositions = false) => {
  if (!gscQueries || !gscQueries.length || !moneyPages || !moneyPages.length) {
    return null;
  }

  const normalizeUrl = (url) => {
    if (!url) return '';
    let normalized = url.toString().trim().toLowerCase();
    normalized = normalized.replace(/^https?:\/\//, '');
    normalized = normalized.replace(/\/$/, '');
    return normalized;
  };

  const moneySet = new Set(
    moneyPages.map((p) => normalizeUrl(p.url || p.page || ''))
  );

  let clicks = 0;
  let impressions = 0;
  let top10Clicks = 0;
  let top10Impressions = 0;
  let weightedPosSum = 0;
  let weightedPosImps = 0;

  gscQueries.forEach((row) => {
    const url = normalizeUrl(row.page || row.url || '');
    if (!moneySet.has(url)) return;

    const pos = typeof row.position === 'number'
      ? row.position
      : (row.avgPosition || null);
    const imps = row.impressions || 0;
    const cls = row.clicks || 0;

    if (!imps || !pos || pos <= 0) return;
    if (!useAllPositions && pos > 20) return;

    clicks += cls;
    impressions += imps;

    weightedPosSum += pos * imps;
    weightedPosImps += imps;
    if (pos <= 10) {
      top10Clicks += cls;
      top10Impressions += imps;
    }
  });

  if (!impressions || !weightedPosImps) {
    return null;
  }

  const siteCtr = clicks / impressions;
  const top10Ctr = top10Impressions > 0 ? (top10Clicks / top10Impressions) : 0;
  const avgPos = weightedPosSum / weightedPosImps;
  const top10Share = impressions > 0 ? (top10Impressions / impressions) : 0;

  const rankingQueries = gscQueries.filter((row) => {
    const url = normalizeUrl(row.page || row.url || '');
    if (!moneySet.has(url)) return false;
    const pos = typeof row.position === 'number' ? row.position : (row.avgPosition || null);
    if (!pos || pos <= 0 || !(row.impressions || 0)) return false;
    if (!useAllPositions && pos > 20) return false;
    return true;
  });

  const behaviourScore = computeBehaviourScoreRaw(
    rankingQueries.map((r) => ({
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: (r.ctr || 0) / 100,
      position: r.position || 0
    }))
  );

  return {
    score: behaviourScore,
    siteCtr,
    top10Ctr,
    avgPos,
    top10Share,
    clicks,
    impressions
  };
};

export {
  buildMoneyPageMetrics,
  buildMoneyPagesSummary,
  buildMoneySegmentSummary,
  classifyMoneyPage,
  computeMoneyPagesMetrics,
  computeSiteAggregateFromTopPages,
  computeMoneyPagesBehaviour,
  normalizeGscPageKey,
  normalizeUrlForMatching
};
