/** Plain-English key signals (D16/D17) — EVIDENCE-OR-SILENCE. */

import { fmtMoney, fmtN } from './revenue-truth-ui-core.mjs';
import { pctChange } from './revenue-truth-gsc-deltas.mjs';

const STATE_PLAIN = {
  traffic_with_zero_conversion: 'High organic traffic with no mapped revenue in the overlay window',
  visibility_loss_with_low_ctr_baseline: 'Search visibility fell and click-through was already weak',
  visibility_loss_normal_ctr: 'Search visibility fell versus the prior comparable period',
  funnel_bypass_revenue_with_minimal_organic: 'Revenue is booking without meaningful organic clicks on this URL',
  traffic_rich_modest_conversion: 'Solid traffic with modest conversion in the overlay window',
  matched_healthy: 'Metrics sit in the expected steady-state band for this tier',
  insufficient_history: 'Not enough seasonal history for a visibility comparison',
  insufficient_data: 'Insufficient GSC history for a full verdict',
  skipped_none: 'Page skipped (voucher/plumbing only)'
};

function bulletsHtml(items) {
  if (!items.length) return '';
  return `<div class="rt-key-signals"><ul>${items.map((b) => `<li class="${b.cls || 'is-warn'}">${b.text}</li>`).join('')}</ul></div>`;
}

export function hubCardSignals(d) {
  const bullets = [];
  const fw = d.metrics?.full_window || {};
  const impD = d.deltas?.impressions?.adjusted;
  const plain = STATE_PLAIN[d.state];
  if (plain && d.state !== 'matched_healthy') {
    bullets.push({ text: `⚠ ${plain}.`, cls: 'is-warn' });
  }
  if (d.state === 'matched_healthy') {
    bullets.push({ text: '✓ Page looks healthy for this tier in the selected window.', cls: 'is-good' });
  }
  if (impD != null && impD < -15) {
    bullets.push({ text: `⚠ Impressions down ${Math.abs(impD).toFixed(0)}% (season-adjusted).`, cls: 'is-warn' });
  }
  if ((fw.clicks || 0) > 50 && (fw.revenue_gbp_nonjlr || 0) === 0) {
    bullets.push({ text: '→ Check whether bookings land on product URLs instead of this hub.', cls: 'is-warn' });
  }
  if ((fw.ctr_pct || 0) > 0 && (fw.ctr_pct || 0) < 0.5 && (fw.impressions || 0) > 500) {
    bullets.push({ text: `⚠ CTR ${fw.ctr_pct.toFixed(2)}% is weak for ${fmtN(fw.impressions)} impressions.`, cls: 'is-warn' });
  }
  return bulletsHtml(bullets.slice(0, 4));
}

export function tierCardSignals(t) {
  const bullets = [];
  const c = t.page_state_counts || {};
  const zero = c.traffic_with_zero_conversion || 0;
  const vis = (c.visibility_loss_with_low_ctr_baseline || 0) + (c.visibility_loss_normal_ctr || 0);
  if (zero > 0) bullets.push({ text: `⚠ ${zero} page(s) with traffic but zero mapped revenue.`, cls: 'is-warn' });
  if (vis > 0) bullets.push({ text: `⚠ ${vis} page(s) showing visibility loss.`, cls: 'is-warn' });
  if ((t.pages_at_risk_gbp || 0) > 500) {
    bullets.push({ text: `⚠ ${fmtMoney(t.pages_at_risk_gbp, 0)} at risk on broken diagnostic pages.`, cls: 'is-warn' });
  }
  const rt = t.revenue_trend || {};
  const y25 = rt.y2025?.non_jlr || 0;
  const y26 = rt.y2026_ytd?.non_jlr || 0;
  const pc = pctChange(y26, y25);
  if (pc != null && pc > 5) bullets.push({ text: `✓ Tier YTD revenue ahead of 2025 pace (${pc.toFixed(0)}%).`, cls: 'is-good' });
  if (!bullets.length && (c.matched_healthy || 0) > 0) {
    bullets.push({ text: '✓ No critical diagnostic flags on hub pages in this tier.', cls: 'is-good' });
  }
  return bulletsHtml(bullets.slice(0, 4));
}

export function headlineSignals(strip, cfg) {
  if (!strip) return '';
  const bullets = [];
  const band = strip.trailing3Band;
  const avg = strip.trailing3MonthAverage || 0;
  const survival = cfg?.tierBands?.survival || 3000;
  const comfortable = cfg?.tierBands?.comfortable || 5000;
  if (band === 'below_survival' || avg < survival) {
    bullets.push({ text: `⚠ Trailing 3-month average ${fmtMoney(avg, 0)} — below survival band (£${survival.toLocaleString('en-GB')}/mo).`, cls: 'is-warn' });
  } else if (band === 'survival' || avg < comfortable) {
    bullets.push({ text: `⚠ Trailing 3-month average ${fmtMoney(avg, 0)} — survival band, below comfortable (£${comfortable.toLocaleString('en-GB')}/mo).`, cls: 'is-warn' });
  } else if (band === 'comfortable' || band === 'thrive') {
    bullets.push({ text: `✓ Trailing 3-month average ${fmtMoney(avg, 0)} — ${band === 'thrive' ? 'thrive' : 'comfortable'} band.`, cls: 'is-good' });
  }
  const ytd = strip.ytd;
  if (ytd && ytd.ytdRevenue < ytd.proRataTarget * 0.95) {
    bullets.push({ text: `⚠ YTD headline ${fmtMoney(ytd.ytdRevenue, 0)} is below pro-rata target ${fmtMoney(ytd.proRataTarget, 0)}.`, cls: 'is-warn' });
  }
  return bulletsHtml(bullets);
}

export function forecastSignals(forecast) {
  if (!forecast) return '';
  const bullets = [];
  const central = forecast.forecastCentral || 0;
  if (central < 36000) bullets.push({ text: `⚠ Forecast ${fmtMoney(central, 0)} is below £36k survival.`, cls: 'is-warn' });
  else if (central < 60000) bullets.push({ text: `⚠ Forecast ${fmtMoney(central, 0)} is below £60k comfortable (${fmtMoney(60000 - central, 0)} gap).`, cls: 'is-warn' });
  else bullets.push({ text: `✓ Forecast ${fmtMoney(central, 0)} reaches the £60k comfortable target.`, cls: 'is-good' });
  return bulletsHtml(bullets);
}

function pivotShift(rows, labelFn) {
  const byDim = new Map();
  for (const r of rows || []) {
    const k = labelFn(r);
    if (!byDim.has(k)) byDim.set(k, []);
    byDim.get(k).push(r);
  }
  const shifts = [];
  for (const [dim, arr] of byDim) {
    const sorted = arr.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
    const recent = sorted.slice(-6);
    const prior = sorted.slice(-12, -6);
    const rSum = recent.reduce((s, x) => s + (x.revenue || 0), 0);
    const pSum = prior.reduce((s, x) => s + (x.revenue || 0), 0);
    const pc = pctChange(rSum, pSum);
    if (pc != null && Math.abs(pc) >= 15) shifts.push({ dim, pc, rSum, pSum });
  }
  return shifts.sort((a, b) => Math.abs(b.pc) - Math.abs(a.pc));
}

export function channelSignals(rows) {
  const shifts = pivotShift(rows, (r) => r.label);
  if (!shifts.length) return '';
  const top = shifts[0];
  const dir = top.pc > 0 ? 'up' : 'down';
  return bulletsHtml([{ text: `${dir === 'up' ? '✓' : '⚠'} ${top.dim} revenue ${dir} ${Math.abs(top.pc).toFixed(0)}% (last 6mo vs prior 6mo).`, cls: dir === 'up' ? 'is-good' : 'is-warn' }]);
}

export function clientsSignals(rows) {
  const shifts = pivotShift(rows, (r) => r.label);
  const newC = shifts.find((s) => /new/i.test(s.dim));
  const exist = shifts.find((s) => /existing/i.test(s.dim));
  const bullets = [];
  if (newC && Math.abs(newC.pc) >= 10) {
    bullets.push({ text: `${newC.pc > 0 ? '✓' : '⚠'} New-client revenue ${newC.pc > 0 ? 'up' : 'down'} ${Math.abs(newC.pc).toFixed(0)}% (6mo trend).`, cls: newC.pc > 0 ? 'is-good' : 'is-warn' });
  }
  if (exist && Math.abs(exist.pc) >= 10) {
    bullets.push({ text: `${exist.pc > 0 ? '✓' : '⚠'} Existing-client revenue ${exist.pc > 0 ? 'up' : 'down'} ${Math.abs(exist.pc).toFixed(0)}% (6mo trend).`, cls: exist.pc > 0 ? 'is-good' : 'is-warn' });
  }
  return bulletsHtml(bullets);
}

export function moversCardSignals(f) {
  const dk = f.deltas?.nonjlr_2024_to_2025 || f.deltas?.nonjlr_2025_to_2026;
  if (!dk) return '';
  const d = dk.delta_gbp || 0;
  if (Math.abs(d) < 500) return '';
  const cls = d > 0 ? 'is-good' : 'is-warn';
  return bulletsHtml([{ text: `${d > 0 ? '✓' : '⚠'} ${fmtMoney(Math.abs(d), 0)} ${d > 0 ? 'gain' : 'loss'} in selected comparison window.`, cls }]);
}
