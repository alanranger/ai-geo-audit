export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { collectMentionCandidates, loadMentionKeywords } from '../../lib/mentions/baseline.js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
  res.status(status).send(JSON.stringify(body));
};

const coerceBoolean = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const parseBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    console.warn('[mentions-ingestion] Invalid JSON body:', err.message);
    return {};
  }
};

const normalizeUrlKey = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch (err) {
    console.warn('[mentions-ingestion] URL normalization fallback:', err.message);
    return String(url || '').trim().toLowerCase();
  }
};

const buildParams = async (req) => {
  const source = req.method === 'POST'
    ? { ...(await parseBody(req)), ...(req.query || {}) }
    : (req.query || {});
  return {
    persist: coerceBoolean(source.persist, true),
    keywordLimit: Number(source.maxKeywords || source.keywordLimit || 30),
    perQueryLimit: Number(source.perQueryLimit || 3)
  };
};

const countAlerts = (mentions) => {
  return mentions.filter((item) => ['alert', 'critical'].includes(String(item.alert_level || '').toLowerCase())).length;
};

const buildTopAlerts = (mentions, limit = 20) => {
  return [...mentions]
    .filter((item) => ['alert', 'critical'].includes(String(item.alert_level || '').toLowerCase()))
    .sort((a, b) => Number(b.mention_score || 0) - Number(a.mention_score || 0))
    .slice(0, limit);
};

const createNoKeywordPayload = (keywordSource) => ({
  runPersisted: false,
  keywordSource,
  keywordsTotal: 0,
  keywordsUsed: 0,
  mentionsFound: 0,
  newMentions: 0,
  alertsCount: 0,
  platformBreakdown: {},
  mentions: []
});

const getExistingMentionKeys = async (supabase, mentions) => {
  const sourceUrls = [...new Set(mentions.map((item) => item.source_url).filter(Boolean))];
  const platforms = [...new Set(mentions.map((item) => item.platform).filter(Boolean))];
  const { data: existingRows, error: existingError } = await supabase
    .from('mentions_baseline_entries')
    .select('platform,source_url')
    .in('source_url', sourceUrls.length ? sourceUrls : [''])
    .in('platform', platforms.length ? platforms : ['']);

  if (existingError) {
    const message = String(existingError.message || '');
    if (!message.includes('does not exist')) {
      throw new Error(`mentions existing query failed: ${existingError.message}`);
    }
    return { tableWarning: 'mentions_baseline_entries table missing', keySet: new Set() };
  }

  const keySet = new Set((existingRows || []).map((row) => `${row.platform}|${normalizeUrlKey(row.source_url)}`));
  return { tableWarning: null, keySet };
};

const insertRunRow = async (supabase, payload) => {
  const { data: runRow, error: runError } = await supabase
    .from('mentions_baseline_runs')
    .insert(payload)
    .select('id')
    .single();

  if (!runError) return { runId: runRow?.id || null, tableWarning: null };
  const message = String(runError.message || '');
  if (message.includes('does not exist')) {
    return { runId: null, tableWarning: 'mentions_baseline_runs table missing' };
  }
  throw new Error(`mentions run insert failed: ${runError.message}`);
};

const upsertMentionEntries = async (supabase, mentions, runId) => {
  if (!mentions.length || !runId) return;
  const nowIso = new Date().toISOString();
  const rows = mentions.map((row) => ({
    ...row,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    last_seen_run_id: runId
  }));
  const { error: upsertError } = await supabase
    .from('mentions_baseline_entries')
    .upsert(rows, { onConflict: 'platform,source_url' });
  if (upsertError) {
    throw new Error(`mentions entry upsert failed: ${upsertError.message}`);
  }
};

const persistMentions = async ({ mentions, keywords, keywordsUsed, keywordSource, alertsCount }) => {
  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const existingMeta = await getExistingMentionKeys(supabase, mentions);
  const newMentions = mentions.filter((row) => !existingMeta.keySet.has(`${row.platform}|${normalizeUrlKey(row.source_url)}`)).length;
  if (existingMeta.tableWarning) {
    return { runPersisted: false, runId: null, newMentions, tableWarning: existingMeta.tableWarning };
  }

  const runMeta = await insertRunRow(supabase, {
    run_started_at: new Date().toISOString(),
    run_completed_at: new Date().toISOString(),
    status: 'ok',
    polling_frequency: 'daily',
    keywords_total: keywords.length,
    keywords_used: keywordsUsed.length,
    mentions_found: mentions.length,
    new_mentions: newMentions,
    alerts_count: alertsCount,
    platform_breakdown: mentions.reduce((acc, row) => {
      acc[row.platform] = (acc[row.platform] || 0) + 1;
      return acc;
    }, {}),
    keyword_source: keywordSource
  });
  if (runMeta.tableWarning) {
    return { runPersisted: false, runId: null, newMentions, tableWarning: runMeta.tableWarning };
  }

  await upsertMentionEntries(supabase, mentions, runMeta.runId);
  return { runPersisted: true, runId: runMeta.runId, newMentions, tableWarning: null };
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET or POST.' });
  }

  try {
    const params = await buildParams(req);
    const { persist, keywordLimit, perQueryLimit } = params;

    const { keywords, source: keywordSource } = await loadMentionKeywords();
    if (!keywords.length) {
      return sendJson(res, 200, {
        status: 'ok',
        data: createNoKeywordPayload(keywordSource),
        meta: { generatedAt: new Date().toISOString(), warning: 'No keywords found' }
      });
    }

    const { keywordsUsed, mentions, platformBreakdown } = await collectMentionCandidates({
      keywords,
      keywordLimit,
      perQueryLimit
    });

    const alertsCount = countAlerts(mentions);
    const persistenceMeta = persist
      ? await persistMentions({ mentions, keywords, keywordsUsed, keywordSource, alertsCount })
      : { runPersisted: false, runId: null, newMentions: 0, tableWarning: null };

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        runPersisted: persistenceMeta.runPersisted,
        runId: persistenceMeta.runId,
        polling: 'daily',
        keywordSource,
        keywordsTotal: keywords.length,
        keywordsUsed: keywordsUsed.length,
        mentionsFound: mentions.length,
        newMentions: persistenceMeta.newMentions,
        alertsCount,
        platformBreakdown,
        topAlerts: buildTopAlerts(mentions),
        tableWarning: persistenceMeta.tableWarning
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    return sendJson(res, 500, {
      status: 'error',
      message: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
