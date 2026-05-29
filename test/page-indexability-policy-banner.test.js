import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activatePolicyBanner, summaryBannerActivation } from '../lib/activate-policy-banner.js';

const DETAIL = 'Indexable variants of each KPI exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals are unchanged.';

function mountSummaryBannerDoc() {
  const banner = {
    style: { display: 'none' },
    querySelector(sel) {
      if (sel === '[data-policy-banner-title]') return titleEl;
      if (sel === '[data-policy-banner-detail]') return detailEl;
      return null;
    }
  };
  const titleEl = { textContent: '' };
  const detailEl = { textContent: '' };
  return {
    querySelector(sel) {
      if (sel === '.ar-policy-banner--summary[data-policy-banner]') return banner;
      return null;
    },
    banner,
    titleEl,
    detailEl
  };
}

function runFixture(label, rowsTotalCount, rowsIndexableCount, expect) {
  const doc = mountSummaryBannerDoc();
  const opts = summaryBannerActivation(rowsTotalCount, rowsIndexableCount);
  activatePolicyBanner(doc, opts);
  assert.equal(doc.banner.style.display, expect.display, `${label} display`);
  if (expect.titleContains) {
    assert.ok(doc.titleEl.textContent.includes(expect.titleContains), `${label} title`);
  }
  if (expect.detail) {
    assert.equal(doc.detailEl.textContent, expect.detail, `${label} detail`);
  }
  console.log(`PASS  ${label}  display=${doc.banner.style.display}${expect.titleContains ? '  title=' + doc.titleEl.textContent : ''}`);
}

test('summary policy banner — four fixture states', () => {
  runFixture('fixture 1 all indexable', 551, 551, { display: 'none' });
  runFixture('fixture 2 some excluded', 551, 487, {
    display: 'flex',
    titleContains: '64 of 551',
    detail: DETAIL
  });
  runFixture('fixture 3 all excluded edge', 100, 0, {
    display: 'flex',
    titleContains: '100 of 100',
    detail: DETAIL
  });
  runFixture('fixture 4 zero rows edge', 0, 0, { display: 'none' });
});
