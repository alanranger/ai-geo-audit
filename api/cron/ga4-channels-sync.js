/**
 * Nightly GA4 per-channel session pull for the Acquisition tab "Visits" column.
 *
 * GA4 serves history, so this re-pulls a rolling window rather than only
 * today — late-arriving and reprocessed sessions get corrected, and the first
 * run backfills.
 *
 * GET  with x-vercel-cron / ?secret=  — scheduled run
 * POST                                — dashboard audit button / full refresh
 * ?dryRun=true                        — fetch and report without writing
 * ?days=90                            — window / backfill depth
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { collectGa4Channels } from '../../lib/acquisition/ga4-channels.js';
import { detectTriggerSource, isRequestAuthorized, startRun, finishRun } from '../../lib/acquisition/sync-runs.js';

const JOB = 'ga4_channels';
const DEFAULT_DAYS = 90;
const MAX_DAYS = 400;

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function requestedDays(req) {
  const raw = Number(req.query?.days);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DAYS;
  return Math.min(Math.round(raw), MAX_DAYS);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!isRequestAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

  const dryRun = ['true', '1', 'yes'].includes(String(req.query?.dryRun || '').toLowerCase());
  const days = requestedDays(req);
  const triggerSource = detectTriggerSource(req);
  const runId = dryRun ? null : await startRun(JOB, triggerSource);

  try {
    const result = await collectGa4Channels({ persist: !dryRun, days });
    await finishRun(runId, {
      status: result.configured ? 'ok' : 'skipped',
      rows_written: result.rows_written,
      error_message: result.configured ? null : `awaiting_setup: ${result.missing.join(', ')}`,
      meta: {
        days: result.days || days,
        attributed_sessions: result.attributed_sessions ?? null,
        unattributed_sessions: result.unattributed_sessions ?? null,
      },
    });
    return send(res, 200, { ok: true, job: JOB, dry_run: dryRun, ...result });
  } catch (err) {
    const message = err?.message || String(err);
    await finishRun(runId, { status: 'error', error_message: message });
    return send(res, 500, { ok: false, job: JOB, error: message });
  }
}
