/** Batch HTTP status probe for Traditional SEO broken-link rule. */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import {
  classifyLinkHttpStatus,
  probeUrlHttpStatus
} from '../../lib/traditional-seo-broken-links.js';

const MAX_URLS = 25;
const CONCURRENCY = 4;

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function uniqHttpUrls(raw) {
  const out = [];
  const seen = new Set();
  (Array.isArray(raw) ? raw : []).forEach((item) => {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(url);
  });
  return out.slice(0, MAX_URLS);
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'POST') return sendJson(res, 405, { status: 'error', message: 'POST only' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const urls = uniqHttpUrls(body.urls);
    if (!urls.length) {
      return sendJson(res, 400, { status: 'error', message: 'urls[] required (http/https)' });
    }

    const results = await mapPool(urls, CONCURRENCY, async (url) => {
      const probed = await probeUrlHttpStatus(url);
      return {
        url: probed.url,
        statusCode: probed.statusCode,
        kind: probed.kind || classifyLinkHttpStatus(probed.statusCode, probed.error),
        error: probed.error
      };
    });

    return sendJson(res, 200, {
      status: 'ok',
      results,
      meta: {
        generatedAt: new Date().toISOString(),
        requested: urls.length,
        concurrency: CONCURRENCY
      }
    });
  } catch (err) {
    return sendJson(res, 500, {
      status: 'error',
      message: String(err?.message || err || 'check_url_status_failed').slice(0, 240)
    });
  }
}
