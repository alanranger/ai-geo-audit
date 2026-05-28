// Phase C / C0.1 smoke test:
// 1) Refresh OAuth token via existing GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN
// 2) Call searchAnalytics.query for a single day, no Supabase write
// Prints redacted summary only.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PROPERTY = 'https://www.alanranger.com';
const TEST_DATE = '2026-05-10'; // mid-window, definitely indexed

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
  if (!r.ok) throw new Error(`token http ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
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
  if (!r.ok) throw new Error(`sa http ${r.status}: ${await r.text()}`);
  return r.json();
}

async function sitesList(token) {
  const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`sites http ${r.status}: ${await r.text()}`);
  return r.json();
}

(async () => {
  const token = await getToken();
  console.log('OAuth token refreshed OK (length=' + token.length + ')');

  const sites = await sitesList(token);
  const propsSeen = sites.siteEntry?.map((s) => `${s.siteUrl}  (${s.permissionLevel})`) ?? [];
  console.log('GSC properties accessible by this OAuth token:');
  propsSeen.forEach((p) => console.log('  - ' + p));

  // Probe 1: site totals for one day
  const totals = await sa(token, { startDate: TEST_DATE, endDate: TEST_DATE });
  console.log(`\nProbe A - site totals on ${TEST_DATE}: rows=${totals.rows?.length || 0}`);
  if (totals.rows?.[0]) {
    const r = totals.rows[0];
    console.log(`  clicks=${r.clicks} impressions=${r.impressions} ctr=${r.ctr.toFixed(4)} pos=${r.position.toFixed(2)}`);
  }

  // Probe 2: page+query slice for one day, small row limit
  const pq = await sa(token, {
    startDate: TEST_DATE,
    endDate: TEST_DATE,
    dimensions: ['date', 'page', 'query'],
    rowLimit: 5,
  });
  console.log(`\nProbe B - date+page+query on ${TEST_DATE}: rows returned=${pq.rows?.length || 0}`);
  console.log('  First 5 sample rows (redacted to confirm shape only):');
  (pq.rows || []).forEach((r) => {
    const [d, p, q] = r.keys;
    console.log(`    date=${d}  page=${p.slice(0, 60)}...  query="${q.slice(0, 40)}"  clicks=${r.clicks} imp=${r.impressions}`);
  });

  // Probe 3: see what the max retention window actually returns
  const earliest = await sa(token, { startDate: '2025-01-01', endDate: '2025-01-01' });
  console.log(`\nProbe C - earliest available date (2025-01-01) site totals rows=${earliest.rows?.length || 0}`);

  // Probe 4: check 2024 retention
  const earlier = await sa(token, { startDate: '2024-12-15', endDate: '2024-12-15' });
  console.log(`Probe D - 2024-12-15 site totals rows=${earlier.rows?.length || 0}`);

  console.log('\nC0.1 SMOKE TEST COMPLETE');
})().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
