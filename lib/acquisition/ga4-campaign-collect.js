/**
 * Daily ChatGPT-ad GA4 rows. Sessions and purchase ids only.
 * The Squarespace order total is applied later, when the tile is read.
 */
import { createClient } from '@supabase/supabase-js';
import { ga4Config } from './ga4-channels.js';
import { refreshGoogleAccessToken } from '../google-token.js';

const API = 'https://analyticsdata.googleapis.com/v1beta';
const PROPERTY_URL = 'https://www.alanranger.com';
const SOURCE = 'chatgpt';

function iso(value) {
  const s = String(value || '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

async function report(token, propertyId, body) {
  const res = await fetch(`${API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message || `ga4_${res.status}`);
  return json?.rows || [];
}

function dims(row) {
  return (row.dimensionValues || []).map((d) => d?.value || '');
}

const chatgptOnly = {
  filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'EXACT', value: SOURCE, caseSensitive: false } }
};

export function sessionRows(rows) {
  return rows.map((row) => {
    const d = dims(row);
    const date = iso(d[0]);
    if (!date) return null;
    return {
      property_url: PROPERTY_URL,
      date,
      source: d[1] || SOURCE,
      medium: d[2] || '',
      campaign: d[3] || '',
      content: d[4] || '',
      sessions: Number(row.metricValues?.[0]?.value || 0),
      engaged_sessions: Number(row.metricValues?.[1]?.value || 0)
    };
  }).filter(Boolean);
}

export function purchaseRows(rows) {
  return rows.map((row) => {
    const d = dims(row);
    const id = d[1] || '';
    if (!id) return null;
    return {
      property_url: PROPERTY_URL,
      transaction_id: id,
      date: iso(d[0]),
      source: d[2] || SOURCE,
      medium: d[3] || '',
      campaign: d[4] || '',
      content: d[5] || '',
      ga4_revenue: Number(row.metricValues?.[0]?.value || 0)
    };
  }).filter(Boolean);
}

async function upsert(sb, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function collectGa4Campaigns({ days = 90, persist = true } = {}) {
  const cfg = ga4Config();
  const token = (await refreshGoogleAccessToken({
    clientId: cfg.clientId, clientSecret: cfg.clientSecret, refreshToken: cfg.refreshToken, label: 'ga4'
  })).accessToken;
  const range = [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }];
  const [sessions, purchases] = await Promise.all([
    report(token, cfg.propertyId, {
      dateRanges: range,
      dimensions: [
        { name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' },
        { name: 'sessionCampaignName' }, { name: 'sessionManualAdContent' }
      ],
      metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }],
      dimensionFilter: chatgptOnly,
      limit: 10000
    }),
    report(token, cfg.propertyId, {
      dateRanges: range,
      dimensions: [
        { name: 'date' }, { name: 'transactionId' }, { name: 'sessionSource' }, { name: 'sessionMedium' },
        { name: 'sessionCampaignName' }, { name: 'sessionManualAdContent' }
      ],
      metrics: [{ name: 'purchaseRevenue' }],
      dimensionFilter: chatgptOnly,
      limit: 10000
    })
  ]);
  const sessionOut = sessionRows(sessions);
  const purchaseOut = purchaseRows(purchases);
  if (!persist) return { sessions: sessionOut.length, purchases: purchaseOut.length };
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing_supabase_credentials');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  await upsert(sb, 'ga4_campaign_daily', sessionOut, 'property_url,date,source,medium,campaign,content');
  await upsert(sb, 'ga4_campaign_purchases', purchaseOut, 'property_url,transaction_id');
  return { sessions: sessionOut.length, purchases: purchaseOut.length };
}
