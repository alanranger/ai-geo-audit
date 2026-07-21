export const config = { runtime: 'nodejs' };

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { normalizePropertyKey, signalMapKey } from './lib/gscInspectKeys.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCH_PATH = path.join(ROOT, 'config/ws3-recrawl-watch-urls.json');

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function loadWatchConfig() {
  const raw = JSON.parse(fs.readFileSync(WATCH_PATH, 'utf8'));
  return {
    label: String(raw.label || 'WS3 recrawl watch'),
    indexedRequestedAt: String(raw.indexedRequestedAt || ''),
    urls: Array.isArray(raw.urls) ? raw.urls : []
  };
}

function mergeWatchRow(entry, cacheByKey, propertyUrl) {
  const pageUrl = signalMapKey(entry.path, propertyUrl);
  const hit = cacheByKey.get(pageUrl) || null;
  return {
    path: entry.path,
    group: entry.group || '',
    pageUrl,
    indexed: hit?.indexed ?? null,
    coverageState: hit?.coverage_state || hit?.coverageState || '',
    verdict: hit?.verdict || '',
    pageFetchState: hit?.page_fetch_state || hit?.pageFetchState || '',
    googleCanonical: hit?.google_canonical || hit?.googleCanonical || '',
    inspectedAt: hit?.inspected_at || hit?.inspectedAt || null,
    inspectionResultLink: hit?.inspect_result_link || hit?.inspectionResultLink || null,
    cacheStatus: hit ? 'cached' : 'missing'
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed.' });
  }
  try {
    const propertyUrl = String(req.query.propertyUrl || 'https://www.alanranger.com').trim();
    const propertyKey = normalizePropertyKey(propertyUrl);
    const watch = loadWatchConfig();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await supabase
      .from('gsc_url_inspection_cache')
      .select(
        'url_key,page_url,coverage_state,verdict,page_fetch_state,google_canonical,indexed,inspect_result_link,inspected_at'
      )
      .eq('property_key', propertyKey);
    if (error) throw error;
    const cacheByKey = new Map();
    for (const row of data || []) {
      cacheByKey.set(String(row.url_key || ''), row);
      cacheByKey.set(String(row.page_url || ''), row);
    }
    const rows = watch.urls.map((entry) => mergeWatchRow(entry, cacheByKey, propertyUrl));
    const cached = rows.filter((r) => r.cacheStatus === 'cached').length;
    const { data: cronRow } = await supabase
      .from('audit_cron_schedule')
      .select('last_run_at,last_status,last_error')
      .eq('job_key', 'ws3_recrawl_gsc_inspection')
      .maybeSingle();
    const lastAutoRefreshAt = cronRow?.last_run_at || null;
    const staleDays = 8;
    const staleMs = staleDays * 24 * 60 * 60 * 1000;
    const autoRefreshStale = lastAutoRefreshAt
      ? Date.now() - Date.parse(String(lastAutoRefreshAt)) > staleMs
      : true;
    return sendJson(res, 200, {
      status: 'ok',
      propertyUrl,
      propertyKey,
      label: watch.label,
      indexedRequestedAt: watch.indexedRequestedAt,
      lastAutoRefreshAt,
      autoRefreshSchedule: 'Sun 23:00 Europe/London',
      autoRefreshStale,
      autoRefreshStaleDays: staleDays,
      lastAutoRefreshStatus: cronRow?.last_status || null,
      quotaNote: 'Live inspect quota ~600/day; dashboard Refresh GSC URL Inspection batches 5/request with ~8s spacing.',
      summary: {
        total: rows.length,
        cached,
        missing: rows.length - cached,
        indexedYes: rows.filter((r) => r.indexed === true).length
      },
      rows,
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('missing_env:')) {
      return sendJson(res, 500, { status: 'error', message: 'Supabase env not configured.' });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
