import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import 'dotenv/config';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  status() { return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
const tierKey = 'workshops_non_residential';
const tier = res._body.tier_rollup.find((t) => t.tier_key === tierKey);
const pages = res._body.diagnostics.filter((d) => d.tier_key === tierKey);

const out = {
  asOf: res._body.asOf,
  tier,
  pages: pages.map((p) => ({
    slug: p.page_slug,
    state: p.state,
    rank: p.rank_score,
    mixed: p.page_seasonality?.is_mixed_seasonality,
    seasonality: p.page_seasonality,
    full_window: p.metrics?.full_window,
    gsc_window: p.metrics?.gsc_overlay_window,
    verdict: p.verdict_text
  }))
};

fs.writeFileSync('logs/wsnr-tier-snapshot-data.json', JSON.stringify(out, null, 2));
console.log('written logs/wsnr-tier-snapshot-data.json');
