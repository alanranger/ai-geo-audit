import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseCsvLine, rowToCsvLine, normalizeCsvText } from './parse-tracking-csv.js';
import lockedLocationsJson from './keyword-tracking-locations-LOCKED.json' with { type: 'json' };

export const VALID_CLASSES = Object.freeze(['brand', 'local-money', 'regional-money', 'national-money']);
export const VALID_TRACKING = Object.freeze(['Local', 'UK']);
const CSV_HEADER = 'keyword,tracking_location,location_name_dfs,class,target_page,llm_prompt';

function parseLlmPromptFlag(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function normalizeTrackingKey(keyword) {
  return String(keyword || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function loadByKeywordFromCsv(csvPath) {
  const text = normalizeCsvText(readFileSync(csvPath, 'utf8')).trim();
  const lines = text.split(/\r?\n/).slice(1);
  const byKeyword = {};
  for (const line of lines) {
    const r = parseCsvLine(line);
    const keyword = String(r[0] || '').trim();
    if (!keyword) continue;
    const key = normalizeTrackingKey(keyword);
    byKeyword[key] = {
      keyword,
      tracking_location: String(r[1] || '').trim(),
      location_name_dfs: String(r[2] || '').trim(),
      keyword_class: String(r[3] || '').trim() || null,
      target_page: String(r[4] || '').trim() || null,
      llm_prompt: parseLlmPromptFlag(r[5]),
    };
  }
  return byKeyword;
}

function normalizeTrackingLocation(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const norm = v.toLowerCase() === 'local' ? 'Local' : v.toLowerCase() === 'uk' ? 'UK' : null;
  return VALID_TRACKING.includes(norm) ? norm : null;
}

function normalizeClass(value) {
  const cls = String(value || '').trim();
  return VALID_CLASSES.includes(cls) ? cls : null;
}

export function censusFromByKeyword(byKeyword) {
  const counts = { brand: 0, 'local-money': 0, 'regional-money': 0, 'national-money': 0, unmapped: 0 };
  for (const row of Object.values(byKeyword || {})) {
    const cls = normalizeClass(row.keyword_class);
    if (cls) counts[cls] += 1;
    else counts.unmapped += 1;
  }
  return {
    brand: counts.brand,
    'local-money': counts['local-money'],
    'regional-money': counts['regional-money'],
    'national-money': counts['national-money'],
    total: Object.keys(byKeyword || {}).length,
    unmapped: counts.unmapped,
  };
}

export function upsertTrackingRows(existingByKeyword, incomingRows, options = {}) {
  const replaceAll = options.replaceAll === true;
  const byKeyword = replaceAll ? {} : { ...existingByKeyword };
  let added = 0;
  let updated = 0;
  let unmapped = 0;

  for (const raw of incomingRows || []) {
    const keyword = String(raw.keyword || '').trim();
    if (!keyword) continue;
    const key = normalizeTrackingKey(keyword);
    const isNew = !byKeyword[key];
    const cls = normalizeClass(raw.class || raw.keyword_class);
    if (!cls) unmapped += 1;

    const prev = byKeyword[key] || {};
    const llmRaw = raw.llm_prompt;
    const llmNext = llmRaw === undefined || llmRaw === null || llmRaw === ''
      ? (prev.llm_prompt === true)
      : parseLlmPromptFlag(llmRaw);
    byKeyword[key] = {
      keyword,
      tracking_location: normalizeTrackingLocation(raw.tracking_location) || prev.tracking_location || null,
      location_name_dfs: String(raw.location_name_dfs || '').trim() || prev.location_name_dfs || null,
      keyword_class: cls || prev.keyword_class || null,
      target_page: String(raw.target_page || '').trim() || prev.target_page || null,
      llm_prompt: llmNext,
    };
    if (isNew) added += 1;
    else updated += 1;
  }

  return { byKeyword, added, updated, unmapped, census: censusFromByKeyword(byKeyword) };
}

export function byKeywordToCsv(byKeyword) {
  const rows = Object.values(byKeyword || {})
    .sort((a, b) => a.keyword.localeCompare(b.keyword));
  return [CSV_HEADER, ...rows.map(rowToCsvLine)].join('\n') + '\n';
}

export function buildLockedJsonPayloads(byKeyword, sourceName) {
  const byClass = {};
  const classByKeyword = {};
  for (const [key, row] of Object.entries(byKeyword || {})) {
    byClass[key] = {
      keyword: row.keyword,
      keyword_class: row.keyword_class,
      tracking_location: row.tracking_location,
      target_page: row.target_page,
      llm_prompt: row.llm_prompt === true,
    };
    classByKeyword[key] = row.keyword_class || 'national-money';
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const locPayload = {
    source: sourceName,
    locked_at: stamp,
    count: Object.keys(byKeyword).length,
    by_keyword: byKeyword,
  };
  const classPayload = {
    source: sourceName,
    locked_at: stamp,
    count: Object.keys(byClass).length,
    by_keyword: byClass,
  };
  const classJs = `window.__KEYWORD_CLASS_LOCKED_BY_KEYWORD=${JSON.stringify(classByKeyword)};\n`;
  return { locPayload, classPayload, classJs };
}

export function resolveClassFromMap(keyword, byKeyword) {
  const key = normalizeTrackingKey(keyword);
  const row = byKeyword?.[key];
  const cls = normalizeClass(row?.keyword_class);
  if (!cls) return { keyword_class: 'national-money', class_unmapped: true };
  return {
    keyword_class: cls,
    class_unmapped: false,
    tracking_location: row.tracking_location || null,
    target_page: row.target_page || null,
  };
}

export function resolveLocationFromMap(keyword, byKeyword) {
  const key = normalizeTrackingKey(keyword);
  const row = byKeyword?.[key];
  if (!row) {
    return { location_name: 'United Kingdom', unmapped: true, tier: 'N' };
  }
  const isLocal = String(row.tracking_location).toLowerCase() === 'local';
  const location_name = row.location_name_dfs
    || (isLocal ? 'Coventry,England,United Kingdom' : 'United Kingdom');
  return {
    location_name,
    unmapped: false,
    tier: isLocal ? 'L' : 'N',
    target_page: row.target_page || null,
  };
}

/** v4 only — no versioned fallback (v3 removed from deploy). */
export function defaultLockedCsvPath(root) {
  const v4 = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
  if (!existsSync(v4)) {
    throw new Error(`Locked config CSV not found: ${v4}`);
  }
  return v4;
}

export function tryLoadByKeywordFromCsv(root) {
  const v4 = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
  if (!existsSync(v4)) return null;
  return loadByKeywordFromCsv(v4);
}

/** Bundled JSON (Vercel-safe); CSV fallback for local rebuild scripts only. */
export function loadLockedByKeywordFromRepo(root) {
  const byKeyword = lockedLocationsJson?.by_keyword;
  if (byKeyword && Object.keys(byKeyword).length > 0) {
    return JSON.parse(JSON.stringify(byKeyword));
  }
  const fromCsv = tryLoadByKeywordFromCsv(root);
  if (fromCsv) return fromCsv;
  throw new Error('No locked keyword config in bundled JSON or on-disk LOCKED-v4 CSV');
}
