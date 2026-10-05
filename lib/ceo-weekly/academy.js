/**
 * Academy metrics for Monday CEO weekly email.
 * Reads Academy Supabase (separate project) — not AI GEO DB.
 *
 * Env (Vercel):
 *   ACADEMY_SUPABASE_URL
 *   ACADEMY_SUPABASE_SERVICE_ROLE_KEY
 *   ACADEMY_BASE_URL (optional, default https://alanranger-modules.vercel.app)
 *   ACADEMY_CRON_SECRET (optional — Memberstack cache refresh before metrics)
 */
import { createClient } from '@supabase/supabase-js';
import { deltaArrow } from './shared.js';

const DAY_MS = 86400000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const DEFAULT_ACADEMY_BASE = 'https://alanranger-modules.vercel.app';

function academyClient() {
  const url = String(process.env.ACADEMY_SUPABASE_URL || '').trim();
  const key = String(process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key || key.startsWith('<')) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function londonDayStart(daysAgo = 0) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const noon = Date.parse(`${ymd}T12:00:00Z`) - daysAgo * DAY_MS;
  return new Date(noon).toISOString().slice(0, 10);
}

function isoDay(ymd) {
  return `${ymd}T00:00:00.000Z`;
}

function planType(row) {
  return String(row?.plan_summary?.plan_type || '').toLowerCase();
}

function planStatus(row) {
  return String(row?.plan_summary?.status || '').toUpperCase();
}

function isActivePlan(row, type) {
  return planType(row) === type && (planStatus(row) === 'ACTIVE' || planStatus(row) === 'TRIALING');
}

async function fetchAll(supabase, table, select, filterFn) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function avgSessionMinutes(events) {
  const byMember = new Map();
  for (const e of events) {
    const id = e.member_id;
    if (!id) continue;
    if (!byMember.has(id)) byMember.set(id, []);
    byMember.get(id).push(e);
  }
  const lengths = [];
  for (const list of byMember.values()) {
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let sessionStart = null;
    let lastTs = null;
    for (const e of list) {
      const ts = Date.parse(e.created_at);
      if (!Number.isFinite(ts)) continue;
      if (e.event_type === 'login') {
        if (sessionStart != null && lastTs != null && ts - lastTs <= SESSION_GAP_MS) {
          lastTs = ts;
          continue;
        }
        if (sessionStart != null && lastTs != null) {
          lengths.push(Math.min(120, Math.max(1, (lastTs - sessionStart) / 60000)));
        }
        sessionStart = ts;
        lastTs = ts;
        continue;
      }
      if (sessionStart == null) continue;
      if (e.event_type === 'logout') {
        lengths.push(Math.min(120, Math.max(1, (ts - sessionStart) / 60000)));
        sessionStart = null;
        lastTs = null;
        continue;
      }
      if (lastTs != null && ts - lastTs > SESSION_GAP_MS) {
        lengths.push(Math.min(120, Math.max(1, (lastTs - sessionStart) / 60000)));
        sessionStart = null;
        lastTs = null;
        continue;
      }
      lastTs = ts;
    }
    if (sessionStart != null && lastTs != null && lastTs > sessionStart) {
      lengths.push(Math.min(120, Math.max(1, (lastTs - sessionStart) / 60000)));
    }
  }
  if (!lengths.length) return null;
  return Math.round((lengths.reduce((a, b) => a + b, 0) / lengths.length) * 10) / 10;
}

function windowStats(events, exams) {
  const active = new Set();
  const modulePaths = new Set();
  let moduleOpens = 0;
  let logins = 0;
  for (const e of events) {
    if (e.member_id) active.add(e.member_id);
    if (e.event_type === 'login') logins += 1;
    if (e.event_type === 'module_open') {
      moduleOpens += 1;
      if (e.path) modulePaths.add(e.path);
    }
  }
  const examMembers = new Set();
  let examAttempts = 0;
  for (const r of exams || []) {
    examAttempts += 1;
    if (r.memberstack_id) examMembers.add(r.memberstack_id);
  }
  return {
    active_users: active.size,
    logins,
    module_opens: moduleOpens,
    unique_modules: modulePaths.size,
    exam_attempts: examAttempts,
    unique_exam_users: examMembers.size,
    avg_session_minutes: avgSessionMinutes(events)
  };
}

/**
 * Trigger Academy Memberstack→Supabase refresh (best-effort).
 */
export async function refreshAcademyMemberCache() {
  const base = String(process.env.ACADEMY_BASE_URL || DEFAULT_ACADEMY_BASE).replace(/\/$/, '');
  const secret = String(process.env.ACADEMY_CRON_SECRET || process.env.CRON_SECRET || '').trim();
  const headers = {};
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
    headers['x-cron-secret'] = secret;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/admin/refresh`, { method: 'GET', headers });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text?.slice(0, 200) }; }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      body,
      error: res.ok ? null : (body?.error || `http_${res.status}`)
    };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - t0, body: null, error: err?.message || String(err) };
  }
}

/**
 * Build Academy weekly block for CEO email.
 */
export async function buildAcademyWeeklyMetrics() {
  const sb = academyClient();
  if (!sb) {
    return {
      available: false,
      error: 'missing_env:ACADEMY_SUPABASE_URL|ACADEMY_SUPABASE_SERVICE_ROLE_KEY'
    };
  }

  const d0 = londonDayStart(0);
  const d7 = londonDayStart(7);
  const d14 = londonDayStart(14);

  const members = await fetchAll(sb, 'ms_members_cache', 'member_id, plan_summary');
  const current_trials = members.filter((m) => isActivePlan(m, 'trial')).length;
  const current_annual = members.filter((m) => isActivePlan(m, 'annual')).length;

  const trials = await fetchAll(
    sb,
    'academy_trial_history',
    'member_id, trial_start_at, trial_end_at, converted_at',
    (q) => q.or(
      `trial_start_at.gte.${isoDay(d14)},converted_at.gte.${isoDay(d14)},trial_end_at.gte.${isoDay(d14)}`
    )
  );

  const inRange = (iso, startYmd, endYmdExclusive) => {
    if (!iso) return false;
    const d = String(iso).slice(0, 10);
    return d >= startYmd && d < endYmdExclusive;
  };

  const trials_started_7d = trials.filter((t) => inRange(t.trial_start_at, d7, d0)).length;
  const trials_started_prev_7d = trials.filter((t) => inRange(t.trial_start_at, d14, d7)).length;
  const converted_7d = trials.filter((t) => inRange(t.converted_at, d7, d0)).length;
  const converted_prev_7d = trials.filter((t) => inRange(t.converted_at, d14, d7)).length;
  const lost_7d = trials.filter((t) => !t.converted_at && inRange(t.trial_end_at, d7, d0)).length;
  const lost_prev_7d = trials.filter((t) => !t.converted_at && inRange(t.trial_end_at, d14, d7)).length;

  const events = await fetchAll(
    sb,
    'academy_events',
    'member_id, event_type, path, created_at',
    (q) => q
      .in('event_type', ['login', 'logout', 'module_open', 'page_view'])
      .gte('created_at', isoDay(d14))
  );
  const events7 = events.filter((e) => String(e.created_at).slice(0, 10) >= d7);
  const eventsPrev = events.filter((e) => {
    const d = String(e.created_at).slice(0, 10);
    return d >= d14 && d < d7;
  });

  const exams = await fetchAll(
    sb,
    'module_results_ms',
    'memberstack_id, module_id, created_at',
    (q) => q.gte('created_at', isoDay(d14))
  );
  const exams7 = exams.filter((e) => String(e.created_at).slice(0, 10) >= d7);
  const examsPrev = exams.filter((e) => {
    const d = String(e.created_at).slice(0, 10);
    return d >= d14 && d < d7;
  });

  const cur = windowStats(events7, exams7);
  const prev = windowStats(eventsPrev, examsPrev);

  return {
    available: true,
    as_of: new Date().toISOString(),
    window: { current_start: d7, current_end: d0, prior_start: d14, prior_end: d7 },
    current_trials,
    current_annual,
    trials_started_7d,
    trials_started_wow: deltaArrow(trials_started_7d, trials_started_prev_7d),
    converted_7d,
    converted_wow: deltaArrow(converted_7d, converted_prev_7d),
    lost_7d,
    lost_wow: deltaArrow(lost_7d, lost_prev_7d),
    active_users_7d: cur.active_users,
    active_users_wow: deltaArrow(cur.active_users, prev.active_users),
    avg_session_minutes_7d: cur.avg_session_minutes,
    avg_session_minutes_wow: deltaArrow(cur.avg_session_minutes, prev.avg_session_minutes),
    unique_modules_7d: cur.unique_modules,
    unique_modules_wow: deltaArrow(cur.unique_modules, prev.unique_modules),
    module_opens_7d: cur.module_opens,
    module_opens_wow: deltaArrow(cur.module_opens, prev.module_opens),
    exam_attempts_7d: cur.exam_attempts,
    exam_attempts_wow: deltaArrow(cur.exam_attempts, prev.exam_attempts),
    unique_exam_users_7d: cur.unique_exam_users,
    source: 'academy supabase (ms_members_cache, academy_trial_history, academy_events, module_results_ms)'
  };
}
