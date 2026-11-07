/**
 * Marketing data health for the Monday brief: anything stale, failed or never run is listed (counts only, no names).
 * A PC that was asleep or off shows as a stale collector, never as current data.
 */
import { STALE_HOURS } from './meter.mjs';
import { latestCollectorRun } from './overview.mjs';
import { reconcileSends } from './list-load.mjs';

const SYNC_STEPS = ['profiles', 'orders', 'postcodes', 'customers'];
const ageH = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 3600000 : Infinity);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'never');

export function runAlert(label, r, hint) {
  if (!r) return `${label}: never run${hint ? ` (${hint})` : ''}`;
  if (r.status !== 'ok') return `${label}: ${r.status} at ${when(r.finished_at || r.heartbeat_at)}${r.error ? ` — ${String(r.error).slice(0, 120)}` : ''}`;
  if (ageH(r.finished_at) > STALE_HOURS) return `${label}: stale, last ran ${when(r.finished_at)}${hint ? ` (${hint})` : ''}`;
  return null;
}

export async function marketingAlerts(sb) {
  const { data: runs } = await sb.from('marketing_collector_runs').select('kind, status, started_at, finished_at, heartbeat_at, error').order('started_at', { ascending: false }).limit(200);
  const latest = {};
  for (const r of runs || []) if (!latest[r.kind]) latest[r.kind] = r;
  const out = SYNC_STEPS.map((s) => runAlert(`Squarespace sync (${s})`, latest[`sync:${s}`])).filter(Boolean);
  const collector = runAlert('Email-report collector on Alan\'s PC', latestCollectorRun(runs || []), 'PC asleep/off, or run npm run marketing:collector-login once');
  if (collector) out.push(collector);
  const { data: meter } = await sb.from('sqs_send_meter').select('captured_at').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  if (!meter || ageH(meter.captured_at) > STALE_HOURS) out.push(`Send meter: ${meter ? `stale, last read ${when(meter.captured_at)}` : 'never read'}`);
  const { count } = await sb.from('customer_person').select('person_id', { count: 'exact', head: true }).eq('facts->>subscribed', 'true').not('facts->>suppressed', 'is', null);
  if (count > 0) out.push(`${count} suppressed contact(s) show as subscribed again in Squarespace — check before any send`);
  return [...out, ...(await listAlerts(sb))];
}

/** Lists blocked by the after-import check, and campaigns that reached people outside the checked audience (tests excluded). */
async function listAlerts(sb) {
  const out = [];
  const { data: blocked } = await sb.from('marketing_segment_exports').select('list_name, load_result').eq('status', 'blocked_do_not_send').eq('is_test', false);
  for (const b of blocked || []) out.push(`List "${b.list_name}" is BLOCKED — the import switched consent on for ${b.load_result?.flips || '?'} person(s); do not send`);
  const rec = await reconcileSends(sb);
  for (const r of rec.rows.filter((x) => x.flagged)) out.push(`Campaign "${r.subject}" (${r.sent_on}) reached ${r.flagged} person(s) outside the checked audience for "${r.list_name}"`);
  return out;
}
