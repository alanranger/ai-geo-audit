export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import {
  fetchTierSegmentationEntries,
  buildTierLookupFromEntries,
  getTierForUrlFromLookup
} from './tier-segmentation.js';
import { dfsBacklinkPageTierSortIndex } from '../../lib/dfs-backlink-page-tier.js';

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
  'last_seen',
  'page_tier'
]);

const PAGE_TIER_SET = new Set(['landing', 'product', 'event', 'blog', 'academy', 'unmapped']);

const DB_PAGE = 800;
const MAX_ROWS_SCAN = 120000;

function escapeIlike(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function normalizePageTierParam(raw) {
  const t = String(raw ?? '').trim().toLowerCase();
  return PAGE_TIER_SET.has(t) ? t : '';
}

function applyBacklinkRowFilters(query, { follow, rankMin, rankMax, search }) {
  let q = query;
  if (follow === 'follow' || follow === 'dofollow') q = q.eq('dofollow', true);
  else if (follow === 'nofollow') q = q.eq('dofollow', false);

  if (rankMin != null) q = q.gte('domain_from_rank', rankMin);
  if (rankMax != null) q = q.lte('domain_from_rank', rankMax);

  if (search) {
    const pat = `%${escapeIlike(search)}%`.replace(/"/g, '');
    q = q.or(`url_from.ilike."${pat}",url_to.ilike."${pat}",anchor.ilike."${pat}"`);
  }
  return q;
}

const ROW_SELECT =
  'url_from,url_to,anchor,dofollow,domain_from_rank,page_from_rank,first_seen,last_seen,domain_host';

function enrichBacklinkRow(row, tierLookup) {
  const r = row && typeof row === 'object' ? { ...row } : {};
  r.page_tier = getTierForUrlFromLookup(r.url_to, tierLookup);
  return r;
}

function compareRowsForPageTierSort(a, b, tierAscending) {
  const ia = dfsBacklinkPageTierSortIndex(a.page_tier);
  const ib = dfsBacklinkPageTierSortIndex(b.page_tier);
  if (ia !== ib) return tierAscending ? ia - ib : ib - ia;
  const ra = Number(a.domain_from_rank);
  const rb = Number(b.domain_from_rank);
  const fa = Number.isFinite(ra) ? ra : -1;
  const fb = Number.isFinite(rb) ? rb : -1;
  if (fa !== fb) return fb - fa;
  return String(a.url_to || '').localeCompare(String(b.url_to || ''));
}

/**
 * Load matching rows (optional tier filter), enrich with page_tier, cap at MAX_ROWS_SCAN DB rows read.
 */
async function collectRowsForPageTierSort(
  supabase,
  { domainHost, follow, rankMin, rankMax, search, tierFilter, tierLookup }
) {
  const all = [];
  let dbFrom = 0;
  let rowsScanned = 0;
  let exhausted = false;

  while (rowsScanned < MAX_ROWS_SCAN) {
    let query = supabase.from('dfs_domain_backlink_rows').select(ROW_SELECT).eq('domain_host', domainHost);
    query = applyBacklinkRowFilters(query, { follow, rankMin, rankMax, search });
    query = query.order('domain_from_rank', { ascending: false, nullsFirst: false });
    query = query.range(dbFrom, dbFrom + DB_PAGE - 1);

    const { data, error } = await query;
    if (error) throw new Error(String(error.message || error));
    const batch = Array.isArray(data) ? data : [];
    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    for (let i = 0; i < batch.length; i += 1) {
      rowsScanned += 1;
      const er = enrichBacklinkRow(batch[i], tierLookup);
      if (tierFilter && er.page_tier !== tierFilter) continue;
      all.push(er);
      if (rowsScanned >= MAX_ROWS_SCAN) break;
    }

    dbFrom += DB_PAGE;
    if (batch.length < DB_PAGE) {
      exhausted = true;
      break;
    }
    if (rowsScanned >= MAX_ROWS_SCAN) break;
  }

  const scanCapped = rowsScanned >= MAX_ROWS_SCAN;
  return { rows: all, scanCapped, exhausted };
}

async function fetchRowsPageTierSort(supabase, opts) {
  const {
    domainHost,
    follow,
    rankMin,
    rankMax,
    search,
    tierFilter,
    tierLookup,
    ascending,
    limit,
    offset
  } = opts;

  const { rows: collected, scanCapped, exhausted } = await collectRowsForPageTierSort(supabase, {
    domainHost,
    follow,
    rankMin,
    rankMax,
    search,
    tierFilter,
    tierLookup
  });

  collected.sort((a, b) => compareRowsForPageTierSort(a, b, ascending));
  const page = collected.slice(offset, offset + limit);
  const total = !scanCapped && exhausted ? collected.length : null;

  return {
    rows: page,
    total,
    tierFiltered: Boolean(tierFilter),
    tier: tierFilter || null,
    tierScanCapped: scanCapped
  };
}

/**
 * Tier uses segmentation CSV + heuristic (same as Backlinks tile). Scan DB in order until
 * we skip `offset` tier matches and collect `limit` rows, or hit MAX_ROWS_SCAN.
 */
async function fetchRowsWithPageTierFilter(supabase, opts) {
  const {
    domainHost,
    follow,
    rankMin,
    rankMax,
    search,
    sort,
    ascending,
    tier,
    tierLookup,
    limit,
    offset
  } = opts;

  const collected = [];
  let dbFrom = 0;
  let tierSkipped = 0;
  let rowsScanned = 0;

  while (collected.length < limit && rowsScanned < MAX_ROWS_SCAN) {
    let query = supabase.from('dfs_domain_backlink_rows').select(ROW_SELECT).eq('domain_host', domainHost);
    query = applyBacklinkRowFilters(query, { follow, rankMin, rankMax, search });
    query = query.order(sort, { ascending, nullsFirst: false });
    query = query.range(dbFrom, dbFrom + DB_PAGE - 1);

    const { data, error } = await query;
    if (error) throw new Error(String(error.message || error));
    const batch = Array.isArray(data) ? data : [];
    if (batch.length === 0) break;

    for (let i = 0; i < batch.length; i += 1) {
      rowsScanned += 1;
      const row = batch[i];
      if (getTierForUrlFromLookup(row?.url_to, tierLookup) !== tier) continue;
      if (tierSkipped < offset) {
        tierSkipped += 1;
        continue;
      }
      collected.push(enrichBacklinkRow(row, tierLookup));
      if (collected.length >= limit) break;
    }

    dbFrom += DB_PAGE;
    if (batch.length < DB_PAGE) break;
  }

  return {
    rows: collected,
    total: null,
    tierFiltered: true,
    tier,
    tierScanCapped: rowsScanned >= MAX_ROWS_SCAN
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') return sendJson(res, 405, { status: 'error', message: 'Use GET.' });

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const segEntries = await fetchTierSegmentationEntries();
    const tierLookup = buildTierLookupFromEntries(segEntries);

    const q = req.query || {};
    const domainHost = normalizeDomainHost(q.domain || q.host || '');
    if (!domainHost) {
      return sendJson(res, 400, { status: 'error', message: 'Provide domain (e.g. alanranger.com).' });
    }

    const limit = toInt(q.limit, 50, 1, 200);
    const offset = toInt(q.offset, 0, 0, 500000);
    const sortCol = SORT_COLS.has(String(q.sort || '').trim()) ? String(q.sort).trim() : 'domain_from_rank';
    const dirRaw = String(q.dir || 'desc').toLowerCase();
    const ascending = dirRaw === 'asc';

    const follow = String(q.follow || 'all').toLowerCase();
    const rankMin = q.rankMin != null && String(q.rankMin).trim() !== '' ? toNumOpt(q.rankMin) : null;
    const rankMax = q.rankMax != null && String(q.rankMax).trim() !== '' ? toNumOpt(q.rankMax) : null;
    let search = String(q.q || q.search || '').trim().slice(0, 240);
    search = search.replace(/,/g, ' ').trim();

    const pageTierFilter = normalizePageTierParam(q.tier);
    const sortByPageTier = sortCol === 'page_tier';

    if (sortByPageTier) {
      const r = await fetchRowsPageTierSort(supabase, {
        domainHost,
        follow,
        rankMin,
        rankMax,
        search,
        tierFilter: pageTierFilter || null,
        tierLookup,
        ascending,
        limit,
        offset
      });

      return sendJson(res, 200, {
        status: 'ok',
        data: {
          domain: domainHost,
          rows: r.rows,
          total: r.total,
          limit,
          offset,
          sort: 'page_tier',
          dir: ascending ? 'asc' : 'desc',
          tierFiltered: r.tierFiltered,
          pageTier: pageTierFilter || null,
          tierScanCapped: r.tierScanCapped
        },
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (pageTierFilter) {
      const tierResult = await fetchRowsWithPageTierFilter(supabase, {
        domainHost,
        follow,
        rankMin,
        rankMax,
        search,
        sort: sortCol,
        ascending,
        tier: pageTierFilter,
        tierLookup,
        limit,
        offset
      });

      return sendJson(res, 200, {
        status: 'ok',
        data: {
          domain: domainHost,
          rows: tierResult.rows,
          total: null,
          limit,
          offset,
          sort: sortCol,
          dir: ascending ? 'asc' : 'desc',
          tierFiltered: true,
          pageTier: pageTierFilter,
          tierScanCapped: tierResult.tierScanCapped
        },
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    let query = supabase
      .from('dfs_domain_backlink_rows')
      .select(ROW_SELECT, { count: 'exact' })
      .eq('domain_host', domainHost);

    query = applyBacklinkRowFilters(query, { follow, rankMin, rankMax, search });

    query = query.order(sortCol, { ascending, nullsFirst: false });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      return sendJson(res, 500, { status: 'error', message: String(error.message || error) });
    }

    const rows = Array.isArray(data) ? data.map((row) => enrichBacklinkRow(row, tierLookup)) : [];

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        domain: domainHost,
        rows,
        total: typeof count === 'number' ? count : null,
        limit,
        offset,
        sort: sortCol,
        dir: ascending ? 'asc' : 'desc',
        tierFiltered: false,
        pageTier: null,
        tierScanCapped: false
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
