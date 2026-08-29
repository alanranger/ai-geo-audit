/**
 * Acquisition — YouTube channel.
 *
 * Two APIs, deliberately separated because they need different scopes:
 *
 *   Data API v3      — channel + video stats (subscribers, views, likes,
 *                      comments). Works with EITHER an API key OR the owner
 *                      OAuth token, so an OAuth-only setup needs no API key.
 *   Analytics API    — impressions, impressions CTR, watch time and
 *                      clicks-to-site. Needs the `yt-analytics.readonly`
 *                      scope specifically; `youtube.readonly` is NOT enough.
 *
 * When Analytics is unavailable the impression/click columns stay NULL and
 * `source` records `data_api`, so the UI can say what is missing instead of
 * showing a zero that looks like real data.
 *
 * FORWARD-ONLY: both APIs report current/period totals, not a backfillable
 * per-day history for dates before the first run.
 */
import { createClient } from '@supabase/supabase-js';

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const DEFAULT_WINDOW_DAYS = 28;
export const MAX_VIDEOS = 50;

export function youtubeConfig() {
  const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  const channelId = String(process.env.YOUTUBE_CHANNEL_ID || '').trim();
  const handle = String(process.env.YOUTUBE_CHANNEL_HANDLE || '').trim();
  const oauth = oauthConfig();
  return {
    apiKey,
    channelId,
    handle,
    oauth,
    // OAuth can drive the Data API on its own via mine=true, so an API key is
    // only required when there is no owner OAuth to fall back on.
    dataApiReady: Boolean(oauth.ready || (apiKey && (channelId || handle))),
    analytics: oauth,
  };
}

function oauthConfig() {
  const clientId = String(process.env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.YOUTUBE_REFRESH_TOKEN || '').trim();
  return {
    clientId,
    clientSecret,
    refreshToken,
    ready: Boolean(clientId && clientSecret && refreshToken),
  };
}

/**
 * Setup steps still owed by a human. Names each absent OAuth variable
 * separately: lumping them into one message cannot tell you which of the three
 * failed to save, which is the only thing you need to know to fix it.
 * Never returns a value, only a variable name.
 */
export function missingSetup(cfg = youtubeConfig()) {
  if (cfg.oauth?.ready) return [];
  // The API-key path is a complete alternative to owner OAuth.
  if (cfg.apiKey && (cfg.channelId || cfg.handle)) return [];

  const oauth = cfg.oauth || {};
  const missing = [];
  if (!oauth.clientId) missing.push('YOUTUBE_CLIENT_ID');
  if (!oauth.clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
  if (!oauth.refreshToken) missing.push('YOUTUBE_REFRESH_TOKEN');
  if (!cfg.apiKey) missing.push('YOUTUBE_API_KEY (only needed if not using owner OAuth)');
  if (!cfg.channelId && !cfg.handle) missing.push('YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE');
  return missing;
}

/** Which YouTube variables the running deployment can see — names only. */
export function credentialPresence(cfg = youtubeConfig()) {
  const oauth = cfg.oauth || {};
  return {
    YOUTUBE_CLIENT_ID: Boolean(oauth.clientId),
    YOUTUBE_CLIENT_SECRET: Boolean(oauth.clientSecret),
    YOUTUBE_REFRESH_TOKEN: Boolean(oauth.refreshToken),
    YOUTUBE_CHANNEL_ID: Boolean(cfg.channelId),
    YOUTUBE_API_KEY: Boolean(cfg.apiKey),
  };
}

async function getJson(url, accessToken) {
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const res = await fetch(url, { headers });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = json?.error?.message || `http_${res.status}`;
    throw new Error(`youtube_api: ${reason}`);
  }
  return json;
}

/** Data API accepts either an OAuth bearer token or a `key=` query param. */
function apiAuthSuffix(cfg, accessToken) {
  return accessToken ? '' : `&key=${cfg.apiKey}`;
}

const num = (v) => (v == null ? null : Number(v));

export function windowStartIso(windowDays = DEFAULT_WINDOW_DAYS, now = new Date()) {
  const start = new Date(now.getTime() - windowDays * 86400000);
  return start.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** channels.list -> the one row we care about, plus its uploads playlist id. */
export function normaliseChannel(item, capturedDate, windowDays, source) {
  const stats = item?.statistics || {};
  return {
    channel_id: item?.id ?? null,
    captured_date: capturedDate,
    channel_title: item?.snippet?.title ?? null,
    subscribers: num(stats.subscriberCount),
    total_views: num(stats.viewCount),
    total_videos: num(stats.videoCount),
    window_days: windowDays,
    views_window: null,
    impressions_window: null,
    impressions_ctr_window: null,
    watch_time_minutes_window: null,
    clicks_to_site_window: null,
    source,
  };
}

export function normaliseVideos(items, channelId, capturedDate) {
  if (!Array.isArray(items)) return [];
  return items.map((v) => ({
    channel_id: channelId,
    video_id: v?.id ?? null,
    captured_date: capturedDate,
    title: v?.snippet?.title ?? null,
    published_at: v?.snippet?.publishedAt ?? null,
    views: num(v?.statistics?.viewCount),
    likes: num(v?.statistics?.likeCount),
    comments: num(v?.statistics?.commentCount),
    impressions: null,
    impressions_ctr: null,
    clicks_to_site: null,
  })).filter((r) => r.video_id);
}

function channelSelector(cfg, accessToken) {
  if (cfg.channelId) return `id=${encodeURIComponent(cfg.channelId)}`;
  if (cfg.handle) return `forHandle=${encodeURIComponent(cfg.handle.replace(/^@/, ''))}`;
  if (accessToken) return 'mine=true';
  throw new Error('youtube_api: no channel selector configured');
}

async function fetchChannel(cfg, accessToken) {
  const url = `${DATA_API}/channels?part=snippet,statistics,contentDetails`
    + `&${channelSelector(cfg, accessToken)}${apiAuthSuffix(cfg, accessToken)}`;
  const json = await getJson(url, accessToken);
  const item = json?.items?.[0];
  if (!item) throw new Error('youtube_api: channel_not_found');
  return item;
}

async function fetchUploadIds(cfg, playlistId, accessToken) {
  if (!playlistId) return [];
  const url = `${DATA_API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(playlistId)}`
    + `&maxResults=${MAX_VIDEOS}${apiAuthSuffix(cfg, accessToken)}`;
  const json = await getJson(url, accessToken);
  return (json?.items || []).map((i) => i?.contentDetails?.videoId).filter(Boolean);
}

async function fetchVideos(cfg, ids, accessToken) {
  if (!ids.length) return [];
  const url = `${DATA_API}/videos?part=snippet,statistics&id=${ids.join(',')}`
    + apiAuthSuffix(cfg, accessToken);
  const json = await getJson(url, accessToken);
  return json?.items || [];
}

async function oauthAccessToken(oauth) {
  const body = new URLSearchParams({
    client_id: oauth.clientId,
    client_secret: oauth.clientSecret,
    refresh_token: oauth.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`youtube_oauth: ${json?.error_description || json?.error || res.status}`);
  }
  return { accessToken: json.access_token, scope: String(json.scope || '') };
}

export function hasAnalyticsScope(scope) {
  return String(scope || '').includes('yt-analytics');
}

/** Map an Analytics API rows/columnHeaders payload onto the window columns. */
export function normaliseAnalyticsWindow(payload) {
  const headers = (payload?.columnHeaders || []).map((h) => h?.name);
  const row = payload?.rows?.[0];
  if (!row) return {};
  const at = (name) => {
    const i = headers.indexOf(name);
    return i >= 0 ? num(row[i]) : null;
  };
  return {
    views_window: at('views'),
    impressions_window: at('impressions'),
    impressions_ctr_window: at('impressionsClickThroughRate'),
    watch_time_minutes_window: at('estimatedMinutesWatched'),
    clicks_to_site_window: at('cardClicks'),
  };
}

async function fetchAnalyticsWindow(accessToken, channelId, windowDays) {
  const metrics = 'views,estimatedMinutesWatched,impressions,impressionsClickThroughRate,cardClicks';
  const url = `${ANALYTICS_API}?ids=channel==${encodeURIComponent(channelId)}`
    + `&startDate=${windowStartIso(windowDays)}&endDate=${todayIso()}&metrics=${metrics}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`youtube_analytics: ${json?.error?.message || res.status}`);
  return normaliseAnalyticsWindow(json);
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function persist(sb, channelRow, videoRows) {
  const { error: chErr } = await sb
    .from('youtube_channel_stats')
    .upsert([channelRow], { onConflict: 'channel_id,captured_date' });
  if (chErr) throw new Error(`youtube_channel_stats: ${chErr.message}`);
  if (!videoRows.length) return 1;
  const { error: vErr } = await sb
    .from('youtube_video_stats')
    .upsert(videoRows, { onConflict: 'video_id,captured_date' });
  if (vErr) throw new Error(`youtube_video_stats: ${vErr.message}`);
  return 1 + videoRows.length;
}

/**
 * @param {{ persist?: boolean, windowDays?: number, capturedDate?: string }} opts
 */
export async function collectYoutubeStats(opts = {}) {
  const cfg = youtubeConfig();
  if (!cfg.dataApiReady) {
    return {
      configured: false,
      missing: missingSetup(cfg),
      credentials_visible: credentialPresence(cfg),
      rows_written: 0,
    };
  }
  const windowDays = opts.windowDays || DEFAULT_WINDOW_DAYS;
  const capturedDate = opts.capturedDate || todayIso();

  let accessToken = null;
  let scope = '';
  if (cfg.oauth.ready) {
    ({ accessToken, scope } = await oauthAccessToken(cfg.oauth));
  }

  const channel = await fetchChannel(cfg, accessToken);
  const ids = await fetchUploadIds(cfg, channel?.contentDetails?.relatedPlaylists?.uploads, accessToken);
  const videos = await fetchVideos(cfg, ids, accessToken);

  let source = 'data_api';
  let analyticsWindow = {};
  let analyticsError = null;
  if (!accessToken) {
    analyticsError = 'no owner OAuth — impressions / CTR / clicks-to-site unavailable';
  } else if (!hasAnalyticsScope(scope)) {
    analyticsError = `token scope is "${scope}" — impressions / CTR / clicks-to-site need yt-analytics.readonly`;
  } else {
    try {
      analyticsWindow = await fetchAnalyticsWindow(accessToken, channel.id, windowDays);
      source = 'data_api+analytics_api';
    } catch (err) {
      analyticsError = err?.message || String(err);
    }
  }

  const channelRow = { ...normaliseChannel(channel, capturedDate, windowDays, source), ...analyticsWindow };
  const videoRows = normaliseVideos(videos, channel.id, capturedDate);
  const summary = {
    configured: true,
    captured_date: capturedDate,
    channel_id: channel.id,
    source,
    analytics_error: analyticsError,
    missing: missingSetup(cfg),
    channel: channelRow,
    videos: videoRows.length,
  };

  if (opts.persist === false) return { ...summary, rows_written: 0, persisted: false };
  const sb = supabaseAdmin();
  if (!sb) throw new Error('missing_supabase_credentials');
  const written = await persist(sb, channelRow, videoRows);
  return { ...summary, rows_written: written, persisted: true };
}
