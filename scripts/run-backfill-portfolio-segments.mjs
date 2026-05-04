/**
 * Rebuild portfolio_segment_metrics_28d from gsc_page_metrics_28d (server handler).
 *
 * Usage:
 *   node scripts/run-backfill-portfolio-segments.mjs
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01
 *   node scripts/run-backfill-portfolio-segments.mjs 2026-02-01 2026-03-31
 *   node scripts/run-backfill-portfolio-segments.mjs runid:YOUR_RUN_ID
 *
 * Loads .env.local BEFORE importing the handler so process.env is correct
 * (static import would run before dotenv and could inherit a bad shell key).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local or .env
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local', override: true });
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

const arg2 = process.argv[2] || '2026-02-01';

let body;
if (String(arg2).toLowerCase().startsWith('runid:')) {
  body = { runId: String(arg2).slice(6).trim(), maxRuns: 2000 };
} else {
  const dateEndGte = String(arg2).slice(0, 10);
  const dateEndLte = process.argv[3] ? String(process.argv[3]).slice(0, 10) : null;
  body = {
    dateEndGte,
    ...(dateEndLte ? { dateEndLte } : {}),
    maxRuns: 1500
  };
}

console.log('POST body:', body);

const res = mockRes();

try {
  const { default: handler } = await import('../api/supabase/backfill-portfolio-segments.js');
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
