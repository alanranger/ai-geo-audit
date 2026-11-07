/**
 * One-off: re-fetch 10 former top-1 keywords via DFS to verify organic drops.
 * No DB writes. Same location_code / tier as Ranking audit.
 */
import { config as dotenvConfig } from 'dotenv';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';

dotenvConfig({ path: '.env.local' });

const TARGET = 'alanranger.com';
const KEYWORDS = [
  { keyword: 'beginners photography classes coventry', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'beginners photography courses coventry', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'best photography classes', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'commercial photographer near me', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'free photography classes near me', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'landscape photography workshop', rank_21: 1, location_code: 2826, tier: 'N' },
  { keyword: 'landscape workshops', rank_21: 1, location_code: 2826, tier: 'N' },
  { keyword: 'photography classes', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'photography classes near me', rank_21: 1, location_code: 9215523, tier: 'L' },
  { keyword: 'photography gift card', rank_21: 1, location_code: 2826, tier: 'N' },
];

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS credentials in .env.local');
const auth = Buffer.from(`${login}:${password}`).toString('base64');

const results = [];
for (const row of KEYWORDS) {
  const t0 = Date.now();
  const serp = await fetchSerpForKeyword(row.keyword, auth, TARGET, 50, {
    location_code: row.location_code,
    tier: row.tier,
    expandAiOverview: false,
  });
  const organicOwners = [];
  const stack = Array.isArray(serp?.serp_surface_stack) ? serp.serp_surface_stack : [];
  for (const slot of stack) {
    if (slot?.type !== 'organic' || !Array.isArray(slot.owners)) continue;
    for (const o of slot.owners) {
      organicOwners.push({
        position: o.position ?? null,
        domain: o.domain || null,
        ours: !!o.ours,
      });
    }
  }
  const oursOrganic = organicOwners.filter((o) => o.ours || String(o.domain || '').includes('alanranger'));
  const topOrganic = organicOwners.slice(0, 5);
  const out = {
    keyword: row.keyword,
    rank_21: row.rank_21,
    tier: row.tier,
    location_code: row.location_code,
    ms: Date.now() - t0,
    error: serp?.error || null,
    best_rank_group: serp?.best_rank_group ?? null,
    best_rank_absolute: serp?.best_rank_absolute ?? null,
    best_url: serp?.best_url ? String(serp.best_url).slice(0, 90) : null,
    ours_in_organic_sample: oursOrganic.length > 0,
    ours_organic_positions: oursOrganic.map((o) => o.position),
    top_organic_sample: topOrganic,
    local_pack_position: serp?.local_pack_position ?? null,
    cost: serp?.cost ?? null,
  };
  results.push(out);
  console.log(JSON.stringify(out));
}

const stillRanked = results.filter((r) => r.best_rank_group != null);
const gone = results.filter((r) => r.best_rank_group == null && !r.error);
const errored = results.filter((r) => r.error);
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({
  checked: results.length,
  still_has_organic_rank: stillRanked.length,
  confirmed_unranked_top50: gone.length,
  errors: errored.length,
  still: stillRanked.map((r) => ({ kw: r.keyword, rank: r.best_rank_group, url: r.best_url })),
  gone: gone.map((r) => r.keyword),
  errored: errored.map((r) => ({ kw: r.keyword, error: r.error })),
}, null, 2));
