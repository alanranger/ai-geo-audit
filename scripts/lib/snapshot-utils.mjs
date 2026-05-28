export function fmtMoney(n, decimals = 0) {
  const v = Number(n) || 0;
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtN(n) {
  return (Number(n) || 0).toLocaleString('en-GB');
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function monthLabel(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function monthShortByIndex(m) {
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return labels[Math.max(0, Math.min(11, m - 1))] || '';
}

export function visibleMonthKeys(monthly, windowMode, now) {
  if (!monthly?.length || windowMode === 'full') {
    return new Set(monthly.map((m) => m.year + '|' + m.month));
  }
  const set = new Set();
  for (const m of monthly) {
    const dy = (m.year - now.year) * 12 + (m.month - now.month);
    if (dy >= -12 && dy <= 0) set.add(m.year + '|' + m.month);
  }
  return set;
}

export function filterByVisible(rows, keys) {
  return rows.filter((r) => keys.has(r.year + '|' + r.month));
}
