/**
 * Site-wide checks, evaluated in full once per run (no rendering):
 * B3 Google index status, C3 console errors (grouped), D1–D6 tools + data sync.
 */
import { THRESHOLDS } from './monitor-config.js';
import { faultKey } from './store.js';
import { slugHash } from './plan.js';
import { truncate } from './text.js';
import { checkSupabaseSync, urlsFromCsv } from './sync-check.js';

const RAW_01 = 'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/01-blog-posts.csv';

export function slugOfNotPublished(value) {
  const t = String(value || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  const parts = t.split('/');
  return parts[parts.length - 1] || t;
}

export function filterNotPublishedToCsv01(notPub, blogUrlKeys) {
  const slugs = new Set((blogUrlKeys || []).map(slugOfNotPublished).filter(Boolean));
  if (!slugs.size) return notPub;
  return (notPub || []).filter((s) => slugs.has(slugOfNotPublished(s)));
}

async function blogUrlKeysFromCsv01() {
  const res = await fetch(`${RAW_01}?_ts=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`01-blog-posts.csv HTTP ${res.status}`);
  return urlsFromCsv(await res.text(), 'Full Url');
}

const SCHEMA_TOOLS_URL = 'https://schema-tools-six.vercel.app/';

function fault(check, subject, severity, title, detail = {}, extra = {}) {
  return { check, key: faultKey(check, subject), url: extra.url || null, pageType: extra.pageType || 'tool', status: 'fault', severity, title, detail };
}

// ---------- B3 ----------

export async function googleIndexChecks(sb, items) {
  const urls = items.filter((i) => i.t === 'money' || i.t === 'landing').map((i) => i.u);
  const out = [];
  for (let i = 0; i < urls.length; i += 100) {
    const { data, error } = await sb.from('gsc_url_inspection_cache')
      .select('page_url, coverage_state, verdict, indexed, inspected_at')
      .in('page_url', urls.slice(i, i + 100));
    if (error) throw new Error(`gsc_cache_read:${error.message}`);
    for (const r of data || []) {
      if (r.indexed !== false && r.verdict === 'PASS') continue;
      out.push(fault('B3', r.page_url, 'amber', `Google: ${r.coverage_state || r.verdict || 'not indexed'}`, {
        expected: 'Submitted and indexed', found: `${r.coverage_state || '—'} (inspected ${String(r.inspected_at || '').slice(0, 10)})`
      }, { url: r.page_url, pageType: 'money' }));
    }
  }
  return out;
}

// ---------- C3 ----------

export function consoleErrorFindings(siteErrors) {
  return Object.entries(siteErrors || {}).map(([msg, urls]) => fault('C3', `err-${slugHash(msg).toString(36)}`, 'amber',
    `Site-code JS error on ${urls.length} page${urls.length === 1 ? '' : 's'}: ${truncate(msg, 90)}`,
    { expected: 'no uncaught errors from site code', found: msg, pages: urls.slice(0, 25), page_count: urls.length },
    { pageType: 'site' }));
}

// ---------- D1 ----------

function isLegacyJwt(value) {
  return /^eyJ/.test(String(value || '').trim());
}

export async function deadKeyCheck() {
  const localJwt = isLegacyJwt(process.env.SUPABASE_SERVICE_ROLE_KEY)
    || isLegacyJwt(process.env.SUPABASE_ANON_KEY)
    || isLegacyJwt(process.env.SERVICE_ROLE);
  if (localJwt) {
    return [fault('D1', 'local-legacy-supabase-key', 'red',
      'A local or server setting still uses the old disabled Supabase key',
      { expected: 'sb_secret / sb_publishable from .env.vercel.prod', found: 'legacy JWT (disabled 2026-09-21)' })];
  }
  let html = '';
  try {
    html = await (await fetch(SCHEMA_TOOLS_URL, { signal: AbortSignal.timeout(20000) })).text();
  } catch (e) {
    return [fault('D1', 'schema-tools-supabase-key', 'amber', 'Could not load Schema Tools to probe its key', { found: String(e?.message || e) })];
  }
  const key = /SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/.exec(html)?.[1];
  const base = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(html)?.[1];
  if (!key || !base) return [fault('D1', 'schema-tools-supabase-key', 'red', 'Schema Tools has no Supabase key in its page', { expected: 'SUPABASE_PUBLISHABLE_KEY + SUPABASE_URL', found: 'missing' })];
  const res = await fetch(`${base}/rest/v1/page_entities?select=url&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000)
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.message || e) }));
  if (res.ok) return [{ check: 'D1', key: faultKey('D1', 'schema-tools-supabase-key'), status: 'pass' }];
  const body = truncate(await res.text(), 160);
  return [fault('D1', 'schema-tools-supabase-key', 'red', `Schema Tools Supabase key rejected (${res.status})`, { expected: '200 on a 1-row select', found: body })];
}

// ---------- D2 / D3 / D6 from tool_run_reports ----------

async function latestReport(sb, tool) {
  const { data, error } = await sb.from('tool_run_reports').select('*').eq('tool', tool).order('run_at', { ascending: false }).limit(1);
  if (error) throw new Error(`tool_reports_read:${error.message}`);
  return data?.[0] || null;
}

function passFor(check, subject) {
  return { check, key: faultKey(check, subject), status: 'pass' };
}

export async function schemaToolsRunCheck(sb) {
  const r = await latestReport(sb, 'schema-tools');
  if (!r) return [];
  let notPub = Array.isArray(r.not_published) ? r.not_published : [];
  try {
    notPub = filterNotPublishedToCsv01(notPub, await blogUrlKeysFromCsv01());
  } catch (e) {
    /* keep last-run list if CSV 01 cannot be read */
  }
  const when = String(r.run_at).slice(0, 16).replace('T', ' ');
  // Item-level generator counts (r.errors) are not a live tool outage; only
  // Supabase failures and unpublished files stay as D2 after a run is superseded.
  if (!r.supabase_errors && !notPub.length) return [passFor('D2', 'schema-tools-last-run')];
  const parts = [];
  if (r.supabase_errors) parts.push(`${r.supabase_errors} Supabase query errors`);
  if (notPub.length) parts.push(`${notPub.length} NOT published`);
  const red = r.supabase_errors > 0 || notPub.length > 0;
  return [fault('D2', 'schema-tools-last-run', red ? 'red' : 'amber', `Last Schema Tools run (${r.flow || 'run'}, ${when}): ${parts.join(', ')}`, {
    expected: '0 Supabase errors, 0 NOT published', found: parts.join(', '), not_published: notPub.slice(0, 50), version: r.version
  })];
}

export async function syncFreshnessCheck(sb) {
  const r = await latestReport(sb, 'shared-resources-sync');
  const subject = 'shared-resources-sync';
  if (!r) return [fault('D3', subject, 'amber', 'No heartbeat from the shared-resources sync yet', { expected: 'heartbeat every 10 min', found: 'none' })];
  const ageH = (Date.now() - Date.parse(r.run_at)) / 3600000;
  if (r.state === 'failed') {
    return [fault('D3', subject, 'amber', `Shared-resources sync failed: ${truncate(r.summary?.detail, 90)}`, { expected: 'state ok/noop', found: r.summary?.detail || 'failed' })];
  }
  if (ageH > THRESHOLDS.syncHeartbeatMaxHours) {
    return [fault('D3', subject, 'amber', `Shared-resources sync silent for ${Math.round(ageH)} h`, { expected: `< ${THRESHOLDS.syncHeartbeatMaxHours} h`, found: `last ${r.run_at}` })];
  }
  return [passFor('D3', subject)];
}

export async function ingestRunCheck(sb) {
  const r = await latestReport(sb, 'chat-ingest');
  if (!r) return [];
  const failed = Array.isArray(r.failed) ? r.failed : [];
  if (!failed.length) return [passFor('D6', 'chat-ingest-last-run')];
  const names = failed.slice(0, 3).map((f) => String(f.url || '').replace(/^https?:\/\/www\.alanranger\.com/, '')).join(', ');
  return [fault('D6', 'chat-ingest-last-run', 'red', `Last ingest run: ${failed.length} record${failed.length === 1 ? '' : 's'} failed or skipped (${truncate(names, 80)}${failed.length > 3 ? ' …' : ''})`, {
    expected: 'every URL ingested with a page_entities row', found: `${failed.length} failed / skipped of ${r.items_processed}`, failed: failed.slice(0, 200)
  })];
}

// ---------- D4 ----------

export async function staleExportCheck(sb) {
  const { data, error } = await sb.from('config_integrity_runs').select('run_at, findings').order('run_at', { ascending: false }).limit(1);
  if (error) throw new Error(`config_integrity_read:${error.message}`);
  const findings = (data?.[0]?.findings || []).filter((f) => Number(f.check) === 6);
  return findings.map((f) => fault('D4', `ci6-${f.subject || 'export'}`, 'amber', truncate(f.meaning || f.detail || 'Export differs from DB', 120), {
    expected: 'repo export hash = DB hash', found: f.detail || '', subject: f.subject
  }));
}

/** All site-wide results for one run. */
export async function runSiteChecks(sb, run) {
  const results = [
    ...(await googleIndexChecks(sb, run.plan || [])),
    ...consoleErrorFindings(run.site_errors),
    ...(await deadKeyCheck()),
    ...(await schemaToolsRunCheck(sb)),
    ...(await syncFreshnessCheck(sb)),
    ...(await staleExportCheck(sb)),
    ...(await ingestRunCheck(sb)),
    ...(await checkSupabaseSync(sb))
  ];
  return results;
}

export const SITE_CHECK_IDS = ['B3', 'C3', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
