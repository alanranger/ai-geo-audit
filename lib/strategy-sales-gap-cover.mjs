/**
 * Sales gap "Can we hit the target? Realistic cover by month" (QUESTION-2026-11-09 (v), Alan approved 19:13).
 * Pure functions over the month tiles (lib/strategy-sales-gap.mjs) and the prospects aggregates (lib/strategy-prospects.mjs):
 *  - enquiries about a dated event (prospect_enquiry.relates_to_event) count under Dated events in their expected cash
 *    month, capped per event at its places left after likely bookings × price (never beyond the event's stock);
 *  - realistic total = likely + dated-event enquiries + normal non-dated (adjusted) + pipeline + committed + cash to collect;
 *  - still to find = still to sell − realistic total (a surplus is "covered"); the rolling figure = the sum of the
 *    monthly shortfalls only, so a later surplus never pays an earlier month;
 *  - enquiries without an expected month are undated potential: shown, never counted.
 * No names: enquiries arrive as { event_key, month, weighted } aggregates only.
 */
import { eventKeyOf } from './strategy-campaigns.mjs';

const sum = (list, f) => list.reduce((a, x) => a + (Number(f(x)) || 0), 0);
/** £ an event can still take from enquiries: places left after its likely bookings × price (0 when full). */
export const eventHeadroom = (e) => Math.max(0, (Number(e.left) - Number(e.likely || 0)) * Number(e.price));

const words = (s) => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['and', 'the', 'workshop', 'workshops', 'photography', 'photographic', 'photo'].includes(w)));
/**
 * The event on sale an enquiry is about: the exact key (event date | event page path); else, because the key may name
 * the PRODUCT page, the event on sale that date (the only one, or the one whose title shares the most words with the
 * page slug). null = not on sale (e.g. a private workshop).
 */
export function eventFor(key, byKey, evs) {
  if (byKey.has(key)) return byKey.get(key);
  const [date, path] = String(key).split('|');
  const same = (evs || []).filter((e) => e.date === date);
  if (same.length < 2) return same[0] || null;
  const slug = words(String(path).split('/').pop());
  const score = (e) => [...words(e.title)].filter((w) => slug.has(w)).length;
  const best = [...same].sort((a, b) => score(b) - score(a));
  return score(best[0]) > score(best[1]) ? best[0] : null;
}
/**
 * Dated-event enquiries by cash month, capped per event (earliest cash month first). An enquiry whose event is not on
 * sale (e.g. a private workshop) is counted as weighted and reported as unmatched (no stock to cap against).
 */
export function datedEnquiries(evs, rows) {
  const byKey = new Map((evs || []).map((e) => [eventKeyOf(e), e]));
  const left = new Map();
  const out = { by_month: {}, by_event: {}, weighted_gbp: 0, counted_gbp: 0, capped_gbp: 0, count: 0, unmatched_count: 0 };
  for (const r of [...(rows || [])].sort((a, b) => String(a.month).localeCompare(String(b.month)))) {
    const ev = eventFor(r.event_key, byKey, evs);
    if (ev && !left.has(ev.key)) left.set(ev.key, eventHeadroom(ev));
    const w = Number(r.weighted) || 0;
    const counted = ev ? Math.min(w, left.get(ev.key)) : w;
    if (ev) {
      left.set(ev.key, left.get(ev.key) - counted);
      out.by_event[ev.key] = (out.by_event[ev.key] || 0) + counted;
    }
    out.by_month[r.month] = (out.by_month[r.month] || 0) + counted;
    Object.assign(out, { weighted_gbp: out.weighted_gbp + w, counted_gbp: out.counted_gbp + counted, capped_gbp: out.capped_gbp + (w - counted), count: out.count + 1, unmatched_count: out.unmatched_count + (ev ? 0 : 1) });
  }
  return out;
}

export const COVER_PARTS = ['likely', 'dated_event', 'normal', 'pipeline', 'committed', 'cash_to_collect'];
/** One month: each cover line, the realistic total and the shortfall (still to find) or surplus. */
export function coverMonth(t, cash) {
  const parts = { likely: t.likely || 0, dated_event: t.dated_event_gbp || 0, normal: t.normal_adjusted || 0, pipeline: t.pipeline_weighted || 0, committed: t.committed_gbp || 0, cash_to_collect: cash || 0 };
  const total = sum(COVER_PARTS, (k) => parts[k]);
  const still = t.still_to_sell || 0;
  return { key: t.key, label: t.label, still_to_sell: still, ...parts, total, still_to_find: Math.max(0, still - total), surplus: Math.max(0, total - still) };
}
/** Undated potential: open enquiries (weighted, after the factor) with no expected month: shown, never counted. */
function undatedOf(open) {
  if (!open || open.error) return { gbp: 0, count: 0, counted: false };
  return { gbp: Number(open.undated_gbp ?? open.undated_weighted) || 0, count: Number(open.undated_count ?? open.no_cash_month) || 0, counted: false };
}
/** The table: three months + the rolling column (sums; still to find = the sum of shortfalls only) + undated potential. */
export function realisticCover(tiles, x) {
  const cash = Object.fromEntries((x.prospects?.cash_to_collect?.by_month || []).map((m) => [m.key, Number(m.gbp) || 0]));
  const months = tiles.map((t) => coverMonth(t, cash[t.key]));
  const rolling = Object.fromEntries(['still_to_sell', ...COVER_PARTS, 'total', 'still_to_find'].map((k) => [k, sum(months, (m) => m[k])]));
  return {
    months, rolling: { ...rolling, key: 'rolling', label: 'Rolling 3 months', surplus_not_carried: sum(months, (m) => m.surplus) },
    undated: undatedOf(x.pipeline_open), pipeline_error: x.pipeline_open?.error || null
  };
}
