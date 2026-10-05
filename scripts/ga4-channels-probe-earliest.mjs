/**
 * Probe earliest GA4 channel-session date available for this property.
 * Usage: node scripts/ga4-channels-probe-earliest.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const propertyId = String(process.env.GA4_PROPERTY_ID || '289575590').trim();

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error_description || json?.error || res.status);
  return json.access_token;
}

async function probe(access, startDate, endDate) {
  const res = await fetch(`${GA4_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 5,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || res.status);
  const first = json?.rows?.[0]?.dimensionValues?.[0]?.value || null;
  return { rowCount: json?.rowCount ?? 0, firstDate: first, sampleRows: (json?.rows || []).length };
}

const access = await token();
const windows = [
  ['2024-01-01', '2024-01-31'],
  ['2024-06-01', '2024-06-30'],
  ['2025-01-01', '2025-01-31'],
  ['2025-06-01', '2025-06-30'],
  ['2026-01-01', '2026-01-31'],
  ['2026-05-01', '2026-05-30'],
];
const out = {};
for (const [a, b] of windows) {
  try {
    out[`${a}_${b}`] = await probe(access, a, b);
  } catch (e) {
    out[`${a}_${b}`] = { error: e.message };
  }
}
// Binary-ish earliest: try full 2024 year for first date
try {
  const full = await probe(access, '2024-01-01', '2026-05-30');
  out.range_2024_to_2026_05 = full;
} catch (e) {
  out.range_2024_to_2026_05 = { error: e.message };
}
console.log(JSON.stringify(out, null, 2));
