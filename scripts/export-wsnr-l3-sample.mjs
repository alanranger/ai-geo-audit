import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const slug = 'landscape-photography-workshops';
const url = `https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-product-breakdown?page=${encodeURIComponent(slug)}&includeJlr=false&windowMonths=17`;
const res = await fetch(url, { cache: 'no-store' });
const data = await res.json();
fs.writeFileSync('logs/wsnr-l3-breakdown-sample.json', JSON.stringify(data, null, 2));
console.log('products:', (data.products || []).length);
