/**
 * Collect standalone LLM visibility snapshot (domain mentions + prompt bank + topic seeds).
 * Usage: node scripts/collect-llm-visibility.mjs
 */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { collectLlmVisibilitySnapshot } from '../lib/llm-visibility/collect-core.js';

config({ path: '.env.local' });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await collectLlmVisibilitySnapshot({ cadence: 'weekly', persist: true });
mkdirSync(join(root, 'scripts/output'), { recursive: true });
writeFileSync(
  join(root, 'scripts/output/llm-visibility-snapshot-LATEST.json'),
  JSON.stringify({ id: result.id, run_at: result.run_at, ...result.snapshot }, null, 2),
);
console.log(JSON.stringify({
  id: result.id,
  run_at: result.run_at,
  cost_usd: result.snapshot.cost_usd,
  named: result.snapshot.meta.named_of_prompts,
}, null, 2));
