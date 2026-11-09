/**
 * The shared delivery-status board (server side) and the provider checks behind it.
 *  - buildStatusBoard(sb): every delivery with the ONE status (lib/marketing/delivery-status.mjs): emails (the delivery
 *    builder), social placements (marketing_social_placements + the shared decision state for "needs approval"),
 *    Outlook / Google tasks (campaign steps + ticks), plus "last checked" per provider and any failures. Read-only.
 *  - watchDue(sb): whether Alan's PC should run a Squarespace check now (every 15 min 07:00–22:00 UK + ~10 min after
 *    each release) and whether a Meta check is due (~10 min after a Facebook / Instagram release). Read-only.
 *  - refreshStatus(sb): the "Refresh status" button. A REAL check: queues a due-now request on the existing collect
 *    queue (marketing_collect_requests; the PC's 5-minute task runs the read-only Squarespace collector) and runs the
 *    Meta post steps of the existing social collector (lib/social/collect.mjs, unchanged). Never sends, retries or
 *    publishes; writes only the queue row and the collectors' own read results.
 */
import { deliveryInputs, deliveryView } from './delivery.mjs';
import { buildDecisionState, londonDay, releaseBlockers } from './decision-state.mjs';
import { CHECK_RULES, RELEASE_CHECK_DELAY_MIN, STORY_OWNER, isGbpReview, isPublishedPlacement, placementStatus, status, taskStatus, ukDayTime, watchDecision } from './delivery-status.mjs';
import { manualRequest } from './collect-queue.mjs';
import { contentView, lastYoutubeOk, lastYoutubeRead, loadContent, readShortsStatus, youtubeReleases } from './delivery-content.mjs';
import { runStep } from '../social/collect.mjs';
import { supabaseRepo } from '../social/repo.mjs';

const PROP = 'https://www.alanranger.com';
export const REFRESH_KEY = 'status|refresh';
export const META_STEPS = ['facebook_posts', 'instagram_media'];
const META_MIN_GAP_MS = 5 * 60000;
const DAY = 864e5;
const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const addDays = (day, k) => new Date(Date.parse(`${day}T12:00:00Z`) + k * DAY).toISOString().slice(0, 10);
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};

/* ---------- provider check state ---------- */

async function metaState(sb) {
  const { data } = await sb.from('social_connections').select('status, last_checked_at, last_collected_at, last_error').eq('channel', 'meta').maybeSingle();
  if (!data) return { connected: false, ok: true, last_ok_at: null, error: null };
  return { connected: data.status === 'connected', ok: !data.last_error, last_ok_at: data.last_collected_at || null, last_attempt_at: data.last_checked_at || null, error: data.last_error ? String(data.last_error).slice(0, 160) : null };
}

/** Last checked per provider, and the plain failures (a failure never zeroes anything: rows keep their last state). */
export function checksOf(read, meta, sentReadAt) {
  const sq = { provider: 'squarespace', label: 'Squarespace (Scheduled, Sent, Drafts)', last_ok_at: read.last_ok_at, state: read.failed_since_ok ? 'failed' : read.state, error: read.failed_since_ok ? read.last_error || read.last_status : null, sent_read_at: sentReadAt || null };
  const mt = { provider: 'meta', label: 'Meta (Facebook / Instagram posts)', last_ok_at: meta.last_ok_at, state: meta.connected ? (meta.ok ? 'ok' : 'failed') : 'not_connected', error: meta.error };
  const li = { provider: 'linkedin', label: 'Personal LinkedIn', last_ok_at: null, state: 'manual', error: null, note: 'no API: GPT\'s recorded live check counts as published' };
  const okTimes = [sq.last_ok_at, mt.last_ok_at].filter(Boolean).sort();
  return { last_checked: okTimes.pop() || null, checks: [sq, mt, li], failures: [sq, mt].filter((c) => c.state === 'failed').map((c) => `${c.label}: ${c.error || 'failed'}`) };
}

/* ---------- loaders ---------- */

async function placementsOf(sb, now) {
  const pls = must(await sb.from('marketing_social_placements').select('step_key, placement, stage, platform_state, provider_id, provider_url, planned_at, actual_at, public_caption, link_url, assets, evidence, set_by').eq('property_url', PROP).limit(2000), 'marketing_social_placements');
  const ids = [...new Set(pls.map((p) => p.provider_id).filter(Boolean))];
  const [posts, recent] = await Promise.all([
    ids.length ? sb.from('social_posts').select('post_id, channel, collected_at').in('post_id', ids).then((r) => must(r, 'social_posts')) : [],
    sb.from('social_posts').select('post_id, channel, posted_at, permalink, collected_at').gte('posted_at', new Date(now - 30 * DAY).toISOString()).limit(500).then((r) => must(r, 'social_posts'))
  ]);
  return { pls, posts: new Map(posts.map((p) => [p.post_id, p])), recent };
}

/** Step-level gates ("Hold: …" on any placement of the step): its Story is held too. */
const heldOf = (pls) => new Map(pls.filter((p) => /^hold\b/i.test(p.assets?.editorial?.scheduling_status || '')).map((p) => [p.step_key, p.assets.editorial.scheduling_status]));

/** GPT's task on each date Meta's window opens: "Schedule {n} Meta posts now in window" (done once none are left). */
export function windowTasks(pls, held = new Map()) {
  const by = new Map();
  for (const p of pls.filter((x) => x.assets?.editorial?.provider_schedule_eligible_at && x.placement !== 'instagram_story' && !held.has(x.step_key))) {
    const day = londonDay(p.assets.editorial.provider_schedule_eligible_at);
    by.set(day, [...(by.get(day) || []), p]);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => {
    const left = list.filter((p) => p.platform_state !== 'scheduled' && !isPublishedPlacement(p));
    const n = left.length || list.length;
    return { step_key: `meta-window|${day}`, channel: 'Facebook + Instagram', title: `Schedule ${n} Meta post${n === 1 ? '' : 's'} now in window`, day, type: 'meta_window', owner: 'GPT', posts: list.map((p) => ({ step_key: p.step_key, placement: p.placement, planned_at: p.planned_at })), status: status(left.length ? 'due' : 'done', { when: left.length ? `window opens ${ukDayTime(list[0].assets.editorial.provider_schedule_eligible_at)}` : 'all scheduled', evidence: 'Meta schedules 20 minutes to 29 days ahead' }) };
  });
}

/** Each Story on its day: "Post Instagram Story: {title}, link sticker {url}" with the PNG and the URL one click away. */
export function storyTasks(pls, titles, urls, pctx) {
  return pls.filter((p) => p.placement === 'instagram_story' && p.planned_at).sort((a, b) => a.planned_at.localeCompare(b.planned_at)).map((p) => ({
    step_key: `story|${p.step_key}`, channel: 'Instagram Story', title: `Post Instagram Story: ${titles.get(p.step_key) || p.step_key}${p.link_url ? `, link sticker ${p.link_url}` : ''}`,
    day: londonDay(p.planned_at), type: 'story_publish', owner: STORY_OWNER, link: p.link_url || null, png: urls.get(p.assets?.story?.storage_path) || null, status: placementStatus(p, pctx)
  }));
}

/** Read-only: the Stories' step titles and 1-hour signed links to their PNGs (private social-renders bucket). */
async function storyRefs(sb, pls) {
  const stories = pls.filter((p) => p.placement === 'instagram_story');
  const paths = stories.map((p) => p.assets?.story?.storage_path).filter(Boolean);
  const [steps, signed] = await Promise.all([
    stories.length ? sb.from('strategy_campaign_steps').select('step_key, step').in('step_key', [...new Set(stories.map((p) => p.step_key))]).then((r) => must(r, 'strategy_campaign_steps')) : [],
    paths.length ? sb.storage.from('social-renders').createSignedUrls(paths, 3600).then((r) => r.data || []) : []
  ]);
  return { titles: new Map(steps.map((s) => [s.step_key, s.step])), urls: new Map(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl])) };
}

const TASK_RE = /Outlook|Google Business/i;
async function tasksOf(sb, today) {
  const steps = must(await sb.from('strategy_campaign_steps').select('step_key, channel, step, scheduled_day').gte('scheduled_day', addDays(today, -14)).lte('scheduled_day', addDays(today, 28)).limit(1000), 'strategy_campaign_steps').filter((s) => TASK_RE.test(s.channel || ''));
  const ticks = steps.length ? must(await sb.from('strategy_campaign_ticks').select('tick_key, is_ticked, status, moved_to, set_at, set_by, reason, history').eq('property_url', PROP).in('tick_key', steps.map((s) => s.step_key)), 'strategy_campaign_ticks') : [];
  const t = new Map(ticks.map((x) => [x.tick_key, x]));
  return steps.map((s) => {
    const k = t.get(s.step_key);
    const tick = k ? { is_ticked: k.is_ticked, status: k.status, reason: k.reason, set_by: k.set_by, set_at: k.set_at, history: (k.history || []).slice(-10) } : null;
    return { key: s.step_key, channel: s.channel, title: String(s.step || '').replace(/^Personal note to past clients:\s*/i, ''), day: k?.moved_to || String(s.scheduled_day || '').slice(0, 10), done: !!(k && (k.is_ticked || ['done', 'skipped', 'not_needed'].includes(k.status))), done_at: k?.set_at || null, tick };
  });
}

/** Who / when / why for the steps buildDecisionState().deferred lists (marketing_decisions, kind deferred). */
async function deferredOf(sb, keys) {
  if (!keys.length) return new Map();
  const rows = must(await sb.from('marketing_decisions').select('ref_key, decided_by, decided_at, reason').eq('kind', 'deferred').in('ref_key', keys), 'marketing_decisions');
  return new Map(rows.map((r) => [r.ref_key, { by: r.decided_by, at: r.decided_at, reason: r.reason }]));
}

const recent = (iso, now) => !iso || ms(iso) >= now - 14 * DAY;
const emailRow = (d) => ({ key: d.key, campaign_key: d.campaign_key || null, email_id: d.sent?.email_id || d.provider?.email_id || null, title: d.title, send_at: d.send_at || null, send_day: d.send_day || null, status: d.status, aud: d.aud || null });

/** An email that carries a Short: its refs, and the guard ("Short public ✓" / "Short not public yet ⚠") for the first. */
const withShorts = (e, shorts) => (shorts?.length ? { ...e, shorts, short_check: shorts[0] } : e);
/** YouTube read (owner OAuth, read-only videos.list) beside the other provider checks. */
function youtubeCheck(assets) {
  const shorts = assets.filter((a) => a.format === 'short_video');
  const last = shorts.map((a) => a.provider_state).filter(Boolean).sort((a, b) => String(b.error_at || b.read_at).localeCompare(String(a.error_at || a.read_at)))[0] || null;
  const failed = !!(last?.error && !(last.read_at && last.read_at > last.error_at));
  return { provider: 'youtube', label: 'YouTube (video status: scheduled / public / restricted)', last_ok_at: lastYoutubeOk(shorts), state: !shorts.length ? 'none' : (failed ? 'failed' : (last?.read_at ? 'ok' : 'never_read')), error: failed ? last.error : null, note: 'copyright-check progress is not in the YouTube API: only real restrictions (rejected, blocked, age-restricted) are read' };
}

/** The board every view reads (GET ?action=delivery-status). Viewing writes nothing. */
export async function buildStatusBoard(sb, { now = Date.now() } = {}) {
  const today = londonDay(now);
  const [inputs, meterRow, decisions, social, meta, tasks, sentRead] = await Promise.all([
    deliveryInputs(sb),
    sb.from('sqs_send_meter').select('*').order('captured_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
    buildDecisionState(sb, { today }),
    placementsOf(sb, now), metaState(sb), tasksOf(sb, today),
    sb.from('sqs_email_campaigns').select('collected_at').order('collected_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data?.collected_at || null)
  ]);
  const view = deliveryView(meterRow || { cycle_reset_at: new Date(now + 30 * DAY).toISOString(), quota_emails: 0, used_emails: 0 }, inputs, {}, new Date(now));
  const openRelease = new Set(decisions.open.filter((x) => x.type === 'release_approval').map((x) => x.step_key));
  const openKeys = new Set(decisions.open.map((x) => x.key));
  const deferred = await deferredOf(sb, decisions.deferred || []);
  const held = heldOf(social.pls);
  const pctx = { now, open: openRelease, blockers: releaseBlockers, meta, posts: social.posts, recent: social.recent, held };
  const refs = await storyRefs(sb, social.pls);
  const checks = checksOf(view.read, meta, sentRead);
  const assets = await loadContent(sb);
  const emails = view.deliveries.filter((d) => recent(d.sent?.at || d.send_at, now)).map(emailRow);
  const media = contentView(assets, new Map(emails.filter((e) => e.campaign_key).map((e) => [e.campaign_key, e])), { now });
  checks.checks.push(youtubeCheck(assets));
  const outcome = outcomeOf(await latestRefresh(sb));
  return {
    as_of: new Date(now).toISOString(), today, ...checks, rules: CHECK_RULES, last_refresh: outcome, last_checked_label: lastCheckedLabel(checks.last_checked, outcome),
    emails: emails.map((e) => withShorts(e, media.shortsByEmail.get(e.campaign_key))),
    content: media.content,
    placements: social.pls.map((p) => ({ step_key: p.step_key, placement: p.placement, planned_at: p.planned_at, provider_id: p.provider_id || null, status: placementStatus(p, pctx) })),
    tasks: [
      ...tasks.map((t) => ({ step_key: t.key, channel: t.channel, title: t.title, day: t.day, type: isGbpReview(t) ? 'gbp_review' : 'reminder', owner: isGbpReview(t) ? 'GPT' : null, status: taskStatus(t, { today, open: openKeys, deferred }) })),
      ...windowTasks(social.pls, held), ...storyTasks(social.pls, refs.titles, refs.urls, pctx)
    ],
    decisions_open: decisions.count
  };
}

/* ---------- automatic checks (Alan's PC, collector --jobs every 5 minutes) ---------- */

/** Releases in the last 3 hours: Squarespace schedules, and Facebook / Instagram placements (for the Meta check). */
async function recentReleases(sb, now) {
  const from = new Date(now - 3 * 3600000).toISOString();
  const to = new Date(now).toISOString();
  const sched = must(await sb.from('sqs_scheduled_emails').select('scheduled_for').gte('scheduled_for', from).lte('scheduled_for', to), 'sqs_scheduled_emails');
  const pls = must(await sb.from('marketing_social_placements').select('placement, planned_at').eq('property_url', PROP).gte('planned_at', from).lte('planned_at', to), 'marketing_social_placements');
  return { email: sched.map((s) => s.scheduled_for), meta: pls.filter((p) => /facebook|instagram/.test(p.placement)).map((p) => p.planned_at) };
}

export function metaDue(meta, releases, now) {
  if (!meta.connected) return { due: false, reason: 'Meta not connected' };
  const r = releases.find((at) => {
    const check = ms(at) + RELEASE_CHECK_DELAY_MIN * 60000;
    return check <= now && !(ms(meta.last_ok_at) >= check);
  });
  return r ? { due: true, reason: `Meta check ${RELEASE_CHECK_DELAY_MIN} min after ${ukDayTime(r)}` } : { due: false, reason: 'no Facebook / Instagram release waiting for a check' };
}

/** GET ?action=watch-due (the PC asks; read-only). */
export async function watchDue(sb, now = Date.now()) {
  const [runs, rel, meta, assets] = await Promise.all([
    sb.from('marketing_collector_runs').select('status, started_at, finished_at, heartbeat_at').eq('kind', 'collector:scheduled').order('started_at', { ascending: false }).limit(10),
    recentReleases(sb, now), metaState(sb), loadContent(sb)
  ]);
  const list = must(runs, 'marketing_collector_runs');
  const running = list.some((r) => r.status === 'running' && now - ms(r.heartbeat_at || r.started_at) < 10 * 60000);
  const lastOk = list.find((r) => r.status === 'ok');
  const squarespace = watchDecision({ now, lastAttemptAt: list[0]?.started_at || null, lastOkAt: lastOk?.finished_at || null, releases: rel.email, running });
  const youtube = watchDecision({ now, lastAttemptAt: lastYoutubeRead(assets), lastOkAt: lastYoutubeOk(assets), releases: youtubeReleases(assets) });
  return { squarespace, meta: metaDue(meta, rel.meta, now), youtube, checked_at: new Date(now).toISOString() };
}

/** The existing social collector's post steps (lib/social/collect.mjs runStep, unchanged). Skipped if read < 5 min ago. */
export async function metaCheck(sb, { now = Date.now(), run = runStep, repo = supabaseRepo(sb) } = {}) {
  const meta = await metaState(sb);
  if (!meta.connected) return { ok: true, skipped: 'not_connected' };
  if (meta.last_ok_at && now - ms(meta.last_ok_at) < META_MIN_GAP_MS) return { ok: true, skipped: 'checked in the last 5 minutes', last_ok_at: meta.last_ok_at };
  const results = [];
  for (const step of META_STEPS) {
    const r = await run(step, { repo, env: process.env, now });
    results.push({ step, ok: !!r.ok, rows: r.rows ?? 0, error: r.ok ? null : r.error || 'failed' });
  }
  return { ok: results.every((r) => r.ok), results };
}

/* ---------- one refresh's result: complete / partial (which providers) / failed ---------- */

export const REFRESH_RUN = 'status-refresh';
const SQ_STATE = { done: 'ok', skipped: 'ok', failed: 'failed', queued: 'queued', running: 'running' };
const providerState = (x) => {
  if (!x) return 'not_run';
  if (x.skipped) return 'skipped';
  return x.ok ? 'ok' : 'failed';
};

/** Squarespace from the queue row; Meta and YouTube from their reads at the start. */
export function refreshOutcome({ request, meta, youtube }) {
  const prov = [['Squarespace', request ? SQ_STATE[request.status] || request.status : 'not_queued'], ['Meta', providerState(meta)], ['YouTube', providerState(youtube)]];
  const pending = prov.filter(([, s]) => s === 'queued' || s === 'running');
  const failed = prov.filter(([, s]) => s === 'failed');
  const counted = prov.filter(([, s]) => s !== 'skipped' && s !== 'not_run');
  let state = 'complete';
  if (pending.length || failed.length) state = failed.length && failed.length === counted.length ? 'failed' : 'partial';
  const bits = [...pending.map(([p, s]) => `${p} still ${s}`), ...failed.map(([p]) => `${p} failed`)];
  return { state, text: state === 'complete' ? 'complete' : `${state}: ${bits.join('; ')}`, providers: Object.fromEntries(prov.map(([p, s]) => [p.toLowerCase(), s])) };
}

const hm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
export const lastCheckedLabel = (at, outcome) => `Last checked ${at ? hm(at) : 'never'} (Europe/London) · ${outcome ? outcome.text : 'complete'}`;

async function latestRefresh(sb) {
  const [{ data: run }, { data: request }] = await Promise.all([
    sb.from('marketing_collector_runs').select('run_id, status, started_at, finished_at, summary').eq('kind', REFRESH_RUN).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('marketing_collect_requests').select('status, due_at, claimed_at, finished_at, error, attempts').eq('campaign_key', REFRESH_KEY).eq('slot', 'manual').maybeSingle()
  ]);
  return { run: run || null, request: request || null };
}
/** The latest refresh's result; a finished one older than 6 hours no longer qualifies "Last checked". */
const outcomeOf = (r, now = Date.now()) => {
  if (!r.run || (r.run.status !== 'running' && now - ms(r.run.started_at) > 6 * 3600000)) return null;
  return refreshOutcome({ request: r.request, meta: r.run.summary?.meta, youtube: r.run.summary?.youtube });
};
const runStatus = { complete: 'ok', partial: 'partial', failed: 'failed' };

/** POST ?action=status-refresh ("Refresh status"): queue the real Squarespace check, run Meta + YouTube, record it. */
export async function refreshStatus(sb, { now = Date.now() } = {}) {
  const queued = await manualRequest(sb, { campaign_key: REFRESH_KEY }, new Date(now).toISOString());
  const meta = await metaCheck(sb, { now }).catch((e) => ({ ok: false, error: String(e?.message || e).slice(0, 160) }));
  const youtube = await readShortsStatus(sb, { now }).catch((e) => ({ ok: false, error: String(e?.message || e).slice(0, 160) }));
  const outcome = refreshOutcome({ request: { status: 'queued' }, meta, youtube });
  const { data } = await sb.from('marketing_collector_runs').insert({ kind: REFRESH_RUN, status: 'running', host: 'dashboard', heartbeat_at: new Date(now).toISOString(), summary: { meta, youtube, outcome } }).select('run_id').single();
  return { started_at: new Date(now).toISOString(), run_id: data?.run_id || null, squarespace: { queued: queued.queued > 0, note: 'Alan\'s PC runs the read-only Squarespace check within 5 minutes' }, meta, youtube, outcome, sends: 0, publishes: 0 };
}

/** After the PC reports the queued check (POST collect-done): the refresh's final result, recorded on its run row. */
export async function recordRefreshOutcome(sb, nowIso = new Date().toISOString()) {
  const r = await latestRefresh(sb);
  if (!r.run || r.run.status !== 'running') return null;
  const outcome = outcomeOf(r);
  if (outcome.text.includes('still')) return outcome;
  await sb.from('marketing_collector_runs').update({ status: runStatus[outcome.state], finished_at: nowIso, summary: { ...r.run.summary, outcome, squarespace: r.request } }).eq('run_id', r.run.run_id);
  return outcome;
}

/** GET ?action=status-refresh-progress: the queued check's state + last checked (read-only). */
export async function refreshProgress(sb) {
  const { data } = await sb.from('marketing_collect_requests').select('status, due_at, claimed_at, finished_at, error, attempts').eq('campaign_key', REFRESH_KEY).eq('slot', 'manual').maybeSingle();
  const [runs, meta, sentRead] = await Promise.all([
    sb.from('marketing_collector_runs').select('kind, status, started_at, finished_at, error, summary').eq('kind', 'collector:scheduled').order('started_at', { ascending: false }).limit(10),
    metaState(sb),
    sb.from('sqs_email_campaigns').select('collected_at').order('collected_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data?.collected_at || null)
  ]);
  const list = must(runs, 'marketing_collector_runs');
  const ok = list.find((r) => r.status === 'ok');
  const last = list[0] || null;
  const read = { state: ok ? 'fresh' : 'never_read', last_ok_at: ok ? ok.finished_at || ok.started_at : null, failed_since_ok: !!last && !['ok', 'running'].includes(last.status), last_status: last?.status || null, last_error: last?.error || null };
  const done = !data || ['done', 'skipped', 'failed'].includes(data.status);
  const checks = checksOf(read, meta, sentRead);
  checks.checks.push(youtubeCheck(await loadContent(sb)));
  const outcome = outcomeOf(await latestRefresh(sb));
  return { request: data || null, done, ...checks, outcome, last_checked_label: lastCheckedLabel(checks.last_checked, outcome) };
}
