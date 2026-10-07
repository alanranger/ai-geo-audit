/**
 * Monday brief — Strategy v5: Action needed → gaps → push → KPI strip → quarter → data health.
 */
import { buildStrategySummary } from '../strategy-summary.mjs';
import { fmtGbp } from './shared.js';

const FF = 'font-family:Arial,Helvetica,sans-serif';
const GREEN = '#067647';
const RED = '#b42318';
const AMBER = '#b25e09';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function arrow(change) {
  if (change == null || Number.isNaN(Number(change))) return '';
  const v = Number(change);
  const color = v >= 0 ? GREEN : RED;
  return `<span style="color:${color};font-weight:700;">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(0)}%</span>`;
}

function eventHref(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `https://www.alanranger.com${url}`;
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
    trends: s.trends || {}
  };
}

export function renderStrategyBriefHtml(brief) {
  if (!brief || brief.error) {
    return `<tr><td style="padding:12px 28px;color:#667085;${FF}">Strategy — unavailable${brief?.error ? `: ${esc(brief.error)}` : ''}</td></tr>`;
  }
  const end4 = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const gaps = (brief.diary || []).filter((e) => e.date <= end4 && (e.rag === 'red' || e.rag === 'amber'));
  const actions = brief.action_needed || [];
  const push = (brief.push || []).slice(0, 3);
  const sc = brief.scorecard || {};
  const kpi = brief.kpi_scorecard || [];
  const findK = (key) => kpi.find((k) => k.key === key);

  const actionHtml = actions.length
    ? actions.slice(0, 12).map((a) => {
      const href = eventHref(a.url);
      const title = href ? `<a href="${esc(href)}" style="color:#1857c4;text-decoration:none;">${esc(a.title)}</a>` : esc(a.title);
      return `<div style="padding:7px 0;border-bottom:1px solid #eef1f5;${FF}">
        <div style="font-size:13px;color:#101828;">${title} — ${esc(a.detail || a.why || '')}</div>
      </div>`;
    }).join('')
    : `<div style="padding:8px 0;color:#667085;font-size:13px;${FF}">Nothing triggered this week.</div>`;

  const gapHtml = gaps.length
    ? gaps.slice(0, 10).map((e) => {
      const href = eventHref(e.url);
      const name = href ? `<a href="${esc(href)}" style="color:#1857c4;">${esc(e.title)}</a>` : esc(e.title);
      const rag = e.rag === 'red' ? RED : AMBER;
      const pace = e.pace == null ? 'pace —' : `+${e.pace} this week`;
      return `<div style="padding:5px 0;font-size:12.5px;${FF}">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${rag};margin-right:6px;"></span>
        ${esc(e.date)} ${name} · ${e.booked}/${e.cap} · ${esc(e.status)} · ${pace}
        ${e.note ? ` · ${esc(e.note)}` : ''}
        ${e.mismatch ? ` · <b style="color:#b42318">${esc(e.flag_message || 'Sheet and shop counts do not match')}</b>` : ''}
      </div>`;
    }).join('')
    : `<div style="color:#667085;font-size:13px;${FF}">No gaps in next 4 weeks.</div>`;

  const pushHtml = push.length
    ? push.map((e) => {
      const href = eventHref(e.url);
      const name = href ? `<a href="${esc(href)}" style="color:#1857c4;">${esc(e.title)}</a>` : esc(e.title);
      return `<div style="padding:5px 0;font-size:13px;${FF}">${esc(e.date)} ${name} — ${esc(e.gap)}</div>`;
    }).join('')
    : `<div style="color:#667085;font-size:13px;${FF}">Nothing to push.</div>`;

  const g1 = findK('1');
  const f1 = findK('F1');
  const f2 = findK('F2');
  const f3 = findK('F3');
  const f4 = findK('F4');
  const f5 = findK('F5');
  const r9 = findK('9');
  const kpiStrip = `
    <div style="font-size:13px;line-height:1.55;${FF}">
      <div style="padding:5px 0;border-bottom:1px solid #eef1f5;"><b>GP T3</b> ${esc(fmtGbp(sc.gp?.t3))}
        (prior ${esc(fmtGbp(sc.gp?.t3_prior))}) ${arrow(g1?.change)} vs survival ${esc(fmtGbp(sc.gp?.survival))}</div>
      <div style="padding:5px 0;border-bottom:1px solid #eef1f5;"><b>F1–F3</b> day ${esc(f1?.l12 ?? '—')} · res ${esc(f2?.l12 ?? '—')} · beg ${esc(f3?.l12 ?? '—')}
        ${arrow(f1?.change)}</div>
      <div style="padding:5px 0;border-bottom:1px solid #eef1f5;"><b>F4 / F5</b> ${esc(f4?.l12 ?? '—')} · ${esc(f5?.l12 ?? 'building')}
        <span style="color:#667085;font-size:11px;"> · empty runs from 7 Oct 2026</span></div>
      <div style="padding:5px 0;"><b>Returning £</b> ${esc(fmtGbp(sc.returning?.r12))}
        (prior ${esc(fmtGbp(sc.returning?.prior))}) ${arrow(r9?.change)}
        <span style="color:#667085;font-size:11px;"> · Q1 £16k · year-end £23k</span></div>
    </div>`;

  const due = (brief.overdue_actions || []).slice(0, 5);
  const dueHtml = due.length
    ? due.map((a) => `<div style="padding:4px 0;font-size:13px;${FF}">${esc(a.label)} <span style="color:${RED}">OVERDUE</span></div>`).join('')
    : `<div style="color:#667085;font-size:13px;${FF}">No quarter actions overdue.</div>`;

  const health = actions.filter((a) => /MISMATCH|Attendee dates|Data health/i.test(`${a.title} ${a.detail}`));
  const healthHtml = health.length
    ? health.map((a) => `<div style="padding:4px 0;font-size:13px;color:${RED};${FF}">${esc(a.title)} — ${esc(a.detail)}</div>`).join('')
    : '';

  return `
  <tr><td style="padding:14px 28px 4px;"><div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">STRATEGY · current position &amp; gaps</div></td></tr>
  <tr><td style="padding:8px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">1 · Action needed</div></td></tr>
  <tr><td style="padding:2px 28px 10px;">${actionHtml}</td></tr>
  <tr><td style="padding:4px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">2 · Next 4 weeks — gaps (+ places sold this week when snapshots exist)</div></td></tr>
  <tr><td style="padding:2px 28px 10px;">${gapHtml}</td></tr>
  <tr><td style="padding:4px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">3 · Top 3 to push</div></td></tr>
  <tr><td style="padding:2px 28px 10px;">${pushHtml}</td></tr>
  <tr><td style="padding:4px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">4 · KPI scorecard (GP, F1–F5, returning)</div></td></tr>
  <tr><td style="padding:2px 28px 10px;">${kpiStrip}</td></tr>
  <tr><td style="padding:4px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">5 · Quarter actions due</div></td></tr>
  <tr><td style="padding:2px 28px 10px;">${dueHtml}</td></tr>
  ${healthHtml ? `<tr><td style="padding:4px 28px 2px;"><div style="color:#101828;font-size:12px;font-weight:800;${FF}">6 · Data health</div></td></tr>
  <tr><td style="padding:2px 28px 12px;">${healthHtml}</td></tr>` : ''}
`;
}
