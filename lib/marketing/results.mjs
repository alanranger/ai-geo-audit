/**
 * Marketing & Campaigns → "Results": one row per email or post that ACTUALLY went out (provider evidence only),
 * newest first. Read-only; nothing is written. Counts and list names only: no member lists, no names.
 * Emails: campaign records sent with evidence (strategy_campaigns: linked Squarespace report, schedule evidence or
 *   actual sends; send time = provider send time / scheduled_for) + collected Squarespace campaigns no record links.
 * Posts: collected social_posts + GPT's evidenced step ticks (lib/social/evidence.mjs), one row per post: the same
 *   step's Facebook / Instagram / Story placements (or same day + same first line) are grouped.
 * Unknown stays unknown (null), never 0: opens not collected yet, Stories (not collected), LinkedIn until GPT's entry.
 */
import { evidencedRows } from '../social/evidence.mjs';
import { normalisePost } from '../social/summary.mjs';
import { supabaseRepo } from '../social/repo.mjs';

const PROP = 'https://www.alanranger.com';
const DAY = 864e5;
const SENT = ['sent', 'measured'];
const CH_ORDER = { email: 0, facebook: 1, instagram: 2, story: 3, linkedin: 4 };
const LEAD = /^(Post|Personal note to past clients|Main email of the week|Lightroom targeted email|Google Business update)\s*:\s*/i;

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};

/** Title cut to at most six words, quotes and "Post:" leads dropped. */
export function shortWhat(t) {
  const s = String(t || '').replace(LEAD, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  return words.length > 6 ? `${words.slice(0, 6).join(' ')}…` : s;
}

/* ---------- emails ---------- */

/** Provider evidence for a sent record: the collected report, a schedule confirmation or the actual sends. */
const hasEvidence = (r) => !!(r.sqs_email_id || r.schedule_evidence || r.actual_sends != null);
const sentAtOf = (r, sqs) => (sqs?.sent_at || r.scheduled_for || (r.sent_on ? `${r.sent_on}T12:00:00Z` : null));

function opensOf(sqs, sentAt, now) {
  if (sqs) return { opened: sqs.opened ?? null, clicked: sqs.clicked ?? null, opens_state: 'collected' };
  const fresh = sentAt && now - Date.parse(sentAt) < 3 * DAY;
  return { opened: null, clicked: null, opens_state: fresh ? 'tomorrow' : 'not_collected' };
}

function emailEvidence(r, sqs) {
  const out = [];
  if (sqs) out.push(`Squarespace campaign report collected: ${sqs.delivered ?? sqs.message_count ?? '—'} delivered`);
  if (r?.schedule_evidence) out.push(`Squarespace schedule ${String(r.schedule_evidence).replace('_', '-')}${r.scheduled_for ? ` for ${r.scheduled_for}` : ''}`);
  if (r?.actual_sends != null) out.push(`Actual sends recorded on the campaign record: ${r.actual_sends}`);
  return out;
}

const firstOf = (...v) => v.find((x) => x != null && x !== '') ?? null;
const sentToOf = (r, c) => firstOf(c.delivered, r.actual_sends, c.message_count, r.scheduled_recipients);
const listsOf = (r, c) => [c.mailing_list_names, r.sent_lists].find(Array.isArray) || [];

export function emailRow(rec, sqs, now) {
  const r = rec || {};
  const c = sqs || {};
  const sentAt = sentAtOf(r, sqs);
  const subject = firstOf(c.subject, r.title);
  return {
    id: `email|${firstOf(r.campaign_key, c.email_id)}`, kind: 'email', sent_at: sentAt, title: firstOf(r.title, c.subject) || 'Email',
    what: shortWhat(subject), channels: [{ ch: 'email' }], campaign_key: firstOf(r.campaign_key, c.campaign_key), step_keys: [],
    sent_to: sentToOf(r, c), ...opensOf(sqs, sentAt, now), reactions: null,
    audience: { lists: listsOf(r, c), count: firstOf(c.delivered, r.actual_sends) },
    copy: subject || '', evidence: emailEvidence(rec, sqs)
  };
}

async function loadEmails(sb, sinceIso, now) {
  const since = sinceIso.slice(0, 10);
  const recs = must(await sb.from('strategy_campaigns')
    .select('campaign_key, title, stage, sent_on, scheduled_for, scheduled_recipients, actual_sends, sqs_email_id, schedule_evidence, sent_lists:sent_audience->list_names')
    .eq('property_url', PROP).in('stage', SENT).or(`sent_on.gte.${since},scheduled_for.gte.${sinceIso}`).limit(300), 'strategy_campaigns');
  const sqs = must(await sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, delivered, opened, clicked, mailing_list_names, campaign_key')
    .gte('sent_on', sinceIso).order('sent_on', { ascending: false }).limit(200), 'sqs_email_campaigns').map((c) => ({ ...c, sent_at: c.sent_on }));
  return emailRows(recs, sqs, now);
}

/** Records with evidence (each joined to its collected report) + collected reports no record links. */
export function emailRows(recs, sqs, now) {
  const byId = new Map(sqs.map((c) => [c.email_id, c]));
  const byKey = new Map(sqs.filter((c) => c.campaign_key).map((c) => [c.campaign_key, c]));
  const used = new Set();
  const rows = recs.filter(hasEvidence).map((r) => {
    const c = byId.get(r.sqs_email_id) || byKey.get(r.campaign_key) || null;
    if (c) used.add(c.email_id);
    return emailRow(r, c, now);
  });
  return [...rows, ...sqs.filter((c) => !used.has(c.email_id)).map((c) => emailRow(null, c, now))];
}

/* ---------- posts ---------- */

const chOf = (p) => (p.placement === 'story' ? 'story' : p.channel);
const firstLine = (s) => String(s || '').trim().toLowerCase().slice(0, 40);
const groupKey = (p) => (p.step_key ? `step|${p.step_key}` : `${String(p.posted_at).slice(0, 10)}|${firstLine(p.title)}`);

function channelCell(p) {
  return { ch: chOf(p), reach: p.reach ?? null, reach_label: p.reach_label || 'reach', likes: p.likes ?? null, comments: p.comments ?? null, url: p.provider_url || p.permalink || null, matched: p.source !== 'evidence' };
}

function postRow(list) {
  const lead = list.find((p) => p.step_title) || list[0];
  const at = list.map((p) => p.posted_at).filter(Boolean).sort().slice(-1)[0] || null;
  const channels = list.map(channelCell).sort((a, b) => CH_ORDER[a.ch] - CH_ORDER[b.ch]);
  return {
    id: `post|${groupKey(lead)}`, kind: 'social', sent_at: at, title: lead.step_title || lead.title || 'Post', what: shortWhat(lead.step_title || lead.title),
    channels, campaign_key: null, step_keys: [...new Set(list.map((p) => p.step_key).filter(Boolean))],
    sent_to: null, opened: null, clicked: null, opens_state: 'na', reactions: null,
    audience: { lists: [], count: null, note: 'Followers of each channel (organic post)' },
    copy: list.find((p) => p.source !== 'evidence')?.title || lead.title || '',
    evidence: list.map((p) => `${chOf(p)}: ${p.evidence || (p.permalink ? `collected from the platform (${p.permalink})` : 'collected from the platform')}`)
  };
}

/** Evidenced placements + collected posts they don't replace → one row per post. */
export function postRows(posts, evidenced) {
  const listed = [...posts.filter((p) => !evidenced.replaced.has(`${p.channel}|${p.post_id}`)), ...evidenced.rows];
  const igByDay = new Map(listed.filter((p) => p.step_key && p.channel === 'instagram').map((p) => [`${String(p.posted_at).slice(0, 10)}|${firstLine(p.title)}`, p.step_key]));
  const groups = new Map();
  for (const p of listed) {
    const k = p.step_key ? `step|${p.step_key}` : (igByDay.has(groupKey(p)) ? `step|${igByDay.get(groupKey(p))}` : groupKey(p));
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  return [...groups.values()].map(postRow);
}

async function loadPosts(sb, sinceIso) {
  const repo = supabaseRepo(sb);
  const posts = (await repo.readPosts(['facebook', 'instagram', 'linkedin'], sinceIso)).map(normalisePost);
  const ticks = (await repo.readEvidence(sinceIso)).filter((t) => /\|(Facebook|Instagram|LinkedIn)/i.test(t.tick_key));
  const bases = [...new Set(ticks.map((t) => t.tick_key.replace(/\|(fb|ig)$/, '')))];
  const [steps, tags] = await Promise.all([repo.readSteps(bases), repo.readDeliveryPurposes([...bases, ...ticks.map((t) => t.tick_key)])]);
  return postRows(posts, evidencedRows({ ticks, steps, tags, posts }));
}

/* ---------- everything ---------- */

export async function buildMarketingResults(sb, { days = 30, now = Date.now() } = {}) {
  const sinceIso = new Date(now - Math.min(Math.max(Number(days) || 30, 1), 120) * DAY).toISOString();
  const [emails, posts] = await Promise.all([loadEmails(sb, sinceIso, now), loadPosts(sb, sinceIso)]);
  const rows = [...emails, ...posts].filter((r) => r.sent_at && Date.parse(r.sent_at) >= Date.parse(sinceIso))
    .map((r) => ({ ...r, sent_at: new Date(r.sent_at).toISOString() })).sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return { as_of: new Date(now).toISOString(), since: sinceIso, rows };
}
