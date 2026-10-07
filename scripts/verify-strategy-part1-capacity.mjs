import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { buildStrategyDiary, buildPushList } from '../lib/strategy-diary.mjs';

for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(name, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PROP = 'https://www.alanranger.com';
const [{ data: workshops }, { data: courses }, { data: actions }] = await Promise.all([
  sb.from('booking_sheet_workshop_attendees').select('event_start, theme_location, client_name, is_multi_day, paid').eq('property_url', PROP),
  sb.from('booking_sheet_course_attendees').select('from_date, to_date, event_name, client_name').eq('property_url', PROP),
  sb.from('strategy_quarter_actions').select('*').eq('property_url', PROP)
]);
const { diary } = await buildStrategyDiary({ workshops, courses, actions, snapshots: [] });
const want = ['2026-10-10', '2026-10-16', '2026-10-17', '2026-10-23', '2026-10-29', '2026-11-01', '2026-11-07', '2026-11-20'];
const paste = diary.filter((e) => want.includes(e.date)).map((e) => ({
  date: e.date,
  title: e.title.slice(0, 42),
  cap: e.cap,
  source: e.capacity_source,
  booked: e.booked,
  left: e.left,
  sum: e.booked + e.left,
  fill: e.fill_pct,
  rag: e.rag,
  status: e.status,
  mismatch: e.mismatch,
  note: e.note
}));
const mismatches = diary.filter((e) => e.mismatch).map((e) => ({
  date: e.date,
  title: e.title.slice(0, 40),
  booked: e.booked,
  left: e.left,
  cap: e.cap,
  reason: e.booked + e.left !== e.cap
    ? `booked(${e.booked})+left(${e.left})=${e.booked + e.left} ≠ cap(${e.cap})`
    : (e.note || 'session/unassigned')
}));
const push = buildPushList(diary);
const { data: tick7 } = await sb.from('strategy_quarter_actions').select('id, is_ticked, ticked_at').eq('id', 7).single();
console.log(JSON.stringify({ paste, mismatches, push: push.map((p) => ({ date: p.date, rag: p.rag, title: p.title.slice(0, 36) })), tick7 }, null, 2));
