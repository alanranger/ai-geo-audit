/**
 * Monday CEO email — layout = 03 Page Builds/MOCKUP-monday-brief-v7-headline-tiles.html (approved 2 Nov 2026).
 * Anti-drift: structure/colours match the approved mock; numbers from live metrics.
 */
import { CEO_REPORT_TO, fmtGbp, fmtNum } from './shared.js';
import { renderSectionGHtml } from './sectionG.js';
import {
  renderStrategyTilesHtml, renderFillRunRateHtml, renderSnapshotWarningHtml
} from './strategyScorecard.js';
import {
  renderHeadlinesHtml, renderCardHtml, renderActionsFootnoteHtml, renderSectionHeadingHtml,
  renderPipelineHtml, renderSalesTabHtml, renderSystemHealthHtml
} from './brief-layout.js';
import {
  websiteSubtitle, backlinksSubtitle, seoHealthSubtitle, moneySubtitle, aiFrontSubtitle, openFailsText
} from './subtitles.js';
import { dialBasisNote } from './dial-like-for-like.js';
import { buildRemindersCard } from './ops-reminders.js';

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

/** Prefer pre-formatted labels from moneyDeltaArrow / deltaArrow (already ▲/▼); add the arrow / £ when missing. */
function deltaLabel(wow, d, money) {
  const label = String(wow.label || '').trim();
  if (/[▲▼→]/.test(label)) {
    return money && !/£/.test(label) && d !== 0 ? label.replace(/^([▲▼→])\s*/, '$1 £') : label;
  }
  const arrow = d > 0 ? '▲' : (d < 0 ? '▼' : '→');
  const body = label.replace(/^[↑↓]\s*/, '').trim();
  return money && body && !body.startsWith('£') ? `${arrow} £${body}` : `${arrow} ${body}`;
}

function deltaHtml(wow, { money = false } = {}) {
  if (!wow || wow.label === 'n/a' || wow.delta == null) {
    return `<span style="color:${GREY};font-weight:600">→ n/a</span>`;
  }
  const d = Number(wow.delta);
  const label = deltaLabel(wow, d, money);
  // A change that rounds to zero is "no change", not up or down.
  if (/^[▲▼]\s*£?0(\.0+)?%?$/.test(label)) return `<span style="color:${GREY};font-weight:600">→ 0</span>`;
  const color = d > 0 ? GREEN : (d < 0 ? RED : AMBER);
  return `<span style="color:${color};font-weight:600">${esc(label)}</span>`;
}

function row3(label, value, deltaHtmlStr) {
  return `<tr>
    <td style="padding:7px 0;color:#475467;border-bottom:1px solid #eef1f5;${FF}">${esc(label)}</td>
    <td align="right" style="padding:7px 0;font-weight:700;border-bottom:1px solid #eef1f5;color:#101828;${FF}">${value}</td>
    <td align="right" style="padding:7px 0 7px 14px;font-weight:600;border-bottom:1px solid #eef1f5;white-space:nowrap;${FF}">${deltaHtmlStr}</td>
  </tr>`;
}

function row3Last(label, value, deltaHtmlStr) {
  return `<tr>
    <td style="padding:7px 0;color:#475467;${FF}">${esc(label)}</td>
    <td align="right" style="padding:7px 0;font-weight:700;color:#101828;${FF}">${value}</td>
    <td align="right" style="padding:7px 0 7px 14px;font-weight:600;white-space:nowrap;${FF}">${deltaHtmlStr}</td>
  </tr>`;
}

function surfaceBar(label, pct, good) {
  const p = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
  const color = pct == null ? GREY : good ? GREEN : RED;
  const width = pct == null || p === 0 ? 100 : Math.max(p, 2);
  const fill = pct == null || p === 0
    ? `<td style="background:#eef1f5;height:11px;width:100%;border-radius:3px;"></td>`
    : `<td style="background:${color};height:11px;width:${width}%;border-radius:3px 0 0 3px;"></td><td style="background:#eef1f5;height:11px;"></td>`;
  const pctLabel = pct == null ? '—' : `${Math.round(p)}%`;
  return `<tr>
    <td style="padding:5px 0;color:#101828;width:130px;${FF}">${esc(label)}</td>
    <td style="padding:5px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${fill}</tr></table></td>
    <td align="right" style="padding:5px 0;color:${color};font-weight:700;width:60px;${FF}">${esc(pctLabel)}</td>
  </tr>`;
}

function chipDelta(wow) {
  if (!wow || wow.stale || wow.delta == null) return '→ n/a';
  const d = Number(wow.delta);
  if (d > 0) return `▲${Math.round(Math.abs(d))}`;
  if (d < 0) return `▼${Math.round(Math.abs(d))}`;
  return '→0';
}

function snapDeltaHtml(wow) {
  if (wow?.withheld) return `<span style="color:${GREY};font-weight:600">—</span>`;
  if (!wow) return `<span style="color:${GREY};font-weight:600">→ from next Monday</span>`;
  if (wow.pending || wow.label === 'from next Monday' || wow.delta == null) {
    return `<span style="color:${GREY};font-weight:600">→ from next Monday</span>`;
  }
  return deltaHtml(wow);
}

function daBandBar(band, maxDf) {
  const n = Number(band.dofollow) || 0;
  const pct = maxDf > 0 ? Math.max(2, Math.round((n / maxDf) * 100)) : 2;
  const color = (band.key === 'r80_100' || band.key === 'r50_79')
    ? GREEN
    : band.key === 'r30_49'
      ? '#5b9bd5'
      : '#b0b7c3';
  const fill = n === 0
    ? `<td style="background:#eef1f5;height:10px;width:100%;"></td>`
    : pct >= 100
      ? `<td style="background:${color};height:10px;width:100%;"></td>`
      : `<td style="background:${color};height:10px;width:${pct}%;"></td><td style="background:#eef1f5;height:10px;"></td>`;
  return `<tr><td style="padding:4px 0;color:#101828;width:140px;${FF}">${esc(band.label)}</td><td style="padding:4px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${fill}</tr></table></td><td align="right" style="padding:4px 0;font-weight:700;width:40px;${FF}">${esc(fmtNum(n))}</td><td align="right" style="padding:4px 0 4px 10px;font-weight:600;width:48px;white-space:nowrap;${FF}">${snapDeltaHtml(band.wow_dofollow)}</td></tr>`;
}

function moverLines(items, color) {
  if (!items?.length) return `<span style="color:${GREY}">none this period</span>`;
  return items.map((m) => {
    const d = Number(m.delta) || 0;
    const sign = d > 0 ? '+' : '−';
    return `${esc(m.title)} <b style="color:${color};">${sign}${fmtNum(Math.abs(d))}</b>`;
  }).join('<br>');
}

/** Spam score + domain rank: labelled with the summary's date only when it wasn't fetched with this week's index. */
function summaryDate(bl) {
  if (!bl.summary_as_of) return '';
  const d = new Date(bl.summary_as_of);
  const index = Date.parse(bl.index_basis?.last_full_at || '');
  if (Number.isFinite(index) && Math.abs(d.getTime() - index) < 36 * 3600000) return '';
  return ` (DFS summary, ${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })})`;
}

function newLinksRows(bl, newLinks) {
  if (bl.wow?.referring_domains?.withheld) {
    return `<tr><td style="padding:4px 0;color:${GREY};${FF}" colspan="2">not comparable this week — the backlink index was rebuilt</td></tr>`;
  }
  if (newLinks.status === 'from_next_monday' || newLinks.status === 'error') {
    return `<tr><td style="padding:4px 0;color:${GREY};${FF}" colspan="2">from next Monday once ≥2 weekly snapshots exist</td></tr>`;
  }
  if (!newLinks.items?.length) return `<tr><td style="padding:4px 0;color:#101828;${FF}">none this week</td><td></td></tr>`;
  return newLinks.items.map((it, i) => {
    const border = i < newLinks.items.length - 1 ? 'border-bottom:1px solid #eef1f5;' : '';
    return `<tr><td style="padding:4px 0;color:#101828;${border}${FF}">${esc(it.host)}</td><td align="right" style="padding:4px 0;color:#667085;${border}${FF}">DA ${esc(fmtNum(it.da))}</td></tr>`;
  }).join('');
}

function renderBacklinksBlock(metrics) {
  const bl = metrics.backlinks || {};
  const bands = bl.da_bands || [];
  const maxDf = Math.max(1, ...bands.map((b) => Number(b.dofollow) || 0));
  const bandRows = bands.map((b) => daBandBar(b, maxDf)).join('');
  const newLinks = bl.new_links || {};
  const newLinksBody = newLinksRows(bl, newLinks);
  const followRight = bl.follow_pct != null
    ? `<span style="color:${GREY};font-weight:600">${esc(String(bl.follow_pct))}% follow</span>`
    : `<span style="color:${GREY};font-weight:600">—</span>`;

  return `
  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">Backlinks &amp; authority</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${esc(backlinksSubtitle(bl))}</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('Referring domains', esc(fmtNum(bl.referring_domains)), snapDeltaHtml(bl.wow?.referring_domains))}
      ${row3('Total backlinks', esc(fmtNum(bl.backlinks)), snapDeltaHtml(bl.wow?.backlinks))}
      ${row3('Dofollow / nofollow', `${esc(fmtNum(bl.dofollow))} / ${esc(fmtNum(bl.nofollow))}`, followRight)}
      ${row3(`Spam score${summaryDate(bl)}`, `${esc(fmtNum(bl.spam_score))}${bl.spam_label ? ` · ${esc(bl.spam_label)}` : ''}`, snapDeltaHtml(bl.wow?.spam_score))}
      ${row3Last(`DFS domain rank${summaryDate(bl)}`, esc(fmtNum(bl.rank)), snapDeltaHtml(bl.wow?.rank))}
    </table>
  </td></tr>
  <tr><td style="padding:10px 28px 0;">
    <div style="color:#667085;font-size:11px;font-weight:700;margin-bottom:6px;${FF}">DOFOLLOW BY DOMAIN AUTHORITY <span style="color:${GREY};font-weight:400;">· count + Δ wk</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px;${FF}">${bandRows}</table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">Δ = change vs last Monday ("—" when last week's figures came from a different index). Healthy shape: dofollow concentrated in strong (50–79) domains.</div>
  </td></tr>
  <tr><td style="padding:6px 28px 0;">
    <div style="color:${GREEN};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▲ NEW DOFOLLOW LINKS THIS WEEK · DA ≥ 50</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px;${FF}">${newLinksBody}</table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">New dofollow links from DA ≥ 50 domains vs last Monday's index.</div>
  </td></tr>
`;
}

function positionBits(value, wow) {
  const v = value != null ? Number(value).toFixed(1) : '—';
  const d = (wow?.pending || wow?.delta == null) ? 'from next Monday' : (wow.label || '→ 0');
  return { v, d };
}

function renderRankingsBlock(metrics) {
  const rk = metrics.rankings || {};
  const buckets = rk.buckets || {};
  const { v: avgPos, d: avgPosDelta } = positionBits(rk.avg_position, rk.wow?.avg_position);
  const { v: moneyAvg, d: moneyAvgDelta } = positionBits(rk.money_avg_position, rk.wow?.money_avg_position);
  const bucketCell = (key, bg, color, label) => {
    const n = buckets[key];
    const wow = rk.wow?.[key];
    let deltaBit = '';
    if (!rk.buckets_pending && wow && !wow.pending && wow.delta != null) {
      const d = Number(wow.delta);
      deltaBit = d === 0
        ? ` <span style="font-size:10px;color:${GREY};font-weight:600;">→0</span>`
        : ` <span style="font-size:10px;color:${d > 0 ? GREEN : RED};font-weight:600;">${d > 0 ? '▲' : '▼'}${Math.abs(Math.round(d))}</span>`;
    }
    return `<td style="background:${bg};border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:${color};${FF}">${esc(fmtNum(n))}${deltaBit}</div><div style="font-size:10px;color:#667085;${FF}">${label}</div></td>`;
  };

  return `
  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">Ranking changes</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Tracked money-keyword set · ${esc(fmtNum(rk.tracked))} keywords.</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="text-align:center;">
      <tr>
        ${bucketCell('b1', '#f0faf4', GREEN, '#1')}
        <td style="width:6px;"></td>
        ${bucketCell('b2_3', '#f0faf4', GREEN, '#2–3')}
        <td style="width:6px;"></td>
        ${bucketCell('b4_10', '#f7f9fc', '#101828', '#4–10')}
        <td style="width:6px;"></td>
        ${bucketCell('b11_20', '#fdf4e3', AMBER, '#11–20')}
        <td style="width:6px;"></td>
        ${bucketCell('b21', '#fdf1f0', RED, '#21+')}
      </tr>
    </table>
    ${rk.buckets_pending ? `<div style="color:${GREY};font-size:11px;padding:6px 0 0;${FF}">Δ from next Monday</div>` : ''}
  </td></tr>
  <tr><td style="padding:12px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:8px;"><div style="color:${GREEN};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▲ BIGGEST CLIMBERS (clicks)</div><div style="color:#344054;font-size:11.5px;line-height:1.7;${FF}">${moverLines(rk.movers?.climbers, GREEN)}</div></td>
        <td style="width:50%;vertical-align:top;padding-left:8px;"><div style="color:${RED};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▼ BIGGEST DROPPERS (clicks)</div><div style="color:#344054;font-size:11.5px;line-height:1.7;${FF}">${moverLines(rk.movers?.droppers, RED)}</div></td>
      </tr>
    </table>
    <div style="color:${GREY};font-size:11px;padding:8px 0 0;${FF}">Avg position (tracked) ${esc(avgPos)} ${esc(avgPosDelta)} · money-page avg ${esc(moneyAvg)} ${esc(moneyAvgDelta)} · window ~28d.</div>
  </td></tr>
`;
}

function seoHealthDeltas(sh) {
  const arrow = (d) => (d > 0 ? '▲' : d < 0 ? '▼' : '→');
  let scoreWow = sh.score_wow?.delta != null ? `${arrow(sh.score_wow.delta)}${Math.abs(Math.round(sh.score_wow.delta))}` : '';
  if (sh.score_wow?.withheld) scoreWow = '—';
  const ds = sh.domain_strength_wow?.delta;
  const dsLabel = ds != null ? ` ${arrow(Number(ds))}${Math.abs(Number(ds)).toFixed(1)}` : '';
  const rkd = sh.ranking_keywords_wow?.delta;
  const rkKwLabel = rkd != null ? ` ${arrow(Number(rkd))}${fmtNum(Math.abs(Number(rkd)))}` : ' → n/a';
  return { scoreWow, dsLabel, rkKwLabel };
}

function renderSeoHealthBlock(metrics) {
  const sh = metrics.seo_health || {};
  const hy = sh.hygiene || {};
  const { scoreWow, dsLabel, rkKwLabel } = seoHealthDeltas(sh);
  return `
  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">SEO health</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${esc(seoHealthSubtitle(sh))}</div></td></tr>
  <tr><td style="padding:8px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:33%;background:#f0faf4;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:${GREEN};${FF}">${esc(fmtNum(sh.score))}</div><div style="font-size:10px;color:#667085;${FF}">health /100 ${esc(scoreWow)}</div></td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f7f9fc;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:#101828;${FF}">${sh.domain_strength != null ? esc(Number(sh.domain_strength).toFixed(1)) : '—'}</div><div style="font-size:10px;color:#667085;${FF}">domain strength${esc(dsLabel)}</div></td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f7f9fc;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:#101828;${FF}">${esc(fmtNum(sh.ranking_keywords))}</div><div style="font-size:10px;color:#667085;${FF}">ranking keywords${esc(rkKwLabel)}</div></td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-top:10px;${FF}">
      <tr><td style="padding:7px 0;color:#475467;border-bottom:1px solid #eef1f5;">Hygiene rules (${esc(fmtNum(hy.enabled))})</td><td align="right" style="padding:7px 0;font-weight:700;border-bottom:1px solid #eef1f5;">${esc(fmtNum(hy.pass))} pass · ${esc(fmtNum(hy.warn))} warn · ${esc(fmtNum(hy.fail))} fail</td></tr>
      <tr><td style="padding:7px 0;color:#475467;">Open fails</td><td align="right" style="padding:7px 0;font-weight:700;color:${RED};">${esc(openFailsText(sh))}</td></tr>
    </table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">${esc(sh.caveat || 'Deep extractability rules refresh on the server run once mirrored — headline score is live.')}</div>
  </td></tr>`;
}

/** London calendar date the audit/report was generated (agreed label rule). */
function londonAuditRunLabel(isoOrWeekStart) {
  try {
    const d = isoOrWeekStart && String(isoOrWeekStart).includes('T')
      ? new Date(isoOrWeekStart)
      : new Date();
    if (Number.isNaN(d.getTime())) return String(isoOrWeekStart || '');
    return d.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
    });
  } catch {
    return String(isoOrWeekStart || '');
  }
}

function londonAuditRunTimeLabel(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London'
    });
  } catch {
    return '';
  }
}


function renderAcademySection(metrics) {
  const a = metrics.academy || {};
  if (!a.available) {
    return `<tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">The Academy</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Metrics unavailable (${esc(a.error || 'not configured')}).</div></td></tr>`;
  }
  const mins = a.avg_session_minutes_7d == null ? '—' : `${a.avg_session_minutes_7d} min`;
  return `<tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">The Academy</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Trials, paid members, and 7-day engagement vs prior 7 days.</div></td></tr>
  <tr><td style="padding:8px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('New trials (7d)', esc(fmtNum(a.trials_started_7d)), deltaHtml(a.trials_started_wow))}
      ${row3('Trials converted (7d)', esc(fmtNum(a.converted_7d)), deltaHtml(a.converted_wow))}
      ${row3('Trials lost / ended (7d)', esc(fmtNum(a.lost_7d)), deltaHtml(a.lost_wow))}
      ${row3('Current trials', esc(fmtNum(a.current_trials)), `<span style="color:${GREY};font-weight:600">→ now</span>`)}
      ${row3('Current paid (annual)', esc(fmtNum(a.current_annual)), `<span style="color:${GREY};font-weight:600">→ now</span>`)}
      ${row3('Unique users active (7d)', esc(fmtNum(a.active_users_7d)), deltaHtml(a.active_users_wow))}
      ${row3('Avg session length (7d)', esc(mins), deltaHtml(a.avg_session_minutes_wow))}
      ${row3('Unique modules opened (7d)', esc(fmtNum(a.unique_modules_7d)), deltaHtml(a.unique_modules_wow))}
      ${row3Last('Exam attempts (7d)', esc(fmtNum(a.exam_attempts_7d)), deltaHtml(a.exam_attempts_wow))}
    </table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">Session length estimated from login→activity/logout (capped 120 min). Source: Academy admin DB.</div>
  </td></tr>`;
}

export function renderFailSafeEmail(reason, weekStart) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f5;${FF}">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:14px;${FF}">
  <tr><td style="background:#0f2740;padding:22px 28px;">
    <div style="color:#8fb0d0;font-size:12px;font-weight:600;">ALAN RANGER PHOTOGRAPHY · WEEKLY BUSINESS BRIEF</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px;">Refresh failed — no report</div>
  </td></tr>
  <tr><td style="padding:22px 28px;font-size:15px;color:#101828;">
    <p>Week starting <strong>${esc(weekStart)}</strong>.</p>
    <p>The Monday 01:00 refresh did not complete cleanly — <strong>no business numbers</strong> in this email.</p>
    <p><strong>Reason:</strong> ${esc(reason)}</p>
  </td></tr>
  </table></td></tr></table></body></html>`;
}

function rowLabelHtml(labelHtml, value, deltaHtmlStr) {
  return `<tr>
    <td style="padding:7px 0;color:#475467;border-bottom:1px solid #eef1f5;${FF}">${labelHtml}</td>
    <td align="right" style="padding:7px 0;font-weight:700;border-bottom:1px solid #eef1f5;color:#101828;${FF}">${value}</td>
    <td align="right" style="padding:7px 0 7px 14px;font-weight:600;border-bottom:1px solid #eef1f5;white-space:nowrap;${FF}">${deltaHtmlStr}</td>
  </tr>`;
}

function renderHeader(metrics) {
  const runAt = metrics.generated_at || new Date().toISOString();
  return `
  <tr><td style="background:#0f2740;padding:22px 28px;">
    <div style="color:#8fb0d0;font-size:12px;letter-spacing:.4px;font-weight:600;${FF}">ALAN RANGER PHOTOGRAPHY · WEEKLY BUSINESS BRIEF</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px;${FF}">Monday brief · as of ${esc(londonAuditRunLabel(runAt))}</div>
    <div style="color:#6d8fb0;font-size:12px;margin-top:4px;${FF}">Audit run ${esc(londonAuditRunTimeLabel(runAt))} London · vs last Monday</div>
  </td></tr>`;
}

function chipCell(chip, { bg, fg, sub, name }) {
  const flags = `${chip?.stale ? ' (stale)' : ''}${chip?.provisional ? ' · provisional' : ''}${chip?.withheld ? ' · n/c geo' : ''}`;
  return `<td style="width:33%;background:${bg};border-radius:8px;padding:9px;text-align:center;"><div style="font-size:19px;font-weight:800;color:${fg};${FF}">${esc(fmtNum(chip?.value))}</div><div style="font-size:10px;color:${sub};${FF}">${name} ${esc(chipDelta(chip?.wow))}${flags}</div></td>`;
}

function dialBasisNoteHtml(chips) {
  const note = dialBasisNote(chips);
  return note ? `<div style="color:#667085;font-size:11px;padding:5px 0 0;${FF}">${esc(note)}</div>` : '';
}

function authorityDelta(auth) {
  if (auth?.stale) return `<span style="color:${GREY};font-weight:600">→ n/a</span>`;
  const pending = { pending: true, label: 'from next Monday', delta: null };
  return snapDeltaHtml(auth?.wow?.delta == null && !auth?.wow?.pending ? pending : (auth?.wow || pending));
}

/** Section 4 · The website (unchanged block, letter removed). */
function renderWebsiteBlock(metrics) {
  const acq = metrics.acquisition || {};
  const rk = metrics.rankings || {};
  const auth = metrics.authority || {};
  const chips = metrics.chips || {};
  const brand = chips.brand || {};
  return `
  <tr><td style="padding:8px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">The website</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${esc(websiteSubtitle(acq))}</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${chipCell(chips.surface_vis, { bg: '#fdf4e3', fg: '#7a4405', sub: AMBER, name: 'surface vis' })}
      <td style="width:8px;"></td>
      ${chipCell(chips.top_of_page, { bg: '#f3e8fb', fg: '#6b21a8', sub: '#7c3aed', name: 'top of page' })}
      <td style="width:8px;"></td>
      <td style="width:33%;background:#e7f0fb;border-radius:8px;padding:9px;text-align:center;"><div style="font-size:19px;font-weight:800;color:#1857c4;${FF}">${esc(fmtNum(brand.value))}</div><div style="font-size:10px;color:#1857c4;${FF}">brand ${esc(chipDelta(brand.wow))}</div></td>
    </tr></table>
    ${dialBasisNoteHtml(chips)}
  </td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('Attributed visits (GA4)', esc(fmtNum(acq.attributed_visits)), deltaHtml(acq.attributed_wow))}
      ${row3('Google organic', esc(fmtNum(acq.google_organic?.value)), deltaHtml(acq.google_organic?.wow))}
      ${row3('Direct', esc(fmtNum(acq.direct?.value)), deltaHtml(acq.direct?.wow))}
      ${row3('GSC clicks', esc(fmtNum(acq.gsc_clicks?.value)), deltaHtml(acq.gsc_clicks?.wow))}
      ${row3('Keywords on page 1', `${esc(fmtNum(rk.page1))} / ${esc(fmtNum(rk.tracked))}`, snapDeltaHtml(rk.wow?.page1))}
      ${row3Last('Authority (E-E-A-T)', esc(fmtNum(auth.score)), authorityDelta(auth))}
    </table>
    <div style="color:${GREY};font-size:11px;padding:5px 0;${FF}">${esc(acq.bot_footer || '')} Authority = Behaviour ${esc(fmtNum(auth.behaviour))} / Ranking ${esc(fmtNum(auth.ranking))} / Backlinks ${esc(fmtNum(auth.backlinks))} / Reviews ${esc(fmtNum(auth.reviews))}.</div>
  </td></tr>`;
}

function fmtRollDay(ymd) {
  return ymd
    ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
}

function rollingPeriodNote(roll) {
  const endInclusive = roll.end ? new Date(Date.parse(`${roll.end}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
  const from = fmtRollDay(roll.start);
  const to = fmtRollDay(endInclusive || roll.end);
  return from && to
    ? `Figures are rolling 28 days from ${from} to ${to} (inclusive), compared with the prior 28 days. Not calendar month / MTD.`
    : 'Figures are rolling 28 days vs the prior 28 days. Not calendar month / MTD.';
}

/** No projection yet (week 1) → say so, as the Sales table does; never blank dashes. */
function pulseBits(pulse) {
  const has = pulse.projected_month_end != null;
  let delta = '';
  if (has && pulse.miss_vs_survival != null) {
    delta = `<span style="color:${RED};font-weight:600">${esc(`▼ £${Math.round(Number(pulse.miss_vs_survival)).toLocaleString('en-GB')} vs survival`)}</span>`;
  }
  const defcon = pulse.defcon_level ? ` · DEFCON ${pulse.defcon_level}${pulse.defcon_status ? ` ${pulse.defcon_status}` : ''}` : '';
  let note = null;
  if (pulse.month_label) {
    note = has
      ? `Current Month Pulse: ${pulse.month_label} · ${pulse.days_remaining ?? '—'} days left${defcon} — same as Revenue Truth tile.`
      : `Current Month Pulse: ${pulse.month_label} projection from week 2 (too few days of sales so far).`;
  }
  return {
    label: pulse.month_label ? `${pulse.month_label} projected (Current Month Pulse)` : 'Current month projected (Revenue Truth)',
    value: has ? esc(fmtGbp(pulse.projected_month_end)) : 'from week 2',
    delta,
    note
  };
}

/** Section 2 · Money signals ("The money" cut down: category rows retired — the Sales-tab table is the one category table). */
function survivalLineLabel(rt) {
  const sales = Math.round(rt.survival_sales_derived || rt.survival || 0).toLocaleString('en-GB');
  const gp = Math.round(rt.survival_gp || 0).toLocaleString('en-GB');
  return `Sales (28 days) vs survival line £${sales} <span style="color:#98a2b3">(rolling 28 days · survival GP £${gp} this month, seasonal)</span>`;
}

function moneyPageBits(mp, fun) {
  return {
    behaviour: `${mp.behaviour_score != null ? Math.round(mp.behaviour_score) : '—'}/100`,
    leak: fun.money_conversion_pct == null ? '—' : `${fun.money_conversion_pct.toFixed(2)}%`,
    upside: (mp.top_upside || []).map((p) => `${esc(p.title)} +${fmtNum(p.upside)}`).join(' · ') || '—'
  };
}

function renderMoneySignals(metrics) {
  const rt = metrics.revenue_truth || {};
  const roll = rt.rolling_4wk || {};
  const pulse = pulseBits(metrics.current_month_pulse || {});
  const fun = metrics.funnel || {};
  const mpb = moneyPageBits(metrics.money_pages || {}, fun);
  return `<tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">Money signals</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${esc(moneySubtitle(rt))}</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${rowLabelHtml(survivalLineLabel(rt), esc(fmtGbp(roll.amount)), deltaHtml(roll.wow, { money: true }))}
      ${row3(pulse.label, pulse.value, pulse.delta)}
      ${row3('Money-page behaviour', mpb.behaviour, `<span style="color:${AMBER};font-weight:600">amber</span>`)}
      ${row3Last('Money conversion (leak)', mpb.leak, deltaHtml(fun.wow?.money_conversion))}
    </table>
    <div style="color:#344054;font-size:11.5px;padding:8px 0 2px;${FF}"><b>Period:</b> ${esc(rollingPeriodNote(roll))}</div>
    ${pulse.note ? `<div style="color:#344054;font-size:11.5px;padding:2px 0;${FF}"><b>Projection:</b> ${esc(pulse.note)}</div>` : ''}
    <div style="color:#667085;font-size:11.5px;padding:4px 0 6px;${FF}">Top pages to fix (upside clicks 28d): ${mpb.upside}.</div>
  </td></tr>`;
}

function demandLineOf(surf) {
  const demand = surf.demand || {};
  const d1 = demand.rank1 || {};
  const d10 = demand.top10 || {};
  const s = demand.strike || {};
  if (d10.poolSize == null) return '';
  return `Commercial-pool demand · Rank #1 ${d1.count ?? '—'}/${d1.poolSize ?? '—'} (${d1.demandPct ?? '—'}%) · Top-10 ${d10.count ?? '—'}/${d10.poolSize ?? '—'} (${d10.demandPct ?? '—'}%) · Striking 11–20 ${s.count ?? '—'}/${s.poolSize ?? '—'} (${s.demandPct ?? '—'}%).`;
}

function dialLineOf(surf) {
  if (surf.surface_score == null && surf.top_of_page_score == null) return '';
  const r = (v) => (v != null ? Math.round(v) : '—');
  return `Site dials · Surface ${r(surf.surface_score)}/100 · Top of page ${r(surf.top_of_page_score)}/100 · Tracked ${surf.tracked_keywords ?? '—'} keywords.`;
}

/** Section 4 · The AI front (unchanged block, letter removed; the 28-day AI-visits figure is labelled as such). */
function aiNamedLine(metrics) {
  const llm = metrics.llm || {};
  const unit = Number(llm.prompts_total) === 12 ? 'strategy questions' : 'keywords';
  const ai = metrics.acquisition?.ai_assistant?.wow?.label || '';
  return `Named by ChatGPT ${esc(fmtNum(llm.prompts_named))}/${esc(fmtNum(llm.prompts_total || 15))} ${unit}. Domain mentions ${esc(fmtNum(llm.mentions))}. AI summary likelihood ${esc(fmtNum(metrics.ai_summary_score))}. AI-assistant visits (28 days) ${esc(ai)}.`;
}

function renderAiFront(metrics) {
  const surf = metrics.surfaces || {};
  const dialLine = dialLineOf(surf);
  const demandLine = demandLineOf(surf);
  const measureNote = surf.measure_note
    || 'LOCKED money-page set. Surface bars = won÷served on money-class SERPs. Rank demand = commercial-pool volume share (national ≥50 · local/regional ≥10).';
  return `<tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">The AI front</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${esc(aiFrontSubtitle(surf))}</div></td></tr>
  <tr><td style="padding:8px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${surfaceBar('Map pack', surf.map_pack?.pct, true)}
      ${surfaceBar('Organic top-10', surf.organic_top10?.pct, true)}
      ${surfaceBar('Google AI Overview', surf.ai_overview?.pct, false)}
      ${surfaceBar('People Also Ask', surf.paa?.pct, false)}
    </table>
    ${dialLine ? `<div style="color:#344054;font-size:11.5px;padding:8px 0 2px;${FF}">${esc(dialLine)}</div>` : ''}
    ${demandLine ? `<div style="color:#344054;font-size:11.5px;padding:2px 0;${FF}">${esc(demandLine)}</div>` : ''}
    <div style="color:#667085;font-size:11.5px;padding:6px 0 2px;${FF}">${aiNamedLine(metrics)}</div>
    <div style="color:#98a2b3;font-size:11px;padding:2px 0 0;${FF}">${esc(measureNote)}</div>
  </td></tr>`;
}

function monthShortOf(metrics) {
  const m = Number(metrics.sales_tab?.month || metrics.section_g?.periods?.cur?.month || 1);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
}

/** Monday brief redesign (batch 8 task 15): front page → 1 Operations → 2 Revenue & GP → 3 Strategy → 4 SEO & AI → 5 System health. */
export function renderCeoWeeklyHtml(metrics) {
  const f = metrics.front || {};
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef1f5;${FF}">
<div style="background:#eef1f5;padding:24px 0;${FF}">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
${renderHeader(metrics)}
${renderHeadlinesHtml(f.tiles)}
${renderCardHtml(f.card_a)}
${renderCardHtml(f.card_b)}
${renderCardHtml(f.card_c)}
${renderCardHtml(buildRemindersCard(metrics.ops_reminders))}
${renderActionsFootnoteHtml()}
${renderSectionHeadingHtml('1 · Operations', "What's coming up and who's booked")}
${renderSnapshotWarningHtml(metrics.strategy)}
${renderPipelineHtml(metrics.pipeline)}
${renderSectionHeadingHtml('2 · Revenue & GP', 'Sales by the month they were booked')}
${renderSalesTabHtml(metrics.sales_tab, monthShortOf(metrics))}
${renderMoneySignals(metrics)}
${renderAcademySection(metrics)}
${renderSectionHeadingHtml('3 · Strategy', '3–12 month view')}
${renderStrategyTilesHtml(metrics.strategy)}
${renderFillRunRateHtml(metrics.strategy)}
${renderSectionGHtml(metrics.section_g)}
${renderSectionHeadingHtml('4 · SEO & AI visibility', 'Website, rankings, AI answers, backlinks, site health')}
${renderWebsiteBlock(metrics)}
${renderRankingsBlock(metrics)}
${renderAiFront(metrics)}
${renderBacklinksBlock(metrics)}
${renderSeoHealthBlock(metrics)}
${renderSectionHeadingHtml('5 · System health', "Can you trust this week's figures?")}
${renderSystemHealthHtml(metrics.system_health)}
  <tr><td style="background:#f7f9fc;padding:12px 28px;color:${GREY};font-size:11px;text-align:center;${FF}">Full detail in the dashboard · week-over-week deltas vs prior 28d / prior month where shown</td></tr>

</table>
</div>
</body></html>`;
}

function academySmtpConfig() {
  const user =
    process.env.ORPHANED_EMAIL_FROM ||
    process.env.EMAIL_FROM ||
    process.env.EMAIL_SMTP_USER ||
    process.env.GMAIL_USER ||
    '';
  const pass =
    process.env.ORPHANED_EMAIL_PASSWORD ||
    process.env.EMAIL_PASSWORD ||
    process.env.EMAIL_SMTP_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    '';
  const host = process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com';
  const port = Number.parseInt(process.env.EMAIL_SMTP_PORT || '587', 10);
  return { user, pass, host, port, secure: port === 465 };
}

function pdfAttachment(pdfBuffer, filename) {
  if (!pdfBuffer || !pdfBuffer.length) return [];
  const name = filename || 'CEO-weekly-health.pdf';
  return [{ filename: name, content: pdfBuffer, contentType: 'application/pdf' }];
}

export async function sendCeoWeeklyEmail({
  subject,
  html,
  to = CEO_REPORT_TO,
  dryRun = false,
  pdfBuffer = null,
  pdfFilename = null
}) {
  const attach = pdfAttachment(pdfBuffer, pdfFilename);
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      to,
      subject,
      bytes: html?.length || 0,
      pdf_bytes: pdfBuffer?.length || 0,
      pdf_attached: attach.length > 0
    };
  }
  const cfg = academySmtpConfig();
  if (cfg.user && cfg.pass) {
    const nodemailer = await import('nodemailer');
    const createTransport = nodemailer.createTransport || nodemailer.default?.createTransport;
    const transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass }
    });
    const info = await transporter.sendMail({
      from: process.env.CEO_WEEKLY_FROM || `"Alan Ranger Photography" <${cfg.user}>`,
      to,
      subject,
      html,
      attachments: attach
    });
    return {
      ok: true,
      provider: 'smtp',
      id: info.messageId,
      to,
      subject,
      pdf_attached: attach.length > 0,
      pdf_bytes: pdfBuffer?.length || 0
    };
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.CEO_WEEKLY_FROM || process.env.RESEND_FROM || 'AI GEO Audit <onboarding@resend.dev>';
    const payload = { from, to: [to], subject, html };
    if (attach.length) {
      payload.attachments = attach.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64')
      }));
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `resend_${res.status}`);
    return {
      ok: true,
      provider: 'resend',
      id: body.id,
      to,
      subject,
      pdf_attached: attach.length > 0,
      pdf_bytes: pdfBuffer?.length || 0
    };
  }
  throw new Error('no_email_provider: set ORPHANED_EMAIL_FROM/PASSWORD (same as Academy) on this Vercel project');
}
