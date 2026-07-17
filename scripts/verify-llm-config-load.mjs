/**
 * Isolated check: LLM step config load (no DFS calls, no full audit).
 * Usage: node scripts/verify-llm-config-load.mjs
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadFlaggedPromptBank } from '../lib/llm-visibility/collect-core.js';
import { censusFromByKeyword } from '../lib/keyword-ranking/locked-config-merge.js';

config({ path: '.env.local' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const bank = await loadFlaggedPromptBank();
const byKeyword = Object.fromEntries(
  bank.prompts.map((p) => [p.keyword.toLowerCase(), { keyword: p.keyword, llm_prompt: true }]),
);
const staticOnly = (await import('../lib/keyword-ranking/locked-config-merge.js')).loadLockedByKeywordFromRepo(root);
const census = censusFromByKeyword(staticOnly);

const report = {
  ok: bank.prompts.length === 17 && census.total === 151,
  source: bank.source,
  prompt_count: bank.prompts.length,
  expected_prompts: 17,
  static_json_total: census.total,
  static_json_source: staticOnly && Object.keys(staticOnly).length ? 'keyword-tracking-locations-LOCKED.json' : null,
  meta: bank.meta,
  sample_prompts: bank.prompts.slice(0, 3).map((p) => p.keyword),
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
