/**
 * Collect after every send (8 Nov 2026). When a send is recorded, the email-report collector is asked to run on
 * Alan's PC about 15 minutes, 24 hours and 72 hours after the send so opens and clicks build up; the 05:40 daily run
 * stays. Rows live in public.marketing_collect_requests (one per campaign + slot, so re-recording a send is harmless).
 *
 *   server (api/aigeo/marketing.js): enqueue* from the send hooks · nextRequests (GET collect-next) · finishRequests
 *     (POST collect-done) · manualRequest (POST collect-request) · listRequests (GET collect-queue)
 *   PC (collector.mjs --jobs, every 5 min): collectQueueJob runs the normal read-only daily collector once for
 *     everything due, reports back, then asks for the customer rebuild so the new events reach the filters.
 *
 * A due row is skipped when its campaign was already collected after the due time (the daily run got there first).
 * A campaign is only marked done when the run left it events_complete with a fresh events_collected_at.
 */
import { spawn } from 'node:child_process';

export const SLOTS = [['15m', 15 * 60000], ['24h', 24 * 3600000], ['72h', 72 * 3600000]];
export const MAX_ATTEMPTS = 6;
const RETRY_MS = 10 * 60000;
const STALE_MS = 30 * 60000;
const BUSY_MS = 15 * 60000;
const MAX_AGE_MS = 7 * 86400000;
/** The report read refreshes 45 days of campaigns daily; only sends from the last 4 days are queued from it. */
export const INGEST_AGE_MS = 4 * 86400000;
const TABLE = 'marketing_collect_requests';
const COLLECTOR_KINDS = ['collector', 'collector:backfill'];
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Rows for one send, due 15 min / 24 h / 72 h after it. A date-only or missing send time counts from now. */
export function requestRows({ email_id: emailId, campaign_key: key, sent_at: sentAt, source }, nowIso, maxAgeMs = MAX_AGE_MS) {
  if (!emailId && !key) return [];
  const now = ms(nowIso);
  const sent = ms(sentAt);
  if (sent != null && now - sent > maxAgeMs) return [];
  const base = sent != null && String(sentAt).length > 10 ? sent : now;
  return SLOTS.map(([slot, after]) => ({ email_id: emailId ? String(emailId) : null, campaign_key: key ? String(key) : null, slot, due_at: new Date(base + after).toISOString(), source: source || null }));
}

async function insertNew(sb, rows) {
  if (!rows.length) return { queued: 0 };
  const { data, error } = await sb.from(TABLE).upsert(rows, { onConflict: 'target,slot', ignoreDuplicates: true }).select('slot, due_at');
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return { queued: (data || []).length, due: (data || []).map((r) => `${r.slot} ${r.due_at}`) };
}

export const enqueueCollection = (sb, req, nowIso = new Date().toISOString()) => insertNew(sb, requestRows(req, nowIso));

/** Report read (collector ingest): every campaign sent in the last 4 days gets its slots (existing ones untouched). */
export function enqueueIngested(sb, campaigns, nowIso = new Date().toISOString()) {
  const rows = campaigns.flatMap((c) => requestRows({ email_id: c.email_id, sent_at: c.sent_on, source: 'collector-ingest' }, nowIso, INGEST_AGE_MS));
  return insertNew(sb, rows);
}

/** A Squarespace email linked to a campaign record: timed from the collected send time when the report row exists. */
export async function enqueueForEmail(sb, { email_id: emailId, campaign_key: key = null, source }, nowIso = new Date().toISOString()) {
  const { data } = await sb.from('sqs_email_campaigns').select('sent_on, campaign_key').eq('email_id', String(emailId)).maybeSingle();
  return enqueueCollection(sb, { email_id: String(emailId), campaign_key: key || data?.campaign_key || null, sent_at: data?.sent_on || null, source }, nowIso);
}

/** A campaign record moved to "sent" or given send evidence (strategy-campaigns.js hook). */
export async function enqueueForCampaignRecord(sb, { property_url: propertyUrl, campaign_key: key }, source = 'campaign-record', nowIso = new Date().toISOString()) {
  let q = sb.from('strategy_campaigns').select('campaign_key, sqs_email_id, sent_on, stage').eq('campaign_key', String(key || ''));
  if (propertyUrl) q = q.eq('property_url', propertyUrl);
  const { data } = await q.maybeSingle();
  if (!data || (data.stage !== 'sent' && !data.sqs_email_id)) return { queued: 0 };
  if (data.sqs_email_id) return enqueueForEmail(sb, { email_id: data.sqs_email_id, campaign_key: data.campaign_key, source }, nowIso);
  return enqueueCollection(sb, { campaign_key: data.campaign_key, sent_at: data.sent_on, source }, nowIso);
}

/** "Collect now" from the dashboard / handoff: a manual slot due at once (re-queued if it ran before). */
export async function manualRequest(sb, b, nowIso = new Date().toISOString()) {
  const emailId = b.email_id ? String(b.email_id) : null;
  const key = b.campaign_key ? String(b.campaign_key).slice(0, 300) : null;
  if (emailId && !ID_RE.test(emailId)) throw new Error('email_id is not a Squarespace email id');
  if (!emailId && !key) throw new Error('give email_id or campaign_key');
  const row = { email_id: emailId, campaign_key: key, slot: 'manual', due_at: nowIso, status: 'queued', source: 'manual', attempts: 0, claimed_at: null, finished_at: null, result: null, error: null };
  const { error } = await sb.from(TABLE).upsert(row, { onConflict: 'target,slot' });
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const timed = emailId ? await enqueueForEmail(sb, { email_id: emailId, campaign_key: key, source: 'manual' }, nowIso) : { queued: 0 };
  return { queued: 1 + timed.queued, due_now: nowIso, note: 'Alan\'s PC checks every 5 minutes' };
}

/* ---------- claiming due requests (GET collect-next) ---------- */

const londonHm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

/** Don't open the collector profile while another collector run holds it or the 05:40 daily run is about to. */
export function waitReason(nowIso, running) {
  const beat = running ? ms(running.heartbeat_at || running.started_at) : null;
  if (beat != null && ms(nowIso) - beat < BUSY_MS) return 'a collector run is already in progress';
  const hm = londonHm(nowIso);
  return hm >= '05:30' && hm < '05:50' ? 'the 05:40 daily collector run is due' : null;
}

/** Split due requests: skip those already collected after their due time, serve the rest. */
export function triage(reqs, { campaigns, lastOkRunAt }) {
  const serve = [];
  const skip = [];
  for (const r of reqs) {
    const c = r.email_id ? campaigns.get(r.email_id) : null;
    const at = r.email_id ? (c?.events_complete ? c.events_collected_at : null) : lastOkRunAt;
    const done = ms(at) != null && ms(at) >= ms(r.due_at);
    (done ? skip : serve).push({ ...r, collected_at: at || null });
  }
  return { serve, skip };
}

const COLS = 'request_id, email_id, campaign_key, slot, due_at, status, attempts, claimed_at';

async function dueRequests(sb, nowIso) {
  const queued = await sb.from(TABLE).select(COLS).eq('status', 'queued').lte('due_at', nowIso).order('due_at').limit(50);
  const stale = await sb.from(TABLE).select(COLS).eq('status', 'running').lt('claimed_at', new Date(ms(nowIso) - STALE_MS).toISOString()).limit(50);
  if (queued.error || stale.error) throw new Error(`${TABLE}: ${(queued.error || stale.error).message}`);
  return [...(queued.data || []), ...(stale.data || [])];
}

async function collectedState(sb, reqs) {
  const ids = [...new Set(reqs.map((r) => r.email_id).filter(Boolean))];
  const { data } = ids.length ? await sb.from('sqs_email_campaigns').select('email_id, events_complete, events_collected_at, delivered, opened, clicked, unsubscribed').in('email_id', ids) : { data: [] };
  const { data: run } = await sb.from('marketing_collector_runs').select('finished_at').in('kind', COLLECTOR_KINDS).eq('status', 'ok').order('finished_at', { ascending: false }).limit(1).maybeSingle();
  return { campaigns: new Map((data || []).map((c) => [c.email_id, c])), lastOkRunAt: run?.finished_at || null };
}

async function runningCollector(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('started_at, heartbeat_at').in('kind', COLLECTOR_KINDS).eq('status', 'running').order('started_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

async function markSkipped(sb, skip, nowIso) {
  for (const r of skip) {
    await sb.from(TABLE).update({ status: 'skipped', finished_at: nowIso, result: { reason: 'already collected after the due time', collected_at: r.collected_at } }).eq('request_id', r.request_id);
  }
}

async function claim(sb, serve, nowIso) {
  for (const r of serve) {
    const { error } = await sb.from(TABLE).update({ status: 'running', claimed_at: nowIso, attempts: (r.attempts || 0) + 1 }).eq('request_id', r.request_id);
    if (error) throw new Error(`${TABLE}: ${error.message}`);
  }
}

export async function nextRequests(sb, nowIso = new Date().toISOString()) {
  const waiting = waitReason(nowIso, await runningCollector(sb));
  if (waiting) return { job: null, waiting };
  const due = await dueRequests(sb, nowIso);
  if (!due.length) return { job: null };
  const { serve, skip } = triage(due, await collectedState(sb, due));
  await markSkipped(sb, skip, nowIso);
  if (!serve.length) return { job: null, skipped: skip.length };
  await claim(sb, serve, nowIso);
  const emailIds = [...new Set(serve.map((r) => r.email_id).filter(Boolean))];
  return { job: { request_ids: serve.map((r) => r.request_id), email_ids: emailIds, slots: serve.map((r) => r.slot) }, skipped: skip.length };
}

/* ---------- reporting back (POST collect-done) ---------- */

const resultOf = (c) => (c ? { events_collected_at: c.events_collected_at, delivered: c.delivered, opened: c.opened, clicked: c.clicked, unsubscribed: c.unsubscribed } : null);

/** One claimed request after the run: done only with real, freshly collected recipient events; else retry / fail. */
export function outcome(r, campaign, b, nowIso) {
  const ok = b.status === 'ok';
  const fresh = !r.email_id || (!!campaign?.events_complete && ms(campaign.events_collected_at) >= ms(r.claimed_at));
  if (ok && fresh) return { kind: 'done', row: { status: 'done', finished_at: nowIso, error: null, result: resultOf(campaign) } };
  const why = ok ? 'run finished but this campaign was not fully collected (not listed yet, or a list stopped early)' : String(b.error || 'collector run failed').slice(0, 500);
  if ((r.attempts || 0) >= MAX_ATTEMPTS) return { kind: 'failed', row: { status: 'failed', finished_at: nowIso, error: why } };
  return { kind: 'retry', row: { status: 'queued', due_at: new Date(ms(nowIso) + RETRY_MS).toISOString(), error: why } };
}

export async function finishRequests(sb, b, nowIso = new Date().toISOString()) {
  const ids = (Array.isArray(b.request_ids) ? b.request_ids : []).map(String).slice(0, 100);
  if (!ids.length) throw new Error('request_ids are needed');
  const { data, error } = await sb.from(TABLE).select(COLS).in('request_id', ids);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  const live = (data || []).filter((r) => r.status === 'running');
  const { campaigns } = await collectedState(sb, live);
  const counts = { done: 0, retry: 0, failed: 0 };
  for (const r of live) {
    const o = outcome(r, campaigns.get(r.email_id), b, nowIso);
    counts[o.kind] += 1;
    const { error: e2 } = await sb.from(TABLE).update(o.row).eq('request_id', r.request_id);
    if (e2) throw new Error(`${TABLE}: ${e2.message}`);
  }
  return counts;
}

export async function listRequests(sb) {
  const { data, error } = await sb.from(TABLE).select(`${COLS}, source, finished_at, result, error, created_at`).order('due_at', { ascending: false }).limit(60);
  if (error) throw new Error(`${TABLE}: ${error.message}`);
  return { requests: data || [] };
}

/* ---------- PC side (collector.mjs --jobs) ---------- */

function runCollector(spawnFn, nodePath, root) {
  return new Promise((resolve) => {
    const child = spawnFn(nodePath, ['scripts/marketing-collector/collector.mjs'], { cwd: root, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * Called from jobs() with the collector's own api(method, body, query). Runs the normal daily collector (read-only
 * Squarespace) once for everything due, in a child process that opens the profile after jobs() has closed it.
 */
export async function collectQueueJob({ api, root, spawnFn = spawn, nodePath = process.execPath, log = console.log }) {
  const { job, waiting } = await api('GET', null, '?action=collect-next');
  if (!job) return waiting ? { waiting } : null;
  log(`collect queue: ${job.request_ids.length} request(s) due (${job.slots.join(', ')}); running the email-report collector`);
  const code = await runCollector(spawnFn, nodePath, root);
  const r = await api('POST', { action: 'collect-done', request_ids: job.request_ids, status: code === 0 ? 'ok' : 'failed', error: code === 0 ? null : `collector exited with code ${code}` });
  log(`collect queue: ${r.done} done, ${r.retry} to retry, ${r.failed} failed`);
  if (r.done > 0) await api('POST', { action: 'sync', step: 'customers' }).catch((e) => log(`collect queue rebuild: ${e.message}`));
  return r;
}
