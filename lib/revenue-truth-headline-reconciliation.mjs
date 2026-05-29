/** Headline YTD reconciliation: page non-JLR vs Booking Sheet raw − JLR rows. */

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

function monthOfIso(iso) {
  return Number(String(iso || '').slice(5, 7));
}

export function buildHeadlineReconciliation(wideRows, monthly, transactions, cfg) {
  const year = cfg?.now?.year || new Date().getUTCFullYear();
  const sheetRawYtd = round2(
    (wideRows || []).filter((r) => Number(r.year) === year).reduce((s, r) => s + (Number(r.revenue_amount) || 0), 0)
  );
  const pageHeadlineYtd = round2(
    (monthly || []).filter((m) => m.year === year).reduce((s, m) => s + (Number(m.headlineRevenue) || 0), 0)
  );
  const jlrRows = (transactions || []).filter((t) => t.is_jlr === true && Number(t.year) === year);
  const jlrYtd = round2(jlrRows.reduce((s, t) => s + (Number(t.amount) || 0), 0));
  const expected = round2(sheetRawYtd - jlrYtd);
  const diff = round2(pageHeadlineYtd - expected);
  const passes = Math.abs(diff) <= 2;

  const jlrByYear = {};
  for (const y of [year - 2, year - 1, year]) {
    jlrByYear[y] = round2(
      (transactions || []).filter((t) => t.is_jlr === true && Number(t.year) === y)
        .reduce((s, t) => s + (Number(t.amount) || 0), 0)
    );
  }

  const trace = jlrRows.slice(0, 40).map((t) => ({
    date: t.txn_date,
    amount: round2(t.amount),
    product: t.canonical_product || t.category_label || '',
    month: monthOfIso(t.txn_date)
  }));

  return {
    passes,
    year,
    sheet_raw_ytd: sheetRawYtd,
    jlr_stripped_ytd: jlrYtd,
    page_headline_ytd: pageHeadlineYtd,
    expected_non_jlr: expected,
    diff,
    jlr_row_count: jlrRows.length,
    jlr_by_year: jlrByYear,
    jlr_trace: trace
  };
}

export function formatReconciliationBadge(rec) {
  if (!rec) return 'Reconciliation unknown';
  if (rec.passes) {
    return `Reconciled · Sheet ${fmt(rec.sheet_raw_ytd)} − JLR ${fmt(rec.jlr_stripped_ytd)} = Page ${fmt(rec.page_headline_ytd)}`;
  }
  return `Reconciliation FAIL · Page ${fmt(rec.page_headline_ytd)} vs Sheet−JLR ${fmt(rec.expected_non_jlr)} (${fmt(rec.diff)} off)`;
}

export function reconciliationTraceHtml(rec) {
  if (!rec?.jlr_trace?.length) return '<p class="rt-sub">No JLR rows in YTD window.</p>';
  const rows = rec.jlr_trace.map((r) =>
    `<tr><td>${escape(r.date)}</td><td>${fmt(r.amount)}</td><td>${escape(r.product)}</td></tr>`
  ).join('');
  const more = rec.jlr_row_count > rec.jlr_trace.length
    ? `<p class="rt-sub">${rec.jlr_row_count - rec.jlr_trace.length} more JLR row(s) not shown.</p>`
    : '';
  return `<table class="rt-table rt-striped"><thead><tr><th>Date</th><th>£</th><th>Product</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}

function fmt(n) {
  return '£' + (Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
