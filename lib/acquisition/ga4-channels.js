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
 * Channel groups that get their own tile, in display order.
 *
 * Anything else GA4 reports is rolled into "Other" rather than dropped. That
 * matters more than it looks: the tab claims its channel tiles add up to the
 * site total, and silently omitting Email / Organic Shopping / Paid Search
 * would make that claim false by ~21 sessions. A tile you can't see is a
 * reconciliation error waiting to be blamed on rounding.
 */
export const NAMED_GA4_GROUPS = ['Organic Search', 'Direct', 'Referral', 'Organic Social', 'AI Assistant'];

/** Above this share, Direct is more likely untagged links than real direct traffic. */
export const DIRECT_SHARE_WARN_PCT = 35;

function groupSessions(rows) {
  const totals = new Map();
  let unattributed = 0;
  for (const r of rows || []) {
    const sessions = Number(r?.sessions || 0);
    if (r?.is_unattributed) { unattributed += sessions; continue; }
    const group = r?.channel_group || '(unknown)';
    totals.set(group, (totals.get(group) || 0) + sessions);
  }
  return { totals, unattributed };
}

/**
 * Checks the tab renders so a wrong number flags itself.
 *
 * These live here, not in the tab, because every consumer of GA4 channel
 * figures should inherit them. A caller that forgets to validate is exactly how
 * "Direct 7,046" ended up sitting next to "Google organic 5,761" as though the
 * two were the same measurement.
 */
export function ga4Checks({ tiles, total }) {
  const tileSum = tiles.reduce((t, g) => t + g.sessions, 0);
  const direct = tiles.find((g) => g.name === 'Direct');
  const directPct = total > 0 && direct ? (direct.sessions / total) * 100 : null;
  const oversized = tiles.filter((g) => g.sessions > total);

  const checks = [{
    id: 'reconciles',
    level: tileSum === total ? 'ok' : 'error',
    ok: tileSum === total,
    message: tileSum === total
      ? `Total GA4 site visits: ${total.toLocaleString()} \u00B7 reconciles \u2713`
      : `Channel tiles sum to ${tileSum.toLocaleString()} but the GA4 attributed total is ${total.toLocaleString()}`
      + ` — a difference of ${Math.abs(total - tileSum).toLocaleString()} sessions. Do not trust these tiles.`,
  }];

  if (directPct != null && directPct > DIRECT_SHARE_WARN_PCT) {
    checks.push({
      id: 'direct_share',
      level: 'warn',
      ok: false,
      message: `Direct ${Math.round(directPct)}% — likely untagged links, verify`,
    });
  }

  for (const g of oversized) {
    checks.push({
      id: 'impossible_value',
      level: 'error',
      ok: false,
      message: `${g.name} reports ${g.sessions.toLocaleString()} sessions, more than the site total`
        + ` (${total.toLocaleString()}) — impossible, the figure is wrong.`,
    });
  }

  return {
    checks,
    reconciles: tileSum === total,
    tile_sum: tileSum,
    direct_share_pct: directPct == null ? null : Math.round(directPct * 10) / 10,
  };
}

/**
 * The canonical attributed view of GA4 channel sessions.
 *
 * One unit throughout (sessions), bot bucket held separately, and the tiles
 * guaranteed to sum to the total because "Other" absorbs the remainder.
 */
export function ga4AttributedView(rows) {
  const { totals, unattributed } = groupSessions(rows);
  const total = [...totals.values()].reduce((t, n) => t + n, 0);

  const tiles = [];
  for (const name of NAMED_GA4_GROUPS) {
    if (totals.has(name)) tiles.push({ name, sessions: totals.get(name), groups: [name] });
  }
  const otherNames = [...totals.keys()]
    .filter((n) => !NAMED_GA4_GROUPS.includes(n))
    .sort((a, b) => a.localeCompare(b));
  if (otherNames.length) {
    tiles.push({
      name: 'Other',
      sessions: otherNames.reduce((t, n) => t + totals.get(n), 0),
      groups: otherNames,
    });
  }

  const validation = ga4Checks({ tiles, total });
  const grandTotal = total + unattributed;
  return {
    tiles: tiles.map((g) => ({
      ...g,
      share_pct: total > 0 ? Math.round((g.sessions / total) * 1000) / 10 : null,
    })),
    total_sessions: total,
    unattributed_sessions: unattributed,
    attributed_pct: grandTotal ? Math.round((total / grandTotal) * 100) : null,
    ...validation,
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
