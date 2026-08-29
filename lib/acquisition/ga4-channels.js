/**
 * GA4 per-channel daily sessions — the missing "Visits" source for the
 * Acquisition tab.
 *
 * The existing GA4 pull (api/aigeo/ga4-data.js) only ever asks for eventName
 * and pagePath, so no channel could show visits. GA4 has held the breakdown all
 * along; this requests it.
 *
 * Two things this deliberately does NOT do:
 *   - It does not drop the automated "Unassigned" traffic at fetch time. Those
 *     rows are stored and flagged so the excluded share stays auditable and can
 *     be quoted on the tab instead of quietly vanishing.
 *   - It does not invent a YouTube figure. If GA4 reports no youtube.com
 *     sessions, the channel gets zero attributed visits and says so.
 */
import { createClient } from '@supabase/supabase-js';

const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_PROPERTY_ID = '289575590';
const PROPERTY_URL = 'https://www.alanranger.com';

/**
 * GA4's own channel grouping for traffic it could not attribute. On this
 * property it is overwhelmingly automated: 3% engaged, ~5s sessions, exactly
 * 1.00 pages per session. Treated as unattributed, never as a real channel.
 */
export const UNATTRIBUTED_GROUP = 'Unassigned';

export function ga4Config() {
  return {
    propertyId: String(process.env.GA4_PROPERTY_ID || DEFAULT_PROPERTY_ID).trim(),
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    refreshToken: String(process.env.GOOGLE_REFRESH_TOKEN || '').trim(),
  };
}

export function missingGa4Setup(cfg = ga4Config()) {
  const missing = [];
  if (!cfg.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!cfg.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!cfg.refreshToken) missing.push('GOOGLE_REFRESH_TOKEN');
  if (!cfg.propertyId) missing.push('GA4_PROPERTY_ID');
  return missing;
}

async function accessToken(cfg) {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`ga4_oauth: ${json?.error_description || json?.error || res.status}`);
  }
  return json.access_token;
}

/** GA4 returns dates as YYYYMMDD; the column is a real date. */
export function ga4DateToIso(value) {
  const s = String(value || '');
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Shape one GA4 report row into a table row. */
export function normaliseRow(row, propertyUrl = PROPERTY_URL) {
  const dims = (row?.dimensionValues || []).map((d) => d?.value ?? '');
  const mets = (row?.metricValues || []).map((m) => m?.value ?? null);
  const date = ga4DateToIso(dims[0]);
  if (!date) return null;
  const channelGroup = dims[1] || '(unknown)';
  const sessions = num(mets[0]) ?? 0;
  const engaged = num(mets[1]);
  return {
    property_url: propertyUrl,
    date,
    channel_group: channelGroup,
    source: dims[2] || '',
    medium: dims[3] || '',
    sessions,
    engaged_sessions: engaged,
    avg_session_seconds: num(mets[2]),
    pages_per_session: num(mets[3]),
    is_unattributed: channelGroup === UNATTRIBUTED_GROUP,
  };
}

export function normaliseReport(payload, propertyUrl = PROPERTY_URL) {
  return (payload?.rows || [])
    .map((r) => normaliseRow(r, propertyUrl))
    .filter(Boolean);
}

async function runReport(token, propertyId, { days, offset, limit }) {
  const res = await fetch(`${GA4_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [
        { name: 'date' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'averageSessionDuration' },
        { name: 'screenPageViewsPerSession' },
      ],
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit,
      offset,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`ga4_report: ${json?.error?.message || res.status}`);
  return json;
}

const PAGE_SIZE = 10000;

/** GA4 caps a response page, and 90 days x channels x sources exceeds it. */
async function fetchAllRows(token, propertyId, days) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const page = await runReport(token, propertyId, { days, offset, limit: PAGE_SIZE });
    const batch = normaliseReport(page);
    rows.push(...batch);
    const total = Number(page?.rowCount || 0);
    offset += PAGE_SIZE;
    if (rows.length >= total || batch.length === 0) break;
  }
  return rows;
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function persist(sb, rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb
      .from('ga4_channel_sessions_daily')
      .upsert(chunk, { onConflict: 'property_url,date,channel_group,source,medium' });
    if (error) throw new Error(`ga4_channel_sessions_daily: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** Totals worth reporting back from a run, so the bot share stays visible. */
export function summariseRows(rows) {
  let attributed = 0;
  let unattributed = 0;
  for (const r of rows) {
    if (r.is_unattributed) unattributed += r.sessions;
    else attributed += r.sessions;
  }
  const total = attributed + unattributed;
  return {
    attributed_sessions: attributed,
    unattributed_sessions: unattributed,
    attributed_pct: total ? Math.round((attributed / total) * 100) : null,
  };
}

/**
 * Pull daily channel sessions. GA4 serves history, so `days` doubles as the
 * backfill window — there is no forward-only limitation here.
 *
 * @param {{ persist?: boolean, days?: number }} opts
 */
export async function collectGa4Channels(opts = {}) {
  const cfg = ga4Config();
  const missing = missingGa4Setup(cfg);
  if (missing.length) return { configured: false, missing, rows_written: 0 };

  const days = opts.days || 90;
  const token = await accessToken(cfg);
  const rows = await fetchAllRows(token, cfg.propertyId, days);
  const summary = {
    configured: true,
    missing: [],
    days,
    rows: rows.length,
    ...summariseRows(rows),
  };

  if (opts.persist === false) return { ...summary, rows_written: 0, persisted: false };
  const sb = supabaseAdmin();
  if (!sb) throw new Error('missing_supabase_credentials');
  const written = await persist(sb, rows);
  return { ...summary, rows_written: written, persisted: true };
}
