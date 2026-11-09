/**
 * GPT's manually evidenced social posts from the last 7 days (campaign-step ticks marked done, with the live URL / confirmation in
 * strategy_campaign_ticks.reason + history), read where GPT wrote them and never copied. Each placement becomes one row
 * in "Recent posts across channels": tick "…|fb" = Facebook feed, "…|ig" = Instagram feed (+ an Instagram Story row
 * when its history records a Story), a LinkedIn step = LinkedIn feed.
 * Matching to collected posts: Instagram by post shortcode, LinkedIn by activity id; Facebook evidence carries no URL,
 * so the Facebook post is the one on the same day with the same first line as the matched Instagram post (labelled).
 * Stories have no permalink and are not collected: their figures stay unknown ("—"), never 0.
 */
import { purposeRule } from '../strategy-initiatives.mjs';

const URL_RE = {
  instagram: /https:\/\/(?:www\.)?instagram\.com\/[^\s)"]*?(?:p|reel)\/[A-Za-z0-9_-]+\/?/i,
  linkedin: /https:\/\/(?:www\.)?linkedin\.com\/feed\/update\/[^\s)"]+/i,
  facebook: /https:\/\/(?:www\.|m\.)?facebook\.com\/[^\s)"]+/i
};
export const igCode = (u) => String(u || '').match(/instagram\.com\/(?:[^/\s]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)/i)?.[1] || null;
export const liActivity = (u) => String(u || '').match(/(?:activity|share|ugcPost)[:-](\d{10,})/i)?.[1] || null;

const textOf = (t) => [t.reason, ...(Array.isArray(t.history) ? t.history.map((h) => h.evidence || '') : [])].join(' ');
const firstSentence = (s) => String(s || '').split(/(?<=[.;])\s/)[0].slice(0, 160);
const shortEvidence = (t) => {
  const h = Array.isArray(t.history) ? t.history : [];
  const head = firstSentence(h.find((x) => x.evidence)?.evidence || t.reason);
  return `${head}${h.length > 1 ? ` · ${h.length - 1} follow-up${h.length > 2 ? 's' : ''}` : ''}`;
};
const storyEntry = (t) => (Array.isArray(t.history) ? t.history : []).find((h) => /story/i.test(`${h.action || ''} ${h.evidence || ''}`));

function placementOf(t) {
  const parts = t.tick_key.split('|');
  const suffix = ['fb', 'ig'].includes(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
  const base = suffix ? parts.slice(0, -1).join('|') : t.tick_key;
  if (suffix === 'fb') return [{ base, channel: 'facebook', placement: 'feed' }];
  if (suffix === 'ig') return [{ base, channel: 'instagram', placement: 'feed' }, ...(storyEntry(t) ? [{ base, channel: 'instagram', placement: 'story', story: storyEntry(t) }] : [])];
  return /LinkedIn/i.test(parts[2] || '') ? [{ base, channel: 'linkedin', placement: 'feed' }] : [];
}

/** Ticks → placements (each with its provider URL when the evidence has one). */
export function placementsFromTicks(ticks) {
  return ticks.flatMap((t) => placementOf(t).map((p) => ({
    ...p, tick_key: t.tick_key, set_by: t.set_by, set_at: t.set_at,
    at: p.story?.at || t.set_at,
    url: p.placement === 'story' ? null : (textOf(t).match(URL_RE[p.channel])?.[0] || null),
    evidence: p.story ? firstSentence(p.story.evidence || p.story.action) : shortEvidence(t)
  })));
}

const sameDay = (a, b) => String(a).slice(0, 10) === String(b).slice(0, 10);
const firstLine = (s) => String(s || '').trim().toLowerCase();
function matchOne(pl, posts, byBase) {
  if (pl.placement === 'story') return { post: null, basis: 'Stories are not collected (no permalink, no figures)' };
  if (pl.channel === 'instagram') return { post: posts.find((p) => p.channel === 'instagram' && pl.url && igCode(p.permalink) === igCode(pl.url)) || null, basis: 'permalink' };
  if (pl.channel === 'linkedin') return { post: posts.find((p) => p.channel === 'linkedin' && pl.url && liActivity(p.permalink) && liActivity(p.permalink) === liActivity(pl.url)) || null, basis: 'permalink' };
  const ig = byBase.get(pl.base);
  const fb = ig ? posts.filter((p) => p.channel === 'facebook' && sameDay(p.posted_at, ig.posted_at) && firstLine(p.title) === firstLine(ig.title)) : [];
  return { post: fb.length === 1 ? fb[0] : null, basis: 'same day and first line as the matched Instagram post (the Facebook evidence has no URL)' };
}

function purposeFor(pl, step, tags) {
  const tag = tags.get(pl.tick_key) || tags.get(pl.base);
  if (tag) return { primary: tag, source: 'set' };
  if (!step) return { primary: null, source: null };
  const d = { is_email: !!step.is_email, featured: Array.isArray(step.featured) ? step.featured : [], targeted: false, brief: step.brief || '', channel: step.channel || '', title: step.step || '' };
  return { primary: purposeRule(d).primary, source: 'rule' };
}

/**
 * → { rows, replaced } : evidenced rows (matched ones carry the collected post's figures) and the ids of collected
 * posts they replace, so a post is never listed twice.
 */
export function evidencedRows({ ticks, steps, tags, posts }) {
  const pls = placementsFromTicks(ticks);
  const stepBy = new Map(steps.map((s) => [s.step_key, s]));
  const tagBy = new Map(tags.filter((t) => t.purpose_primary).map((t) => [t.ref_key, t.purpose_primary]));
  const byBase = new Map();
  const ordered = [...pls].sort((a, b) => (a.channel === 'instagram' ? -1 : 0) - (b.channel === 'instagram' ? -1 : 0));
  const out = ordered.map((pl) => {
    const m = matchOne(pl, posts, byBase);
    if (pl.channel === 'instagram' && pl.placement === 'feed' && m.post) byBase.set(pl.base, m.post);
    const step = stepBy.get(pl.base);
    const purpose = purposeFor(pl, step, tagBy);
    const shell = { channel: pl.channel, post_id: `evidence:${pl.tick_key}:${pl.placement}`, posted_at: pl.at, title: step?.step || pl.base, permalink: null, source: 'evidence', reach: null, reach_label: pl.channel === 'linkedin' ? 'impr.' : 'reach', likes: null, comments: null, shares: null };
    return {
      ...(m.post || shell), placement: pl.placement, step_key: pl.base, step_title: step?.step || null, purpose: purpose.primary, purpose_source: purpose.source,
      provider_url: pl.url || m.post?.permalink || null, evidence: pl.evidence, evidence_by: pl.set_by, evidence_at: pl.set_at, matched: !!m.post, match_basis: m.post ? m.basis : `not matched: ${m.basis}`
    };
  });
  const once = onePerPost(out);
  return { rows: once, replaced: new Set(once.filter((r) => r.matched).map((r) => `${r.channel}|${r.post_id}`)) };
}

/** A collected post evidenced by more than one tick is listed once (the latest evidence wins); newest first. */
function onePerPost(rows) {
  const byPost = new Map();
  for (const r of [...rows].sort((a, b) => String(b.evidence_at).localeCompare(String(a.evidence_at)))) {
    const k = `${r.channel}|${r.post_id}`;
    if (!byPost.has(k)) byPost.set(k, r);
  }
  return [...byPost.values()].sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
}
