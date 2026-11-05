import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForLateFaq } from '../lib/fault-monitor/renderer.js';
import { faqParityCheck } from '../lib/fault-monitor/page-checks.js';

const URL = 'https://www.alanranger.com/blog-on-photography/what-is-contrast-in-photography';
const noFaqYet = { faqVisibility: { total: 0, visible: 0 }, faqSectionCount: 8 };
const renderer = (arrives) => ({ waitFor: async () => { if (!arrives) throw new Error('timeout'); } });

test('the FAQ file lands late: the renderer waits, measures again and A4 passes', async () => {
  assert.equal(faqParityCheck(URL, 'blog', [], noFaqYet).status, 'fault');
  assert.equal(await waitForLateFaq(renderer(true), {}, noFaqYet), true);
  const remeasured = { faqVisibility: { total: 8, visible: 8 }, faqSectionCount: 8 };
  assert.equal(faqParityCheck(URL, 'blog', [], remeasured).status, 'pass');
});

test('no extra wait when the FAQPage is already there or the page has no FAQ section', async () => {
  assert.equal(await waitForLateFaq(renderer(true), {}, { faqVisibility: { total: 8, visible: 8 }, faqSectionCount: 8 }), false);
  assert.equal(await waitForLateFaq(renderer(true), {}, { faqVisibility: { total: 0, visible: 0 }, faqSectionCount: 2 }), false);
  assert.equal(await waitForLateFaq(renderer(true), {}, {}), false);
});

test('real problems still fail: hosted questions not visible, or visible FAQs with no FAQPage anywhere', async () => {
  // Loader dropped every question (none visible): its flag is set, the page is measured again, still no FAQPage.
  assert.equal(await waitForLateFaq(renderer(true), {}, noFaqYet), true);
  const r1 = faqParityCheck(URL, 'blog', [], noFaqYet);
  assert.equal(r1.status, 'fault');
  assert.equal(r1.title, '8 FAQs visible, FAQPage missing');
  // FAQPage questions present but not shown on the page.
  const r2 = faqParityCheck(URL, 'blog', [], { faqVisibility: { total: 8, visible: 3 }, faqSectionCount: 8 });
  assert.equal(r2.status, 'fault');
  assert.equal(r2.title, 'FAQPage has 8 questions, 3 of them visible');
  // No FAQ file and no FAQPage at all: the wait times out and A4 still fails.
  assert.equal(await waitForLateFaq(renderer(false), {}, noFaqYet), false);
  assert.equal(faqParityCheck(URL, 'blog', [], noFaqYet).status, 'fault');
});
