/**
 * "Retired from promotion" per event (QUESTION-2026-11-09 (q) item 11): Alan-set rows in strategy_event_promotion_flags.
 * A flagged event stays in stock and on sale; it is only dropped from recommendations (Remedy lever 1, monthly "Events to
 * push", the Strategy push list) and campaign pushes. Read-only here; keyed like strategy_event_overrides.
 */
import { eventKeyOf } from './strategy-campaigns.mjs';

export async function loadRetiredFromPromotion(supabase, propertyUrl) {
  const { data, error } = await supabase.from('strategy_event_promotion_flags')
    .select('event_key, event_date, event_title, reason, set_by, set_at')
    .eq('property_url', propertyUrl).eq('retired_from_promotion', true).limit(2000);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Marks matching diary rows in place (`retired_from_promotion: true`); returns how many rows matched. */
export function markRetired(rows, flags) {
  const keys = new Set((flags || []).map((f) => f.event_key));
  let matched = 0;
  for (const e of rows || []) {
    if (!keys.has(eventKeyOf(e))) continue;
    e.retired_from_promotion = true;
    matched += 1;
  }
  return matched;
}

/** Loads + marks; a failed read is reported (nothing is retired), never breaks the summary. */
export async function softRetiredFromPromotion(supabase, propertyUrl, rows) {
  try {
    const flags = await loadRetiredFromPromotion(supabase, propertyUrl);
    return { flags, matched: markRetired(rows, flags), error: null };
  } catch (e) {
    return { flags: [], matched: 0, error: e?.message || String(e) };
  }
}

/** Campaign overrides with every retired event read as "don't promote" (an existing override row keeps its offer fields). */
export function withRetiredOverrides(overrides, flags) {
  const out = { ...(overrides || {}) };
  for (const f of flags || []) out[f.event_key] = { ...(out[f.event_key] || { event_key: f.event_key, event_date: f.event_date, event_title: f.event_title }), promote_mode: 'dont_promote', retired_from_promotion: true };
  return out;
}
