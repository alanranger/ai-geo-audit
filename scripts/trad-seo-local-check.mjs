/**
 * Local harness: render URLs with the audit's own renderer and print the A4 / C1 / thin results.
 * Read-only (loads baselines, writes nothing). Paced 15 s between pages.
 * Usage: node scripts/trad-seo-local-check.mjs <url> [url ...]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadLocalSupabaseEnv } from '../lib/load-local-supabase-env.mjs';
import { launchRenderer, renderAndMeasure } from '../lib/fault-monitor/renderer.js';
import { runPageChecks } from '../lib/fault-monitor/page-checks.js';
import { loadBaselines } from '../lib/fault-monitor/store.js';
import { pageTypeOf } from '../lib/fault-monitor/plan.js';
import { urlKey } from '../lib/fault-monitor/prefetch.js';
import { findingsFromPage } from '../lib/trad-seo-render/findings.js';
import { extractRowFromRendered } from '../lib/trad-seo-render/extract-row.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadLocalSupabaseEnv(root);
delete process.env.VERCEL;
delete process.env.AWS_LAMBDA_FUNCTION_VERSION;
const sb = createClient(env.url, env.key);
const urls = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkOne(renderer, url) {
  const render = await renderAndMeasure(renderer, url);
  if (!render.measure) return { url, status: render.status, error: render.error || 'no measure' };
  const baseline = (await loadBaselines(sb, [url])).get(urlKey(url)) || null;
  const pageType = pageTypeOf(url);
  const out = runPageChecks({ url, pageType, prefetch: { status: render.status }, render, policy: {}, baseline });
  const extract = extractRowFromRendered(url, render.measure.html, render.status, { contentWords: render.measure.contentWords });
  const f = findingsFromPage({ url, pageType, render, results: out.results, extract, inCsv: new Set(), intentionalNoindex: false });
  const pick = (k) => (f[k] ? `${f[k].status}: ${f[k].note || ''}` : '-');
  return {
    url: url.replace('https://www.alanranger.com', ''),
    status: render.status,
    faq: pick('faq_schema_parity'),
    blocks: pick('key_blocks_loaded'),
    thin: pick('thin_content_guardrail'),
    faqDrop: render.measure.faqDrop || null,
    faqVisibility: render.measure.faqVisibility,
    faqSectionCount: render.measure.faqSectionCount,
    contentWords: render.measure.contentWords
  };
}

const renderer = await launchRenderer();
try {
  for (let i = 0; i < urls.length; i += 1) {
    if (i) await sleep(15000);
    console.log(JSON.stringify(await checkOne(renderer, urls[i])));
  }
} finally {
  await renderer.close();
}
