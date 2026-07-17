import { writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  byKeywordToCsv,
  buildLockedJsonPayloads,
  loadLockedByKeywordFromRepo,
} from './locked-config-merge.js';

const DRIVE_DIR = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports';

function writeJson(path, payload) {
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n');
}

export function writeLockedConfigFiles(byKeyword, version = 'v4') {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const sourceName = `keyword-tracking-locations-and-class-LOCKED-${version}.csv`;
  const configCsv = join(root, 'config', sourceName);
  const { locPayload, classPayload, classJs } = buildLockedJsonPayloads(byKeyword, sourceName);
  const csvText = byKeywordToCsv(byKeyword);

  mkdirSync(dirname(configCsv), { recursive: true });
  writeFileSync(configCsv, csvText);

  const jsonTargets = [
    join(root, 'lib/keyword-ranking/keyword-tracking-locations-LOCKED.json'),
    join(root, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
    join(root, 'public/keyword-tracking-locations-LOCKED.json'),
    join(root, 'public/keyword-tracking-class-LOCKED.json'),
    join(root, 'keyword-tracking-locations-LOCKED.json'),
    join(root, 'keyword-tracking-class-LOCKED.json'),
  ];
  const jsTargets = [
    join(root, 'public/keyword-tracking-class-LOCKED.js'),
    join(root, 'keyword-tracking-class-LOCKED.js'),
  ];

  writeJson(jsonTargets[0], locPayload);
  writeJson(jsonTargets[2], locPayload);
  writeJson(jsonTargets[4], locPayload);
  writeJson(jsonTargets[1], classPayload);
  writeJson(jsonTargets[3], classPayload);
  writeJson(jsonTargets[5], classPayload);
  for (const p of jsTargets) writeFileSync(p, classJs);

  try {
    mkdirSync(DRIVE_DIR, { recursive: true });
    copyFileSync(configCsv, join(DRIVE_DIR, sourceName));
  } catch (_e) { /* Drive optional in CI */ }

  return { configCsv, count: Object.keys(byKeyword).length, sourceName };
}

export function loadExistingLockedByKeyword(root = join(dirname(fileURLToPath(import.meta.url)), '../..')) {
  return loadLockedByKeywordFromRepo(root);
}

export async function loadMergedLockedByKeyword(root, opts = {}) {
  const staticByKeyword = loadLockedByKeywordFromRepo(root);
  const { supabaseUrl, supabaseKey, propertyUrl } = opts;
  if (!supabaseUrl || !supabaseKey || !propertyUrl) return staticByKeyword;
  const override = await fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl);
  return mergeLockedByKeyword(staticByKeyword, override?.by_keyword);
}

/**
 * Runtime SoT for serverless + local: bundled LOCKED JSON + optional Supabase override.
 */
export async function loadRuntimeLockedByKeyword({
  root = join(dirname(fileURLToPath(import.meta.url)), '../..'),
  propertyUrl = 'https://www.alanranger.com',
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  let staticByKeyword = {};
  try {
    staticByKeyword = loadLockedByKeywordFromRepo(root);
  } catch (_e) {
    staticByKeyword = {};
  }

  let override = null;
  if (supabaseUrl && supabaseKey) {
    override = await fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl);
  }
  const byKeyword = mergeLockedByKeyword(staticByKeyword, override?.by_keyword);
  if (!Object.keys(byKeyword).length) {
    throw new Error(
      'No locked keyword config available (bundled JSON empty and no Supabase keywordTrackingLocked)',
    );
  }
  return {
    byKeyword,
    source: override?.source || 'repo_locked_json',
    updated_at: override?.updated_at || null,
    static_rows: Object.keys(staticByKeyword).length,
    override_rows: override?.by_keyword ? Object.keys(override.by_keyword).length : 0,
  };
}

export async function fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl) {
  const url = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=ranking_ai_data`;
  const resp = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  const locked = rows?.[0]?.ranking_ai_data?.keywordTrackingLocked;
  if (!locked?.by_keyword || typeof locked.by_keyword !== 'object') return null;
  return locked;
}

export async function persistLockedToSupabase({
  supabaseUrl,
  supabaseKey,
  propertyUrl,
  byKeyword,
  census,
  sourceName,
}) {
  const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=id,ranking_ai_data`;
  const auditResp = await fetch(auditUrl, {
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  if (!auditResp.ok) throw new Error(`Failed to fetch audit_results (${auditResp.status})`);
  const rows = await auditResp.json();
  const latest = rows?.[0];
  if (!latest?.id) throw new Error('No audit_results row to persist keywordTrackingLocked');

  const rankingAiData = latest.ranking_ai_data || {};
  const keywords = Object.values(byKeyword).map((r) => r.keyword).sort((a, b) => a.localeCompare(b));
  const payload = {
    ranking_ai_data: {
      ...rankingAiData,
      keywordTrackingLocked: {
        source: sourceName,
        updated_at: new Date().toISOString(),
        count: Object.keys(byKeyword).length,
        census,
        by_keyword: byKeyword,
      },
      targetKeywords: keywords,
      keywordsUpdated: new Date().toISOString(),
      summary: { ...(rankingAiData.summary || {}), totalKeywords: keywords.length },
    },
  };

  const patchUrl = `${supabaseUrl}/rest/v1/audit_results?id=eq.${latest.id}`;
  const patchResp = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!patchResp.ok) {
    const text = await patchResp.text();
    throw new Error(`Failed to persist keywordTrackingLocked: ${text.slice(0, 300)}`);
  }
  return { count: keywords.length };
}

export function mergeLockedByKeyword(staticByKeyword, overrideByKeyword) {
  if (!overrideByKeyword) return { ...staticByKeyword };
  return { ...staticByKeyword, ...overrideByKeyword };
}
