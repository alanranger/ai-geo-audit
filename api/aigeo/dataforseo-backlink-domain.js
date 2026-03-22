export const config = { runtime: 'nodejs' };

import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  dfsIngestCreds,
  filtersFullSpamOnly,
  filtersDeltaAfter,
  paginateDomainBacklinks
} from '../../lib/dfs-domain-backlink-ingest.js';
import { DFS_SPAM_FILTERS_VERSION } from '../../lib/dfs-spam-filters.js';

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

function normalizeBacklinkIndexSource() {
  const rb = String(process.env.BACKLINK_INDEX_ROLLBACK || '').trim().toLowerCase();
  if (rb === '1' || rb === 'true' || rb === 'yes' || rb === 'on') return 'ke';
  const raw = String(process.env.TRADITIONAL_SEO_BACKLINK_INDEX_SOURCE || 'ke').trim().toLowerCase();
  if (raw === 'dataforseo' || raw === 'dfs' || raw === 'dfseo') return 'dataforseo';
  if (raw === 'both' || raw === 'all' || raw === 'ke+dfs' || raw === 'dfs+ke') return 'both';
  return 'ke';
}

async function insertChunks(supabase, rows) {
  const size = 250;
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error } = await supabase.from('dfs_domain_backlink_rows').insert(slice);
    if (error && !String(error.message || '').includes('does not exist')) throw error;
    n += slice.length;
  }
  return n;
}

async function upsertChunks(supabase, rows) {
  const size = 250;
  let n = 0;
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const { error } = await supabase.from('dfs_domain_backlink_rows').upsert(slice, {
      onConflict: 'row_hash'
    });
    if (error && !String(error.message || '').includes('does not exist')) throw error;
    n += slice.length;
  }
  return n;
}

async function readState(supabase, domainHost) {
  const { data, error } = await supabase
    .from('dfs_backlink_ingest_state')
    .select('*')
    .eq('domain_host', domainHost)
    .maybeSingle();
  if (error && !String(error.message || '').includes('does not exist')) throw error;
  return data || null;
}

async function writeState(supabase, row) {
  const { error } = await supabase.from('dfs_backlink_ingest_state').upsert(
    { ...row, updated_at: new Date().toISOString() },
    { onConflict: 'domain_host' }
  );
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

async function countRows(supabase, domainHost) {
  const { count, error } = await supabase
    .from('dfs_domain_backlink_rows')
    .select('*', { count: 'exact', head: true })
    .eq('domain_host', domainHost);
  if (error && !String(error.message || '').includes('does not exist')) {
    throw new Error(String(error.message || error));
  }
  return count != null ? count : 0;
}

function throwIfSupabaseErr(err, label) {
  if (!err) return;
  if (String(err.message || '').includes('does not exist')) return;
  throw new Error(`${label}: ${String(err.message || err)}`);
}

async function handleDomainStatus(supabase, domainHost, src) {
  const st = await readState(supabase, domainHost);
  const cnt = await countRows(supabase, domainHost);
  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        domain: domainHost,
        rowCount: cnt,
        state: st,
        filtersVersion: DFS_SPAM_FILTERS_VERSION,
        backlinkIndexSource: src
      },
      meta: { generatedAt: new Date().toISOString() }
    }
  };
}

async function handleDomainFull(supabase, creds, domainHost, src) {
  const runId = randomUUID();
  const { rows, pages, totalCost, maxFirstSeen, truncated, itemsFromApi } = await paginateDomainBacklinks(
    creds,
    domainHost,
    filtersFullSpamOnly(),
    runId
  );
  if (!rows.length && itemsFromApi > 0) {
    return {
      status: 422,
      body: {
        status: 'error',
        message: `DataForSEO returned ${itemsFromApi} item(s) but none mapped to rows (url/anchor field mismatch). Your Supabase index was not cleared.`
      }
    };
  }

  const { error: delErr } = await supabase.from('dfs_domain_backlink_rows').delete().eq('domain_host', domainHost);
  throwIfSupabaseErr(delErr, 'delete_domain_rows');
  await insertChunks(supabase, rows);

  const cnt = await countRows(supabase, domainHost);
  const floor = maxFirstSeen || new Date().toISOString();
  await writeState(supabase, {
    domain_host: domainHost,
    last_full_at: new Date().toISOString(),
    last_delta_at: null,
    delta_first_seen_floor: floor,
    filters_version: DFS_SPAM_FILTERS_VERSION,
    last_full_run_id: runId,
    last_delta_run_id: null,
    approx_row_count: cnt
  });

  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        domain: domainHost,
        action: 'full',
        rowsWritten: rows.length,
        itemsFromApi,
        rowCount: cnt,
        pagesFetched: pages,
        approxCost: Number(totalCost.toFixed(6)),
        truncated,
        runId,
        deltaFirstSeenFloor: floor,
        filtersVersion: DFS_SPAM_FILTERS_VERSION,
        backlinkIndexSource: src
      },
      meta: { generatedAt: new Date().toISOString() }
    }
  };
}

async function handleDomainDelta(supabase, creds, domainHost, src) {
  const st = await readState(supabase, domainHost);
  if (!st?.delta_first_seen_floor) {
    return {
      status: 400,
      body: {
        status: 'error',
        message: 'Run a full domain ingest first (action=full) so the first_seen cursor exists.'
      }
    };
  }
  const filters = filtersDeltaAfter(st.delta_first_seen_floor);
  if (!filters) {
    return { status: 400, body: { status: 'error', message: 'Invalid delta_first_seen_floor in state.' } };
  }
  const runId = randomUUID();
  const { rows, pages, totalCost, maxFirstSeen, truncated, itemsFromApi } = await paginateDomainBacklinks(
    creds,
    domainHost,
    filters,
    runId
  );
  if (!rows.length && itemsFromApi > 0) {
    return {
      status: 422,
      body: {
        status: 'error',
        message: `DataForSEO returned ${itemsFromApi} item(s) but none mapped to rows (url/anchor field mismatch). No database changes.`
      }
    };
  }
  await upsertChunks(supabase, rows);

  const nextFloor =
    maxFirstSeen && maxFirstSeen > String(st.delta_first_seen_floor) ? maxFirstSeen : st.delta_first_seen_floor;

  const cnt = await countRows(supabase, domainHost);
  await writeState(supabase, {
    domain_host: domainHost,
    last_full_at: st.last_full_at,
    last_delta_at: new Date().toISOString(),
    delta_first_seen_floor: nextFloor,
    filters_version: DFS_SPAM_FILTERS_VERSION,
    last_full_run_id: st.last_full_run_id,
    last_delta_run_id: runId,
    approx_row_count: cnt
  });

  return {
    status: 200,
    body: {
      status: 'ok',
      data: {
        domain: domainHost,
        action: 'delta',
        rowsUpserted: rows.length,
        itemsFromApi,
        rowCount: cnt,
        pagesFetched: pages,
        approxCost: Number(totalCost.toFixed(6)),
        truncated,
        runId,
        deltaFirstSeenFloor: nextFloor,
        filtersVersion: DFS_SPAM_FILTERS_VERSION,
        backlinkIndexSource: src
      },
      meta: { generatedAt: new Date().toISOString() }
    }
  };
}

export async function runDomainBacklinkRoute(req) {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const body = req.method === 'POST' ? parseBody(req) : {};
  const action = String(body?.action || req.query?.action || 'status').toLowerCase();
  const domainRaw = body?.domain || req.query?.domain || '';
  const domainHost = normalizeDomainHost(domainRaw);
  const src = normalizeBacklinkIndexSource();
  const dfsOn = src === 'dataforseo' || src === 'both';

  if (!dfsOn) {
    return {
      status: 200,
      body: {
        status: 'ok',
        data: {
          skipped: true,
          reason: 'index_source_ke',
          backlinkIndexSource: src
        },
        meta: { generatedAt: new Date().toISOString() }
      }
    };
  }

  const creds = dfsIngestCreds();
  if (!creds) {
    return {
      status: 503,
      body: { status: 'error', message: 'DataForSEO credentials not configured.' }
    };
  }

  if (!domainHost) {
    return { status: 400, body: { status: 'error', message: 'Provide domain (e.g. alanranger.com).' } };
  }

  if (action === 'status') return handleDomainStatus(supabase, domainHost, src);
  if (action === 'full') return handleDomainFull(supabase, creds, domainHost, src);
  if (action === 'delta') return handleDomainDelta(supabase, creds, domainHost, src);

  return { status: 400, body: { status: 'error', message: 'Invalid action (use status, full, or delta).' } };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
  }
  try {
    const { status, body } = await runDomainBacklinkRoute(req);
    return sendJson(res, status, body);
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
