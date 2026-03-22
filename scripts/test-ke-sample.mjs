/**
 * Keywords Everywhere smoke test — mirrors dashboard columns (Est. traf, SERP, Pg bl, URL traf, Kw vol).
 *
 * Usage (repo root, PowerShell):
 *   $env:KEYWORDS_EVERYWHERE_API_KEY = "your-key"
 *   npm run test:ke
 *   node scripts/test-ke-sample.mjs --url=https://www.alanranger.com/ --kw="alan ranger photography"
 *
 * Optional:
 *   --country=gb   (URL routes use uk when gb — same as api/aigeo/keyword-target-metrics.js)
 *   --domain=alanranger.com
 *   --save-json=./tmp-ke   (writes one JSON file per endpoint+url-variant; no secrets logged beyond API responses)
 *
 * Why not only Supabase logging? A local run gives ground truth in one command without a migration,
 * deploy, or filling a table with large third-party payloads. Use this first; add DB snapshots only if you need production history.
 *
 * Loads env from repo root: `.env` then `.env.local`.
 */
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });

const BASE = 'https://api.keywordseverywhere.com/v1';

const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
if (!apiKey) {
  console.error(
    'Missing KEYWORDS_EVERYWHERE_API_KEY. Example (PowerShell): $env:KEYWORDS_EVERYWHERE_API_KEY="..."; node scripts/test-ke-sample.mjs'
  );
  process.exit(1);
}

function argVal(prefix, fallback) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

/** Match api/aigeo/keyword-target-metrics.js — KE often rejects www / odd URLs. */
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

const sampleUrlRaw = argVal('--url=', 'https://www.alanranger.com/');
const sampleUrlNorm = normalizePageUrl(sampleUrlRaw) || sampleUrlRaw;
const sampleKw = argVal('--kw=', 'alan ranger photography');
const sampleKwAlt = argVal('--kw-alt=', 'Alan Ranger Photography');
const domain = argVal('--domain=', 'alanranger.com');
const country = argVal('--country=', 'gb');
const saveJsonDir = argVal('--save-json=', '');
/** Keyword volume uses `gb` for UK; URL traffic / URL keywords require `uk` (KE rejects `gb` there). */
const kwCountry = country === 'uk' ? 'gb' : country;
const urlCountry = country === 'gb' ? 'uk' : country;

async function postJson(path, jsonBody) {
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
    json = { _parseError: true, text: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

async function postForm(path, params) {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) body.set(k, String(v));
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
    json = { _parseError: true, text: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

function summarize(label, { ok, status, json }) {
  const keys = json && typeof json === 'object' ? Object.keys(json).slice(0, 12) : [];
  console.log(`\n${label}: HTTP ${status} ${ok ? 'ok' : 'fail'} keys=[${keys.join(', ')}]`);
  if (!ok) {
    console.log('  message:', json?.message || json?.error || String(json).slice(0, 300));
    if (json?.description) console.log('  description:', String(json.description).slice(0, 500));
  }
}

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

/** Same idea as api/aigeo/keyword-target-metrics.js kePreferredFetchUrl */
function kePreferredFetchUrl(rawUrl, propertyDomainHost) {
  const s = String(rawUrl || '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return s;
  const prop = normalizeDomainHost(propertyDomainHost || '');
  if (!prop) return s;
  try {
    const u = new URL(s);
    const h = u.hostname.toLowerCase();
    const bare = h.replace(/^www\./, '');
    if (bare !== prop) return s;
    if (h.startsWith('www.')) return s;
    return `${u.protocol}//www.${bare}${u.pathname || '/'}${u.search}`;
  } catch {
    return s;
  }
}

function extractKeItems(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data);
  return [];
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

function estimatedTrafficFromUrlKeywordRow(row) {
  const v =
    row?.estimated_monthly_traffic ??
    row?.estimatedTraffic ??
    row?.monthly_traffic ??
    row?.organic_traffic ??
    row?.traffic ??
    row?.estimated_visits;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function serpPositionFromUrlKeywordRow(row) {
  const v =
    row?.serp_position ??
    row?.position ??
    row?.rank ??
    row?.google_position ??
    row?.avg_position ??
    row?.average_position;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function urlTrafficFromKeRow(row) {
  const v =
    row?.estimated_monthly_traffic ??
    row?.estimatedTraffic ??
    row?.monthly_traffic ??
    row?.organic_traffic ??
    row?.traffic;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function maybeSaveJson(label, body) {
  if (!saveJsonDir) return;
  const safe = label.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 120);
  const dir = resolve(repoRoot, saveJsonDir);
  await mkdir(dir, { recursive: true });
  const fp = resolve(dir, `${safe}.json`);
  await writeFile(fp, JSON.stringify(body, null, 2), 'utf8');
  console.log(`  saved: ${fp}`);
}

function numericLeaves(obj, maxKeys = 40) {
  const out = [];
  const walk = (o, prefix, depth) => {
    if (out.length >= maxKeys || depth > 4 || o == null) return;
    if (Array.isArray(o)) {
      out.push(`${prefix}[] len=${o.length}`);
      return;
    }
    if (typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.push(`${p}=${v}`);
      } else if (typeof v === 'string' && /^\d+$/.test(v)) {
        out.push(`${p}="${v}"`);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, p, depth + 1);
      }
    }
  };
  walk(obj, '', 0);
  return out;
}

async function main() {
  const urlVariants = [];
  const seen = new Set();
  const add = (u) => {
    const s = String(u || '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      urlVariants.push(s);
    }
  };
  add(sampleUrlRaw);
  add(sampleUrlNorm);
  add(kePreferredFetchUrl(sampleUrlRaw, domain));
  add(kePreferredFetchUrl(sampleUrlNorm, domain));

  console.log('KE sample:', {
    sampleUrlRaw,
    sampleUrlNorm,
    urlVariants,
    sampleKw,
    sampleKwAlt,
    domain,
    country,
    kwCountry,
    urlCountry,
    saveJsonDir: saveJsonDir || '(none)'
  });

  const kwForm = new URLSearchParams();
  kwForm.set('country', kwCountry);
  kwForm.set('currency', 'GBP');
  kwForm.set('dataSource', 'gkp');
  kwForm.append('kw[]', sampleKw);
  kwForm.append('kw[]', sampleKwAlt);
  const kwRes = await fetch(`${BASE}/get_keyword_data`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Authorization: `Bearer ${apiKey}`
    },
    body: kwForm.toString()
  });
  const kwText = await kwRes.text();
  let kwJson = {};
  try {
    kwJson = kwText ? JSON.parse(kwText) : {};
  } catch {
    kwJson = { _parseError: true };
  }
  summarize('get_keyword_data', { ok: kwRes.ok, status: kwRes.status, json: kwJson });
  await maybeSaveJson('get_keyword_data', { status: kwRes.status, ok: kwRes.ok, json: kwJson });
  const volItems = extractKeItems(kwJson);
  console.log('\n--- Kw vol (from get_keyword_data rows) ---');
  volItems.forEach((it, i) => {
    const k = it?.keyword || it?.kw || it?.term || '';
    const vol = it?.vol ?? it?.volume ?? it?.search_volume;
    console.log(`  [${i}] keyword=${JSON.stringify(k)} vol=${vol}`);
  });

  for (let vi = 0; vi < urlVariants.length; vi += 1) {
    const u = urlVariants[vi];
    const tag = `variant_${vi}_${u.replace(/^https?:\/\//i, '').replace(/[^\w.-]+/g, '_')}`;

    const traffic = await postJson(`${BASE}/get_url_traffic_metrics`, {
      urls: [u],
      country: urlCountry
    });
    summarize(`get_url_traffic_metrics (${u})`, traffic);
    await maybeSaveJson(`${tag}_url_traffic`, { url: u, ...traffic });
    const tRows = extractKeItems(traffic.json);
    const urlTraf = tRows.length ? urlTrafficFromKeRow(tRows[0]) : null;
    console.log(`  → URL traf (derived): ${urlTraf != null ? urlTraf : '—'}`);

    const urlKw = await postForm(`${BASE}/get_url_keywords`, {
      url: u,
      country: urlCountry,
      num: 60
    });
    summarize(`get_url_keywords (${u})`, urlKw);
    await maybeSaveJson(`${tag}_url_keywords`, { url: u, ...urlKw });
    const kwRows = extractKeItems(urlKw.json);
    const hit = findUrlKeywordRow(kwRows, sampleKw);
    const est = hit ? estimatedTrafficFromUrlKeywordRow(hit) : null;
    const serp = hit ? serpPositionFromUrlKeywordRow(hit) : null;
    console.log(`  → url-keyword rows: ${kwRows.length}; match for "${sampleKw}": ${hit ? 'yes' : 'no'}`);
    if (hit) {
      console.log(`     matched keyword field: ${JSON.stringify(hit.keyword || hit.kw || '')}`);
      console.log(`     → Est. traf (derived): ${est != null ? est : '—'}  SERP (derived): ${serp != null ? serp : '—'}`);
    } else if (kwRows.length) {
      console.log('     first 5 KE keywords:', kwRows.slice(0, 5).map((r) => r?.keyword || r?.kw || '').join(' | '));
    }

    const pbl = await postForm(`${BASE}/get_page_backlinks`, {
      page: u,
      num: 25
    });
    summarize(`get_page_backlinks (${u})`, pbl);
    await maybeSaveJson(`${tag}_page_backlinks`, { url: u, ...pbl });
    const pblRows = extractKeItems(pbl.json);
    console.log(`  → Pg bl sample rows (derived count): ${Array.isArray(pblRows) ? pblRows.length : '—'}`);
  }

  const dom = await postForm(`${BASE}/get_unique_domain_backlinks`, {
    domain,
    num: 15
  });
  summarize('get_unique_domain_backlinks', dom);
  if (dom.ok && dom.json?.data && Array.isArray(dom.json.data)) {
    console.log('  data row count:', dom.json.data.length);
    console.log('  numeric-ish top-level (non-array):', numericLeaves(dom.json).slice(0, 25).join('\n    ') || '(none)');
  }

  const domAll = await postForm(`${BASE}/get_domain_backlinks`, {
    domain,
    num: 1
  });
  summarize('get_domain_backlinks (num=1)', domAll);
  if (domAll.ok && domAll.json && typeof domAll.json === 'object') {
    console.log('  numeric-ish fields:', numericLeaves(domAll.json).slice(0, 35).join('\n    ') || '(none)');
    if (Array.isArray(domAll.json.data)) console.log('  data row count:', domAll.json.data.length);
  }

  const domAll15 = await postForm(`${BASE}/get_domain_backlinks`, {
    domain,
    num: 15
  });
  summarize('get_domain_backlinks (num=15)', domAll15);
  if (domAll15.ok && domAll15.json && typeof domAll15.json === 'object') {
    console.log('  numeric-ish fields:', numericLeaves(domAll15.json).slice(0, 35).join('\n    ') || '(none)');
    if (Array.isArray(domAll15.json.data)) console.log('  data row count:', domAll15.json.data.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
