/**
 * Ingest of Squarespace's Scheduled tab (PC collector, read-only). Only a COMPLETE read is accepted: a failed or
 * partial read posts nothing, so no schedule is released or deleted. Rows are upserted on the provider email id and
 * never deleted; one no longer listed is set to state "gone" (sent vs cancelled is decided against the Sent list).
 * Linking is by ids only: the campaign record's draft / sent id, or the snapshot's Squarespace list id. One match =
 * linked; several = ambiguous (flagged, not duplicated); none = unlinked (review queue, budgeted once). A manual link
 * set on the dashboard is kept. Changes of time, subject, lists or recipients are recorded in history (edits).
 */
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const BASES = new Set(['single_list_count', 'sum_of_lists_upper_bound', 'unknown']);
const TRACKED = ['scheduled_for', 'subject', 'mailing_list_ids', 'recipients'];

function need(cond, msg) { if (!cond) throw new Error(`unexpected collector data: ${msg}`); }

export function scheduledRow(e, readAt) {
  need(e && e.email_id && e.scheduled_for && !Number.isNaN(Date.parse(e.scheduled_for)), 'a scheduled email needs email_id and scheduled_for');
  need(Array.isArray(e.mailing_list_ids), `scheduled email ${e.email_id} needs mailing_list_ids`);
  return {
    email_id: String(e.email_id), subject: e.subject ? String(e.subject).slice(0, 300) : null, email_type: e.email_type || null,
    scheduled_for: new Date(e.scheduled_for).toISOString(), scheduled_tz: e.scheduled_tz || 'UTC',
    mailing_list_ids: e.mailing_list_ids.map(String), mailing_list_names: Array.isArray(e.mailing_list_names) ? e.mailing_list_names.map(String) : [],
    recipients: int(e.recipients), recipients_basis: BASES.has(e.recipients_basis) ? e.recipients_basis : 'unknown', collected_at: readAt
  };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const norm = (k, v) => (k === 'scheduled_for' && v ? new Date(v).toISOString() : v);

/** Field changes against the stored row (an edit made in Squarespace). */
export function changesOf(prev, row) {
  if (!prev) return [];
  return TRACKED.filter((k) => !same(norm(k, prev[k]), norm(k, row[k]))).map((k) => ({ field: k, from: prev[k] ?? null, to: row[k] ?? null }));
}

/** Link by ids: campaign draft / sent id, or a live snapshot loaded into one of the schedule's lists. */
export function linkOf(row, campaigns, exports, prev) {
  if (prev && ['manual'].includes(prev.link_basis) && ['linked', 'external'].includes(prev.link_state)) return { campaign_key: prev.campaign_key, link_state: prev.link_state, link_basis: prev.link_basis, link_candidates: prev.link_candidates || [] };
  const byId = campaigns.filter((c) => c.sqs_draft_id === row.email_id || c.sqs_email_id === row.email_id).map((c) => c.campaign_key);
  const lists = new Set(row.mailing_list_ids);
  const byList = exports.filter((x) => x.sqs_list_id && lists.has(x.sqs_list_id) && x.status !== 'cancelled' && x.campaign_key).map((x) => x.campaign_key);
  const keys = [...new Set([...byId, ...byList])];
  if (keys.length === 1) return { campaign_key: keys[0], link_state: 'linked', link_basis: [byId.length ? 'draft_id' : null, byList.length ? 'list_id' : null].filter(Boolean).join('+'), link_candidates: keys };
  return { campaign_key: null, link_state: keys.length ? 'ambiguous' : 'unlinked', link_basis: null, link_candidates: keys };
}

function mergeRow(row, prev, link, readAt, runId) {
  const changes = changesOf(prev, row);
  const back = prev?.state === 'gone';
  const events = [...(changes.length ? [{ at: readAt, event: 'edited', changes }] : []), ...(back ? [{ at: readAt, event: 'listed_again' }] : []), ...(prev ? [] : [{ at: readAt, event: 'first_seen' }])];
  return {
    ...row, ...link, state: 'scheduled', gone_at: null, run_id: runId || null,
    first_seen_at: prev?.first_seen_at || readAt, changed_at: changes.length ? readAt : prev?.changed_at || null,
    history: [...(prev?.history || []), ...events].slice(-30)
  };
}

/** Link candidates: a cancelled campaign record (and its snapshot) can no longer own a Squarespace schedule. */
export function liveCandidates(campaigns, exports) {
  const cancelled = new Set(campaigns.filter((c) => c.stage === 'cancelled').map((c) => c.campaign_key));
  return { campaigns: campaigns.filter((c) => !cancelled.has(c.campaign_key)), exports: exports.filter((x) => !cancelled.has(x.campaign_key)) };
}

async function loadContext(sb) {
  const [prev, camps, exps] = await Promise.all([
    sb.from('sqs_scheduled_emails').select('*'),
    sb.from('strategy_campaigns').select('campaign_key, stage, sqs_draft_id, sqs_email_id'),
    sb.from('marketing_segment_exports').select('export_id, campaign_key, sqs_list_id, status').not('sqs_list_id', 'is', null)
  ]);
  for (const [name, r] of [['sqs_scheduled_emails', prev], ['strategy_campaigns', camps], ['marketing_segment_exports', exps]]) if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return { prev: new Map((prev.data || []).map((p) => [p.email_id, p])), ...liveCandidates(camps.data || [], exps.data || []) };
}

/** One complete read of the Scheduled tab → upsert, link, edits; schedules no longer listed → gone (kept). */
export async function ingestScheduled(sb, d, runId) {
  need(d && d.complete === true && Array.isArray(d.emails), 'scheduled needs complete: true and an emails list (partial reads are never posted)');
  const readAt = d.read_at && !Number.isNaN(Date.parse(d.read_at)) ? new Date(d.read_at).toISOString() : new Date().toISOString();
  const rows = d.emails.map((e) => scheduledRow(e, readAt));
  need(new Set(rows.map((r) => r.email_id)).size === rows.length, 'duplicate scheduled email ids');
  const ctx = await loadContext(sb);
  const upserts = rows.map((r) => mergeRow(r, ctx.prev.get(r.email_id), linkOf(r, ctx.campaigns, ctx.exports, ctx.prev.get(r.email_id)), readAt, runId));
  if (upserts.length) {
    const { error } = await sb.from('sqs_scheduled_emails').upsert(upserts, { onConflict: 'email_id' });
    if (error) throw new Error(`sqs_scheduled_emails: ${error.message}`);
  }
  const listed = new Set(rows.map((r) => r.email_id));
  const gone = [...ctx.prev.values()].filter((p) => p.state === 'scheduled' && !listed.has(p.email_id));
  for (const p of gone) {
    const { error } = await sb.from('sqs_scheduled_emails').update({ state: 'gone', gone_at: readAt, history: [...(p.history || []), { at: readAt, event: 'no_longer_scheduled' }].slice(-30) }).eq('email_id', p.email_id).eq('state', 'scheduled');
    if (error) throw new Error(`sqs_scheduled_emails: ${error.message}`);
  }
  return { scheduled: rows.length, edited: upserts.filter((u) => u.changed_at === readAt).length, gone: gone.length, linked: upserts.filter((u) => u.link_state === 'linked').length, ambiguous: upserts.filter((u) => u.link_state === 'ambiguous').length, unlinked: upserts.filter((u) => u.link_state === 'unlinked').length };
}
