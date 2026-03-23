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

function toNumOpt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SORT_COLS = new Set([
  'url_from',
  'url_to',
  'anchor',
  'dofollow',
  'domain_from_rank',
  'page_from_rank',
  'first_seen',
  'last_seen'
]);

function escapeIlike(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
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

    const limit = toInt(q.limit, 50, 1, 200);
    const offset = toInt(q.offset, 0, 0, 500000);
    const sort = SORT_COLS.has(String(q.sort || '').trim()) ? String(q.sort).trim() : 'domain_from_rank';
    const dirRaw = String(q.dir || 'desc').toLowerCase();
    const ascending = dirRaw === 'asc';

    const follow = String(q.follow || 'all').toLowerCase();
    const rankMin = q.rankMin != null && String(q.rankMin).trim() !== '' ? toNumOpt(q.rankMin) : null;
    const rankMax = q.rankMax != null && String(q.rankMax).trim() !== '' ? toNumOpt(q.rankMax) : null;
    let search = String(q.q || q.search || '').trim().slice(0, 240);
    search = search.replace(/,/g, ' ').trim();

    let query = supabase
      .from('dfs_domain_backlink_rows')
      .select(
        'url_from,url_to,anchor,dofollow,domain_from_rank,page_from_rank,first_seen,last_seen,domain_host',
        { count: 'exact' }
      )
      .eq('domain_host', domainHost);

    if (follow === 'follow' || follow === 'dofollow') query = query.eq('dofollow', true);
    else if (follow === 'nofollow') query = query.eq('dofollow', false);

    if (rankMin != null) query = query.gte('domain_from_rank', rankMin);
    if (rankMax != null) query = query.lte('domain_from_rank', rankMax);

    if (search) {
      const pat = `%${escapeIlike(search)}%`.replace(/"/g, '');
      query = query.or(`url_from.ilike."${pat}",url_to.ilike."${pat}",anchor.ilike."${pat}"`);
    }

    query = query.order(sort, { ascending, nullsFirst: false });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      return sendJson(res, 500, { status: 'error', message: String(error.message || error) });
    }

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        domain: domainHost,
        rows: Array.isArray(data) ? data : [],
        total: typeof count === 'number' ? count : null,
        limit,
        offset,
        sort,
        dir: ascending ? 'asc' : 'desc'
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
