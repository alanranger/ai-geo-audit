/**
 * Nightly page + query step for gsc_page_query_daily (approved 2 Nov 2026, Q5): rolling 3 days of final
 * GSC data, GSC API only ($0). Same row shape as scripts/gsc-c0-backfill-page-query-daily.mjs
 * (page_url = full URL as GSC returns it; ctr as a 0..1 fraction). Idempotent upsert on the table's key.
 */
import { randomUUID } from 'node:crypto';

const ROW_LIMIT = 25000;
const UPSERT_BATCH = 1000;
const PAUSE_MS = 120;
export const PAGE_QUERY_DAYS = 3;

async function fetchPage(siteUrl, startDate, endDate, startRow, token) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions: ['date', 'page', 'query'], rowLimit: ROW_LIMIT, startRow, dataState: 'final' })
  });
  if (!res.ok) throw new Error(`gsc_page_query_api:${res.status}`);
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.rows) ? data.rows : [];
}

export function mapPageQueryRows(rows, propertyUrl) {
  return rows
    .filter((r) => r.keys?.[0] && r.keys?.[1] && r.keys?.[2] != null)
    .map((r) => ({
      property_url: propertyUrl,
      date: r.keys[0],
      page_url: r.keys[1],
      query: String(r.keys[2]),
      clicks: Math.round(Number(r.clicks) || 0),
      impressions: Math.round(Number(r.impressions) || 0),
      ctr: Number(r.ctr) || 0,
      position: r.impressions > 0 && r.position != null ? Number(r.position) : null,
      ingested_at: new Date().toISOString()
    }));
}

export async function runPageQueryNightly(supabase, { siteUrl, propertyUrl, startDate, endDate, token }) {
  const runId = `nightly-pq-${startDate}-${endDate}-${randomUUID().slice(0, 8)}`;
  await supabase.from('gsc_backfill_runs').insert({ run_id: runId, status: 'running', date_range_start: startDate, date_range_end: endDate, notes: 'nightly page+query cron' });
  try {
    const rows = [];
    let apiCalls = 0;
    for (let startRow = 0; ; startRow += ROW_LIMIT) {
      const batch = await fetchPage(siteUrl, startDate, endDate, startRow, token);
      apiCalls += 1;
      rows.push(...batch);
      if (batch.length < ROW_LIMIT) break;
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    const records = mapPageQueryRows(rows, propertyUrl);
    let errors = 0;
    for (let i = 0; i < records.length; i += UPSERT_BATCH) {
      const { error } = await supabase.from('gsc_page_query_daily')
        .upsert(records.slice(i, i + UPSERT_BATCH), { onConflict: 'property_url,date,page_url,query' });
      if (error) errors += 1;
    }
    await supabase.from('gsc_backfill_runs').update({
      status: errors ? 'failed' : 'completed', completed_at: new Date().toISOString(),
      rows_inserted: records.length, rows_upserted: records.length, api_calls: apiCalls,
      error_message: errors ? `${errors} batch errors` : null
    }).eq('run_id', runId);
    return { run_id: runId, rows: records.length, api_calls: apiCalls, errors };
  } catch (e) {
    await supabase.from('gsc_backfill_runs').update({ status: 'failed', completed_at: new Date().toISOString(), error_message: e.message }).eq('run_id', runId);
    return { run_id: runId, error: e.message };
  }
}
