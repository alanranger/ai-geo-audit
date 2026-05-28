// Probe how much click data is dropped when adding the `query` dimension.
// Known GSC API behaviour: queries below a privacy threshold are omitted
// (this is NOT a bug, it's deliberate anonymisation). Quantifying it
// before launching the full backfill.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PROPERTY = 'https://www.alanranger.com';
const START = '2026-05-18';
const END   = '2026-05-24';

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  return (await r.json()).access_token;
}

async function sa(token, body) {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
}

async function sumAll(token, dims) {
  let total = { clicks: 0, impressions: 0, rows: 0 };
  let startRow = 0;
  for (;;) {
    const j = await sa(token, {
      startDate: START, endDate: END, dimensions: dims, rowLimit: 25000, startRow,
      dataState: 'final',
    });
    const rows = j.rows || [];
    if (!rows.length) break;
    for (const r of rows) {
      total.clicks += r.clicks; total.impressions += r.impressions; total.rows += 1;
    }
    if (rows.length < 25000) break;
    startRow += 25000;
  }
  return total;
}

(async () => {
  const token = await getToken();
  const variants = [
    { label: 'totals (no dims)',            dims: [] },
    { label: 'date only',                   dims: ['date'] },
    { label: 'date+page',                   dims: ['date', 'page'] },
    { label: 'date+query (no page)',        dims: ['date', 'query'] },
    { label: 'date+page+query (our cut)',   dims: ['date', 'page', 'query'] },
  ];
  console.log(`Comparison for ${START}..${END}\n`);
  for (const v of variants) {
    const s = await sumAll(token, v.dims);
    console.log(`${v.label.padEnd(36)}  rows=${String(s.rows).padStart(7)}  clicks=${String(s.clicks).padStart(6)}  impressions=${String(s.impressions).padStart(8)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
