/**
 * Acquisition — AI channels (ChatGPT + Google AI) via DataForSEO llm_mentions.
 *
 * chat_gpt and google are the ONLY platforms this API supports. Gemini and
 * Perplexity are not available from this source, so the tab must say so
 * rather than imply the AI picture is complete.
 *
 * Writes:
 *   llm_mentions_daily   — today's snapshot per platform (rolled up + UK)
 *   llm_mentions_monthly — ~13 months of history (backfilled on first run)
 */
import { createClient } from '@supabase/supabase-js';

export const AI_PLATFORMS = ['chat_gpt', 'google'];
export const PROPERTY_URL = 'https://www.alanranger.com';
export const DOMAIN = 'alanranger.com';
export const UK_LOCATION_CODE = 2826;

const DFS_BASE = 'https://api.dataforseo.com/v3';

export function dfsCreds() {
  const login = String(process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN || '').trim();
  const password = String(
    process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD || ''
  ).trim();
  if (!login || !password) return null;
  return { login, password };
}

async function postDfs(creds, path, body) {
  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
  const res = await fetch(`${DFS_BASE}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  return {
    ok: task?.status_code === 20000,
    cost: Number(task?.cost ?? 0) || 0,
    message: task?.status_message || json?.status_message || `http_${res.status}`,
    result: task?.result ?? null,
  };
}

function targetSpec() {
  return [{ domain: DOMAIN, search_filter: 'include', include_subdomains: true }];
}

const num = (v) => (v == null ? null : Number(v));

function groupEntry(groups, key) {
  if (!Array.isArray(groups)) return null;
  return groups.find((g) => String(g?.key) === String(key)) || null;
}

/** Our own domain's slice of the sources breakdown = mentions that actually cited us. */
function ownDomainEntry(sources) {
  if (!Array.isArray(sources)) return null;
  return sources.find((s) => String(s?.key || '').toLowerCase().endsWith(DOMAIN)) || null;
}

function topSources(sources, limit = 10) {
  if (!Array.isArray(sources)) return null;
  return sources.slice(0, limit).map((s) => ({
    domain: s?.key ?? null,
    mentions: num(s?.mentions),
    ai_search_volume: num(s?.ai_search_volume),
  }));
}

function dailyRow({ platform, capturedDate, locationCode, entry, sources, cost }) {
  const own = ownDomainEntry(sources);
  return {
    property_url: PROPERTY_URL,
    captured_date: capturedDate,
    platform,
    location_code: locationCode,
    mentions: num(entry?.mentions),
    ai_search_volume: num(entry?.ai_search_volume),
    own_domain_mentions: num(own?.mentions),
    own_domain_ai_search_volume: num(own?.ai_search_volume),
    top_sources: topSources(sources),
    cost_usd: cost ?? null,
  };
}

/**
 * Aggregated metrics -> daily rows. Two rows per platform: the rolled-up
 * total (location_code NULL) and the UK slice, which is the one that matters
 * commercially. Reach units are per-channel and are never summed.
 */
export function normaliseAggregated(result, platform, capturedDate, cost = null) {
  const total = result?.[0]?.total;
  if (!total) return [];
  const sources = total.sources_domain;
  const platformEntry = groupEntry(total.platform, platform);
  const rows = [
    dailyRow({ platform, capturedDate, locationCode: null, entry: platformEntry, sources, cost }),
  ];
  const uk = groupEntry(total.location, UK_LOCATION_CODE);
  if (uk) {
    rows.push(
      dailyRow({ platform, capturedDate, locationCode: UK_LOCATION_CODE, entry: uk, sources: null, cost: null })
    );
  }
  return rows;
}

/** Historical items -> monthly rows keyed on the first day of each month. */
export function normaliseHistorical(result, platform) {
  const items = result?.[0]?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it?.year && it?.month)
    .map((it) => ({
      property_url: PROPERTY_URL,
      platform,
      month: `${it.year}-${String(it.month).padStart(2, '0')}-01`,
      mentions: num(it?.metrics?.mentions),
      ai_search_volume: num(it?.metrics?.ai_search_volume),
      refreshed_at: new Date().toISOString(),
    }));
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function fetchPlatform(creds, platform, capturedDate) {
  const body = [{ language_code: 'en', platform, target: targetSpec() }];
  const [agg, hist] = await Promise.all([
    postDfs(creds, 'ai_optimization/llm_mentions/aggregated_metrics/live', body),
    postDfs(creds, 'ai_optimization/llm_mentions/historical/live', body),
  ]);
  const cost = agg.cost + hist.cost;
  return {
    platform,
    ok: agg.ok && hist.ok,
    message: agg.ok ? hist.message : agg.message,
    cost,
    daily: agg.ok ? normaliseAggregated(agg.result, platform, capturedDate, agg.cost) : [],
    monthly: hist.ok ? normaliseHistorical(hist.result, platform) : [],
  };
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function persistPlatform(sb, pull) {
  let written = 0;
  if (pull.daily.length) {
    const { error } = await sb
      .from('llm_mentions_daily')
      .upsert(pull.daily, { onConflict: 'property_url,captured_date,platform,location_code' });
    if (error) throw new Error(`llm_mentions_daily: ${error.message}`);
    written += pull.daily.length;
  }
  if (pull.monthly.length) {
    const { error } = await sb
      .from('llm_mentions_monthly')
      .upsert(pull.monthly, { onConflict: 'property_url,platform,month' });
    if (error) throw new Error(`llm_mentions_monthly: ${error.message}`);
    written += pull.monthly.length;
  }
  return written;
}

/**
 * @param {{ platforms?: string[], persist?: boolean, capturedDate?: string }} opts
 */
export async function collectLlmMentions(opts = {}) {
  const creds = dfsCreds();
  if (!creds) throw new Error('missing_dataforseo_credentials');
  const platforms = opts.platforms?.length ? opts.platforms : AI_PLATFORMS;
  const capturedDate = opts.capturedDate || todayIso();

  const pulls = [];
  for (const platform of platforms) {
    pulls.push(await fetchPlatform(creds, platform, capturedDate));
  }
  const cost = pulls.reduce((sum, p) => sum + p.cost, 0);
  const summary = { captured_date: capturedDate, cost_usd: Math.round(cost * 1000) / 1000, platforms: pulls };

  if (opts.persist === false) return { ...summary, rows_written: 0, persisted: false };

  const sb = supabaseAdmin();
  if (!sb) throw new Error('missing_supabase_credentials');
  let written = 0;
  for (const pull of pulls) {
    if (pull.ok) written += await persistPlatform(sb, pull);
  }
  return { ...summary, rows_written: written, persisted: true };
}
