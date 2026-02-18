/**
 * GSC Page Activity Counts API
 *
 * Returns real page counts for a date range:
 * - clickPages: unique pages with clicks > 0
 * - impressionPages: unique pages with impressions > 0
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange } from './utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      source: 'gsc-page-activity-counts',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property } = req.query;
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-activity-counts',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const { startDate, endDate } = parseDateRange(req);
    const siteUrl = normalizePropertyUrl(property);
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

    const rowLimit = 25000;
    let startRow = 0;
    let clickPages = 0;
    let impressionPages = 0;
    let fetchedRows = 0;

    while (true) {
      const response = await fetch(searchConsoleUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit,
          startRow
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          status: 'error',
          source: 'gsc-page-activity-counts',
          message: 'Failed to fetch Search Console page activity',
          details: errorText,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      const data = await response.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (rows.length === 0) break;

      rows.forEach((row) => {
        const clicks = Number(row?.clicks || 0);
        const impressions = Number(row?.impressions || 0);
        if (clicks > 0) clickPages += 1;
        if (impressions > 0) impressionPages += 1;
      });

      fetchedRows += rows.length;
      if (rows.length < rowLimit) break;
      startRow += rowLimit;
    }

    return res.status(200).json({
      status: 'ok',
      source: 'gsc-page-activity-counts',
      params: { property: siteUrl, startDate, endDate },
      data: {
        clickPages,
        impressionPages
      },
      meta: {
        fetchedRows,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      source: 'gsc-page-activity-counts',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

