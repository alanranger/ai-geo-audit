// GET /api/aigeo/revenue-sync-status?propertyUrl=https://www.alanranger.com
//
// Returns the most recent sync timestamp per revenue feed so the top
// banner can show "Squarespace: 18-May-26, 07:00", "Stripe: 18-May-26, 07:10",
// "Booking Sheet: 18-May-26, 01:08" etc.
//
// We surface both:
//   - last_synced_at      (max created_at across rows for that source)
//   - last_period_end     (max period_end of rows the sync wrote)
//   - row_count           (total rows written by this source for this property)
//
// The banner uses `last_synced_at` for the "when did the sync last run" stamp
// and `last_period_end` to help show coverage if useful later.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const SOURCES = ['squarespace_api', 'stripe_supplemental', 'booking_sheet', 'manual'];

async function fetchGa4Status(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('ga4_site_metrics_28d')
    .select('captured_at, date_start, date_end, enquiry_events_28d, money_page_enquiry_events_28d')
    .eq('property_url', propertyUrl)
    .order('date_end', { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = data?.[0] || null;
  return {
    source: 'ga4_api',
    last_synced_at: latest ? latest.captured_at : null,
    last_period_start: latest ? latest.date_start : null,
    last_period_end: latest ? latest.date_end : null,
    enquiry_events_28d: latest ? Number(latest.enquiry_events_28d) : null,
    money_page_enquiry_events_28d: latest ? Number(latest.money_page_enquiry_events_28d) : null,
    row_count: latest ? 1 : 0
  };
}

function noop() {}

async function fetchMaxCreatedAt(supabase, propertyUrl, source) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('created_at, period_start, period_end')
    .eq('property_url', propertyUrl)
    .eq('source', source)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function fetchRowCount(supabase, propertyUrl, source) {
  const { count, error } = await supabase
    .from('revenue_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('property_url', propertyUrl)
    .eq('source', source);
  if (error) throw error;
  return count || 0;
}

function normalizeDomainHost(propertyUrl) {
  let s = String(propertyUrl || DEFAULT_PROPERTY).trim().toLowerCase();
  s = s.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '') || 'alanranger.com';
}

function propertyUrlCandidates(propertyUrl) {
  const raw = String(propertyUrl || DEFAULT_PROPERTY).trim();
  const out = new Set([raw]);
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    out.add(`${u.protocol}//${u.hostname}`);
    if (u.hostname.startsWith('www.')) {
      out.add(`${u.protocol}//${u.hostname.replace(/^www\./, '')}`);
    } else {
      out.add(`${u.protocol}//www.${u.hostname}`);
    }
  } catch (_) { /* keep raw only */ }
  return [...out];
}

async function fetchDfsBacklinkStatus(supabase, propertyUrl) {
  const host = normalizeDomainHost(propertyUrl);
  const { data, error } = await supabase
    .from('dfs_backlink_ingest_state')
    .select('last_full_at, domain_host')
    .eq('domain_host', host)
    .maybeSingle();
  if (error) throw error;
  return {
    source: 'dfs_backlinks',
    last_synced_at: data?.last_full_at || null,
    row_count: data ? 1 : 0,
    domain_host: host
  };
}

async function fetchSchemaAuditStatus(supabase, propertyUrl) {
  const urls = propertyUrlCandidates(propertyUrl);
  const { data, error } = await supabase
    .from('audit_results')
    .select('created_at, schema_total_pages, property_url')
    .in('property_url', urls)
    .gt('schema_total_pages', 0)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = data?.[0] || null;
  return {
    source: 'schema_audit',
    last_synced_at: latest ? latest.created_at : null,
    schema_total_pages: latest ? Number(latest.schema_total_pages) : null,
    row_count: latest ? 1 : 0
  };
}

async function fetchCsvTierSyncStatus(supabase) {
  const { data, error } = await supabase
    .from('csv_metadata')
    .select('import_session')
    .order('import_session', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) throw error;
  const latest = data?.[0] || null;
  const { count, error: countErr } = await supabase
    .from('csv_metadata')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw countErr;
  return {
    source: 'csv_tier_sync',
    last_synced_at: latest?.import_session || null,
    row_count: count || 0,
    row_count_unit: 'rows'
  };
}

async function fetchBookingSheetTruthStatus(supabase, propertyUrl) {
  const [{ count: txnCount, error: countErr }, { data: latest, error: latestErr }] = await Promise.all([
    supabase.from('booking_sheet_transactions')
      .select('property_url', { count: 'exact', head: true })
      .eq('property_url', propertyUrl),
    supabase.from('booking_sheet_transactions')
      .select('imported_at, txn_date')
      .eq('property_url', propertyUrl)
      .order('imported_at', { ascending: false })
      .limit(1)
  ]);
  if (countErr) throw countErr;
  if (latestErr) throw latestErr;
  const row = latest?.[0] || null;
  return {
    source: 'booking_sheet',
    last_synced_at: row?.imported_at || null,
    last_period_end: row?.txn_date || null,
    row_count: txnCount || 0,
    row_count_unit: 'txns'
  };
}

async function buildStatusForSource(supabase, propertyUrl, source) {
  try {
    if (source === 'booking_sheet') return await fetchBookingSheetTruthStatus(supabase, propertyUrl);
    const latest = await fetchMaxCreatedAt(supabase, propertyUrl, source);
    const rowCount = await fetchRowCount(supabase, propertyUrl, source);
    return {
      source,
      last_synced_at: latest ? latest.created_at : null,
      last_period_start: latest ? latest.period_start : null,
      last_period_end: latest ? latest.period_end : null,
      row_count: rowCount
    };
  } catch (err) {
    return {
      source,
      last_synced_at: null,
      row_count: 0,
      error: err?.message || 'Unknown error'
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' });
  }
  const propertyUrl = String(req.query.propertyUrl || req.query.property || DEFAULT_PROPERTY).trim();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const out = {};
    for (const src of SOURCES) {
      // eslint-disable-next-line no-await-in-loop
      out[src] = await buildStatusForSource(supabase, propertyUrl, src);
    }
    try {
      out.ga4_api = await fetchGa4Status(supabase, propertyUrl);
    } catch (err) {
      out.ga4_api = {
        source: 'ga4_api',
        last_synced_at: null,
        row_count: 0,
        error: err?.message || 'Unknown error'
      };
    }
    for (const [key, fn] of [
      ['dfs_backlinks', () => fetchDfsBacklinkStatus(supabase, propertyUrl)],
      ['schema_audit', () => fetchSchemaAuditStatus(supabase, propertyUrl)],
      ['csv_tier_sync', () => fetchCsvTierSyncStatus(supabase)]
    ]) {
      try {
        // eslint-disable-next-line no-await-in-loop
        out[key] = await fn();
      } catch (err) {
        out[key] = {
          source: key,
          last_synced_at: null,
          row_count: 0,
          error: err?.message || 'Unknown error'
        };
      }
    }
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      sources: out
    });
  } catch (err) {
    noop(err);
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}
