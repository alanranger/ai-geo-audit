/**
 * Manual runner for the GA4 channel session pull.
 *
 *   node scripts/ga4-channels-run.mjs            # 90-day backfill, writes
 *   node scripts/ga4-channels-run.mjs --dry      # fetch only
 *   node scripts/ga4-channels-run.mjs --days=180
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { collectGa4Channels } = await import('../lib/acquisition/ga4-channels.js');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const daysArg = args.find((a) => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : 90;

try {
  const result = await collectGa4Channels({ persist: !dry, days });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('failed:', err?.message || err);
  process.exitCode = 1;
}
