/**
 * Smoke test: Google Search Console URL Inspection (index status) for a few URLs.
 * Uses the same OAuth env vars as api/fetch-search-console.js.
 *
 * Requires in .env.local (or env): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * Optional: GSC_PROPERTY_URL (e.g. https://www.example.com/ or sc-domain:example.com)
 *
 * From repo root:
 *   npm run smoke:gsc-inspect
 *   node scripts/gsc-url-inspection-smoke.mjs --site=https://www.alanranger.com/ "https://www.alanranger.com/some-page"
 *   node scripts/gsc-url-inspection-smoke.mjs --csv=../alan-shared-resources/csv/06-site-urls.csv --out=generated/gsc-inspection-06.jsonl
 *   node scripts/gsc-url-inspection-smoke.mjs --csv=... --out=generated/gsc-inspection-06.jsonl --skip-out=generated/gsc-inspection-06.jsonl
 *     (resume: do not re-inspect URLs already present in the JSONL)
 *
 * API: POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 */

import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve as pathResolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: join(__dirname, '..', '.env'), override: true });

const DEFAULT_SITE = process.env.GSC_PROPERTY_URL || 'https://www.alanranger.com/';
const DEFAULT_URLS = [
  'https://www.alanranger.com/',
  'https://www.alanranger.com/blog-on-photography/best-way-to-learn-photography-2026',
  'https://www.alanranger.com/photography-courses',
  'https://www.alanranger.com/online-photography-course-free',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeGscSiteUrl(raw) {
  const s = (raw || '').trim();
  if (!s) throw new Error('GSC site URL is empty (set GSC_PROPERTY_URL or --site=)');
  if (s.startsWith('sc-domain:')) return s;
  let u = s;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  return `${u}/`;
}

function parseArgs(argv) {
  let site = '';
  let delayMs = 700;
  let csvPath = '';
  let limit = 0;
  let outPath = '';
  let skipOutPath = '';
  const urls = [];
  for (const a of argv) {
    if (a.startsWith('--site=')) site = a.slice(7);
    else if (a.startsWith('--delay=')) delayMs = Math.max(0, Number.parseInt(a.slice(8), 10) || 700);
    else if (a.startsWith('--csv=')) csvPath = a.slice(6);
    else if (a.startsWith('--limit=')) limit = Math.max(0, Number.parseInt(a.slice(8), 10) || 0);
    else if (a.startsWith('--out=')) outPath = a.slice(6);
    else if (a.startsWith('--skip-out=')) skipOutPath = a.slice(11);
    else if (!a.startsWith('--')) urls.push(a);
  }
  return { site: site || DEFAULT_SITE, delayMs, csvPath, limit, outPath, skipOutPath, positionalUrls: urls };
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

function resolveUrlList({ csvPath, limit, positionalUrls }) {
  if (csvPath) {
    const list = loadUrlsFromCsv(csvPath, limit);
    if (!list.length) throw new Error(`No URLs loaded from CSV: ${csvPath}`);
    return list;
  }
  if (positionalUrls.length) return positionalUrls;
  return limit > 0 ? DEFAULT_URLS.slice(0, limit) : DEFAULT_URLS;
}

function loadUrlsAlreadyInJsonl(filePath) {
  if (!filePath || !existsSync(filePath)) return new Set();
  const text = readFileSync(filePath, 'utf-8');
  const seen = new Set();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o.inspectionUrl) seen.add(o.inspectionUrl);
    } catch {
      /* ignore bad line */
    }
  }
  return seen;
}

function pathResolveEq(a, b) {
  return pathResolve(process.cwd(), a) === pathResolve(process.cwd(), b);
}

async function getAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN (same as fetch-search-console)'
    );
  }
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Token refresh failed: ${tokenResponse.status} ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

function pickIndexSummary(body) {
  const idx = body?.inspectionResult?.indexStatusResult;
  if (!idx) {
    return { error: 'no inspectionResult.indexStatusResult', rawKeys: body ? Object.keys(body) : [] };
  }
  return {
    verdict: idx.verdict ?? null,
    coverageState: idx.coverageState ?? null,
    pageFetchState: idx.pageFetchState ?? null,
    googleCanonical: idx.googleCanonical ?? null,
    referringUrls: Array.isArray(idx.referringUrls) ? idx.referringUrls.slice(0, 3) : undefined,
  };
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
    json = { parseError: true, text: text.slice(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let urls = resolveUrlList(opts);
  const siteUrl = normalizeGscSiteUrl(opts.site);
  const { delayMs, outPath, skipOutPath } = opts;
  const skipSet = loadUrlsAlreadyInJsonl(skipOutPath);
  if (skipSet.size) {
    const before = urls.length;
    urls = urls.filter((u) => !skipSet.has(u));
    console.log(`skip-out: ${skipSet.size} URL(s) on disk, ${before - urls.length} skipped, ${urls.length} to run`);
  }
  if (!urls.length) {
    console.log('Nothing to inspect (all URLs already in skip-out file or empty list).');
    return;
  }

  console.log('GSC URL Inspection smoke');
  console.log('siteUrl (property):', siteUrl);
  console.log('URLs:', urls.length);
  if (outPath) {
    const dir = dirname(outPath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    const resumeSameFile =
      skipOutPath && outPath && pathResolveEq(skipOutPath, outPath) && skipSet.size > 0;
    if (!resumeSameFile) writeFileSync(outPath, '', 'utf-8');
    console.log('out:', outPath, resumeSameFile ? '(append resume)' : '(fresh)');
  }
  console.log('---');

  const accessToken = await getAccessToken();

  for (let i = 0; i < urls.length; i++) {
    const inspectionUrl = urls[i];
    const { ok, status, json } = await inspectOne(accessToken, siteUrl, inspectionUrl);
    const summary = ok ? pickIndexSummary(json) : { httpStatus: status, error: json };
    const line = JSON.stringify({ inspectionUrl, ok, summary });
    console.log(line);
    if (outPath) appendFileSync(outPath, `${line}\n`, 'utf-8');

    if (!ok && json?.error) {
      console.error('API error detail:', json.error);
    }

    if (i < urls.length - 1) await sleep(delayMs);
  }

  console.log('---');
  console.log('Done. If siteUrl is wrong for your property, pass --site= exactly as in Search Console (URL-prefix needs trailing /).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
