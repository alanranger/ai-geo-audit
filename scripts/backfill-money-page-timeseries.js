/**
 * Backfill: populate gsc_page_timeseries for money pages (last 28 days).
 *
 * Usage:
 *   node scripts/backfill-money-page-timeseries.js --propertyUrl "https://www.alanranger.com"
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

const normalizeUrl = (url) => {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  const parts = normalized.split('/');
  if (parts.length > 1) {
    normalized = parts.slice(1).join('/');
  }
  return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
};

async function main() {
  const propertyUrl = getArg('propertyUrl', 'https://www.alanranger.com');
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const { startDate, endDate } = getGscDateRange({ daysBack: 28, endOffsetDays: 1 });

  console.log(`[Backfill Money Page Timeseries] property=${siteUrl} range=${startDate}..${endDate}`);

  const { data: latestAudit, error: auditError } = await supabase
    .from('audit_results')
    .select('audit_date, money_pages_metrics')
    .eq('property_url', siteUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (auditError || !latestAudit) {
    throw new Error(`latest_audit_missing:${auditError?.message || 'no_audit'}`);
  }

  let moneyPagesMetrics = latestAudit.money_pages_metrics;
  if (typeof moneyPagesMetrics === 'string') {
    try { moneyPagesMetrics = JSON.parse(moneyPagesMetrics); } catch { moneyPagesMetrics = null; }
  }

  const moneyPages = Array.isArray(moneyPagesMetrics?.rows)
    ? moneyPagesMetrics.rows.map((row) => row.url).filter(Boolean)
    : [];

  if (moneyPages.length === 0) {
    console.log('[Backfill Money Page Timeseries] No money pages found in latest audit.');
    return;
  }

  console.log(`[Backfill Money Page Timeseries] Money pages: ${moneyPages.length}`);

  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['date', 'page'],
      rowLimit: 25000
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`gsc_api_error:${response.status}:${errorText.slice(0, 400)}`);
  }

  const data = await response.json().catch(() => ({}));
  const rows = Array.isArray(data.rows) ? data.rows : [];

  const moneyPageSet = new Set(moneyPages.map((url) => normalizeUrl(url)).filter(Boolean));
  const records = rows
    .map((row) => ({
      date: row.keys?.[0] || null,
      page: row.keys?.[1] || null,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr ? row.ctr * 100 : 0,
      position: row.position ?? null
    }))
    .filter((row) => row.date && row.page)
    .filter((row) => moneyPageSet.has(normalizeUrl(row.page)))
    .map((row) => ({
      property_url: siteUrl,
      page_url: normalizeUrl(row.page),
      date: row.date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: row.position != null ? Number(row.position) : null,
      updated_at: new Date().toISOString()
    }));

  if (records.length === 0) {
    console.log('[Backfill Money Page Timeseries] No matching rows to save.');
    return;
  }

  console.log(`[Backfill Money Page Timeseries] Saving ${records.length} rows...`);

  const batchSize = 1000;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });

    if (error) {
      errors += 1;
      console.warn(`[Backfill Money Page Timeseries] Batch ${i / batchSize + 1} error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`[Backfill Money Page Timeseries] done: saved=${inserted} errors=${errors}`);
}

main().catch((e) => {
  console.error('[Backfill Money Page Timeseries] fatal:', e?.message || e);
  process.exit(1);
});

