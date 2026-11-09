/**
 * Shared content records (question 2026-11-09 (f)): one record per video in the EXISTING quarter-plan content store
 * (public.strategy_content_assets) with its format ("Short video / reel"), its own editorial purpose, and its uses —
 * the YouTube release, the Squarespace email module (linked to the email's campaign and initiative), native social only
 * if planned. Each use keeps its own status: YouTube from the provider read (lib/marketing/delivery-status.mjs
 * videoStatus), the email from its own delivery status (a Draft stays Draft).
 *  - seedShorts(): the app path that records GPT's confirmed YouTube schedule (admin script, with history).
 *  - readShortsStatus(): YouTube Data API videos.list (status, processingDetails, contentDetails) with the existing
 *    owner OAuth, READ ONLY. A failed read keeps the last good state and records the error (never zeroed).
 *  - contentView(): content[] for the delivery-status board + the email guard per email delivery.
 */
import { refreshGoogleAccessToken } from '../google-token.js';
import { youtubeConfig } from '../acquisition/youtube-stats.js';
import { shortCheck, ukDayTime, videoNeedsAlan, videoStatus } from './delivery-status.mjs';

const PROP = 'https://www.alanranger.com';
const DATA_API = 'https://www.googleapis.com/youtube/v3/videos';
export const FORMAT_LABEL = { short_video: 'Short video / reel', long_video: 'Video', image: 'Image', carousel: 'Carousel', article: 'Article', email_module: 'Email module' };
export const assetKeyOf = (key) => `video|short|${key}`;
export const videoIdOf = (url) => (String(url || '').match(/(?:shorts\/|v=|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1] || null;
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};

/** "PT1M1S" → 61; seconds → "1:01". */
export function isoSeconds(d) {
  const m = String(d || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
}
export const mmss = (s) => (s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/* ---------- seeding (GPT's confirmed schedule → content records) ---------- */

/** Editorial purpose proposed from the title (GPT / Alan can change it; the source says so). */
export function purposeOf(title) {
  if (/tip|exercise|composition|rules|choices|check the whole frame/i.test(title)) return 'educate';
  if (/reflection|inspiration|style/i.test(title)) return 'inspire';
  return 'inspire';
}

/** One schedule item (+ the email campaign on its paired day) → the content record row (provider_state untouched). */
const moduleState = (s) => (/inserted/i.test(s || '') && !/not yet/i.test(s || '') ? 'inserted' : 'proposed');
function usesOf(item, campaign) {
  const uses = [{ use_key: 'youtube', channel: 'youtube', ref: `youtube|${videoIdOf(item.url)}`, planned_at: item.date, link: item.url, note: item.confirmation || null }];
  if (campaign) uses.push({ use_key: `email|${campaign.campaign_key}`, channel: 'email', ref: `send|${campaign.campaign_key}`, campaign_key: campaign.campaign_key, planned_on: item.email, module_state: moduleState(item.email_link_state), note: item.email_link_state || null });
  return uses;
}

export function shortRecord(item, campaign, prev, by, nowIso) {
  const uses = usesOf(item, campaign);
  const keepPurpose = prev?.purpose_source === 'set';
  return {
    property_url: PROP, asset_key: assetKeyOf(item.key), kind: 'video', format: item.format || 'short_video', title: item.title, url: item.url, status: 'existing', reuse: true,
    purpose: keepPurpose ? prev.purpose : purposeOf(item.title), purpose_source: keepPurpose ? 'set' : 'rule (from the title; GPT / Alan may change it)',
    uses, used_in: uses.map((u) => u.ref), note: `YouTube Short ${item.duration} · release ${item.date} (${item.timezone || 'Europe/London'}) · ${item.state}`,
    history: [...(prev?.history || []), { at: nowIso, by, action: prev ? 'updated from the confirmed schedule' : 'recorded from the confirmed schedule', release_at: item.date, email: item.email || null }].slice(-30),
    set_by: by, set_at: nowIso
  };
}

/** The email campaign a Short is paired with: a stored record whose planned send day is the item's email date. */
export const campaignOn = (campaigns, day) => campaigns.find((c) => c.planned_send_on === day && c.stage !== 'cancelled') || null;

/** Initiative link for the YouTube use (delivery youtube|<id>) = the paired email's initiative, with the Short's purpose. */
export function useLinks(row, campaignLinks, by, nowIso) {
  const email = row.uses.find((u) => u.channel === 'email');
  const init = email ? campaignLinks.get(email.campaign_key) : null;
  if (!init) return [];
  return [{ property_url: PROP, ref_type: 'delivery', ref_key: row.uses[0].ref, initiative_key: init, role: 'primary', purpose_primary: row.purpose, purpose_secondary: [], note: `YouTube release of ${row.title}`, set_by: by, set_at: nowIso }];
}

/** The app path for the seed: upsert records (history kept, provider reads never overwritten) + the use links. */
export async function seedShorts(sb, items, { by = 'Cursor (seed from GPT confirmed schedule)', now = new Date().toISOString() } = {}) {
  const [camps, prevRows, links] = await Promise.all([
    sb.from('strategy_campaigns').select('campaign_key, planned_send_on, stage').eq('property_url', PROP).not('planned_send_on', 'is', null),
    sb.from('strategy_content_assets').select('asset_key, purpose, purpose_source, history').eq('property_url', PROP).in('asset_key', items.map((i) => assetKeyOf(i.key))),
    sb.from('strategy_initiative_links').select('ref_key, initiative_key').eq('property_url', PROP).eq('ref_type', 'campaign').eq('role', 'primary')
  ]);
  const prev = new Map(must(prevRows, 'strategy_content_assets').map((r) => [r.asset_key, r]));
  const campaignLinks = new Map(must(links, 'strategy_initiative_links').map((l) => [l.ref_key, l.initiative_key]));
  const rows = items.map((i) => shortRecord(i, campaignOn(must(camps, 'strategy_campaigns'), i.email), prev.get(assetKeyOf(i.key)), by, now));
  const { error } = await sb.from('strategy_content_assets').upsert(rows, { onConflict: 'property_url,asset_key' });
  if (error) throw new Error(`strategy_content_assets: ${error.message}`);
  const lk = rows.flatMap((r) => useLinks(r, campaignLinks, by, now));
  if (lk.length) {
    const { error: e2 } = await sb.from('strategy_initiative_links').upsert(lk, { onConflict: 'property_url,ref_type,ref_key,initiative_key' });
    if (e2) throw new Error(`strategy_initiative_links: ${e2.message}`);
  }
  return { records: rows.length, email_uses: rows.filter((r) => r.uses.some((u) => u.channel === 'email')).length, initiative_links: lk.length, assets: rows.map((r) => r.asset_key) };
}

/* ---------- provider read (YouTube, read-only) ---------- */

/** videos.list item → provider_state (no titles / descriptions stored beyond what the record already has). */
/** YouTube's own restriction fields (region block, age limit). */
function restrictionsOf(cd) {
  return { region_blocked: cd.regionRestriction?.blocked || [], age_restricted: cd.contentRating?.ytRating === 'ytAgeRestricted' };
}
export function normaliseVideo(v, readAt) {
  const st = v.status || {};
  const secs = isoSeconds((v.contentDetails || {}).duration);
  const pub = st.privacyStatus === 'public';
  return {
    video_id: v.id, read_at: readAt, error: null, privacy: st.privacyStatus || null, publish_at: st.publishAt || null,
    public_at: pub ? v.snippet?.publishedAt || null : null, upload_status: st.uploadStatus || null,
    rejection_reason: st.rejectionReason || null, failure_reason: st.failureReason || null, embeddable: st.embeddable ?? null,
    processing_status: v.processingDetails?.processingStatus || null, duration_s: secs, duration: mmss(secs), ...restrictionsOf(v.contentDetails || {})
  };
}

async function accessToken(fetchImpl) {
  const o = youtubeConfig().oauth;
  if (!o.ready) throw new Error('youtube_owner_oauth_missing');
  return (await refreshGoogleAccessToken({ clientId: o.clientId, clientSecret: o.clientSecret, refreshToken: o.refreshToken, label: 'youtube', fetchImpl, delays: [] })).accessToken;
}

export async function loadContent(sb) {
  return must(await sb.from('strategy_content_assets').select('asset_key, kind, format, title, url, status, purpose, purpose_source, uses, used_in, note, provider_state, set_by, set_at').eq('property_url', PROP).not('format', 'is', null).limit(500), 'strategy_content_assets');
}

async function saveStates(sb, rows) {
  for (const r of rows) {
    const { error } = await sb.from('strategy_content_assets').update({ provider_state: r.provider_state }).eq('property_url', PROP).eq('asset_key', r.asset_key);
    if (error) throw new Error(`strategy_content_assets: ${error.message}`);
  }
}

/** One read of every Short's YouTube state. Missing videos and failures keep the last good state, with the error. */
export async function readShortsStatus(sb, { now = Date.now(), fetchImpl = fetch, token = null } = {}) {
  const assets = (await loadContent(sb)).filter((a) => a.format === 'short_video' && videoIdOf(a.url));
  if (!assets.length) return { ok: true, videos: 0 };
  const readAt = new Date(now).toISOString();
  const keep = (a, error) => ({ asset_key: a.asset_key, provider_state: { ...(a.provider_state || {}), video_id: videoIdOf(a.url), error, error_at: readAt } });
  try {
    const bearer = token || await accessToken(fetchImpl);
    const r = await fetchImpl(`${DATA_API}?part=status,processingDetails,contentDetails,snippet&id=${assets.map((a) => videoIdOf(a.url)).join(',')}`, { headers: { Authorization: `Bearer ${bearer}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `http_${r.status}`);
    const byId = new Map((j.items || []).map((v) => [v.id, v]));
    const rows = assets.map((a) => (byId.has(videoIdOf(a.url)) ? { asset_key: a.asset_key, provider_state: normaliseVideo(byId.get(videoIdOf(a.url)), readAt) } : keep(a, 'not returned by YouTube (deleted, or not visible to this channel)')));
    await saveStates(sb, rows);
    return { ok: true, videos: rows.length, read_at: readAt, missing: rows.filter((x) => x.provider_state.error).length };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 160);
    await saveStates(sb, assets.map((a) => keep(a, msg))).catch(() => {});
    return { ok: false, error: msg, videos: assets.length };
  }
}

/* ---------- the board's content list + the email guard ---------- */

const releaseOf = (a) => (a.uses || []).find((u) => u.channel === 'youtube')?.planned_at || null;
const durationOf = (a) => a.provider_state?.duration || (String(a.note || '').match(/Short (\d+:\d\d)/) || [])[1] || null;

/**
 * An associated use (channel social): the video is linked to an EXISTING social placement, no extra post. Its status
 * and title are that placement's own (board placements[]); placement null = every placement of the step, status
 * from the feed post first (a Story's own task status never stands in for the whole post).
 */
const PLACEMENT_ORDER = ['facebook_feed', 'instagram_feed', 'linkedin_feed', 'instagram_story'];
const placementRank = (p) => (PLACEMENT_ORDER.indexOf(p.placement) + 1) || 99;
export function associatedUse(u, placements) {
  const key = u.step_key || u.ref;
  const rows = (placements || []).filter((p) => p.step_key === key && (!u.placement || p.placement === u.placement)).sort((a, b) => placementRank(a) - placementRank(b));
  return { ...u, step_key: key, title: rows[0]?.title || null, status: rows[0]?.status || null, placements: rows.map((p) => p.placement) };
}

/** content[] (one per record, each use with its own status) and the Short refs per email delivery key. */
export function contentView(assets, emailByKey, ctx = {}) {
  const shortsByEmail = new Map();
  const content = assets.map((a) => {
    const base = { ...a, release_at: releaseOf(a), duration: durationOf(a) };
    const vs = videoStatus(base, ctx);
    const check = shortCheck(base, vs);
    const uses = (a.uses || []).map((u) => {
      if (u.channel === 'youtube') return { ...u, status: vs };
      if (u.channel === 'social') return associatedUse(u, ctx.placements);
      const d = u.campaign_key ? emailByKey.get(u.campaign_key) : null;
      if (u.channel === 'email' && u.campaign_key) shortsByEmail.set(u.campaign_key, [...(shortsByEmail.get(u.campaign_key) || []), check]);
      return { ...u, title: d?.title || null, status: d?.status || null };
    });
    return {
      asset_key: a.asset_key, title: a.title, format: a.format, format_label: FORMAT_LABEL[a.format] || a.format, purpose: a.purpose, purpose_source: a.purpose_source,
      url: a.url, video_id: videoIdOf(a.url), duration: base.duration, release_at: base.release_at, status: vs, needs_alan: vs.code === 'needs_attention' && videoNeedsAlan(a.provider_state),
      provider: a.provider_state ? { privacy: a.provider_state.privacy, publish_at: a.provider_state.publish_at, upload_status: a.provider_state.upload_status, processing_status: a.provider_state.processing_status, read_at: a.provider_state.read_at || null, error: a.provider_state.error || null } : null,
      uses
    };
  });
  return { content: content.sort((a, b) => String(a.release_at || '9').localeCompare(String(b.release_at || '9'))), shortsByEmail };
}

/** YouTube check due: every 15 minutes in hours (cheap: one videos.list call) or ~10 minutes after a release. */
export const youtubeReleases = (assets) => assets.filter((a) => a.format === 'short_video').map(releaseOf).filter(Boolean);
export const lastYoutubeRead = (assets) => assets.map((a) => a.provider_state?.error_at || a.provider_state?.read_at).filter(Boolean).sort().pop() || null;
export const lastYoutubeOk = (assets) => assets.map((a) => a.provider_state?.read_at).filter(Boolean).sort().pop() || null;
export const youtubeCheckLabel = (assets) => {
  const ok = lastYoutubeOk(assets);
  return ok ? `YouTube read ${ukDayTime(ok)}` : 'YouTube not read yet';
};
