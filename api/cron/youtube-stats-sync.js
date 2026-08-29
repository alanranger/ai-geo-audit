/**
 * Nightly YouTube channel + per-video pull for the Acquisition tab.
 *
 * Returns 200 with { configured: false, missing: [...] } when the YouTube
 * credentials are not set yet, so an unauthorised channel reads as a named
 * setup gap rather than a crashed cron or an implied zero.
 *
 * GET  with x-vercel-cron / ?secret=  — scheduled run
 * POST                                — dashboard audit button / full refresh
 * ?dryRun=true                        — fetch and report without writing
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { collectYoutubeStats } from '../../lib/acquisition/youtube-stats.js';
import { detectTriggerSource, isRequestAuthorized, startRun, finishRun } from '../../lib/acquisition/sync-runs.js';

const JOB = 'youtube_stats';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!isRequestAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

  const dryRun = ['true', '1', 'yes'].includes(String(req.query?.dryRun || '').toLowerCase());
  const triggerSource = detectTriggerSource(req);
  const runId = dryRun ? null : await startRun(JOB, triggerSource);

  try {
    const result = await collectYoutubeStats({ persist: !dryRun });
    await finishRun(runId, {
      status: result.configured ? 'ok' : 'skipped',
      rows_written: result.rows_written,
      error_message: result.configured ? null : `awaiting_setup: ${result.missing.join(', ')}`,
      meta: { source: result.source || null, videos: result.videos || 0, missing: result.missing },
    });
    return send(res, 200, { ok: true, job: JOB, dry_run: dryRun, ...result });
  } catch (err) {
    const message = err?.message || String(err);
    await finishRun(runId, { status: 'error', error_message: message });
    return send(res, 500, { ok: false, job: JOB, error: message });
  }
}
