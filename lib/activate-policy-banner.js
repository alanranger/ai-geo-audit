/** Policy indexability banner controller — mirrors audit-dashboard.html inline fn. */

export function activatePolicyBanner(doc, { placement, isActive, titleText, detailText }) {
  const el = doc.querySelector(
    `.ar-policy-banner--${placement}[data-policy-banner]`
  );
  if (!el) return;
  if (!isActive) {
    el.style.display = 'none';
    return;
  }
  el.querySelector('[data-policy-banner-title]').textContent = titleText;
  el.querySelector('[data-policy-banner-detail]').textContent = detailText;
  el.style.display = 'flex';
}

export function summaryBannerActivation(rowsTotalCount, rowsIndexableCount) {
  const total = rowsTotalCount;
  const indexable = rowsIndexableCount;
  const excluded = (total != null && indexable != null) ? total - indexable : 0;
  const isActive = total != null && indexable != null && total > 0 && indexable !== total;
  return {
    placement: 'summary',
    isActive,
    titleText: isActive
      ? `Indexable KPIs exclude ${excluded} of ${total} pages with active indexability policies`
      : '',
    detailText: 'Indexable variants of each KPI exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals are unchanged.'
  };
}

const DASHBOARD_DETAIL = 'Indexable variants of click and impression counts on this dashboard exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals reflect all pages.';
const DIAGNOSIS_DETAIL = 'Pages on or after their policy effective date are not flagged as visibility loss. This is expected behaviour for pages intentionally noindexed or retired.';
const PORTFOLIO_DETAIL = 'Indexable variants of segment metrics exclude pages marked intentional_noindex or retired_redirect on or after their effective date. Totals reflect all pages.';
const MONEY_DETAIL = 'Indexable variants of click and impression counts exclude days on or after the page\'s policy effective date.';

export function dashboardBannerActivation(subsegmentActivity) {
  const keys = ['landing', 'event', 'product', 'other'];
  let total = 0;
  let indexable = 0;
  keys.forEach((key) => {
    const row = subsegmentActivity?.[key] || {};
    total += Math.max(0, Number(row.rows_total_count) || 0);
    indexable += Math.max(0, Number(row.rows_indexable_count) || 0);
  });
  const excluded = total - indexable;
  const isActive = total > 0 && indexable !== total;
  return {
    placement: 'dashboard',
    isActive,
    titleText: isActive
      ? `Active indexability policies exclude ${excluded} of ${total} pages from indexable counts`
      : '',
    detailText: DASHBOARD_DETAIL
  };
}

export function diagnosisBannerActivation(diagnostics) {
  const rows = Array.isArray(diagnostics) ? diagnostics : [];
  const suppressedCount = rows.filter((d) => d.policy_suppression_reason != null).length;
  const total = rows.length;
  const isActive = suppressedCount > 0;
  return {
    placement: 'diagnosis',
    isActive,
    titleText: isActive
      ? `${suppressedCount} of ${total} diagnosis rows have visibility_loss suppressed by active policy`
      : '',
    detailText: DIAGNOSIS_DETAIL
  };
}

export function portfolioBannerActivation(metrics) {
  const rows = Array.isArray(metrics) ? metrics : [];
  const isActive = rows.some((m) =>
    m.rows_total_count != null &&
    m.rows_indexable_count != null &&
    m.rows_indexable_count !== m.rows_total_count
  );
  return {
    placement: 'portfolio',
    isActive,
    titleText: isActive ? 'Some portfolio segments include pages affected by active policy' : '',
    detailText: PORTFOLIO_DETAIL
  };
}

export function moneyBannerActivation(affectedCount, totalCount) {
  const M = Math.max(0, Number(totalCount) || 0);
  const N = Math.max(0, Number(affectedCount) || 0);
  const isActive = M > 0 && N > 0;
  return {
    placement: 'money',
    isActive,
    titleText: isActive ? `${N} of ${M} money pages affected by active policy` : '',
    detailText: MONEY_DETAIL
  };
}
