/**
 * Local verify for Strategy tab v5 BUILD GO.
 * node scripts/verify-strategy-v5-build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { buildStrategySummary } from '../lib/strategy-summary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) {
        process.env[m[1]] = val;
      }
    }
  } catch { /* optional */ }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const before = await sb.from('strategy_quarter_actions')
  .select('id, is_ticked, label')
  .eq('property_url', 'https://www.alanranger.com')
  .order('id');
const tickSnap = (before.data || []).map((r) => ({ id: r.id, is_ticked: r.is_ticked }));

const d = await buildStrategySummary(sb);
const batsDates = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-29'];
const bats = (d.diary || []).filter((e) => /batsford/i.test(e.title) && batsDates.includes(e.date));

const after = await sb.from('strategy_quarter_actions')
  .select('id, is_ticked')
  .eq('property_url', 'https://www.alanranger.com')
  .order('id');
const tickAfter = (after.data || []).map((r) => ({ id: r.id, is_ticked: r.is_ticked }));
const ticksChanged = JSON.stringify(tickSnap) !== JSON.stringify(tickAfter);

const out = {
  layout: d.layout,
  bats: bats.map((e) => ({
    date: e.date,
    note: e.note,
    booked: e.booked,
    am_sold: e.am_sold,
    pm_sold: e.pm_sold,
    fill_pct: e.fill_pct,
    mismatch: e.mismatch,
    flag_message: e.flag_message,
    rag: e.rag,
    cap: e.cap,
    left: e.left
  })),
  residential_avg: d.workshop_signals?.residential_avg,
  residential_avg_window: d.workshop_signals?.residential_avg_window,
  f2_l12: d.kpi_scorecard?.find((k) => k.key === 'F2')?.l12,
  kpi10: d.kpis?.find((k) => k.id === 10),
  kpi9: d.kpis?.find((k) => k.id === 9),
  beginners_sources: d.beginners_sources,
  beginners_sources_prior: d.beginners_sources_prior,
  conversion_dates: (d.beginners_conversion?.rows || []).map((r) => r.dates),
  mismatch_total: (d.diary || []).filter((e) => e.mismatch).length,
  ticksChanged,
  tickSnap,
  diary_notes_sample: (d.diary || []).slice(0, 5).map((e) => ({ date: e.date, note: e.note, capacity_source: e.capacity_source }))
};

const outDir = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'VERIFY-strategy-v5-build.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
