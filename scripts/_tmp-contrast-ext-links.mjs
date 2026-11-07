import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const { isExternalLinkTargetBlankExemptHost } = await import('../api/aigeo/content-extractability.js');

const PAGE = 'https://www.alanranger.com/blog-on-photography/what-is-contrast-in-photography';
const res = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ARP-audit/1.0)' } });
const html = await res.text();
const pageHost = new URL(PAGE).hostname.replace(/^www\./i, '').toLowerCase();

function sameSite(pageHost, linkHost) {
  const p = pageHost;
  const h = linkHost;
  if (!p || !h) return false;
  if (p === h) return true;
  if (h.endsWith(`.${p}`)) return true;
  if (p.endsWith(`.${h}`)) return true;
  return false;
}

const re = /<a\b([^>]*)>/gi;
const externals = [];
let m;
while ((m = re.exec(html))) {
  const attrs = m[1];
  const hrefM = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
  if (!hrefM) continue;
  const href = hrefM[1].trim();
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
  let abs;
  try { abs = new URL(href, PAGE); } catch { continue; }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
  const host = abs.hostname.replace(/^www\./i, '').toLowerCase();
  if (sameSite(pageHost, host)) continue;
  const exempt = isExternalLinkTargetBlankExemptHost(host);
  const hasBlank = /\btarget\s*=\s*["']?_blank["']?/i.test(attrs);
  const after = html.slice(m.index, m.index + 350);
  const textM = after.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const text = textM ? textM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) : '';
  externals.push({ href: abs.href, host, exempt, hasBlank, text });
}

const scored = externals.filter((e) => !e.exempt);
const missing = scored.filter((e) => !e.hasBlank);
console.log(JSON.stringify({
  status: res.status,
  total_non_same_site: externals.length,
  scored_as_external: scored.length,
  missing_blank: missing.length,
  missing,
  scored,
}, null, 2));
