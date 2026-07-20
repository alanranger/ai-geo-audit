/**
 * Fetch Keywords Everywhere UK volumes for hire-me/commercial candidate keywords.
 * Data only — no config changes.
 *
 * Usage: node scripts/fetch-ke-hire-me-candidate-volumes.mjs
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(root, '.env') });
loadEnv({ path: join(root, '.env.local'), override: true });

const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing KEYWORDS_EVERYWHERE_API_KEY');
  process.exit(1);
}

const GEOS = ['bare', 'coventry', 'near me', 'warwickshire', 'west midlands'];

const PAGES = [
  {
    page: '/property-photographer-coventry',
    bases: [
      'property photographer', 'property photography', 'estate agent photographer',
      'interior photographer', 'interior photography', 'real estate photographer',
      'airbnb photographer', 'holiday let photographer', 'hotel photographer',
      'commercial property photographer',
    ],
  },
  {
    page: '/professional-commercial-photographer-coventry',
    bases: [
      'product photographer', 'product photography', 'packshot photographer',
      'packshot photography', 'ecommerce photographer', 'ecommerce product photography',
      'commercial photographer', 'advertising photographer', 'food photographer', 'food photography',
    ],
  },
  {
    page: '/corporate-photography-training',
    bases: [
      'photography training for business', 'staff photography training',
      'in-house photography training', 'product photography training',
      'corporate photography training', 'business photography training',
    ],
  },
  {
    page: '/professional-photographer-near-me',
    bases: [
      'headshot photographer', 'business headshots', 'corporate headshots',
      'linkedin headshot photographer', 'linkedin headshots', 'team headshots',
      'professional headshots', 'graduation photographer', 'portrait photographer',
      'family portrait photographer',
    ],
  },
  {
    page: '/hire-a-professional-photographer-in-coventry',
    bases: [
      'hire a commercial photographer', 'hire a product photographer',
      'freelance photographer', 'local photographer', 'photographer for hire',
    ],
  },
];

function expand(base, geo) {
  if (geo === 'bare') return base;
  return `${base} ${geo}`;
}

function geoOf(keyword, base) {
  if (keyword === base) return 'bare';
  const rest = keyword.slice(base.length).trim();
  return rest || 'bare';
}

const rows = [];
for (const { page, bases } of PAGES) {
  for (const base of bases) {
    for (const geo of GEOS) {
      const keyword = expand(base, geo);
      rows.push({ keyword, page, base, geo: geoOf(keyword, base) });
    }
  }
}

console.log(`Prepared ${rows.length} keywords (expect 205)`);

const BASE_URL = 'https://api.keywordseverywhere.com/v1/get_keyword_data';
const BATCH = 100;

function extractItems(json) {
  const data = json?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data);
  return [];
}

async function fetchBatch(keywords) {
  const form = new URLSearchParams();
  form.set('country', 'gb'); // KE UK keyword volume (same as dashboard)
  form.set('currency', 'GBP');
  form.set('dataSource', 'gkp');
  keywords.forEach((kw) => form.append('kw[]', kw));
  const res = await fetch(BASE_URL, {
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
  try { json = text ? JSON.parse(text) : {}; } catch { json = { _parseError: true, text: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`KE ${res.status}: ${json?.message || json?.error || text.slice(0, 200)}`);
  const map = new Map();
  for (const item of extractItems(json)) {
    const k = String(item?.keyword || item?.kw || item?.term || '').toLowerCase().trim();
    if (!k) continue;
    map.set(k, {
      vol: item?.vol ?? item?.volume ?? item?.search_volume ?? null,
      cpc: item?.cpc?.value ?? item?.cpc ?? item?.cpc_value ?? null,
      competition: item?.competition ?? item?.comp ?? null,
      trend: item?.trend ?? item?.monthly_trend ?? null,
    });
  }
  const credits = json?.credits ?? json?.credits_used ?? json?.meta?.credits ?? null;
  return { map, credits, rawKeys: Object.keys(json || {}) };
}

const byKw = new Map();
let creditsNotes = [];
for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH).map((r) => r.keyword);
  console.log(`KE batch ${i / BATCH + 1}: ${slice.length} keywords`);
  const { map, credits } = await fetchBatch(slice);
  creditsNotes.push(credits);
  for (const [k, v] of map) byKw.set(k, v);
}

const out = rows.map((r) => {
  const hit = byKw.get(r.keyword.toLowerCase()) || {};
  const vol = hit.vol == null || hit.vol === '' ? null : Number(hit.vol);
  const cpc = hit.cpc == null || hit.cpc === '' ? null : Number(hit.cpc);
  const competition = hit.competition == null || hit.competition === '' ? null : Number(hit.competition);
  let flag = 'DROP';
  if (Number.isFinite(vol) && vol >= 50) flag = 'ADD candidate';
  else if (Number.isFinite(vol) && vol > 0) flag = 'LOW (review)';
  else flag = 'DROP (0 / null)';
  return {
    keyword: r.keyword,
    page: r.page,
    base: r.base,
    geo: r.geo,
    ke_volume: Number.isFinite(vol) ? vol : null,
    competition: Number.isFinite(competition) ? competition : null,
    cpc: Number.isFinite(cpc) ? cpc : null,
    flag,
    trend: hit.trend ?? null,
  };
});

// Per base: which geo carries demand
const baseBest = {};
for (const r of out) {
  const cur = baseBest[r.base];
  const v = r.ke_volume || 0;
  if (!cur || v > (cur.ke_volume || 0)) baseBest[r.base] = { geo: r.geo, ke_volume: r.ke_volume, keyword: r.keyword, page: r.page };
}

const outDir = join(root, 'scripts/output');
mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, 'ke-hire-me-candidate-volumes-2026-07-17.json');
const mdPath = 'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/KE-HIRE-ME-CANDIDATE-VOLUMES-2026-07-17-LATEST.md';

writeFileSync(jsonPath, JSON.stringify({
  fetched_at: new Date().toISOString(),
  source: 'Keywords Everywhere get_keyword_data',
  country: 'gb',
  currency: 'GBP',
  count: out.length,
  credits_notes: creditsNotes,
  base_best: baseBest,
  rows: out,
}, null, 2));

// Markdown table grouped by page, sorted by volume desc
const pages = [...new Set(out.map((r) => r.page))];
let md = `# KE search demand — hire-me/commercial candidates (2026-07-17)

Source: Keywords Everywhere \`get_keyword_data\` (country=gb, currency=GBP). **Not** Google Ads / DataForSEO.
Keywords: ${out.length}. Credits notes: ${JSON.stringify(creditsNotes)}.

Flag: **ADD candidate** = vol ≥ 50 · **LOW** = 1–49 · **DROP** = 0/null.

`;

for (const page of pages) {
  const list = out.filter((r) => r.page === page).sort((a, b) => (b.ke_volume || 0) - (a.ke_volume || 0));
  md += `\n## ${page}\n\n`;
  md += `| Keyword | Base term | Geo | KE volume | Competition | CPC | Flag |\n|---|---|---|---:|---:|---:|---|\n`;
  for (const r of list) {
    md += `| ${r.keyword} | ${r.base} | ${r.geo} | ${r.ke_volume ?? '—'} | ${r.competition ?? '—'} | ${r.cpc ?? '—'} | ${r.flag} |\n`;
  }
}

md += `\n## Best geo per base term\n\n| Base | Best keyword | Geo | KE volume | Page |\n|---|---|---|---:|---|\n`;
for (const base of Object.keys(baseBest).sort()) {
  const b = baseBest[base];
  md += `| ${base} | ${b.keyword} | ${b.geo} | ${b.ke_volume ?? '—'} | ${b.page} |\n`;
}

const add = out.filter((r) => r.flag === 'ADD candidate').length;
const low = out.filter((r) => r.flag === 'LOW (review)').length;
const drop = out.filter((r) => r.flag.startsWith('DROP')).length;
md += `\n## Summary\n\n- ADD candidate (≥50): **${add}**\n- LOW (1–49): **${low}**\n- DROP (0/null): **${drop}**\n`;

writeFileSync(mdPath, md);
console.log('WROTE', jsonPath);
console.log('WROTE', mdPath);
console.log({ add, low, drop, creditsNotes });
