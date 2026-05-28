/** Seasonality-aware delta helpers for §9 metrics (D15). */

export function pctChange(recent, prior) {
  const p = Number(prior) || 0;
  const r = Number(recent) || 0;
  if (p === 0) return r === 0 ? 0 : null;
  return 100 * (r - p) / p;
}

export function deltaChipHtml(pct, suffix) {
  if (pct == null || !Number.isFinite(Number(pct))) return '';
  const n = Number(pct);
  const cls = n > 0.5 ? 'is-up' : (n < -0.5 ? 'is-down' : 'is-flat');
  const arrow = n > 0.5 ? '↑' : (n < -0.5 ? '↓' : '→');
  const sign = n > 0 ? '+' : '';
  const tail = suffix ? ` <span class="rt-delta-suffix">${suffix}</span>` : '';
  return `<span class="rt-delta-chip ${cls}">${arrow} ${sign}${n.toFixed(1)}%</span>${tail}`;
}

function isSeasonalType(t) {
  return t === 'event_bound' || t === 'season_bound';
}

function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

export function compareWindowMetric(points, windowMonths, seasonalityType, field) {
  const rows = (points || []).slice().sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  const win = rows.slice(-Math.max(1, windowMonths));
  if (win.length < 2) return null;

  if (isSeasonalType(seasonalityType)) {
    const byMonth = new Map();
    for (const r of win) {
      const mk = monthKey(r.period_start).slice(5, 7);
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(r);
    }
    let recentSum = 0;
    let priorSum = 0;
    let pairs = 0;
    for (const [, arr] of byMonth) {
      if (arr.length < 2) continue;
      const sorted = arr.slice().sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
      priorSum += Number(sorted[0][field]) || 0;
      recentSum += Number(sorted[sorted.length - 1][field]) || 0;
      pairs++;
    }
    if (!pairs) return pctChange(recentSum, priorSum);
    return pctChange(recentSum / pairs, priorSum / pairs);
  }

  const half = Math.floor(win.length / 2);
  const prior = win.slice(0, half);
  const recent = win.slice(half);
  const sumField = (arr) => arr.reduce((s, r) => s + (Number(r[field]) || 0), 0);
  return pctChange(sumField(recent), sumField(prior));
}

export function revenueYoYChip(y24, y25, y26) {
  const d2526 = pctChange(y26, y25);
  const d2425 = pctChange(y25, y24);
  return deltaChipHtml(d2425, '24→25') + ' ' + deltaChipHtml(d2526, '25→26 YTD');
}

export function metricLine(label, value, pct, suffix) {
  return `<div class="rt-diag-metric-line"><span class="k">${label}</span> <strong>${value}</strong> ${deltaChipHtml(pct, suffix)}</div>`;
}
