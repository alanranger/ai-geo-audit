import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit';
for (const f of ['.env.local', '.env']) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
const auth = Buffer.from(
  `${process.env.DATAFORSEO_API_LOGIN}:${process.env.DATAFORSEO_API_PASSWORD}`
).toString('base64');
const payload = [{
  keyword: 'commercial photographer coventry',
  language_code: 'en',
  device: 'desktop',
  os: 'windows',
  depth: 50,
  location_coordinate: '52.3991769,-1.5937149,14z',
  location_code: 9215523,
}];
const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
  body: JSON.stringify(payload),
});
const data = await res.json();
const task = data?.tasks?.[0];
const items = task?.result?.[0]?.items || [];
const pack = items.filter((i) => i?.type === 'local_pack');
const alan = pack.find(
  (p) => /alan\s*ranger/i.test(p.title || '') || String(p.cid) === '18051522973347696510'
);
console.log(JSON.stringify({
  status: task?.status_code,
  msg: task?.status_message,
  cost: task?.cost,
  pack_count: pack.length,
  alan_pos: alan?.rank_group ?? 'ABSENT',
  pack_top: pack.slice(0, 3).map((p) => ({ title: p.title, rank: p.rank_group })),
}, null, 2));
