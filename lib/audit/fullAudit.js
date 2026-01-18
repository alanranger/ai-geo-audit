import { fetchSiteUrlsCsv } from './csv.js';
import {
  buildMoneyPageMetrics,
  buildMoneyPagesSummary,
  buildMoneySegmentSummary,
  computeMoneyPagesBehaviour,
  computeMoneyPagesMetrics,
  normalizeGscPageKey
} from './moneyPages.js';
import { calculatePillarScores, calculateSnippetReadiness } from './pillarScores.js';

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.message || json?.error || text || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = json;
    throw error;
  }

  return json;
};

const buildSearchDataFromGsc = (gsc) => {
  const overview = gsc?.data?.overview || {};
  return {
    totalClicks: overview.totalClicks || 0,
    totalImpressions: overview.totalImpressions || 0,
    averagePosition: overview.avgPosition || 0,
    ctr: overview.ctr || 0,
    topQueries: gsc?.data?.topQueries || [],
    queryPages: gsc?.data?.queryPages || [],
    queryTotals: gsc?.data?.queryTotals || [],
    timeseries: gsc?.data?.timeseries || [],
    dateRange: 28,
    overview: {
      siteTotalImpressions: overview.totalImpressions || 0,
      siteTotalClicks: overview.totalClicks || 0,
      totalImpressions: overview.totalImpressions || 0,
      totalClicks: overview.totalClicks || 0
    }
  };
};

const buildPageTotalsByKey = (rows) => {
  const pageTotalsByKey = new Map();
  rows.forEach((row) => {
    const pageUrl = row.keys?.[0] || row.page || row.url || '';
    const key = normalizeGscPageKey(pageUrl);
    if (!key) return;
    pageTotalsByKey.set(key, {
      url: pageUrl,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || null
    });
  });
  return pageTotalsByKey;
};

const buildPagesFromCsv = (urls, pageTotalsByKey, propertyUrl) => (
  urls.map((rawUrl) => {
    const key = normalizeGscPageKey(rawUrl);
    const gscMetrics = pageTotalsByKey.get(key);
    let fullUrl = rawUrl;
    if (!fullUrl.startsWith('http')) {
      const base = (propertyUrl || 'https://www.alanranger.com').replace(/\/$/, '');
      fullUrl = base + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);
    }
    return {
      url: fullUrl,
      page: fullUrl,
      clicks: gscMetrics?.clicks || 0,
      impressions: gscMetrics?.impressions || 0,
      ctr: gscMetrics?.ctr || 0,
      avgPosition: gscMetrics?.position || null,
      position: gscMetrics?.position || null
    };
  })
);

const computeSiteAggregateFromPageTotals = (pageTotalsByKey) => {
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalPositionWeight = 0;
  pageTotalsByKey.forEach((gscMetrics) => {
    totalClicks += gscMetrics.clicks || 0;
    totalImpressions += gscMetrics.impressions || 0;
    if (gscMetrics.position != null && gscMetrics.impressions > 0) {
      totalPositionWeight += gscMetrics.position * gscMetrics.impressions;
    }
  });
  return {
    totalClicks,
    totalImpressions,
    avgCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
    avgPosition: totalImpressions > 0 ? totalPositionWeight / totalImpressions : null
  };
};

const runFullAudit = async ({
  baseUrl,
  propertyUrl,
  dateRangeDays = 28
}) => {
  const gsc = await fetchJson(
    `${baseUrl}/api/aigeo/gsc-entity-metrics?property=${encodeURIComponent(propertyUrl)}`
  );
  const searchData = buildSearchDataFromGsc(gsc);

  const schemaAudit = await fetchJson(`${baseUrl}/api/schema-audit`);
  const localSignals = await fetchJson(
    `${baseUrl}/api/aigeo/local-signals?property=${encodeURIComponent(propertyUrl)}`
  );
  const siteReviewsResponse = await fetchJson(`${baseUrl}/api/reviews/site-reviews`);
  const backlinkMetricsResponse = await fetchJson(`${baseUrl}/api/aigeo/backlink-metrics`);
  const siteReviews = siteReviewsResponse?.data || siteReviewsResponse || null;
  const backlinkMetrics = backlinkMetricsResponse?.data || backlinkMetricsResponse || null;

  const pageLevel = await fetchJson(`${baseUrl}/api/aigeo/gsc-page-level`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyUrl })
  });

  const pageRows = pageLevel?.data?.rows || pageLevel?.rows || [];
  const pageTotalsByKey = buildPageTotalsByKey(pageRows);
  const siteAggFromPageTotals = computeSiteAggregateFromPageTotals(pageTotalsByKey);

  const primaryCsv = process.env.GITHUB_CSV_URL ||
    'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv';
  const fallbackCsv = process.env.CSV_URL ||
    'https://schema-tools-six.vercel.app/06-site-urls.csv';

  let moneyPagesMetrics = null;
  let moneyPagesList = [];

  try {
    const urls = await fetchSiteUrlsCsv(primaryCsv, fallbackCsv);
    const moneyPagesFromCsv = buildPagesFromCsv(urls, pageTotalsByKey, propertyUrl);
    moneyPagesMetrics = computeMoneyPagesMetrics(
      moneyPagesFromCsv,
      null,
      siteAggFromPageTotals,
      null,
      schemaAudit
    );
  } catch {
    const pagesFromPageTotals = Array.from(pageTotalsByKey.entries()).map(([pageKey, gscMetrics]) => {
      let fullUrl = gscMetrics.url || pageKey;
      if (!fullUrl.startsWith('http')) {
        const base = (propertyUrl || 'https://www.alanranger.com').replace(/\/$/, '');
        fullUrl = base + (pageKey.startsWith('/') ? pageKey : '/' + pageKey);
      }
      return {
        url: fullUrl,
        page: fullUrl,
        clicks: gscMetrics.clicks || 0,
        impressions: gscMetrics.impressions || 0,
        ctr: gscMetrics.ctr || 0,
        avgPosition: gscMetrics.position || null,
        position: gscMetrics.position || null
      };
    });

    moneyPagesMetrics = computeMoneyPagesMetrics(
      pagesFromPageTotals,
      null,
      siteAggFromPageTotals,
      null,
      schemaAudit
    );
  }

  if (!moneyPagesMetrics) {
    moneyPagesMetrics = { overview: null, rows: [] };
  }

  moneyPagesList = moneyPagesMetrics.rows || [];
  const allGSCPages = searchData.queryPages || [];
  const moneyBehaviour = computeMoneyPagesBehaviour(allGSCPages, moneyPagesList);
  moneyPagesMetrics.behaviour = moneyBehaviour;

  moneyPagesMetrics.gscPageTotals28d = moneyPagesList.map((mp) => {
    const k = normalizeGscPageKey(mp.url);
    const m = pageTotalsByKey.get(k);
    return {
      url: mp.url,
      clicks: m?.clicks ?? 0,
      impressions: m?.impressions ?? 0,
      ctr: m?.ctr ?? 0,
      position: m?.position ?? 0
    };
  });

  const scores = calculatePillarScores(
    searchData,
    schemaAudit,
    localSignals,
    siteReviews,
    backlinkMetrics
  );

  scores.moneyPagesMetrics = moneyPagesMetrics;

  const snippetReadiness = calculateSnippetReadiness(scores);
  const moneyPagesSummary = buildMoneyPagesSummary(moneyPagesMetrics, searchData.overview);
  const topPagesForPriority = moneyPagesMetrics.rows.map((row) => ({
    page: row.url,
    url: row.url,
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.avgPosition || 0,
    avgPosition: row.avgPosition || 0,
    title: row.title || row.url
  }));
  const moneyPagePriorityData = buildMoneyPageMetrics(topPagesForPriority, schemaAudit);
  const moneySegmentMetrics = buildMoneySegmentSummary(moneyPagePriorityData, {});

  return {
    searchData,
    schemaAudit,
    localSignals,
    siteReviews,
    backlinkMetrics,
    scores,
    snippetReadiness,
    moneyPagesMetrics,
    moneyPagesSummary,
    moneySegmentMetrics,
    moneyPagePriorityData
  };
};

export { runFullAudit };
