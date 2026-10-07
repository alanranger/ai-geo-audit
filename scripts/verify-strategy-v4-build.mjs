import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { buildStrategySummary } from '../lib/strategy-summary.mjs';
import { runStrategyEventSnapshots } from '../lib/strategy-snapshots.mjs';

for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(name, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const snap = await runStrategyEventSnapshots(sb);
console.log('SNAP', snap);
const s = await buildStrategySummary(sb);
const want = ['2026-10-10', '2026-10-17', '2026-10-23', '2026-11-20', '2026-11-13', '2026-12-29'];
const paste = (s.diary || []).filter((e) => want.includes(e.date)).map((e) => ({
  date: e.date,
  title: e.title.slice(0, 40),
  price: e.price,
  cap: e.cap,
  booked: e.booked,
  left: e.left,
  rag: e.rag,
  status: e.status,
  mismatch: e.mismatch
}));
console.log(JSON.stringify({
  layout: s.layout,
  diary: s.diary?.length,
  push: s.push?.length,
  action_needed: s.action_needed?.length,
  paste,
  kpis: (s.kpi_scorecard || []).map((k) => ({
    key: k.key, l12: k.l12, prior: k.prior, change: k.change, status: k.status
  }))
}, null, 2));
