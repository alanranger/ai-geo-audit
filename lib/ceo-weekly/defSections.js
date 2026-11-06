/**
 * CEO email sections D/E/F metric helpers (Backlinks extras, click movers, SEO health).
 */
import { DEFAULT_PROPERTY, deltaArrow, fmtNum } from './shared.js';
import { seoHealthComparable, withheldWow } from './comparability.js';

function appBase() {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scorePoints(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'pass') return 1;
  if (s === 'warn') return 0.5;
  return 0;
}

/** WoW label: real Δ when prior exists, else "from next Monday". */
export function weekSnapWow(curr, prev) {
  if (prev == null || !Number.isFinite(Number(prev))) {
    return { delta: null, arrow: '→', label: 'from next Monday', pending: true };
  }
  return { ...deltaArrow(curr, prev), pending: false };
}

function hostFromUrl(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase().slice(0, 80);
  }
}

function shortPageLabel(url) {
  const raw = String(url || '').trim();
  const path = raw.replace(/^https?:\/\/[^/]+/i, '').replace(/\/$/, '');
  const leaf = path.split('/').filter(Boolean).pop() || path || raw;
  const label = leaf.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim();
  if (!label) return raw.slice(0, 42);
  return label.charAt(0).toUpperCase() + label.slice(1).slice(0, 41);
}

/**
 * High-DA dofollow link set for weekly snapshot diff (D · new links).
 * Keys = referring host; stored on metrics.backlinks for next Monday.
 */
export async function loadHighDaDofollowSnapshot(supabase, priorBl = {}) {
  const { data, error } = await supabase
    .from('dfs_domain_backlink_rows')
    .select('url_from, domain_from_rank')
    .eq('domain_host', 'alanranger.com')
    .eq('dofollow', true)
    .gte('domain_from_rank', 50)
    .order('domain_from_rank', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const byHost = new Map();
  for (const row of data || []) {
    const host = hostFromUrl(row.url_from);
    const da = num(row.domain_from_rank);
    if (!host || da == null) continue;
    const prev = byHost.get(host);
    if (!prev || da > prev.da) byHost.set(host, { host, da });
  }
  const keys = [...byHost.keys()].sort();
  const priorKeys = Array.isArray(priorBl.high_da_dofollow_keys) ? priorBl.high_da_dofollow_keys : null;
  const priorSet = priorKeys ? new Set(priorKeys) : null;

  let new_links = { status: 'from_next_monday', items: [], note: 'needs ≥2 weekly CEO snapshots' };
  if (priorSet) {
    const items = [...byHost.values()]
      .filter((r) => !priorSet.has(r.host))
      .sort((a, b) => b.da - a.da)
      .slice(0, 8);
    new_links = {
      status: 'ready',
      items,
      note: items.length ? null : 'none this week'
    };
  }

  return { high_da_dofollow_keys: keys, new_links };
}

export async function fetchClickMoversTop3(propertyUrl = DEFAULT_PROPERTY) {
  const q = new URLSearchParams({ siteUrl: propertyUrl });
  const res = await fetch(`${appBase()}/api/supabase/get-gsc-csv40d-click-movers?${q}`, {
    headers: { Accept: 'application/json' }
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== 'ok') {
    return {
      climbers: [],
      droppers: [],
      window: null,
      error: json.reason || json.message || `click_movers_${res.status}`
    };
  }
  const mapRow = (r) => ({
    title: shortPageLabel(r.page_url),
    page_url: r.page_url,
    delta: num(r.delta)
  });
  return {
    climbers: (json.gainers || []).slice(0, 3).map(mapRow),
    droppers: (json.losers || []).slice(0, 3).map(mapRow),
    window: {
      newer: json.newer?.date_end || null,
      older: json.older?.date_end || null
    },
    source: 'get-gsc-csv40d-click-movers (csv40d or dated gsc_page_metrics_28d)'
  };
}

function aggregateRuleStatus(rows, ruleKey) {
  const statuses = (rows || [])
    .filter((row) => String(row.rule_key) === String(ruleKey))
    .filter((row) => String(row?.tier || '').toLowerCase() !== 'sitewide')
    .map((row) => String(row.status || 'fail').toLowerCase())
    // na / redirected / gone must not inflate SEO-health FAIL in the CEO brief
    .filter((s) => s !== 'na' && s !== 'redirected' && s !== 'gone' && s !== 'hidden');
  if (!statuses.length) return 'pass';
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

function countGscIndexFails(rows) {
  let fail = 0;
  const seen = new Set();
  for (const r of rows || []) {
    if (String(r.rule_key) !== 'gsc_url_indexed') continue;
    if (String(r?.tier || '').toLowerCase() === 'sitewide') continue;
    const key = String(r.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (String(r.status || '').toLowerCase() === 'fail') fail += 1;
  }
  return fail;
}

/** Saved rows for rules switched on in Rule Manager; a disabled rule's rows stay stored but count nowhere. */
export function enabledRuleRows(evaluationRows, rules) {
  const disabled = new Set((rules || []).filter((r) => r?.enabled === false).map((r) => String(r.rule_key)));
  const rows = Array.isArray(evaluationRows) ? evaluationRows : [];
  return rows.filter((r) => !disabled.has(String(r?.rule_key)));
}

function scoreEnabledRules(enabledRules, rows) {
  const out = { score: 0, pass: 0, warn: 0, fail: 0, failRules: [] };
  let weightedTotal = 0;
  let weightedAchieved = 0;
  for (const rule of enabledRules) {
    const weight = Math.max(0, num(rule.weight) ?? 1);
    const status = rows.length
      ? aggregateRuleStatus(rows, rule.rule_key)
      : String(rule.current_status || 'fail').toLowerCase();
    weightedTotal += weight;
    weightedAchieved += weight * scorePoints(status);
    if (status === 'pass' || status === 'warn') out[status] += 1;
    else {
      out.fail += 1;
      out.failRules.push({ rule_key: rule.rule_key, rule_name: rule.rule_name, status });
    }
  }
  out.score = weightedTotal > 0 ? Math.round((weightedAchieved / weightedTotal) * 100) : 0;
  return out;
}

async function seoScoreWow(supabase, score, priorCeo) {
  const { data: snapRows } = await supabase
    .from('traditional_seo_score_snapshots')
    .select('score, created_at')
    .order('created_at', { ascending: false })
    .limit(1);
  const snapScore = num(snapRows?.[0]?.score);
  // Prefer prior Monday CEO snapshot; else last persisted Trad SEO score baseline
  if (priorCeo != null) return { scoreWowBase: priorCeo, score_wow: weekSnapWow(score, priorCeo) };
  if (snapScore == null) return { scoreWowBase: snapScore, score_wow: weekSnapWow(score, null) };
  return {
    scoreWowBase: snapScore,
    score_wow: { ...deltaArrow(score, snapScore), pending: false, vs: 'traditional_seo_score_snapshots' }
  };
}

async function domainStrengthPair(supabase) {
  const { data: ds } = await supabase
    .from('domain_strength_snapshots')
    .select('score, organic_keywords_total_raw, snapshot_date')
    .eq('domain', 'alanranger.com')
    .order('snapshot_date', { ascending: false })
    .limit(2);
  return { cur: ds?.[0] || null, prev: ds?.[1] || null };
}

function domainStrengthFields(ds) {
  return {
    domain_strength: num(ds.cur?.score),
    domain_strength_wow: deltaArrow(num(ds.cur?.score), num(ds.prev?.score)),
    ranking_keywords: num(ds.cur?.organic_keywords_total_raw),
    ranking_keywords_wow: deltaArrow(
      num(ds.cur?.organic_keywords_total_raw),
      num(ds.prev?.organic_keywords_total_raw)
    )
  };
}

function openFailLabel(rows, failRules) {
  const indexFails = countGscIndexFails(rows);
  if (indexFails > 0) return `${indexFails} page${indexFails === 1 ? '' : 's'} not indexed in Google`;
  if (failRules[0]) return failRules[0].rule_name || failRules[0].rule_key;
  return 'none';
}

/** F · SEO health — live Trad SEO hygiene score from evaluation cache + rules. */
async function loadSeoRulesAndCache(supabase) {
  const { data: rules, error: rErr } = await supabase
    .from('traditional_seo_rules')
    .select('rule_key, rule_name, enabled, weight, current_status');
  if (rErr) throw new Error(rErr.message);

  const { data: cache, error: cErr } = await supabase
    .from('traditional_seo_evaluation_cache')
    .select('evaluation_rows, last_evaluation_at')
    .limit(1)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  return { rules: rules || [], cache: cache || null };
}

export async function sectionSeoHealth(supabase, prior) {
  const { rules, cache } = await loadSeoRulesAndCache(supabase);
  const enabledRules = rules.filter((r) => r?.enabled !== false);
  const rows = enabledRuleRows(cache?.evaluation_rows, rules);
  const hygiene = scoreEnabledRules(enabledRules, rows);
  const score = hygiene.score;
  const priorSeo = prior?.metrics?.seo_health;
  const priorCeo = priorSeo?.score;
  const { scoreWowBase, score_wow } = await seoScoreWow(supabase, score, priorCeo);
  const evaluatedUrls = new Set(rows.map((r) => String(r.url || '').toLowerCase()).filter(Boolean)).size;
  const comparable = priorCeo == null
    ? { ok: true }
    : seoHealthComparable({ score, evaluated_urls: evaluatedUrls }, priorSeo);

  return {
    score,
    score_wow: comparable.ok ? score_wow : withheldWow(comparable.reason),
    comparable,
    evaluated_urls: evaluatedUrls,
    fail_rules: hygiene.failRules.map((f) => f.rule_name || f.rule_key),
    score_wow_base: scoreWowBase,
    ...domainStrengthFields(await domainStrengthPair(supabase)),
    hygiene: {
      enabled: enabledRules.length,
      pass: hygiene.pass,
      warn: hygiene.warn,
      fail: hygiene.fail
    },
    open_fail: openFailLabel(rows, hygiene.failRules),
    last_evaluation_at: cache?.last_evaluation_at || null,
    source: 'traditional_seo_evaluation_cache + traditional_seo_rules + domain_strength_snapshots',
    caveat: 'Deep extractability rules refresh on the server run once mirrored — headline score is live.'
  };
}
