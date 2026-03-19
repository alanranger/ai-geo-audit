export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { collectCitationConsistencyRows } from '../../lib/citation/consistency.js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
  res.status(status).send(JSON.stringify(body));
};

const extractHostname = (url) => {
  const raw = String(url || '').trim();
  if (!raw || !URL.canParse(raw)) return '';
  return String(new URL(raw).hostname || '').toLowerCase();
};

const hostMatchesDomain = (host, domain) => {
  const normalizedHost = String(host || '').toLowerCase().trim();
  const normalizedDomain = String(domain || '').toLowerCase().trim();
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
};

const sanitizeCitationRows = (rows) => {
  const output = [];
  for (const row of rows || []) {
    const domain = String(row?.directory_domain || '').toLowerCase().trim();
    const host = extractHostname(row?.source_url);
    if (!hostMatchesDomain(host, domain)) continue;
    output.push(row);
  }
  return output;
};

const normalizePropertyUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch (err) {
    console.warn('[citation-consistency] Invalid property URL, using default:', err.message);
    return 'https://www.alanranger.com';
  }
};

const coerceBoolean = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const resolveBaseUrl = (req) => {
  const fallback = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  const raw = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback;
  return String(raw || '').replace(/\/+$/, '');
};

const normalizePhone = (value) => String(value || '').replace(/\D+/g, '');
const resolveDirectorySeedMapRaw = (req) => {
  const fromQuery = String(req.query.directorySeedMap || req.query.directorySeedUrls || '').trim();
  if (fromQuery) return fromQuery;
  return String(process.env.CITATION_DIRECTORY_SEED_URLS || '').trim();
};
const resolveDomainsRaw = (req) => {
  const fromQuery = String(req.query.domainsRaw || req.query.directoryDomains || '').trim();
  if (fromQuery) return fromQuery;
  return String(process.env.CITATION_CORE_DIRECTORY_DOMAINS || '').trim();
};

const canonicalNapFromEnv = () => ({
  name: String(process.env.CITATION_CANONICAL_NAME || process.env.BUSINESS_NAME || 'Alan Ranger Photography'),
  phone: String(process.env.CITATION_CANONICAL_PHONE || '').trim(),
  locality: String(process.env.CITATION_CANONICAL_LOCALITY || 'Coventry').trim(),
  postcode: String(process.env.CITATION_CANONICAL_POSTCODE || '').trim()
});

const canonicalNapFromLocalSignals = async (baseUrl, propertyUrl) => {
  try {
    const url = `${baseUrl}/api/aigeo/local-signals?property=${encodeURIComponent(propertyUrl)}`;
    const response = await fetch(url);
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'ok') return null;
    const locations = Array.isArray(payload?.data?.locations) ? payload.data.locations : [];
    if (!locations.length) return null;
    const first = locations[0] || {};
    const address = first.address || {};
    const addressLine = Array.isArray(address.addressLines) && address.addressLines.length
      ? String(address.addressLines[0] || '')
      : '';
    return {
      name: String(first.name || '').trim(),
      phone: String(first.phone || '').trim(),
      locality: String(address.locality || '').trim(),
      postcode: String(address.postalCode || addressLine || '').trim()
    };
  } catch (error) {
    console.warn('[citation-consistency] local-signals fallback:', error.message);
    return null;
  }
};

const mergeCanonicalNap = (primary, fallback) => ({
  name: String(primary?.name || fallback?.name || '').trim(),
  phone: String(primary?.phone || fallback?.phone || '').trim(),
  locality: String(primary?.locality || fallback?.locality || '').trim(),
  postcode: String(primary?.postcode || fallback?.postcode || '').trim()
});

const persistRows = async (rows, summary, canonicalNap) => {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const nowIso = new Date().toISOString();

  const { data: runData, error: runError } = await supabase
    .from('citation_consistency_runs')
    .insert({
      run_started_at: nowIso,
      run_completed_at: nowIso,
      status: 'ok',
      polling_frequency: 'daily',
      directories_checked: summary.domainsChecked,
      entries_checked: summary.entriesChecked,
      drift_count: summary.driftCount,
      alerts_count: summary.alertsCount,
      average_score: summary.averageScore,
      canonical_nap: canonicalNap
    })
    .select('id')
    .single();

  if (runError) {
    const message = String(runError.message || '');
    if (message.includes('does not exist')) {
      return { runPersisted: false, runId: null, tableWarning: 'citation_consistency_runs table missing' };
    }
    throw new Error(`citation run insert failed: ${runError.message}`);
  }

  const rowsToUpsert = rows.map((row) => ({
    ...row,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    last_seen_run_id: runData.id
  }));

  const { error: rowsError } = await supabase
    .from('citation_consistency_entries')
    .upsert(rowsToUpsert, { onConflict: 'directory_domain,source_url' });

  if (rowsError) {
    throw new Error(`citation rows upsert failed: ${rowsError.message}`);
  }

  return { runPersisted: true, runId: runData.id, tableWarning: null };
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const propertyUrl = normalizePropertyUrl(req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com');
    const persist = coerceBoolean(req.query.persist, true);
    const perDomainLimit = Number(req.query.perDomainLimit || 2);
    const directorySeedMapRaw = resolveDirectorySeedMapRaw(req);
    const domainsRaw = resolveDomainsRaw(req);
    const baseUrl = resolveBaseUrl(req);

    const envCanonical = canonicalNapFromEnv();
    const signalsCanonical = await canonicalNapFromLocalSignals(baseUrl, propertyUrl);
    const canonicalNap = mergeCanonicalNap(signalsCanonical, envCanonical);
    canonicalNap.phone = normalizePhone(canonicalNap.phone);

    const rawSummary = await collectCitationConsistencyRows({
      canonicalNap,
      propertyUrl,
      domainsRaw,
      directorySeedMapRaw,
      perDomainLimit
    });
    const rows = sanitizeCitationRows(rawSummary.rows);
    const summary = {
      ...rawSummary,
      rows,
      entriesChecked: rows.length,
      driftCount: rows.filter((row) => row.status !== 'pass').length,
      alertsCount: rows.filter((row) => ['alert', 'critical'].includes(String(row.alert_level || '').toLowerCase())).length,
      averageScore: rows.length
        ? Math.round(rows.reduce((sum, row) => sum + Number(row.consistency_score || 0), 0) / rows.length)
        : 0
    };

    let persistence = { runPersisted: false, runId: null, tableWarning: null };
    if (persist) {
      persistence = await persistRows(summary.rows, summary, canonicalNap);
    }

    const topDriftRows = summary.rows
      .filter((row) => row.status !== 'pass')
      .sort((a, b) => Number(a.consistency_score || 0) - Number(b.consistency_score || 0))
      .slice(0, 20);

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        polling: 'daily',
        propertyUrl,
        canonicalNap,
        runPersisted: persistence.runPersisted,
        runId: persistence.runId,
        tableWarning: persistence.tableWarning,
        directoriesChecked: summary.domainsChecked,
        entriesChecked: summary.entriesChecked,
        driftCount: summary.driftCount,
        alertsCount: summary.alertsCount,
        averageScore: summary.averageScore,
        topDriftRows
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    return sendJson(res, 500, {
      status: 'error',
      message: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
