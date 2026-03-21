export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const KE_API = 'https://api.keywordseverywhere.com/v1/get_keyword_data';

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
    return s;
  }
}

function normalizeKeyword(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function staleDays() {
  const n = toNum(process.env.KEYWORD_METRICS_STALE_DAYS, 30);
  return Math.max(1, Math.min(365, n || 30));
}

function isStaleRow(row, nowMs) {
  if (!row?.fetched_at) return true;
  const t = Date.parse(String(row.fetched_at));
  if (!Number.isFinite(t)) return true;
  return nowMs - t > staleDays() * 86400000;
}

/** PostgREST `.in()` with hundreds of long URLs can exceed request limits → HTTP 400 "Bad Request". */
const PAGE_URL_IN_CHUNK = 40;

async function readCacheRows(supabase, pairs) {
  const keys = (Array.isArray(pairs) ? pairs : [])
    .map((p) => ({
      page_url: normalizePageUrl(p?.url),
      keyword: normalizeKeyword(p?.keyword)
    }))
    .filter((p) => p.page_url && p.keyword);
  if (!keys.length) return [];
  const pageUrls = [...new Set(keys.map((k) => k.page_url))];
  const urlParts = chunk(pageUrls, PAGE_URL_IN_CHUNK);
  const rows = [];
  for (let i = 0; i < urlParts.length; i += 1) {
    const { data, error } = await supabase
      .from('keyword_target_metrics_cache')
      .select('*')
      .in('page_url', urlParts[i]);
    if (error) throw error;
    if (Array.isArray(data)) rows.push(...data);
  }
  return rows;
}

function buildByPageUrlMap(rows, pairs, nowMs) {
  const want = new Map();
  (Array.isArray(pairs) ? pairs : []).forEach((p) => {
    const page_url = normalizePageUrl(p?.url);
    const keyword = normalizeKeyword(p?.keyword);
    if (!page_url || !keyword) return;
    want.set(`${page_url}\n${keyword}`, { page_url, keyword, url: String(p.url || '').trim() });
  });
  const db = new Map();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const k = `${String(r.page_url)}\n${String(r.keyword)}`;
    db.set(k, r);
  });
  const byPageUrl = {};
  want.forEach((meta, key) => {
    const row = db.get(key);
    const stale = !row || isStaleRow(row, nowMs);
    const displayUrl = meta.url || meta.page_url;
    byPageUrl[displayUrl] = {
      page_url: meta.page_url,
      keyword: meta.keyword,
      search_volume: row?.search_volume ?? null,
      cpc: row?.cpc ?? null,
      competition: row?.competition ?? null,
      rank_position: row?.rank_position ?? null,
      moz_domain_authority: row?.moz_domain_authority ?? null,
      provider: row?.provider || null,
      fetched_at: row?.fetched_at || null,
      stale
    };
  });
  return { byPageUrl, want, db };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function extractKeItems(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data);
  return [];
}

function volumeFromKeItem(item) {
  const v = item?.vol ?? item?.volume ?? item?.search_volume;
  const n = toNum(v, null);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cpcFromKeItem(item) {
  const c = item?.cpc?.value ?? item?.cpc ?? item?.CPC;
  return toNum(c, null);
}

function competitionFromKeItem(item) {
  const c = item?.competition ?? item?.comp;
  return toNum(c, null);
}

/** KE payload shape varies; try common keys (0–100). */
function mozDaFromKeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const asInt = (v) => {
    const n = toNum(v, null);
    if (n == null || !Number.isFinite(n)) return null;
    const r = Math.round(n);
    if (r < 0 || r > 100) return null;
    return r;
  };
  const mozObj = item.moz && typeof item.moz === 'object' ? item.moz : null;
  const candidates = [
    item.moz_da,
    item.mozDA,
    item.moz_domain_authority,
    item.domain_authority,
    item.domainAuthority,
    item.da,
    mozObj?.da,
    mozObj?.domain_authority,
    item.metrics?.moz_da,
    item.metrics?.domain_authority,
    typeof item.moz === 'number' ? item.moz : null
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const hit = asInt(candidates[i]);
    if (hit != null) return hit;
  }
  return null;
}

function keywordFromKeItem(item) {
  return normalizeKeyword(item?.keyword || item?.kw || item?.term || '');
}

function normalizeKeCountry(raw) {
  let c = String(raw || 'gb').trim().toLowerCase();
  if (!c) c = 'gb';
  if (c === 'uk') c = 'gb';
  return c;
}

function normalizeKeCurrency(raw) {
  const u = String(raw || 'GBP').trim().toUpperCase();
  return u || 'GBP';
}

async function fetchKeywordsEverywhereVolume(keywords) {
  const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
  if (!apiKey) throw new Error('KEYWORDS_EVERYWHERE_API_KEY not configured');
  const country = normalizeKeCountry(process.env.KEYWORDS_EVERYWHERE_COUNTRY || 'gb');
  const currency = normalizeKeCurrency(process.env.KEYWORDS_EVERYWHERE_CURRENCY || 'GBP');
  const map = new Map();
  const batches = chunk(keywords, 100);
  for (let b = 0; b < batches.length; b += 1) {
    const body = new URLSearchParams();
    body.set('country', country);
    body.set('currency', currency);
    body.set('dataSource', 'gkp');
    batches[b].forEach((kw) => body.append('kw[]', kw));
    const res = await fetch(KE_API, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${apiKey}`
      },
      body: body.toString()
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) {
      const msg = json?.message || json?.error || text?.slice(0, 280) || `Keywords Everywhere HTTP ${res.status}`;
      throw new Error(`KE ${res.status}: ${String(msg).trim()}`);
    }
    extractKeItems(json).forEach((item) => {
      const k = keywordFromKeItem(item);
      if (!k) return;
      map.set(k.toLowerCase(), {
        search_volume: volumeFromKeItem(item),
        cpc: cpcFromKeItem(item),
        competition: competitionFromKeItem(item),
        moz_domain_authority: mozDaFromKeItem(item),
        raw: item
      });
    });
  }
  return map;
}

function propagateSharedMozDa(map) {
  if (!(map instanceof Map) || !map.size) return;
  let shared = null;
  map.forEach((v) => {
    if (shared != null) return;
    const mz = v?.moz_domain_authority;
    if (mz == null || !Number.isFinite(Number(mz))) return;
    const r = Math.round(Number(mz));
    if (r >= 0 && r <= 100) shared = r;
  });
  if (shared == null) return;
  map.forEach((v) => {
    if (v && (v.moz_domain_authority == null || !Number.isFinite(Number(v.moz_domain_authority)))) {
      v.moz_domain_authority = shared;
    }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const nowMs = Date.now();
    const body = req.method === 'POST' ? parseBody(req) : {};
    const action = String(body?.action || req.query?.action || 'lookup').toLowerCase();
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    const force = body?.force === true;

    if (action !== 'lookup' && action !== 'refresh') {
      return sendJson(res, 400, { status: 'error', message: 'Invalid action (use lookup or refresh).' });
    }
    if (pairs.length > 800) {
      return sendJson(res, 400, { status: 'error', message: 'Too many pairs (max 800).' });
    }

    const existing = await readCacheRows(supabase, pairs);
    const { byPageUrl, want } = buildByPageUrlMap(existing, pairs, nowMs);

    if (action === 'lookup') {
      return sendJson(res, 200, {
        status: 'ok',
        data: {
          byPageUrl,
          staleDays: staleDays(),
          provider: 'keywordseverywhere'
        },
        meta: { generatedAt: new Date().toISOString(), note: 'DB read only; no external API.' }
      });
    }

    const toFetch = [];
    want.forEach((meta, mapKey) => {
      const row = existing.find((r) => `${r.page_url}\n${r.keyword}` === mapKey);
      if (force || !row || isStaleRow(row, nowMs)) {
        toFetch.push(meta.keyword);
      }
    });
    const uniqueKw = [...new Set(toFetch.map((k) => normalizeKeyword(k)).filter(Boolean))];
    let keMap = new Map();
    if (uniqueKw.length) {
      keMap = await fetchKeywordsEverywhereVolume(uniqueKw);
      propagateSharedMozDa(keMap);
    }

    const upserts = [];
    want.forEach((meta) => {
      const key = `${meta.page_url}\n${meta.keyword}`;
      const row = existing.find((r) => `${r.page_url}\n${r.keyword}` === key);
      if (!force && row && !isStaleRow(row, nowMs)) return;
      const hit = keMap.get(meta.keyword.toLowerCase());
      const mozFromKe = hit?.moz_domain_authority;
      upserts.push({
        page_url: meta.page_url,
        keyword: meta.keyword,
        search_volume: hit?.search_volume ?? null,
        cpc: hit?.cpc ?? null,
        competition: hit?.competition ?? null,
        rank_position: row?.rank_position ?? null,
        moz_domain_authority:
          mozFromKe != null && Number.isFinite(Number(mozFromKe))
            ? Math.round(Number(mozFromKe))
            : row?.moz_domain_authority ?? null,
        provider: 'keywordseverywhere',
        raw_payload: hit?.raw ? hit.raw : null,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    });

    if (upserts.length) {
      const parts = chunk(upserts, 100);
      for (let i = 0; i < parts.length; i += 1) {
        const { error } = await supabase
          .from('keyword_target_metrics_cache')
          .upsert(parts[i], { onConflict: 'page_url,keyword' });
        if (error) throw error;
      }
    }

    const refreshed = await readCacheRows(supabase, pairs);
    const out = buildByPageUrlMap(refreshed, pairs, nowMs);

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        byPageUrl: out.byPageUrl,
        refreshedKeywords: uniqueKw.length,
        upsertedRows: upserts.length,
        staleDays: staleDays()
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        data: { byPageUrl: {}, staleDays: staleDays() },
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'keyword_target_metrics_cache table missing — apply sql/20260321_keyword_target_metrics_cache.sql'
        }
      });
    }
    return sendJson(res, 500, {
      status: 'error',
      message: msg,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
