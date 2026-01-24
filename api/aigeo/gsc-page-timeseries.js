/**
 * GSC Page Timeseries API
 *
 * Fetch daily page-level timeseries for a set of URLs.
 */

import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from './utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      source: 'gsc-page-timeseries',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { propertyUrl, startDate: startDateParam, endDate: endDateParam, pages = [] } = req.body || {};
    if (!propertyUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-timeseries',
        message: 'Missing required parameter: propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const { startDate, endDate } = startDateParam && endDateParam
      ? { startDate: startDateParam, endDate: endDateParam }
      : getGscDateRange({ daysBack: 28, endOffsetDays: 1 });

    const siteUrl = normalizePropertyUrl(propertyUrl);
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

    const normalizeUrl = (url) => {
      if (!url) return '';
      let normalized = String(url).toLowerCase().trim();
      normalized = normalized.replace(/^https?:\/\//, '');
      normalized = normalized.replace(/^www\./, '');
      normalized = normalized.split('?')[0].split('#')[0];
      const parts = normalized.split('/');
      if (parts.length > 1) {
        normalized = parts.slice(1).join('/');
      }
      return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    };

    const pageFilter = new Set(
      Array.isArray(pages)
        ? pages.map((url) => normalizeUrl(url)).filter(Boolean)
        : []
    );

    const response = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['date', 'page'],
        rowLimit: 25000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        status: 'error',
        source: 'gsc-page-timeseries',
        message: 'Failed to fetch page timeseries from GSC',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];

    const filtered = rows
      .map((row) => ({
        date: row.keys?.[0] || null,
        page: row.keys?.[1] || null,
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr ? row.ctr * 100 : 0,
        position: row.position ?? null
      }))
      .filter((row) => row.date && row.page)
      .filter((row) => (pageFilter.size > 0 ? pageFilter.has(normalizeUrl(row.page)) : true));

    return res.status(200).json({
      status: 'ok',
      source: 'gsc-page-timeseries',
      data: filtered,
      meta: {
        propertyUrl: siteUrl,
        startDate,
        endDate,
        count: filtered.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      source: 'gsc-page-timeseries',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

