export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const KE_BASE = 'https://api.keywordseverywhere.com/v1';
const KE_KEYWORD_DATA = `${KE_BASE}/get_keyword_data`;
const KE_URL_TRAFFIC = `${KE_BASE}/get_url_traffic_metrics`;
const KE_URL_KEYWORDS = `${KE_BASE}/get_url_keywords`;
const KE_PAGE_BACKLINKS = `${KE_BASE}/get_page_backlinks`;
const KE_UNIQUE_DOMAIN_BACKLINKS = `${KE_BASE}/get_unique_domain_backlinks`;

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

function envInt(name, def, min, max) {
  const n = toNum(process.env[name], def);
  const v = Math.round(Number.isFinite(n) ? n : def);
  return Math.max(min, Math.min(max, v));
}

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
      estimated_traffic: row?.estimated_traffic ?? null,
      url_estimated_traffic: row?.url_estimated_traffic ?? null,
      page_backlinks_sample: row?.page_backlinks_sample ?? null,
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

async function kePostJson(apiKey, path, jsonBody) {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(jsonBody)
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  return { res, text, json };
}

async function kePostForm(apiKey, path, params) {
  const body = new URLSearchParams();
  Object.keys(params || {}).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null) return;
    body.set(k, String(v));
  });
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
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
  return { res, text, json };
}

function keError(res, json, text) {
  const msg = json?.message || json?.error || text?.slice(0, 280) || `Keywords Everywhere HTTP ${res.status}`;
  return new Error(`KE ${res.status}: ${String(msg).trim()}`);
}

async function fetchKeywordsEverywhereVolume(keywords) {
  const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
  if (!apiKey) throw new Error('KEYWORDS_EVERYWHERE_API_KEY not configured');
  const country = normalizeKeCountry(process.env.KEYWORDS_EVERYWHERE_COUNTRY || 'gb');
  const currency = normalizeKeCurrency(process.env.KEYWORDS_EVERYWHERE_CURRENCY || 'GBP');
  const map = new Map();
  const batches = chunk(keywords, 100);
  for (let b = 0; b < batches.length; b += 1) {
    const form = new URLSearchParams();
    form.set('country', country);
    form.set('currency', currency);
    form.set('dataSource', 'gkp');
    batches[b].forEach((kw) => form.append('kw[]', kw));
    const res = await fetch(KE_KEYWORD_DATA, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Authorization: `Bearer ${apiKey}`
      },
      body: form.toString()
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) throw keError(res, json, text);
    extractKeItems(json).forEach((item) => {
      const k = keywordFromKeItem(item);
      if (!k) return;
      map.set(k.toLowerCase(), {
        search_volume: volumeFromKeItem(item),
        cpc: cpcFromKeItem(item),
        competition: competitionFromKeItem(item),
        raw: item
      });
    });
  }
  return map;
}

function normKwKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function findUrlKeywordRow(items, targetKeyword) {
  const t = normKwKey(targetKeyword);
  if (!t || !Array.isArray(items)) return null;
  const exact = items.find((x) => normKwKey(x?.keyword) === t);
  if (exact) return exact;
  return (
    items.find((x) => {
      const k = normKwKey(x?.keyword);
      return k && (k.includes(t) || t.includes(k));
    }) || null
  );
}

async function fetchUrlTrafficMap(apiKey, urls, country) {
  const map = new Map();
  const batchSize = envInt('KE_URL_TRAFFIC_BATCH', 15, 1, 50);
  const parts = chunk([...new Set(urls.map((u) => normalizePageUrl(u)).filter(Boolean))], batchSize);
  for (let i = 0; i < parts.length; i += 1) {
    const { res, json, text } = await kePostJson(apiKey, KE_URL_TRAFFIC, {
      urls: parts[i],
      country
    });
    if (!res.ok) throw keError(res, json, text);
    extractKeItems(json).forEach((row) => {
      const u = normalizePageUrl(row?.url);
      if (!u) return;
      map.set(u, {
        url_estimated_traffic: toNum(row?.estimated_monthly_traffic, null),
        total_ranking_keywords: toNum(row?.total_ranking_keywords, null)
      });
    });
  }
  return map;
}

async function fetchUrlKeywordsForPage(apiKey, pageUrl, country, num) {
  const { res, json, text } = await kePostForm(apiKey, KE_URL_KEYWORDS, {
    url: pageUrl,
    country,
    num
  });
  if (!res.ok) throw keError(res, json, text);
  return extractKeItems(json);
}

async function fetchPageBacklinksSample(apiKey, pageUrl, num) {
  const { res, json, text } = await kePostForm(apiKey, KE_PAGE_BACKLINKS, {
    page: pageUrl,
    num
  });
  if (!res.ok) throw keError(res, json, text);
  const list = extractKeItems(json);
  return Array.isArray(list) ? list.length : 0;
}

function extractMozDaDeep(obj, depth = 0, parentKey = '') {
  if (depth > 8 || obj == null) return null;
  const pk = String(parentKey || '').toLowerCase();
  const coerceDa = (v) => {
    const n = toNum(v, null);
    if (n == null || !Number.isFinite(n)) return null;
    const r = Math.round(n);
    if (r < 0 || r > 100) return null;
    return r;
  };
  if (typeof obj === 'number') {
    if (
      pk.includes('authority') ||
      pk.includes('domainauthority') ||
      (pk.includes('moz') && (pk.includes('domain') || pk.includes('auth'))) ||
      pk === 'da' ||
      pk === 'moz_da' ||
      pk === 'mozda'
    ) {
      return coerceDa(obj);
    }
    return null;
  }
  if (typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 40); i += 1) {
      const hit = extractMozDaDeep(obj[i], depth + 1, parentKey);
      if (hit != null) return hit;
    }
    return null;
  }
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const kl = String(k).toLowerCase();
    if (
      kl.includes('domain_authority') ||
      kl.includes('domainauthority') ||
      kl === 'mozda' ||
      kl === 'moz_da' ||
      kl === 'da' ||
      (kl.includes('moz') && (kl.includes('domain') || kl.includes('auth')))
    ) {
      const hit = extractMozDaDeep(obj[k], depth + 1, k);
      if (hit != null) return hit;
    }
  }
  for (let i = 0; i < keys.length; i += 1) {
    const k = keys[i];
    const kl = String(k).toLowerCase();
    if (kl === 'meta' || kl === 'metrics' || kl === 'summary' || kl === 'stats' || kl === 'overview' || kl === 'result') {
      const hit = extractMozDaDeep(obj[k], depth + 1, k);
      if (hit != null) return hit;
    }
  }
  return null;
}

async function fetchUniqueDomainBacklinks(apiKey, domainHost, num) {
  const { res, json, text } = await kePostForm(apiKey, KE_UNIQUE_DOMAIN_BACKLINKS, {
    domain: domainHost,
    num
  });
  if (!res.ok) throw keError(res, json, text);
  const list = extractKeItems(json);
  const referringDomainsSample = Array.isArray(list) ? list.length : 0;
  const moz = extractMozDaDeep(json, 0, '') ?? extractMozDaDeep({ items: list }, 0, '');
  return { referringDomainsSample, moz, raw: json };
}

async function readDomainMetricsRow(supabase, domainHost) {
  if (!domainHost) return null;
  const { data, error } = await supabase
    .from('ke_domain_metrics_cache')
    .select('*')
    .eq('domain_host', domainHost)
    .maybeSingle();
  if (error && !String(error.message || '').includes('does not exist')) throw error;
  return data || null;
}

async function upsertDomainMetrics(supabase, domainHost, payload) {
  if (!domainHost) return;
  const row = {
    domain_host: domainHost,
    moz_domain_authority: payload.moz_domain_authority ?? null,
    referring_domains_sample: payload.referring_domains_sample ?? null,
    raw_payload: payload.raw_payload ?? null,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('ke_domain_metrics_cache').upsert(row, { onConflict: 'domain_host' });
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

function domainMetricsPayload(row, nowMs) {
  if (!row) return null;
  return {
    domain_host: row.domain_host,
    moz_domain_authority: row.moz_domain_authority ?? null,
    referring_domains_sample: row.referring_domains_sample ?? null,
    fetched_at: row.fetched_at || null,
    stale: isStaleRow(row, nowMs)
  };
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
    const propertyDomainRaw = String(body?.propertyDomain || body?.property_domain || '').trim();

    if (action !== 'lookup' && action !== 'refresh') {
      return sendJson(res, 400, { status: 'error', message: 'Invalid action (use lookup or refresh).' });
    }
    if (pairs.length > 800) {
      return sendJson(res, 400, { status: 'error', message: 'Too many pairs (max 800).' });
    }

    const existing = await readCacheRows(supabase, pairs);
    const { byPageUrl, want } = buildByPageUrlMap(existing, pairs, nowMs);

    const domainHost =
      normalizeDomainHost(propertyDomainRaw) ||
      hostFromPageUrl(pairs[0]?.url) ||
      '';

    let domainRow = null;
    if (domainHost) {
      try {
        domainRow = await readDomainMetricsRow(supabase, domainHost);
      } catch {
        domainRow = null;
      }
    }
    const domainMetrics = domainHost ? domainMetricsPayload(domainRow, nowMs) : null;

    if (action === 'lookup') {
      if (domainMetrics?.moz_domain_authority != null && Number.isFinite(Number(domainMetrics.moz_domain_authority))) {
        const moz = Math.round(Number(domainMetrics.moz_domain_authority));
        Object.keys(byPageUrl).forEach((k) => {
          byPageUrl[k].moz_domain_authority = moz;
        });
      }
      return sendJson(res, 200, {
        status: 'ok',
        data: {
          byPageUrl,
          domainMetrics,
          staleDays: staleDays(),
          provider: 'keywordseverywhere'
        },
        meta: { generatedAt: new Date().toISOString(), note: 'DB read only; no external API.' }
      });
    }

    const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
    if (!apiKey) throw new Error('KEYWORDS_EVERYWHERE_API_KEY not configured');

    const country = normalizeKeCountry(process.env.KEYWORDS_EVERYWHERE_COUNTRY || 'gb');
    const urlKeywordsNum = envInt('KE_URL_KEYWORDS_NUM', 60, 1, 10000);
    const pageBlNum = envInt('KE_PAGE_BACKLINKS_NUM', 25, 1, 1000);
    const domainBlNum = envInt('KE_UNIQUE_DOMAIN_BACKLINKS_NUM', 80, 1, 1000);

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
    }

    const stalePageUrls = [];
    want.forEach((meta, mapKey) => {
      const row = existing.find((r) => `${r.page_url}\n${r.keyword}` === mapKey);
      if (!force && row && !isStaleRow(row, nowMs)) return;
      if (meta.page_url && !stalePageUrls.includes(meta.page_url)) stalePageUrls.push(meta.page_url);
    });

    const urlTrafficMap = new Map();
    const urlKeywordsMap = new Map();
    const pageBlMap = new Map();
    const enrichNotes = [];
    let domainMetricsForRows = null;

    if (stalePageUrls.length) {
      try {
        const m = await fetchUrlTrafficMap(apiKey, stalePageUrls, country);
        m.forEach((v, k) => urlTrafficMap.set(k, v));
      } catch (e) {
        enrichNotes.push(String(e?.message || e));
      }

      for (let i = 0; i < stalePageUrls.length; i += 1) {
        const pu = stalePageUrls[i];
        const canonical = normalizePageUrl(pu) || pu;
        try {
          const list = await fetchUrlKeywordsForPage(apiKey, pu, country, urlKeywordsNum);
          urlKeywordsMap.set(canonical, Array.isArray(list) ? list : []);
        } catch (e) {
          enrichNotes.push(`${canonical}: url keywords — ${String(e?.message || e)}`);
          urlKeywordsMap.set(canonical, []);
        }
        try {
          const n = await fetchPageBacklinksSample(apiKey, pu, pageBlNum);
          pageBlMap.set(canonical, n);
        } catch (e) {
          enrichNotes.push(`${canonical}: page backlinks — ${String(e?.message || e)}`);
          pageBlMap.set(canonical, null);
        }
      }
    }

    if (domainHost && (force || !domainRow || isStaleRow(domainRow, nowMs))) {
      try {
        const dom = await fetchUniqueDomainBacklinks(apiKey, domainHost, domainBlNum);
        await upsertDomainMetrics(supabase, domainHost, {
          moz_domain_authority: dom.moz,
          referring_domains_sample: dom.referringDomainsSample,
          raw_payload: dom.raw
        });
        domainRow = await readDomainMetricsRow(supabase, domainHost);
      } catch (e) {
        enrichNotes.push(`domain backlinks — ${String(e?.message || e)}`);
      }
    }

    domainMetricsForRows = domainHost ? domainMetricsPayload(domainRow, nowMs) : null;

    const upserts = [];
    want.forEach((meta) => {
      const key = `${meta.page_url}\n${meta.keyword}`;
      const row = existing.find((r) => `${r.page_url}\n${r.keyword}` === key);
      if (!force && row && !isStaleRow(row, nowMs)) return;
      const hit = keMap.get(meta.keyword.toLowerCase());
      const canonical = meta.page_url;
      const kwRows = urlKeywordsMap.get(canonical) || [];
      const kwHit = findUrlKeywordRow(kwRows, meta.keyword);
      const traffic = urlTrafficMap.get(canonical) || {};
      const est = kwHit ? toNum(kwHit.estimated_monthly_traffic, null) : null;
      const serp = kwHit ? toNum(kwHit.serp_position, null) : null;
      const urlEst = toNum(traffic.url_estimated_traffic, null);
      const pbl = pageBlMap.has(canonical) ? pageBlMap.get(canonical) : row?.page_backlinks_sample ?? null;

      const domMoz =
        domainMetricsForRows?.moz_domain_authority != null &&
        Number.isFinite(Number(domainMetricsForRows.moz_domain_authority))
          ? Math.round(Number(domainMetricsForRows.moz_domain_authority))
          : row?.moz_domain_authority ?? null;

      upserts.push({
        page_url: meta.page_url,
        keyword: meta.keyword,
        search_volume: hit?.search_volume ?? null,
        cpc: hit?.cpc ?? null,
        competition: hit?.competition ?? null,
        rank_position: serp != null && Number.isFinite(serp) ? serp : row?.rank_position ?? null,
        estimated_traffic: est != null && Number.isFinite(est) ? Math.round(est) : null,
        url_estimated_traffic: urlEst != null && Number.isFinite(urlEst) ? Math.round(urlEst) : null,
        page_backlinks_sample: pbl != null && Number.isFinite(Number(pbl)) ? Math.round(Number(pbl)) : null,
        moz_domain_authority: domMoz,
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
        domainMetrics: domainHost ? domainMetricsPayload(await readDomainMetricsRow(supabase, domainHost), nowMs) : null,
        refreshedKeywords: uniqueKw.length,
        upsertedRows: upserts.length,
        staleDays: staleDays()
      },
      meta: {
        generatedAt: new Date().toISOString(),
        ...(enrichNotes.length ? { keNotes: enrichNotes.slice(0, 8) } : {})
      }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        data: { byPageUrl: {}, domainMetrics: null, staleDays: staleDays() },
        meta: {
          generatedAt: new Date().toISOString(),
          warning:
            'keyword_target_metrics_cache or ke_domain_metrics_cache missing — apply sql/20260321_keyword_target_metrics_cache.sql and sql/20260322_ke_traffic_backlink_domain_cache.sql'
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
