import test from 'node:test';
import assert from 'node:assert/strict';
import { codeBlocksIntact } from '../lib/trad-seo-render/code-blocks.js';
import { findingsFromPage, hiddenTagFinding } from '../lib/trad-seo-render/findings.js';
import { extractRowFromRendered } from '../lib/trad-seo-render/extract-row.js';
import { buildPlan, buildFullPlan } from '../lib/fault-monitor/plan.js';

const POST = 'https://www.alanranger.com/blog-on-photography/how-to-find-your-photography-style';
const COURSES = 'https://www.alanranger.com/photography-courses';

test('code_blocks_intact fails on unbalanced braces', () => {
  const bad = '<style>#box{color:red</style>';
  assert.equal(codeBlocksIntact(bad).status, 'fail');
});

test('code_blocks_intact fails on jammed #id#id selectors', () => {
  const bad = '<style>#hero#hero{display:block}</style>';
  assert.equal(codeBlocksIntact(bad).status, 'fail');
});

test('code_blocks_intact passes balanced inline CSS', () => {
  const ok = '<style>#hero { color: red; } #box { display: block; }</style>';
  assert.equal(codeBlocksIntact(ok).status, 'pass');
});

test('hidden_tag_matches_lists fails when NOINDEX is still in 06', () => {
  const inCsv = new Set(['/photography-courses']);
  const render = { measure: { rawHtml: '<meta name="ROBOTS" content="NOINDEX">' }, xRobots: '' };
  const hit = hiddenTagFinding(COURSES, 'money', render, inCsv, false);
  assert.equal(hit.status, 'fail');
});

test('findingsFromPage maps A3 to schema_not_title_only fail', () => {
  const out = findingsFromPage({
    url: POST,
    pageType: 'blog',
    render: { measure: { rawHtml: '<html></html>', html: '<html></html>' } },
    results: [{ check: 'A3', status: 'fault', title: 'articleBody is the headline' }],
    inCsv: new Set(),
    intentionalNoindex: false,
    siteErrors: []
  });
  assert.equal(out.schema_not_title_only.status, 'fail');
});

test('extractRowFromRendered keeps title and H1 signals', () => {
  const html = '<html><head><title>Photography Courses in Coventry</title></head><body><h1>Photography Courses</h1></body></html>';
  const row = extractRowFromRendered(COURSES, html, 200);
  assert.equal(row.requestOk, true);
  assert.ok(row.seoTitleTagLength > 10);
  assert.equal(row.url, COURSES);
});

test('buildPlan is full 06 list, not a 25% blog rotation', () => {
  const blogs = Array.from({ length: 40 }, (_, i) => `https://www.alanranger.com/blog-on-photography/post-${i}`);
  const urls = [COURSES, ...blogs];
  const { items } = buildPlan(urls, '2026-10-26');
  const full = buildFullPlan(urls);
  assert.equal(items.length, full.items.length);
  assert.equal(items.length, urls.length);
});
