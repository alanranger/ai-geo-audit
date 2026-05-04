/**
 * Rebuild portfolio_segment_metrics_28d from gsc_page_metrics_28d.
 *
 * Usage:
 *   node scripts/run-backfill-portfolio-segments.mjs
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01 <single_run_id>
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local or .env
 */

import dotenv from 'dotenv';
import handler from '../api/supabase/backfill-portfolio-segments.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

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

const res = mockRes();
const body = onlyRunId ? { runId: onlyRunId } : { dateEndGte: since };
console.log('Portfolio backfill POST body:', body);

try {
  await handler({ method: 'POST', body }, res);
  if (res.statusCode >= 400) {
    console.error('FAIL', res.statusCode, res.body?.slice(0, 800));
    process.exit(1);
  }
  console.log(res.body);
  process.exit(0);
} catch (e) {
  console.error(e?.message || e);
  process.exit(1);
}
