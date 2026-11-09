/**
 * One-shot sends of the brief ("Send anyway" with an onceKey, e.g. an approved corrected resend): the first request
 * claims system_maintenance_state key `ceo_brief_once:<week>:<onceKey>` (primary key, so a second insert fails) and
 * records the provider message id; any later request with the same key is refused without sending.
 */
const TABLE = 'system_maintenance_state';
const KEY_RE = /^[a-z0-9-]{3,60}$/;

export function onceStateKey(weekStart, onceKey) {
  return `ceo_brief_once:${weekStart}:${onceKey}`;
}

export function validOnceKey(onceKey) {
  return KEY_RE.test(String(onceKey || ''));
}

/** @returns {{ claimed: boolean, key: string, prior?: object|null }} */
export async function claimOnce(sb, weekStart, onceKey, now = new Date().toISOString()) {
  const key = onceStateKey(weekStart, onceKey);
  const { error } = await sb.from(TABLE).insert({
    key, state: 'running', started_at: now, last_details: { week_start: weekStart, once_key: onceKey, claimed_at: now },
  });
  if (!error) return { claimed: true, key };
  const { data } = await sb.from(TABLE).select('state, started_at, finished_at, last_details').eq('key', key).maybeSingle();
  return { claimed: false, key, prior: data || null, error: data ? null : error.message };
}

/** What the claim row keeps about the send (never the html). */
const sentOk = (report, send) => report?.mode === 'report' && send.ok !== false && !send.dryRun;

function providerFields(send) {
  return { to: send.to || null, subject: send.subject || null, provider: send.provider || null, message_id: send.id || null };
}

export function sendRecord(report, now = new Date().toISOString()) {
  const send = report?.send || {};
  const ok = sentOk(report, send);
  return { ok, sent_at: ok ? now : null, mode: report?.mode || null, ...providerFields(send), snapshot_id: report?.snapshot?.id || null };
}

export async function finishOnce(sb, key, claimDetails, record, now = new Date().toISOString()) {
  const { error } = await sb.from(TABLE).update({
    state: record.ok ? 'done' : 'failed', finished_at: now, last_success_at: record.ok ? now : null,
    last_details: { ...claimDetails, ...record },
  }).eq('key', key);
  if (error) throw new Error(`send_once_record:${error.message}`);
}
