/**
 * Holds created by the pre-send sense-check (brief-gate.js). While a week has an unreleased hold, the brief is
 * never sent by any path (Monday refresh, 20:00 rescue, manual); Alan gets one short note instead. "Send anyway"
 * (dashboard) releases the hold and sends the brief as built.
 */
import { loadCurrentFindings } from '../fault-monitor/store.js';
import { assessBriefGate, loadBriefGateInputs } from './brief-gate.js';

const HOLDS = 'ceo_brief_holds';

export async function activeHold(sb, weekStart) {
  const { data, error } = await sb.from(HOLDS).select('*').eq('week_start', weekStart).is('released_at', null).limit(1);
  if (error) throw new Error(`brief_hold_read:${error.message}`);
  return data?.[0] || null;
}

async function createHold(sb, { weekStart, propertyUrl, gate }) {
  const existing = await activeHold(sb, weekStart);
  if (existing) return existing;
  const { data, error } = await sb.from(HOLDS).insert({
    week_start: weekStart, property_url: propertyUrl, failures: gate.failures, checks: gate.checks,
  }).select('*').single();
  if (error) throw new Error(`brief_hold_create:${error.message}`);
  return data;
}

export async function markNoteSent(sb, id) {
  const { error } = await sb.from(HOLDS).update({ note_sent_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`brief_hold_note:${error.message}`);
}

export async function releaseHold(sb, weekStart, by) {
  const { data, error } = await sb.from(HOLDS).update({ released_at: new Date().toISOString(), released_by: by })
    .eq('week_start', weekStart).is('released_at', null).select('*');
  if (error) throw new Error(`brief_hold_release:${error.message}`);
  return data?.[0] || null;
}

/** The sense-check step: assess this week and open a hold when anything fails. */
export async function runBriefSenseCheck(sb, { weekStart, propertyUrl, steps }) {
  const { current, run } = await loadCurrentFindings(sb);
  const inputs = await loadBriefGateInputs(sb, {
    propertyUrl, weekStart, steps, latestFullRunStart: run?.started_at || null,
    shownFindings: current.filter((f) => f.severity === 'red' || f.severity === 'amber'),
  });
  const gate = assessBriefGate(inputs);
  const hold = gate.held ? await createHold(sb, { weekStart, propertyUrl, gate }) : null;
  return { ...gate, hold_id: hold?.id || null };
}

export function renderHeldNote(weekStart, ff = 'font-family:Arial,Helvetica,sans-serif') {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;padding:24px;${ff};color:#1d2939;font-size:15px;line-height:1.6;">
<p style="margin:0 0 12px;"><b>This week's brief is held while figures are checked.</b></p>
<p style="margin:0 0 12px;">The Monday sense-check found figures that need a second look before they are sent (week of ${weekStart}). No figures are included here on purpose.</p>
<p style="margin:0;">If you want it now, open the dashboard and press <b>Send anyway</b> on the held-brief banner.</p>
</div></body></html>`;
}
