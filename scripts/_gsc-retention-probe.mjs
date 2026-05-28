// Probe GSC retention floor with a few discrete dates around the expected boundary.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const PROPERTY = 'https://www.alanranger.com';

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

async function probe(token, date, dims) {
  const body = { startDate: date, endDate: date };
  if (dims) { body.dimensions = dims; body.rowLimit = 5; }
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) return { date, err: r.status };
  const j = await r.json();
  return { date, rows: j.rows?.length || 0, clicks: j.rows?.[0]?.clicks ?? 0 };
}

(async () => {
  const token = await getToken();
  console.log('LATEST AVAILABLE DATE PROBE (totals)');
  for (const d of ['2026-05-27','2026-05-26','2026-05-25','2026-05-24','2026-05-23','2026-05-22','2026-05-21','2026-05-20']) {
    const r = await probe(token, d);
    console.log(JSON.stringify(r));
    await new Promise((res) => setTimeout(res, 80));
  }
  console.log('\nPAGE+QUERY+DATE PROBE ON EARLY DATE');
  for (const d of ['2025-01-13','2025-01-15','2025-06-15','2025-12-01']) {
    const r = await probe(token, d, ['date','page','query']);
    console.log(JSON.stringify(r));
    await new Promise((res) => setTimeout(res, 80));
  }
})().catch((e) => { console.error(e); process.exit(1); });
