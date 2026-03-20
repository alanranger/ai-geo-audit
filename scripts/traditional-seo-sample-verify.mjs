/**
 * Sample Traditional SEO signals using the same server checkUrl() as /api/aigeo/content-extractability.
 *
 * Per-URL Traditional SEO table rows are computed in the browser (not stored row-by-row in Supabase).
 * Supabase holds rules, overrides, and score snapshots only.
 *
 * Usage (from repo root):
 *   node scripts/traditional-seo-sample-verify.mjs --file=scripts/sample-traditional-seo-urls.txt --limit=25
 *
 * Defaults: a few alanranger.com URLs. Tune bands with --meta-min=150 --meta-max=165 etc.
 */

import { readFileSync, existsSync } from 'fs';

import { checkUrl } from '../api/aigeo/content-extractability.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseIntArg(argv, key, fallback) {
  const hit = argv.find((a) => a.startsWith(`${key}=`));
  if (!hit) return fallback;
  const n = Number.parseInt(hit.slice(key.length + 1), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseArgs(argv) {
  const file = argv.find((a) => a.startsWith('--file='))?.slice(7) || '';
  return {
    file,
    limit: parseIntArg(argv, '--limit', 25),
    delayMs: parseIntArg(argv, '--delay', 450),
    metaMin: parseIntArg(argv, '--meta-min', 150),
    metaMax: parseIntArg(argv, '--meta-max', 165),
    titleMin: parseIntArg(argv, '--title-min', 50),
    titleMax: parseIntArg(argv, '--title-max', 60),
    h1Min: parseIntArg(argv, '--h1-len-min', 40),
    h1Max: parseIntArg(argv, '--h1-len-max', 60)
  };
}

function loadUrls(file, limit) {
  if (file && existsSync(file)) {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l))
      .slice(0, limit);
  }
  return [
    'https://www.alanranger.com/',
    'https://www.alanranger.com/beginners-photography-classes',
    'https://www.alanranger.com/awards-and-qualifications'
  ].slice(0, limit);
}

function titleLenFromHtml(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return 0;
  return String(m[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) return '';
  return res.text();
}

function evalFlags(row, titleHtmlLen, o) {
  const f = [];
  if (!row || row.excludedFromAudit) return ['excluded_or_no_row'];
  if (row.requestOk === false) return [`fetch_fail:${row.errorType || 'unknown'}`];

  const metaLen = String(row.seoMetaDescription || '').trim().length;
  if (metaLen > 0 && (metaLen < o.metaMin || metaLen > o.metaMax)) f.push(`meta_len_${metaLen}`);

  const h1c = Number(row.seoH1Count);
  if (!Number.isFinite(h1c) || h1c < 0) f.push('h1_unknown');
  else if (h1c !== 1) f.push(`h1_count_${h1c}`);

  const longest = Math.max(Number(row.seoLongestH1Length) || 0, Number(row.seoFirstH1Length) || 0);
  if (h1c > 0 && (longest < o.h1Min || longest > o.h1Max)) f.push(`h1_longest_${longest}`);

  const out = Number(row.seoExtOutbound) || 0;
  const miss = Number(row.seoExtMissingTargetBlank) || 0;
  if (out > 0 && miss > 0) f.push(`ext_blank_${miss}_of_${out}`);

  if (titleHtmlLen > 0 && (titleHtmlLen < o.titleMin || titleHtmlLen > o.titleMax)) {
    f.push(`title_html_len_${titleHtmlLen}`);
  }

  return f.length ? f : ['ok_extract_signals'];
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const urls = loadUrls(o.file, o.limit);
  if (!urls.length) {
    console.error('No URLs. Pass --file=path/to/urls.txt (one URL per line).');
    process.exit(1);
  }
  console.log(
    'url\trequestOk\texcluded\tmetaLen\th1\tlongH1\textOut\tmissBlank\ttitleLenApi\tflags'
  );
  for (const url of urls) {
    const row = await checkUrl(url, null);
    let html = '';
    if (row.requestOk === true && !row.excludedFromAudit) {
      try {
        html = await fetchHtml(url);
      } catch {
        html = '';
      }
    }
    const titleFallback = titleLenFromHtml(html);
    const flags = evalFlags(row, titleFallback, o).join(',');
    const metaLen = String(row.seoMetaDescription || '').trim().length;
    console.log(
      [
        url,
        row.requestOk,
        Boolean(row.excludedFromAudit),
        metaLen,
        row.seoH1Count,
        row.seoLongestH1Length,
        row.seoExtOutbound,
        row.seoExtMissingTargetBlank,
        Number.isFinite(Number(row.seoTitleTagLength)) && Number(row.seoTitleTagLength) >= 0
          ? row.seoTitleTagLength
          : titleFallback,
        flags
      ].join('\t')
    );
    if (o.delayMs > 0) await sleep(o.delayMs);
  }
  console.error(
    '\nNote: Dashboard title rule prefers API seoTitleTagLength (HTML <title>), else schema (50–60).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
