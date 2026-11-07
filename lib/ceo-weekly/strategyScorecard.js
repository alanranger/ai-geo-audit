/**
 * Monday brief — Strategy pieces (redesign 2026-11-02): section 3 tiles + fill/run rate, section 1
 * "Push these 3". The old Upcoming events table is retired (the Pipeline replaces it). No maths changes.
 */
import { buildStrategySummary } from '../strategy-summary.mjs';
import { strategyShortName } from '../strategy-short-names.mjs';
import { marketingAlerts } from '../marketing/health.mjs';
import { fmtGbp } from './shared.js';

const FF = 'font-family:Arial,Helvetica,sans-serif';
const GREEN = '#067647';
const RED = '#b42318';
const BLUE = '#1857c4';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function eventHref(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `https://www.alanranger.com${url}`;
}

function fmtDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const mon = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${wd} ${day} ${mon}`;
}

function tile(html, tone) {
  const map = {
    red: { bg: '#fde8e8', border: '#f6c9c9', fg: '#c0262d' },
    green: { bg: '#e7f6ed', border: '#bfe5cd', fg: '#0a7a3e' },
    amber: { bg: '#fdf3e2', border: '#f3d9ae', fg: '#b45309' },
    grey: { bg: '#f6f7f9', border: '#e5e7eb', fg: '#1f2937' }
  };
  const c = map[tone] || map.grey;
  return `<td style="width:25%;background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:12px 10px;vertical-align:top;">
    <div style="font-size:22px;font-weight:800;line-height:1.1;color:${c.fg};${FF}">${html.value}</div>
    <div style="font-size:11.5px;color:#6b7280;margin-top:4px;line-height:1.35;${FF}">${html.label}</div>
  </td>`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-07" → "7 Oct" (house date style). */
export function houseDates(text) {
  return String(text || '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${Number(d)} ${MON[Number(m) - 1]}`);
}

function parsePct(s) {
  const m = String(s || '').match(/(-?\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Fill delta vs prior-year window: ▲/▼ + 1 decimal, green up / red down. */
function fillDeltaHtml(curr, prior) {
  const a = parsePct(curr);
  const b = parsePct(prior);
  if (a == null || b == null) return '';
  const d = Math.round((a - b) * 10) / 10;
  if (Math.abs(d) < 0.05) {
    return `<div style="font-size:11px;color:#6b7280;margin-top:2px;font-weight:600;${FF}">→ 0.0</div>`;
  }
  const up = d > 0;
  const color = up ? GREEN : RED;
  const arrow = up ? '▲' : '▼';
  return `<div style="font-size:11px;color:${color};margin-top:2px;font-weight:700;${FF}">${arrow} ${Math.abs(d).toFixed(1)}</div>`;
}

export async function buildStrategyBrief(supabase, propertyUrl) {
  const s = await buildStrategySummary(supabase, propertyUrl);
  return {
    as_of: s.as_of,
    week_start: s.week_start,
    survival_gp: s.survival_gp,
    plans_connected: !!s.plans_connected,
    scorecard: s.scorecard,
    headline: s.headline || {},
    action_needed: s.action_needed || [],
    overdue_actions: s.overdue_actions || [],
    diary: s.diary || [],
    push: s.push || [],
    kpi_scorecard: s.kpi_scorecard || [],
    trends: s.trends || {},
    snapshot_meta: s.snapshot_meta || {},
    marketing_alerts: await marketingAlerts(supabase).catch((e) => [`Marketing data health could not be read: ${e.message}`])
  };
}

function marketingAlertsHtml(brief) {
  const list = brief.marketing_alerts || [];
  if (!list.length) return '';
  return `<div style="border-left:4px solid #f59e0b;background:#fffbeb;padding:8px 12px;margin:0 0 14px;font-size:12px;color:#78350f;${FF}"><b>Marketing data needs attention:</b><br>${list.map(esc).join('<br>')}</div>`;
}

const wrap = (inner) => `<tr><td style="padding:4px 28px 12px;">${inner}</td></tr>`;

function unavailable(brief) {
  return `<tr><td style="padding:12px 28px;color:#667085;${FF}">Strategy — unavailable${brief?.error ? `: ${esc(brief.error)}` : ''}</td></tr>`;
}

function kpiFinder(brief) {
  const kpi = brief.kpi_scorecard || [];
  return (key) => kpi.find((k) => k.key === key);
}

/** Returning clients (approved definition): R12 figure; colour = pace vs target; YoY only once comparable. */
function returningTile(sc) {
  const r = sc.returning || {};
  const target = Number(r.target) || 23000;
  const k = (n) => `£${(Math.round(Number(n) / 100) / 10).toLocaleString('en-GB')}k`;
  const pace = Number(r.pace);
  let tone = 'grey';
  if (Number.isFinite(pace)) tone = pace >= target ? 'green' : (pace >= target * 0.9 ? 'amber' : 'red');
  const yoy = r.yoy_ready && Number(r.prior) > 0
    ? `${r.r12 >= r.prior ? '▲' : '▼'} ${Math.abs(Math.round(((r.r12 - r.prior) / r.prior) * 100))}% vs last year · `
    : '';
  const sub = Number.isFinite(pace) ? `${yoy}pace ${k(pace)} vs ${k(target)} target` : 'pace from next month';
  return tile({ value: esc(fmtGbp(r.r12)), label: `From returning clients, last 12 months<br>${esc(sub)}` }, tone);
}

/** Section 3 · the 4 strategy tiles (GP 3m, avg people/day, returning clients, quarter actions). */
export function renderStrategyTilesHtml(brief) {
  if (!brief || brief.error) return unavailable(brief);
  const sc = brief.scorecard || {};
  const findK = kpiFinder(brief);
  const f1 = findK('F1');
  const f2 = findK('F2');
  const f3 = findK('F3');

  const overdue = (brief.overdue_actions || []).length;
  return wrap(`
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 0 14px;">
    <tr>
      ${gpTile(sc, brief)}
      ${tile({ value: esc(f1?.l12 ?? '—'), label: `Avg people per day workshop<br>residential ${esc(f2?.l12 ?? '—')} · beginners ${esc(f3?.l12 ?? '—')}` }, f1?.status === 'ok' ? 'green' : 'amber')}
      ${returningTile(sc)}
      ${tile({ value: String(overdue), label: 'Quarter actions overdue' }, overdue > 0 ? 'red' : 'grey')}
    </tr>
  </table>
  ${marketingAlertsHtml(brief)}
`);
}

/** Same tile as Strategy & Actions: GP and revenue, last 3 months, against the seasonal survival for those months. */
function gpTile(sc, brief) {
  const gp = Number(sc.gp?.t3);
  const survival = Number(sc.gp?.survival ?? brief.survival_gp ?? 0);
  const h = brief.headline || {};
  const gap = survival - gp;
  let sub = '—';
  if (Number.isFinite(gp)) {
    const need = `need ${esc(fmtGbp(survival))} GP · ${esc(fmtGbp(h.rev_needed_t3))} revenue`;
    sub = gap > 0 ? `${need} · <b>${esc(fmtGbp(gap))} GP short</b>` : `${need} · <b>${esc(fmtGbp(Math.abs(gap)))} GP ahead</b>`;
  }
  const basis = `seasonal survival, same 3 months · bills line ${esc(fmtGbp(sc.gp?.bills_line))}`;
  const value = `${esc(fmtGbp(gp))} GP<div style="font-size:15px;font-weight:700;margin-top:3px;">${esc(fmtGbp(h.rev_t3))} revenue</div>`;
  return tile({ value, label: `Gross profit, last 3 months<br>${sub}<br>${basis}` }, Number.isFinite(gp) && gp >= survival ? 'green' : 'red');
}

/** Section 3 · Fill rate + Run rate table. */
export function renderFillRunRateHtml(brief) {
  if (!brief || brief.error) return unavailable(brief);
  const findK = kpiFinder(brief);
  const f4 = findK('F4');
  const f5 = findK('F5');
  const fillParts = String(f4?.l12 || '').split(/\s*\/\s*/).map((s) => s.trim());
  const fillPriorParts = String(f4?.prior || '').split(/\s*\/\s*/).map((s) => s.trim());
  // Counts are "162/241 | 18/32 | …" (pipe between tiles; slash inside each fraction)
  const fillCounts = String(f4?.l12_counts || '').split(/\s*\|\s*/).map((s) => s.trim());
  const fillLabels = ['Day', 'Residential', 'Course', 'All events'];
  const fillCells = fillLabels.map((lab, i) => {
    const pct = fillParts[i] || '—';
    const counts = fillCounts[i] || '';
    const countsHtml = counts && counts !== '—'
      ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;font-weight:600;">${esc(counts)}</div>`
      : '';
    const deltaHtml = fillDeltaHtml(pct, fillPriorParts[i]);
    return `<td style="width:20%;text-align:center;padding:6px 4px;vertical-align:top;${FF}">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${lab}</div>
      <div style="font-size:16px;font-weight:800;color:#101828;margin-top:2px;">${esc(pct)}</div>
      ${countsHtml}
      ${deltaHtml}
    </td>`;
  }).join('');
  const runParts = String(f5?.l12 || '').split(/\s*\/\s*/).map((s) => s.trim());
  const runCounts = String(f5?.l12_counts || '').split(/\s*\|\s*/).map((s) => s.trim());
  const runCells = fillLabels.map((lab, i) => {
    const counts = runCounts[i] && runCounts[i] !== '—'
      ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;font-weight:600;">${esc(runCounts[i])} ran</div>`
      : '';
    return `<td style="width:20%;text-align:center;padding:6px 4px;vertical-align:top;border-top:1px solid #e5e7eb;${FF}">
      <div style="font-size:16px;font-weight:800;color:#101828;">${esc(runParts[i] || '—')}</div>
      ${counts}
    </td>`;
  }).join('');
  const fillRunBlock = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;border:1px solid #e5e7eb;border-radius:8px;${FF}">
    <tr>
      <td style="width:18%;padding:10px 12px;vertical-align:middle;border-right:1px solid #e5e7eb;background:#f8fafc;">
        <div style="font-size:13px;font-weight:800;color:#101828;">Fill rate</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">last 12 months + next 6 months<br>▲/▼ vs same window last year</div>
      </td>
      ${fillCells}
    </tr>
    <tr>
      <td style="padding:10px 12px;vertical-align:middle;border-top:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f8fafc;">
        <div style="font-size:13px;font-weight:800;color:#101828;">Run rate</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">events that ran ÷ scheduled<br>${esc(houseDates(f5?.note || 'since 7 Oct'))}</div>
      </td>
      ${runCells}
    </tr>
  </table>`;
  return wrap(fillRunBlock);
}

/** Section 1 · "Push these 3 this week" (kept for now — overlaps card C; Alan decides later). */
export function renderPushThreeHtml(brief) {
  if (!brief || brief.error) return unavailable(brief);
  const push = (brief.push || []).slice(0, 3);
  const pushItems = push.length
    ? push.map((e) => {
      const href = eventHref(e.url);
      const baseTitle = String(e.title || '').replace(/\s+\d{1,2}\s+\w{3}\s+(AM|PM)\s*$/i, '').trim();
      const short = strategyShortName(baseTitle || e.title);
      const sess = e.session || (/\b(AM|PM)\s*$/i.test(e.title || '') ? RegExp.$1 : '');
      const label = sess
        ? `${short} · ${fmtDay(e.date)} ${sess}`
        : `${short} · ${fmtDay(e.date)}`;
      const link = href
        ? `<a href="${esc(href)}" style="color:${BLUE};text-decoration:none;font-weight:700;">${esc(label)}</a>`
        : `<b>${esc(label)}</b>`;
      const why = String(e.gap || '')
        .replace(/\s*\(time free\)\s*$/i, '')
        .replace(/^needs\s+/i, 'needs ');
      return `<li style="margin:5px 0;font-size:13.5px;${FF}">${link}
        <span style="color:#6b7280;"> · ${esc(why)}</span></li>`;
    }).join('')
    : `<li style="color:#6b7280;font-size:13px;${FF}">Nothing to push</li>`;

  return wrap(`
  <div style="border:1px solid #e5e7eb;border-left:5px solid #E57200;border-radius:8px;padding:12px 16px;margin:0 0 18px;${FF}">
    <div style="font-size:14px;font-weight:800;margin:0 0 8px;color:#101828;">Push these 3 this week</div>
    <ol style="margin:0;padding-left:20px;">${pushItems}</ol>
  </div>
  `);
}

/** Data-quality warning (only when booking snapshots are missing); shown in section 1. */
export function renderSnapshotWarningHtml(brief) {
  const miss = (brief?.snapshot_meta?.missing_last_7 || []);
  return miss.length
    ? `<tr><td style="padding:6px 28px;color:${RED};font-size:13px;font-weight:700;${FF}">Booking snapshot missing for ${esc(miss.join(', '))}, +wk may be wrong</td></tr>`
    : '';
}
