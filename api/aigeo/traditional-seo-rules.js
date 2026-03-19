export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPoints = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'pass') return 1;
  if (normalized === 'warn') return 0.5;
  return 0;
};

const normalizeRule = (rule, index = 0) => ({
  rule_key: String(rule?.rule_key || `rule_${index}`).trim(),
  rule_name: String(rule?.rule_name || rule?.rule_key || `Rule ${index + 1}`).trim(),
  description: String(rule?.description || '').trim(),
  category: String(rule?.category || 'general').trim().toLowerCase(),
  severity: String(rule?.severity || 'medium').trim().toLowerCase(),
  scope: String(rule?.scope || 'sitewide').trim().toLowerCase(),
  current_status: String(rule?.current_status || 'fail').trim().toLowerCase(),
  enabled: rule?.enabled !== false,
  weight: Math.max(0, toNum(rule?.weight, 1)),
  sort_order: toNum(rule?.sort_order, index)
});

const computeSummary = (rules) => {
  const safeRules = Array.isArray(rules) ? rules : [];
  let weightedTotal = 0;
  let weightedAchieved = 0;
  let enabledCount = 0;
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  safeRules.forEach((rule) => {
    if (rule?.enabled === false) return;
    enabledCount += 1;
    const weight = Math.max(0, toNum(rule?.weight, 1));
    const status = String(rule?.current_status || 'fail').toLowerCase();
    weightedTotal += weight;
    weightedAchieved += weight * toPoints(status);
    if (status === 'pass') passCount += 1;
    else if (status === 'warn') warnCount += 1;
    else failCount += 1;
  });

  const score = weightedTotal > 0 ? Math.round((weightedAchieved / weightedTotal) * 100) : 0;
  return {
    score,
    weightedTotal,
    enabledCount,
    passCount,
    warnCount,
    failCount
  };
};

async function fetchRules(supabase) {
  const { data, error } = await supabase
    .from('traditional_seo_rules')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('rule_name', { ascending: true });

  if (error) throw error;
  return Array.isArray(data) ? data.map((row, idx) => normalizeRule(row, idx)) : [];
}

async function fetchLatestSnapshots(supabase, propertyUrl) {
  const query = supabase
    .from('traditional_seo_score_snapshots')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(2);
  const { data, error } = propertyUrl
    ? await query.eq('property_url', propertyUrl)
    : await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return {
    latestSnapshot: rows[0] || null,
    previousSnapshot: rows[1] || null
  };
}

async function handleGet(req, res, supabase) {
  const propertyUrl = String(req.query.propertyUrl || '').trim();
  const rules = await fetchRules(supabase);
  const summary = computeSummary(rules);
  const snapshots = await fetchLatestSnapshots(supabase, propertyUrl);
  return sendJson(res, 200, {
    status: 'ok',
    rules,
    summary,
    latestSnapshot: snapshots.latestSnapshot,
    previousSnapshot: snapshots.previousSnapshot,
    meta: { generatedAt: new Date().toISOString() }
  });
}

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const propertyUrl = String(body?.propertyUrl || '').trim();
  const rawRules = Array.isArray(body?.rules) ? body.rules : [];
  const rules = rawRules.map((rule, idx) => normalizeRule(rule, idx)).filter((rule) => rule.rule_key);

  if (rules.length === 0) {
    return sendJson(res, 400, { status: 'error', message: 'No rules supplied.' });
  }

  const upsertRows = rules.map((rule) => ({
    rule_key: rule.rule_key,
    rule_name: rule.rule_name,
    description: rule.description,
    category: rule.category,
    severity: rule.severity,
    scope: rule.scope,
    current_status: rule.current_status,
    enabled: rule.enabled,
    weight: rule.weight,
    sort_order: rule.sort_order,
    updated_at: new Date().toISOString()
  }));

  const { error: upsertError } = await supabase
    .from('traditional_seo_rules')
    .upsert(upsertRows, { onConflict: 'rule_key' });
  if (upsertError) throw upsertError;

  const savedRules = await fetchRules(supabase);
  const summary = computeSummary(savedRules);
  const snapshots = await fetchLatestSnapshots(supabase, propertyUrl);
  const previousScore = toNum(snapshots.latestSnapshot?.score, NaN);
  const delta = Number.isFinite(previousScore) ? summary.score - previousScore : null;

  const { data: insertedSnapshotRows, error: snapshotError } = await supabase
    .from('traditional_seo_score_snapshots')
    .insert([{
      property_url: propertyUrl || null,
      score: summary.score,
      delta: delta,
      rules_total: savedRules.length,
      enabled_rules: summary.enabledCount,
      pass_count: summary.passCount,
      warn_count: summary.warnCount,
      fail_count: summary.failCount,
      snapshot_payload: { rules: savedRules }
    }])
    .select('*')
    .limit(1);
  if (snapshotError) throw snapshotError;

  const latestSnapshot = Array.isArray(insertedSnapshotRows) ? insertedSnapshotRows[0] : null;
  return sendJson(res, 200, {
    status: 'ok',
    rules: savedRules,
    summary,
    latestSnapshot,
    previousSnapshot: snapshots.latestSnapshot || null,
    meta: { generatedAt: new Date().toISOString() }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET or POST.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') return await handleGet(req, res, supabase);
    return await handlePost(req, res, supabase);
  } catch (error) {
    const knownMissing = String(error?.message || '').includes('does not exist');
    if (knownMissing) {
      return sendJson(res, 200, {
        status: 'ok',
        rules: [],
        summary: computeSummary([]),
        latestSnapshot: null,
        previousSnapshot: null,
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'Traditional SEO tables not found yet (apply migration 20260319_traditional_seo_rules.sql).'
        }
      });
    }
    return sendJson(res, 500, {
      status: 'error',
      message: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
