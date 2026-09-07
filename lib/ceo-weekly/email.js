/**
 * Monday CEO email — markup from CEO-REPORT-EMAIL-DESIGN-MOCK-2026-09-04-LATEST (1).html
 * Anti-drift: structure/colours match the approved mock; numbers from tab metrics.
 */
import { CEO_REPORT_TO, fmtGbp, fmtNum } from './shared.js';

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

function deltaHtml(wow, { money = false } = {}) {
  if (!wow || wow.label === 'n/a' || wow.delta == null) {
    return `<span style="color:${GREY};font-weight:600">→ n/a</span>`;
  }
  const d = Number(wow.delta);
  const improved = d > 0;
  const declined = d < 0;
  const color = improved ? GREEN : declined ? RED : AMBER;
  // Prefer pre-formatted labels from moneyDeltaArrow / deltaArrow (already ▲/▼)
  let label = String(wow.label || '').trim();
  if (!/[▲▼→]/.test(label)) {
    const arrow = improved ? '▲' : declined ? '▼' : '→';
    const body = label.replace(/^[↑↓]\s*/, '').trim();
    label = money && body && !body.startsWith('£')
      ? `${arrow} £${body}`
      : `${arrow} ${body}`;
  } else if (money && !/£/.test(label) && d !== 0) {
    label = label.replace(/^([▲▼→])\s*/, `$1 £`);
  }
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
  if (!items?.length) return `<span style="color:${GREY}">from next Monday</span>`;
  return items.map((m) => {
    const d = Number(m.delta) || 0;
    const sign = d > 0 ? '+' : '−';
    return `${esc(m.title)} <b style="color:${color};">${sign}${fmtNum(Math.abs(d))}</b>`;
  }).join('<br>');
}

function renderDefSections(metrics) {
  const bl = metrics.backlinks || {};
  const rk = metrics.rankings || {};
  const sh = metrics.seo_health || {};
  const bands = bl.da_bands || [];
  const maxDf = Math.max(1, ...bands.map((b) => Number(b.dofollow) || 0));
  const bandRows = bands.map((b) => daBandBar(b, maxDf)).join('');
  const newLinks = bl.new_links || {};
  let newLinksBody;
  if (newLinks.status === 'from_next_monday' || newLinks.status === 'error') {
    newLinksBody = `<tr><td style="padding:4px 0;color:${GREY};${FF}" colspan="2">from next Monday once ≥2 weekly snapshots exist</td></tr>`;
  } else if (!newLinks.items?.length) {
    newLinksBody = `<tr><td style="padding:4px 0;color:#101828;${FF}">none this week</td><td></td></tr>`;
  } else {
    newLinksBody = newLinks.items.map((it, i) => {
      const border = i < newLinks.items.length - 1 ? 'border-bottom:1px solid #eef1f5;' : '';
      return `<tr><td style="padding:4px 0;color:#101828;${border}${FF}">${esc(it.host)}</td><td align="right" style="padding:4px 0;color:#667085;${border}${FF}">DA ${esc(fmtNum(it.da))}</td></tr>`;
    }).join('');
  }
  const buckets = rk.buckets || {};
  const hy = sh.hygiene || {};
  const scoreWow = sh.score_wow?.delta != null
    ? `${sh.score_wow.delta > 0 ? '▲' : sh.score_wow.delta < 0 ? '▼' : '→'}${Math.abs(Math.round(sh.score_wow.delta))}`
    : (sh.score_wow?.pending ? '' : '');
  const dsWow = sh.domain_strength_wow;
  let dsLabel = '';
  if (dsWow?.delta != null) {
    const d = Number(dsWow.delta);
    dsLabel = ` ${d > 0 ? '▲' : d < 0 ? '▼' : '→'}${Math.abs(d).toFixed(1)}`;
  }
  const avgPos = rk.avg_position != null ? Number(rk.avg_position).toFixed(1) : '—';
  const moneyAvg = rk.money_avg_position != null ? Number(rk.money_avg_position).toFixed(1) : '—';
  const followRight = bl.follow_pct != null
    ? `<span style="color:${GREY};font-weight:600">${esc(String(bl.follow_pct))}% follow</span>`
    : `<span style="color:${GREY};font-weight:600">—</span>`;
  const spamRight = bl.spam_score != null
    ? `<span style="color:${GREEN};font-weight:600">${esc(bl.spam_label || 'low')}</span>`
    : `<span style="color:${GREY};font-weight:600">—</span>`;

  return `
  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">D · Backlinks &amp; authority</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Profile growing, quality concentrated in strong domains.</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('Referring domains', esc(fmtNum(bl.referring_domains)), snapDeltaHtml(bl.wow?.referring_domains))}
      ${row3('Total backlinks', esc(fmtNum(bl.backlinks)), snapDeltaHtml(bl.wow?.backlinks))}
      ${row3('Dofollow / nofollow', `${esc(fmtNum(bl.dofollow))} / ${esc(fmtNum(bl.nofollow))}`, followRight)}
      ${row3('Spam score', esc(fmtNum(bl.spam_score)), spamRight)}
      ${row3Last('DFS domain rank', esc(fmtNum(bl.rank)), snapDeltaHtml(bl.wow?.rank))}
    </table>
  </td></tr>
  <tr><td style="padding:10px 28px 0;">
    <div style="color:#667085;font-size:11px;font-weight:700;margin-bottom:6px;${FF}">DOFOLLOW BY DOMAIN AUTHORITY <span style="color:${GREY};font-weight:400;">· count + Δ wk</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px;${FF}">${bandRows}</table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">Δ = change vs last Monday (from next Monday once ≥2 weekly snapshots exist). Healthy shape: dofollow concentrated in strong (50–79) domains.</div>
  </td></tr>
  <tr><td style="padding:6px 28px 0;">
    <div style="color:${GREEN};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▲ NEW DOFOLLOW LINKS THIS WEEK · DA ≥ 50</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px;${FF}">${newLinksBody}</table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">Real new dofollow links (DA ≥ 50) list from next Monday's snapshot diff. Shows "none this week" when there are none.</div>
  </td></tr>

  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">E · Ranking changes</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Tracked money-keyword set · ${esc(fmtNum(rk.tracked))} keywords.</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="text-align:center;">
      <tr>
        <td style="background:#f0faf4;border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:${GREEN};${FF}">${esc(fmtNum(buckets.b1))}</div><div style="font-size:10px;color:#667085;${FF}">#1</div></td>
        <td style="width:6px;"></td>
        <td style="background:#f0faf4;border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:${GREEN};${FF}">${esc(fmtNum(buckets.b2_3))}</div><div style="font-size:10px;color:#667085;${FF}">#2–3</div></td>
        <td style="width:6px;"></td>
        <td style="background:#f7f9fc;border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:#101828;${FF}">${esc(fmtNum(buckets.b4_10))}</div><div style="font-size:10px;color:#667085;${FF}">#4–10</div></td>
        <td style="width:6px;"></td>
        <td style="background:#fdf4e3;border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:${AMBER};${FF}">${esc(fmtNum(buckets.b11_20))}</div><div style="font-size:10px;color:#667085;${FF}">#11–20</div></td>
        <td style="width:6px;"></td>
        <td style="background:#fdf1f0;border-radius:8px;padding:8px;"><div style="font-size:18px;font-weight:800;color:${RED};${FF}">${esc(fmtNum(buckets.b21))}</div><div style="font-size:10px;color:#667085;${FF}">#21+</div></td>
      </tr>
    </table>
  </td></tr>
  <tr><td style="padding:12px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:50%;vertical-align:top;padding-right:8px;"><div style="color:${GREEN};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▲ BIGGEST CLIMBERS (clicks)</div><div style="color:#344054;font-size:11.5px;line-height:1.7;${FF}">${moverLines(rk.movers?.climbers, GREEN)}</div></td>
        <td style="width:50%;vertical-align:top;padding-left:8px;"><div style="color:${RED};font-size:11px;font-weight:700;margin-bottom:5px;${FF}">▼ BIGGEST DROPPERS (clicks)</div><div style="color:#344054;font-size:11.5px;line-height:1.7;${FF}">${moverLines(rk.movers?.droppers, RED)}</div></td>
      </tr>
    </table>
    <div style="color:${GREY};font-size:11px;padding:8px 0 0;${FF}">Avg position (tracked) ${esc(avgPos)} · money-page avg ${esc(moneyAvg)} · window ~28d.</div>
  </td></tr>

  <tr><td style="padding:18px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">F · SEO health</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Hygiene strong and improving; one indexation fail to clear.</div></td></tr>
  <tr><td style="padding:8px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width:33%;background:#f0faf4;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:${GREEN};${FF}">${esc(fmtNum(sh.score))}</div><div style="font-size:10px;color:#667085;${FF}">health /100 ${esc(scoreWow)}</div></td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f7f9fc;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:#101828;${FF}">${sh.domain_strength != null ? esc(Number(sh.domain_strength).toFixed(1)) : '—'}</div><div style="font-size:10px;color:#667085;${FF}">domain strength${esc(dsLabel)}</div></td>
        <td style="width:8px;"></td>
        <td style="width:33%;background:#f7f9fc;border-radius:8px;padding:10px;text-align:center;vertical-align:top;"><div style="font-size:22px;font-weight:800;color:#101828;${FF}">${esc(fmtNum(sh.ranking_keywords))}</div><div style="font-size:10px;color:#667085;${FF}">ranking keywords</div></td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-top:10px;${FF}">
      <tr><td style="padding:7px 0;color:#475467;border-bottom:1px solid #eef1f5;">Hygiene rules (${esc(fmtNum(hy.enabled))})</td><td align="right" style="padding:7px 0;font-weight:700;border-bottom:1px solid #eef1f5;">${esc(fmtNum(hy.pass))} pass · ${esc(fmtNum(hy.warn))} warn · ${esc(fmtNum(hy.fail))} fail</td></tr>
      <tr><td style="padding:7px 0;color:#475467;">Open fail</td><td align="right" style="padding:7px 0;font-weight:700;color:${RED};">${esc(sh.open_fail || '—')}</td></tr>
    </table>
    <div style="color:${GREY};font-size:11px;padding:6px 0;${FF}">${esc(sh.caveat || 'Deep extractability rules refresh on the server run once mirrored — headline score is live.')}</div>
  </td></tr>`;
}

function londonWeekEndLabel(weekStart) {
  // weekStart is Monday YMD; show "week to" Sunday
  try {
    const t = Date.parse(`${weekStart}T12:00:00Z`) + 6 * 86400000;
    return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return weekStart;
  }
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

export function renderCeoWeeklyHtml(metrics) {
  const rt = metrics.revenue_truth || {};
  const cm = rt.completed_month || {};
  const lines = metrics.revenue_by_line?.lines || [];
  const biggestDrop = metrics.revenue_by_line?.biggest_drop
    || lines.filter((l) => l.wow?.delta != null).sort((a, b) => (a.wow.delta || 0) - (b.wow.delta || 0))[0];
  const biggestRise = metrics.revenue_by_line?.biggest_rise
    || lines.filter((l) => (l.wow?.delta || 0) > 0).sort((a, b) => (b.wow.delta || 0) - (a.wow.delta || 0))[0];
  const one21 = lines.find((l) => /1-2-1/i.test(l.category_label));
  const moneyLine2 = biggestDrop?.wow?.delta < 0 ? biggestDrop : one21;
  const moneyLine3 = (biggestRise && biggestRise.category_label !== moneyLine2?.category_label)
    ? biggestRise
    : (one21 && one21.category_label !== moneyLine2?.category_label
      ? one21
      : lines.find((l) => /courses/i.test(l.category_label)));
  const acq = metrics.acquisition || {};
  const rk = metrics.rankings || {};
  const surf = metrics.surfaces || {};
  const mp = metrics.money_pages || {};
  const auth = metrics.authority || {};
  const chips = metrics.chips || {};
  const llm = metrics.llm || {};
  const fun = metrics.funnel || {};
  const nar = metrics.narrative || {};
  const cards = nar.domain_cards || {};
  const actions = (metrics.optimisation?.top_actions || []).slice(0, 3);
  const weekTo = londonWeekEndLabel(metrics.week_start);
  const under = rt.under_survival;

  const upsideLine = (mp.top_upside || [])
    .map((p) => `${esc(p.title)} +${fmtNum(p.upside)}`)
    .join(' · ') || '—';

  const winsHtml = (nar.wins || nar.good_points || []).map((w) => esc(w)).join('<br>') || '—';
  const worriesHtml = (nar.worries || nar.bad_points || []).map((w) => esc(w)).join('<br>') || '—';

  const actionRows = actions.map((a, i) => {
    const border = i < actions.length - 1 ? 'border-bottom:1px solid #eef1f5;' : '';
    const profit = a.profit_gbp_mo != null ? fmtGbp(a.profit_gbp_mo) : '—';
    return `<tr><td style="padding:5px 0;color:#101828;${border}${FF}"><b style="color:#1857c4;">${i + 1}</b>&nbsp; ${esc(a.title)}</td><td align="right" style="padding:5px 0;font-weight:700;${border}${FF}">${esc(profit)}</td></tr>`;
  }).join('') || `<tr><td style="padding:5px 0;${FF}">No open priorities</td><td></td></tr>`;

  const map = surf.map_pack || {};
  const org = surf.organic_top10 || {};
  const aio = surf.ai_overview || {};
  const paa = surf.paa || {};

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef1f5;${FF}">
<div style="background:#eef1f5;padding:24px 0;${FF}">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">

  <tr><td style="background:#0f2740;padding:22px 28px;">
    <div style="color:#8fb0d0;font-size:12px;letter-spacing:.4px;font-weight:600;${FF}">ALAN RANGER PHOTOGRAPHY · WEEKLY BUSINESS BRIEF</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:4px;${FF}">Monday brief · week to ${esc(weekTo)}</div>
    <div style="color:#6d8fb0;font-size:12px;margin-top:4px;${FF}">Refreshed 01:00 · sent 07:00 · vs last Monday</div>
  </td></tr>

  <tr><td style="padding:16px 28px 4px;"><div style="color:#1857c4;font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">EXECUTIVE SUMMARY</div></td></tr>

  <tr><td style="padding:2px 28px 12px;">
    <div style="background:#f7f9fc;border-radius:10px;padding:14px 16px;color:#101828;font-size:14px;line-height:1.55;${FF}"><b>This week:</b> ${esc(nar.week_verdict || 'see deeper analysis below.')}</div>
  </td></tr>

  <tr><td style="padding:0 28px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="padding:7px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:10px;"><tr><td style="width:8px;background:${cards.website?.bar || '#f59e0b'};border-radius:10px 0 0 10px;"></td><td style="padding:11px 14px;${FF}"><div style="font-size:13px;"><b style="color:#101828;">The website</b> &nbsp;<span style="color:${cards.website?.color || AMBER};font-weight:700;">${esc(cards.website?.word || 'MIXED')}</span></div><div style="color:#475467;font-size:12.5px;line-height:1.5;margin-top:2px;">${cards.website?.line || ''}</div></td></tr></table></td></tr>
      <tr><td style="padding:7px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:10px;"><tr><td style="width:8px;background:${cards.money?.bar || RED};border-radius:10px 0 0 10px;"></td><td style="padding:11px 14px;${FF}"><div style="font-size:13px;"><b style="color:#101828;">The money</b> &nbsp;<span style="color:${cards.money?.color || RED};font-weight:700;">${esc(cards.money?.word || 'DECLINE')}</span></div><div style="color:#475467;font-size:12.5px;line-height:1.5;margin-top:2px;">${cards.money?.line || ''}</div></td></tr></table></td></tr>
      <tr><td style="padding:7px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f5;border-radius:10px;"><tr><td style="width:8px;background:${cards.ai?.bar || RED};border-radius:10px 0 0 10px;"></td><td style="padding:11px 14px;${FF}"><div style="font-size:13px;"><b style="color:#101828;">The AI front</b> &nbsp;<span style="color:${cards.ai?.color || RED};font-weight:700;">${esc(cards.ai?.word || 'LOCKED OUT')}</span></div><div style="color:#475467;font-size:12.5px;line-height:1.5;margin-top:2px;">${cards.ai?.line || ''}</div></td></tr></table></td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;vertical-align:top;padding-right:6px;"><div style="color:${GREEN};font-size:11px;font-weight:700;margin-bottom:4px;${FF}">▲ BIGGEST WINS</div><div style="color:#344054;font-size:12px;line-height:1.7;${FF}">${winsHtml}</div></td>
      <td style="width:50%;vertical-align:top;padding-left:6px;"><div style="color:${RED};font-size:11px;font-weight:700;margin-bottom:4px;${FF}">▼ BIGGEST WORRIES</div><div style="color:#344054;font-size:12px;line-height:1.7;${FF}">${worriesHtml}</div></td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:14px 28px 4px;">
    <div style="color:#1857c4;font-size:12px;font-weight:700;margin-bottom:4px;${FF}">DO THIS WEEK <span style="color:${GREY};font-weight:400;">· £/mo profit</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">${actionRows}</table>
  </td></tr>

  <tr><td style="padding:20px 28px 8px;"><div style="border-top:2px solid #eef1f5;padding-top:12px;"><div style="color:#667085;font-size:12px;font-weight:800;letter-spacing:.5px;${FF}">DEEPER ANALYSIS</div><div style="color:${GREY};font-size:11px;${FF}">The evidence behind the summary — skip unless you want the detail.</div></div></td></tr>

  <tr><td style="padding:8px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">A · The website</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Health steady, traffic mix shifting toward organic.</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:33%;background:#fdf4e3;border-radius:8px;padding:9px;text-align:center;"><div style="font-size:19px;font-weight:800;color:#7a4405;${FF}">${esc(fmtNum(chips.surface_vis?.value))}</div><div style="font-size:10px;color:${AMBER};${FF}">surface vis ${esc(chipDelta(chips.surface_vis?.wow))}${chips.surface_vis?.stale ? ' (stale)' : ''}</div></td>
      <td style="width:8px;"></td>
      <td style="width:33%;background:#f3e8fb;border-radius:8px;padding:9px;text-align:center;"><div style="font-size:19px;font-weight:800;color:#6b21a8;${FF}">${esc(fmtNum(chips.top_of_page?.value))}</div><div style="font-size:10px;color:#7c3aed;${FF}">top of page ${esc(chipDelta(chips.top_of_page?.wow))}${chips.top_of_page?.stale ? ' (stale)' : ''}</div></td>
      <td style="width:8px;"></td>
      <td style="width:33%;background:#e7f0fb;border-radius:8px;padding:9px;text-align:center;"><div style="font-size:19px;font-weight:800;color:#1857c4;${FF}">${esc(fmtNum(chips.brand?.value))}</div><div style="font-size:10px;color:#1857c4;${FF}">brand ${esc(chipDelta(chips.brand?.wow))}</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('Attributed visits (GA4)', esc(fmtNum(acq.attributed_visits)), deltaHtml(acq.attributed_wow))}
      ${row3('Google organic', esc(fmtNum(acq.google_organic?.value)), deltaHtml(acq.google_organic?.wow))}
      ${row3('Direct', esc(fmtNum(acq.direct?.value)), deltaHtml(acq.direct?.wow))}
      ${row3('GSC clicks', esc(fmtNum(acq.gsc_clicks?.value)), deltaHtml(acq.gsc_clicks?.wow))}
      ${row3('Keywords on page 1', `${esc(fmtNum(rk.page1))} / ${esc(fmtNum(rk.tracked))}`, deltaHtml(rk.wow?.page1))}
      ${row3Last('Authority (E-E-A-T)', esc(fmtNum(auth.score)), `<span style="color:${GREY};font-weight:600">→ n/a</span>`)}
    </table>
    <div style="color:${GREY};font-size:11px;padding:5px 0;${FF}">${esc(acq.bot_footer || '')} Authority = Behaviour ${esc(fmtNum(auth.behaviour))} / Ranking ${esc(fmtNum(auth.ranking))} / Backlinks ${esc(fmtNum(auth.backlinks))} / Reviews ${esc(fmtNum(auth.reviews))}.</div>
  </td></tr>

  <tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">B · The money</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">${under ? 'Below survival and falling; concentrated in one line.' : 'Trading vs survival line.'}</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${row3('Sales vs £4,450 survival', esc(fmtGbp(cm.amount)), deltaHtml(cm.wow, { money: true }))}
      ${row3(moneyLine2?.short_label || moneyLine2?.category_label || 'Biggest drop', esc(fmtGbp(moneyLine2?.amount)), deltaHtml(moneyLine2?.wow, { money: true }))}
      ${row3(moneyLine3?.short_label || moneyLine3?.category_label || '1-2-1', esc(fmtGbp(moneyLine3?.amount)), deltaHtml(moneyLine3?.wow, { money: true }))}
      ${row3('Money-page behaviour', `${mp.behaviour_score != null ? Math.round(mp.behaviour_score) : '—'}/100`, `<span style="color:${AMBER};font-weight:600">amber</span>`)}
      ${row3Last('Money conversion (leak)', fun.money_conversion_pct == null ? '—' : `${fun.money_conversion_pct.toFixed(2)}%`, deltaHtml(fun.wow?.money_conversion))}
    </table>
    <div style="color:#667085;font-size:11.5px;padding:6px 0;${FF}">Top pages to fix (upside clicks 28d): ${upsideLine}.</div>
  </td></tr>

  <tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #0f2740;padding-left:10px;color:#0f2740;font-size:15px;font-weight:700;${FF}">C · The AI front</div><div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">You own classic surfaces, absent from answer surfaces.</div></td></tr>
  <tr><td style="padding:8px 28px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;${FF}">
      ${surfaceBar('Map pack', map.pct, true)}
      ${surfaceBar('Organic top-10', org.pct, true)}
      ${surfaceBar('Google AI Overview', aio.pct, false)}
      ${surfaceBar('People Also Ask', paa.pct, false)}
    </table>
    <div style="color:#667085;font-size:11.5px;padding:6px 0;${FF}">Named by ChatGPT ${esc(fmtNum(llm.prompts_named))}/${esc(fmtNum(llm.prompts_total || 15))} keywords. Domain mentions ${esc(fmtNum(llm.mentions))}. AI summary likelihood ${esc(fmtNum(metrics.ai_summary_score))}. AI-assistant visits ${esc(acq.ai_assistant?.wow?.label || '')}.</div>
  </td></tr>

  ${renderDefSections(metrics)}

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

export async function sendCeoWeeklyEmail({ subject, html, to = CEO_REPORT_TO, dryRun = false }) {
  if (dryRun) {
    return { ok: true, dryRun: true, to, subject, bytes: html?.length || 0 };
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
      html
    });
    return { ok: true, provider: 'smtp', id: info.messageId, to, subject };
  }
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.CEO_WEEKLY_FROM || process.env.RESEND_FROM || 'AI GEO Audit <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `resend_${res.status}`);
    return { ok: true, provider: 'resend', id: body.id, to, subject };
  }
  throw new Error('no_email_provider: set ORPHANED_EMAIL_FROM/PASSWORD (same as Academy) on this Vercel project');
}
