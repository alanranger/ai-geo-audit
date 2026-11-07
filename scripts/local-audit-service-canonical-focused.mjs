/**
 * LOCAL focused Service + canonical audit (revised libs, not production).
 * Fetches live HTML for known workshop / service-intent URLs.
 * - Inline JSON-LD only (no schema.alanranger.com fan-out)
 * - Uses lib/schema-qa-gate.js + lib/traditional-seo-canonical-rule.js
 * - No DB writes, no paid APIs, no deploy
 *
 * Usage (from repo root):
 *   node scripts/local-audit-service-canonical-focused.mjs
 *   node scripts/local-audit-service-canonical-focused.mjs --limit=5
 *   node scripts/local-audit-service-canonical-focused.mjs --url=https://www.alanranger.com/photo-workshops-uk/batsford-arboretum-photography-workshops
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSchemaQaGate,
  collectTypedNodes,
  isIdOnlySchemaReference
} from '../lib/schema-qa-gate.js';
import {
  extractHtmlCanonicalFromHtml,
  evaluateTraditionalSeoCanonicalRule
} from '../lib/traditional-seo-canonical-rule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'config', '09-url-target-keywords.csv');
const OUT_DIR = path.join(ROOT, 'scripts', 'output');
const UA = 'Mozilla/5.0 (compatible; AI-GEO-Audit-local/1.0; focused Service+canonical check)';

function parseArgs(argv) {
  const out = { limit: null, urls: [], concurrency: 4 };
  argv.forEach((arg) => {
    if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8)) || null;
    else if (arg.startsWith('--url=')) out.urls.push(arg.slice(6).trim());
    else if (arg.startsWith('--concurrency=')) out.concurrency = Math.max(1, Number(arg.slice(14)) || 4);
  });
  return out;
}

function loadWorkshopUrlsFromCsv() {
  const text = fs.readFileSync(CSV_PATH, 'utf8');
  const urls = [];
  text.split(/\r?\n/).forEach((line) => {
    const url = String(line.split(',')[0] || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    try {
      const pathName = new URL(url).pathname.toLowerCase();
      if (pathName.includes('/photo-workshops-uk/')) urls.push(url);
    } catch {
      /* ignore */
    }
  });
  const hub = 'https://www.alanranger.com/photo-workshops-uk';
  if (!urls.includes(hub)) urls.unshift(hub);
  return [...new Set(urls)];
}

function extractInlineJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      /* skip broken blocks */
    }
  }
  return blocks;
}

function summarizeServiceNodes(schemas) {
  const services = [];
  (schemas || []).forEach((block) => {
    collectTypedNodes(block).forEach(({ type, node }) => {
      if (type !== 'Service') return;
      services.push({
        isIdOnlyRef: isIdOnlySchemaReference(node),
        name: typeof node?.name === 'string' ? node.name : node?.name ?? null,
        id: typeof node?.['@id'] === 'string' ? node['@id'] : node?.['@id'] ?? null,
        hasProvider: Boolean(node?.provider)
      });
    });
  });
  return services;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000)
  });
  const html = await res.text();
  return { ok: res.ok, status: res.status, html };
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function oldHeuristicServiceFail(services) {
  const full = (services || []).filter((s) => !s.isIdOnlyRef);
  if (!full.length) return { nameFail: false, idWarn: false };
  const nameFail = full.some((s) => !String(s.name || '').trim());
  const idWarn = full.some((s) => !String(s.id || '').trim());
  return { nameFail, idWarn };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let urls = args.urls.length ? args.urls : loadWorkshopUrlsFromCsv();
  if (args.limit) urls = urls.slice(0, args.limit);

  console.log(JSON.stringify({
    mode: 'local-revised-code-not-production',
    urlCount: urls.length,
    note: 'Inline JSON-LD only; revised lib/schema-qa-gate.js + canonical rule'
  }));

  const pages = await mapPool(urls, args.concurrency, async (url) => {
    try {
      const fetched = await fetchPage(url);
      const schemas = extractInlineJsonLd(fetched.html);
      const services = summarizeServiceNodes(schemas);
      const canonicalExtract = extractHtmlCanonicalFromHtml(fetched.html, url);
      const canonical = evaluateTraditionalSeoCanonicalRule({
        pageUrl: url,
        extractSignal: {
          requestOk: fetched.ok,
          ...canonicalExtract
        }
      });
      const old = oldHeuristicServiceFail(services);
      return {
        url,
        success: fetched.ok,
        statusCode: fetched.status,
        schemas,
        services,
        canonical,
        oldNameFail: old.nameFail,
        oldIdWarn: old.idWarn,
        error: fetched.ok ? null : `HTTP ${fetched.status}`
      };
    } catch (err) {
      return {
        url,
        success: false,
        statusCode: null,
        schemas: [],
        services: [],
        canonical: evaluateTraditionalSeoCanonicalRule({ pageUrl: url, extractSignal: null }),
        oldNameFail: false,
        oldIdWarn: false,
        error: String(err?.message || err)
      };
    }
  });

  const qaResults = pages.map((p) => ({
    url: p.url,
    success: p.success,
    statusCode: p.statusCode,
    schemas: p.schemas,
    error: p.error
  }));
  const gate = buildSchemaQaGate(qaResults, 'local-focused', 'full', 'product', null, () => 'product');

  const rows = gate.rows.map((row) => {
    const page = pages.find((p) => p.url === row.url) || {};
    const serviceIssues = (row.issueDetails || []).filter((i) => i.typeName === 'Service');
    return {
      url: row.url,
      qaStatus: row.status,
      qaSummary: row.summary,
      serviceIssueCodes: [...new Set(serviceIssues.map((i) => i.code))],
      serviceIssueDetails: serviceIssues.map((i) => i.detail),
      servicesOnPage: page.services || [],
      fullServiceCount: (page.services || []).filter((s) => !s.isIdOnlyRef).length,
      allFullServicesHaveName: (page.services || []).filter((s) => !s.isIdOnlyRef).every((s) => String(s.name || '').trim()),
      allFullServicesHaveId: (page.services || []).filter((s) => !s.isIdOnlyRef).every((s) => String(s.id || '').trim()),
      canonicalStatus: page.canonical?.status || null,
      canonicalCode: page.canonical?.code || null,
      canonicalNote: page.canonical?.note || null,
      oldStyleNameWouldFail: page.oldNameFail === true,
      oldStyleIdWouldWarn: page.oldIdWarn === true,
      fetchError: page.error || null
    };
  });

  const serviceNameBlocks = rows.filter((r) => r.serviceIssueCodes.includes('missing_required_field')
    && r.serviceIssueDetails.some((d) => /Service\.name/i.test(d))).length;
  const serviceIdWarns = rows.filter((r) => r.serviceIssueCodes.includes('missing_id')).length;
  const qaPass = rows.filter((r) => r.qaStatus === 'pass').length;
  const qaWarn = rows.filter((r) => r.qaStatus === 'warning').length;
  const qaBlock = rows.filter((r) => r.qaStatus === 'block_deploy').length;
  const canonicalPass = rows.filter((r) => r.canonicalStatus === 'pass').length;
  const canonicalWarn = rows.filter((r) => r.canonicalStatus === 'warn').length;
  const canonicalFail = rows.filter((r) => r.canonicalStatus === 'fail').length;
  const stillMissingName = rows.filter((r) => r.fullServiceCount > 0 && !r.allFullServicesHaveName);
  const stillMissingId = rows.filter((r) => r.fullServiceCount > 0 && !r.allFullServicesHaveId);
  const noFullService = rows.filter((r) => r.fullServiceCount === 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    source: 'local-revised-code-not-production',
    pagesChecked: rows.length,
    baselineExpectedOldServiceFailures: 35,
    schemaQa: { pass: qaPass, warning: qaWarn, block_deploy: qaBlock },
    serviceSpecific: {
      nameBlocksRemaining: serviceNameBlocks,
      idWarningsRemaining: serviceIdWarns,
      pagesStillMissingName: stillMissingName.map((r) => r.url),
      pagesStillMissingId: stillMissingId.map((r) => r.url),
      pagesWithNoFullServiceEntity: noFullService.map((r) => r.url)
    },
    canonical: { pass: canonicalPass, warn: canonicalWarn, fail: canonicalFail },
    comparisonNote:
      'Old issue: shared footer Service missing name/@id on ~35 workshop pages, and canonical_self_or_valid incorrectly WARN from schema missing_id. Revised canonical uses HTML only.'
  };

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `local-service-canonical-audit-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2), 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (stillMissingName.length || stillMissingId.length) {
    console.log('\nRemaining Service gaps:');
    stillMissingName.forEach((r) => console.log(`  NAME missing: ${r.url}`));
    stillMissingId.forEach((r) => console.log(`  @id missing: ${r.url}`));
  }
  const nonPassCanon = rows.filter((r) => r.canonicalStatus !== 'pass');
  if (nonPassCanon.length) {
    console.log('\nCanonical non-pass:');
    nonPassCanon.forEach((r) => console.log(`  ${r.canonicalStatus}/${r.canonicalCode}: ${r.url}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
