/**
 * Monday brief — Strategy block (layout 2026-10-08).
 * Presentation only: tiles + push card + upcoming table. No maths changes.
 */
import { buildStrategySummary } from '../strategy-summary.mjs';
import { strategyShortName } from '../strategy-short-names.mjs';
import { fmtGbp } from './shared.js';

const FF = 'font-family:Arial,Helvetica,sans-serif';
const GREEN = '#067647';
const RED = '#b42318';
const AMBER = '#b25e09';
const BLUE = '#1857c4';
const SESSION_BE = 2;

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

function pill(label, tone) {
  const map = {
    red: { bg: '#fde8e8', fg: '#c0262d' },
    amber: { bg: '#fdf3e2', fg: '#b45309' },
    green: { bg: '#e7f6ed', fg: '#0a7a3e' }
  };
  const c = map[tone] || map.amber;
  return `<span style="display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:${c.bg};color:${c.fg};${FF}">${esc(label)}</span>`;
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

function statusForEvent(e) {
  if (e.full || (e.cap > 0 && e.booked >= e.cap)) return { label: 'Full', tone: 'green' };
  if (!e.booked) return { label: 'Empty', tone: 'red' };
  const be = e.be_free != null ? e.be_free : e.be;
  if (be != null && e.booked < be) {
    if (e.type === 'residential') return { label: 'Below break-even', tone: 'amber' };
    return { label: 'Low', tone: 'amber' };
  }
  return { label: 'OK', tone: 'green' };
}

function statusForSessions(am, pm) {
  if (am === 0 && pm === 0) return { label: 'Empty', tone: 'red' };
  if (am === 0) return { label: 'AM empty', tone: 'red' };
  if (pm === 0) return { label: 'PM empty', tone: 'red' };
  const amLow = am < SESSION_BE;
  const pmLow = pm < SESSION_BE;
  if (amLow && pmLow) return { label: 'Both low', tone: 'amber' };
  if (amLow) return { label: 'AM low', tone: 'amber' };
  if (pmLow) return { label: 'PM low', tone: 'amber' };
  return { label: 'OK', tone: 'green' };
}

function paceHtml(pace) {
  if (pace == null || Number(pace) === 0) return '';
  const n = Number(pace);
  const color = n > 0 ? GREEN : RED;
  const txt = n > 0 ? `+${n}` : `−${Math.abs(n)}`;
  return ` <span style="color:${color};font-weight:700;">${txt}</span>`;
}

function typeTag(e) {
  if (e.type === 'residential') return ` <span style="font-size:11px;color:#6b7280;font-weight:600;${FF}">residential</span>`;
  if (e.type === 'course') return ` <span style="font-size:11px;color:#6b7280;font-weight:600;${FF}">3 weeks</span>`;
  return '';
}

/** Collapse AM/PM parents into one row; skip subrows and parents' duplicate children. */
function upcomingRows(diary) {
  const out = [];
  for (const e of diary || []) {
    if (e.is_subrow) continue;
    if (e.is_parent) {
      const am = Number(e.am_sold ?? 0);
      const pm = Number(e.pm_sold ?? 0);
      const st = statusForSessions(am, pm);
      const stale = e.stale14
        || (diary || []).some((x) => x.is_subrow && x.parentKey === e.eventKey && x.stale14);
      out.push({
        date: e.date,
        url: e.url,
        short: strategyShortName(e.title),
        tag: '',
        bookedHtml: `AM ${am} · PM ${pm}`,
        status: st,
        stale14: stale,
        pace: null
      });
      continue;
    }
    const st = statusForEvent(e);
    out.push({
      date: e.date,
      url: e.url,
      short: strategyShortName(e.title),
      tag: typeTag(e),
      bookedHtml: `${e.booked} / ${e.cap}${paceHtml(e.pace)}`,
      status: st,
      stale14: !!e.stale14,
      pace: e.pace
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export async function buildStrategyBrief(supabase, propertyUrl) {
  const s = await buildStrategySummary(supabase, propertyUrl);
  return {
    as_of: s.as_of,
    week_start: s.week_start,
    survival_gp: s.survival_gp,
    plans_connected: !!s.plans_connected,
    scorecard: s.scorecard,
    action_needed: s.action_needed || [],
    overdue_actions: s.overdue_actions || [],
    diary: s.diary || [],
    push: s.push || [],
    kpi_scorecard: s.kpi_scorecard || [],
    trends: s.trends || {},
    snapshot_meta: s.snapshot_meta || {}
  };
}

export function renderStrategyBriefHtml(brief) {
  if (!brief || brief.error) {
    return `<tr><td style="padding:12px 28px;color:#667085;${FF}">Strategy — unavailable${brief?.error ? `: ${esc(brief.error)}` : ''}</td></tr>`;
  }
  const sc = brief.scorecard || {};
  const kpi = brief.kpi_scorecard || [];
  const findK = (key) => kpi.find((k) => k.key === key);
  const f1 = findK('F1');
  const f2 = findK('F2');
  const f3 = findK('F3');
  const f4 = findK('F4');
  const f5 = findK('F5');
  const r9 = findK('9');

  const gp = Number(sc.gp?.t3);
  const survival = Number(sc.gp?.survival ?? brief.survival_gp ?? 3700);
  const gpGap = survival - gp;
  const gpTone = Number.isFinite(gp) && gp >= survival ? 'green' : 'red';
  const gpSub = Number.isFinite(gp)
    ? (gpGap > 0
      ? `need ${esc(fmtGbp(survival))} · <b>${esc(fmtGbp(gpGap))} short</b>`
      : `need ${esc(fmtGbp(survival))} · <b>${esc(fmtGbp(Math.abs(gpGap)))} ahead</b>`)
    : '—';

  const f1Tone = (f1?.status === 'ok') ? 'green' : 'amber';
  const ret = Number(sc.returning?.r12);
  const retTone = (r9?.status === 'ok') ? 'green' : (r9?.status === 'watch' ? 'amber' : 'red');
  const retCh = r9?.change;
  const retArrow = retCh == null || Number.isNaN(Number(retCh))
    ? ''
    : `${Number(retCh) >= 0 ? '▲' : '▼'} ${Math.abs(Number(retCh)).toFixed(0)}%`;
  const overdue = (brief.overdue_actions || []).length;
  const overTone = overdue > 0 ? 'red' : 'grey';

  const fillParts = String(f4?.l12 || '').split(/\s*\/\s*/).map((s) => s.trim());
  // Counts are "162/241 | 18/32 | …" (pipe between tiles; slash inside each fraction)
  const fillCounts = String(f4?.l12_counts || '').split(/\s*\|\s*/).map((s) => s.trim());
  const fillLabels = ['Day', 'Residential', 'Course', 'Average'];
  const fillCells = fillLabels.map((lab, i) => {
    const pct = fillParts[i] || '—';
    const counts = fillCounts[i] || '';
    const countsHtml = counts && counts !== '—'
      ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;font-weight:600;">${esc(counts)}</div>`
      : '';
    return `<td style="width:20%;text-align:center;padding:6px 4px;vertical-align:top;${FF}">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;">${lab}</div>
      <div style="font-size:16px;font-weight:800;color:#101828;margin-top:2px;">${esc(pct)}</div>
      ${countsHtml}
    </td>`;
  }).join('');
  const runVal = f5?.l12 ?? 'building';
  const fillRunBlock = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;border:1px solid #e5e7eb;border-radius:8px;${FF}">
    <tr>
      <td style="width:18%;padding:10px 12px;vertical-align:middle;border-right:1px solid #e5e7eb;background:#f8fafc;">
        <div style="font-size:13px;font-weight:800;color:#101828;">Fill rate</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">last 12 months + next 6 months</div>
      </td>
      ${fillCells}
    </tr>
    <tr>
      <td style="padding:10px 12px;vertical-align:middle;border-top:1px solid #e5e7eb;border-right:1px solid #e5e7eb;background:#f8fafc;">
        <div style="font-size:13px;font-weight:800;color:#101828;">Run rate</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">ran ÷ scheduled</div>
      </td>
      <td colspan="4" style="padding:10px 12px;border-top:1px solid #e5e7eb;vertical-align:middle;">
        <div style="font-size:16px;font-weight:800;color:#101828;">${esc(runVal)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">Empty-run tracking from 7 Oct 2026 · Average = mean of Day / Residential / Course</div>
      </td>
    </tr>
  </table>`;

  const tiles = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:8px 0;margin:0 0 14px;">
    <tr>
      ${tile({ value: esc(fmtGbp(gp)), label: `Gross profit, last 3 months<br>${gpSub}` }, gpTone)}
      ${tile({ value: esc(f1?.l12 ?? '—'), label: `Avg people per day workshop<br>residential ${esc(f2?.l12 ?? '—')} · beginners ${esc(f3?.l12 ?? '—')}` }, f1Tone)}
      ${tile({ value: esc(fmtGbp(ret)), label: `From returning clients<br>${esc(retArrow)} · on track for £23k` }, retTone)}
      ${tile({ value: String(overdue), label: 'Quarter actions overdue' }, overTone)}
    </tr>
  </table>
  ${fillRunBlock}`;

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

  const pushCard = `
  <div style="border:1px solid #e5e7eb;border-left:5px solid #E57200;border-radius:8px;padding:12px 16px;margin:0 0 18px;${FF}">
    <div style="font-size:14px;font-weight:800;margin:0 0 8px;color:#101828;">Push these 3 this week</div>
    <ol style="margin:0;padding-left:20px;">${pushItems}</ol>
  </div>`;

  const end4 = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const rows = upcomingRows(brief.diary);
  const near = rows.filter((r) => r.date <= end4);
  const later = rows.filter((r) => r.date > end4);

  function tableRows(list) {
    return list.map((r) => {
      const href = eventHref(r.url);
      const name = href
        ? `<a href="${esc(href)}" style="color:${BLUE};text-decoration:none;">${esc(r.short)}</a>`
        : esc(r.short);
      const note = r.stale14
        ? `<span style="display:block;font-size:11.5px;color:#6b7280;margin-top:2px;${FF}">no sales in 14 days</span>`
        : '';
      return `<tr>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#6b7280;width:78px;${FF}">${esc(fmtDay(r.date))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;${FF}">${name}${r.tag}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;${FF}">${r.bookedHtml}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #e5e7eb;${FF}">${pill(r.status.label, r.status.tone)}${note}</td>
      </tr>`;
    }).join('');
  }

  const divRow = (label) => `<tr><td colspan="4" style="background:#f6f7f9;font-size:11px;font-weight:800;letter-spacing:.05em;color:#6b7280;padding:5px 6px;${FF}">${label}</td></tr>`;

  const table = `
  <div style="font-size:13.5px;font-weight:700;margin:0 0 6px;color:#101828;${FF}">Upcoming events</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13.5px;${FF}">
    <thead><tr>
      <th align="left" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;font-weight:700;padding:6px;border-bottom:2px solid #e5e7eb;">Date</th>
      <th align="left" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;font-weight:700;padding:6px;border-bottom:2px solid #e5e7eb;">Event</th>
      <th align="right" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;font-weight:700;padding:6px;border-bottom:2px solid #e5e7eb;">Booked</th>
      <th align="left" style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;font-weight:700;padding:6px;border-bottom:2px solid #e5e7eb;">Status</th>
    </tr></thead>
    <tbody>
      ${divRow('NEXT 4 WEEKS')}
      ${tableRows(near) || `<tr><td colspan="4" style="padding:8px 6px;color:#6b7280;${FF}">No events</td></tr>`}
      ${later.length ? `${divRow('LATER')}${tableRows(later)}` : ''}
    </tbody>
  </table>
  <div style="color:#6b7280;font-size:11.5px;margin-top:10px;${FF}">Batsford: AM and PM sessions are 6 places each.</div>`;

  const miss = (brief.snapshot_meta?.missing_last_7 || []);
  const snapWarn = miss.length
    ? `<tr><td style="padding:6px 28px;color:${RED};font-size:13px;font-weight:700;${FF}">Booking snapshot missing for ${esc(miss.join(', '))}, +wk may be wrong</td></tr>`
    : '';

  return `
  <tr><td style="padding:14px 28px 4px;"><div style="color:${BLUE};font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">STRATEGY · WHERE YOU STAND</div></td></tr>
  ${snapWarn}
  <tr><td style="padding:4px 28px 12px;">${tiles}${pushCard}${table}</td></tr>
`;
}
