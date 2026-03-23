/**
 * Export public.dfs_domain_backlink_rows to CSV via Postgres (read-only URL).
 *
 * Usage (AI GEO Audit repo root, .env.local with SUPABASE_PG_RO_URL):
 *   node scripts/export-dfs-domain-backlinks-csv.mjs
 *   node scripts/export-dfs-domain-backlinks-csv.mjs --domain example.com --out "C:/path/out.csv"
 *
 * If connect fails (SSL/password), export via Supabase SQL or refresh SUPABASE_PG_RO_URL.
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
const conn = process.env.SUPABASE_PG_RO_URL;
if (!conn) {
  console.error('Set SUPABASE_PG_RO_URL in .env.local');
  process.exit(1);
}

const defaultOut = resolve(
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv',
  `dfs_domain_backlink_rows_${domain.replaceAll(/[^a-z0-9._-]+/gi, '_')}.csv`
);
const outPath = outArg ? resolve(outArg) : defaultOut;

const sql = `SELECT ${COLS.join(', ')} FROM public.dfs_domain_backlink_rows WHERE domain_host = $1 ORDER BY ingested_at ASC`;

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows, rowCount } = await client.query(sql, [domain]);
await client.end();

const header = COLS.join(',');
const body = rows.map((r) => COLS.map((c) => cell(r[c])).join(',')).join('\r\n');
writeFileSync(outPath, `\uFEFF${header}\r\n${body}`, 'utf8');
console.log(`Wrote ${rowCount} rows to ${outPath}`);
