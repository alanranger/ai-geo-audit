// Full commercial gap-check (126) + Keywords Everywhere volume enrich → OUTBOX CSV.
// Window fixed: 2026-02-01 .. 2026-07-14 (matches prior RESPONSE).
// Usage: node scripts/gsc-gapcheck-ke-enrich.mjs

import { config as dotenvConfig } from 'dotenv';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROPERTY = 'https://www.alanranger.com';
const ROW_LIMIT = 25000;
const PAUSE_MS = 150;
const MIN_IMPRESSIONS = 300;
const START = '2026-02-01';
const END = '2026-07-14';
const KE_URL = 'https://api.keywordseverywhere.com/v1/get_keyword_data';
const OUTBOX =
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/gapcheck-6month-candidates-with-KE-volume.csv';

const COMMERCIAL_PATTERNS = [
  'course', 'workshop', 'class', 'lesson', 'tuition', 'tutor', 'hire',
  'photographer', 'near me', 'gift voucher', 'mentoring', 'mentor',
  'training', 'academy', 'experience gift',
];
const INFO_EXCLUDES = [
  'for photographers', 'tips', 'how to', 'what is', 'raw vs jpeg', 'backup',
];

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env var ${k}`);
  return v;
}

function normQuery(q) {
  return String(q || '').trim().toLowerCase();
}

function isCommercialQuery(q) {
  const low = q.toLowerCase();
  if (INFO_EXCLUDES.some((x) => low.includes(x))) return false;
  return COMMERCIAL_PATTERNS.some((p) => low.includes(p));
}

function parseCsvKeywords(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!started) {
      started = true;
      const low = t.toLowerCase();
      if (low === 'keyword' || low.startsWith('keyword,')) continue;
    }
    const m = t.match(/^"([^"]+)"|^([^,]+)/);
    const kw = (m?.[1] || m?.[2] || '').trim();
    if (kw) out.push(kw);
  }
  return out;
}

function loadTrackedKeywords() {
  const p = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv');
  if (!existsSync(p)) throw new Error('missing LOCKED-v3.csv');
  return parseCsvKeywords(readFileSync(p, 'utf8'));
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function fetchQueryRows(token) {
  const all = [];
  let startRow = 0;
  for (;;) {
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
    const body = {
      startDate: START,
      endDate: END,
      dimensions: ['query'],
      rowLimit: ROW_LIMIT,
      startRow,
      dataState: 'final',
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`searchAnalytics ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const j = await r.json();
    const batch = j.rows || [];
    for (const row of batch) {
      all.push({
        query: row.keys[0],
        clicks: Math.trunc(row.clicks ?? 0),
        impressions: Math.trunc(row.impressions ?? 0),
      });
    }
    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
    await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  return all;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function csvEscape(v) {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function fetchKeMap(keywords) {
  const apiKey = requireEnv('KEYWORDS_EVERYWHERE_API_KEY');
  const country = 'gb';
  const currency = 'GBP';
  const map = new Map();
  for (const batch of chunk(keywords, 100)) {
    const form = new URLSearchParams();
    form.set('country', country);
    form.set('currency', currency);
    form.set('dataSource', 'gkp');
    batch.forEach((kw) => form.append('kw[]', kw));
    const res = await fetch(KE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        Authorization: `Bearer ${apiKey}`,
      },
      body: form.toString(),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) throw new Error(`KE ${res.status}: ${(json.message || text).toString().slice(0, 300)}`);
    const items = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
    for (const item of items) {
      const kw = String(item.keyword || item.kw || '').trim();
      if (!kw) continue;
      const vol = item.vol ?? item.volume ?? item.search_volume ?? item.searchVolume;
      const cpc = item.cpc?.value ?? item.cpc ?? item.CPC ?? null;
      const comp = item.competition ?? item.comp ?? null;
      map.set(kw.toLowerCase(), {
        volume: vol == null || vol === '' ? null : Number(vol),
        cpc: cpc == null || cpc === '' ? null : Number(cpc),
        competition: comp == null || comp === '' ? null : Number(comp),
      });
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  return map;
}

async function main() {
  const tracked = loadTrackedKeywords();
  const trackedSet = new Set(tracked.map(normQuery));
  console.error(`Tracked: ${tracked.length}; window ${START}..${END}`);

  const token = await getAccessToken();
  const rows = await fetchQueryRows(token);
  console.error(`GSC rows: ${rows.length}`);

  const candidates = [];
  for (const row of rows) {
    if (trackedSet.has(normQuery(row.query))) continue;
    if (row.impressions < MIN_IMPRESSIONS) continue;
    if (!isCommercialQuery(row.query)) continue;
    candidates.push(row);
  }
  candidates.sort((a, b) => b.impressions - a.impressions);
  console.error(`Candidates: ${candidates.length}`);

  const keMap = await fetchKeMap(candidates.map((c) => c.query));
  console.error(`KE map size: ${keMap.size}`);

  const enriched = candidates.map((c) => {
    const ke = keMap.get(normQuery(c.query)) || {};
    return {
      query: c.query,
      gsc_impressions: c.impressions,
      gsc_clicks: c.clicks,
      ke_volume: Number.isFinite(ke.volume) ? ke.volume : null,
      ke_cpc: Number.isFinite(ke.cpc) ? ke.cpc : null,
      ke_competition: Number.isFinite(ke.competition) ? ke.competition : null,
    };
  });

  enriched.sort((a, b) => {
    const av = a.ke_volume;
    const bv = b.ke_volume;
    if (av != null && bv != null && bv !== av) return bv - av;
    if (av != null && bv == null) return -1;
    if (av == null && bv != null) return 1;
    return b.gsc_impressions - a.gsc_impressions;
  });

  const header = 'query,gsc_impressions,gsc_clicks,ke_volume,ke_cpc,ke_competition';
  const lines = [header, ...enriched.map((r) =>
    [r.query, r.gsc_impressions, r.gsc_clicks, r.ke_volume ?? '', r.ke_cpc ?? '', r.ke_competition ?? '']
      .map(csvEscape)
      .join(',')
  )];
  writeFileSync(OUTBOX, lines.join('\n') + '\n', 'utf8');

  const withVol = enriched.filter((r) => r.ke_volume != null).length;
  const blank = enriched.length - withVol;
  console.log(JSON.stringify({
    ok: true,
    rows: enriched.length,
    ke_with_volume: withVol,
    ke_blank: blank,
    csv: OUTBOX,
    ke_params: { country: 'gb', currency: 'GBP', dataSource: 'gkp', endpoint: 'get_keyword_data' },
    window: { start: START, end: END },
  }, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
