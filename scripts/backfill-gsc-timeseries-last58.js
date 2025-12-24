/**
 * One-off: backfill/refresh the last N days of site-level GSC daily totals into `gsc_timeseries`.
 *
 * Why:
 * - Money Pages charts derive rolling 28d values from `gsc_timeseries`.
 * - GSC is usually 1–3 days behind, so we default end date to "today - 2".
 *
 * Usage (PowerShell):
 *   node scripts/backfill-gsc-timeseries-last58.js --propertyUrl "https://www.alanranger.com" --days 58 --endOffsetDays 2
 *
 * Requires env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../api/aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

function getArg(name, def = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

function* dateRangeInclusive(startIso, endIso) {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    yield d.toISOString().split('T')[0];
  }
}

async function fetchGscDailyTotals({ siteUrl, date, accessToken }) {
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const resp = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startDate: date, endDate: date })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`gsc_api_error:${resp.status}:${text.slice(0, 500)}`);
  }

  const data = await resp.json().catch(() => ({}));
  const row = (data.rows && data.rows.length > 0) ? data.rows[0] : null;
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0, // ratio 0-1
    position: row?.position ?? 0
  };
}

async function main() {
  const propertyUrl = getArg('propertyUrl', 'https://www.alanranger.com');
  const days = parseInt(getArg('days', '58'), 10);
  const endOffsetDays = parseInt(getArg('endOffsetDays', '2'), 10);

  if (!Number.isFinite(days) || days < 2) throw new Error(`invalid_days:${days}`);
  if (!Number.isFinite(endOffsetDays) || endOffsetDays < 0) throw new Error(`invalid_endOffsetDays:${endOffsetDays}`);

  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const siteUrl = normalizePropertyUrl(propertyUrl);

  const { startDate, endDate } = getGscDateRange({ daysBack: days, endOffsetDays });
  console.log(`[Backfill GSC Timeseries] site=${siteUrl} days=${days} endOffsetDays=${endOffsetDays} range=${startDate}..${endDate}`);

  const accessToken = await getGSCAccessToken();

  let saved = 0;
  let fetched = 0;
  let errors = 0;

  for (const date of dateRangeInclusive(startDate, endDate)) {
    try {
      const totals = await fetchGscDailyTotals({ siteUrl, date, accessToken });
      fetched += 1;

      const row = {
        property_url: siteUrl,
        date,
        clicks: totals.clicks || 0,
        impressions: totals.impressions || 0,
        ctr: totals.ctr || 0,
        position: totals.position || 0
      };

      const { error } = await supabase
        .from('gsc_timeseries')
        .upsert(row, { onConflict: 'property_url,date' });

      if (error) throw new Error(`supabase_upsert_error:${error.message}`);
      saved += 1;

      if (saved % 10 === 0) {
        console.log(`[Backfill GSC Timeseries] ✓ upserted ${saved}/${days} (latest=${date})`);
      }

      // Small delay to avoid rate limiting.
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      errors += 1;
      console.warn(`[Backfill GSC Timeseries] ⚠ ${date}: ${e?.message || String(e)}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log(`[Backfill GSC Timeseries] done: fetched=${fetched} saved=${saved} errors=${errors}`);
}

main().catch((e) => {
  console.error('[Backfill GSC Timeseries] fatal:', e?.message || e);
  process.exit(1);
});


