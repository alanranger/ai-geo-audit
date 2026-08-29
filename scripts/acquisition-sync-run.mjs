/**
 * Manual runner for the Acquisition Phase 1 pulls, for local verification.
 *
 *   node scripts/acquisition-sync-run.mjs llm            # real pull + write
 *   node scripts/acquisition-sync-run.mjs llm --dry
 *   node scripts/acquisition-sync-run.mjs youtube
 *   node scripts/acquisition-sync-run.mjs academy
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const [, , jobArg, ...flags] = process.argv;
const dryRun = flags.includes('--dry');

async function main() {
  if (jobArg === 'llm') {
    const { collectLlmMentions } = await import('../lib/acquisition/llm-mentions.js');
    return collectLlmMentions({ persist: !dryRun });
  }
  if (jobArg === 'youtube') {
    const { collectYoutubeStats } = await import('../lib/acquisition/youtube-stats.js');
    return collectYoutubeStats({ persist: !dryRun });
  }
  if (jobArg === 'academy') {
    const { fetchAcademyChannelOutcomes } = await import('../lib/acquisition/academy-signup-source.js');
    return fetchAcademyChannelOutcomes({ days: Number(flags.find((f) => /^\d+$/.test(f)) || 28) });
  }
  throw new Error('usage: node scripts/acquisition-sync-run.mjs <llm|youtube|academy> [--dry]');
}

try {
  console.log(JSON.stringify(await main(), null, 2));
} catch (err) {
  console.error('FAILED:', err?.message || err);
  process.exitCode = 1;
}
