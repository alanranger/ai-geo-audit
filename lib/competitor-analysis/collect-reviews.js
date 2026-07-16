/**
 * Collect competitor GBP review count + rating via DFS SERP local_pack re-query.
 * Cheapest path: one Coventry money keyword per domain (~$0.0125/call).
 */
import { COMPETITOR_ANALYSIS_BASELINE } from './constants.js';

const SERP_URL = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const COVENTRY_LOC = 9041131;

function normDomain(raw) {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  return d && d.includes('.') ? d : null;
}

function dfsAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) throw new Error('missing_dataforseo_credentials');
  return `Basic ${Buffer.from(`${login}:${pass}`).toString('base64')}`;
}

function packReviewsFromItems(items, domain) {
  const target = normDomain(domain);
  if (!target || !Array.isArray(items)) return null;
  for (const it of items) {
    if (it?.type !== 'local_pack') continue;
    const dom = normDomain(it.domain || it.url);
    if (dom !== target) continue;
    const rating = Number(it.rating?.value ?? it.rating ?? it.rating_value);
    const count = Number(it.rating?.votes_count ?? it.reviews_count ?? it.review_count);
    if (Number.isFinite(rating) || Number.isFinite(count)) {
      return {
        business_name: it.title || null,
        rating: Number.isFinite(rating) ? rating : null,
        review_count: Number.isFinite(count) ? Math.round(count) : null,
      };
    }
  }
  return null;
}

export async function fetchReviewsForDomain(domain, keyword) {
  const auth = dfsAuth();
  const body = [{
    keyword: keyword || domain.replace(/\..+$/, '').replace(/-/g, ' '),
    location_code: COVENTRY_LOC,
    language_code: 'en',
    device: 'desktop',
    depth: 20,
  }];
  const resp = await fetch(SERP_URL, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`dfs_serp_${resp.status}`);
  const json = await resp.json();
  const items = json?.tasks?.[0]?.result?.[0]?.items || [];
  const parsed = packReviewsFromItems(items, domain);
  if (!parsed) return { domain, collected: false, reason: 'no_pack_match_or_rating' };
  return {
    domain,
    collected: true,
    ...parsed,
    source_keyword: keyword || null,
    collection_source: 'dfs_serp_local_pack',
    ...COMPETITOR_ANALYSIS_BASELINE,
    collected_at: new Date().toISOString(),
  };
}

export async function upsertReviewRow(supabaseUrl, supabaseKey, row) {
  if (!row?.collected) return false;
  const payload = {
    domain: row.domain,
    business_name: row.business_name,
    review_count: row.review_count,
    rating: row.rating,
    source_keyword: row.source_keyword,
    collection_source: row.collection_source,
    baseline_name: COMPETITOR_ANALYSIS_BASELINE.baseline_name,
    schema_version: COMPETITOR_ANALYSIS_BASELINE.schema_version,
    collected_at: row.collected_at,
  };
  const url = `${supabaseUrl}/rest/v1/competitor_local_reviews?on_conflict=domain,baseline_name`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(payload),
  });
  return r.ok;
}
