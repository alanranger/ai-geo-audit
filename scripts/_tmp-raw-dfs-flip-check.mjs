/**
 * Dump raw organic item types/domains for flaky keywords — diagnose matcher vs SERP flip.
 * One keyword, two back-to-back fetches. No DB write.
 */
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
const auth = Buffer.from(`${login}:${password}`).toString('base64');
const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

const KEYWORD = process.argv[2] || 'photography classes near me';
const LOCATION_CODE = Number(process.argv[3] || 9215523);
const COORD = process.argv[4] || '52.3991769,-1.5937149,14z';

async function rawFetch(label) {
  const body = [{
    keyword: KEYWORD,
    language_code: 'en',
    location_code: LOCATION_CODE,
    location_coordinate: COORD,
    device: 'desktop',
    os: 'windows',
    depth: 50,
    load_async_ai_overview: false,
    expand_ai_overview: false,
  }];
  // National UK: no coordinate
  if (LOCATION_CODE === 2826) delete body[0].location_coordinate;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const items = data?.tasks?.[0]?.result?.[0]?.items || [];
  const organic = items.filter((i) => i.type === 'organic');
  const alan = organic.filter((i) => {
    const d = String(i.domain || i.url || '').toLowerCase();
    return d.includes('alanranger');
  }).map((i) => ({
    rank_group: i.rank_group,
    rank_absolute: i.rank_absolute,
    domain: i.domain,
    url: String(i.url || '').slice(0, 100),
  }));
  const typeCounts = {};
  for (const i of items) typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;
  const top5 = organic.slice(0, 5).map((i) => ({
    rg: i.rank_group,
    ra: i.rank_absolute,
    domain: i.domain,
  }));
  console.log(JSON.stringify({
    label,
    keyword: KEYWORD,
    location_code: LOCATION_CODE,
    http_ok: res.ok,
    status: data?.status_code,
    task_status: data?.tasks?.[0]?.status_code,
    item_count: items.length,
    organic_count: organic.length,
    typeCounts,
    alanranger_organic: alan,
    top5_organic: top5,
  }, null, 2));
}

await rawFetch('fetch_1');
await new Promise((r) => setTimeout(r, 1500));
await rawFetch('fetch_2');
