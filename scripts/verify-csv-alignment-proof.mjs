/**
 * Task 3 proof: BOM/CRLF-tolerant load from canonical Drive CSV via normal path.
 * Usage: node scripts/verify-csv-alignment-proof.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadByKeywordFromCsv, censusFromByKeyword } from '../lib/keyword-ranking/locked-config-merge.js';
import { normalizeCsvText } from '../lib/keyword-ranking/parse-tracking-csv.js';
import { loadFlaggedPromptBank } from '../lib/llm-visibility/collect-core.js';
import { clusterMembers, sortedClusterTaxonomy } from '../lib/llm-visibility/cluster-taxonomy.js';

const drivePath =
  'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/keyword-tracking-locations-and-class-LOCKED-v4.csv';
const raw = readFileSync(drivePath, 'utf8');
const hasBom = raw.charCodeAt(0) === 0xfeff;
const norm = normalizeCsvText(raw);
const header = norm.split(/\r?\n/)[0];
const byKeyword = loadByKeywordFromCsv(drivePath);
const census = censusFromByKeyword(byKeyword);
const bank = await loadFlaggedPromptBank();
const lockedRows = Object.values(byKeyword);
const membersByCluster = Object.fromEntries(
  sortedClusterTaxonomy().map((c) => [c.cluster_id, clusterMembers(lockedRows, c)]),
);

const report = {
  ok: header === 'keyword,tracking_location,location_name_dfs,class,target_page,llm_prompt'
    && Object.keys(byKeyword).length === 151
    && bank.prompts.length === 15,
  drive_file: drivePath,
  raw_has_utf8_bom: hasBom,
  parsed_header: header,
  parsed_header_has_bom_artifact: header.startsWith('\uFEFF') || header.startsWith('keyword') === false,
  row_count: Object.keys(byKeyword).length,
  census,
  llm_prompt_count: bank.prompts.length,
  llm_source: bank.source,
  llm_reps: bank.prompts.map((p) => p.keyword).sort(),
  loader_paths: {
    csv: 'loadByKeywordFromCsv → normalizeCsvText (parse-tracking-csv.js)',
    audit_llm: 'loadFlaggedPromptBank → loadRuntimeLockedByKeyword (bundled JSON, not v3 CSV)',
    standalone_collect: 'same as audit_llm (collect-core.js)',
  },
  fallback_workaround: 'No CSV fallback branch in runtime path. loadRuntimeLockedByKeyword uses bundled LOCKED JSON (+ optional Supabase override). Scripts use loadByKeywordFromCsv directly. build-keyword-tracking-locations.mjs is legacy (no BOM strip) — not used by load-keyword-v4-set.mjs.',
  members_by_cluster: membersByCluster,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
