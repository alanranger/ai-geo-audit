import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activatePolicyBanner,
  summaryBannerActivation,
  dashboardBannerActivation,
  diagnosisBannerActivation,
  portfolioBannerActivation,
  moneyBannerActivation
} from '../lib/activate-policy-banner.js';

const SUMMARY_DETAIL = 'Indexable variants of each KPI exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals are unchanged.';
const DASHBOARD_DETAIL = 'Indexable variants of click and impression counts on this dashboard exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals reflect all pages.';
const DIAGNOSIS_DETAIL = 'Pages on or after their policy effective date are not flagged as visibility loss. This is expected behaviour for pages intentionally noindexed or retired.';
const PORTFOLIO_DETAIL = 'Indexable variants of segment metrics exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals reflect all pages.';
const MONEY_DETAIL = 'Indexable variants of click and impression counts exclude days on or after the page\'s policy effective date.';

function mountBannerDoc(placement) {
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
      if (sel === `.ar-policy-banner--${placement}[data-policy-banner]`) return banner;
      return null;
    },
    banner,
    titleEl,
    detailEl
  };
}

function runFixture(label, placement, opts, expect) {
  const doc = mountBannerDoc(placement);
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
  runFixture('summary fixture 1 all indexable', 'summary', summaryBannerActivation(551, 551), { display: 'none' });
  runFixture('summary fixture 2 some excluded', 'summary', summaryBannerActivation(551, 487), {
    display: 'flex',
    titleContains: '64 of 551',
    detail: SUMMARY_DETAIL
  });
  runFixture('summary fixture 3 all excluded edge', 'summary', summaryBannerActivation(100, 0), {
    display: 'flex',
    titleContains: '100 of 100',
    detail: SUMMARY_DETAIL
  });
  runFixture('summary fixture 4 zero rows edge', 'summary', summaryBannerActivation(0, 0), { display: 'none' });
});

test('dashboard policy banner — hidden and active fixtures', () => {
  const equalSegments = {
    landing: { rows_total_count: 28, rows_indexable_count: 28 },
    event: { rows_total_count: 126, rows_indexable_count: 126 },
    product: { rows_total_count: 56, rows_indexable_count: 56 },
    other: { rows_total_count: 341, rows_indexable_count: 341 }
  };
  runFixture('dashboard fixture 1 equal counts', 'dashboard', dashboardBannerActivation(equalSegments), { display: 'none' });
  const mixedSegments = {
    landing: { rows_total_count: 28, rows_indexable_count: 28 },
    event: { rows_total_count: 126, rows_indexable_count: 120 },
    product: { rows_total_count: 56, rows_indexable_count: 56 },
    other: { rows_total_count: 341, rows_indexable_count: 341 }
  };
  runFixture('dashboard fixture 2 some excluded', 'dashboard', dashboardBannerActivation(mixedSegments), {
    display: 'flex',
    titleContains: '6 of 551',
    detail: DASHBOARD_DETAIL
  });
  runFixture('dashboard fixture 3 zero rows edge', 'dashboard', dashboardBannerActivation(null), { display: 'none' });
});

test('diagnosis policy banner — hidden and active fixtures', () => {
  const healthy = [
    { page_slug: '/a', policy_suppression_reason: null },
    { page_slug: '/b', policy_suppression_reason: null }
  ];
  runFixture('diagnosis fixture 1 no suppression', 'diagnosis', diagnosisBannerActivation(healthy), { display: 'none' });
  const mixed = [
    { page_slug: '/a', policy_suppression_reason: 'intentional_noindex' },
    { page_slug: '/b', policy_suppression_reason: null },
    { page_slug: '/c', policy_suppression_reason: 'retired_redirect' }
  ];
  runFixture('diagnosis fixture 2 some suppressed', 'diagnosis', diagnosisBannerActivation(mixed), {
    display: 'flex',
    titleContains: '2 of 3',
    detail: DIAGNOSIS_DETAIL
  });
  runFixture('diagnosis fixture 3 empty rows edge', 'diagnosis', diagnosisBannerActivation([]), { display: 'none' });
});

test('portfolio policy banner — hidden and active fixtures', () => {
  const equalMetrics = [
    { rows_total_count: 101, rows_indexable_count: 101 },
    { rows_total_count: 748, rows_indexable_count: 748 }
  ];
  runFixture('portfolio fixture 1 equal counts', 'portfolio', portfolioBannerActivation(equalMetrics), { display: 'none' });
  const mixedMetrics = [
    { rows_total_count: 101, rows_indexable_count: 95 },
    { rows_total_count: 748, rows_indexable_count: 748 }
  ];
  runFixture('portfolio fixture 2 some excluded', 'portfolio', portfolioBannerActivation(mixedMetrics), {
    display: 'flex',
    titleContains: 'Some portfolio segments include pages affected by active policy',
    detail: PORTFOLIO_DETAIL
  });
});

test('money pages policy banner — hidden and active fixtures', () => {
  runFixture('money fixture 1 none affected', 'money', moneyBannerActivation(0, 101), { display: 'none' });
  runFixture('money fixture 2 some affected', 'money', moneyBannerActivation(4, 101), {
    display: 'flex',
    titleContains: '4 of 101',
    detail: MONEY_DETAIL
  });
  runFixture('money fixture 3 zero pages edge', 'money', moneyBannerActivation(0, 0), { display: 'none' });
});
