/**
 * HTML email renderer + send (mock layout FIX 2026-09-04).
 * Preferred: Academy Gmail SMTP (ORPHANED_EMAIL_FROM / ORPHANED_EMAIL_PASSWORD).
 * Fallback: RESEND_API_KEY.
 *
 * Outlook-safe: Arial on every cell (clients ignore parent font-family).
 */
import { CEO_REPORT_TO, fmtGbp, fmtNum } from './shared.js';

const FF = "font-family:Arial,Helvetica,sans-serif";

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Semantic delta: lowerIsBetter for ranks/spam etc. */
function deltaCell(wow, { lowerIsBetter = false, firstWeek = false } = {}) {
  if (firstWeek || !wow || wow.label === 'n/a' || wow.delta == null) {
    return {
      html: `<span style="${FF};color:#334155;font-size:16px">→ n/a</span>`,
      color: '#334155'
    };
  }
  const d = Number(wow.delta);
  const improved = lowerIsBetter ? d < 0 : d > 0;
  const declined = lowerIsBetter ? d > 0 : d < 0;
  let color = '#92400e';
  let arrow = '→';
  if (improved) {
    color = '#166534';
    arrow = '↗';
  } else if (declined) {
    color = '#991b1b';
    arrow = '↘';
  }
  const absLabel = wow.label?.replace(/^[↑↓→]\s*/, '') || fmtNum(Math.abs(d));
  return {
    html: `<span style="${FF};color:${color};font-weight:700;font-size:16px">${arrow} ${esc(absLabel)}</span>`,
    color
  };
}

function metricRow(label, value, wow, opts = {}) {
  const d = deltaCell(wow, opts);
  return `<tr>
    <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px;color:#0f172a">${esc(label)}</td>
    <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px;text-align:right;font-weight:700;color:#0f172a;white-space:nowrap">${esc(value)}</td>
    <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:16px;text-align:right;white-space:nowrap">${d.html}</td>
  </tr>`;
}

function sectionTable(rowsHtml) {
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;margin:0 0 20px;${FF}">
    <thead><tr>
      <th align="left" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;letter-spacing:.3px;color:#1e293b">Metric</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;letter-spacing:.3px;color:#1e293b">Now</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;letter-spacing:.3px;color:#1e293b">Δ</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function h2(text) {
  return `<h2 style="${FF};margin:24px 0 10px;font-size:20px;color:#0f172a;border-left:4px solid #0f172a;padding-left:12px">${esc(text)}</h2>`;
}

function caption(text) {
  return `<p style="${FF};margin:0 0 10px;font-size:16px;color:#1e293b;line-height:1.45">${esc(text)}</p>`;
}

function rankingsGrid(buckets, firstWeek, wow) {
  const cells = [
    ['#1', buckets?.b1, wow?.b1],
    ['#2–3', buckets?.b2_3, null],
    ['#4–10', buckets?.b4_10, null],
    ['#11–20', buckets?.b11_20, null],
    ['#21+', buckets?.b21, null]
  ];
  const tds = cells.map(([lab, val, w]) => {
    let sub = '';
    if (!firstWeek && w) {
      const d = deltaCell(w, { firstWeek: false });
      sub = `<div style="${FF};font-size:16px;margin-top:6px;color:#1e293b">${d.html}</div>`;
    }
    return `<td width="20%" align="center" style="${FF};padding:14px 4px;border:1px solid #cbd5e1;background:#f8fafc">
      <div style="${FF};font-size:16px;color:#1e293b;font-weight:700">${esc(lab)}</div>
      <div style="${FF};font-size:26px;font-weight:800;color:#0f172a;line-height:1.2;margin-top:6px">${esc(fmtNum(val))}</div>
      ${sub}
    </td>`;
  }).join('');
  const note = firstWeek
    ? caption('Bucket Δ vs last Monday: n/a until next Monday.')
    : '';
  return `${note}<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 14px;${FF}"><tr>${tds}</tr></table>`;
}

function daBandTable(bands, firstWeek) {
  const rows = (bands || []).map((b) => {
    const d = deltaCell(b.wow_dofollow, { firstWeek });
    return `<tr>
      <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px;color:#0f172a">${esc(b.label)}</td>
      <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px;text-align:right;font-weight:800;color:#0f172a">${esc(fmtNum(b.dofollow))}</td>
      <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px;text-align:right;color:#0f172a">${esc(fmtNum(b.nofollow))}</td>
      <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:16px;text-align:right">${d.html}</td>
    </tr>`;
  }).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;margin:0 0 14px;${FF}">
    <thead><tr>
      <th align="left" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">DA band</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">Dofollow</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">Nofollow</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">Δ df</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${caption('Strategic read: dofollow concentrated in 50–79 = healthy; weak bands are mostly nofollow.')}`;
}

export function renderFailSafeEmail(reason, weekStart) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;${FF}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
  <table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;${FF};color:#0f172a">
  <tr><td style="padding:24px;${FF};font-size:17px">
  <h1 style="${FF};color:#b91c1c;margin:0 0 12px;font-size:22px">CEO weekly — refresh failed — no report this week</h1>
  <p style="${FF};margin:0 0 8px;font-size:17px">Week starting <strong>${esc(weekStart)}</strong>.</p>
  <p style="${FF};margin:0 0 8px;font-size:17px">The Monday 01:00 dashboard refresh did not complete cleanly, so this email deliberately contains <strong>no business numbers</strong>.</p>
  <p style="${FF};margin:0;font-size:17px"><strong>Reason:</strong> ${esc(reason)}</p>
  <p style="${FF};color:#334155;font-size:15px;margin:16px 0 0">AI GEO Audit · fail-safe gate</p>
  </td></tr></table>
  </td></tr></table></body></html>`;
}

export function renderCeoWeeklyHtml(metrics) {
  const firstWeek = !metrics.has_prior_snapshot;
  const fw = { firstWeek };
  const rt = metrics.revenue_truth || {};
  const cm = rt.completed_month || {};
  const roll = rt.rolling_4wk || {};
  const lines = metrics.revenue_by_line?.lines || [];
  const fun = metrics.funnel || {};
  const rk = metrics.rankings || {};
  const bl = metrics.backlinks || {};
  const opt = metrics.optimisation || {};
  const nar = metrics.narrative || { good_points: [], bad_points: [] };

  const bannerBg = rt.under_survival ? '#fef2f2' : '#f0fdf4';
  const bannerBorder = rt.under_survival ? '#b91c1c' : '#15803d';
  const bannerTitle = rt.under_survival ? 'UNDER SURVIVAL' : 'AT / ABOVE SURVIVAL';

  const lineRows = lines.map((l) =>
    metricRow(l.category_label, fmtGbp(l.amount), l.wow, fw)
  ).join('');

  const statusRows = Object.entries(opt.tasks_by_status || {})
    .map(([k, v]) => metricRow(`Tasks · ${k}`, fmtNum(v), null, fw))
    .join('');

  const actions = (opt.top_actions || []).map((a, i) => {
    const profit = a.profit_gbp_mo != null ? fmtGbp(a.profit_gbp_mo) + '/mo profit' : (a.estimated_lift || 'lift n/a');
    return `<tr><td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;font-size:17px"><strong>${i + 1}. ${esc(a.title)}</strong>
      <div style="${FF};color:#1e293b;font-size:16px;margin-top:4px">${esc(profit)} · ${esc(a.status || '')}</div></td>
      <td style="${FF};padding:11px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:17px;white-space:nowrap">${a.profit_gbp_mo != null ? esc(fmtGbp(a.profit_gbp_mo)) : '—'}</td></tr>`;
  }).join('');

  const goodLis = (nar.good_points || []).map((g) => `<li style="${FF};margin:0 0 8px;font-size:16px">${esc(g)}</li>`).join('') || '<li>—</li>';
  const badLis = (nar.bad_points || []).map((g) => `<li style="${FF};margin:0 0 8px;font-size:16px">${esc(g)}</li>`).join('') || '<li>—</li>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;${FF};font-size:17px">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:20px 10px">
<table width="680" cellpadding="0" cellspacing="0" style="background:#ffffff;${FF};color:#0f172a;border-radius:8px;overflow:hidden">
<tr><td style="padding:24px 24px 10px;${FF};font-size:17px">
  <div style="${FF};font-size:15px;letter-spacing:.3px;text-transform:uppercase;color:#1e293b;font-weight:700;margin-bottom:6px">AI GEO Audit · Monday CEO brief</div>
  <h1 style="${FF};margin:0 0 8px;font-size:26px;line-height:1.25;font-weight:800">CEO weekly health · week of ${esc(metrics.week_start)}</h1>
  <p style="${FF};margin:0 0 16px;color:#1e293b;font-size:16px">Deltas vs prior equivalent period${firstWeek ? ' (first week — Δ shows n/a until next Monday)' : ''}.</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 10px;border:2px solid ${bannerBorder};background:${bannerBg}">
    <tr><td style="padding:16px 18px;${FF}">
      <div style="${FF};font-size:16px;font-weight:700;letter-spacing:.3px;color:${bannerBorder}">1. REVENUE TRUTH · ${esc(bannerTitle)}</div>
      <div style="${FF};font-size:34px;font-weight:800;margin:8px 0 4px;color:#0f172a">${esc(cm.label || '—')} ${esc(fmtGbp(cm.amount))}</div>
      <div style="${FF};font-size:17px;color:#0f172a;line-height:1.4">Gap vs survival ${esc(fmtGbp(rt.survival))}: <strong style="color:${rt.under_survival ? '#991b1b' : '#166534'}">${esc(fmtGbp(rt.gap_vs_survival))}</strong>
        · DEFCON <strong>${esc(String(rt.defcon_level ?? '—'))}</strong> ${esc(rt.defcon_status || '')} ${esc(rt.defcon_pips || '')}
      </div>
    </td></tr>
  </table>
  ${sectionTable(
    metricRow(`${cm.label || 'Completed month'} (non-JLR)`, fmtGbp(cm.amount), cm.wow, fw)
    + metricRow('Rolling last 4 weeks', fmtGbp(roll.amount), roll.wow, fw)
    + metricRow('Transactions (completed month)', fmtNum(cm.txn_count), null, fw)
    + metricRow('Survival line', fmtGbp(rt.survival), null, fw)
    + metricRow('% of survival', rt.pct_of_survival == null ? '—' : `${Number(rt.pct_of_survival).toFixed(0)}%`, null, fw)
  )}

  ${h2('2. Revenue by line')}
  ${caption(`${metrics.revenue_by_line?.label || cm.label || ''} · MoM Δ`)}
  ${sectionTable(lineRows + metricRow('Total', fmtGbp(metrics.revenue_by_line?.total), metrics.revenue_by_line?.wow, fw))}

  ${h2('3. Traffic & conversion funnel (28d)')}
  ${sectionTable(
    metricRow('Sessions (excl. Unassigned)', fmtNum(fun.sessions_28d), fun.wow?.sessions, fw)
    + metricRow('Page views', fmtNum(fun.page_views_28d), fun.wow?.page_views, fw)
    + metricRow('All enquiries', fmtNum(fun.enquiries_28d), fun.wow?.enquiries, fw)
    + metricRow('Money-page enquiries', fmtNum(fun.money_page_enquiries_28d), fun.wow?.money_enquiries, fw)
    + metricRow('Money conversion % (leak)', fun.money_conversion_pct == null ? '—' : `${fun.money_conversion_pct.toFixed(2)}%`, fun.wow?.money_conversion, fw)
  )}

  ${h2('4. Rankings')}
  ${caption(`Tracked set · audit ${rk.audit_date || '—'} · ${fmtNum(rk.tracked)} keywords`)}
  ${rankingsGrid(rk.buckets, firstWeek, rk.wow)}
  ${sectionTable(
    metricRow('Page 1 total', fmtNum(rk.page1), rk.wow?.page1, fw)
    + metricRow('Tracked keywords', fmtNum(rk.tracked), rk.wow?.tracked, fw)
    + metricRow('Avg position (tracked)', rk.avg_position == null ? '—' : rk.avg_position.toFixed(1), rk.wow?.avg_position, { ...fw, lowerIsBetter: true })
    + metricRow('Money-page avg position', rk.money_avg_position == null ? '—' : rk.money_avg_position.toFixed(1), rk.wow?.money_avg_position, { ...fw, lowerIsBetter: true })
    + metricRow('Site clicks (latest audit)', fmtNum(rk.site_clicks), rk.wow?.site_clicks, fw)
    + metricRow('Movers up/down', rk.movers?.status === 'from_next_monday' ? 'from next Monday' : '—', null, fw)
  )}

  ${h2('5. Backlinks & authority')}
  ${sectionTable(
    metricRow('DFS domain rank', fmtNum(bl.rank), bl.wow?.rank, { ...fw, lowerIsBetter: true })
    + metricRow('Referring domains', fmtNum(bl.referring_domains), bl.wow?.referring_domains, fw)
    + metricRow('Backlinks (indexed)', fmtNum(bl.backlinks), bl.wow?.backlinks, fw)
    + metricRow('Dofollow', fmtNum(bl.dofollow), bl.wow?.dofollow, fw)
    + metricRow('Nofollow', fmtNum(bl.nofollow), bl.wow?.nofollow, fw)
    + (bl.unknown_follow ? metricRow('Unknown follow', fmtNum(bl.unknown_follow), null, fw) : '')
    + metricRow('Spam score', fmtNum(bl.spam_score), null, { ...fw, lowerIsBetter: true })
    + metricRow('New/lost referring domains', bl.new_lost_domains?.status === 'from_next_monday' ? 'from next Monday' : (bl.new_lost_domains?.note || '—'), null, fw)
  )}
  ${caption(`Backlinks ${fmtNum(bl.backlinks)} = dofollow ${fmtNum(bl.dofollow)} + nofollow ${fmtNum(bl.nofollow)}${bl.unknown_follow ? ` + unknown ${fmtNum(bl.unknown_follow)}` : ''} (same index as DA-band table).`)}
  ${caption('Dofollow by referring-domain rank band (same scan as Backlinks dashboard tile)')}
  ${daBandTable(bl.da_bands, firstWeek)}

  ${h2('6. Optimisation pipeline')}
  ${sectionTable(
    statusRows
    + metricRow('Shipped this week', fmtNum(opt.shipped_this_week), opt.wow?.shipped, fw)
    + metricRow('£/mo profit at stake (Top 5)', fmtGbp(opt.open_profit_gbp_mo), opt.wow?.open_profit, fw)
    + metricRow('AI summary likelihood', opt.ai_summary_likelihood == null ? '—' : String(opt.ai_summary_likelihood), opt.wow?.ai_likelihood, fw)
    + metricRow('Named in AI answers', fmtNum(opt.named_in_ai_answers), opt.wow?.named_answers, fw)
  )}

  <table width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 14px"><tr>
    <td width="50%" valign="top" style="padding-right:8px">
      <div style="background:#f0fdf4;border:1px solid #86efac;padding:14px;border-radius:6px">
        <div style="${FF};font-size:17px;font-weight:700;color:#166534;margin-bottom:8px">GOOD POINTS</div>
        <ul style="${FF};margin:0;padding-left:20px;font-size:16px;color:#14532d;line-height:1.45">${goodLis}</ul>
      </div>
    </td>
    <td width="50%" valign="top" style="padding-left:8px">
      <div style="background:#fef2f2;border:1px solid #fca5a5;padding:14px;border-radius:6px">
        <div style="${FF};font-size:17px;font-weight:700;color:#991b1b;margin-bottom:8px">BAD POINTS</div>
        <ul style="${FF};margin:0;padding-left:20px;font-size:16px;color:#7f1d1d;line-height:1.45">${badLis}</ul>
      </div>
    </td>
  </tr></table>

  <h2 style="${FF};margin:20px 0 10px;font-size:20px;color:#0f172a;border-left:4px solid #1d4ed8;padding-left:12px">Top 5 actions</h2>
  ${caption('From revenue_funnel_priorities · £/mo profit parsed from lift text')}
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 18px;${FF}">
    <thead><tr>
      <th align="left" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">Action</th>
      <th align="right" style="${FF};padding:10px 12px;border-bottom:2px solid #64748b;font-size:15px;text-transform:uppercase;color:#1e293b">£/mo</th>
    </tr></thead>
    <tbody>${actions || `<tr><td style="${FF};padding:11px 12px;font-size:17px" colspan="2">No open priorities</td></tr>`}</tbody>
  </table>

  <p style="${FF};color:#334155;font-size:15px;margin:10px 0 0">AI GEO Audit · CEO weekly · read-only on dashboard tables · cron/fail-safe unchanged</p>
</td></tr></table>
</td></tr></table>
</body></html>`;
}

/** Same Gmail SMTP env names as Academy lifecycle mail (sendLifecycleMail.js). */
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
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.message || `resend_${res.status}`);
    return { ok: true, provider: 'resend', id: body.id, to, subject };
  }

  throw new Error('no_email_provider: set ORPHANED_EMAIL_FROM/PASSWORD (same as Academy) on this Vercel project');
}
