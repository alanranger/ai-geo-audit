#!/usr/bin/env node
/**
 * Replays the CEO brief sense-check on real 2 Nov 2026 data (read-only; never opens a hold).
 *  broken    = this morning's backups: keyword_rankings_redirect_bak_20261102, audit_results_redirect_bak_20261102,
 *              and the 55 stale findings (fault_monitor_findings_stale_bak_20261102) as the brief showed them
 *  corrected = live keyword_rankings / audit_results and the findings the brief shows now
 * Exit 0 when broken holds and corrected passes.
 *   node scripts/replay-ceo-brief-gate.mjs
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { assessBriefGate, loadBriefGateInputs } from '../lib/ceo-weekly/brief-gate.js';
import { loadCurrentFindings } from '../lib/fault-monitor/store.js';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const sb = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));
const PROPERTY = 'https://www.alanranger.com';
const WEEK = '2026-11-02';

async function steps() {
  const { data } = await sb.from('system_maintenance_state').select('last_details').eq('key', 'ceo_monday_full_refresh').maybeSingle();
  return data?.last_details?.week_start === WEEK ? data.last_details.steps : [];
}

async function brokenInputs(base) {
  const { data: audit } = await sb.from('audit_results_redirect_bak_20261102').select('surface_visibility_score, top_of_page_score, ranking_quality').limit(1);
  const { data: findings } = await sb.from('fault_monitor_findings_stale_bak_20261102').select('check_id, severity, last_checked');
  return loadBriefGateInputs(sb, { ...base, shownFindings: findings || [],
    tables: { rankings: 'keyword_rankings_redirect_bak_20261102', auditOverride: audit?.[0] || {} } });
}

async function correctedInputs(base) {
  const { current } = await loadCurrentFindings(sb);
  return loadBriefGateInputs(sb, { ...base, shownFindings: current.filter((f) => f.severity === 'red' || f.severity === 'amber') });
}

const show = (label, inp, g) => {
  console.log(`\n${label}: ${g.held ? 'HELD' : 'PASS'}  (surface ${inp.previous?.surface_visibility_score}→${inp.current?.surface_visibility_score}, top-of-page ${inp.previous?.top_of_page_score}→${inp.current?.top_of_page_score}, top-10 ${inp.previous?.top10}→${inp.current?.top10})`);
  for (const c of g.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`);
};

const { run } = await loadCurrentFindings(sb);
const base = { propertyUrl: PROPERTY, weekStart: WEEK, steps: await steps(), latestFullRunStart: run?.started_at || null };
const b = await brokenInputs(base);
const c = await correctedInputs(base);
const gb = assessBriefGate(b);
const gc = assessBriefGate(c);
show('Broken 2 Nov (morning)', b, gb);
show('Corrected 2 Nov', c, gc);
const ok = gb.held && !gc.held;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: broken ${gb.held ? 'held' : 'NOT held'}, corrected ${gc.held ? 'HELD' : 'passes'}`);
process.exitCode = ok ? 0 : 1;
