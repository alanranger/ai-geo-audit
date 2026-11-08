/**
 * Ingest from the Squarespace email-report collector on Alan's PC (admin key). The collector reads the same internal
 * JSON the Squarespace report pages use; anything with an unexpected shape is rejected here so it shows as a failed /
 * stale run, never as zero. Re-sending the same data is harmless (upserts on natural keys).
 */
import { enqueueIngested } from './collect-queue.mjs';
import { emailHash, normEmail, upsertChunks } from './store.mjs';

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const EVENT_TYPES = new Set(['DELIVERED', 'OPENED', 'CLICKED', 'UNSUBSCRIBED']);

function need(cond, msg) { if (!cond) throw new Error(`unexpected collector data: ${msg}`); }

async function meter(sb, d, runId) {
  need(int(d.quota) > 0 && int(d.used) >= 0 && d.reset_at, 'meter needs quota, used and reset_at');
  const row = { captured_at: d.captured_at || new Date().toISOString(), cycle_reset_at: d.reset_at, quota_emails: int(d.quota), used_emails: int(d.used), blast_campaigns_used: int(d.blast_campaigns), is_sending_disabled: !!d.sending_disabled, run_id: runId || null };
  const { error } = await sb.from('sqs_send_meter').insert(row);
  if (error) throw new Error(`sqs_send_meter: ${error.message}`);
  return { meter: row };
}

function campaignRow(c) {
  need(c.email_id && c.sent_on, 'campaign needs email_id and sent_on');
  need(int(c.message_count) != null && int(c.delivered) != null, `campaign ${c.email_id} needs message_count and delivered`);
  return {
    email_id: String(c.email_id), subject: c.subject ? String(c.subject).slice(0, 300) : null, sent_on: c.sent_on, email_type: c.email_type || null,
    mailing_list_names: Array.isArray(c.mailing_list_names) ? c.mailing_list_names.map(String) : null, message_count: int(c.message_count),
    delivered: int(c.delivered), opened: int(c.opened), clicked: int(c.clicked), unsubscribed: int(c.unsubscribed),
    url_clicks: Array.isArray(c.url_clicks) ? c.url_clicks : null, collected_at: new Date().toISOString()
  };
}

async function campaigns(sb, d) {
  need(Array.isArray(d.campaigns), 'campaigns must be a list');
  const rows = d.campaigns.map(campaignRow);
  await upsertChunks(sb, 'sqs_email_campaigns', rows, 'email_id');
  const queue = await enqueueIngested(sb, rows).catch((e) => ({ queued: 0, queue_error: String(e?.message || e) }));
  return { campaigns: rows.length, collect_queued: queue.queued, ...(queue.queue_error ? { queue_error: queue.queue_error } : {}) };
}

function eventRow(emailId, e) {
  need(EVENT_TYPES.has(e.event_type) && e.recipient_id, 'event needs event_type and recipient_id');
  return { email_id: emailId, event_type: e.event_type, recipient_id: String(e.recipient_id), url: e.url ? String(e.url).slice(0, 500) : '', email: normEmail(e.email), event_count: int(e.event_count), event_at: e.event_at || null, collected_at: new Date().toISOString() };
}

/** One campaign's recipient events; `complete` + counts let the server check every list was read to the end. */
async function events(sb, d) {
  need(d.email_id && Array.isArray(d.events), 'events need email_id and a list');
  const rows = [...new Map(d.events.map((e) => eventRow(String(d.email_id), e)).map((r) => [`${r.event_type}|${r.recipient_id}|${r.url}`, r])).values()];
  await upsertChunks(sb, 'sqs_email_events', rows, 'email_id,event_type,recipient_id,url', 1000);
  const unsub = rows.filter((r) => r.event_type === 'UNSUBSCRIBED' && r.email).map((r) => ({ email_hash: emailHash(r.email), reason: 'unsubscribed_from_campaign', source: 'email_report_collector', at: r.event_at }));
  if (unsub.length) {
    await sb.from('marketing_suppression').upsert(unsub.map(({ at, ...u }) => u), { onConflict: 'email_hash', ignoreDuplicates: true });
    await reSuppressAfterReview(sb, unsub);
  }
  if (d.complete) await sb.from('sqs_email_campaigns').update({ events_complete: true, events_collected_at: new Date().toISOString() }).eq('email_id', String(d.email_id));
  return { events: rows.length, unsubscribes: unsub.length };
}

/** An unsubscribe recorded after a review cleared someone puts the block back (a clearance never hides a new one). */
export async function reSuppressAfterReview(sb, unsub) {
  const hashes = [...new Set(unsub.map((u) => u.email_hash))];
  const { data } = await sb.from('marketing_suppression').select('email_hash, resolved_at').in('email_hash', hashes).not('resolved_at', 'is', null);
  const later = (data || []).filter((row) => unsub.some((u) => u.email_hash === row.email_hash && u.at && u.at > row.resolved_at));
  for (const row of later) {
    await sb.from('marketing_suppression').update({ resolved_at: null, resolved_by: null, reason: 'unsubscribed_again_after_review', last_seen_at: new Date().toISOString() }).eq('email_hash', row.email_hash);
  }
  return later.length;
}

/** Only the fields a call sends are changed (a finishing call must not blank the progress counts). */
function runPatch(d) {
  const patch = { heartbeat_at: new Date().toISOString() };
  if (d.items_done != null) patch.items_done = int(d.items_done);
  if (d.items_total != null) patch.items_total = int(d.items_total);
  if (d.checkpoint) patch.checkpoint = d.checkpoint;
  if (d.session_ok != null) patch.session_ok = d.session_ok;
  return patch;
}

async function run(sb, d) {
  if (!d.run_id) {
    const { data, error } = await sb.from('marketing_collector_runs').insert({ kind: d.kind || 'collector', status: 'running', host: d.host || null, items_total: int(d.items_total), heartbeat_at: new Date().toISOString() }).select('run_id').single();
    if (error) throw new Error(error.message);
    return { run_id: data.run_id };
  }
  const patch = runPatch(d);
  if (d.status && d.status !== 'running') Object.assign(patch, { status: d.status, finished_at: new Date().toISOString(), summary: d.summary || null, error: d.error ? String(d.error).slice(0, 500) : null });
  const { error } = await sb.from('marketing_collector_runs').update(patch).eq('run_id', d.run_id);
  if (error) throw new Error(error.message);
  return { run_id: d.run_id };
}

const KINDS = { meter: (sb, d) => meter(sb, d, d.run_id), campaigns, events, run };

export async function ingest(sb, body) {
  const fn = KINDS[body?.kind_of];
  if (!fn) throw new Error('kind_of must be meter, campaigns, events or run');
  return fn(sb, body.data || {});
}
