/**
 * Minimal Keywords Everywhere smoke test (no secrets in repo).
 *
 * Usage (repo root, PowerShell):
 *   $env:KEYWORDS_EVERYWHERE_API_KEY = "your-key"
 *   node scripts/test-ke-sample.mjs
 *
 * Optional: --url=... --kw=... --domain=...
 *
 * Loads env from repo root: `.env` then `.env.local` (local overrides — same idea as Vercel).
 */
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
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
const sampleUrl = normalizePageUrl(sampleUrlRaw) || sampleUrlRaw;
const sampleKw = argVal('--kw=', 'photography courses');
const domain = argVal('--domain=', 'alanranger.com');
const country = argVal('--country=', 'gb');
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

async function main() {
  console.log('KE sample:', { sampleUrlRaw, sampleUrl, sampleKw, domain, country, kwCountry, urlCountry });

  const kwForm = new URLSearchParams();
  kwForm.set('country', kwCountry);
  kwForm.set('currency', 'GBP');
  kwForm.set('dataSource', 'gkp');
  kwForm.append('kw[]', sampleKw);
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

  const traffic = await postJson(`${BASE}/get_url_traffic_metrics`, {
    urls: [sampleUrl],
    country: urlCountry
  });
  summarize('get_url_traffic_metrics', traffic);

  const urlKw = await postForm(`${BASE}/get_url_keywords`, {
    url: sampleUrl,
    country: urlCountry,
    num: 20
  });
  summarize('get_url_keywords', urlKw);

  const pbl = await postForm(`${BASE}/get_page_backlinks`, {
    page: sampleUrl,
    num: 10
  });
  summarize('get_page_backlinks', pbl);

  const dom = await postForm(`${BASE}/get_unique_domain_backlinks`, {
    domain,
    num: 15
  });
  summarize('get_unique_domain_backlinks', dom);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
