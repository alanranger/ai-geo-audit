/**
 * Collect competitor on-page signals (K1–K5 comparable) via live DOM read.
 */
import { validateUrlLive } from '../aigeo/lib/live-page-validator.js';
import { COMPETITOR_ANALYSIS_BASELINE } from './constants.js';

function wordCount(text) {
  if (!text) return null;
  const n = String(text).trim().split(/\s+/).filter(Boolean).length;
  return n > 0 ? n : null;
}

function guessPageType(url, schemaTypes) {
  const types = Array.isArray(schemaTypes) ? schemaTypes.map((t) => String(t).toLowerCase()) : [];
  const path = String(url || '').toLowerCase();
  if (types.some((t) => t.includes('course') || t.includes('service'))) return 'service/course';
  if (path.includes('workshop') || path.includes('course')) return 'service/course';
  if (path.includes('blog') || path.includes('news')) return 'blog';
  if (path === '/' || path.endsWith('.com/')) return 'landing';
  return 'page';
}

export async function collectOnpageForUrl(domain, pageUrl, keyword) {
  const live = await validateUrlLive(pageUrl);
  if (!live.ok) {
    return { domain, page_url: pageUrl, collected: false, reason: live.error || 'fetch_failed' };
  }
  const wc = wordCount(live.bodyText);
  return {
    domain,
    page_url: pageUrl,
    keyword: keyword || null,
    title: live.title,
    h1: live.h1,
    meta_description: live.metaDescription,
    word_count: wc,
    schema_types: live.schemaTypes || [],
    page_type: guessPageType(pageUrl, live.schemaTypes),
    collection_source: 'live_dom',
    collected: true,
    ...COMPETITOR_ANALYSIS_BASELINE,
    collected_at: new Date().toISOString(),
  };
}

export async function upsertOnpageRow(supabaseUrl, supabaseKey, row) {
  if (!row?.collected) return false;
  const payload = {
    domain: row.domain,
    page_url: row.page_url,
    keyword: row.keyword,
    title: row.title,
    h1: row.h1,
    meta_description: row.meta_description,
    word_count: row.word_count,
    schema_types: row.schema_types,
    page_type: row.page_type,
    collection_source: row.collection_source,
    baseline_name: COMPETITOR_ANALYSIS_BASELINE.baseline_name,
    schema_version: COMPETITOR_ANALYSIS_BASELINE.schema_version,
    collected_at: row.collected_at,
  };
  const url = `${supabaseUrl}/rest/v1/competitor_onpage_snapshots?on_conflict=domain,page_url,baseline_name`;
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
