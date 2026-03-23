export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

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

function toInt(v, fb, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fb;
  return Math.max(min, Math.min(max, n));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') return sendJson(res, 405, { status: 'error', message: 'Use GET.' });

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const q = req.query || {};
    const domainHost = normalizeDomainHost(q.domain || q.host || '');
    if (!domainHost) {
      return sendJson(res, 400, { status: 'error', message: 'Provide domain (e.g. alanranger.com).' });
    }
    const limit = toInt(q.limit, 25, 1, 100);

    const { data: baseRow, error: baseErr } = await supabase
      .from('dfs_backlink_tile_baseline')
      .select('domain_host,saved_at')
      .eq('domain_host', domainHost)
      .maybeSingle();
    if (baseErr) {
      return sendJson(res, 500, { status: 'error', message: String(baseErr.message || baseErr) });
    }
    if (!baseRow) {
      return sendJson(res, 200, {
        status: 'ok',
        data: { new: [], lost: [], meta: { hasBaseline: false, baselineEdges: 0, needsResave: false } },
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const { count: edgeCount, error: cntErr } = await supabase
      .from('dfs_backlink_baseline_edges')
      .select('row_hash', { count: 'exact', head: true })
      .eq('domain_host', domainHost);
    if (cntErr) {
      return sendJson(res, 500, { status: 'error', message: String(cntErr.message || cntErr) });
    }
    const nEdges = typeof edgeCount === 'number' ? edgeCount : 0;

    const { data: newRows, error: newErr } = await supabase.rpc('dfs_backlink_baseline_diff_new', {
      p_domain: domainHost,
      p_limit: limit
    });
    if (newErr) {
      return sendJson(res, 500, { status: 'error', message: String(newErr.message || newErr) });
    }
    const { data: lostRows, error: lostErr } = await supabase.rpc('dfs_backlink_baseline_diff_lost', {
      p_domain: domainHost,
      p_limit: limit
    });
    if (lostErr) {
      return sendJson(res, 500, { status: 'error', message: String(lostErr.message || lostErr) });
    }

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        new: Array.isArray(newRows) ? newRows : [],
        lost: Array.isArray(lostRows) ? lostRows : [],
        meta: {
          hasBaseline: true,
          baselineSavedAt: baseRow.saved_at || null,
          baselineEdges: nEdges,
          needsResave: nEdges === 0,
          limit
        }
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
