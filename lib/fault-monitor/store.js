/**
 * Supabase persistence for the monitor. A finding opens the first time it
 * fails and resolves itself the first time it passes — nobody clears it by hand.
 */
import { AREAS, CHECKS } from './monitor-config.js';
import { urlKey } from './prefetch.js';

const FINDINGS = 'fault_monitor_findings';
const RUNS = 'fault_monitor_runs';
const BASELINE = 'fault_monitor_page_baseline';
const KEY_CHUNK = 150;

export function faultKey(check, subject) {
  const s = /^https?:\/\//i.test(String(subject || '')) ? urlKey(subject) : String(subject || '');
  return `${check}|${s}`;
}

function chunks(arr, n = KEY_CHUNK) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function openKeys(sb, keys) {
  const open = new Set();
  for (const part of chunks(keys)) {
    const { data, error } = await sb.from(FINDINGS).select('fault_key').in('fault_key', part).eq('status', 'open');
    if (error) throw new Error(`findings_read:${error.message}`);
    (data || []).forEach((r) => open.add(r.fault_key));
  }
  return open;
}

function findingRow(r, ctx, alreadyOpen, now) {
  const key = r.key || faultKey(r.check, r.url);
  const row = {
    fault_key: key,
    check_id: r.check,
    area: AREAS[r.check[0]] || 'Tools',
    url: r.url || null,
    page_type: r.pageType || ctx.pageType || null,
    severity: r.severity,
    title: r.title,
    detail: r.detail || {},
    fix_hint: CHECKS[r.check]?.fix || null,
    status: 'open',
    last_seen: now,
    last_checked: now,
    resolved_at: null,
    run_id: ctx.runId || null
  };
  if (!alreadyOpen.has(key)) row.first_seen = now;
  return row;
}

/** Upsert faults (keeping first_seen of already-open ones) and resolve passes. */
export async function applyResults(sb, results, ctx = {}) {
  const now = new Date().toISOString();
  const faults = results.filter((r) => r.status === 'fault');
  const passKeys = results.filter((r) => r.status === 'pass').map((r) => r.key || faultKey(r.check, r.url));
  if (faults.length) {
    const keys = faults.map((r) => r.key || faultKey(r.check, r.url));
    const already = await openKeys(sb, keys);
    const withFirst = faults.filter((r) => !already.has(r.key || faultKey(r.check, r.url)));
    const keepFirst = faults.filter((r) => already.has(r.key || faultKey(r.check, r.url)));
    for (const group of [withFirst, keepFirst]) {
      if (!group.length) continue;
      const rows = group.map((r) => findingRow(r, ctx, already, now));
      const { error } = await sb.from(FINDINGS).upsert(rows, { onConflict: 'fault_key' });
      if (error) throw new Error(`findings_upsert:${error.message}`);
    }
  }
  await resolveKeys(sb, passKeys, now);
  return { faults: faults.length, passes: passKeys.length };
}

export async function resolveKeys(sb, keys, now = new Date().toISOString()) {
  for (const part of chunks(keys)) {
    const { error } = await sb.from(FINDINGS)
      .update({ status: 'resolved', resolved_at: now, last_checked: now })
      .in('fault_key', part)
      .eq('status', 'open');
    if (error) throw new Error(`findings_resolve:${error.message}`);
  }
}

/** Site-wide checks are evaluated in full each run: anything open for them and not re-found closes. */
export async function resolveAbsent(sb, checkIds, keepKeys) {
  const { data, error } = await sb.from(FINDINGS).select('fault_key').in('check_id', checkIds).eq('status', 'open');
  if (error) throw new Error(`findings_read:${error.message}`);
  const keep = new Set(keepKeys);
  const gone = (data || []).map((r) => r.fault_key).filter((k) => !keep.has(k));
  await resolveKeys(sb, gone);
  return gone.length;
}

export async function loadOpenFindings(sb) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(FINDINGS).select('*').eq('status', 'open')
      .order('severity', { ascending: false }).range(from, from + 999);
    if (error) throw new Error(`findings_read:${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// ---------- runs ----------

export async function createRun(sb, row) {
  const { data, error } = await sb.from(RUNS).insert(row).select('*').single();
  if (error) throw new Error(`run_create:${error.message}`);
  return data;
}

export async function loadRun(sb, id) {
  const { data, error } = await sb.from(RUNS).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`run_read:${error.message}`);
  return data;
}

export async function latestRun(sb) {
  const { data, error } = await sb.from(RUNS).select('*').order('started_at', { ascending: false }).limit(1);
  if (error) throw new Error(`run_read:${error.message}`);
  return data?.[0] || null;
}

export async function latestTradSeoRun(sb) {
  const { data, error } = await sb.from(RUNS)
    .select('*')
    .eq('source', 'trad_seo')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`run_read:${error.message}`);
  return data?.[0] || null;
}

export async function latestRunningTradSeoRun(sb) {
  const { data, error } = await sb.from(RUNS)
    .select('*')
    .eq('source', 'trad_seo')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`run_read:${error.message}`);
  return data?.[0] || null;
}

export async function latestAnyTradSeoRun(sb) {
  const { data, error } = await sb.from(RUNS)
    .select('*')
    .like('source', 'trad_seo%')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`run_read:${error.message}`);
  return data?.[0] || null;
}

export async function saveRun(sb, id, patch) {
  const { error } = await sb.from(RUNS).update({ ...patch, last_tick_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`run_save:${error.message}`);
}

// ---------- C1 baselines ----------

export async function loadBaselines(sb, urls) {
  const map = new Map();
  const keys = urls.map((u) => urlKey(u));
  for (const part of chunks(keys)) {
    const { data, error } = await sb.from(BASELINE).select('url_key, blocks').in('url_key', part);
    if (error) throw new Error(`baseline_read:${error.message}`);
    (data || []).forEach((r) => map.set(r.url_key, Array.isArray(r.blocks) ? r.blocks : []));
  }
  return map;
}

export async function saveBaseline(sb, url, blocks) {
  const { error } = await sb.from(BASELINE).upsert({
    url_key: urlKey(url), url, blocks, updated_at: new Date().toISOString()
  }, { onConflict: 'url_key' });
  if (error) throw new Error(`baseline_save:${error.message}`);
}
