// Phase C / C2 part 1 smoke test
//
// Imports the /api/aigeo/revenue-funnel-diagnosis handler directly, runs it
// against Supabase prod for the four user-named canary slugs, and
// pretty-prints the full diagnosis for each. No Vercel deploy, no commit,
// no UI.
//
//   npm:  node scripts/c2-diagnosis-smoke.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import handler from '../api/aigeo/revenue-funnel-diagnosis.js';

const CANARIES = [
  'private-photography-lessons',
  'photography-workshops',
  'photography-courses-coventry',
  'landscape-photography-workshops'
];

function makeReq() {
  return {
    method: 'GET',
    query: {
      propertyUrl: 'https://www.alanranger.com',
      pages: CANARIES.join(','),
      windowMonths: '6',
      minImpressions: '1000',
      includeAllPages: 'true'
    }
  };
}

function makeRes() {
  const out = { statusCode: null, headers: {}, body: null };
  return {
    setHeader(k, v) { out.headers[k] = v; },
    status(c) { out.statusCode = c; return this; },
    json(b) { out.body = b; return this; },
    _out: out
  };
}

async function run() {
  const req = makeReq();
  const res = makeRes();
  await handler(req, res);
  if (res._out.statusCode !== 200) {
    console.error('FAILED status:', res._out.statusCode);
    console.error('body:', JSON.stringify(res._out.body, null, 2));
    process.exit(1);
  }
  const payload = res._out.body;
  console.log(JSON.stringify({
    asOf: payload.asOf,
    propertyUrl: payload.propertyUrl,
    windowMonths: payload.windowMonths,
    thresholds: payload.thresholds,
    seasonality_calibration: payload.seasonality.calibration_note,
    page_seasonality_summary: payload.page_seasonality,
    suppression_summary: payload.suppression,
    pages_diagnosed: payload.pages_diagnosed
  }, null, 2));
  console.log('\n\n===== PER-PAGE DIAGNOSIS (in rank order) =====\n');
  for (const d of payload.diagnostics) {
    console.log('-----------------------------------------------------------');
    console.log(JSON.stringify(d, null, 2));
    console.log('');
  }
}

try { await run(); } catch (err) { console.error('FATAL:', err); process.exit(1); }
