/**
 * Read-only GSC URL Inspection status for WS3 recrawl watchlist.
 * Does NOT call the live Inspection API (no quota / no audit spend).
 *
 * Usage: node scripts/report-gsc-recrawl-watchlist.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const WATCH = path.join(root, 'config/ws3-recrawl-watch-urls.json');
const OUT_MD = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude',
  'GSC-RECRAWL-WATCHLIST-STATUS-LATEST.md'
);
const OUT_JSON = path.join(root, 'scripts/output/gsc-recrawl-watchlist-status-LATEST.json');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const watch = JSON.parse(fs.readFileSync(WATCH, 'utf8'));
const property = 'https://www.alanranger.com';
const entries = watch.urls || [];
const pageUrls = entries.map((e) => `${property}${e.path}`);

const { data, error } = await sb
  .from('gsc_url_inspection_cache')
  .select('page_url, coverage_state, verdict, page_fetch_state, indexed, google_canonical, inspected_at, updated_at, audit_status')
  .in('page_url', pageUrls);
if (error) throw error;

const byUrl = new Map((data || []).map((r) => [r.page_url, r]));
const rows = entries.map((e) => {
  const u = `${property}${e.path}`;
  const r = byUrl.get(u) || null;
  return {
    path: e.path,
    group: e.group || '',
    page_url: u,
    in_cache: Boolean(r),
    indexed: r?.indexed ?? null,
    coverage_state: r?.coverage_state || null,
    verdict: r?.verdict || null,
    page_fetch_state: r?.page_fetch_state || null,
    audit_status: r?.audit_status || null,
    inspected_at: r?.inspected_at || null,
    updated_at: r?.updated_at || null,
  };
});

const generatedAt = new Date().toISOString();
const payload = {
  generatedAt,
  source: 'gsc_url_inspection_cache (read-only — no live Inspection API calls)',
  watchlist: watch.label,
  indexedRequestedAt: watch.indexedRequestedAt,
  count: rows.length,
  rows,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');

const lines = [
  '# GSC / WS3 recrawl watchlist status',
  '',
  `**Generated:** ${generatedAt}`,
  `**Source:** \`gsc_url_inspection_cache\` (read-only — no Inspection API spend)`,
  `**Watchlist:** ${watch.label}`,
  `**Bulk Request Indexing date:** ${watch.indexedRequestedAt || '—'}`,
  `**Live panel:** dashboard → \`/api/aigeo/ws3-recrawl-watch\``,
  '',
  '| Path | Group | Indexed | Coverage | Fetch | Inspected at |',
  '|---|---|---|---|---|---|',
];
for (const r of rows) {
  lines.push(
    `| \`${r.path}\` | ${r.group} | ${r.indexed == null ? '—' : r.indexed} | ${r.coverage_state || (r.in_cache ? '—' : 'NOT IN CACHE')} | ${r.page_fetch_state || '—'} | ${r.inspected_at || '—'} |`
  );
}
lines.push('');
lines.push('Cache has no `last_crawl_time` column — use `inspected_at` + coverage/fetch.');
lines.push('Dashboard Traditional SEO → GSC URL Inspection refreshes cache (spends Inspection quota).');
lines.push('');
fs.writeFileSync(OUT_MD, `${lines.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  wrote: OUT_MD,
  count: rows.length,
  in_cache: rows.filter((r) => r.in_cache).length,
}, null, 2));
