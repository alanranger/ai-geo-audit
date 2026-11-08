/**
 * Campaign step status: done automatically where the dashboard can see evidence, manual (Alan / ChatGPT) otherwise.
 * Order per step: manual state (tick / skip / not needed, strategy_campaign_ticks; quarter card tick) → automatic
 * evidence → time (pending / late / older).
 * - Squarespace email step: a sent campaign (sqs_email_campaigns) in the step's week whose list is the weekly email
 *   record's chosen audience (full list, its segments or its export list). A subject naming a lead date is not enough,
 *   and a send linked to any other campaign record (e.g. an event's targeted email) never counts. One match = done
 *   automatically, linked on the weekly email record; more than one = "link this email?" (never guessed).
 * - Targeted email: a send linked to an event / theme record in that week becomes its own done step
 *   ("<name> targeted email: sent <day time> · <n> · <list>"), with its results; it does not complete the weekly email.
 * - Event step (posts, LinkedIn, Outlook): every date it features has since sold out, been withdrawn (no longer listed),
 *   been set to "don't promote" or been cancelled (hook: ctx.cancelled) = "not needed" with the reason.
 * - Quarter action: only with a rule in QUARTER_EVIDENCE; before the rule's first evidence day it is "waiting", not late.
 * - Late: planned (or moved-to) day passed with no state = "late · planned <day>"; more than 14 days = "older".
 * Register: strategy_campaign_steps keeps each week's steps so late / older steps survive the week rolling on.
 */
import { shortName, ukDay } from './strategy-board-rows.mjs';
import { QUARTER_EVIDENCE, evidenceHit, evidenceRuleFor } from './strategy-action-evidence.mjs';

export { QUARTER_EVIDENCE };

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(`${s}T12:00:00Z`) + n * DAY);
export const OLDER_DAYS = 14;
const SENT = new Set(['sent', 'measured']);
const RESOLVED = new Set(['done', 'auto_done', 'skipped', 'not_needed']);
export const FULL_LIST = 'accepts_marketing';
/** Generated plan steps are step|… (and plan|… quarter actions); anything else in the register was added by hand (Alan / GPT). */
export const isGenerated = (key) => /^(step|plan)\|/.test(String(key || ''));

/* ---------- matching a sent Squarespace email ---------- */

const GENERIC = new Set(['and', 'the', 'a', 'of', 'course', 'courses', 'walk', 'masterclass', 'workshop', 'photography', 'long', 'exposure', 'sunset', 'sunrise']);
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !GENERIC.has(w));
const normList = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const weekOf = (s) => s.week || String(s.key || '').split('|')[1];

/** The step's week, Monday to Sunday (stretched to a later moved-to day). */
export function emailWindow(s, movedTo) {
  const start = weekOf(s);
  const end = addDays(start, 6);
  return { start, end: movedTo && movedTo > end ? movedTo : end };
}
/** Lead names (the email's headline), else every featured name; generic words dropped, at least 4 letters. */
function needles(s) {
  const names = s.lead_names?.length ? s.lead_names : (s.featured || []).map((f) => f.name || f.title);
  return names.map(words).filter((w) => w.join('').length >= 4);
}
/** List names the record's audience was loaded as: the full list, its export lists, its segment names. */
function audienceLists(rec, aud) {
  if (rec?.audience === 'full_list') return [FULL_LIST];
  if (rec?.audience !== 'segments') return [];
  const segs = (aud?.segments || []).filter((x) => (rec.segment_ids || []).includes(x.segment_id)).map((x) => x.name);
  const lists = (aud?.exports || []).filter((x) => (rec.export_id && x.export_id === rec.export_id) || x.campaign_key === rec.campaign_key).map((x) => x.list_name);
  return [...segs, ...lists].map(normList).filter(Boolean);
}
/** The audience must match; the subject only adds to the reason shown. */
function whyMatch(c, ns, lists) {
  const aud = lists.length > 0 && (c.mailing_list_names || []).map(normList).some((l) => lists.includes(l));
  if (!aud) return null;
  const sw = new Set(words(c.subject));
  return ns.some((n) => n.every((w) => sw.has(w))) ? 'audience + subject' : 'audience';
}
const otherRecord = (c, key, ctx) => (c.campaign_key && c.campaign_key !== key) || !!ctx.linkedElsewhere?.(c.email_id, key);
/** Sent Squarespace campaigns that evidence this weekly email step (see header). */
export function matchEmail(s, rec, ctx) {
  const w = emailWindow(s, ctx.ticks?.[s.key]?.moved_to);
  const ns = needles(s);
  const lists = audienceLists(rec, ctx.audience);
  const key = rec?.campaign_key || `email|${weekOf(s)}`;
  return (ctx.sqs || [])
    .filter((c) => c.sent_on >= w.start && c.sent_on <= w.end && !otherRecord(c, key, ctx))
    .map((c) => ({ c, why: whyMatch(c, ns, lists) })).filter((x) => x.why)
    .map(({ c, why }) => ({ email_id: c.email_id, subject: c.subject, sent_on: c.sent_on, sent_at: c.sent_at || c.sent_on, lists: c.mailing_list_names || [], why, also_linked_to: ctx.linkedTo?.get(c.email_id) || null }));
}

/* ---------- states ---------- */

const alsoOn = (key) => {
  const [kind, date] = String(key || '').split('|');
  return key ? `; also linked to the ${kind} campaign${/^\d{4}-\d{2}-\d{2}$/.test(date || '') ? ` for ${ukDay(date)}` : ''}` : '';
};
const evidenceOf = (m) => `Squarespace email "${String(m.subject || '').slice(0, 80)}" sent to ${m.lists.join(' + ') || 'a list'} (matched on ${m.why}${alsoOn(m.also_linked_to)})`;
const tickRow = (ctx, k) => ctx.ticks?.[k] || null;

/** A hand tick on the quarter card; never for an evidence-ruled action (its state comes from planState). */
function quarterTick(s, ctx) {
  const a = ctx.actionsById?.get(String(s.plan_id));
  if (evidenceRuleFor(a || { step: s.step })) return null;
  return a?.is_ticked ? { status: 'done', by: 'Alan (quarter card)', at: a.ticked_at || null } : null;
}
/** Manual state set by Alan or ChatGPT: a tick on the step (or its FB / IG publish ticks), a skip, a "not needed". */
/** A hand "done" tick on the step; an evidence-ruled quarter action ignores it (it waits for the send evidence). */
function handDone(s, ctx) {
  if (s.plan_id && evidenceRuleFor(ctx.actionsById?.get(String(s.plan_id)) || { step: s.step })) return null;
  return [s.key, `${s.key}|fb`, `${s.key}|ig`].map((k) => tickRow(ctx, k)).find((t) => t?.is_ticked) || null;
}
export function manualState(s, ctx) {
  if (s.plan_id && quarterTick(s, ctx)) return quarterTick(s, ctx);
  const done = handDone(s, ctx);
  if (done) return { status: 'done', by: done.set_by || null, at: done.set_at || done.ticked_at || null };
  const t = tickRow(ctx, s.key);
  if (t?.status === 'skipped' || t?.status === 'not_needed') return { status: t.status, reason: t.reason || null, by: t.set_by || null, at: t.set_at || null };
  return null;
}
function sentAt(rec) {
  const h = (rec.stage_history || []).find((x) => SENT.has(x.stage));
  return h?.at || rec.sent_on || null;
}
/** Done by hand on the weekly email record: its sent email linked, or its stage moved to sent / measured. */
function recordDone(rec, ctx) {
  const linked = rec.sqs_email_id && rec.link_source !== 'auto' ? ctx.sqsById?.get(rec.sqs_email_id) : null;
  if (linked) return { status: 'done', evidence: evidenceOf({ ...linked, lists: linked.mailing_list_names || [], why: 'linked on the campaign record' }), at: linked.sent_at || linked.sent_on, by: 'linked on the campaign record', link: { email_id: linked.email_id, campaign_key: rec.campaign_key } };
  if (rec.stored && SENT.has(rec.stage) && rec.stage_source !== 'auto') return { status: 'done', by: rec.set_by || null, at: sentAt(rec), evidence: `campaign record marked ${rec.stage}` };
  return null;
}
/** Weekly email: a linked send (by hand), a record marked sent, else the Squarespace match (one = auto, more = ask). */
export function emailState(s, ctx) {
  const rec = ctx.recordsByKey?.get(`email|${weekOf(s)}`) || null;
  const byHand = rec ? recordDone(rec, ctx) : null;
  if (byHand) return byHand;
  if (rec?.stage === 'cancelled') return { status: 'not_needed', auto: true, reason: 'weekly email record cancelled (stays cancelled when the plan is rebuilt)', at: ctx.checkedAt || null };
  const matches = rec?.auto_matches || matchEmail(s, rec, ctx);
  if (matches.length === 1) return { status: 'auto_done', auto: true, evidence: evidenceOf(matches[0]), at: matches[0].sent_at, link: { email_id: matches[0].email_id, campaign_key: `email|${weekOf(s)}` } };
  if (matches.length > 1) return { status: 'ask', candidates: matches, campaign_key: `email|${weekOf(s)}` };
  return null;
}
/** Quarter action with an evidence rule: the first matching email on or after the rule's day; before it, "waiting". */
export function planState(s, ctx) {
  const rule = evidenceRuleFor(ctx.actionsById?.get(String(s.plan_id)) || { step: s.step });
  if (!rule) return null;
  const hit = evidenceHit(rule, ctx.sqs, ctx.checkedAt || `${ctx.today}T23:59:59.999Z`);
  if (hit) return { status: 'auto_done', auto: true, evidence: evidenceOf({ ...hit, lists: hit.mailing_list_names || [], why: `rule: ${rule.id}` }), at: hit.sent_at || hit.sent_on, rule: rule.id };
  return ctx.today < rule.from ? { status: 'awaiting', evidence_rule: rule.label, expected_from: rule.from, rule: rule.id } : null;
}

const fname = (f) => `${f.name || f.title || 'date'} ${String(f.when || '').replace(/^starts /, '')}`.trim();
/** Why a featured date no longer needs promoting, or null. Cancelled: hook for the cancellations table (ctx.cancelled). */
function soldOut(k, ctx) {
  const p = ctx.places?.get(k);
  if (p?.cap && p.booked >= p.cap) return ` sold out (${p.booked} of ${p.cap} booked)`;
  return ctx.zeroLeft?.has(k) ? ' sold out (0 places left on the site)' : null;
}
const withdrawn = (f, ctx) => (ctx.listed?.size && f.date > ctx.today && !ctx.listed.has(f.event_key) ? ' withdrawn (no longer listed on the site)' : null);
function cancelledWhy(k, ctx) {
  if (!ctx.cancelled?.has(k)) return null;
  const why = ctx.cancelled.get(k);
  return ` cancelled${why ? ` (${why})` : ''}`;
}
export function goneReason(f, ctx) {
  const k = f.event_key;
  if (!k) return null;
  const why = cancelledWhy(k, ctx) || soldOut(k, ctx) || (ctx.overrides?.[k]?.promote_mode === 'dont_promote' ? " set to don't promote" : null) || withdrawn(f, ctx);
  return why ? `${fname(f)}${why}` : null;
}
/** Event-specific step: not needed only when every date it features is gone. */
export function notNeededState(s, ctx) {
  const fs = (s.featured || []).filter((f) => f.event_key);
  if (!fs.length) return null;
  const reasons = fs.map((f) => goneReason(f, ctx));
  return reasons.every(Boolean) ? { status: 'not_needed', auto: true, reason: reasons.join(' · '), at: ctx.checkedAt || null } : null;
}
/** Optional steps (Google Business exception updates) are never late: past their day they just stay open. */
export const isOptional = (s) => !!s.optional || String(s.key || '').startsWith('step|gbp|');
export function timeState(s, ctx) {
  const moved = tickRow(ctx, s.key)?.moved_to || null;
  const eff = moved || s.scheduled_day || s.day;
  if (eff >= ctx.today) return { status: 'pending', moved_to: moved };
  if (isOptional(s)) return { status: 'pending', optional: true, moved_to: moved, label: `optional · planned ${ukDay(s.scheduled_day || s.day)}` };
  return { status: eff < addDays(ctx.today, -OLDER_DAYS) ? 'older' : 'late', planned: s.scheduled_day || s.day, moved_to: moved, label: `late · planned ${ukDay(s.scheduled_day || s.day)}` };
}
function autoState(s, ctx) {
  if (s.is_email) return emailState(s, ctx);
  if (s.plan_id) return planState(s, ctx);
  return notNeededState(s, ctx);
}
/** One step's state (see header). `resolved` = nothing left to do. A step built from evidence carries its own state. */
export function stepState(s, ctx) {
  if (s.fixed_state) return { ...s.fixed_state, resolved: true };
  const st = manualState(s, ctx) || autoState(s, ctx) || timeState(s, ctx);
  return { ...st, resolved: RESOLVED.has(st.status) };
}

/* ---------- targeted emails (sends linked to an event / theme record) ---------- */

const stampUk = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '');
const listLabel = (lists) => lists.map((l) => (normList(l) === FULL_LIST ? 'full list' : `${String(l).split(' - ')[0].trim()} segment`)).join(' + ') || 'a list';
function targetName(rec) {
  if (!rec.event) return rec.title || 'Campaign';
  return shortName(rec.event).replace(/\s+course$/i, '');
}
const sentBy = (row) => (row?.stage_history || []).filter((h) => SENT.has(h.stage)).map((h) => h.by).filter(Boolean).slice(-1)[0] || row?.set_by || null;
function resultsLine(e) {
  return e ? ` · ${e.delivered ?? '—'} delivered · ${e.opened ?? '—'} opened · ${e.clicked ?? '—'} clicked · ${e.unsubscribed ?? '—'} unsubscribed` : '';
}
/** "Lightroom targeted email: sent 8 Nov 09:55 · 39 · LR30 segment": done, linked to the send and its results. */
export function targetedStep(week, rec, c, row) {
  const n = row?.actual_sends ?? c.message_count ?? c.delivered ?? null;
  const lists = c.mailing_list_names || [];
  const email = rec.results?.email || { delivered: c.delivered, opened: c.opened, clicked: c.clicked, unsubscribed: c.unsubscribed, subject: c.subject, sent_on: c.sent_on };
  return {
    key: `step|${week}|Squarespace targeted|${c.email_id}`, week, day: c.sent_on, scheduled_day: c.sent_on, moved: false, channel: 'Squarespace email (targeted)',
    step: `${targetName(rec)} targeted email: sent ${stampUk(c.sent_at || c.sent_on)} · ${n ?? '?'} · ${listLabel(lists)}`,
    brief: `Its own send, separate from the weekly email: "${String(c.subject || '').slice(0, 80)}" to ${lists.join(' + ') || 'a list'}`,
    covers: [], featured: [], targeted: true, link: { email_id: c.email_id, campaign_key: rec.campaign_key }, results: email,
    fixed_state: { status: 'done', by: sentBy(row), at: c.sent_at || c.sent_on, evidence: `Squarespace email linked to the ${rec.kind} campaign · ${n ?? '?'} sent${resultsLine(email)}` }
  };
}
/** Adds a done targeted-email step to the week each event / theme send (linked by hand) went out in. */
export function addTargetedSteps(weeks, records, rows, sqsById) {
  const rowBy = new Map((rows || []).map((r) => [r.campaign_key, r]));
  const sends = records.filter((r) => r.kind !== 'weekly_email' && r.sqs_email_id && r.link_source !== 'auto' && sqsById.get(r.sqs_email_id));
  for (const w of weeks) {
    const end = addDays(w.week, 6);
    for (const r of sends) {
      const c = sqsById.get(r.sqs_email_id);
      if (c.sent_on >= w.week && c.sent_on <= end && !w.steps.some((s) => s.link?.email_id === c.email_id)) w.steps.push(targetedStep(w.week, r, c, rowBy.get(r.campaign_key)));
    }
    w.steps.sort((a, b) => a.day.localeCompare(b.day) || a.scheduled_day.localeCompare(b.scheduled_day));
  }
}
/** One Google Business exception per campaign: once registered in an earlier week, it is not repeated later. */
export function dropRepeats(weeks, register) {
  const firstWeek = new Map((register || []).filter((r) => isOptional({ key: r.step_key })).map((r) => [r.step_key, String(r.week_start).slice(0, 10)]));
  for (const w of weeks) w.steps = w.steps.filter((s) => !(isOptional(s) && firstWeek.has(s.key) && firstWeek.get(s.key) < w.week));
}

/* ---------- register (steps kept after their week) ---------- */

const slimFeatured = (f) => ({ name: f.name || null, when: f.when || null, stage: f.stage || null, moment: f.moment || null, title: f.title || null, date: f.date || null, url: f.url || null, event_key: f.event_key || null, booked: f.booked ?? null, cap: f.cap ?? null });
export function registerRows(week, steps, propertyUrl, now) {
  return (steps || []).filter((s) => !s.fixed_state).map((s) => ({
    property_url: propertyUrl, step_key: s.key, week_start: week, scheduled_day: s.scheduled_day || s.day, channel: s.channel, step: s.step,
    brief: s.brief || null, is_email: !!s.is_email, plan_id: s.plan_id ?? null, covers: s.covers || [], featured: (s.featured || []).map(slimFeatured),
    lead_names: s.lead_names || [], last_seen_at: now
  }));
}
export function stepFromRegister(r) {
  const day = String(r.scheduled_day).slice(0, 10);
  return {
    key: r.step_key, week: String(r.week_start).slice(0, 10), day, scheduled_day: day, moved: false, channel: r.channel, step: r.step, brief: r.brief || '',
    is_email: !!r.is_email, plan_id: r.plan_id ?? undefined, covers: r.covers || [], featured: r.featured || [], lead_names: r.lead_names || [], from_register: true,
    manual: !isGenerated(r.step_key)
  };
}
export async function loadStepRegister(supabase, propertyUrl, todayIso) {
  const { data, error } = await supabase.from('strategy_campaign_steps').select('*').eq('property_url', propertyUrl).gte('week_start', addDays(todayIso, -70)).limit(2000);
  if (error) throw new Error(error.message);
  return data || [];
}
export async function saveStepRegister(supabase, propertyUrl, week) {
  const rows = registerRows(week.week, week.steps, propertyUrl, new Date().toISOString());
  if (!rows.length) return 0;
  const { error } = await supabase.from('strategy_campaign_steps').upsert(rows, { onConflict: 'property_url,step_key', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}
export async function loadAudienceLists(supabase) {
  const [ex, sg] = await Promise.all([
    supabase.from('marketing_segment_exports').select('export_id, campaign_key, list_name').eq('is_test', false).limit(500),
    supabase.from('marketing_segments').select('segment_id, name').limit(500)
  ]);
  if (ex.error || sg.error) throw new Error((ex.error || sg.error).message);
  return { exports: ex.data || [], segments: sg.data || [] };
}

/* ---------- applying to the weeks ---------- */

const DROPPED = { status: 'not_needed', auto: true, reason: 'no longer in this week\'s plan (the dates it featured moved or dropped out)' };
/**
 * This week's registered steps that today's plan no longer generates: their own reason, else "dropped from the plan".
 * Manual rows (Alan / GPT, not step|…) are never dropped because the generated plan differs: they keep their own state.
 * A step generated in a later week (e.g. a quarter action moved to next week) is not a dropped step here.
 */
function droppedThisWeek(week, register, ctx, weeks = [week]) {
  const have = new Set(weeks.flatMap((w) => w.steps.map((s) => s.key)));
  return register.filter((r) => String(r.week_start).slice(0, 10) === week.week && !have.has(r.step_key)).map(stepFromRegister).map((s) => {
    const st = stepState(s, ctx);
    return { ...s, state: st.resolved || s.manual ? st : { ...DROPPED, resolved: true } };
  });
}
/** Manual registered rows in later weeks: into their week when it is generated, else returned (carried.future). */
function futureManual(weeks, register, ctx, live) {
  const from = weeks[0]?.week || ctx.today;
  const byWeek = new Map(weeks.map((w) => [w.week, w]));
  const beyond = [];
  const rows = register.filter((r) => String(r.week_start).slice(0, 10) > from && !live.has(r.step_key) && !isGenerated(r.step_key));
  const byDay = (a, b) => a.day.localeCompare(b.day);
  for (const s of rows.map(stepFromRegister)) {
    s.state = stepState(s, ctx);
    const w = byWeek.get(s.week);
    if (!w) { beyond.push(s); continue; }
    w.steps.push(s);
    w.steps.sort(byDay);
  }
  return beyond.sort(byDay);
}
const countBy = (list) => list.reduce((o, s) => ({ ...o, [s.state.status]: (o[s.state.status] || 0) + 1 }), {});
const brief = (s) => ({ key: s.key, week: weekOf(s), channel: s.channel, step: s.step, planned: s.scheduled_day || s.day, status: s.state.status });

/**
 * Sets `state` on every step of every week, adds this week's dropped steps, and returns the steps from earlier weeks
 * still to do (late = ≤14 days past, older = more) plus the counts for Marketing tile 7.
 */
export function applyStepStatus(weeks, ctx, register = []) {
  for (const w of weeks) for (const s of w.steps) { s.week = s.week || w.week; s.state = stepState(s, ctx); }
  if (weeks[0]) weeks[0].steps.push(...droppedThisWeek(weeks[0], register, ctx, weeks));
  const live = new Set(weeks.flatMap((w) => w.steps.map((s) => s.key)));
  const future = futureManual(weeks, register, ctx, live);
  const earlier = register.filter((r) => String(r.week_start).slice(0, 10) < (weeks[0]?.week || ctx.today) && !live.has(r.step_key))
    .map(stepFromRegister).filter((s) => !isOptional(s)).map((s) => ({ ...s, state: stepState(s, ctx) })).filter((s) => !s.state.resolved);
  const carried = { late: earlier.filter((s) => s.state.status !== 'older'), older: earlier.filter((s) => s.state.status === 'older'), future };
  return { carried, summary: stepSummary(weeks, carried, ctx) };
}
/** Google Business exception updates open this week or next (the "exceptions awaiting Alan" count). */
const gbpOpen = (weeks) => weeks.slice(0, 2).flatMap((w) => w.steps).filter((s) => isOptional(s) && !s.state.resolved);
function stepSummary(weeks, carried, ctx) {
  const week = weeks[0];
  const now = week?.steps || [];
  const late = [...now.filter((s) => s.state.status === 'late'), ...carried.late.filter((s) => s.state.status === 'late')];
  const asks = [...now, ...carried.late].filter((s) => s.state.status === 'ask');
  return {
    week: week?.week || null, today: ctx.today, this_week: { total: now.length, ...countBy(now) },
    late: late.length, late_campaign: late.filter((s) => !s.plan_id).length, late_quarter: late.filter((s) => s.plan_id).length,
    awaiting_plan_ids: now.filter((s) => s.plan_id && s.state.status === 'awaiting').map((s) => String(s.plan_id)),
    older: carried.older.length + now.filter((s) => s.state.status === 'older').length, ask: asks.length,
    auto_done: now.filter((s) => s.state.status === 'auto_done').length, not_needed: now.filter((s) => s.state.status === 'not_needed').length,
    awaiting: now.filter((s) => s.state.status === 'awaiting').length,
    late_steps: late.slice(0, 8).map(brief), ask_steps: asks.map(brief),
    targeted_done: now.filter((s) => s.targeted).length, gbp_exceptions_open: gbpOpen(weeks).length, gbp_exception_steps: gbpOpen(weeks).map(brief),
    basis: 'late = no done / skipped / not-needed state and the planned (or moved-to) day has passed, 14 days or less; older = more than 14 days; ask = more than one sent email could be this week\'s email; quarter actions included'
  };
}
