/**
 * Daily strategy_event_snapshots writer + pace helpers.
 */
import { buildStrategyDiary } from './strategy-diary.mjs';

const PROP = 'https://www.alanranger.com';
const SNAPSHOT_EPOCH = '2026-10-07';

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

function addYmd(ymd, days) {
  const t = Date.parse(`${ymd}T12:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
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

function diaryToRows(diary, propertyUrl, snapshotDate, extraRaw = {}) {
  return diary.map((e) => ({
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
    raw: { rag: e.rag, status: e.status, mismatch: e.mismatch, ...extraRaw }
  }));
}

async function replaceSnapshotDay(supabase, propertyUrl, snapshotDate, rows) {
  if (!rows.length) {
    throw new Error(`strategy_snapshot_empty_diary:${snapshotDate}`);
  }
  await supabase.from('strategy_event_snapshots')
    .delete()
    .eq('property_url', propertyUrl)
    .eq('snapshot_date', snapshotDate);
  const { error } = await supabase.from('strategy_event_snapshots').insert(rows);
  if (error) throw error;
  return rows.length;
}

/**
 * Write today's London snapshot from booking-sheet workshop/course rows.
 * @param {{ fillMissingDays?: boolean }} [opts]
 */
export async function runStrategyEventSnapshots(supabase, propertyUrl = PROP, opts = {}) {
  const snapshotDate = londonYmd();
  const fillMissingDays = opts.fillMissingDays !== false;
  console.log('[strategy-event-snapshots]', snapshotDate, propertyUrl, { fillMissingDays });

  const [workshops, courses, actions] = await Promise.all([
    pageAll(supabase, 'booking_sheet_workshop_attendees', 'event_start, theme_location, client_name, is_multi_day, paid', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_course_attendees', 'from_date, to_date, event_name, client_name, is_beginners, is_booking_row', 'property_url', propertyUrl),
    supabase.from('strategy_quarter_actions').select('id, label, is_ticked, due_week_start').eq('property_url', propertyUrl)
      .then((r) => r.data || [])
  ]);
  const { diary } = await buildStrategyDiary({ workshops, courses, actions, snapshots: [] });
  const todayRows = diaryToRows(diary, propertyUrl, snapshotDate);
  const rowsWritten = await replaceSnapshotDay(supabase, propertyUrl, snapshotDate, todayRows);

  const filled = [];
  if (fillMissingDays) {
    const { data: existing } = await supabase.from('strategy_event_snapshots')
      .select('snapshot_date')
      .eq('property_url', propertyUrl)
      .gte('snapshot_date', SNAPSHOT_EPOCH)
      .gte('snapshot_date', addYmd(snapshotDate, -7));
    const have = new Set((existing || []).map((r) => r.snapshot_date));
    for (let i = 1; i <= 7; i++) {
      const d = addYmd(snapshotDate, -i);
      if (d < SNAPSHOT_EPOCH || have.has(d)) continue;
      // Best-effort catch-up: use current sheet counts for the missed calendar day
      // so +wk / stale checks have a continuous series (tagged backfilled).
      const gapRows = diaryToRows(diary, propertyUrl, d, { backfilled: true, backfilled_from: snapshotDate });
      await replaceSnapshotDay(supabase, propertyUrl, d, gapRows);
      filled.push(d);
      have.add(d);
    }
  }

  const { count } = await supabase.from('strategy_event_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('property_url', propertyUrl)
    .eq('snapshot_date', snapshotDate);

  return {
    snapshot_date: snapshotDate,
    rows_written: rowsWritten,
    row_count: count ?? rowsWritten,
    filled_missing_dates: filled
  };
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
