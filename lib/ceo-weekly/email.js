/**
 * HTML email renderer + send (Resend HTTP or SMTP via nodemailer if available).
 */
import { CEO_REPORT_TO, fmtGbp, fmtNum } from './shared.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function row(label, value, wow) {
  const w = wow?.label && wow.label !== 'n/a' ? ` <span style="color:#64748b">${esc(wow.label)}</span>` : '';
  return `<tr><td style="padding:6px 8px;border-bottom:1px solid #e2e8f0">${esc(label)}</td>`
    + `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">${esc(value)}${w}</td></tr>`;
}

export function renderFailSafeEmail(reason, weekStart) {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <h1 style="color:#b91c1c">CEO weekly — refresh failed — no report this week</h1>
  <p>Week starting <strong>${esc(weekStart)}</strong>.</p>
  <p>The Monday 01:00 dashboard refresh did not complete cleanly, so this email deliberately contains <strong>no business numbers</strong>.</p>
  <p><strong>Reason:</strong> ${esc(reason)}</p>
  <p style="color:#64748b;font-size:12px">AI GEO Audit · fail-safe gate</p>
  </body></html>`;
}

export function renderCeoWeeklyHtml(metrics) {
  const rt = metrics.revenue_truth || {};
  const lines = metrics.revenue_by_line?.lines || [];
  const fun = metrics.funnel || {};
  const rk = metrics.rankings || {};
  const bl = metrics.backlinks || {};
  const opt = metrics.optimisation || {};
  const nar = metrics.narrative || { good_points: [], bad_points: [] };

  const lineRows = lines.map((l) => row(l.category_label, fmtGbp(l.amount), l.wow)).join('');
  const actions = (opt.top_actions || []).map((a, i) =>
    `<li><strong>${i + 1}. ${esc(a.title)}</strong> — ${esc(a.estimated_lift || 'lift n/a')} (${esc(a.status)})</li>`
  ).join('');

  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;margin:0 auto">
  <h1 style="margin-bottom:4px">CEO weekly health · week of ${esc(metrics.week_start)}</h1>
  <p style="color:#64748b;margin-top:0">Deltas vs prior Monday snapshot${metrics.has_prior_snapshot ? '' : ' (first week — WoW shows n/a until next Monday)'}.</p>

  <h2>1. Revenue Truth</h2>
  <table style="width:100%;border-collapse:collapse">${row('MTD sales (non-JLR)', fmtGbp(rt.mtd), rt.wow)}
  ${row('Survival line', fmtGbp(rt.survival))}
  ${row('Gap vs survival', fmtGbp(rt.gap_vs_survival))}
  ${row('DEFCON', `${rt.defcon_level ?? '—'} ${rt.defcon_status || ''}`)}
  ${row('Projected month-end', fmtGbp(rt.projected_month_end))}
  </table>

  <h2>2. Revenue by line</h2>
  <table style="width:100%;border-collapse:collapse">${lineRows}
  ${row('Total', fmtGbp(metrics.revenue_by_line?.total), metrics.revenue_by_line?.wow)}
  </table>

  <h2>3. Traffic &amp; conversion funnel (28d)</h2>
  <table style="width:100%;border-collapse:collapse">
  ${row('Sessions (excl. Unassigned)', fmtNum(fun.sessions_28d), fun.wow?.sessions)}
  ${row('Page views', fmtNum(fun.page_views_28d), fun.wow?.page_views)}
  ${row('All enquiries', fmtNum(fun.enquiries_28d), fun.wow?.enquiries)}
  ${row('Money-page enquiries', fmtNum(fun.money_page_enquiries_28d), fun.wow?.money_enquiries)}
  ${row('Money conversion %', fun.money_conversion_pct == null ? '—' : `${fun.money_conversion_pct.toFixed(2)}%`)}
  </table>

  <h2>4. Rankings</h2>
  <table style="width:100%;border-collapse:collapse">
  ${row('#1', fmtNum(rk.buckets?.b1))}
  ${row('#2–3', fmtNum(rk.buckets?.b2_3))}
  ${row('#4–10', fmtNum(rk.buckets?.b4_10))}
  ${row('#11–20', fmtNum(rk.buckets?.b11_20))}
  ${row('#21+', fmtNum(rk.buckets?.b21))}
  ${row('Page 1 total', fmtNum(rk.page1), rk.wow?.page1)}
  ${row('Tracked keywords', fmtNum(rk.tracked))}
  ${row('Site clicks (latest audit)', fmtNum(rk.site_clicks), rk.wow?.site_clicks)}
  ${row('Movers up/down', rk.movers?.status === 'from_next_monday' ? 'from next Monday' : '—')}
  </table>

  <h2>5. Backlinks &amp; authority</h2>
  <table style="width:100%;border-collapse:collapse">
  ${row('DFS domain rank', fmtNum(bl.rank))}
  ${row('Referring domains', fmtNum(bl.referring_domains), bl.wow?.referring_domains)}
  ${row('Backlinks', fmtNum(bl.backlinks), bl.wow?.backlinks)}
  ${row('Spam score', fmtNum(bl.spam_score))}
  ${row('New/lost referring domains', bl.new_lost_domains?.status === 'from_next_monday' ? 'from next Monday' : (bl.new_lost_domains?.note || '—'))}
  </table>

  <h2>6. Optimisation pipeline</h2>
  <p>Tasks by status: ${esc(JSON.stringify(opt.tasks_by_status || {}))}</p>
  <p>Shipped this week: <strong>${esc(fmtNum(opt.shipped_this_week))}</strong></p>
  <h3>Top 5 actions</h3>
  <ol>${actions || '<li>No open revenue_funnel_priorities</li>'}</ol>

  <h2>Good points</h2>
  <ul>${(nar.good_points || []).map((g) => `<li>${esc(g)}</li>`).join('') || '<li>—</li>'}</ul>
  <h2>Bad points</h2>
  <ul>${(nar.bad_points || []).map((g) => `<li>${esc(g)}</li>`).join('') || '<li>—</li>'}</ul>

  <p style="color:#64748b;font-size:12px;margin-top:24px">AI GEO Audit · CEO weekly · read-only on dashboard tables</p>
  </body></html>`;
}

export async function sendCeoWeeklyEmail({ subject, html, to = CEO_REPORT_TO, dryRun = false }) {
  if (dryRun) {
    return { ok: true, dryRun: true, to, subject, bytes: html?.length || 0 };
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

  const user = process.env.EMAIL_SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.EMAIL_SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  if (user && pass) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.EMAIL_SMTP_PORT || 465),
      secure: true,
      auth: { user, pass }
    });
    const info = await transporter.sendMail({
      from: process.env.CEO_WEEKLY_FROM || user,
      to,
      subject,
      html
    });
    return { ok: true, provider: 'smtp', id: info.messageId, to, subject };
  }

  throw new Error('no_email_provider: set RESEND_API_KEY or EMAIL_SMTP_USER/PASS');
}
