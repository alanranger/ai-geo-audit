/**
 * Regression test: KE get_page_backlinks for alanranger apex — bare host often returns 0 rows; www works.
 * Uses repo .env / .env.local (no CLI secrets). Exit 1 on failure.
 */
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });

const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing KEYWORDS_EVERYWHERE_API_KEY (.env.local)');
  process.exit(2);
}

const BASE = 'https://api.keywordseverywhere.com/v1';

function normalizeDomainHost(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

/** Same as api/aigeo/keyword-target-metrics.js */
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
    json = {};
  }
  return { ok: res.ok, status: res.status, json };
}

function extractItems(j) {
  const d = j?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') return Object.values(d);
  return [];
}

async function countPageBl(page) {
  const { ok, status, json } = await postForm(`${BASE}/get_page_backlinks`, {
    page,
    country: 'uk',
    num: 25
  });
  if (!ok) {
    throw new Error(`get_page_backlinks ${page} HTTP ${status}: ${json?.message || json?.error || 'fail'}`);
  }
  return extractItems(json).length;
}

const domain = 'alanranger.com';
const naked = 'https://alanranger.com/';
const www = 'https://www.alanranger.com/';
const pref = kePreferredFetchUrl(naked, domain);

const a = await countPageBl(naked);
const b = await countPageBl(www);
const c = await countPageBl(pref);

console.log(JSON.stringify({ nakedRows: a, wwwRows: b, preferredUrl: pref, preferredRows: c }, null, 2));

if (b < 1) {
  console.error('FAIL: www apex should return >0 backlink rows');
  process.exit(1);
}
if (pref !== www) {
  console.error('FAIL: kePreferredFetchUrl(naked) should equal www URL', { pref, www });
  process.exit(1);
}
if (c !== b) {
  console.error('FAIL: preferred URL row count should match www', { c, b });
  process.exit(1);
}

console.log('OK');
