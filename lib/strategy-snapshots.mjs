/**
 * Daily strategy_event_snapshots writer + pace helpers.
 */
import { buildStrategyDiary } from './strategy-diary.mjs';

const PROP = 'https://www.alanranger.com';

/** Calendar date in Europe/London (YYYY-MM-DD) — cron is 07:15 UK. */
export function londonYmd(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function londonHour(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(d);
  return Number(parts.find((p) => p.type === 'hour')?.value || 0);
}

async function pageAll(supabase, table, select, eqCol, eqVal) {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from(table).select(select).eq(eqCol, eqVal).range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

export async function runStrategyEventSnapshots(supabase, propertyUrl = PROP) {
  const snapshotDate = londonYmd();
  console.log('[strategy-event-snapshots]', snapshotDate, propertyUrl);
  const [workshops, courses, actions] = await Promise.all([
    pageAll(supabase, 'booking_sheet_workshop_attendees', 'event_start, theme_location, client_name, is_multi_day, paid', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_course_attendees', 'from_date, to_date, event_name, client_name, is_beginners, is_booking_row', 'property_url', propertyUrl),
    supabase.from('strategy_quarter_actions').select('id, label, is_ticked, due_week_start').eq('property_url', propertyUrl)
      .then((r) => r.data || [])
  ]);
  const { diary } = await buildStrategyDiary({ workshops, courses, actions, snapshots: [] });
  const rows = diary.map((e) => ({
    property_url: propertyUrl,
    snapshot_date: snapshotDate,
    event_date: e.date,
    event_key: e.eventKey,
    title: e.title,
    event_type: e.type,
    product_url: e.url,
    price: e.listPrice ?? e.price,
    sale_price: e.salePrice ?? (e.onSale ? e.price : null),
    on_sale: !!e.onSale,
    qty_in_stock: e.qty ?? e.left,
    capacity: e.cap,
    sheet_booked: e.booked,
    places_left: e.left,
    session_tag: e.note || null,
    raw: { rag: e.rag, status: e.status, mismatch: e.mismatch }
  }));

  // Replace today's snapshot set
  await supabase.from('strategy_event_snapshots')
    .delete()
    .eq('property_url', propertyUrl)
    .eq('snapshot_date', snapshotDate);

  if (rows.length) {
    const { error } = await supabase.from('strategy_event_snapshots').insert(rows);
    if (error) throw error;
  }

  const { count } = await supabase.from('strategy_event_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('property_url', propertyUrl)
    .eq('snapshot_date', snapshotDate);

  return { snapshot_date: snapshotDate, rows_written: rows.length, row_count: count ?? rows.length };
}

/** Events with places left and no sheet_booked increase in last 14 days. */
export function staleSalesKeys(snapshots, diary) {
  const today = new Date().toISOString().slice(0, 10);
  const ago14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const byKey = new Map();
  for (const s of snapshots || []) {
    if (s.snapshot_date < ago14) continue;
    const arr = byKey.get(s.event_key) || [];
    arr.push(s);
    byKey.set(s.event_key, arr);
  }
  const stale = new Set();
  for (const e of diary || []) {
    if (e.left <= 0) continue;
    const arr = (byKey.get(e.eventKey) || []).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    if (arr.length < 2) continue;
    const first = arr[0];
    const last = arr[arr.length - 1];
    if (last.snapshot_date >= today.slice(0, 10) && Number(last.sheet_booked) <= Number(first.sheet_booked)) {
      stale.add(e.eventKey);
    }
  }
  return stale;
}
