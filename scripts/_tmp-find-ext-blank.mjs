import { readFileSync, writeFileSync } from 'node:fs';

const raw = readFileSync(
  'C:/Users/alan/.cursor/projects/g-Dropbox-alan-ranger-photography-Website-Code-Chat-AI-Bot/agent-tools/f7a7189d-1a29-485d-83c7-f22ca3ebd7d0.txt',
  'utf8'
);

let html = '';
try {
  const j = JSON.parse(raw);
  html = j.html || j.data?.html || '';
} catch {
  // Firecrawl tool dump may not be pure JSON — pull html field
  const idx = raw.indexOf('"html":');
  if (idx >= 0) {
    const start = raw.indexOf('"', idx + 7);
    // too fragile; try fetch live instead below
  }
}

if (!html || html.length < 1000) {
  const res = await fetch('https://www.alanranger.com/blog-on-photography/finding-your-compositional-balance', {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ARP-audit/1.0)' },
  });
  html = await res.text();
  console.log('fetched live html', html.length, 'status', res.status);
}

const OWN = /(?:^|\.)alanranger\.com$/i;
const re = /<a\b([^>]*)>/gi;
const externals = [];
let m;
while ((m = re.exec(html))) {
  const attrs = m[1];
  const hrefM = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (!hrefM) continue;
  const href = hrefM[1].trim();
  if (!/^https?:\/\//i.test(href) && !href.startsWith('//')) continue;
  let host = '';
  try {
    host = new URL(href.startsWith('//') ? `https:${href}` : href).hostname;
  } catch {
    continue;
  }
  if (OWN.test(host)) continue;
  const hasBlank = /target\s*=\s*["']_blank["']/i.test(attrs);
  // try to get link text from following content up to </a>
  const after = html.slice(m.index, m.index + 300);
  const textM = after.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const text = textM
    ? textM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    : '';
  externals.push({ href, host, hasBlank, text });
}

const missing = externals.filter((e) => !e.hasBlank);
console.log(JSON.stringify({
  total_external: externals.length,
  with_blank: externals.filter((e) => e.hasBlank).length,
  missing_blank: missing.length,
  missing,
  all: externals,
}, null, 2));
