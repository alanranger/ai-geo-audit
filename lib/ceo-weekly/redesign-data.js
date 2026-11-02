/**
 * Monday brief redesign (batch 8 task 15): attaches pipeline, Sales-tab table, headline tiles,
 * cards A/B/C and System health to the weekly metrics. Read-only (the gate here never opens a hold).
 */
import { buildPipeline } from './pipeline.js';
import { loadSalesTab } from './sales-tab.js';
import {
  buildTiles, buildCardA, buildCardB, buildCardC, buildTriggers, dayLabel,
  loadAcademyFront, loadWeekActivity, loadTriggerInputs
} from './front-page.js';
import { assessBriefGate, loadBriefGateInputs } from './brief-gate.js';
import { loadCurrentFindings } from '../fault-monitor/store.js';

const LONDON = 'Europe/London';

export function londonYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function londonHm(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: LONDON });
}

function safe(fn, fallback) {
  return fn().catch((e) => ({ ...fallback, error: e?.message || String(e) }));
}

async function gateAndFindings(supabase, { propertyUrl, weekStart, blocks }) {
  const { data: refresh } = await supabase.from('system_maintenance_state').select('state, updated_at, last_details')
    .eq('key', 'ceo_monday_full_refresh').maybeSingle();
  const steps = refresh?.last_details?.week_start === weekStart ? (refresh.last_details.steps || []) : [];
  const { current, run } = await loadCurrentFindings(supabase);
  const shown = current.filter((f) => f.severity === 'red' || f.severity === 'amber');
  const inputs = await loadBriefGateInputs(supabase, { propertyUrl, weekStart, steps, shownFindings: shown, latestFullRunStart: run?.started_at || null, blocks });
  // "Issues" / "faults" in the brief = red findings (amber are watch items; see fault-monitor/brief.js).
  return { gate: assessBriefGate(inputs), refresh, run, openFaults: current.filter((f) => f.severity === 'red').length };
}

const WITHHELD_NAMES = { backlinks_swing: 'backlinks', seo_health_swing: 'SEO health' };

function gateLine(gate) {
  if (!gate) return { state: 'warn', text: 'Figures not checked before sending' };
  if (gate.held) return { state: 'fail', text: `Figures held before sending — ${gate.failures.map((f) => f.id).join(', ')}` };
  const withheld = gate.checks.filter((c) => WITHHELD_NAMES[c.id] && /withheld/.test(c.detail)).map((c) => WITHHELD_NAMES[c.id]);
  if (withheld.length) {
    return { state: 'warn', text: `Figures checked before sending — rankings complete; week-on-week not shown for ${withheld.join(' and ')} (basis changed since last week, see section 4)` };
  }
  return { state: 'ok', text: 'Figures checked before sending — no implausible swings, rankings complete' };
}

function trustNote(gate, seoHealth) {
  const withheld = (gate?.checks || []).filter((c) => WITHHELD_NAMES[c.id] && /withheld/.test(c.detail)).map((c) => WITHHELD_NAMES[c.id]);
  const first = withheld.length ? `week-on-week not shown for ${withheld.join(' and ')} (basis changed)` : 'all data sources fresh';
  return `${first} · ${hygieneFailText(seoHealth)}`;
}

/** Same count and wording as the SEO health block (section 4). */
export function hygieneFailText(seoHealth) {
  const n = Number(seoHealth?.hygiene?.fail) || 0;
  return `${n} hygiene fail${n === 1 ? '' : 's'} (see section 4)`;
}

function uploadLine(uploadedIso, asOfYmd) {
  if (!uploadedIso) return { state: 'warn', text: 'Booking sheet upload time unknown' };
  const ymd = londonYmd(new Date(uploadedIso));
  const ageDays = (Date.parse(`${asOfYmd}T12:00:00Z`) - Date.parse(`${ymd}T12:00:00Z`)) / 86400000;
  return { state: ageDays <= 7 ? 'ok' : 'warn', text: `Booking sheet uploaded ${dayLabel(ymd)} ${londonHm(uploadedIso)}` };
}

function refreshLine(refresh, weekStart) {
  const d = refresh?.last_details || {};
  if (d.week_start !== weekStart) return { state: 'warn', text: 'Monday refresh has not run this week' };
  if (refresh.state === 'done') return { state: 'ok', text: `Monday refresh complete ${londonHm(refresh.updated_at)}` };
  return { state: refresh.state === 'failed' ? 'fail' : 'warn', text: `Monday refresh ${refresh.state}` };
}

function auditLine(run, seoHealth, asOfYmd) {
  if (!run) return { state: 'warn', text: 'Full audit ① has not run' };
  const ymd = londonYmd(new Date(run.started_at));
  const when = ymd === asOfYmd ? 'today' : dayLabel(ymd);
  const pages = Number(run.pages_checked) || null;
  const fresh = (Date.parse(`${asOfYmd}T12:00:00Z`) - Date.parse(`${ymd}T12:00:00Z`)) / 86400000 <= 7;
  const fails = Number(seoHealth?.hygiene?.fail) || 0;
  return {
    state: fresh && !fails ? 'ok' : 'warn',
    text: `Full audit ① ran ${when}${pages ? ` · broken links checked (${pages} pages)` : ''} · ${hygieneFailText(seoHealth)}`
  };
}

const FAILED = /^(fail|failed|error)$/i;

/** Status lines read the latest rows at render time (not "as at" the audit), so they are never stale. */
async function syncLine(supabase) {
  const [{ data: sync }, { data: runs }] = await Promise.all([
    supabase.from('system_maintenance_state').select('state, updated_at, last_details').eq('key', 'csv_auto_sync').maybeSingle(),
    supabase.from('update_all_runs').select('id, mode, status, finished_at, stage_results').not('finished_at', 'is', null)
      .order('finished_at', { ascending: false }).limit(1)
  ]);
  const syncOk = sync?.state === 'ok' && Date.now() - Date.parse(sync.updated_at) < 3 * 3600000;
  const syncText = sync ? (syncOk ? 'CSV auto-sync healthy' : `CSV auto-sync ${sync.state} (reported ${dayLabel(londonYmd(new Date(sync.updated_at)))} ${londonHm(sync.updated_at)})`) : 'CSV auto-sync not reported';
  const run = runs?.[0];
  if (!run) return { state: 'warn', text: `${syncText} · BAU Monthly has no finished run` };
  const failures = Object.values(run.stage_results || {}).filter((s) => FAILED.test(String(s?.status || ''))).length;
  const kind = run.mode === 'dry' ? 'test run' : 'run';
  return {
    state: syncOk && !failures ? 'ok' : 'warn',
    text: `${syncText} · BAU Monthly last ${kind} ${dayLabel(londonYmd(new Date(run.finished_at)))} ${londonHm(run.finished_at)}, ${failures} failure${failures === 1 ? '' : 's'}`
  };
}

async function systemHealth(supabase, ctx) {
  const { gate, refresh, run, metrics, asOfYmd, weekStart } = ctx;
  return [
    gateLine(gate),
    uploadLine(metrics.section_g?.booking_sheet_uploaded, asOfYmd),
    refreshLine(refresh, weekStart),
    auditLine(run, metrics.seo_health, asOfYmd),
    await syncLine(supabase).catch((e) => ({ state: 'warn', text: `CSV auto-sync / BAU status unavailable (${e.message})` }))
  ];
}

/** Adds metrics.pipeline / sales_tab / front / system_health / brief_gate. */
export async function attachRedesign(supabase, metrics, { propertyUrl, weekStart, asOf = null }) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const asOfYmd = londonYmd(asOfDate);
  const asOfIso = asOfDate.toISOString();
  const diary = metrics.strategy?.diary || [];
  const [pipeline, salesTab, academy] = await Promise.all([
    safe(() => buildPipeline(supabase, propertyUrl, { diary, today: asOfYmd }), {}),
    safe(() => loadSalesTab(supabase, propertyUrl, asOfYmd), { available: false }),
    loadAcademyFront(metrics, asOfYmd)
  ]);
  const { data: targetsRow } = await supabase.from('booking_sheet_sales_targets').select('category_targets')
    .eq('property_url', propertyUrl).eq('year', Number(asOfYmd.slice(0, 4))).maybeSingle();
  const [week, triggerInputs, checks] = await Promise.all([
    pipeline.windows ? loadWeekActivity(supabase, propertyUrl, weekStart, { pipeline, diary }) : null,
    loadTriggerInputs(supabase, propertyUrl, asOfYmd, targetsRow),
    gateAndFindings(supabase, { propertyUrl, weekStart, blocks: { backlinks: metrics.backlinks, seo_health: metrics.seo_health } })
  ]);
  metrics.pipeline = pipeline;
  metrics.sales_tab = salesTab;
  metrics.brief_gate = checks.gate;
  const triggers = buildTriggers({ asOfYmd, ...triggerInputs, academy });
  metrics.front = salesTab.available && pipeline.windows ? {
    tiles: buildTiles({ metrics, salesTab, pipeline, academy }),
    card_a: buildCardA({ salesTab, pipeline, academy, today: asOfYmd }),
    card_b: buildCardB({ metrics, ...week, gate: checks.gate, trustNote: trustNote(checks.gate, metrics.seo_health), weekStart }),
    card_c: buildCardC({ pipeline, triggers, seen: triggerInputs.seen, weekStart }),
    website_skipped: triggerInputs.website_skipped,
    academy_28d: { count: academy.trials_28d, from: academy.from28, to: asOfYmd, source: academy.source }
  } : { error: salesTab.reason || pipeline.error || 'front page inputs missing' };
  metrics.system_health = await systemHealth(supabase, { ...checks, metrics, asOfYmd, asOfIso, weekStart });
  return metrics;
}
