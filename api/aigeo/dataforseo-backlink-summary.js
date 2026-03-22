export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { dfsClientLimits } from '../../lib/dfs-backlink-limits.js';

const DFS_SUMMARY_URL = 'https://api.dataforseo.com/v3/backlinks/summary/live';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const toNum = (v, fb = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const parseBody = (req) => {
  if (req.method === 'GET') return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
};

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

function staleDays() {
  const n = toNum(process.env.DATAFORSEO_SUMMARY_STALE_DAYS, 14);
  return Math.max(1, Math.min(365, n || 14));
}

function isStaleRow(row, nowMs) {
  if (!row?.fetched_at) return true;
  const t = Date.parse(String(row.fetched_at));
  if (!Number.isFinite(t)) return true;
  return nowMs - t > staleDays() * 86400000;
}

/**
 * Which “domain index” backlink tiles / refresh path is active (KE samples vs DataForSEO summary).
 * ke = Keywords Everywhere sample tiles only (no DFS calls).
 * dataforseo = DataForSEO summary tiles only (hide KE sample pair).
 * both = show both; ③ refresh may update DFS when creds exist.
 */
function normalizeBacklinkIndexSource() {
  const rb = String(process.env.BACKLINK_INDEX_ROLLBACK || '').trim().toLowerCase();
  if (rb === '1' || rb === 'true' || rb === 'yes' || rb === 'on') return 'ke';
  const raw = String(process.env.TRADITIONAL_SEO_BACKLINK_INDEX_SOURCE || 'ke').trim().toLowerCase();
  if (raw === 'dataforseo' || raw === 'dfs' || raw === 'dfseo') return 'dataforseo';
  if (raw === 'both' || raw === 'all' || raw === 'ke+dfs' || raw === 'dfs+ke') return 'both';
  return 'ke';
}

function dfsCreds() {
  const login = String(process.env.DATAFORSEO_API_LOGIN || '').trim();
  const password = String(process.env.DATAFORSEO_API_PASSWORD || '').trim();
  if (!login || !password) return null;
  return { login, password };
}

function authHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function extractSummaryTaskRow(body) {
  const tasks = body?.tasks;
  if (!Array.isArray(tasks) || !tasks.length) return { err: 'No tasks in DataForSEO response' };
  const task = tasks[0];
  const sc = toNum(task?.status_code, null);
  if (sc !== 20000) return { err: String(task?.status_message || `DataForSEO task status ${sc}`) };
  const result = task?.result;
  if (!Array.isArray(result) || !result.length) return { err: 'Empty DataForSEO result' };
  const taskData = task?.data && typeof task.data === 'object' ? task.data : null;
  return { row: result[0], cost: toNum(task?.cost, null), taskData };
}

function attrBucketCount(attrsObj, name) {
  if (!attrsObj || typeof attrsObj !== 'object') return null;
  const want = String(name || '').toLowerCase();
  for (const [k, raw] of Object.entries(attrsObj)) {
    if (String(k || '').toLowerCase() === want) {
      const n = toNum(raw, null);
      return n != null && Number.isFinite(n) ? Math.round(n) : null;
    }
  }
  return null;
}

function targetSpamFromSummaryRow(apiRow) {
  const top = toNum(apiRow?.target_spam_score, null);
  if (top != null && Number.isFinite(top)) return Math.round(top);
  const inf = apiRow?.info;
  const nested = toNum(inf?.target_spam_score, null);
  return nested != null && Number.isFinite(nested) ? Math.round(nested) : null;
}

function mapRowToCache(domainHost, includeSubdomains, apiRow, cost) {
  const pickInt = (k) => {
    const v = toNum(apiRow?.[k], null);
    return v != null && Number.isFinite(v) ? Math.round(v) : null;
  };
  const pickFirstInt = (keys) => {
    for (const k of keys) {
      const v = pickInt(k);
      if (v != null) return v;
    }
    return null;
  };
  const backlinksTotal = pickInt('backlinks');
  let dofollow_backlinks = pickFirstInt([
    'dofollow_backlinks',
    'backlinks_dofollow',
    'referring_links_dofollow'
  ]);
  let nofollow_backlinks = pickFirstInt([
    'nofollow_backlinks',
    'backlinks_nofollow',
    'referring_links_nofollow'
  ]);
  const attrs = apiRow?.referring_links_attributes;
  let nfFromAttrs = attrBucketCount(attrs, 'nofollow');
  if (
    nfFromAttrs == null &&
    backlinksTotal != null &&
    attrs &&
    typeof attrs === 'object' &&
    !Array.isArray(attrs) &&
    Object.keys(attrs).length > 0
  ) {
    nfFromAttrs = 0;
  }
  if (
    (dofollow_backlinks == null || nofollow_backlinks == null) &&
    backlinksTotal != null &&
    nfFromAttrs != null
  ) {
    const nf = Math.max(0, Math.min(nfFromAttrs, backlinksTotal));
    nofollow_backlinks = nf;
    dofollow_backlinks = backlinksTotal - nf;
  }
  return {
    domain_host: domainHost,
    include_subdomains: !!includeSubdomains,
    backlinks: backlinksTotal,
    referring_domains: pickInt('referring_domains'),
    referring_main_domains: pickInt('referring_main_domains'),
    broken_backlinks: pickInt('broken_backlinks'),
    broken_pages: pickInt('broken_pages'),
    backlinks_spam_score: pickInt('backlinks_spam_score'),
    target_spam_score: targetSpamFromSummaryRow(apiRow),
    rank: pickInt('rank'),
    crawled_pages: pickInt('crawled_pages'),
    internal_links_count: pickInt('internal_links_count'),
    external_links_count: pickInt('external_links_count'),
    dofollow_backlinks,
    nofollow_backlinks,
    cost_last: cost != null && Number.isFinite(cost) ? cost : null,
    raw_result: apiRow && typeof apiRow === 'object' ? apiRow : null,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function referringPagesFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const n = toNum(raw.referring_pages ?? raw.referring_pages_count ?? raw.pages_with_backlinks, null);
  return n != null && Number.isFinite(n) ? Math.round(n) : null;
}

function pickRawInt(raw, key) {
  if (!raw || typeof raw !== 'object') return null;
  const n = toNum(raw[key], null);
  return n != null && Number.isFinite(n) ? Math.round(n) : null;
}

function summaryPayload(row, nowMs) {
  if (!row) return null;
  const referring_pages = referringPagesFromRaw(row.raw_result);
  const raw = row.raw_result;
  return {
    domain_host: row.domain_host,
    include_subdomains: row.include_subdomains !== false,
    backlinks: row.backlinks ?? null,
    referring_domains: row.referring_domains ?? null,
    referring_main_domains: row.referring_main_domains ?? null,
    broken_backlinks: row.broken_backlinks ?? null,
    broken_pages: row.broken_pages ?? null,
    backlinks_spam_score: row.backlinks_spam_score ?? null,
    target_spam_score: row.target_spam_score ?? null,
    rank: pickRawInt(raw, 'rank') ?? row.rank ?? null,
    rank_scale:
      raw && typeof raw === 'object' && raw.rank_scale != null && raw.rank_scale !== ''
        ? String(raw.rank_scale)
        : null,
    crawled_pages: row.crawled_pages ?? null,
    dofollow_backlinks: row.dofollow_backlinks ?? null,
    nofollow_backlinks: row.nofollow_backlinks ?? null,
    referring_pages,
    referring_domains_nofollow: pickRawInt(raw, 'referring_domains_nofollow'),
    referring_main_domains_nofollow: pickRawInt(raw, 'referring_main_domains_nofollow'),
    referring_ips: pickRawInt(raw, 'referring_ips'),
    referring_subnets: pickRawInt(raw, 'referring_subnets'),
    referring_pages_nofollow: pickRawInt(raw, 'referring_pages_nofollow'),
    internal_links_count: row.internal_links_count ?? null,
    external_links_count: row.external_links_count ?? null,
    cost_last: row.cost_last ?? null,
    fetched_at: row.fetched_at || null,
    stale: isStaleRow(row, nowMs)
  };
}

async function readRow(supabase, domainHost) {
  const { data, error } = await supabase
    .from('dfs_backlink_summary_cache')
    .select('*')
    .eq('domain_host', domainHost)
    .maybeSingle();
  if (error && !String(error.message || '').includes('does not exist')) throw error;
  return data || null;
}

async function upsertRow(supabase, row) {
  const { error } = await supabase.from('dfs_backlink_summary_cache').upsert(row, { onConflict: 'domain_host' });
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

async function fetchLiveSummary(login, password, domainHost, includeSubdomains) {
  const res = await fetch(DFS_SUMMARY_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader(login, password),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      { target: domainHost, include_subdomains: !!includeSubdomains, rank_scale: 'one_hundred' }
    ])
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`DataForSEO non-JSON (${res.status})`);
  }
  if (!res.ok) throw new Error(String(json?.status_message || `DataForSEO HTTP ${res.status}`));
  const top = toNum(json?.status_code, null);
  if (top !== 20000) throw new Error(String(json?.status_message || `DataForSEO status ${top}`));
  const ext = extractSummaryTaskRow(json);
  if (ext.err) throw new Error(ext.err);
  const base = ext.row && typeof ext.row === 'object' ? { ...ext.row } : ext.row;
  const td = ext.taskData;
  if (base && td && typeof td === 'object') {
    if (td.rank_scale != null && base.rank_scale == null) base.rank_scale = td.rank_scale;
    if (td.include_subdomains != null && base.include_subdomains == null) base.include_subdomains = td.include_subdomains;
  }
  return { apiRow: base, cost: ext.cost };
}

async function runBacklinkSummary(req) {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const nowMs = Date.now();
  const body = req.method === 'POST' ? parseBody(req) : {};
  const action = String(body?.action || req.query?.action || 'lookup').toLowerCase();
  const domainHost = normalizeDomainHost(body?.domain || body?.propertyDomain || req.query?.domain || '');
  const includeSubdomains = body?.include_subdomains !== false && req.query?.include_subdomains !== 'false';
  const force = body?.force === true || String(req.query?.force || '').toLowerCase() === 'true';

  if (action !== 'lookup' && action !== 'refresh') {
    return { status: 400, body: { status: 'error', message: 'Invalid action (use lookup or refresh).' } };
  }
  if (!domainHost) {
    return { status: 400, body: { status: 'error', message: 'Missing domain (e.g. alanranger.com).' } };
  }

  const backlinkIndexSource = normalizeBacklinkIndexSource();
  const dfsPathActive = backlinkIndexSource === 'dataforseo' || backlinkIndexSource === 'both';

  if (action === 'lookup' && !dfsPathActive) {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: {
          summary: null,
          staleDays: staleDays(),
          provider: 'dataforseo',
          configured: !!dfsCreds(),
          backlinkIndexSource,
          dfsPathActive: false,
          ...dfsClientLimits()
        },
        meta: {
          generatedAt: new Date().toISOString(),
          note: 'DataForSEO path off (TRADITIONAL_SEO_BACKLINK_INDEX_SOURCE=ke).'
        }
      }
    };
  }

  let row = dfsPathActive ? await readRow(supabase, domainHost) : null;

  if (action === 'lookup') {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: {
          summary: summaryPayload(row, nowMs),
          staleDays: staleDays(),
          provider: 'dataforseo',
          configured: !!dfsCreds(),
          backlinkIndexSource,
          dfsPathActive: true,
          ...dfsClientLimits()
        },
        meta: { generatedAt: new Date().toISOString(), note: 'DB read; no external API unless refresh.' }
      }
    };
  }

  if (!dfsPathActive) {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: {
          summary: null,
          staleDays: staleDays(),
          provider: 'dataforseo',
          refreshed: false,
          skipped: true,
          reason: 'index_source_ke',
          backlinkIndexSource,
          dfsPathActive: false,
          ...dfsClientLimits()
        },
        meta: { generatedAt: new Date().toISOString() }
      }
    };
  }

  const creds = dfsCreds();
  if (!creds) {
    return {
      status: 503,
      body: { status: 'error', message: 'DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD not configured.' }
    };
  }

  if (!force && row && !isStaleRow(row, nowMs)) {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: {
          summary: summaryPayload(row, nowMs),
          staleDays: staleDays(),
          provider: 'dataforseo',
          skipped: true,
          reason: 'fresh_cache',
          backlinkIndexSource,
          dfsPathActive: true,
          ...dfsClientLimits()
        },
        meta: { generatedAt: new Date().toISOString() }
      }
    };
  }

  const { apiRow, cost } = await fetchLiveSummary(creds.login, creds.password, domainHost, includeSubdomains);
  const cacheRow = mapRowToCache(domainHost, includeSubdomains, apiRow, cost);
  await upsertRow(supabase, cacheRow);
  row = await readRow(supabase, domainHost);

  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        summary: summaryPayload(row, nowMs),
        staleDays: staleDays(),
        provider: 'dataforseo',
        refreshed: true,
        backlinkIndexSource,
        dfsPathActive: true,
        ...dfsClientLimits()
      },
      meta: { generatedAt: new Date().toISOString() }
    }
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
  }

  try {
    const { status, body } = await runBacklinkSummary(req);
    return sendJson(res, status, body);
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
