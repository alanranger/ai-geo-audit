/**
 * Test: volume + upsert performance for money page timeseries.
 *
 * Usage:
 *   node scripts/test-money-page-timeseries-volume.js --propertyUrl "https://www.alanranger.com" --commit
 *   node scripts/test-money-page-timeseries-volume.js --pageLimit 100 --commit
 *
 * Flags:
 *   --propertyUrl  (default: https://www.alanranger.com)
 *   --days         (default: 28)
 *   --endOffset    (default: 1)
 *   --pageLimit    (default: all)
 *   --batchSize    (default: 1000)
 *   --commit       (writes rows; otherwise dry run)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../api/aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const getArg = (name, def = null) => {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

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

const buildDateSeries = (endDate, days) => {
  const list = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    list.push(d.toISOString().split('T')[0]);
  }
  return list;
};

async function main() {
  const propertyUrl = getArg('propertyUrl', 'https://www.alanranger.com');
  const days = Number.parseInt(getArg('days', '28'), 10) || 28;
  const endOffset = Number.parseInt(getArg('endOffset', '1'), 10);
  const pageLimit = Number.parseInt(getArg('pageLimit', ''), 10);
  const batchSize = Number.parseInt(getArg('batchSize', '1000'), 10) || 1000;
  const commit = hasFlag('commit');

  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const { startDate, endDate } = getGscDateRange({ daysBack: days, endOffsetDays: endOffset });

  console.log(`[Test Money Page Volume] property=${siteUrl}`);
  console.log(`[Test Money Page Volume] range=${startDate}..${endDate} days=${days} commit=${commit}`);

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

  let moneyPages = Array.isArray(moneyPagesMetrics?.rows)
    ? moneyPagesMetrics.rows.map((row) => row.url).filter(Boolean)
    : [];

  if (pageLimit && Number.isFinite(pageLimit)) {
    moneyPages = moneyPages.slice(0, pageLimit);
  }

  if (moneyPages.length === 0) {
    console.log('[Test Money Page Volume] No money pages found in latest audit.');
    return;
  }

  console.log(`[Test Money Page Volume] Money pages: ${moneyPages.length}`);

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
  if (rows.length === 25000) {
    console.warn('[Test Money Page Volume] GSC rows hit rowLimit=25000 (may be truncated).');
  }

  const moneyPageSet = new Set(moneyPages.map((url) => normalizeUrl(url)).filter(Boolean));
  const dateSeries = buildDateSeries(endDate, days);
  const pageRows = rows
    .map((row) => ({
      date: row.keys?.[0] || null,
      page: row.keys?.[1] || null,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr ? row.ctr * 100 : 0,
      position: row.position ?? null
    }))
    .filter((row) => row.date && row.page)
    .filter((row) => moneyPageSet.has(normalizeUrl(row.page)));

  const pageMap = new Map();
  pageRows.forEach((row) => {
    const pageKey = normalizeUrl(row.page);
    if (!pageMap.has(pageKey)) pageMap.set(pageKey, new Map());
    pageMap.get(pageKey).set(row.date, row);
  });

  const records = [];
  moneyPageSet.forEach((pageKey) => {
    const perDate = pageMap.get(pageKey) || new Map();
    dateSeries.forEach((date) => {
      const existing = perDate.get(date);
      records.push({
        property_url: siteUrl,
        page_url: pageKey,
        date,
        clicks: Number(existing?.clicks || 0),
        impressions: Number(existing?.impressions || 0),
        ctr: Number(existing?.ctr || 0),
        position: existing?.position != null ? Number(existing.position) : null,
        updated_at: new Date().toISOString()
      });
    });
  });

  console.log(`[Test Money Page Volume] GSC rows fetched: ${rows.length}`);
  console.log(`[Test Money Page Volume] Rows matching money pages: ${pageRows.length}`);
  console.log(`[Test Money Page Volume] Full grid rows to upsert: ${records.length}`);

  if (!commit) {
    console.log('[Test Money Page Volume] Dry run complete (no DB writes).');
    return;
  }

  let inserted = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchStart = Date.now();
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });
    const batchMs = Date.now() - batchStart;
    if (error) {
      errors += 1;
      console.warn(`[Test Money Page Volume] Batch ${i / batchSize + 1} error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
    console.log(`[Test Money Page Volume] Batch ${i / batchSize + 1} ok (${batch.length}) in ${batchMs}ms`);
  }

  const totalMs = Date.now() - startTime;
  console.log(`[Test Money Page Volume] done: saved=${inserted} errors=${errors} totalMs=${totalMs}`);
}

main().catch((e) => {
  console.error('[Test Money Page Volume] fatal:', e?.message || e);
  process.exit(1);
});
