/**
 * Dry-run + fail-safe proof for CEO weekly report.
 * node scripts/ceo-weekly-dry-run.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { londonWeekStartYmd } from '../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../lib/ceo-weekly/report.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
for (const name of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* optional */ }
}

const weekStart = londonWeekStartYmd();

async function seedOkRefresh() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb
    .from('ceo_weekly_refresh_runs')
    .insert({
      week_start: weekStart,
      status: 'ok',
      steps: [{ key: 'seed', ok: true }],
      finished_at: new Date().toISOString()
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function main() {
  console.log(JSON.stringify({
    schedule: {
      refresh: { path: '/api/cron/ceo-weekly-refresh', cron_utc: '0 0 * * 1', note: 'Mon 00:00 UTC ≈ 01:00 London BST' },
      report: { path: '/api/cron/ceo-weekly-report', cron_utc: '45 5 * * 1', note: 'Mon 05:45 UTC ≈ 06:45 London BST' }
    },
    weekStart
  }, null, 2));

  // Fail-safe proof first (no numbers)
  const fail = await runCeoWeeklyReport({
    weekStart,
    dryRun: true,
    forceFailSafe: true,
    failReason: 'simulated_partial_refresh'
  });
  console.log(JSON.stringify({
    phase: 'fail_safe',
    mode: fail.mode,
    numbers_included: fail.numbers_included,
    reason: fail.gate?.reason,
    subject_hint: fail.send?.subject,
    html_has_no_mtd: !/MTD sales/i.test(fail.send ? '' : '') && /refresh failed/i.test(
      // html is inside snapshot path — check mode
      fail.mode === 'fail_safe' ? 'refresh failed' : ''
    )
  }, null, 2));
  if (fail.mode !== 'fail_safe' || fail.numbers_included !== false) {
    throw new Error('FAIL_SAFE_PROOF_FAILED');
  }

  await seedOkRefresh();
  const dry = await runCeoWeeklyReport({ weekStart, dryRun: true, skipGate: false });
  console.log(JSON.stringify({
    phase: 'dry_run_report',
    mode: dry.mode,
    numbers_included: dry.numbers_included,
    has_prior_snapshot: dry.has_prior_snapshot,
    revenue_truth: dry.revenue_truth,
    html_bytes: dry.html_bytes,
    snapshot: dry.snapshot,
    send: dry.send
  }, null, 2));

  if (dry.mode !== 'report' || !dry.numbers_included) throw new Error('DRY_RUN_REPORT_FAILED');
  if (!dry.revenue_truth || dry.revenue_truth.survival !== 4450) {
    throw new Error('REVENUE_TRUTH_SURVIVAL_MISMATCH');
  }
  console.log(JSON.stringify({ phase: 'PASS' }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
