import { createHash } from 'node:crypto';
import { dfsSpamUrlFilters, DFS_SPAM_FILTERS_VERSION } from './dfs-spam-filters.js';
import { normalizeDfsPageUrl } from './dfs-page-url-keys.js';

const DFS_LIVE = 'https://api.dataforseo.com/v3/backlinks/backlinks/live';

export function dfsIngestCreds() {
  const login = String(process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN || '').trim();
  const password = String(
    process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD || ''
  ).trim();
  if (!login || !password) return null;
  return { login, password };
}

function authHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function toNum(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function parseDofollow(it) {
  if (!it || typeof it !== 'object') return null;
  const raw = it.dofollow ?? it.is_dofollow;
  if (raw === true || raw === 'true' || Number(raw) === 1) return true;
  if (raw === false || raw === 'false' || Number(raw) === 0) return false;
  const attrLists = [it.attributes, it.link_attributes];
  for (const al of attrLists) {
    if (!Array.isArray(al)) continue;
    const lower = al.map((x) => String(x || '').toLowerCase());
    if (lower.some((x) => x.includes('nofollow') || x === 'ugc' || x === 'sponsored')) return false;
  }
  return null;
}

function parseDfsDate(s) {
  if (s == null || s === '') return null;
  const raw = String(s).trim();
  const norm = raw.includes('T') ? raw : raw.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
  const t = Date.parse(norm);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function rowHashForBacklink(domainHost, urlFrom, urlTo, anchor) {
  const h = createHash('sha256');
  h.update(
    `${String(domainHost)}|${String(urlFrom)}|${String(urlTo)}|${String(anchor || '')}`,
    'utf8'
  );
  return h.digest('hex');
}

export function mapDfsItemToDomainRow(domainHost, runId, it) {
  const urlFrom = String(it?.url_from ?? '').trim();
  const urlTo = String(it?.url_to ?? '').trim();
  const anchor = String(it?.anchor ?? '').trim();
  if (!urlFrom || !urlTo) return null;
  const urlToKey = normalizeDfsPageUrl(urlTo) || urlTo;
  const hash = rowHashForBacklink(domainHost, urlFrom, urlTo, anchor);
  const fs = it?.first_seen != null ? parseDfsDate(it.first_seen) : null;
  const ls = it?.last_seen != null ? parseDfsDate(it.last_seen) : null;
  return {
    row_hash: hash,
    domain_host: domainHost,
    url_from: urlFrom,
    url_to: urlTo,
    url_to_key: urlToKey,
    anchor,
    dofollow: parseDofollow(it),
    first_seen: fs,
    last_seen: ls,
    backlink_spam_score: toNum(it?.backlink_spam_score, null),
    domain_from_rank: toNum(
      it?.domain_from_rank ?? it?.domainFromRank ?? it?.domain_from?.rank,
      null
    ),
    page_from_rank: toNum(it?.page_from_rank ?? it?.pageFromRank ?? it?.page_from?.rank, null),
    filters_version: DFS_SPAM_FILTERS_VERSION,
    run_id: runId,
    ingested_at: new Date().toISOString()
  };
}

export function dfsTimeFilterValue(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (!Number.isFinite(d.getTime())) return null;
  const s = d.toISOString();
  return s.replace('T', ' ').replace(/\.\d{3}Z$/, ' +00:00');
}

export function filtersFullSpamOnly() {
  return dfsSpamUrlFilters();
}

export function filtersDeltaAfter(firstSeenExclusiveIso) {
  const t = dfsTimeFilterValue(firstSeenExclusiveIso);
  if (!t) return null;
  return [...dfsSpamUrlFilters(), 'and', ['first_seen', '>', t]];
}

export async function fetchBacklinksLivePage(creds, task) {
  const res = await fetch(DFS_LIVE, {
    method: 'POST',
    headers: {
      Authorization: authHeader(creds.login, creds.password),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([task])
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`DataForSEO non-JSON (${res.status})`);
  }
  const top = json?.status_code;
  if (!res.ok || top !== 20000) {
    throw new Error(String(json?.status_message || `DataForSEO ${top}`));
  }
  const t0 = json?.tasks?.[0];
  if (!t0) throw new Error('DataForSEO tasks[0] missing');
  const sc = t0.status_code;
  if (sc !== 20000 && String(sc) !== '20000') {
    throw new Error(String(t0.status_message || `task ${sc}`));
  }
  const r0 = Array.isArray(t0.result) ? t0.result[0] : null;
  const items = Array.isArray(r0?.items) ? r0.items : [];
  const token = r0?.search_after_token != null ? String(r0.search_after_token) : '';
  const total = r0?.total_count;
  const cost = toNum(t0.cost, 0) || 0;
  return { items, search_after_token: token, total_count: total, cost };
}

export function domainIngestMaxPages() {
  const n = toNum(process.env.DFS_DOMAIN_INGEST_MAX_PAGES, 40);
  return Math.max(1, Math.min(200, n || 40));
}

export function domainIngestPageLimit() {
  const n = toNum(process.env.DFS_DOMAIN_INGEST_PAGE_LIMIT, 1000);
  return Math.max(100, Math.min(1000, n || 1000));
}

/**
 * Paginate backlinks/live for one domain. One task per HTTP request.
 * @returns {{ rows: object[], pages: number, totalCost: number, maxFirstSeen: string|null, truncated: boolean }}
 */
export async function paginateDomainBacklinks(creds, domainHost, filters, runId) {
  const limit = domainIngestPageLimit();
  const maxPages = domainIngestMaxPages();
  const rows = [];
  let token = '';
  let pages = 0;
  let totalCost = 0;
  let maxFirstSeen = null;
  let truncated = false;

  for (;;) {
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    const task = {
      target: domainHost,
      mode: 'as_is',
      limit,
      backlinks_status_type: 'live',
      filters,
      ...(token ? { search_after_token: token } : {})
    };
    const page = await fetchBacklinksLivePage(creds, task);
    pages += 1;
    totalCost += page.cost;
    for (const it of page.items) {
      const row = mapDfsItemToDomainRow(domainHost, runId, it);
      if (row) {
        rows.push(row);
        if (row.first_seen && (!maxFirstSeen || row.first_seen > maxFirstSeen)) {
          maxFirstSeen = row.first_seen;
        }
      }
    }
    if (!page.search_after_token || page.items.length < limit) break;
    token = page.search_after_token;
  }

  return { rows, pages, totalCost, maxFirstSeen, truncated };
}
