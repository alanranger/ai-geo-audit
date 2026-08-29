/**
 * Acquisition — Academy outcome lens.
 *
 * Reads channel -> trial -> member attribution from the ACADEMY Supabase
 * project (dqrtcsvqsfgbqmnonkpt), which is a different project from this
 * app's own DB. Read-only.
 *
 * Attribution is FORWARD-ONLY from ATTRIBUTION_START: signup_source was not
 * captured before then, so every earlier trial is genuinely unattributed and
 * is reported as its own line rather than being spread across channels.
 */
import { createClient } from '@supabase/supabase-js';

export const ATTRIBUTION_START = '2026-08-29';
export const UNATTRIBUTED = 'unattributed';

/** Marketing source -> the five Acquisition channels. */
const CHANNEL_BY_SOURCE = {
  youtube: 'youtube',
  yt: 'youtube',
  google: 'google_organic',
  organic: 'google_organic',
  chatgpt: 'chatgpt',
  chat_gpt: 'chatgpt',
  openai: 'chatgpt',
  gemini: 'google_ai',
  google_ai: 'google_ai',
  direct: 'direct_referral',
  referral: 'direct_referral',
  email: 'direct_referral',
};

export function channelForSource(source) {
  if (!source) return UNATTRIBUTED;
  const key = String(source).trim().toLowerCase();
  if (!key) return UNATTRIBUTED;
  return CHANNEL_BY_SOURCE[key] || 'other';
}

export function academyClient() {
  const url = process.env.ACADEMY_SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function emptyBucket(channel) {
  return { channel, trials: 0, members: 0, trial_to_paid_pct: null };
}

/**
 * Roll trial rows into per-channel trials + conversions.
 * `sinceIso` bounds the window; rows before ATTRIBUTION_START can only ever
 * land in the unattributed bucket.
 */
export function summariseByChannel(trials, sinceIso) {
  const since = sinceIso ? new Date(sinceIso).getTime() : null;
  const buckets = new Map();
  let preAttribution = 0;

  for (const row of trials || []) {
    const startedAt = row?.trial_start_at ? new Date(row.trial_start_at).getTime() : null;
    if (since && (startedAt == null || startedAt < since)) continue;
    if (startedAt != null && startedAt < new Date(ATTRIBUTION_START).getTime()) preAttribution += 1;

    const channel = channelForSource(row?.signup_source);
    if (!buckets.has(channel)) buckets.set(channel, emptyBucket(channel));
    const bucket = buckets.get(channel);
    bucket.trials += 1;
    if (row?.converted_at) bucket.members += 1;
  }

  const rows = [...buckets.values()].map((b) => ({
    ...b,
    trial_to_paid_pct: b.trials > 0 ? Number(((b.members / b.trials) * 100).toFixed(1)) : null,
  }));
  rows.sort((a, b) => b.members - a.members || b.trials - a.trials);
  return { rows, pre_attribution_trials: preAttribution };
}

export function windowStartIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

/**
 * @param {{ days?: number }} opts
 */
export async function fetchAcademyChannelOutcomes(opts = {}) {
  const sb = academyClient();
  if (!sb) {
    return {
      configured: false,
      message: 'Set ACADEMY_SUPABASE_URL + ACADEMY_SUPABASE_SERVICE_ROLE_KEY to enable the Academy outcome lens.',
    };
  }
  const days = opts.days || 28;
  const sinceIso = windowStartIso(days);
  const { data, error } = await sb
    .from('academy_trial_history')
    .select('member_id, trial_start_at, converted_at, signup_source')
    .gte('trial_start_at', sinceIso)
    .order('trial_start_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`academy_trial_history: ${error.message}`);

  const summary = summariseByChannel(data, sinceIso);
  return {
    configured: true,
    days,
    since: sinceIso,
    attribution_start: ATTRIBUTION_START,
    forward_only_note: `Channel → signup captured from ${ATTRIBUTION_START} (forward-only). Earlier trials cannot be attributed.`,
    ...summary,
  };
}
