import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PROPERTY = 'https://www.alanranger.com';
const QUERY = 'photography tuition';

function requireEnv(k) {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
}

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GOOGLE_CLIENT_ID'),
      client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
      refresh_token: requireEnv('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function fetchWindow(token, start, end) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: start,
      endDate: end,
      dimensions: ['query'],
      dimensionFilterGroups: [{
        filters: [{ dimension: 'query', operator: 'equals', expression: QUERY }],
      }],
      rowLimit: 10,
      dataState: 'final',
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    return { start, end, error: `${r.status} ${text.slice(0, 240)}` };
  }
  const json = JSON.parse(text);
  const row = (json.rows || [])[0] || null;
  return {
    start,
    end,
    clicks: row ? row.clicks : 0,
    impressions: row ? row.impressions : 0,
    ctr: row ? row.ctr : 0,
    position: row ? row.position : null,
    rowCount: (json.rows || []).length,
  };
}

const windows = [
  ['2025-04-01', '2025-04-30'],
  ['2025-05-01', '2025-05-31'],
  ['2025-06-01', '2025-06-30'],
  ['2025-03-01', '2025-03-31'],
  ['2025-02-01', '2025-02-28'],
];

const token = await getAccessToken();
const out = [];
for (const [start, end] of windows) {
  out.push(await fetchWindow(token, start, end));
}
console.log(JSON.stringify(out, null, 2));
