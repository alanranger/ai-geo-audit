/**
 * Compare auto-ingested DFS CSV vs manually filtered unfiltered-audit CSV by row_hash.
 *
 *   node scripts/compare-dfs-manual-vs-auto-csv.mjs
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const autoPath =
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/dfs_domain_backlink_rows_alanranger_com.csv';
const manualPath =
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/dfs_domain_backlink_UNFILTERED_audit_alanrangercom-manually filtered.csv';

function load(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  return parse(raw, {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true
  });
}

function byHash(rows) {
  const m = new Map();
  for (const r of rows) {
    const h = String(r.row_hash || '').trim();
    if (h) m.set(h, r);
  }
  return m;
}

const autoRows = load(autoPath);
const manualRows = load(manualPath);
const autoMap = byHash(autoRows);
const manualMap = byHash(manualRows);

const inManualNotAuto = [];
for (const [h, r] of manualMap) {
  if (!autoMap.has(h)) {
    inManualNotAuto.push({
      row_hash: h,
      url_from: r.url_from,
      url_to: r.url_to,
      anchor: r.anchor,
      backlink_spam_score: r.backlink_spam_score
    });
  }
}

const inAutoNotManual = [];
for (const [h, r] of autoMap) {
  if (!manualMap.has(h)) {
    inAutoNotManual.push({
      row_hash: h,
      url_from: r.url_from,
      url_to: r.url_to,
      anchor: r.anchor,
      backlink_spam_score: r.backlink_spam_score
    });
  }
}

const inBoth = manualMap.size - inManualNotAuto.length;

console.log(
  JSON.stringify(
    {
      autoRowCount: autoRows.length,
      manualRowCount: manualRows.length,
      uniqueHashAuto: autoMap.size,
      uniqueHashManual: manualMap.size,
      inBothCount: inBoth,
      manualNotAutoCount: inManualNotAuto.length,
      autoNotManualCount: inAutoNotManual.length,
      manualNotAuto: inManualNotAuto,
      autoNotManual: inAutoNotManual
    },
    null,
    2
  )
);
