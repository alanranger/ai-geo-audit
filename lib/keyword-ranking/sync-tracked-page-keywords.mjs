/**
 * One-way: target_class=tracked pages join the Ranking & AI locked list.
 * Old keywords are never deleted — they become keep/drop orphans.
 */
import { normalizePagePath } from '../pagesMaster.js';
import {
  censusFromByKeyword,
  inferTrackingMeta,
  normalizeTrackingKey,
  upsertTrackingRows,
} from './locked-config-merge.js';
import {
  fetchSupabaseLockedOverride,
  loadRuntimeLockedByKeyword,
  persistLockedToSupabase,
  writeLockedConfigFiles,
} from './locked-config-persist.js';
import { isRemovedFromTracking } from './tracked-set-v3.js';

const PROPERTY = 'https://www.alanranger.com';

export function trackedOverrideRows(overrides) {
  const rows = [];
  for (const o of overrides || []) {
    if (String(o.target_class || '').toLowerCase() !== 'tracked') continue;
    const keyword = String(o.target_keyword || '').trim();
    if (!keyword || isRemovedFromTracking(keyword)) continue;
    const meta = inferTrackingMeta(keyword);
    rows.push({
      keyword,
      class: meta.keyword_class,
      tracking_location: meta.tracking_location,
      location_name_dfs: meta.location_name_dfs,
      target_page: normalizePagePath(o.page_url),
    });
  }
  return rows;
}

export function nextOrphans({ previousByPage, nextOverrides, existingOrphans }) {
  const nextByPage = new Map();
  for (const o of nextOverrides || []) {
    nextByPage.set(normalizePagePath(o.page_url), o);
  }
  const out = [...(existingOrphans || [])];
  const seen = new Set(out.map((o) => `${normalizeTrackingKey(o.keyword)}|${o.from_page}`));
  for (const [path, prev] of previousByPage || []) {
    if (String(prev.target_class || '').toLowerCase() !== 'tracked') continue;
    const oldKw = String(prev.target_keyword || '').trim();
    if (!oldKw) continue;
    const next = nextByPage.get(path);
    const stillTracked = next && String(next.target_class || '').toLowerCase() === 'tracked';
    const newKw = stillTracked ? String(next.target_keyword || '').trim() : '';
    if (normalizeTrackingKey(oldKw) === normalizeTrackingKey(newKw)) continue;
    const key = `${normalizeTrackingKey(oldKw)}|${path}`;
    if (seen.has(key)) continue;
    const decided = out.find((o) =>
      normalizeTrackingKey(o.keyword) === normalizeTrackingKey(oldKw)
      && o.from_page === path
      && (o.status === 'keep' || o.status === 'drop')
    );
    if (decided) continue;
    out.push({
      keyword: oldKw,
      from_page: path,
      new_keyword: newKw || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });
    seen.add(key);
  }
  return out;
}

export async function syncTrackedPageKeywords({
  overrides,
  previousByPage,
  propertyUrl = PROPERTY,
  writeFiles = false,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  const runtime = await loadRuntimeLockedByKeyword({
    propertyUrl,
    supabaseUrl,
    supabaseKey,
  });
  const incoming = trackedOverrideRows(overrides);
  const merged = upsertTrackingRows(runtime.byKeyword, incoming);
  const override = await fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl);
  const orphans = nextOrphans({
    previousByPage,
    nextOverrides: overrides,
    existingOrphans: override?.orphans || [],
  });
  let filesWritten = null;
  if (writeFiles) {
    filesWritten = writeLockedConfigFiles(merged.byKeyword, 'v15');
  }
  await persistLockedToSupabase({
    supabaseUrl,
    supabaseKey,
    propertyUrl,
    byKeyword: merged.byKeyword,
    census: merged.census || censusFromByKeyword(merged.byKeyword),
    sourceName: filesWritten?.sourceName || 'keyword-tracking-locations-and-class-LOCKED-v15.csv',
    orphans,
  });
  return {
    added: merged.added,
    updated: merged.updated,
    count: Object.keys(merged.byKeyword).length,
    orphans: orphans.filter((o) => o.status === 'pending'),
    filesWritten,
  };
}

export async function decideTrackedKeywordOrphan({
  keyword,
  action,
  propertyUrl = PROPERTY,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  const act = String(action || '').toLowerCase();
  if (act !== 'keep' && act !== 'drop') throw new Error('action must be keep or drop');
  const runtime = await loadRuntimeLockedByKeyword({ propertyUrl, supabaseUrl, supabaseKey });
  const override = await fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl);
  const key = normalizeTrackingKey(keyword);
  const orphans = (override?.orphans || []).map((o) => (
    normalizeTrackingKey(o.keyword) === key ? { ...o, status: act } : o
  ));
  const byKeyword = { ...runtime.byKeyword };
  if (act === 'drop') delete byKeyword[key];
  await persistLockedToSupabase({
    supabaseUrl,
    supabaseKey,
    propertyUrl,
    byKeyword,
    census: censusFromByKeyword(byKeyword),
    sourceName: override?.source || 'keyword-tracking-locations-and-class-LOCKED-v15.csv',
    orphans,
  });
  return { status: act, count: Object.keys(byKeyword).length };
}
