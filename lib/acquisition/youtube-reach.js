/**
 * Acquisition — YouTube thumbnail impressions and impressions CTR.
 *
 * WHY THIS EXISTS SEPARATELY FROM `youtube-stats.js`
 *
 * Impressions are the only honest "reach" unit for YouTube, but the YouTube
 * ANALYTICS API does not serve them. Google documents
 * `videoThumbnailImpressions` / `videoThumbnailImpressionsClickRate`, yet
 * reports.query rejects both for every principal type — channel owner included.
 * The only API route is the YouTube REPORTING API: schedule a job, then
 * download daily bulk CSVs.
 *
 * Consequences worth knowing before changing anything here:
 *   - A job must exist BEFORE data accrues. Scheduling one backfills only the
 *     30 days before creation, and those historical reports appear "typically
 *     within a couple of days" — not immediately.
 *   - Reports are per-day CSVs, one row per video per day. A window figure is a
 *     SUM of impressions and a RE-DERIVED ratio, never an average of ratios.
 *   - Non-historical reports expire after 60 days, historical ones after 30, so
 *     this is forward-only: it cannot rebuild a window that has aged out.
 */

const REPORTING_API = 'https://youtubereporting.googleapis.com/v1';
const REACH_REPORT_TYPES = ['channel_reach_basic_a1', 'channel_reach_combined_a1'];
const IMPRESSIONS_COLUMN = 'video_thumbnail_impressions';
const CLICK_RATE_COLUMN = 'video_thumbnail_impressions_ctr';

/** Split a bulk report CSV into a header array plus row arrays. */
export function parseReportCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(','));
  return { headers, rows };
}

/**
 * Total impressions and a re-derived CTR for one report's rows.
 *
 * CTR is computed from summed clicks over summed impressions. Averaging the
 * per-row ratios would weight a video with 3 impressions the same as one with
 * 30,000 and produce a number that matches nothing in Studio.
 */
export function aggregateReachRows({ headers, rows }) {
  const iImpr = headers.indexOf(IMPRESSIONS_COLUMN);
  const iCtr = headers.indexOf(CLICK_RATE_COLUMN);
  if (iImpr === -1) return { impressions: null, clicks: null, ctr_pct: null };

  let impressions = 0;
  let clicks = 0;
  for (const row of rows || []) {
    const impr = Number(row[iImpr]);
    if (!Number.isFinite(impr)) continue;
    impressions += impr;
    if (iCtr !== -1) {
      const ctr = Number(row[iCtr]);
      if (Number.isFinite(ctr)) clicks += impr * normaliseCtrToRatio(ctr);
    }
  }
  return {
    impressions,
    clicks: iCtr === -1 ? null : Math.round(clicks),
    ctr_pct: impressions > 0 && iCtr !== -1 ? (clicks / impressions) * 100 : null,
  };
}

/**
 * Coerce a CTR cell to a 0–1 ratio.
 *
 * Google's own docs describe this column as a float in 0–1, but the same metric
 * is described elsewhere as "a percentage", and the two readings differ by 100x.
 * A thumbnail CTR above 100% is impossible and one above 1.0 as a ratio would be
 * too, so a value over 1 can only be a percentage already. This keeps a
 * documentation ambiguity from silently becoming a 100x reporting error.
 */
export function normaliseCtrToRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? n / 100 : n;
}

/** Pick the reports covering the requested window, newest first. */
export function selectReportsForWindow(reports, windowDays, now = Date.now()) {
  const cutoff = now - windowDays * 86400000;
  return (reports || [])
    .filter((r) => r?.startTime && new Date(r.startTime).getTime() >= cutoff)
    .sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)));
}

async function authHeaders() {
  const body = new URLSearchParams({
    client_id: String(process.env.YOUTUBE_CLIENT_ID || '').trim(),
    client_secret: String(process.env.YOUTUBE_CLIENT_SECRET || '').trim(),
    refresh_token: String(process.env.YOUTUBE_REFRESH_TOKEN || '').trim(),
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`youtube_oauth: ${json?.error_description || json?.error || res.status}`);
  }
  return { Authorization: `Bearer ${json.access_token}` };
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`youtube_reporting: ${json?.error?.message || res.status}`);
  return json;
}

/** Find an existing reach job, or schedule one so data starts accruing. */
export async function ensureReachJob(headers) {
  const existing = await getJson(`${REPORTING_API}/jobs`, headers);
  const found = (existing?.jobs || []).find((j) => REACH_REPORT_TYPES.includes(j.reportTypeId));
  if (found) return { job: found, created: false };

  const types = await getJson(`${REPORTING_API}/reportTypes`, headers);
  const available = new Set((types?.reportTypes || []).map((t) => t.id));
  const wanted = REACH_REPORT_TYPES.find((t) => available.has(t));
  if (!wanted) throw new Error('youtube_reporting: no reach report type available for this channel');

  const res = await fetch(`${REPORTING_API}/jobs`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reportTypeId: wanted, name: 'aigeo reach impressions' }),
  });
  const job = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`youtube_reporting: create job ${job?.error?.message || res.status}`);
  return { job, created: true };
}

/**
 * Sum impressions and CTR across the window's daily reports.
 *
 * Returns `impressions: null` when the job exists but has produced nothing yet,
 * which is the normal state for the first day or two. That is reported as
 * `awaiting_first_report` rather than zero — a zero here would read on the
 * dashboard as "nobody saw the channel".
 */
export async function collectYoutubeReach(opts = {}) {
  const windowDays = opts.windowDays || 28;
  const headers = await authHeaders();
  const { job, created } = await ensureReachJob(headers);

  const listed = await getJson(`${REPORTING_API}/jobs/${job.id}/reports`, headers);
  const reports = selectReportsForWindow(listed?.reports, windowDays);
  if (reports.length === 0) {
    return {
      job_id: job.id,
      job_created: created,
      report_type: job.reportTypeId,
      state: 'awaiting_first_report',
      reports_used: 0,
      impressions: null,
      ctr_pct: null,
    };
  }

  let impressions = 0;
  let clicks = 0;
  let used = 0;
  for (const report of reports) {
    if (!report.downloadUrl) continue;
    const res = await fetch(report.downloadUrl, { headers });
    if (!res.ok) continue;
    const agg = aggregateReachRows(parseReportCsv(await res.text()));
    if (agg.impressions == null) continue;
    impressions += agg.impressions;
    clicks += agg.clicks || 0;
    used += 1;
  }

  return {
    job_id: job.id,
    job_created: created,
    report_type: job.reportTypeId,
    state: used > 0 ? 'ok' : 'awaiting_first_report',
    reports_used: used,
    window_days: windowDays,
    impressions: used > 0 ? impressions : null,
    ctr_pct: used > 0 && impressions > 0 ? (clicks / impressions) * 100 : null,
  };
}
