/**
 * Additive GA4 channel backfill for Claude handoff QUESTION-2026-10-05-ga4-backfill-2024.
 *
 *   node scripts/ga4-channels-backfill-2024.mjs
 *
 * Inserts missing rows only (ignoreDuplicates). Does not update/delete existing.
 * Window: 2024-01-01 → 2026-05-30 (day before current earliest 2026-05-31).
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });

const { collectGa4Channels } = await import('../lib/acquisition/ga4-channels.js');

const START = '2024-01-01';
const END = '2026-05-31'; // fill missing May days; ignoreDuplicates skips existing 2026-05-31 rows
const PROPERTY = 'https://www.alanranger.com';

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

function monthKeys(fromYmd, toYmd) {
  const out = [];
  let y = Number(fromYmd.slice(0, 4));
  let m = Number(fromYmd.slice(5, 7));
  const ey = Number(toYmd.slice(0, 4));
  const em = Number(toYmd.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let end = `${ym}-${String(last).padStart(2, '0')}`;
  if (end > END) end = END;
  if (start < START) return null;
  if (start > END) return null;
  return { start: start < START ? START : start, end };
}

async function countByMonth(client) {
  const counts = {};
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data: rows, error: err } = await client
      .from('ga4_channel_sessions_daily')
      .select('date')
      .eq('property_url', PROPERTY)
      .gte('date', '2024-01-01')
      .lte('date', '2026-09-30')
      .range(from, from + page - 1);
    if (err) throw new Error(err.message);
    const chunk = rows || [];
    for (const r of chunk) {
      const k = String(r.date).slice(0, 7);
      counts[k] = (counts[k] || 0) + 1;
    }
    if (chunk.length < page) break;
    from += page;
  }
  return counts;
}

async function monthlyChannelSummary(client) {
  const by = {};
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data: rows, error } = await client
      .from('ga4_channel_sessions_daily')
      .select('date, channel_group, sessions, engaged_sessions')
      .eq('property_url', PROPERTY)
      .gte('date', '2024-01-01')
      .lte('date', '2026-09-30')
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const chunk = rows || [];
    for (const r of chunk) {
      const ym = String(r.date).slice(0, 7);
      const ch = r.channel_group || '(unknown)';
      if (!by[ym]) by[ym] = {};
      if (!by[ym][ch]) by[ym][ch] = { sessions: 0, engaged_sessions: 0 };
      by[ym][ch].sessions += Number(r.sessions || 0);
      by[ym][ch].engaged_sessions += Number(r.engaged_sessions || 0);
    }
    if (chunk.length < page) break;
    from += page;
  }
  return by;
}

const client = sb();
const beforeTotal = await client
  .from('ga4_channel_sessions_daily')
  .select('*', { count: 'exact', head: true })
  .eq('property_url', PROPERTY);
const beforeByMonth = await countByMonth(client);

const months = monthKeys(START, END);
const runLog = [];
for (const ym of months) {
  const bounds = monthBounds(ym);
  if (!bounds || bounds.start > bounds.end) continue;
  const result = await collectGa4Channels({
    startDate: bounds.start,
    endDate: bounds.end,
    persist: true,
    additiveOnly: true
  });
  runLog.push({ month: ym, ...bounds, ...result });
  console.log(JSON.stringify(runLog[runLog.length - 1]));
}

const afterTotal = await client
  .from('ga4_channel_sessions_daily')
  .select('*', { count: 'exact', head: true })
  .eq('property_url', PROPERTY);
const afterByMonth = await countByMonth(client);
const summary = await monthlyChannelSummary(client);

const report = {
  ok: true,
  additive_only: true,
  window: { start: START, end: END },
  earliest_ga4: '2024-01-01',
  before_rows: beforeTotal.count,
  after_rows: afterTotal.count,
  rows_added_estimate: (afterTotal.count || 0) - (beforeTotal.count || 0),
  before_by_month: beforeByMonth,
  after_by_month: afterByMonth,
  monthly_channel_summary: summary,
  runs: runLog
};
console.log('===REPORT===');
console.log(JSON.stringify(report, null, 2));
