import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  extractHtmlCanonicalFromHtml,
  evaluateTraditionalSeoCanonicalRule,
  normalizeUrlForCanonicalCompare
} from '../lib/traditional-seo-canonical-rule.js';
import { patchSchemaQaEvalRow } from '../api/aigeo/traditional-seo-sync-schema-qa.js';

const pageUrl = 'https://www.alanranger.com/photo-workshops-uk/peak-district';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractDashboardFunction(source, fnName) {
  const startToken = `function ${fnName}`;
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`function ${fnName} not found in dashboard`);
  let i = source.indexOf('{', start);
  if (i < 0) throw new Error(`function body not found for ${fnName}`);
  let depth = 0;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`unclosed function ${fnName}`);
}

function loadDashboardCanonicalFns() {
  const dashPath = path.join(__dirname, '..', 'audit-dashboard.html');
  const html = fs.readFileSync(dashPath, 'utf8');
  const normalizeSrc = extractDashboardFunction(html, 'traditionalSeoNormalizeCanonicalCompareKey');
  const evaluateSrc = extractDashboardFunction(html, 'traditionalSeoEvaluateCanonicalRule');
  const forbiddenSrc = extractDashboardFunction(html, 'traditionalSeoHasForbiddenCanonicalChars');
  const bodyNoteSrc = extractDashboardFunction(html, 'traditionalSeoBodyCanonicalCleanupNote');
  const withBodySrc = extractDashboardFunction(html, 'traditionalSeoWithBodyCanonicalNote');
  const context = { console, URL };
  vm.createContext(context);
  vm.runInContext(
    `${forbiddenSrc}\n${normalizeSrc}\n${bodyNoteSrc}\n${withBodySrc}\n${evaluateSrc}\n`,
    context
  );
  return {
    normalize: context.traditionalSeoNormalizeCanonicalCompareKey,
    evaluate: context.traditionalSeoEvaluateCanonicalRule
  };
}

test('extractHtmlCanonicalFromHtml: reads head link rel=canonical', () => {
  const html = `<html><head><link rel="canonical" href="${pageUrl}"/></head><body></body></html>`;
  const out = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(out.seoCanonicalCount, 1);
  assert.equal(out.seoCanonicalHref, pageUrl);
  assert.equal(out.seoCanonicalBodyCount, 0);
});

test('extractHtmlCanonicalFromHtml: multi-value rel and missing href in head', () => {
  const multi = extractHtmlCanonicalFromHtml(
    '<html><head><link rel="canonical prefetch" href="https://www.alanranger.com/a"></head></html>',
    pageUrl
  );
  assert.equal(multi.seoCanonicalCount, 1);
  assert.equal(multi.seoCanonicalHref, 'https://www.alanranger.com/a');

  const spacedRel = extractHtmlCanonicalFromHtml(
    '<html><head><link rel="nofollow canonical" href="https://www.alanranger.com/b"></head></html>',
    pageUrl
  );
  assert.equal(spacedRel.seoCanonicalCount, 1);

  const missingHref = extractHtmlCanonicalFromHtml(
    '<html><head><link rel="canonical"></head></html>',
    pageUrl
  );
  assert.equal(missingHref.seoCanonicalCount, 1);
  assert.equal(missingHref.seoCanonicalRaw, '');
});

test('head self + conflicting body passes with cleanup note', () => {
  const html = `<html><head><link rel="canonical" href="${pageUrl}"></head>
<body><link rel="canonical" href="https://www.alanranger.com/blog-on-photography/other"></body></html>`;
  const extracted = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(extracted.seoCanonicalCount, 1);
  assert.equal(extracted.seoCanonicalBodyCount, 1);
  assert.match(extracted.seoCanonicalBodyHref, /blog-on-photography\/other/);

  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: true, ...extracted }
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.code, 'self_canonical');
  assert.match(result.note, /Misplaced body/);
  assert.match(result.note, /head only/i);
});

test('head self + identical body passes with cleanup note', () => {
  const html = `<html><head><link rel="canonical" href="${pageUrl}"></head>
<body><link rel="canonical" href="${pageUrl}"></body></html>`;
  const extracted = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(extracted.seoCanonicalBodyCount, 1);
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: true, ...extracted }
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.code, 'self_canonical');
  assert.match(result.note, /Misplaced body/);
});

test('multiple conflicting head canonicals warn', () => {
  const html = `<html><head>
<link rel="canonical" href="${pageUrl}">
<link rel="canonical" href="https://www.alanranger.com/other-page">
</head><body></body></html>`;
  const extracted = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(extracted.seoCanonicalCount, 2);
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: true, ...extracted }
  });
  assert.equal(result.status, 'warn');
  assert.equal(result.code, 'multiple_canonical');
});

test('comment and script faux tags are ignored', () => {
  const html = `<html><head>
<!-- <link rel="canonical" href="https://evil.example/from-comment"> -->
<script>var x = '<link rel="canonical" href="https://evil.example/from-script">';</script>
<link rel="canonical" href="${pageUrl}">
</head><body>
<style>.x { content: '<link rel="canonical" href="https://evil.example/from-style">'; }</style>
</body></html>`;
  const extracted = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(extracted.seoCanonicalCount, 1);
  assert.equal(extracted.seoCanonicalHref, pageUrl);
  assert.equal(extracted.seoCanonicalBodyCount, 0);
});

test('missing head canonical fails even if body has one', () => {
  const html = `<html><head></head><body>
<link rel="canonical" href="${pageUrl}">
</body></html>`;
  const extracted = extractHtmlCanonicalFromHtml(html, pageUrl);
  assert.equal(extracted.seoCanonicalCount, 0);
  assert.equal(extracted.seoCanonicalBodyCount, 1);
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: true, ...extracted }
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.code, 'missing_canonical');
  assert.match(result.note, /in <head>/);
  assert.match(result.note, /Misplaced body/);
});

test('valid self canonical + schema missing_id must not affect this rule', () => {
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: {
      requestOk: true,
      seoCanonicalHref: pageUrl,
      seoCanonicalRaw: pageUrl,
      seoCanonicalCount: 1
    }
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.code, 'self_canonical');
  assert.doesNotMatch(result.note, /missing_id/);
  assert.doesNotMatch(result.note, /Misplaced body/);
});

test('missing canonical fails', () => {
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: {
      requestOk: true,
      seoCanonicalHref: '',
      seoCanonicalRaw: '',
      seoCanonicalCount: 0
    }
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.code, 'missing_canonical');
});

test('malformed canonical fails (whitespace not treated as relative URL)', () => {
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: {
      requestOk: true,
      seoCanonicalHref: 'not a url',
      seoCanonicalRaw: 'not a url',
      seoCanonicalCount: 1
    }
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.code, 'malformed_canonical');
  assert.equal(normalizeUrlForCanonicalCompare('not a url', pageUrl), null);
});

test('unverified alternative canonical warns', () => {
  const result = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: {
      requestOk: true,
      seoCanonicalHref: 'https://www.alanranger.com/other-page',
      seoCanonicalRaw: 'https://www.alanranger.com/other-page',
      seoCanonicalCount: 1
    }
  });
  assert.equal(result.status, 'warn');
  assert.equal(result.code, 'alternative_canonical');
});

test('unknown when extractability evidence unavailable (no invented pass)', () => {
  const missing = evaluateTraditionalSeoCanonicalRule({ pageUrl, extractSignal: null });
  assert.equal(missing.status, 'warn');
  assert.equal(missing.code, 'unknown_canonical');

  const failed = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: false }
  });
  assert.equal(failed.status, 'warn');
  assert.equal(failed.code, 'unknown_canonical');

  const oldCache = evaluateTraditionalSeoCanonicalRule({
    pageUrl,
    extractSignal: { requestOk: true, seoH1Count: 1 }
  });
  assert.equal(oldCache.status, 'warn');
  assert.equal(oldCache.code, 'unknown_canonical');
});

test('canonical compare preserves protocol, port, and query; www alias ok', () => {
  const withQuery = 'https://www.alanranger.com/photo-workshops-uk/peak-district?utm=1';
  const keyA = normalizeUrlForCanonicalCompare(withQuery);
  const keyB = normalizeUrlForCanonicalCompare(
    'https://alanranger.com/photo-workshops-uk/peak-district?utm=1'
  );
  assert.equal(keyA, keyB);
  assert.match(keyA, /\?utm=1$/);
  assert.match(keyA, /^https:/);

  const httpKey = normalizeUrlForCanonicalCompare('http://www.alanranger.com/page');
  assert.match(httpKey, /^http:/);

  const portKey = normalizeUrlForCanonicalCompare('https://www.alanranger.com:8443/page');
  assert.match(portKey, /:8443/);
});

test('dashboard VM helpers match lib on head/body/malformed/missing/unknown/alternative', () => {
  const dash = loadDashboardCanonicalFns();
  const selfBody = extractHtmlCanonicalFromHtml(
    `<html><head><link rel="canonical" href="${pageUrl}"></head>
<body><link rel="canonical" href="https://www.alanranger.com/other"></body></html>`,
    pageUrl
  );
  const cases = [
    {
      pageUrl,
      extractSignal: {
        requestOk: true,
        seoCanonicalHref: 'not a url',
        seoCanonicalRaw: 'not a url',
        seoCanonicalCount: 1
      }
    },
    {
      pageUrl,
      extractSignal: {
        requestOk: true,
        seoCanonicalHref: '',
        seoCanonicalRaw: '',
        seoCanonicalCount: 0
      }
    },
    { pageUrl, extractSignal: null },
    {
      pageUrl,
      extractSignal: {
        requestOk: true,
        seoCanonicalHref: 'https://www.alanranger.com/other-page',
        seoCanonicalRaw: 'https://www.alanranger.com/other-page',
        seoCanonicalCount: 1
      }
    },
    {
      pageUrl: 'https://www.alanranger.com/page?x=1',
      extractSignal: {
        requestOk: true,
        seoCanonicalHref: 'https://alanranger.com/page?x=1',
        seoCanonicalRaw: 'https://alanranger.com/page?x=1',
        seoCanonicalCount: 1
      }
    },
    {
      pageUrl: 'http://www.alanranger.com/page',
      extractSignal: {
        requestOk: true,
        seoCanonicalHref: 'http://alanranger.com/page',
        seoCanonicalRaw: 'http://alanranger.com/page',
        seoCanonicalCount: 1
      }
    },
    { pageUrl, extractSignal: { requestOk: true, ...selfBody } },
    {
      pageUrl,
      extractSignal: { requestOk: true, seoH1Count: 1 }
    }
  ];

  cases.forEach((sample) => {
    const libResult = evaluateTraditionalSeoCanonicalRule(sample);
    const dashResult = dash.evaluate(sample.pageUrl, sample.extractSignal);
    assert.equal(dashResult.status, libResult.status, `status ${libResult.code}`);
    assert.equal(dashResult.code, libResult.code);
    assert.equal(dashResult.note, libResult.note, `note ${libResult.code}`);
    assert.equal(
      dash.normalize(sample.pageUrl),
      normalizeUrlForCanonicalCompare(sample.pageUrl)
    );
  });
});

test('sync patchSchemaQaEvalRow keeps bypass intent when raw later passes', () => {
  const failing = patchSchemaQaEvalRow(
    { rule_key: 'schema_qa_gate_page', status: 'pass', bypassed: true, raw_status: 'fail' },
    'block_deploy'
  );
  assert.equal(failing.status, 'pass');
  assert.equal(failing.bypassed, true);
  assert.equal(failing.bypass_intent, true);
  assert.equal(failing.raw_status, 'fail');

  const laterPass = patchSchemaQaEvalRow(failing, 'pass');
  assert.equal(laterPass.status, 'pass');
  assert.equal(laterPass.raw_status, 'pass');
  assert.equal(laterPass.bypassed, false);
  assert.equal(laterPass.bypass_intent, true);

  const failsAgain = patchSchemaQaEvalRow(laterPass, 'warning');
  assert.equal(failsAgain.status, 'pass');
  assert.equal(failsAgain.bypassed, true);
  assert.equal(failsAgain.bypass_intent, true);
  assert.equal(failsAgain.raw_status, 'warn');
});
