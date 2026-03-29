/**
 * Read URLs from 06-site-urls.csv, URL-inspect via GSC, upsert gsc_url_inspection_cache.
 *
 * Env (.env.local): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GSC_PROPERTY_URL (or --site=)
 * Optional: GSC_06_CSV_PATH (default: sibling ../alan-shared-resources/csv/06-site-urls.csv)
 *
 *   npm run ingest:gsc-06
 *   node scripts/gsc-06-backfill-supabase.mjs --csv=path/to/06-site-urls.csv --limit=24
 *   node scripts/gsc-06-backfill-supabase.mjs --dry-run --limit=3
 */

import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { deriveGscUrlIndexedStatus } from '../api/aigeo/lib/gscInspectAuditStatus.js';
import { normalizePropertyKey, signalMapKey } from '../api/aigeo/lib/gscInspectKeys.js';
import { normalizeSupabaseServiceRoleKey } from '../api/aigeo/lib/normalizeSupabaseServiceRoleKey.js';
import {
  isGscInspectPermissionDenied,
  normalizeSiteUrlForInspect,
  resolveGscSiteUrlForInspect,
} from '../api/aigeo/lib/gscInspectSiteUrls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = normalizeSupabaseServiceRoleKey(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

const BATCH = 12;
const DELAY_MS = 280;
const DEFAULT_GSC_PROPERTY_URL = 'https://www.alanranger.com/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

async function getAccessToken() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
      refresh_token: need('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    const err = new Error(`token_refresh_failed:${tokenResponse.status}`);
    err.detail = tokenData;
    throw err;
  }
  return tokenData.access_token;
}

async function inspectOne(accessToken, siteUrl, inspectionUrl) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
      languageCode: 'en-GB',
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  const idx = json?.inspectionResult?.indexStatusResult;
  return {
    inspectionUrl,
    httpOk: res.ok,
    httpStatus: res.status,
    verdict: idx?.verdict ?? null,
    coverageState: idx?.coverageState ?? null,
    pageFetchState: idx?.pageFetchState ?? null,
    googleCanonical: idx?.googleCanonical ?? null,
    error: json?.error || (!res.ok ? json : null),
  };
}

function defaultCsvPath() {
  return join(__dirname, '..', '..', 'alan-shared-resources', 'csv', '06-site-urls.csv');
}

function parseArgs(argv) {
  let csvPath = '';
  let site = '';
  let limit = 0;
  let dryRun = false;
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a.startsWith('--csv=')) csvPath = a.slice(6);
    else if (a.startsWith('--site=')) site = a.slice(7);
    else if (a.startsWith('--limit=')) limit = Math.max(0, Number.parseInt(a.slice(8), 10) || 0);
  }
  return { csvPath, site, limit, dryRun };
}

function loadUrlsFromCsv(csvPath, limit) {
  const raw = readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  if (!records.length) return [];
  const key = Object.prototype.hasOwnProperty.call(records[0], 'url') ? 'url' : Object.keys(records[0])[0];
  const seen = new Set();
  const out = [];
  for (const row of records) {
    const u = (row[key] || '').trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (limit > 0 && out.length >= limit) break;
  }
  return out;
}

async function inspectBatch(accessToken, propertyUrl, urls, state) {
  let effectiveSiteUrl = state.effectiveSiteUrl || '';
  const results = [];
  for (let i = 0; i < urls.length; i += 1) {
    const inspectionUrl = urls[i];
    if (i > 0) await sleep(DELAY_MS);
    if (!effectiveSiteUrl) {
      const resolved = await resolveGscSiteUrlForInspect(
        accessToken,
        inspectOne,
        propertyUrl,
        inspectionUrl,
        120
      );
      effectiveSiteUrl = resolved.siteUrl;
      results.push(resolved.row);
      continue;
    }
    let row = await inspectOne(accessToken, effectiveSiteUrl, inspectionUrl);
    if (isGscInspectPermissionDenied(row)) {
      const resolved = await resolveGscSiteUrlForInspect(
        accessToken,
        inspectOne,
        propertyUrl,
        inspectionUrl,
        120
      );
      effectiveSiteUrl = resolved.siteUrl;
      row = resolved.row;
    }
    results.push(row);
  }
  state.effectiveSiteUrl = effectiveSiteUrl;
  return results;
}

function rowsForUpsert(propertyUrl, results) {
  const pk = normalizePropertyKey(propertyUrl);
  if (!pk || !Array.isArray(results) || !results.length) return [];
  const now = new Date().toISOString();
  return results.map((r) => {
    const pageUrl = String(r?.inspectionUrl || '').trim();
    const urlKey = signalMapKey(pageUrl, propertyUrl);
    const gsc = {
      verdict: r.verdict,
      coverageState: r.coverageState,
      pageFetchState: r.pageFetchState,
      googleCanonical: r.googleCanonical,
      httpOk: r.httpOk,
      apiError: r.error || null,
    };
    const audit_status = deriveGscUrlIndexedStatus(pageUrl, gsc);
    return {
      property_key: pk,
      url_key: urlKey,
      page_url: pageUrl,
      coverage_state: r.coverageState ?? null,
      verdict: r.verdict ?? null,
      page_fetch_state: r.pageFetchState ?? null,
      google_canonical: r.googleCanonical ?? null,
      http_ok: r.httpOk === true,
      api_error: r.error ?? null,
      audit_status,
      indexed: audit_status === 'pass',
      inspected_at: now,
      updated_at: now,
    };
  });
}

async function upsertInspectionCache(propertyUrl, results) {
  const url = need('SUPABASE_URL');
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  const rows = rowsForUpsert(propertyUrl, results);
  if (!rows.length) return;
  const supabase = createClient(url, key);
  const { error } = await supabase.from('gsc_url_inspection_cache').upsert(rows, {
    onConflict: 'property_key,url_key',
  });
  if (error) throw error;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const csvPath =
    (process.env.GSC_06_CSV_PATH || '').trim() || opts.csvPath || defaultCsvPath();
  if (!existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath} (set GSC_06_CSV_PATH or --csv=)`);
  }
  const propertyUrl = String(
    opts.site || process.env.GSC_PROPERTY_URL || DEFAULT_GSC_PROPERTY_URL
  ).trim();
  if (!propertyUrl) throw new Error('Set GSC_PROPERTY_URL or --site=');
  const siteUrlProbe = normalizeSiteUrlForInspect(propertyUrl);
  if (!siteUrlProbe) throw new Error('Invalid GSC property URL');

  const urls = loadUrlsFromCsv(csvPath, opts.limit);
  if (!urls.length) throw new Error(`No URLs loaded from ${csvPath}`);

  console.log('gsc-06-backfill-supabase');
  console.log('property:', propertyUrl);
  console.log('csv:', csvPath);
  console.log('urls:', urls.length, opts.dryRun ? '(dry-run)' : '');
  console.log('siteUrl probe:', siteUrlProbe);

  const accessToken = await getAccessToken();
  const state = { effectiveSiteUrl: '' };
  let done = 0;

  for (let off = 0; off < urls.length; off += BATCH) {
    const chunk = urls.slice(off, off + BATCH);
    const results = await inspectBatch(accessToken, propertyUrl, chunk, state);
    done += results.length;
    if (opts.dryRun) {
      console.log(`batch ${off / BATCH + 1}: ${results.length} rows (dry-run, no Supabase)`);
      for (const r of results) {
        const st = deriveGscUrlIndexedStatus(r.inspectionUrl, {
          verdict: r.verdict,
          coverageState: r.coverageState,
          pageFetchState: r.pageFetchState,
          googleCanonical: r.googleCanonical,
          httpOk: r.httpOk,
          apiError: r.error || null,
        });
        console.log(st, r.inspectionUrl, r.coverageState || r.error || '');
      }
    } else {
      await upsertInspectionCache(propertyUrl, results);
      console.log(`upserted ${results.length} (${done}/${urls.length}) siteUrl=${state.effectiveSiteUrl || siteUrlProbe}`);
    }
  }
  console.log('done.');
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
