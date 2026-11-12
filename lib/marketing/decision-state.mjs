/**
 * ONE shared decision state for every view: Marketing "Waiting on you", Strategy "Needs Alan", Results and initiative
 * next actions read the same records through buildDecisionState(sb). Read-only (viewing writes nothing).
 * Sources:
 *  - Alan's recorded decisions: public.marketing_decisions (plan_approved / keep_blocked / deferred; who, when, why);
 *  - social placements (marketing_social_placements): published = provider evidence (a scheduled post's queue URL is
 *    not); a release approval is only asked when the stored public caption (no internal text), a rendered asset and
 *    the booking URL are present, otherwise the post is on GPT's production queue. Never asked for posts already on
 *    the platform's schedule, Stories (GPT posts them) or main artwork Alan approved;
 *  - Outlook note steps due by tomorrow (strategy_campaign_steps + ticks), unless done / skipped / deferred;
 *  - blocked contacts subscribed again (customer_person + marketing_suppression), unless each is kept blocked
 *    (labelled "N total · N decided (keep blocked) · N new");
 *  - people a third email reaches in the next 7 days WITHOUT an approved exception (lib/marketing/frequency.mjs);
 *  - Alan-owned quarter actions due within 7 days or late (strategy_quarter_actions; owner = the linked initiative's
 *    owner, none = Alan; evidence-ruled and waiting actions are not Alan's to do);
 *  - campaign records at "verified" (Alan approves them);
 *  - content records (YouTube Shorts) with a real restriction Alan must act on (content[].needs_alan:
 *    lib/marketing/delivery-content.mjs — a rejection, failed upload or region block; never a mere age limit).
 * `open` is THE list of Alan's open decisions and `count` its length: Waiting renders it, Strategy counts it.
 * No names, emails or hashes leave this module: counts, titles, keys and dates only.
 */
import { emailHash, selectAll } from './store.mjs';
import { markersIn } from '../social-standard/caption.mjs';
import { evidenceRuleFor } from '../strategy-action-evidence.mjs';
import { contentView, loadContent } from './delivery-content.mjs';
import { alanApproved, isPublishedPlacement } from './delivery-status.mjs';
import { frequencyInputs, windowStats } from './frequency.mjs';
import { stalledForAlan } from '../strategy-prospects.mjs';

const PROP = 'https://www.alanranger.com';
const LONDON = 'Europe/London';
const DONE = new Set(['done', 'auto_done', 'skipped', 'not_needed']);
const CLOSED_STAGES = new Set(['published', 'live_check', 'live', 'skipped', 'withdrawn']);
export const londonDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });
export const addDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};

/* ---------- recorded decisions ---------- */

export function decisionIndex(rows) {
  const of = (kind) => rows.filter((r) => r.kind === kind);
  const plan = of('plan_approved').sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0] || null;
  return { planApproved: plan, keptBlocked: new Set(of('keep_blocked').map((r) => r.ref_key)), deferred: new Set(of('deferred').map((r) => r.ref_key)) };
}

/* ---------- placements ---------- */

/** Provider evidence only (lib/marketing/delivery-status.mjs): a scheduler queue URL is not publication. */
export const isPublished = isPublishedPlacement;
/** Not Alan's to approve: on the platform's schedule, blocked by the provider, a Story (GPT posts it), or art Alan approved. */
const handled = (p) => ['scheduled', 'blocked'].includes(p.platform_state) || p.stage === 'scheduled' || p.placement === 'instagram_story' || alanApproved(p);
const rendered = (p) => Object.entries(p.assets || {}).some(([k, v]) => k !== 'editorial' && v && v.storage_path);
/** What stops a release approval: never asked until every check passes. */
export function releaseBlockers(p) {
  const out = [];
  if (!String(p.public_caption || '').trim()) out.push('public caption');
  else if (markersIn(p.public_caption).length) out.push('internal text in the caption');
  if (!rendered(p)) out.push('rendered asset');
  if (!p.link_url) out.push('booking URL');
  return out;
}

/** Posts due by the end of tomorrow (or late), not published: ready → Alan approves; not ready → GPT's production queue. */
export function releaseSplit(placements, steps, today, deferred = new Set()) {
  const end = addDays(today, 1);
  const by = new Map();
  const open = (p) => p.planned_at && londonDay(p.planned_at) <= end && !CLOSED_STAGES.has(p.stage) && !isPublished(p) && !handled(p);
  for (const p of placements.filter(open)) by.set(p.step_key, [...(by.get(p.step_key) || []), p]);
  const ready = [];
  const production = [];
  for (const [key, list] of by) {
    if (deferred.has(key) || steps.get(key)?.done) continue;
    const blockers = [...new Set(list.flatMap(releaseBlockers))];
    const item = { step_key: key, title: steps.get(key)?.title || key, due: londonDay(list[0].planned_at), placements: list.map((p) => p.placement), blockers };
    (blockers.length ? production : ready).push(item);
  }
  return { ready, production };
}

/* ---------- Outlook notes, blocked contacts, quarter actions ---------- */

export function outlookDue(steps, today, deferred) {
  const end = addDays(today, 1);
  return [...steps.values()].filter((s) => /Outlook/i.test(s.channel) && s.day && s.day <= end && s.day >= addDays(today, -14) && !s.done && !deferred.has(s.key));
}

export function alanActions(actions, links, initiatives, today) {
  const owner = new Map(links.filter((l) => l.ref_type === 'action').map((l) => [l.ref_key, initiatives.get(l.initiative_key)?.owner || null]));
  const soon = addDays(today, 7);
  return actions.filter((a) => !a.is_ticked && a.due_week_start && a.due_week_start <= soon && a.status !== 'waiting' && !evidenceRuleFor(a))
    .filter((a) => !owner.get(a.action_key) || owner.get(a.action_key) === 'Alan');
}

/* ---------- open decisions ---------- */

const plural = (k, one, many) => `${k} ${k === 1 ? one : (many || `${one}s`)}`;
/** The single (not per-item) decisions: overall plan approval, new blocked contacts, uncovered third emails. */
function singleDecisions(x) {
  const out = [];
  if (!x.planApproved && x.drafts > 0) out.push({ type: 'plan_approval', key: 'plan', due: null, what: `Approve GPT's plan (${plural(x.drafts, 'draft')})`, channel: 'all', why: 'Drafts ready · nothing goes out until you approve' });
  if (x.blockedOpen > 0) out.push({ type: 'blocked_review', key: 'blocked', due: null, what: `Review ${plural(x.blockedOpen, 'new blocked contact')} showing as subscribed again`, channel: 'none', why: x.blocked ? blockedLabel(x.blocked) : 'Your decision' });
  if (x.frequency?.unapproved_over > 0) out.push(frequencyDecision(x.frequency));
  return out;
}
export function openDecisions(x) {
  const out = singleDecisions(x);
  for (const r of x.release) out.push({ type: 'release_approval', key: `release|${r.step_key}`, step_key: r.step_key, due: r.due, what: `Approve caption & artwork: ${r.title}`, channel: r.placements.some((p) => /linkedin/.test(p)) ? 'linkedin' : 'fbig', why: 'Caption, artwork and link ready · GPT posts after you approve' });
  for (const s of x.outlook) out.push({ type: 'outlook_note', key: `outlook|${s.key}`, step_key: s.key, due: s.day, what: s.title, channel: 'outlook', why: 'Personal note · approve and send' });
  for (const a of x.actions) out.push({ type: 'quarter_action', key: `action|${a.action_key}`, due: a.due_week_start, late: a.due_week_start < x.today, what: a.label, channel: 'none', why: a.due_week_start < x.today ? 'Late · quarter action' : 'Quarter action due' });
  for (const c of x.verified) out.push({ type: 'campaign_approval', key: `campaign|${c.campaign_key}`, due: c.planned_send_on || null, what: `Approve: ${c.title || 'campaign'}`, channel: 'email', why: 'Verified · your approval' });
  for (const v of x.content || []) out.push(contentDecision(v));
  for (const p of x.prospects || []) out.push(p);
  return out;
}
/** Stalled Prospects enquiries whose next step Alan owns (lib/strategy-prospects.mjs; no names). A failed read lists none. */
async function stalledProspects(sb, today) {
  const { data, error } = await sb.from('prospect_enquiry').select('id, type, stage, value_gbp, owner, last_touch_at, created_at, next_action_date').eq('owner', 'Alan').in('stage', ['qualify', 'quote', 'scheduled']).limit(500);
  return error ? [] : stalledForAlan(data || [], today);
}

/**
 * A content record (YouTube Short) with a real restriction Alan must act on (rejection, failed upload or region block:
 * content[].needs_alan from lib/marketing/delivery-content.mjs). The restriction wording is YouTube's, via the status.
 */
export const contentDecision = (v) => ({
  type: 'content_restriction', key: `content|${v.asset_key}`, asset_key: v.asset_key, url: v.url || null, due: v.release_at ? londonDay(v.release_at) : null,
  what: `YouTube Short restricted: ${v.title || 'video'}`, channel: 'youtube', why: v.status?.blocker || v.status?.label || 'restricted by YouTube'
});
/** Suppressed but subscribed again: "3 total · 2 decided (keep blocked) · 1 new" (the decided ones are never reopened). */
export const blockedLabel = (b) => `${b.total} total · ${b.decided} decided (keep blocked) · ${b.open} new`;

const ukShort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
/**
 * Per-person frequency, next 7 days (lib/marketing/frequency.mjs windowStats): only the people a third email reaches
 * WITHOUT an approved exception (marketing_frequency_exceptions, or a snapshot's approved frequency_policy) are a
 * decision; those an approval covers are counted apart and never re-asked.
 */
export const frequencyDecision = (w) => ({
  type: 'frequency', key: `frequency|${w.from}`, due: w.from, channel: 'email',
  what: `${plural(w.unapproved_over, 'person gets', 'people get')} 3+ emails in 7 days (${ukShort(w.from)} – ${ukShort(w.to)}) without an approved exception`,
  why: `Not covered by an approved exception${w.approved_over ? ` (${w.approved_over} more are covered)` : ''} · approve or move one`
});
async function frequencyWindow(sb, today) {
  try {
    const [camps, exps] = await Promise.all([
      sb.from('strategy_campaigns').select('campaign_key, kind, stage, export_id, scheduled_for, sent_on, planned_send_on, estimate_sends, sqs_email_id, sqs_draft_id').eq('property_url', PROP),
      sb.from('marketing_segment_exports').select('export_id, campaign_key, owner:definition_snapshot->owner, frequency_policy:definition_snapshot->>frequency_policy').eq('is_test', false)
    ]);
    const input = await frequencyInputs(sb, { campaigns: must(camps, 'strategy_campaigns'), exports: must(exps, 'marketing_segment_exports') }, today);
    const w = windowStats(input, today, addDays(today, 6));
    return { from: w.from, to: w.to, by_count: w.by_count, approved_over: w.approved_over, unapproved_over: w.unapproved_over, exception_campaigns: w.exception_campaigns };
  } catch {
    return null;
  }
}
/** Content records needing Alan (read-only; a failed read lists none rather than blocking the other decisions). */
async function restrictedContent(sb) {
  const assets = await loadContent(sb).catch(() => []);
  return contentView(assets, new Map(), { now: Date.now() }).content.filter((c) => c.needs_alan);
}

/* ---------- reads ---------- */

const shortStep = (t) => String(t || '').replace(/^(Post|Personal note to past clients)\s*:\s*/i, '').replace(/["“”]/g, '').trim();
async function stepIndex(sb, today, keys) {
  const sel = 'step_key, channel, step, scheduled_day';
  const recent = must(await sb.from('strategy_campaign_steps').select(sel).gte('scheduled_day', addDays(today, -14)).lte('scheduled_day', addDays(today, 7)).limit(1000), 'strategy_campaign_steps');
  const extra = keys.length ? must(await sb.from('strategy_campaign_steps').select(sel).in('step_key', keys), 'strategy_campaign_steps') : [];
  const rows = [...new Map([...recent, ...extra].map((s) => [s.step_key, s])).values()];
  const ticks = rows.length ? must(await sb.from('strategy_campaign_ticks').select('tick_key, is_ticked, status, moved_to').eq('property_url', PROP).in('tick_key', rows.map((s) => s.step_key)), 'strategy_campaign_ticks') : [];
  const tick = new Map(ticks.map((t) => [t.tick_key, t]));
  return new Map(rows.map((s) => {
    const t = tick.get(s.step_key);
    return [s.step_key, { key: s.step_key, channel: s.channel, title: shortStep(s.step), day: t?.moved_to || String(s.scheduled_day || '').slice(0, 10) || null, done: !!(t && (t.is_ticked || DONE.has(t.status))) }];
  }));
}

/**
 * Suppressed contacts showing as subscribed again: total (not cleared), decided (Alan: keep blocked) and open (new).
 * `kept` = the keep_blocked records' email hashes; read here when not given (Marketing overview, data-health tile).
 */
export async function blockedCounts(sb, kept = null) {
  const keep = kept || new Set(must(await sb.from('marketing_decisions').select('ref_key').eq('kind', 'keep_blocked'), 'marketing_decisions').map((r) => r.ref_key));
  const people = await selectAll(sb, 'customer_person', 'person_id, facts', (q) => q.eq('facts->>subscribed', 'true').not('facts->>suppressed', 'is', null));
  const hashes = [...new Set(people.map((p) => emailHash(p.facts?.email)).filter(Boolean))];
  if (!hashes.length) return { total: 0, decided: 0, open: 0 };
  const resolved = new Set(must(await sb.from('marketing_suppression').select('email_hash').in('email_hash', hashes).not('resolved_at', 'is', null), 'marketing_suppression').map((r) => r.email_hash));
  const live = hashes.filter((h) => !resolved.has(h));
  const decided = live.filter((h) => keep.has(h)).length;
  return { total: live.length, decided, open: live.length - decided };
}

async function strategyBits(sb) {
  const [actions, links, inits, verified, drafts] = await Promise.all([
    sb.from('strategy_quarter_actions').select('action_key, label, due_week_start, is_ticked, status, waiting_on').eq('property_url', PROP).limit(500),
    sb.from('strategy_initiative_links').select('ref_type, ref_key, initiative_key').eq('property_url', PROP).eq('ref_type', 'action').limit(1000),
    sb.from('strategy_initiatives').select('initiative_key, owner').eq('property_url', PROP).limit(200),
    sb.from('strategy_campaigns').select('campaign_key, title, planned_send_on').eq('property_url', PROP).eq('stage', 'verified').limit(100),
    sb.from('strategy_campaigns').select('campaign_key', { count: 'exact', head: true }).eq('property_url', PROP).eq('stage', 'drafted')
  ]);
  return { actions: must(actions, 'strategy_quarter_actions'), links: must(links, 'strategy_initiative_links'), initiatives: new Map(must(inits, 'strategy_initiatives').map((i) => [i.initiative_key, i])), verified: must(verified, 'strategy_campaigns'), drafts: drafts.count || 0 };
}

/** The shared state. `today` = London day (YYYY-MM-DD). */
export async function buildDecisionState(sb, { today = londonDay(Date.now()) } = {}) {
  const [records, placements, st, content, frequency, prospects] = await Promise.all([
    sb.from('marketing_decisions').select('decision_key, kind, ref_key, decision, reason, decided_by, decided_at, source').limit(1000),
    sb.from('marketing_social_placements').select('step_key, placement, stage, provider_id, provider_url, actual_at, planned_at, public_caption, link_url, assets').eq('property_url', PROP).limit(2000),
    strategyBits(sb), restrictedContent(sb), frequencyWindow(sb, today), stalledProspects(sb, today).catch(() => [])
  ]);
  const idx = decisionIndex(must(records, 'marketing_decisions'));
  const pls = must(placements, 'marketing_social_placements');
  const steps = await stepIndex(sb, today, [...new Set(pls.map((p) => p.step_key))]);
  const release = releaseSplit(pls, steps, today, idx.deferred);
  const futureDrafts = pls.filter((p) => !isPublished(p) && !handled(p) && p.planned_at && londonDay(p.planned_at) >= today).length;
  const blocked = await blockedCounts(sb, idx.keptBlocked);
  const open = openDecisions({
    today, planApproved: idx.planApproved, drafts: st.drafts + futureDrafts, release: release.ready, outlook: outlookDue(steps, today, idx.deferred),
    blockedOpen: blocked.open, blocked, actions: alanActions(st.actions, st.links, st.initiatives, today), verified: st.verified, content, frequency, prospects
  });
  return {
    as_of: new Date().toISOString(), today,
    plan_approved: idx.planApproved ? { decided_at: idx.planApproved.decided_at, decided_by: idx.planApproved.decided_by, reason: idx.planApproved.reason } : null,
    published: pls.filter(isPublished).map((p) => ({ step_key: p.step_key, placement: p.placement, provider_url: p.provider_url, actual_at: p.actual_at, title: steps.get(p.step_key)?.title || null })),
    deferred: [...idx.deferred], kept_blocked: idx.keptBlocked.size, blocked, frequency, production_queue: release.production, open, count: open.length
  };
}
