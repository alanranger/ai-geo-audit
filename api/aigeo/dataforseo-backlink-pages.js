export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { dfsClientLimits, dfsPageBacklinksMax } from '../../lib/dfs-backlink-limits.js';

const DFS_BACKLINKS_LIVE = 'https://api.dataforseo.com/v3/backlinks/backlinks/live';

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

function normalizePageUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${u.protocol}//${host}${path}`;
  } catch {
    return '';
  }
}

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

function hostFromPageUrl(pageUrl) {
  const s = String(pageUrl || '').trim();
  if (!s) return '';
  try {
    if (/^https?:\/\//i.test(s)) return normalizeDomainHost(new URL(s).hostname);
    return normalizeDomainHost(s);
  } catch {
    return '';
  }
}

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

function pageStaleDays() {
  const n = toNum(process.env.DATAFORSEO_PAGE_BACKLINKS_STALE_DAYS, 30);
  return Math.max(1, Math.min(365, n || 30));
}

function maxRefreshBatch() {
  const n = toNum(process.env.DFS_PAGE_BACKLINK_REFRESH_BATCH, 10);
  return Math.max(1, Math.min(25, n || 10));
}

function isStaleRow(row, nowMs) {
  if (!row?.fetched_at) return true;
  const t = Date.parse(String(row.fetched_at));
  if (!Number.isFinite(t)) return true;
  return nowMs - t > pageStaleDays() * 86400000;
}

function pickStrength(it) {
  const keys = ['domain_from_rank', 'page_from_rank', 'rank', 'domain_rank', 'domain_from_platform_rank'];
  for (const k of keys) {
    const v = toNum(it?.[k], null);
    if (v != null && Number.isFinite(v)) return Math.round(v);
  }
  return null;
}

function mapDfsItem(it) {
  if (!it || typeof it !== 'object') return null;
  const src = String(it.url_from ?? it.urlFrom ?? '').trim();
  const tgt = String(it.url_to ?? it.urlTo ?? '').trim();
  const anchor = String(it.anchor ?? it.text ?? '').trim();
  const df = it.dofollow;
  const dofollow = df === true || df === 'true' || Number(df) === 1;
  const nofollow = df === false || df === 'false' || Number(df) === 0;
  const follow = dofollow ? true : nofollow ? false : null;
  const strength = pickStrength(it);
  let srcDomain = String(it.domain_from ?? it.domainFrom ?? '').trim();
  if (!srcDomain && src) {
    try {
      srcDomain = normalizeDomainHost(new URL(src).hostname);
    } catch {
      srcDomain = '';
    }
  }
  let tgtDomain = String(it.domain_to ?? it.domainTo ?? '').trim();
  if (!tgtDomain && tgt) {
    try {
      tgtDomain = normalizeDomainHost(new URL(tgt).hostname);
    } catch {
      tgtDomain = '';
    }
  }
  return {
    source_url: src,
    target_url: tgt,
    anchor,
    dofollow: follow,
    strength,
    domain_source: srcDomain,
    domain_target: tgtDomain
  };
}

function itemsFromTask(task) {
  const sc = toNum(task?.status_code, null);
  if (sc !== 20000) return { err: String(task?.status_message || `task ${sc}`), items: [], cost: null };
  const result = task?.result;
  const row0 = Array.isArray(result) && result.length ? result[0] : null;
  const raw = row0?.items;
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const el of arr) {
    const m = mapDfsItem(el);
    if (m && (m.source_url || m.target_url)) out.push(m);
  }
  return { err: null, items: out, cost: toNum(task?.cost, null) };
}

function payloadFromDbRow(row, nowMs) {
  if (!row) return null;
  const rows = Array.isArray(row.backlink_rows) ? row.backlink_rows : [];
  return {
    page_url: row.page_url,
    domain_host: row.domain_host,
    backlink_rows: rows,
    row_count: row.row_count != null ? row.row_count : rows.length,
    dofollow_count: row.dofollow_count ?? null,
    nofollow_count: row.nofollow_count ?? null,
    fetched_at: row.fetched_at || null,
    stale: isStaleRow(row, nowMs)
  };
}

async function readRows(supabase, urls) {
  if (!urls.length) return [];
  const { data, error } = await supabase.from('dfs_page_backlinks_cache').select('*').in('page_url', urls);
  if (error && !String(error.message || '').includes('does not exist')) throw error;
  return Array.isArray(data) ? data : [];
}

async function upsertRow(supabase, row) {
  const { error } = await supabase.from('dfs_page_backlinks_cache').upsert(row, { onConflict: 'page_url' });
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

async function fetchLiveForTargets(creds, targets, limit) {
  const body = targets.map((target) => ({
    target,
    limit
  }));
  const res = await fetch(DFS_BACKLINKS_LIVE, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds.login, creds.password),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
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
  return json;
}

async function runLookup(supabase, pageUrls, nowMs) {
  const byPageUrl = {};
  const chunk = 100;
  for (let i = 0; i < pageUrls.length; i += chunk) {
    const part = pageUrls.slice(i, i + chunk);
    const rows = await readRows(supabase, part);
    const map = new Map(rows.map((r) => [r.page_url, r]));
    for (let j = 0; j < part.length; j += 1) {
      const u = part[j];
      byPageUrl[u] = payloadFromDbRow(map.get(u), nowMs);
    }
  }
  return { status: 200, body: { status: 'ok', data: { byPageUrl, staleDays: pageStaleDays(), ...dfsClientLimits() }, meta: { generatedAt: new Date().toISOString() } } };
}

function followCountsForRows(sliced) {
  let dofollow_count = 0;
  let nofollow_count = 0;
  for (const r of sliced) {
    if (r.dofollow === true) dofollow_count += 1;
    else if (r.dofollow === false) nofollow_count += 1;
  }
  return { dofollow_count, nofollow_count };
}

async function upsertOnePageFromTask(supabase, pageUrl, task, limit, nowMs) {
  const ext = itemsFromTask(task);
  if (ext.err) {
    return { ok: false, payload: null, cost: 0 };
  }
  const sliced = ext.items.slice(0, limit);
  const { dofollow_count, nofollow_count } = followCountsForRows(sliced);
  const dh = hostFromPageUrl(pageUrl);
  const cacheRow = {
    page_url: pageUrl,
    domain_host: dh || '_',
    include_subdomains: true,
    backlink_rows: sliced,
    row_count: sliced.length,
    dofollow_count,
    nofollow_count,
    api_total_count: ext.items.length,
    cost_last: ext.cost != null && Number.isFinite(ext.cost) ? ext.cost : null,
    raw_meta: { limit },
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await upsertRow(supabase, cacheRow);
  const cost = ext.cost != null && Number.isFinite(ext.cost) ? ext.cost : 0;
  return { ok: true, payload: payloadFromDbRow(cacheRow, nowMs), cost };
}

async function runRefresh(supabase, pageUrlsNorm, force, nowMs) {
  const creds = dfsCreds();
  if (!creds) {
    return {
      status: 503,
      body: { status: 'error', message: 'DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD not configured.' }
    };
  }
  const cap = maxRefreshBatch();
  if (pageUrlsNorm.length > cap) {
    return {
      status: 400,
      body: {
        status: 'error',
        message: `Too many page_urls for one refresh (max ${cap} per call). Run multiple batches from the dashboard.`
      }
    };
  }
  const limit = dfsPageBacklinksMax();
  let refreshed = 0;
  let skippedFresh = 0;
  let apiErrors = 0;
  let totalCost = 0;
  const byPageUrl = Object.create(null);

  const existing = await readRows(supabase, pageUrlsNorm);
  const existingMap = new Map(existing.map((r) => [r.page_url, r]));

  const batch = [];
  for (const u of pageUrlsNorm) {
    const row = existingMap.get(u);
    if (!force && row && !isStaleRow(row, nowMs)) {
      skippedFresh += 1;
      byPageUrl[u] = payloadFromDbRow(row, nowMs);
    } else {
      batch.push(u);
    }
  }

  if (batch.length) {
    const json = await fetchLiveForTargets(creds, batch, limit);
    const tasks = json?.tasks;
    if (!Array.isArray(tasks)) throw new Error('DataForSEO tasks missing');
    const n = Math.min(batch.length, tasks.length);
    for (let t = 0; t < n; t += 1) {
      const pageUrl = batch[t];
      const done = await upsertOnePageFromTask(supabase, pageUrl, tasks[t], limit, nowMs);
      if (!done.ok) {
        apiErrors += 1;
        byPageUrl[pageUrl] = payloadFromDbRow(existingMap.get(pageUrl), nowMs);
        continue;
      }
      totalCost += done.cost;
      refreshed += 1;
      byPageUrl[pageUrl] = done.payload;
    }
    for (let t = n; t < batch.length; t += 1) {
      const pageUrl = batch[t];
      apiErrors += 1;
      byPageUrl[pageUrl] = payloadFromDbRow(existingMap.get(pageUrl), nowMs);
    }
  }

  for (const u of pageUrlsNorm) {
    if (byPageUrl[u] === undefined) {
      byPageUrl[u] = payloadFromDbRow(existingMap.get(u), nowMs);
    }
  }

  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        byPageUrl,
        refreshedPages: refreshed,
        skippedFreshPages: skippedFresh,
        apiErrors,
        approxCost: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
        staleDays: pageStaleDays(),
        refreshBatchMax: cap,
        ...dfsClientLimits()
      },
      meta: { generatedAt: new Date().toISOString() }
    }
  };
}

function normalizePageUrlList(rawList) {
  const pageUrlsNorm = [];
  const seen = new Set();
  for (const raw of rawList) {
    const u = normalizePageUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    pageUrlsNorm.push(u);
  }
  return pageUrlsNorm;
}

function inactiveDfsPageResponse(backlinkIndexSource) {
  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        byPageUrl: {},
        skipped: true,
        reason: 'index_source_ke',
        backlinkIndexSource,
        dfsPathActive: false,
        staleDays: pageStaleDays(),
        ...dfsClientLimits()
      },
      meta: { generatedAt: new Date().toISOString(), note: 'DFS page path off.' }
    }
  };
}

async function runBacklinkPages(req) {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const nowMs = Date.now();
  const body = req.method === 'POST' ? parseBody(req) : {};
  const action = String(body?.action || req.query?.action || 'lookup').toLowerCase();
  const force = body?.force === true || String(req.query?.force || '').toLowerCase() === 'true';
  const rawList = Array.isArray(body?.page_urls) ? body.page_urls : [];
  const pageUrlsNorm = normalizePageUrlList(rawList);

  if (action !== 'lookup' && action !== 'refresh') {
    return { status: 400, body: { status: 'error', message: 'Invalid action (use lookup or refresh).' } };
  }
  if (!pageUrlsNorm.length) {
    return { status: 400, body: { status: 'error', message: 'Provide page_urls (https URLs).' } };
  }

  const backlinkIndexSource = normalizeBacklinkIndexSource();
  const dfsPathActive = backlinkIndexSource === 'dataforseo' || backlinkIndexSource === 'both';
  if (!dfsPathActive) return inactiveDfsPageResponse(backlinkIndexSource);

  if (action === 'lookup') return runLookup(supabase, pageUrlsNorm, nowMs);
  return runRefresh(supabase, pageUrlsNorm, force, nowMs);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
  }

  try {
    const { status, body } = await runBacklinkPages(req);
    return sendJson(res, status, body);
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
