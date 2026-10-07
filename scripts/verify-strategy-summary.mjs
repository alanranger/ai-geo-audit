import { readFileSync } from 'fs';
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
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) {
        process.env[m[1]] = val;
      }
    }
  } catch { /* optional */ }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE,
  { auth: { persistSession: false } }
);
const s = await buildStrategySummary(sb);
console.log(JSON.stringify({
  kpis: s.kpis.map((k) => ({ id: k.id, actual: k.actual, status: k.status, reason: k.reason || null })),
  upcoming: (s.upcoming_events || []).length,
  actions: (s.actions || []).length,
  overdue: (s.overdue_actions || []).length,
  action_needed: (s.action_needed || []).length,
  gp_t3: s.gp_t3,
  headline: s.headline,
  plans_empty: s.plan_clients?.empty_reason || null
}, null, 2));
