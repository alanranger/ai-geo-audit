/**
 * GET /api/keywords/locked-config
 * Returns merged locked keyword class/location config (bundled JSON + Supabase override).
 */

import { censusFromByKeyword } from '../../lib/keyword-ranking/locked-config-merge.js';
import { loadRuntimeLockedByKeyword } from '../../lib/keyword-ranking/locked-config-persist.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const config = { runtime: 'nodejs', maxDuration: 30 };

function propertyUrlFromEnv() {
  const raw = process.env.GSC_PROPERTY_URL
    || process.env.NEXT_PUBLIC_SITE_DOMAIN
    || process.env.SITE_DOMAIN
    || 'https://www.alanranger.com';
  const v = String(raw || '').trim();
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const loaded = await loadRuntimeLockedByKeyword({ root, propertyUrl: propertyUrlFromEnv() });
    const byKeyword = loaded.byKeyword;
    const census = censusFromByKeyword(byKeyword);

    return res.status(200).json({
      status: 'ok',
      source: loaded.source,
      updated_at: loaded.updated_at,
      count: Object.keys(byKeyword).length,
      census,
      by_keyword: byKeyword,
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch (e) {
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}
