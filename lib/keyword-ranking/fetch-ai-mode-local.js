/**
 * Local DataForSEO Google AI Mode fetch (same shape as ai-mode-serp-batch-test).
 * Used by clean-baseline / enrich scripts so we don't depend on Vercel HTTP timeouts.
 */
import { resolveTrackingLocation } from './tracking-location.js';
import { resolveSerpItems } from './serp-redirect-owner.js';
import { extractCitationsFromDfsResult, toLegacyShape } from '../ai-citation-extract.js';
import { postAiMode } from './organic-serp.js';

const ALAN_ROOT = 'alanranger.com';

/** AI Mode citations with google.com/goto references resolved first (same matching as the organic SERP). */
export function extractAiModeCitationsFromTask(task) {
  const result = task?.result?.[0];
  const items = resolveSerpItems(result?.items || [], ALAN_ROOT);
  return toLegacyShape(extractCitationsFromDfsResult({ ...result, items }, ALAN_ROOT));
}

const extractCitationsFromTask = extractAiModeCitationsFromTask;

async function fetchOne(keyword, auth) {
  const loc = resolveTrackingLocation(keyword);
  const posted = await postAiMode(auth, keyword, loc.location_name || 'United Kingdom');
  const res = { ok: posted.ok };
  const data = posted.data || {};
  if (!res.ok || data.status_code !== 20000 || !data.tasks?.[0]?.result?.length) {
    return {
      query: keyword,
      has_ai_overview: false,
      total_citations: 0,
      alanranger_citations_count: 0,
      alanranger_citations: [],
      sample_citations: [],
      location_name: loc.location_name,
      error: data.status_message || `HTTP ${res.status}`,
    };
  }
  return {
    query: keyword,
    ...extractCitationsFromTask(data.tasks[0]),
    location_name: loc.location_name,
  };
}

export async function fetchAiModeRowsLocal(keywords, { concurrency = 4 } = {}) {
  const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('Missing DataForSEO credentials');
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const out = new Array(keywords.length);
  let i = 0;
  async function worker() {
    while (i < keywords.length) {
      const idx = i;
      i += 1;
      const kw = keywords[idx];
      out[idx] = await fetchOne(kw, auth);
      if ((idx + 1) % 10 === 0 || idx + 1 === keywords.length) {
        console.log(`[ai-mode-local] ${idx + 1}/${keywords.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keywords.length) }, () => worker()));
  return out;
}
