export const config = { runtime: 'nodejs' };

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const KE_BASE = 'https://api.keywordseverywhere.com/v1';
const KE_KEYWORD_DATA = `${KE_BASE}/get_keyword_data`;
const KE_URL_TRAFFIC = `${KE_BASE}/get_url_traffic_metrics`;
const KE_URL_KEYWORDS = `${KE_BASE}/get_url_keywords`;
const KE_PAGE_BACKLINKS = `${KE_BASE}/get_page_backlinks`;
const KE_UNIQUE_DOMAIN_BACKLINKS = `${KE_BASE}/get_unique_domain_backlinks`;
/** Often includes sitewide totals; `get_unique_domain_backlinks` responses are frequently row-only (`data: []`). */
const KE_DOMAIN_BACKLINKS = `${KE_BASE}/get_domain_backlinks`;

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

function rowHasBacklinksJsonPayload(row) {
  const j = row?.page_backlinks_json;
  if (j == null) return false;
  if (Array.isArray(j)) return j.length > 0;
  if (typeof j === 'object') return Object.keys(j).length > 0;
  return false;
}

/**
 * Rows that still need a KE pass: missing URL traffic, or Pg bl count without stored JSON
 * (e.g. shipped before page_backlinks_json column / UI).
 */
function rowNeedsKeUrlEnrichment(row) {
  if (!row) return false;
  if (row.url_estimated_traffic == null) return true;
  const n = toNum(row.page_backlinks_sample, null);
  if (n != null && n > 0 && !rowHasBacklinksJsonPayload(row)) return true;
  return false;
}

function domainNeedsKeFetch(domainRow, force, nowMs) {
  if (force) return true;
  if (!domainRow) return true;
  if (isStaleRow(domainRow, nowMs)) return true;
  if (
    domainRow.referring_domains_sample == null &&
    domainRow.moz_domain_authority == null &&
    (domainRow.raw_payload == null || domainRow.raw_payload === undefined)
  ) {
    return true;
  }
  return false;
}

/** PostgREST `.in()` with hundreds of long URLs can exceed request limits → HTTP 400 "Bad Request". */
const PAGE_URL_IN_CHUNK = 40;

function envInt(name, def, min, max) {
  const n = toNum(process.env[name], def);
  const v = Math.round(Number.isFinite(n) ? n : def);
  return Math.max(min, Math.min(max, v));
}

/** Same normalisation for disavow URL lines and KE `url_source` (exact match after normalise). */
function normalizeDisavowPageUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    let pathname = u.pathname || '/';
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    return `${u.protocol}//${u.hostname.toLowerCase()}${pathname}${u.search}`.toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function parseGoogleDisavowFile(text) {
  const domains = new Set();
  const urls = new Set();
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line || line.startsWith('#')) continue;
    const low = line.toLowerCase();
    if (low.startsWith('domain:')) {
      const d = normalizeDomainHost(low.slice(7));
      if (d) domains.add(d);
      continue;
    }
    if (/^https?:\/\//i.test(line)) {
      const u = normalizeDisavowPageUrl(line);
      if (u) urls.add(u);
    }
  }
  return { domains, urls };
}

function loadDisavowForBacklinks() {
  const override = String(process.env.DISAVOW_FILE_PATH || '').trim();
  const names = ['disavow-alanranger-com.txt', 'Disavow links https_www_alanranger_com.txt'];
  const roots = [process.cwd(), path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')];
  const candidates = [];
  if (override) candidates.push(override);
  for (let r = 0; r < roots.length; r += 1) {
    for (let n = 0; n < names.length; n += 1) {
      candidates.push(path.join(roots[r], 'public', names[n]));
    }
  }
  for (let i = 0; i < candidates.length; i += 1) {
    try {
      const txt = fs.readFileSync(candidates[i], 'utf8');
      return parseGoogleDisavowFile(txt);
    } catch {
      /* try next path */
    }
  }
  return { domains: new Set(), urls: new Set() };
}

function hostMatchesDisavowSet(host, domainSet) {
  const h = normalizeDomainHost(host);
  if (!h || !domainSet || !domainSet.size) return false;
  for (const d of domainSet) {
    if (!d) continue;
    if (h === d || h.endsWith(`.${d}`)) return true;
  }
  return false;
}

/** Known spam network; block even if disavow file failed to load on serverless. */
function isSeoAnomalySpamHost(host) {
  const h = normalizeDomainHost(host);
  return Boolean(h && h.includes('seo-anomaly'));
}

function backlinkRowLooksLikeSeoAnomalySpam(row) {
  if (row == null) return false;
  if (typeof row === 'string') return String(row).toLowerCase().includes('seo-anomaly');
  if (typeof row !== 'object') return false;
  const anchor = String(row.anchor_text ?? row.anchorText ?? row.anchor ?? '').toLowerCase();
  if (anchor.includes('seo-anomaly') || anchor.includes('seo_anomaly')) return true;
  const httpish = [];
  const pushStr = (v) => {
    if (typeof v !== 'string') return;
    const s = v.trim();
    if (/^https?:\/\//i.test(s)) httpish.push(s);
  };
  Object.keys(row).forEach((k) => pushStr(row[k]));
  const nested = row.source;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    Object.keys(nested).forEach((k) => pushStr(nested[k]));
  }
  for (let i = 0; i < httpish.length; i += 1) {
    try {
      if (isSeoAnomalySpamHost(new URL(httpish[i]).hostname)) return true;
    } catch {
      if (httpish[i].toLowerCase().includes('seo-anomaly')) return true;
    }
  }
  return false;
}

function backlinkSourceHost(row) {
  if (typeof row === 'string') {
    const s = String(row).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) {
      try {
        return normalizeDomainHost(new URL(s).hostname);
      } catch {
        return '';
      }
    }
    return normalizeDomainHost(s);
  }
  if (!row || typeof row !== 'object') return '';
  const dom =
    row.domain_source ??
    row.domainSource ??
    row.source_domain ??
    row.sourceDomain ??
    row.linking_domain ??
    row.linkingDomain ??
    row.from_domain ??
    row.fromDomain ??
    row.referring_domain ??
    row.referringDomain ??
    row.domain;
  if (dom) return normalizeDomainHost(dom);
  const u = String(
    (row.url_source ??
      row.urlSource ??
      row.source_url ??
      row.sourceUrl ??
      row.from_url ??
      row.fromUrl ??
      row.referring_url ??
      row.referringUrl ??
      row.link_url ??
      row.linkUrl ??
      row.linking_url ??
      row.linkingUrl) ||
      ''
  ).trim();
  if (!u) return '';
  try {
    return normalizeDomainHost(new URL(u).hostname);
  } catch {
    return '';
  }
}

function normalizeBacklinkSourceUrl(row) {
  if (typeof row === 'string') {
    const s = String(row).trim();
    return /^https?:\/\//i.test(s) ? normalizeDisavowPageUrl(s) : '';
  }
  if (!row || typeof row !== 'object') return '';
  const u = String(
    (row.url_source ??
      row.urlSource ??
      row.source_url ??
      row.sourceUrl ??
      row.from_url ??
      row.fromUrl ??
      row.referring_url ??
      row.referringUrl ??
      row.link_url ??
      row.linkUrl ??
      row.linking_url ??
      row.linkingUrl) ||
      ''
  ).trim();
  return u ? normalizeDisavowPageUrl(u) : '';
}

function filterDisavowedBacklinks(list, domainSet, urlSet) {
  if (!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  const d = domainSet && domainSet.size ? domainSet : null;
  const u = urlSet && urlSet.size ? urlSet : null;
  return list.filter((row) => {
    if (backlinkRowLooksLikeSeoAnomalySpam(row)) return false;
    const h = backlinkSourceHost(row);
    if (h && isSeoAnomalySpamHost(h)) return false;
    const nu = u ? normalizeBacklinkSourceUrl(row) : '';
    if (nu && u.has(nu)) return false;
    if (d && h && hostMatchesDisavowSet(h, d)) return false;
    return true;
  });
}

function uniqueDomainRowHost(row) {
  if (!row || typeof row !== 'object') return '';
  const v =
    row.domain ?? row.domain_name ?? row.domain_host ?? row.domain_source ?? row.source_domain ?? row.host ?? row.url;
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      return normalizeDomainHost(new URL(s).hostname);
    } catch {
      return normalizeDomainHost(s);
    }
  }
  return normalizeDomainHost(s);
}

function filterDisavowedDomainRows(list, domainSet) {
  if (!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  return list.filter((row) => {
    const h = uniqueDomainRowHost(row);
    if (h && isSeoAnomalySpamHost(h)) return false;
    if (!domainSet || !domainSet.size) return true;
    return !hostMatchesDisavowSet(h, domainSet);
  });
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
      page_backlinks_json: Array.isArray(row?.page_backlinks_json)
        ? row.page_backlinks_json
        : row?.page_backlinks_json && typeof row.page_backlinks_json === 'object'
          ? Object.values(row.page_backlinks_json)
          : null,
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

/** `get_url_traffic_metrics` / `get_url_keywords` reject `gb`; UK must be `uk` on those routes. */
function keCountryForUrlEndpoints(raw) {
  const c = normalizeKeCountry(raw);
  return c === 'gb' ? 'uk' : c;
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

function urlTrafficFromKeRow(row) {
  const v =
    row?.estimated_monthly_traffic ??
    row?.estimatedTraffic ??
    row?.monthly_traffic ??
    row?.organic_traffic ??
    row?.traffic;
  return toNum(v, null);
}

async function fetchUrlTrafficMap(apiKey, urls, country) {
  const map = new Map();
  const urlCountry = keCountryForUrlEndpoints(country);
  const batchSize = envInt('KE_URL_TRAFFIC_BATCH', 15, 1, 50);
  const uniq = [
    ...new Set(
      urls
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u))
    )
  ];
  const parts = chunk(uniq, batchSize);
  for (let i = 0; i < parts.length; i += 1) {
    const { res, json, text } = await kePostJson(apiKey, KE_URL_TRAFFIC, {
      urls: parts[i],
      country: urlCountry
    });
    if (!res.ok) throw keError(res, json, text);
    extractKeItems(json).forEach((row) => {
      const u = normalizePageUrl(row?.url);
      if (!u) return;
      map.set(u, {
        url_estimated_traffic: urlTrafficFromKeRow(row),
        total_ranking_keywords: toNum(row?.total_ranking_keywords, null)
      });
    });
  }
  return map;
}

async function fetchUrlKeywordsForPage(apiKey, pageUrl, country, num) {
  const urlCountry = keCountryForUrlEndpoints(country);
  const { res, json, text } = await kePostForm(apiKey, KE_URL_KEYWORDS, {
    url: pageUrl,
    country: urlCountry,
    num
  });
  if (!res.ok) throw keError(res, json, text);
  return extractKeItems(json);
}

function sanitizeBacklinksForDb(list, maxItems) {
  const globalMax = envInt('KE_PAGE_BACKLINKS_MAX_STORED', 200, 1, 2000);
  const cap = Math.max(1, Math.min(globalMax, maxItems || 25));
  const src = Array.isArray(list) ? list.slice(0, cap) : [];
  try {
    return JSON.parse(JSON.stringify(src));
  } catch {
    return [];
  }
}

/**
 * KE cannot exclude domains server-side. We request a larger `num`, drop disavowed rows, then cap to `desiredCount`.
 * Returns { count, items } — items are a capped JSON-safe array for Supabase jsonb.
 */
async function fetchPageBacklinksSample(apiKey, pageUrl, desiredCount, disavow) {
  const d = disavow || { domains: new Set(), urls: new Set() };
  const oversample = envInt('KE_PAGE_BACKLINKS_OVERSAMPLE_MULT', 5, 1, 20);
  const fetchCap = envInt('KE_PAGE_BACKLINKS_FETCH_CAP', 500, 50, 2000);
  const want = Math.max(1, Math.round(Number(desiredCount)) || 25);
  const askNum = Math.min(fetchCap, Math.max(want * oversample, want + 40));
  const { res, json, text } = await kePostForm(apiKey, KE_PAGE_BACKLINKS, {
    page: pageUrl,
    num: askNum
  });
  if (!res.ok) throw keError(res, json, text);
  const list = extractKeItems(json);
  const filtered = filterDisavowedBacklinks(list, d.domains, d.urls);
  const items = sanitizeBacklinksForDb(filtered, want);
  return { count: items.length, items };
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

function keNonNegativeInt(v) {
  const n = toNum(v, null);
  if (n == null || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 0 ? r : null;
}

/** KE backlink responses may expose sitewide totals; names vary. Never walk into `data` row arrays (false zeros). */
function extractKeDomainLinkTotals(payload) {
  const pickFrom = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ref: null, bl: null };
    const get = (keys) => {
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        return keNonNegativeInt(obj[key]);
      }
      return null;
    };
    return {
      ref: get([
        'referring_domains',
        'referringDomains',
        'unique_referring_domains',
        'total_referring_domains',
        'referring_domain_count',
        'ref_domains',
        'num_referring_domains'
      ]),
      bl: get([
        'total_backlinks',
        'totalBacklinks',
        'backlinks_total',
        'backlinksTotal',
        'total_external_backlinks',
        'external_backlinks',
        'num_backlinks',
        'backlink_count',
        'links_count',
        'total_links'
      ])
    };
  };
  let referringDomainsTotal = null;
  let totalBacklinks = null;
  const merge = (o) => {
    const t = pickFrom(o);
    if (referringDomainsTotal == null) referringDomainsTotal = t.ref;
    if (totalBacklinks == null) totalBacklinks = t.bl;
  };
  if (payload && typeof payload === 'object') {
    merge(payload);
    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) merge(payload.data);
    merge(payload.meta);
    merge(payload.metrics);
    merge(payload.stats);
    merge(payload.summary);
    merge(payload.result);
  }
  const deepWalk = (obj, depth) => {
    if (referringDomainsTotal != null && totalBacklinks != null) return;
    if (!obj || typeof obj !== 'object' || depth > 5) return;
    if (Array.isArray(obj)) return;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      const kl = String(k).toLowerCase();
      const v = obj[k];
      if (v != null && typeof v === 'object') {
        if (!Array.isArray(v)) deepWalk(v, depth + 1);
        continue;
      }
      const n = keNonNegativeInt(v);
      if (n == null) continue;
      if (referringDomainsTotal == null && kl === 'referring_domains') referringDomainsTotal = n;
      if (totalBacklinks == null && (kl === 'total_backlinks' || kl === 'backlinks_total')) totalBacklinks = n;
    }
  };
  if (referringDomainsTotal == null || totalBacklinks == null) deepWalk(payload, 0);
  return { referringDomainsTotal, totalBacklinks };
}

/** If we have a non-empty sample but KE reports 0 totals, treat as unknown (row-level JSON often lacks real sitewide counts). */
function sanitizeKeLinkTotals(ref, bl, sampleRows) {
  const s = toNum(sampleRows, 0) || 0;
  const fix = (v) => {
    if (v == null || !Number.isFinite(Number(v))) return null;
    const n = Math.round(Number(v));
    if (n === 0 && s > 0) return null;
    return n;
  };
  return { referringDomainsTotal: fix(ref), totalBacklinks: fix(bl) };
}

async function fetchKeDomainBacklinksTotals(apiKey, domainHost) {
  const host = normalizeDomainHost(domainHost);
  if (!host) return { referringDomainsTotal: null, totalBacklinks: null };
  try {
    const { res, json } = await kePostForm(apiKey, KE_DOMAIN_BACKLINKS, { domain: host, num: 1 });
    if (!res.ok) return { referringDomainsTotal: null, totalBacklinks: null };
    return extractKeDomainLinkTotals(json);
  } catch {
    return { referringDomainsTotal: null, totalBacklinks: null };
  }
}

async function fetchUniqueDomainBacklinks(apiKey, domainHost, num, disavow) {
  const d = disavow || { domains: new Set(), urls: new Set() };
  const oversample = envInt('KE_DOMAIN_BACKLINKS_OVERSAMPLE_MULT', 3, 1, 15);
  const fetchCap = envInt('KE_DOMAIN_BACKLINKS_FETCH_CAP', 300, 30, 2000);
  const want = Math.max(1, Math.round(Number(num)) || 80);
  const askNum = Math.min(fetchCap, Math.max(want * oversample, want + 20));
  const { res, json, text } = await kePostForm(apiKey, KE_UNIQUE_DOMAIN_BACKLINKS, {
    domain: domainHost,
    num: askNum
  });
  if (!res.ok) throw keError(res, json, text);
  const list = extractKeItems(json);
  const filtered = filterDisavowedDomainRows(list, d.domains);
  const trimmed = filtered.slice(0, want);
  const referringDomainsSample = trimmed.length;
  const moz = extractMozDaDeep(json, 0, '') ?? extractMozDaDeep({ items: list }, 0, '');
  const totals = extractKeDomainLinkTotals(json);
  const cleaned = sanitizeKeLinkTotals(totals.referringDomainsTotal, totals.totalBacklinks, referringDomainsSample);
  return {
    referringDomainsSample,
    moz,
    raw: json,
    referringDomainsTotal: cleaned.referringDomainsTotal,
    totalBacklinks: cleaned.totalBacklinks
  };
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
  let prev = null;
  try {
    prev = await readDomainMetricsRow(supabase, domainHost);
  } catch {
    prev = null;
  }
  const pickIntOrNull = (key) => {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) return prev?.[key] ?? null;
    const v = payload[key];
    return v != null && Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
  };
  const row = {
    domain_host: domainHost,
    moz_domain_authority: payload.moz_domain_authority ?? null,
    referring_domains_sample: payload.referring_domains_sample ?? null,
    referring_domains_total: pickIntOrNull('referring_domains_total'),
    total_backlinks: pickIntOrNull('total_backlinks'),
    raw_payload: payload.raw_payload ?? null,
    fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('ke_domain_metrics_cache').upsert(row, { onConflict: 'domain_host' });
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

function domainMetricsPayload(row, nowMs) {
  if (!row) return null;
  let referring_domains_total = row.referring_domains_total ?? null;
  let total_backlinks = row.total_backlinks ?? null;
  if (
    (referring_domains_total == null || total_backlinks == null) &&
    row.raw_payload != null &&
    typeof row.raw_payload === 'object'
  ) {
    const t = extractKeDomainLinkTotals(row.raw_payload);
    if (referring_domains_total == null) referring_domains_total = t.referringDomainsTotal;
    if (total_backlinks == null) total_backlinks = t.totalBacklinks;
  }
  const fin = sanitizeKeLinkTotals(
    referring_domains_total,
    total_backlinks,
    row.referring_domains_sample ?? 0
  );
  return {
    domain_host: row.domain_host,
    moz_domain_authority: row.moz_domain_authority ?? null,
    referring_domains_sample: row.referring_domains_sample ?? null,
    referring_domains_total: fin.referringDomainsTotal,
    total_backlinks: fin.totalBacklinks,
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
      const need =
        force || !row || isStaleRow(row, nowMs) || rowNeedsKeUrlEnrichment(row);
      if (!need) return;
      const keUrl = String(meta.url || '').trim() || meta.page_url;
      if (keUrl && !stalePageUrls.includes(keUrl)) stalePageUrls.push(keUrl);
    });

    const urlTrafficMap = new Map();
    const urlKeywordsMap = new Map();
    const pageBlMap = new Map();
    const enrichNotes = [];
    let domainMetricsForRows = null;

    const needDisavow =
      stalePageUrls.length > 0 || (domainHost && domainNeedsKeFetch(domainRow, force, nowMs));
    const disavowLists = needDisavow ? loadDisavowForBacklinks() : { domains: new Set(), urls: new Set() };

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
          const n = await fetchPageBacklinksSample(apiKey, pu, pageBlNum, disavowLists);
          pageBlMap.set(canonical, n);
        } catch (e) {
          enrichNotes.push(`${canonical}: page backlinks — ${String(e?.message || e)}`);
          pageBlMap.set(canonical, null);
        }
      }
    }

    if (domainHost && domainNeedsKeFetch(domainRow, force, nowMs)) {
      try {
        const dom = await fetchUniqueDomainBacklinks(apiKey, domainHost, domainBlNum, disavowLists);
        const supTotals = await fetchKeDomainBacklinksTotals(apiKey, domainHost);
        let refT = dom.referringDomainsTotal ?? supTotals.referringDomainsTotal;
        let blT = dom.totalBacklinks ?? supTotals.totalBacklinks;
        const fin = sanitizeKeLinkTotals(refT, blT, dom.referringDomainsSample);
        await upsertDomainMetrics(supabase, domainHost, {
          moz_domain_authority: dom.moz,
          referring_domains_sample: dom.referringDomainsSample,
          referring_domains_total: fin.referringDomainsTotal,
          total_backlinks: fin.totalBacklinks,
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
      const needUpsert =
        force || !row || isStaleRow(row, nowMs) || rowNeedsKeUrlEnrichment(row);
      if (!needUpsert) return;
      const hit = keMap.get(meta.keyword.toLowerCase());
      const canonical = normalizePageUrl(meta.page_url) || meta.page_url;
      const kwRows = urlKeywordsMap.get(canonical) || [];
      const kwHit = findUrlKeywordRow(kwRows, meta.keyword);
      const traffic = urlTrafficMap.get(canonical) || {};
      const est = kwHit ? toNum(kwHit.estimated_monthly_traffic, null) : null;
      const serp = kwHit ? toNum(kwHit.serp_position, null) : null;
      const urlEst = toNum(traffic.url_estimated_traffic, null);
      let pblCount = row?.page_backlinks_sample ?? null;
      let pblJson = Array.isArray(row?.page_backlinks_json)
        ? row.page_backlinks_json
        : row?.page_backlinks_json && typeof row.page_backlinks_json === 'object'
          ? Object.values(row.page_backlinks_json)
          : null;
      const pbPack = pageBlMap.get(canonical);
      if (pbPack && typeof pbPack === 'object' && !Array.isArray(pbPack)) {
        pblCount = Number.isFinite(Number(pbPack.count)) ? Math.round(Number(pbPack.count)) : pblCount;
        pblJson = Array.isArray(pbPack.items) ? pbPack.items : pblJson;
      } else if (pbPack === null) {
        pblCount = null;
        pblJson = null;
      }

      const domMoz =
        domainMetricsForRows?.moz_domain_authority != null &&
        Number.isFinite(Number(domainMetricsForRows.moz_domain_authority))
          ? Math.round(Number(domainMetricsForRows.moz_domain_authority))
          : row?.moz_domain_authority ?? null;

      upserts.push({
        page_url: meta.page_url,
        keyword: meta.keyword,
        search_volume: hit?.search_volume ?? row?.search_volume ?? null,
        cpc: hit?.cpc ?? row?.cpc ?? null,
        competition: hit?.competition ?? row?.competition ?? null,
        rank_position: serp != null && Number.isFinite(serp) ? serp : row?.rank_position ?? null,
        estimated_traffic: est != null && Number.isFinite(est) ? Math.round(est) : row?.estimated_traffic ?? null,
        url_estimated_traffic: urlEst != null && Number.isFinite(urlEst) ? Math.round(urlEst) : row?.url_estimated_traffic ?? null,
        page_backlinks_sample:
          pblCount != null && Number.isFinite(Number(pblCount))
            ? Math.round(Number(pblCount))
            : row?.page_backlinks_sample ?? null,
        page_backlinks_json: pblJson != null ? pblJson : row?.page_backlinks_json ?? null,
        moz_domain_authority: domMoz,
        provider: 'keywordseverywhere',
        raw_payload: hit?.raw ? hit.raw : row?.raw_payload ?? null,
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
        ...(needDisavow && (disavowLists.domains.size > 0 || disavowLists.urls.size > 0)
          ? {
              disavowLoaded: {
                domainEntries: disavowLists.domains.size,
                urlEntries: disavowLists.urls.size
              }
            }
          : {}),
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
            'keyword_target_metrics_cache or ke_domain_metrics_cache missing — apply sql/20260321_keyword_target_metrics_cache.sql, sql/20260322_ke_traffic_backlink_domain_cache.sql, sql/20260323_page_backlinks_json.sql, sql/20260324_ke_domain_link_totals.sql'
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
