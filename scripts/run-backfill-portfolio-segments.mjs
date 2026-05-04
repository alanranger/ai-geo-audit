/**
 * Rebuild portfolio_segment_metrics_28d from gsc_page_metrics_28d for selected runs.
 * Use after fixing tracked-task URL loading (GET /api/optimisation/tasks).
 *
 * Usage:
 *   node scripts/run-backfill-portfolio-segments.mjs
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01 <single_run_id>
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local or .env
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import handler from '../api/supabase/backfill-portfolio-segments.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

function mockRes() {
  return {
    statusCode: 200,
    setHeader() {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    send(s) {
      this.body = typeof s === 'string' ? s : JSON.stringify(s);
    }
  };
}

const since = process.argv[2] || '2026-02-01';
const onlyRunId = process.argv[3] || null;

let runIds = [];
if (onlyRunId) {
  runIds = [onlyRunId];
} else {
  const { data: rows, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('run_id')
    .gte('date_end', since);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  runIds = [...new Set((rows || []).map((r) => r.run_id).filter(Boolean))];
}

console.log(`Portfolio backfill: ${runIds.length} run_id(s)${onlyRunId ? '' : ` (date_end >= ${since})`}`);

let ok = 0;
let fail = 0;
for (const runId of runIds) {
  const res = mockRes();
  try {
    await handler({ method: 'POST', body: { runId } }, res);
    if (res.statusCode >= 400) {
      console.error('FAIL', runId, res.statusCode, res.body?.slice(0, 500));
      fail++;
    } else {
      ok++;
      if (runIds.length <= 20 || ok % 10 === 0) console.log('OK', runId);
    }
  } catch (e) {
    console.error('ERR', runId, e?.message || e);
    fail++;
  }
}

console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(fail ? 1 : 0);
