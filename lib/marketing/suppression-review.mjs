/**
 * "Review and clear" for people on the permanent suppression list who are subscribed again in Squarespace.
 * One person at a time, a typed reason, logged; nothing clears automatically and nothing changes in Squarespace
 * (clearing only lets the dashboard's targeted groups include them again).
 */
import { emailHash, logRun, finishRun, selectAll } from './store.mjs';

export const RESOLVED_BY = 'Alan (dashboard, admin key)';

async function evidence(sb, email) {
  const ev = await selectAll(sb, 'sqs_email_events', 'email_id, event_type, event_at', (q) => q.eq('email', email).in('event_type', ['UNSUBSCRIBED', 'OPENED', 'CLICKED']));
  const unsub = ev.filter((e) => e.event_type === 'UNSUBSCRIBED').map((e) => e.event_at).sort().pop() || null;
  const after = (type) => new Set(ev.filter((e) => e.event_type === type && (!unsub || e.event_at > unsub)).map((e) => e.email_id)).size;
  const { count: ordersSince } = await sb.from('sqs_orders').select('order_id', { count: 'exact', head: true }).eq('customer_email', email).gt('created_on', unsub || '1900-01-01');
  return { last_unsubscribe: unsub, opens_since: after('OPENED'), clicks_since: after('CLICKED'), orders_since: ordersSince || 0, last_open: ev.filter((e) => e.event_type === 'OPENED').map((e) => e.event_at).sort().pop() || null };
}

export async function reviewList(sb) {
  const people = await selectAll(sb, 'customer_person', 'person_id, display_name, facts', (q) => q.eq('facts->>subscribed', 'true').not('facts->>suppressed', 'is', null));
  const rows = await Promise.all(people.map(async (p) => {
    const hash = emailHash(p.facts.email);
    const { data: sup } = await sb.from('marketing_suppression').select('reason, source, first_seen_at').eq('email_hash', hash).maybeSingle();
    return { person_id: p.person_id, email_hash: hash, name: p.facts.name || p.display_name, email: p.facts.email, admin: !!p.facts.admin, reason: sup?.reason || p.facts.suppressed, suppressed_since: sup?.first_seen_at || null, subscribed_now: true, ...(await evidence(sb, p.facts.email)) };
  }));
  return { people: rows.sort((a, b) => String(b.last_unsubscribe).localeCompare(String(a.last_unsubscribe))) };
}

export async function resolveOne(sb, { email_hash: hash, reason }, rebuild) {
  const note = String(reason || '').trim();
  if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) throw new Error('one person at a time: email_hash required');
  if (note.length < 10) throw new Error('type a reason (at least 10 characters)');
  const { data: row } = await sb.from('marketing_suppression').select('email_hash, resolved_at').eq('email_hash', hash).maybeSingle();
  if (!row) throw new Error('not on the suppression list');
  if (row.resolved_at) throw new Error('already cleared');
  const runId = await logRun(sb, { kind: 'suppression-review', status: 'running', host: 'dashboard' });
  const now = new Date().toISOString();
  const { error } = await sb.from('marketing_suppression').update({ resolved_at: now, resolved_by: RESOLVED_BY, resolution_note: note.slice(0, 500) }).eq('email_hash', hash).is('resolved_at', null);
  if (error) throw new Error(error.message);
  await finishRun(sb, runId, { status: 'ok', summary: { email_hash_prefix: hash.slice(0, 8), resolved_by: RESOLVED_BY, reason: note.slice(0, 200) } });
  const rebuilt = await rebuild();
  return { cleared: hash.slice(0, 8), resolved_at: now, persons: rebuilt.persons };
}
