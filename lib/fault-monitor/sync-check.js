/**
 * D5 Supabase sync. Per content type:
 *  - source CSV (alan-shared-resources) vs csv_metadata (what the ingest imported)
 *  - live site (sitemap) vs csv_metadata for blog posts
 *  - csv_metadata vs page_entities: missing rows (red) and rows the last ingest did not refresh (amber)
 */
import { parse } from 'csv-parse/sync';
import { SITE_ORIGIN, THRESHOLDS } from './monitor-config.js';
import { faultKey } from './store.js';
import { urlKey } from './prefetch.js';

const RAW = 'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/';

/** csv_type → [file, url column]. 07 product schema has no URL column (URL lives inside JSON-LD). */
export const SOURCE_CSVS = {
  blog: ['01-blog-posts.csv', 'Full Url'],
  course_events: ['02-beginners-photography-lessons.csv', 'Event_URL'],
  workshop_events: ['03-photographic-workshops-near-me.csv', 'Event_URL'],
  course_products: ['04-photography-services-courses-mentoring.csv', 'Full Url'],
  workshop_products: ['05-photo-workshops-uk-landscape.csv', 'Full Url'],
  site_urls: ['06-site-urls.csv', 'url'],
  landing_service_pages: ['08-landing-and-service-pages.csv', 'url']
};

function absolute(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `${SITE_ORIGIN}/${s.replace(/^\/+/, '')}`;
}

export function urlsFromCsv(text, column) {
  const rows = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  return [...new Set(rows.map((r) => absolute(r[column])).filter(Boolean).map((u) => urlKey(u)))];
}

async function fetchText(url) {
  const res = await fetch(`${url}?_ts=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function pageAll(sb, table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}_read:${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function groupMetadata(rows) {
  const byType = new Map();
  for (const r of rows) {
    if (!byType.has(r.csv_type)) byType.set(r.csv_type, new Map());
    byType.get(r.csv_type).set(urlKey(r.url), r.url);
  }
  return byType;
}

function latestSeenByUrl(entityRows) {
  const map = new Map();
  let newest = 0;
  for (const r of entityRows) {
    const t = Date.parse(r.last_seen || 0) || 0;
    const k = urlKey(r.page_url);
    if (t > (map.get(k) || 0)) map.set(k, t);
    if (t > newest) newest = t;
  }
  return { map, newest };
}

function shortPath(u) {
  return String(u).replace(/^https?:\/\/(www\.)?alanranger\.com/, '') || '/';
}

function diffFinding(subject, label, expectedKeys, actualKeys) {
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  const key = faultKey('D5', subject);
  if (!missing.length && !extra.length) return { check: 'D5', key, status: 'pass' };
  const parts = [];
  if (missing.length) parts.push(`${missing.length} missing`);
  if (extra.length) parts.push(`${extra.length} extra`);
  return {
    check: 'D5', key, url: null, pageType: 'data', status: 'fault', severity: 'red',
    title: `${label}: ${expected.size} vs ${actual.size} (${parts.join(', ')})${missing.length ? ` — e.g. ${shortPath(missing[0])}` : ''}`,
    detail: { expected: `${expected.size} URLs`, found: `${actual.size} URLs`, missing: missing.slice(0, 100), extra: extra.slice(0, 100) }
  };
}

async function sourceParity(byType) {
  const out = [];
  for (const [type, [file, col]] of Object.entries(SOURCE_CSVS)) {
    let keys;
    try {
      keys = urlsFromCsv(await fetchText(`${RAW}${encodeURIComponent(file)}`), col);
    } catch (e) {
      out.push({ check: 'D5', key: faultKey('D5', `csv:${type}`), pageType: 'data', status: 'fault', severity: 'amber', title: `Could not read source ${file}`, detail: { found: String(e?.message || e) } });
      continue;
    }
    const meta = [...(byType.get(type)?.keys() || [])];
    out.push(diffFinding(`csv:${type}`, `${file} vs csv_metadata ${type}`, keys, meta));
  }
  return out;
}

async function liveBlogParity(byType) {
  let xml;
  try { xml = await fetchText(`${SITE_ORIGIN}/sitemap.xml`); } catch { return []; }
  const live = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    .filter((u) => /\/blog-on-photography\/[^/]+\/?$/.test(u)).map((u) => urlKey(u));
  const meta = [...(byType.get('blog')?.keys() || [])];
  return [diffFinding('live:blog', 'Live blog posts (sitemap) vs csv_metadata blog', live, meta)];
}

function entityFinding(key, url, type, seen, newest) {
  const fk = faultKey('D5', url);
  if (!seen) {
    return { check: 'D5', key: fk, url, pageType: type, status: 'fault', severity: 'red', title: `No page_entities row (${type})`, detail: { expected: 'page_entities row for this URL', found: 'none', csv_type: type } };
  }
  const staleMs = THRESHOLDS.staleEntityDays * 86400000;
  if (newest - seen > staleMs) {
    const d = new Date(seen).toISOString().slice(0, 10);
    return { check: 'D5', key: fk, url, pageType: type, status: 'fault', severity: 'amber', title: `page_entities row not refreshed since ${d} (${type})`, detail: { expected: `updated by the last ingest (${new Date(newest).toISOString().slice(0, 10)})`, found: `last_seen ${d}`, csv_type: type } };
  }
  return { check: 'D5', key: fk, url, status: 'pass' };
}

function entityCoverage(byType, seenMap, newest) {
  const out = [];
  const done = new Set();
  const types = [...byType.keys()].sort((a, b) => Number(a === 'site_urls') - Number(b === 'site_urls'));
  for (const type of types) {
    for (const [k, url] of byType.get(type)) {
      if (done.has(k)) continue;
      done.add(k);
      out.push(entityFinding(k, url, type, seenMap.get(k), newest));
    }
  }
  return out;
}

export async function checkSupabaseSync(sb, opts = {}) {
  const meta = await pageAll(sb, 'csv_metadata', 'csv_type, url');
  const entities = await pageAll(sb, 'page_entities', 'page_url, last_seen');
  const byType = groupMetadata(meta);
  const { map, newest } = latestSeenByUrl(entities);
  const coverage = entityCoverage(byType, map, newest);
  if (opts.onlyUrl) return coverage.filter((r) => r.key === faultKey('D5', opts.onlyUrl));
  return [...(await sourceParity(byType)), ...(await liveBlogParity(byType)), ...coverage];
}
