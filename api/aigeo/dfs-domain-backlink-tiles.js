export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { aggregateDfsBacklinkTileStats } from '../../lib/dfs-domain-backlink-tile-aggregates.js';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') return sendJson(res, 405, { status: 'error', message: 'Use GET.' });

  try {
    const domainHost = normalizeDomainHost(req.query?.domain || req.query?.host || '');
    if (!domainHost) {
      return sendJson(res, 400, { status: 'error', message: 'Provide domain (e.g. alanranger.com).' });
    }

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const stats = await aggregateDfsBacklinkTileStats(supabase, domainHost);

    return sendJson(res, 200, {
      status: 'ok',
      data: stats || {
        domainHost,
        totalBacklinks: 0,
        referringDomains: 0,
        dofollow: 0,
        nofollow: 0,
        unknown: 0,
        followRatio: 0,
        rankBands: {
          r80_100: 0,
          r50_79: 0,
          r30_49: 0,
          r20_29: 0,
          r_lt20: 0,
          r_null: 0
        },
        rankBandsDofollow: {
          r80_100: 0,
          r50_79: 0,
          r30_49: 0,
          r20_29: 0,
          r_lt20: 0,
          r_null: 0
        },
        rankBandsNofollow: {
          r80_100: 0,
          r50_79: 0,
          r30_49: 0,
          r20_29: 0,
          r_lt20: 0,
          r_null: 0
        },
        rankBandsUnknown: {
          r80_100: 0,
          r50_79: 0,
          r30_49: 0,
          r20_29: 0,
          r_lt20: 0,
          r_null: 0
        },
        generatedAt: new Date().toISOString(),
        source: 'dfs_supabase_tile_scan',
        truncated: false
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
