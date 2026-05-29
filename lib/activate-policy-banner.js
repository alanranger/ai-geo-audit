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
