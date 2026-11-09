/**
 * Academy 90-day trial cohort for Strategy (initiatives with focus.data_source = 'academy_trial_history').
 * Read server-side as lib/marketing/rebuild.mjs does: the Academy Supabase project's academy_trial_history
 * (ACADEMY_SUPABASE_URL + service key); when that read is unavailable, the copy the last rebuild stored on
 * customer_person.facts.academy_detail, labelled as such. Counts only: no member ids, names or emails leave here.
 */
import { selectAll } from './marketing/store.mjs';

export const TRIAL_SOURCE = 'academy_trial_history';
const DAY = 864e5;
const shift = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * DAY).toISOString().slice(0, 10);

/** Trials started in the last `days` (converted so far) and the last complete cohort (started days+1 … 2×days ago). */
export function trialCohort(rows, today, days = 90) {
  const win = (from, to) => {
    const inWin = rows.filter((r) => r.start && r.start >= from && r.start <= to);
    const converted = inWin.filter((r) => r.converted).length;
    return { from, to, started: inWin.length, converted, rate: inWin.length ? Math.round((converted / inWin.length) * 1000) / 10 : null };
  };
  return { days, recent: win(shift(today, -(days - 1)), today), complete: win(shift(today, -(2 * days - 1)), shift(today, -days)) };
}

async function direct() {
  const url = process.env.ACADEMY_SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/academy_trial_history?select=trial_start_at,converted_at&limit=10000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return null;
  return (await r.json()).map((t) => ({ start: String(t.trial_start_at || '').slice(0, 10) || null, converted: String(t.converted_at || '').slice(0, 10) || null }));
}
async function rebuildCopy(supabase) {
  const rows = await selectAll(supabase, 'customer_person', 'person_id, detail:facts->academy_detail', (q) => q.not('facts->academy_detail->>trial_start', 'is', null));
  return rows.map((p) => ({ start: p.detail?.trial_start || null, converted: p.detail?.converted || null }));
}

/** { source, via, cohort } or { error }; never throws (a failure never zeroes the line). */
export async function loadAcademyCohort(supabase, today) {
  try {
    const live = await direct();
    if (live) return { source: TRIAL_SOURCE, via: 'Academy Supabase (read-only)', cohort: trialCohort(live, today) };
    return { source: TRIAL_SOURCE, via: 'copy stored by the last customer rebuild', cohort: trialCohort(await rebuildCopy(supabase), today) };
  } catch (e) {
    return { source: TRIAL_SOURCE, error: e?.message || String(e) };
  }
}

const dm = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Measure lines for the initiative card. */
export function cohortLines(ac) {
  if (!ac) return [];
  if (ac.error) return [{ label: '90-day trial cohort', value: `unavailable: ${ac.error}`, sub: TRIAL_SOURCE }];
  const { recent, complete } = ac.cohort;
  return [
    { label: '90-day trial cohort (last complete)', value: `${complete.started} trials started ${dm(complete.from)}–${dm(complete.to)} · ${complete.converted} converted${complete.rate == null ? '' : ` (${complete.rate}%)`}`, sub: `${TRIAL_SOURCE} · ${ac.via}` },
    { label: 'Trials in the last 90 days', value: `${recent.started} started since ${dm(recent.from)} · ${recent.converted} converted so far (cohort still open)`, sub: `${TRIAL_SOURCE} · ${ac.via}` }
  ];
}
