/**
 * Supabase access for the social tiles (project igzvwbvgvmzvvzoclufx, service role, server only). The collector, the
 * OAuth routes and the summary all go through this interface so tests can swap in an in-memory store.
 * Reads: social_* tables, youtube_channel_stats / youtube_video_stats, gbp_performance_monthly, ga4_channel_sessions_daily.
 * Writes: social_connections, social_oauth_states, and upserts into social_account_daily / social_posts (never deletes).
 */
import { createClient } from '@supabase/supabase-js';

const PROP = 'https://www.alanranger.com';
const STATUS_COLS = 'channel,page_id,page_name,ig_user_id,ig_username,scopes,connected_at,expires_at,status,last_checked_at,last_collected_at,last_error';
const GA4_SOCIAL = 'source.ilike.%facebook%,source.ilike.%instagram%,source.eq.ig,source.eq.fb,source.ilike.%linkedin%,source.ilike.%lnkd%,source.ilike.%youtube%,source.ilike.%youtu.be%,source.ilike.%gbp%,source.ilike.%gmb%,medium.ilike.%gbp%,medium.ilike.%gmb%';

export function supabaseAdmin(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function allPages(build, what) {
  const out = [];
  for (let from = 0; from < 20000; from += 1000) {
    const rows = must(await build().range(from, from + 999), what) || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export function supabaseRepo(sb) {
  return {
    /** Server-side only (includes token_encrypted). */
    getConnection: async () => must(await sb.from('social_connections').select(`${STATUS_COLS},token_encrypted`).eq('channel', 'meta').maybeSingle(), 'social_connections'),
    /** Safe for a response: no token column is selected. */
    getConnectionStatus: async () => must(await sb.from('social_connections').select(STATUS_COLS).eq('channel', 'meta').maybeSingle(), 'social_connections'),
    saveConnection: async (row) => must(await sb.from('social_connections').upsert({ ...row, channel: 'meta' }, { onConflict: 'channel' }), 'social_connections'),
    updateConnection: async (patch) => must(await sb.from('social_connections').update(patch).eq('channel', 'meta'), 'social_connections'),
    deleteConnection: async () => (must(await sb.from('social_connections').delete().eq('channel', 'meta').select('channel'), 'social_connections') || []).length,
    createState: async (stateHash, expiresAt) => {
      await sb.from('social_oauth_states').delete().lt('expires_at', new Date(Date.now() - 864e5).toISOString());
      must(await sb.from('social_oauth_states').insert({ state_hash: stateHash, expires_at: expiresAt }), 'social_oauth_states');
    },
    /** One use only: marks used_at where unused and unexpired; true when exactly that row was claimed. */
    consumeState: async (stateHash, nowIso) => (must(await sb.from('social_oauth_states').update({ used_at: nowIso }).eq('state_hash', stateHash).is('used_at', null).gt('expires_at', nowIso).select('state_hash'), 'social_oauth_states') || []).length === 1,
    readDaily: async (channels, sinceDate) => must(await sb.from('social_account_daily').select('*').in('channel', channels).gte('date', sinceDate).order('date'), 'social_account_daily') || [],
    readPosts: async (channels, sinceIso) => must(await sb.from('social_posts').select('*').in('channel', channels).gte('posted_at', sinceIso).order('posted_at', { ascending: false }).limit(1000), 'social_posts') || [],
    upsertDaily: async (rows) => (rows.length ? must(await sb.from('social_account_daily').upsert(rows, { onConflict: 'channel,date' }), 'social_account_daily') : null),
    upsertPosts: async (rows) => (rows.length ? must(await sb.from('social_posts').upsert(rows, { onConflict: 'channel,post_id' }), 'social_posts') : null),
    readYoutube: async () => {
      const channel = must(await sb.from('youtube_channel_stats').select('captured_date,channel_title,subscribers,total_videos,window_days,views_window,impressions_ctr_window,watch_time_minutes_window,source,created_at').order('captured_date', { ascending: false }).limit(70), 'youtube_channel_stats') || [];
      const latest = channel[0]?.captured_date;
      const videos = latest ? must(await sb.from('youtube_video_stats').select('video_id,title,published_at,views,likes,comments,captured_date').eq('captured_date', latest).order('published_at', { ascending: false }).limit(200), 'youtube_video_stats') || [] : [];
      const since = new Date(Date.parse(`${latest}T00:00:00Z`) - 100 * 864e5).toISOString();
      const ids = videos.filter((v) => v.published_at >= since).map((v) => v.video_id);
      const snapshots = ids.length ? await allPages(() => sb.from('youtube_video_stats').select('video_id,captured_date,views').in('video_id', ids).gte('captured_date', since.slice(0, 10)).order('captured_date'), 'youtube_video_stats') : [];
      return { channel, videos, snapshots };
    },
    readGbpMonths: async () => must(await sb.from('gbp_performance_monthly').select('*').order('month', { ascending: false }).limit(3), 'gbp_performance_monthly') || [],
    readGa4Social: async (sinceDate) => allPages(() => sb.from('ga4_channel_sessions_daily').select('date,source,medium,sessions').eq('property_url', PROP).eq('is_unattributed', false).gte('date', sinceDate).or(GA4_SOCIAL).order('date'), 'ga4_channel_sessions_daily'),
    ga4LatestDate: async () => (must(await sb.from('ga4_channel_sessions_daily').select('date').eq('property_url', PROP).order('date', { ascending: false }).limit(1), 'ga4_channel_sessions_daily') || [])[0]?.date || null
  };
}
