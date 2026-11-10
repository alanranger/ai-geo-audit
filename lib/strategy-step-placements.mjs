/**
 * Campaign steps follow their own social placements (marketing_social_placements), at read time on every summary
 * build. Nothing is stored or ticked; a hand tick / skip / "not needed" is applied first (strategy-step-status.mjs) and
 * always wins.
 *  - placementIndex(): step_key → its feed placements (FB feed, IG feed, LinkedIn), each with its publication evidence
 *    by the status board's own rule (lib/marketing/delivery-status.mjs): provider / GPT live-check evidence, else the
 *    Meta collector's post on that channel at the planned time. Instagram Stories are their own GPT task, never the step's.
 *  - placementState(): every feed placement published → "done automatically" with that evidence and time.
 *  - supersedeReplaced(): an old generated FB / IG or LinkedIn step that GPT's plan replaced (a GPT post on the same
 *    channel in the same week featuring the same event) is "superseded", linked to that post — the same rule the
 *    Campaign steps table shows (lib/strategy-board.js), so late counts and carried lists agree with it.
 */
import { collectorPost, isPublishedPlacement, publishedEvidence, ukDayTime } from './marketing/delivery-status.mjs';

const FEED = ['facebook_feed', 'instagram_feed', 'linkedin_feed'];
const PL_NAME = { facebook_feed: 'Facebook', instagram_feed: 'Instagram', linkedin_feed: 'LinkedIn' };

/** A placement's publication: provider / live-check evidence, else the Meta collector's post at its planned time, else null. */
export function publicationOf(p, postsById = new Map(), recent = []) {
  if (isPublishedPlacement(p)) return { at: p.actual_at || null, evidence: publishedEvidence(p, postsById) };
  const seen = collectorPost(p, recent);
  return seen ? { at: seen.posted_at, evidence: `seen by the Meta collector ${ukDayTime(seen.collected_at || seen.posted_at)}` } : null;
}
/** step_key → [{ placement, published }] for its feed placements. */
export function placementIndex(rows, posts = []) {
  const byId = new Map(posts.map((x) => [x.post_id, x]));
  const out = new Map();
  for (const p of (rows || []).filter((x) => FEED.includes(x.placement))) out.set(p.step_key, [...(out.get(p.step_key) || []), { placement: p.placement, published: publicationOf(p, byId, posts) }]);
  return out;
}
/** Read-only: placements from the last ~11 weeks and the Meta collector's posts in the same window. */
export async function loadPlacementIndex(supabase, propertyUrl, todayIso) {
  const since = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 80 * 864e5).toISOString();
  const [pl, posts] = await Promise.all([
    supabase.from('marketing_social_placements').select('step_key, placement, stage, platform_state, provider_id, provider_url, planned_at, actual_at, evidence, set_by').eq('property_url', propertyUrl).gte('planned_at', since).limit(2000),
    supabase.from('social_posts').select('post_id, channel, posted_at, permalink, collected_at').gte('posted_at', since).limit(2000)
  ]);
  if (pl.error || posts.error) throw new Error((pl.error || posts.error).message);
  return placementIndex(pl.data, posts.data);
}

/** Every feed placement of the step published → done automatically (who: the evidence; when: the latest post). */
export function placementState(s, ctx) {
  const pls = ctx.placementsByStep?.get(s.key) || [];
  if (!pls.length || !pls.every((p) => p.published)) return null;
  const at = pls.map((p) => p.published.at).filter(Boolean).sort().pop() || null;
  return { status: 'auto_done', auto: true, evidence: pls.map((p) => `${PL_NAME[p.placement]}: ${p.published.evidence}`).join(' · '), at };
}

/* ---------- old generated steps GPT's plan replaced ---------- */

const STOP = new Set(['photography', 'photographic', 'photo', 'workshop', 'workshops', 'near', 'the', 'and', 'for', 'with', 'from', 'your', 'what', 'course', 'courses', 'classes', 'week', 'places', 'last', 'post', 'offer', 'ends', 'saturday', 'landscape', 'coventry', 'warwickshire', 'solihull', 'nov', 'dec', 'jan', 'https', 'www', 'alanranger', 'com', 'give', 'direction', 'actually', 'helps']);
const words = (t) => String(t || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
const featured = (s) => (s.featured || []).flatMap((f) => (f.items ? f.items : [f]));
const eventWords = (s) => new Set(featured(s).flatMap((f) => [...words(f.name), ...words(f.title), ...words(String(f.url || '').split('/').pop())]));
const CHANNELS = [/Facebook|Instagram/, /LinkedIn/];
const sameChannel = (a, b) => CHANNELS.some((re) => re.test(a.channel || '') && re.test(b.channel || ''));
const gap = (a, b) => Math.abs(Date.parse(`${a.day}T12:00:00Z`) - Date.parse(`${b.day}T12:00:00Z`));
const replaceable = (s) => /^step\|/.test(String(s.key || '')) && /Facebook|LinkedIn/.test(s.channel || '') && !s.state?.resolved;
const ukShort = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The GPT post (has placements; same channel; shares an event word) that replaced an old generated step; closest day. */
export function replacementOf(s, weekSteps, ctx) {
  if (!replaceable(s)) return null;
  const ev = eventWords(s);
  const hits = weekSteps.filter((g) => /^gpt-/.test(String(g.key || '')) && ctx.placementsByStep?.has(g.key) && sameChannel(s, g) && [...eventWords(g)].some((w) => ev.has(w)));
  return hits.sort((a, b) => gap(s, a) - gap(s, b))[0] || null;
}
/** Marks the replaced old steps of ONE week superseded (resolved); hand-resolved steps are never touched. */
export function supersedeReplaced(weekSteps, ctx) {
  for (const s of weekSteps) {
    const g = replacementOf(s, weekSteps, ctx);
    if (g) s.state = { status: 'superseded', auto: true, covered_by: [g.key], reason: `replaced by GPT's post "${g.step}" (${ukShort(g.day)})`, resolved: true };
  }
  return weekSteps;
}
