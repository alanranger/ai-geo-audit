// ONE test send of the new Monday brief (batch 8 task 16b). Alan only, subject "TEST — new layout — …".
// Read-only on every table: never writes ceo_weekly_report_snapshots, never marks a week sent, never
// triggers a refresh/audit/DataForSEO call. The sense-check gate must pass or nothing is sent.
//   node scripts/ceo-brief-test-send.mjs --week 2026-11-02 [--send]   (without --send: dry, prints the plan)
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(file, keys = null) {
  if (!fs.existsSync(file)) return;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
    if (keys && !keys.includes(m[1])) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
  }
}
loadEnv(new URL('../.env.local', import.meta.url));
// Same SMTP account as production ("same as Academy"); Vercel's pulled env file holds empty placeholders.
loadEnv('G:/Dropbox/alan ranger photography/Website Code/Academy/alanranger-academy-assesment/.env.local', ['ORPHANED_EMAIL_FROM', 'ORPHANED_EMAIL_PASSWORD']);

const { buildSectionG } = await import('../lib/ceo-weekly/sectionG.js');
const { attachRedesign } = await import('../lib/ceo-weekly/redesign-data.js');
const { renderCeoWeeklyHtml, sendCeoWeeklyEmail } = await import('../lib/ceo-weekly/email.js');
const { renderCeoWeeklyPdf, ceoWeeklyPdfFilename } = await import('../lib/ceo-weekly/html-to-pdf.js');
const { CEO_REPORT_TO } = await import('../lib/ceo-weekly/shared.js');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const week = arg('week', '2026-11-02');
const send = process.argv.includes('--send');
const property = 'https://www.alanranger.com';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function state() {
  const one = async (q) => (await q).data;
  const snaps = await sb.from('ceo_weekly_report_snapshots').select('week_start', { count: 'exact', head: true });
  const runs = await sb.from('ceo_weekly_refresh_runs').select('id', { count: 'exact', head: true });
  const holds = await sb.from('ceo_brief_holds').select('id', { count: 'exact', head: true });
  const row = await one(sb.from('ceo_weekly_report_snapshots').select('week_start, send_status, sent_at, created_at, html_preview').eq('week_start', week).maybeSingle());
  const lastSent = await one(sb.from('ceo_weekly_report_snapshots').select('week_start, sent_at').eq('send_status', 'sent').order('sent_at', { ascending: false }).limit(1));
  const refresh = await one(sb.from('system_maintenance_state').select('state, updated_at').eq('key', 'ceo_monday_full_refresh').maybeSingle());
  return {
    snapshots_rows: snaps.count,
    refresh_runs_rows: runs.count,
    holds_rows: holds.count,
    week_row: row ? { send_status: row.send_status, sent_at: row.sent_at, created_at: row.created_at, html_chars: (row.html_preview || '').length } : null,
    last_sent: lastSent?.[0] || null,
    monday_refresh: refresh
  };
}

const before = await state();
const { data } = await sb.from('ceo_weekly_report_snapshots').select('metrics').eq('week_start', week).maybeSingle();
const metrics = data.metrics;
metrics.section_g = await buildSectionG(sb, { propertyUrl: property, asOf: metrics.generated_at });
await attachRedesign(sb, metrics, { propertyUrl: property, weekStart: week, asOf: metrics.generated_at });
if (!metrics.brief_gate || metrics.brief_gate.held) {
  console.log(JSON.stringify({ sent: false, reason: 'sense-check gate did not pass', failures: metrics.brief_gate?.failures || null }, null, 1));
  process.exit(2);
}
const html = renderCeoWeeklyHtml(metrics);
if (/NEW ·/.test(html)) throw new Error('NEW · badge present — refusing to send');
const asOfLabel = new Date(metrics.generated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const subject = `TEST — new layout — CEO weekly health — as of ${asOfLabel}`;
fs.mkdirSync('C:/TEMP/ceo-redesign', { recursive: true });
fs.writeFileSync('C:/TEMP/ceo-redesign/test-email-as-sent.html', html, 'utf8');
const pdfBuffer = await renderCeoWeeklyPdf(html).catch(() => null);
const result = send
  ? await sendCeoWeeklyEmail({ subject, html, to: CEO_REPORT_TO, pdfBuffer, pdfFilename: ceoWeeklyPdfFilename(week) })
  : { dry: true, to: CEO_REPORT_TO, subject, pdf_bytes: pdfBuffer?.length || 0 };
const after = await state();
console.log(JSON.stringify({
  sent_at: send ? new Date().toISOString() : null,
  gate: 'pass',
  result: { ...result, to: result.to },
  html_chars: html.length,
  unchanged: JSON.stringify(before) === JSON.stringify(after),
  before,
  after
}, null, 1));
