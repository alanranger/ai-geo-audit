/**
 * Report job: gate → build metrics → snapshot → email.
 * READ-ONLY on dashboard tables; writes only ceo_weekly_* tables.
 */
import { createClient } from '@supabase/supabase-js';
import { latestRefreshGate } from './refresh.js';
import { buildCeoWeeklyMetrics } from './metrics.js';
import { renderCeoWeeklyHtml, renderFailSafeEmail, sendCeoWeeklyEmail } from './email.js';
import {
  DEFAULT_PROPERTY, londonWeekStartYmd, CEO_REPORT_TO
} from './shared.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

export async function runCeoWeeklyReport(opts = {}) {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const weekStart = opts.weekStart || londonWeekStartYmd();
  const propertyUrl = opts.propertyUrl || DEFAULT_PROPERTY;
  const dryRun = opts.dryRun === true || String(opts.dryRun).toLowerCase() === 'true';
  const forceFailSafe = opts.forceFailSafe === true;
  const skipGate = opts.skipGate === true;

  let gate = { ok: true, reason: null, run: null };
  if (!skipGate) {
    gate = await latestRefreshGate(supabase, weekStart);
  }
  if (forceFailSafe) {
    gate = { ok: false, reason: opts.failReason || 'simulated_refresh_failure', run: gate.run };
  }

  if (!gate.ok) {
    const html = renderFailSafeEmail(gate.reason, weekStart);
    const subject = `CEO weekly — refresh failed — no report (${weekStart})`;
    const send = await sendCeoWeeklyEmail({ subject, html, to: CEO_REPORT_TO, dryRun });
    const { data: snap } = await supabase
      .from('ceo_weekly_report_snapshots')
      .upsert({
        week_start: weekStart,
        property_url: propertyUrl,
        metrics: { fail_safe: true, reason: gate.reason },
        html_preview: html,
        refresh_run_id: gate.run?.id || null,
        send_status: dryRun ? 'dry_run_fail_safe' : 'sent_fail_safe',
        sent_at: dryRun ? null : new Date().toISOString()
      }, { onConflict: 'week_start' })
      .select('*')
      .single();
    return {
      mode: 'fail_safe',
      weekStart,
      gate,
      send,
      snapshot: snap,
      numbers_included: false
    };
  }

  const metrics = await buildCeoWeeklyMetrics(supabase, { weekStart, propertyUrl });
  const html = renderCeoWeeklyHtml(metrics);
  const subject = `CEO weekly health — week of ${weekStart}`;
  const send = await sendCeoWeeklyEmail({ subject, html, to: CEO_REPORT_TO, dryRun });

  const { data: snap, error } = await supabase
    .from('ceo_weekly_report_snapshots')
    .upsert({
      week_start: weekStart,
      property_url: propertyUrl,
      metrics,
      html_preview: html,
      refresh_run_id: gate.run?.id || null,
      send_status: dryRun ? 'dry_run' : 'sent',
      sent_at: dryRun ? null : new Date().toISOString()
    }, { onConflict: 'week_start' })
    .select('id, week_start, send_status, created_at')
    .single();
  if (error) throw new Error(error.message);

  return {
    mode: 'report',
    weekStart,
    gate,
    send,
    snapshot: snap,
    numbers_included: true,
    revenue_truth: metrics.revenue_truth,
    has_prior_snapshot: metrics.has_prior_snapshot,
    html_bytes: html.length
  };
}
