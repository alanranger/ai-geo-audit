/**
 * Quarter plan: initiatives are the canonical programme records (approved v2 plan, 8 Nov 2026).
 * Chain: objective + KPI (Targets panel roadmap) → initiative (public.strategy_initiatives) → campaign (strategy_campaigns
 * or a derived weekly-email / event record) → channel delivery (a campaign step key, or send|<campaign_key> for a theme
 * campaign's own send) → content asset (public.strategy_content_assets.used_in). Quarters reference initiatives
 * (public.strategy_quarter_plans.initiative_keys); nothing is copied. public.strategy_initiative_links holds the stored
 * primary / supporting links and the purpose tags; anything without a stored link gets the rule link shown as "rule".
 * Each campaign / delivery has exactly one primary initiative, so revenue and sends are attributed once.
 * Purpose: one primary of Sell / Educate / Inspire / Nurture per delivery (optional secondary); deliveries are counted
 * once, the module mix (each featured item of a delivery) is counted separately.
 */
import { attachStatus, fallbackStatus, statusLine } from './strategy-delivery-status.mjs';
import { KPI_FIELD, initiativeStatus, insightTile, kpiBoxes, measureFor, milestoneActual, scheduleOf } from './strategy-initiative-measures.mjs';

export { scheduleOf };

export const PURPOSES = ['sell', 'educate', 'inspire', 'nurture'];
export const OWNERS = ['Claude', 'GPT', 'Alan'];
export const PROGRAMME_KEY = 'prog-learning-relationships';
export const HOUSEKEEPING_KEY = 'housekeeping';

const DAY = 86400000;
const addDays = (s, n) => new Date(Date.parse(`${s}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const d10 = (v) => (v ? String(v).slice(0, 10) : null);

/* ---------- load ---------- */

function rowsOf(table) {
  return (r) => {
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data || [];
  };
}
export async function loadInitiativeRecords(supabase, propertyUrl) {
  const all = (t) => supabase.from(t).select('*').eq('property_url', propertyUrl).limit(2000).then(rowsOf(t));
  const [initiatives, quarters, links, assets, campaignRows] = await Promise.all([
    all('strategy_initiatives'), all('strategy_quarter_plans'), all('strategy_initiative_links'), all('strategy_content_assets'),
    all('strategy_campaigns')
  ]);
  return { initiatives, quarters, links, assets, campaignRows };
}

/* ---------- links ---------- */

export function linkIndex(links) {
  const primary = new Map();
  const supporting = new Map();
  for (const l of links || []) {
    const k = `${l.ref_type}|${l.ref_key}`;
    if (l.role === 'primary') primary.set(k, l);
    else (supporting.get(k) || supporting.set(k, []).get(k)).push(l.initiative_key);
  }
  return { primary, supporting };
}

/** Date-window rules on initiatives (focus.event_rule): which initiative a dated event's campaign belongs to. */
export function eventRules(initiatives) {
  return (initiatives || []).filter((i) => i.focus?.event_rule)
    .map((i) => ({ key: i.initiative_key, ...i.focus.event_rule, priority: i.focus.rule_priority ?? 50 }))
    .sort((a, b) => a.priority - b.priority);
}
export const inferKind = (text) => (/week\s*\d+\s*of|course|classes|lessons|beginner/i.test(String(text || '')) ? 'course' : 'workshop');
export function initiativeForEvent(rules, date, kind) {
  const d = d10(date);
  if (!d) return null;
  const hit = rules.find((r) => d >= r.from && d <= r.to && (!r.kinds || r.kinds.includes(kind)));
  return hit ? hit.key : null;
}
const coverDate = (k) => (String(k || '').match(/\|(\d{4}-\d{2}-\d{2})\|/) || [])[1] || null;

function ruleForCampaign(rec, rules) {
  if (rec.kind === 'event') return initiativeForEvent(rules, rec.event?.date || coverDate(`|${rec.event_key}`), rec.event?.kind === 'course' ? 'course' : inferKind(rec.title));
  if (rec.kind !== 'weekly_email') return null;
  const lead = (rec.covers || []).find((k) => coverDate(k));
  return lead ? initiativeForEvent(rules, coverDate(lead), inferKind(lead)) : PROGRAMME_KEY;
}
/** One primary initiative per campaign: the stored link, else the date rule; never both. */
export function resolveCampaign(rec, idx, rules) {
  const k = `campaign|${rec.campaign_key}`;
  const set = idx.primary.get(k);
  const initiative_key = set?.initiative_key || ruleForCampaign(rec, rules);
  return { initiative_key, source: set ? 'set' : (initiative_key ? 'rule' : 'unlinked'), supporting: idx.supporting.get(k) || [] };
}

/* ---------- deliveries ---------- */

const DROPPED_STATES = new Set(['skipped', 'not_needed']);
const notDelivery = (s) => s.channel === 'Quarter action' || s.gbp === 'check' || !!s.optional || DROPPED_STATES.has(s.state?.status) || !!(s.is_email && s.covered_by?.length);
function stepDelivery(s, week) {
  return {
    key: s.key, alias: s.targeted && s.link?.campaign_key ? `send|${s.link.campaign_key}` : null, campaign_key: s.link?.campaign_key || null,
    week, day: s.day, channel: s.channel, title: s.step, brief: s.brief || '', status: s.state?.status || 'pending',
    is_email: !!s.is_email || /Squarespace/.test(s.channel || ''), targeted: !!s.targeted, draft: !!s.manual && !s.state?.resolved,
    featured: (s.featured || []).map((f) => ({ name: f.name, when: f.when, date: f.date, title: f.title })), covers: s.covers || []
  };
}
const SEND_STAGES = new Set(['drafted', 'approved', 'scheduled', 'sent', 'measured']);
function sendDelivery(r) {
  const sch = scheduleOf(r);
  const sent = !!(r.sent_on || r.actual_sends);
  return {
    key: `send|${r.campaign_key}`, alias: null, campaign_key: r.campaign_key, week: null,
    day: d10(r.sent_on || sch?.scheduled_for || r.planned_send_on || r.window_start), scheduled_for: sch?.scheduled_for || null,
    channel: 'Squarespace email (targeted)', title: r.title, brief: '', status: sent ? 'sent' : r.stage, sent, draft: r.stage === 'drafted' && !sent,
    reserved_sends: r.reserved_sends ?? null, actual_sends: r.actual_sends ?? null, recipients: sch?.recipients ?? null,
    is_email: true, targeted: true, featured: [], covers: []
  };
}
/** The 4-week campaign view's deliveries: steps (not quarter actions, checks or optional updates) + theme / event sends. */
export function deliveriesFrom(campaign, campaignRows) {
  const weeks = campaign?.weeks || [];
  const out = weeks.flatMap((w) => (w.steps || []).filter((s) => !notDelivery(s)).map((s) => stepDelivery(s, w.week)));
  const from = weeks[0]?.week || null;
  const to = weeks.length ? addDays(weeks[weeks.length - 1].week, 6) : null;
  const viaStep = new Set(out.map((d) => d.campaign_key).filter(Boolean));
  for (const r of campaignRows || []) {
    if (r.kind === 'weekly_email' || !SEND_STAGES.has(r.stage) || viaStep.has(r.campaign_key)) continue;
    const d = sendDelivery(r);
    if (from && d.day && d.day >= from && d.day <= to) out.push(d);
  }
  return { list: out, window: { from, to } };
}

/* ---------- purpose ---------- */

const P = (primary, secondary = []) => ({ primary, secondary });
const PURPOSE_RULES = [
  [(d) => d.is_email && !d.featured.length && !d.targeted, P('nurture')],
  [(d) => d.is_email && /Light & Logic folded in/.test(d.brief), P('sell', ['educate'])],
  [(d) => d.is_email, P('sell')],
  [(d) => /Outlook/.test(d.channel), P('sell', ['nurture'])],
  [(d) => /useful photography tip/i.test(d.title), P('educate')],
  [(d) => /LinkedIn/.test(d.channel), (d) => (d.featured.length ? P('sell', ['educate']) : P('educate'))],
  [(d) => /"Last|Last chance|Google Business update/.test(d.title), P('sell')],
  [(d) => /Facebook|Instagram/.test(d.channel), (d) => (d.featured.length ? P('inspire', ['sell']) : P('inspire'))]
];
/** Channel default for a delivery's purpose (shown as "rule"; a stored tag always wins). */
export function purposeRule(d) {
  const hit = PURPOSE_RULES.find(([test]) => test(d));
  if (!hit) return P('sell');
  return typeof hit[1] === 'function' ? hit[1](d) : hit[1];
}
function modulesOf(d, purpose) {
  const mods = d.featured.map((f) => ({ label: `${f.name || f.title || ''} ${f.when || ''}`.trim(), purpose: 'sell' }));
  if (d.is_email && /Light & Logic folded in/.test(d.brief)) mods.push({ label: 'Light & Logic', purpose: 'educate' });
  return mods.length ? mods : [{ label: d.title, purpose: purpose.primary }];
}
function ruleForDelivery(d, rules, campaignInit) {
  if (d.campaign_key && campaignInit.get(d.campaign_key)) return campaignInit.get(d.campaign_key);
  const lead = d.featured.find((f) => f.date);
  return lead ? initiativeForEvent(rules, lead.date, inferKind(lead.title)) : PROGRAMME_KEY;
}
/** The delivery's own purpose tag, else (a theme / event send) its campaign's stored tag. */
function purposeTag(d, idx, set) {
  if (set?.purpose_primary) return set;
  const camp = d.key.startsWith('send|') && d.campaign_key ? idx.primary.get(`campaign|${d.campaign_key}`) : null;
  return camp?.purpose_primary ? camp : null;
}
/** Initiatives a delivery supports (its own supporting links or its campaign's): they count it for their next action, never for revenue or the mix. */
function supportsOf(d, idx, primaryKey) {
  const refs = [`delivery|${d.key}`, d.alias && `delivery|${d.alias}`, d.campaign_key && `campaign|${d.campaign_key}`].filter(Boolean);
  return [...new Set(refs.flatMap((r) => idx.supporting.get(r) || []))].filter((k) => k !== primaryKey);
}
export function resolveDelivery(d, idx, rules, campaignInit) {
  const set = idx.primary.get(`delivery|${d.key}`) || (d.alias ? idx.primary.get(`delivery|${d.alias}`) : null);
  const initiative_key = set?.initiative_key || ruleForDelivery(d, rules, campaignInit);
  const tag = purposeTag(d, idx, set);
  const purpose = tag ? P(tag.purpose_primary, tag.purpose_secondary || []) : purposeRule(d);
  return {
    ...d, initiative_key, initiative_source: set ? 'set' : (initiative_key ? 'rule' : 'unlinked'), supports: supportsOf(d, idx, initiative_key),
    purpose, purpose_source: tag ? 'set' : 'rule', modules: set?.module_purposes || modulesOf(d, purpose)
  };
}
const zero = () => Object.fromEntries(PURPOSES.map((p) => [p, 0]));
const NOT_YET_ON_PLATFORM = new Set(['waiting_window', 'in_preparation', 'story_ready', 'needs_approval']);
/** Content Alan approved that the platform can't take yet (provider window): approved, not a draft, not scheduled. */
export const approvedWaiting = (d) => !!d.delivery_status && (d.delivery_status.code === 'waiting_window' || (!!d.delivery_status.approved && NOT_YET_ON_PLATFORM.has(d.delivery_status.code)));
/** One counted delivery, slim (Marketing "by channel" tile counts the same list, so the two tiles reconcile). */
const mixItem = (d) => ({ key: d.key, day: d.day, channel: d.channel, title: d.title, draft: !!d.draft, waiting: !d.draft && approvedWaiting(d), code: d.delivery_status?.code || null, at: d.delivery_status?.at || d.scheduled_for || null, purpose: d.purpose?.primary || null });
const byPrimary = (list) => list.reduce((o, d) => ({ ...o, [d.purpose.primary]: o[d.purpose.primary] + 1 }), zero());
/**
 * Deliveries counted once by primary purpose; the module mix is a separate count. Scheduled / approved and draft
 * proposals (GPT's drafted sends and manual steps) are never merged: by_primary = scheduled / approved only.
 */
export function purposeMix(deliveries, window) {
  const mods = zero();
  const live = deliveries.filter((d) => !d.draft);
  const drafts = deliveries.filter((d) => d.draft);
  const waiting = live.filter(approvedWaiting);
  const set = live.filter((d) => d.purpose_source === 'set').length;
  for (const d of live) for (const m of d.modules) mods[m.purpose] = (mods[m.purpose] || 0) + 1;
  const draftSet = drafts.filter((d) => d.purpose_source === 'set').length;
  return {
    items: deliveries.map(mixItem),
    window, deliveries: live.length, by_primary: byPrimary(live), set_by_hand: set, by_rule: live.length - set,
    waiting: { deliveries: waiting.length, by_primary: byPrimary(waiting), label: 'Approved · waiting for platform window' },
    source_text: `purpose source: scheduled / approved ${set} stored · ${live.length - set} channel rule; drafts ${draftSet} stored · ${drafts.length - draftSet} channel rule (stored = explicit tag, rule = channel default)`,
    draft: { deliveries: drafts.length, by_primary: byPrimary(drafts), set_by_hand: drafts.filter((d) => d.purpose_source === 'set').length },
    modules: { total: Object.values(mods).reduce((a, b) => a + b, 0), by_purpose: mods },
    basis: `campaign steps, theme / event sends and manual steps dated ${window?.from || '?'} → ${window?.to || '?'} (today + ${MIX_DAYS} days, rolling); one primary purpose per delivery (stored strategy_initiative_links tag, the campaign's tag for its send, else the channel rule); draft proposals counted apart, never in the scheduled / approved line; modules = each featured date or folded-in item of scheduled / approved deliveries`
  };
}

/** Content-mix window (Marketing tile 6): rolling, today and the next 83 days = 84 days (12 weeks). */
export const MIX_DAYS = 84;
export const mixWindow = (today) => ({ from: today, to: addDays(today, MIX_DAYS - 1), days: MIX_DAYS });
/**
 * Deliveries in the content-mix window: the campaign view's (from today on) plus the stored sends and manual steps
 * after it (laterDeliveries), leaving out quarter actions, checks and optional updates as the campaign view does.
 */
export function mixDeliveries(deliveries, later, campaign, win) {
  const notMix = new Set((campaign?.carried?.future || []).filter(notDelivery).map((s) => s.key));
  const inWin = (d) => !!d.day && d.day >= win.from && d.day <= win.to;
  return [...deliveries, ...later.filter((d) => !notMix.has(d.key))].filter(inWin);
}

/* ---------- actions (strategy_quarter_actions, mapped once) ---------- */

export function actionViews(actions, idx) {
  return (actions || []).map((a) => {
    const l = idx.primary.get(`action|${a.action_key}`);
    return {
      id: a.id, action_key: a.action_key, quarter_key: a.quarter_key, label: a.label, due: d10(a.due_week_start), sort_order: a.sort_order,
      is_ticked: !!a.is_ticked, ticked_at: a.ticked_at || null, status: a.status || null, waiting_on: a.waiting_on || null,
      initiative_key: l?.initiative_key || null, related_ref: l?.related_ref || null
    };
  });
}
/** Old vs new counts per quarter: every action row appears once, under an initiative or Housekeeping. */
export function actionMapping(views) {
  const by = {};
  for (const a of views) {
    const q = (by[a.quarter_key] = by[a.quarter_key] || { old: 0, mapped: 0, under_initiatives: 0, housekeeping: 0, ticked: 0 });
    q.old += 1;
    if (a.is_ticked) q.ticked += 1;
    if (!a.initiative_key) continue;
    q.mapped += 1;
    q[a.initiative_key === HOUSEKEEPING_KEY ? 'housekeeping' : 'under_initiatives'] += 1;
  }
  return { by_quarter: by, unmapped: views.filter((a) => !a.initiative_key).map((a) => a.action_key) };
}

/* ---------- assemble ---------- */

const campaignView = (r, res) => ({
  campaign_key: r.campaign_key, kind: r.kind, title: r.title, stage: r.stage || 'proposed', window_start: d10(r.window_start), window_end: d10(r.window_end),
  initiative_key: res.initiative_key, source: res.source, supporting: res.supporting
});
function attachAssets(deliveries, assets) {
  for (const d of deliveries) d.assets = assets.filter((a) => a.used_in?.includes(d.key) || (d.alias && a.used_in?.includes(d.alias))).map((a) => a.asset_key);
}
function initiativeAssets(key, deliveries, assets) {
  const viaDelivery = new Set(deliveries.filter((d) => d.initiative_key === key).flatMap((d) => d.assets || []));
  return assets.filter((a) => viaDelivery.has(a.asset_key) || a.used_in?.includes(`initiative|${key}`))
    .map((a) => ({ asset_key: a.asset_key, kind: a.kind, title: a.title, url: a.url, status: a.status, reuse: a.reuse, used_in: a.used_in }));
}
function linksOut(campaigns, deliveries, byKey) {
  const out = {};
  const title = (k) => byKey.get(k)?.title || null;
  for (const c of campaigns) out[`campaign|${c.campaign_key}`] = { initiative_key: c.initiative_key, title: title(c.initiative_key), source: c.source };
  for (const d of deliveries) {
    const v = { initiative_key: d.initiative_key, title: title(d.initiative_key), source: d.initiative_source, purpose: d.purpose, purpose_source: d.purpose_source };
    out[`delivery|${d.key}`] = v;
    if (d.alias) out[`delivery|${d.alias}`] = v;
  }
  return out;
}
/* ---------- next action from the plan ---------- */

const CLOSED = new Set(['done', 'auto_done', 'sent', 'published', 'measured', 'skipped', 'not_needed', 'cancelled', 'superseded', 'resolved']);
const SHORT = [[/Squarespace/, 'Email'], [/Facebook|Instagram/, 'FB/IG'], [/LinkedIn/, 'LinkedIn'], [/Outlook/, 'Outlook note'], [/Google/, 'Google']];
const channelShort = (c) => (SHORT.find(([re]) => re.test(c || '')) || [null, c || 'Delivery'])[1];
const isOpen = (d, today) => !!d.day && d.day >= today && !d.sent && !CLOSED.has(d.status) && d.delivery_status?.code !== 'on_hold';

/** Linked sends and manual drafts after the 4-week view (e.g. Academy's 1 Dec drafts): shown on their initiative, not in the mix. */
export function laterDeliveries(x, idx, rules, campaignInit, window) {
  const after = (d) => !!d.day && !!window.to && d.day > window.to;
  const sends = (x.campaignRows || []).filter((r) => r.kind !== 'weekly_email' && SEND_STAGES.has(r.stage)).map(sendDelivery).filter(after);
  const manual = (x.campaign?.carried?.future || []).map((s) => stepDelivery(s, s.week)).filter(after);
  return attachStatus(markPublished([...sends, ...manual], x.published), x.statusIndex).map((d) => ({ ...resolveDelivery(d, idx, rules, campaignInit), beyond_window: true }));
}

/**
 * Next action = the earliest open linked delivery (campaign step, send or draft) on or after today; stored text only
 * when nothing linked is still to come, labelled "manual".
 */
const isRecommendation = (d) => String(d.key).startsWith('step|') && !d.targeted;
const atOf = (d) => String(d.delivery_status?.at || d.scheduled_for || '');
const byDay = (a, b) => a.day.localeCompare(b.day) || atOf(a).localeCompare(atOf(b)) || String(a.key).localeCompare(String(b.key));
/**
 * Each item carries the ONE delivery status (board, else the same vocabulary from the plan record) and its line. The
 * title says "draft" only while it is one (attachStatus clears it once the platform has it or Alan approved it).
 */
const itemOf = (d, source) => {
  const st = d.delivery_status || fallbackStatus(d);
  return { source, day: d.day, text: `${channelShort(d.channel)}${d.draft ? ' draft' : ''}: ${d.title}`, key: d.key, draft: !!d.draft, status: st, status_line: statusLine(st, d.day) };
};
export function nextActionOf(ini, deliveries, today) {
  const open = deliveries.filter((d) => isOpen(d, today)).sort(byDay);
  const actual = open.filter((d) => !isRecommendation(d));
  if (actual.length) return { ...itemOf(actual[0], 'plan'), then: actual[1] ? itemOf(actual[1], 'plan') : null, linked: deliveries.length };
  if (open.length) return { ...itemOf(open[0], 'recommended'), then: null, linked: deliveries.length };
  if (!ini.next_action) return null;
  return { source: 'manual', day: d10(ini.next_action_date), text: ini.next_action, then: null, linked: deliveries.length, ...(ini.focus?.data_source ? { data_source: ini.focus.data_source } : {}) };
}

const ACTIONABLE = new Set(['drafted', 'approved', 'scheduled']);
const sendAt = (r) => (r.scheduled_for ? new Date(r.scheduled_for).toISOString() : (r.planned_send_on ? `${d10(r.planned_send_on)}T23:59:59Z` : null));
const supersededRow = (r) => r.stage === 'superseded' || !!r.superseded_by || !!r.fulfilled_by;
/**
 * Strategy "Next campaign": the earliest stored campaign still to send (drafted / approved / scheduled, not sent, not
 * cancelled or superseded) whose send time (or day) is now or later. Generated weekly placeholders are never picked.
 */
export function nextCampaignOf(rows, nowIso) {
  const view = (r) => r && { campaign_key: r.campaign_key, title: r.title, kind: r.kind, stage: r.stage, day: d10(r.scheduled_for ? new Date(r.scheduled_for).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) : r.planned_send_on), scheduled_for: r.scheduled_for || null, provider_scheduled: !!r.schedule_evidence };
  const list = (rows || []).filter((r) => ACTIONABLE.has(r.stage) && !r.sent_on && !r.actual_sends && !supersededRow(r) && sendAt(r) && sendAt(r) >= nowIso)
    .sort((a, b) => sendAt(a).localeCompare(sendAt(b)) || String(a.campaign_key).localeCompare(String(b.campaign_key)));
  return list.length ? { ...view(list[0]), then: view(list[1]) || null, basis: 'stored campaign records only (drafted / approved / scheduled, not sent, cancelled or superseded), earliest send time from now; generated weekly placeholders are recommendations, never the next campaign' } : null;
}

/**
 * Revenue target / actual / gap for the card: only where the initiative has a revenue target (measure.target_total,
 * e.g. Gifts). Unknown actual lines stay unknown (the actual is then "at least", the gap "at most"); no target = "—"
 * with the owner, never £0.
 */
export function revenueOf(ini, m) {
  const owner = ini.owner_detail || ini.owner || 'unassigned';
  if (!m?.target_total) return { target: null, owner, note: 'no revenue target set' };
  const lines = m.target_lines || [];
  const actual = lines.filter((l) => l.actual != null).reduce((a, l) => a + Number(l.actual), 0);
  const unknown = lines.filter((l) => l.actual == null).map((l) => l.label);
  return { target: Number(m.target_total), actual, actual_complete: !unknown.length, unknown, gap: Math.max(0, Number(m.target_total) - actual), window: m.window || null, owner };
}

/** Roadmap KPI keys an initiative names: its target's milestone (e.g. Pick n Mix "plans"), then focus.metrics. */
export const kpiKeysOf = (ini) => [...new Set([ini.target?.milestone, ...(ini.focus?.metrics || [])].filter((k) => KPI_FIELD[k]))];

/**
 * Count / £ target line from the SAME KPI box the quarter card shows (Targets panel roadmap milestone): the box of the
 * first KPI the initiative names, in the first of its quarters that has one. Actual = the box's actual (the same
 * milestoneActual() for a future quarter). Null when the initiative names no roadmap KPI.
 */
export function kpiTargetOf(ini, quarters, ctx) {
  const keys = kpiKeysOf(ini);
  const box = (quarters || []).filter((q) => (ini.quarter_keys || []).includes(q.key)).flatMap((q) => q.kpis || []).find((k) => k.key === keys[0] && k.target != null);
  if (!box) return null;
  const actual = box.actual ?? milestoneActual(box.key, ctx);
  return {
    kind: 'kpi', key: box.key, label: box.label, unit: box.unit, target: box.target, actual, actual_complete: actual != null,
    gap: actual == null ? null : Math.max(0, box.target - actual), window: { end: box.by }, milestone: box.milestone, also: keys.slice(1), owner: ini.owner_detail || ini.owner || 'unassigned'
  };
}
/** The initiative's target line: a revenue target where one exists, else its roadmap KPI, else "—" with the owner. */
export function targetLineOf(ini, m, quarters, ctx) {
  const rev = revenueOf(ini, m);
  return rev.target != null ? rev : kpiTargetOf(ini, quarters, ctx) || rev;
}

/** An unknown target names who owns it, the next step and a due date; no target is invented. */
const UNKNOWN_KINDS = new Set(['target_proposal', 'needs_review']);
export function unknownTargetOf(ini, status, next) {
  if (!status || !UNKNOWN_KINDS.has(status.kind)) return null;
  return { owner: status.owner || ini.owner || 'unassigned', next_step: status.kind === 'needs_review' ? (status.reason || 'review the evidence') : 'propose a dated target from actuals for Alan to approve', due: status.due || next?.day || null, basis: status.basis || null };
}

/** No target yet: the target line names the proposal ("Target: Claude proposal due Wed 11 Nov"), never a bare "—". */
const withProposal = (rev, status) => (rev && rev.target == null && status?.kind === 'target_proposal' ? { ...rev, proposal_line: status.label, owner: status.owner, due: status.due } : rev);
function initiativeView(ini, ctx, parts) {
  const k = ini.initiative_key;
  const m = measureFor(ini, ctx);
  const deliveries = parts.deliveries.filter((d) => d.initiative_key === k || d.supports?.includes(k))
    .map((d) => (d.initiative_key === k ? d : { ...d, role: 'supporting' }));
  const status = initiativeStatus(ini, m, ctx.today);
  const next = nextActionOf(ini, deliveries, ctx.today);
  return {
    next, unknown_target: unknownTargetOf(ini, status, next), revenue: withProposal(targetLineOf(ini, m, parts.quarters, ctx), status),
    key: k, kind: ini.kind, title: ini.title, quarter_keys: ini.quarter_keys || [], start_date: d10(ini.start_date), end_date: d10(ini.end_date),
    summary: ini.summary, delivery_plan: ini.delivery_plan, why_now: ini.why_now, owner: ini.owner, owner_detail: ini.owner_detail,
    next_action: ini.next_action, next_action_date: d10(ini.next_action_date), review_date: d10(ini.review_date),
    review_overdue: !!ini.review_date && d10(ini.review_date) < ctx.today, status_label: ini.status_label || null,
    status, measure: m, target: ini.target || null, forecast: ini.forecast || null,
    campaigns: parts.campaigns.filter((c) => c.initiative_key === k), deliveries,
    actions: parts.actions.filter((a) => a.initiative_key === k), assets: initiativeAssets(k, parts.deliveries, ctx.assets || []),
    updated_at: ini.updated_at || null, set_by: ini.set_by || null
  };
}
function quarterState(q, today) {
  if (d10(q.end_date) < today) return 'past';
  return d10(q.start_date) <= today ? 'current' : 'future';
}
function quarterViews(quarters, ctx, inis) {
  const sorted = [...quarters].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  const cur = Math.max(0, sorted.findIndex((q) => quarterState(q, ctx.today) === 'current'));
  return sorted.map((q, i) => {
    const state = quarterState(q, ctx.today);
    const starts = (q.initiative_keys || []).some((k) => inis.get(k)?.start_date && d10(inis.get(k).start_date) <= ctx.today);
    return {
      key: q.quarter_key, label: q.label, start_date: d10(q.start_date), end_date: d10(q.end_date), theme: q.theme, review_note: q.review_note,
      state, display: i === cur || i === cur + 1 ? 'full' : 'compact', selling_started: state === 'future' && starts,
      milestone_key: q.milestone_key, kpis: kpiBoxes(q, state, ctx), initiative_keys: q.initiative_keys || [],
      programme_key: q.programme_key, housekeeping_key: q.housekeeping_key
    };
  });
}

/**
 * Pure assembly (tested): `x` = { today, txns, gpRates, master, diary, campaign, actions, insights, roadmapNow,
 * courseLastNights, initiatives, quarters, links, assets, campaignRows }.
 */
/** Posts the shared decision state records as published (provider id / URL) are done, never drafts or next actions. */
export function markPublished(list, published) {
  const done = new Set(published || []);
  return done.size ? list.map((d) => (done.has(d.key) ? { ...d, status: 'published', sent: true, draft: false } : d)) : list;
}
export function assemblePlan(x) {
  const idx = linkIndex(x.links);
  const rules = eventRules(x.initiatives);
  const records = (x.campaign?.campaigns || []).concat((x.campaignRows || []).filter((r) => !(x.campaign?.campaigns || []).some((c) => c.campaign_key === r.campaign_key)));
  const campaigns = records.map((r) => campaignView(r, resolveCampaign(r, idx, rules)));
  const campaignInit = new Map(campaigns.map((c) => [c.campaign_key, c.initiative_key]));
  const { list, window } = deliveriesFrom(x.campaign, x.campaignRows);
  const deliveries = attachStatus(markPublished(list, x.published), x.statusIndex).map((d) => resolveDelivery(d, idx, rules, campaignInit));
  attachAssets(deliveries, x.assets || []);
  const actions = actionViews(x.actions, idx);
  const later = laterDeliveries(x, idx, rules, campaignInit, window);
  const win = mixWindow(x.today);
  const mix = purposeMix(mixDeliveries(deliveries, later, x.campaign, win), win);
  const byKey = new Map((x.initiatives || []).map((i) => [i.initiative_key, i]));
  const ctx = { ...x, pnm: x.pnm || insightTile(x.insights, 'mix-pick-n-mix')?.numbers || null, purposeMix: mix, deliveries, byKey };
  const quarters = quarterViews(x.quarters || [], ctx, byKey);
  const parts = { campaigns, deliveries: [...deliveries, ...later], actions, quarters };
  const initiatives = Object.fromEntries((x.initiatives || []).map((i) => [i.initiative_key, initiativeView(i, ctx, parts)]));
  return {
    as_of: x.today, data_through: x.insights?.booking_sheet_imported_at || null,
    quarters, initiatives, links: linksOut(campaigns, deliveries, byKey),
    action_initiative: Object.fromEntries(actions.map((a) => [a.action_key, a.initiative_key])),
    action_owner: Object.fromEntries(actions.map((a) => [a.action_key, byKey.get(a.initiative_key)?.owner || null])),
    action_mapping: actionMapping(actions), purpose_mix: mix,
    unlinked: { campaigns: campaigns.filter((c) => !c.initiative_key).map((c) => c.campaign_key), deliveries: deliveries.filter((d) => !d.initiative_key).map((d) => d.key) },
    programme_key: PROGRAMME_KEY, housekeeping_key: HOUSEKEEPING_KEY,
    next_campaign: nextCampaignOf(x.campaignRows, x.now || new Date().toISOString())
  };
}

/** Beginners / course last nights from the live website course dates ("Week N of N"), today or later. */
export function courseLastNights(feeds, today) {
  const list = (feeds?.courses || feeds?.beginners || []).map((e) => ({ e, w: /week\s*(\d+)\s*of\s*(\d+)/i.exec(e?.title || '') }));
  return list.filter(({ e, w }) => w && w[1] === w[2] && e.date >= today)
    .map(({ e }) => ({ date: e.date, title: e.title, beginners: /beginner/i.test(e.title) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildQuarterPlan(supabase, propertyUrl, base) {
  const rec = await loadInitiativeRecords(supabase, propertyUrl);
  return assemblePlan({ ...base, ...rec, courseLastNights: courseLastNights(base.feeds, base.today) });
}
