/**
 * One-off: compare raw <meta name="description"> in HTML vs extractMetaDescriptionFromHtml.
 * Run: node scripts/debug-meta-extract.mjs <url>
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const url = process.argv[2] || 'https://www.alanranger.com/blog-on-photography/beginners-photography-course-in-coventry';

const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0)' },
  signal: AbortSignal.timeout(20000)
});
const html = await res.text();

// All meta description-ish tags (first 20 matches, raw content attr)
const patterns = [
  /name=["']description["'][^>]*content=["']([^"']*)["']/gi,
  /content=["']([^"']*)["'][^>]*name=["']description["']/gi,
  /property=["']og:description["'][^>]*content=["']([^"']*)["']/gi
];

function stripNoise(htmlStr) {
  return String(htmlStr || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

const source = stripNoise(html);
const longForm = [...source.matchAll(/<meta\b[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/gi)];
const longForm2 = [...source.matchAll(/<meta\b[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/gi)];

console.log('URL', url, 'status', res.status);
console.log('HTML length', html.length);
console.log('Matches name=description with NON-greedy [\s\S] (current API style), count:', longForm.length + longForm2.length);
[...longForm, ...longForm2].slice(0, 3).forEach((m, i) => {
  const t = m[1].replace(/\s+/g, ' ').trim();
  console.log(`  [${i}] len=${t.length} preview=${JSON.stringify(t.slice(0, 120))}`);
});

console.log('Simple [^"\']+ style (breaks on quotes inside content):');
let n = 0;
for (const re of patterns) {
  const ms = [...html.matchAll(re)];
  for (const m of ms) {
    if (n++ < 6) console.log(`  len=${m[1].length}`, JSON.stringify(m[1].slice(0, 100)));
  }
}

const idx = html.indexOf('name="description"');
if (idx >= 0) {
  const chunk = html.slice(Math.max(0, idx - 60), idx + 420);
  console.log('\nRAW snippet around first name="description":');
  console.log(chunk.replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
}
