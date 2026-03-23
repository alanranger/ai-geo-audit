export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

function isPlainObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET, POST, or DELETE.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    if (req.method === 'GET') {
      const domainHost = normalizeDomainHost(req.query?.domain || req.query?.host || '');
      if (!domainHost) {
        return sendJson(res, 400, { status: 'error', message: 'Provide domain (e.g. alanranger.com).' });
      }
      const { data, error } = await supabase
        .from('dfs_backlink_tile_baseline')
        .select('domain_host,snapshot,saved_at,updated_at')
        .eq('domain_host', domainHost)
        .maybeSingle();
      if (error) throw error;
      return sendJson(res, 200, {
        status: 'ok',
        domainHost,
        data: data
          ? { snapshot: data.snapshot || {}, savedAt: data.saved_at || null, updatedAt: data.updated_at || null }
          : null,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (req.method === 'DELETE') {
      const domainHost = normalizeDomainHost(req.query?.domain || req.query?.host || '');
      if (!domainHost) {
        return sendJson(res, 400, { status: 'error', message: 'Provide domain (e.g. alanranger.com).' });
      }
      const { error } = await supabase.from('dfs_backlink_tile_baseline').delete().eq('domain_host', domainHost);
      if (error) throw error;
      await supabase.from('dfs_backlink_baseline_edges').delete().eq('domain_host', domainHost);
      return sendJson(res, 200, { status: 'ok', domainHost, meta: { generatedAt: new Date().toISOString() } });
    }

    let b = req.body || {};
    if (typeof b === 'string') {
      try {
        b = JSON.parse(b || '{}');
      } catch {
        return sendJson(res, 400, { status: 'error', message: 'Invalid JSON body.' });
      }
    }
    const domainHost = normalizeDomainHost(b.domain || b.domainHost || b.host || '');
    const snap = b.snapshot;
    if (!domainHost) {
      return sendJson(res, 400, { status: 'error', message: 'Body must include domain.' });
    }
    if (!isPlainObject(snap)) {
      return sendJson(res, 400, { status: 'error', message: 'Body must include snapshot object.' });
    }

    const now = new Date().toISOString();
    const row = { domain_host: domainHost, snapshot: snap, saved_at: now, updated_at: now };
    const { error } = await supabase.from('dfs_backlink_tile_baseline').upsert(row, { onConflict: 'domain_host' });
    if (error) throw error;
    try {
      const { error: rpcErr } = await supabase.rpc('dfs_refresh_backlink_baseline_edges', { p_domain: domainHost });
      if (rpcErr) throw rpcErr;
    } catch {
      /* Migration not applied or RPC missing — tile snapshot still saved */
    }
    return sendJson(res, 200, {
      status: 'ok',
      domainHost,
      savedAt: now,
      meta: { generatedAt: now }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
