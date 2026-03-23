/**
 * One-off: paginate DataForSEO backlinks/live with NO url_from spam filters.
 * Writes CSV only — does not change Supabase dfs_domain_backlink_rows.
 *
 * Requires .env.local: DATAFORSEO_API_LOGIN + DATAFORSEO_API_PASSWORD (or DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).
 *
 *   node scripts/dfs-domain-backlink-unfiltered-export.mjs
 *   node scripts/dfs-domain-backlink-unfiltered-export.mjs --domain alanranger.com --out "C:/path/out.csv"
 */

import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dfsIngestCreds,
  paginateDomainBacklinks
} from '../lib/dfs-domain-backlink-ingest.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const COLS = [
  'row_hash',
  'domain_host',
  'url_from',
  'url_to',
  'url_to_key',
  'anchor',
  'dofollow',
  'first_seen',
  'last_seen',
  'backlink_spam_score',
  'filters_version',
  'run_id',
  'ingested_at',
  'domain_from_rank',
  'page_from_rank',
  'backlink_rank'
];

function parseArgs() {
  const a = process.argv.slice(2);
  let domain = 'alanranger.com';
  let out = '';
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--domain' && a[i + 1]) domain = a[++i];
    else if (a[i] === '--out' && a[i + 1]) out = a[++i];
  }
  return { domain, out };
}

function cell(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return cell(v.toISOString());
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

const { domain, out: outArg } = parseArgs();
const creds = dfsIngestCreds();
if (!creds) {
  console.error('Set DataForSEO login/password env vars (see script header).');
  process.exit(1);
}

const defaultOut = resolve(
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv',
  `dfs_domain_backlink_UNFILTERED_audit_${domain.replaceAll(/[^a-z0-9._-]+/gi, '_')}.csv`
);
const outPath = outArg ? resolve(outArg) : defaultOut;

const runId = randomUUID();
const { rows, pages, totalCost, truncated, itemsFromApi } = await paginateDomainBacklinks(
  creds,
  domain,
  null,
  runId
);
for (const r of rows) {
  r.filters_version = 'unfiltered_audit';
}

const header = COLS.join(',');
const body = rows.map((r) => COLS.map((c) => cell(r[c])).join(',')).join('\n');
writeFileSync(outPath, `\uFEFF${header}\n${body}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      outPath,
      rows: rows.length,
      itemsFromApi,
      pagesFetched: pages,
      approxCost: Number(totalCost.toFixed(6)),
      truncated,
      runId,
      note: 'No DataForSEO url_from spam filters; production index still uses dfsSpamUrlFilters().'
    },
    null,
    2
  )
);
