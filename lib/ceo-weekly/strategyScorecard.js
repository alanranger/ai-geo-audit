/**
 * Monday brief — Strategy Scorecard + ACTION NEEDED (from strategy-summary).
 */
import { buildStrategySummary } from '../strategy-summary.mjs';
import { fmtGbp } from './shared.js';

const FF = 'font-family:Arial,Helvetica,sans-serif';
const GREEN = '#067647';
const RED = '#b42318';
const AMBER = '#b25e09';
const GREY = '#98a2b3';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function tag(status, label) {
  const color = status === 'ok' ? GREEN : status === 'under' || status === 'behind' ? RED : AMBER;
  return `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:.04em;color:#fff;background:${color};">${esc(label)}</span>`;
}

function gpStatus(t3, survival) {
  if (t3 == null) return { status: 'watch', label: 'N/A' };
  return t3 >= survival ? { status: 'ok', label: 'ON TRACK' } : { status: 'under', label: 'UNDER' };
}

function plansStatus(active, target) {
  if (active == null) return { status: 'watch', label: 'NEEDS PLANS' };
  const pace = target ? active / target : 0;
  return pace >= 0.2 ? { status: 'ok', label: 'ON PACE' } : { status: 'watch', label: 'WATCH' };
}

function begStatus(booked, seats, ytd, dec) {
  const fillOk = seats > 0 ? booked / seats >= 0.5 : true;
  const ytdOk = ytd >= Math.max(1, Math.floor(dec * 0.35));
  if (fillOk && ytdOk) return { status: 'ok', label: 'OK' };
  return { status: 'watch', label: 'WATCH' };
}

function retStatus(r12, target) {
  if (r12 == null) return { status: 'watch', label: 'N/A' };
  return r12 >= target * 0.85 ? { status: 'ok', label: 'OK' } : { status: 'behind', label: 'BEHIND' };
}

/** Slim payload for ceo_weekly metrics + email. */
export async function buildStrategyBrief(supabase, propertyUrl) {
  const s = await buildStrategySummary(supabase, propertyUrl);
  return {
    as_of: s.as_of,
    week_start: s.week_start,
    survival_gp: s.survival_gp,
    scorecard: s.scorecard,
    action_needed: s.action_needed || [],
    overdue_actions: s.overdue_actions || []
  };
}

export function renderStrategyBriefHtml(brief) {
  if (!brief || brief.error) {
    return `<tr><td style="padding:12px 28px;color:#667085;${FF}">Strategy Scorecard — unavailable${brief?.error ? `: ${esc(brief.error)}` : ''}</td></tr>`;
  }
  const sc = brief.scorecard || {};
  const gp = sc.gp || {};
  const plans = sc.plans || {};
  const beg = sc.beginners || {};
  const ret = sc.returning || {};
  const g = gpStatus(gp.t3, gp.survival || brief.survival_gp);
  const p = plansStatus(plans.active, plans.target || 12);
  const b = begStatus(beg.next_8w_booked || 0, beg.next_8w_seats || 0, beg.non_jlr_ytd || 0, beg.dec_target || 8);
  const r = retStatus(ret.r12, ret.target || 16000);

  const mtd = gp.mtd != null ? fmtGbp(gp.mtd) : '—';
  const t3 = gp.t3 != null ? fmtGbp(gp.t3) : '—';
  const surv = fmtGbp(gp.survival || brief.survival_gp || 3700);
  const plansLine = plans.active == null
    ? 'Plans tab not uploaded yet'
    : `sold this week ${plans.sold_week ?? '—'} · active ${plans.active} vs Sep-27 target ${plans.target || 12} (Dec milestone 3)`;
  const begLine = `next 8 weeks ${beg.next_8w_booked || 0} booked / ${beg.next_8w_seats || 0} seats · non-JLR YTD ${beg.non_jlr_ytd || 0} vs Dec target ${beg.dec_target || 8}`;
  const retLine = `rolling 12m ${ret.r12 != null ? fmtGbp(ret.r12) : '—'} vs ${fmtGbp(ret.target || 16000)} (Dec ${fmtGbp(ret.dec_target || 11000)})`;

  const actions = brief.action_needed || [];
  const actionHtml = actions.length
    ? actions.map((a) => `<div style="padding:8px 0;border-bottom:1px solid #eef1f5;${FF}">
        <div style="font-size:13px;color:#101828;"><b>${esc(a.title)}</b> — ${esc(a.detail || '')}</div>
        <div style="font-size:11.5px;color:#667085;margin-top:2px;">${esc(a.why || '')}</div>
      </div>`).join('')
    : `<div style="padding:8px 0;color:#667085;font-size:13px;${FF}">Nothing triggered this week.</div>`;

  return `
  <tr><td style="padding:14px 28px 4px;"><div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">STRATEGY SCORECARD · every week</div></td></tr>
  <tr><td style="padding:4px 28px 8px;">
    <div style="font-size:13px;line-height:1.55;color:#101828;${FF}">
      <div style="padding:6px 0;border-bottom:1px solid #eef1f5;"><b>GP</b> — MTD ${esc(mtd)} · trailing 3m ${esc(t3)} vs ${esc(surv)} survival ${tag(g.status, g.label)}</div>
      <div style="padding:6px 0;border-bottom:1px solid #eef1f5;"><b>Plans</b> — ${esc(plansLine)} ${tag(p.status, p.label)}</div>
      <div style="padding:6px 0;border-bottom:1px solid #eef1f5;"><b>Beginners</b> — ${esc(begLine)} ${tag(b.status, b.label)}</div>
      <div style="padding:6px 0;"><b>Returning clients</b> — ${esc(retLine)} ${tag(r.status, r.label)}</div>
    </div>
  </td></tr>
  <tr><td style="padding:10px 28px 4px;"><div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">ACTION NEEDED · only when triggered</div></td></tr>
  <tr><td style="padding:2px 28px 12px;">${actionHtml}</td></tr>
`;
}
