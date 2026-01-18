import { normalizeUrlForMatching } from '../audit/moneyPages.js';

const extractCitationUrls = (citations) => {
  if (!Array.isArray(citations)) return [];
  const urls = [];
  citations.forEach((c) => {
    if (!c) return;
    if (typeof c === 'string') {
      urls.push(c);
      return;
    }
    if (typeof c === 'object') {
      if (c.url) urls.push(c.url);
      else if (c.link) urls.push(c.link);
    }
  });
  return urls;
};

const computeAiMetricsForPageUrl = (pageUrl, rankingRows) => {
  if (!pageUrl || !Array.isArray(rankingRows)) {
    return { ai_overview: false, ai_citations: 0 };
  }

  const target = normalizeUrlForMatching(pageUrl);
  if (!target) return { ai_overview: false, ai_citations: 0 };

  let hasOverview = false;
  let totalCitations = 0;

  rankingRows.forEach((row) => {
    const rowOverview = Boolean(row?.has_ai_overview || row?.ai_overview_present_any);
    if (rowOverview) hasOverview = true;

    const citations = extractCitationUrls(row?.ai_alan_citations || row?.ai_alan_citations_array);
    citations.forEach((url) => {
      const normalized = normalizeUrlForMatching(url);
      if (normalized === target) {
        totalCitations += 1;
      }
    });
  });

  return {
    ai_overview: hasOverview,
    ai_citations: totalCitations
  };
};

export { computeAiMetricsForPageUrl };
