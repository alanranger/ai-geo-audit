import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"'))
      || (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnv('.env.local');
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.log(JSON.stringify({
    ok: false,
    hasUrl: !!url,
    hasKey: !!key,
    envKeys: Object.keys(env).filter((k) => /SUPA|URL/i.test(k))
  }));
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: sample, error: e1 } = await sb.from('keyword_rankings').select('*').limit(1);
console.log(JSON.stringify({
  sample_err: e1?.message || null,
  sample_keys: sample?.[0] ? Object.keys(sample[0]).sort() : null,
  sample_preview: sample?.[0]
    ? {
      keyword: sample[0].keyword,
      audit_date: sample[0].audit_date,
      last_refreshed_at: sample[0].last_refreshed_at,
      location_name: sample[0].location_name,
      location_code: sample[0].location_code,
      location_coordinate: sample[0].location_coordinate ?? null,
      device: sample[0].device,
      best_rank_group: sample[0].best_rank_group ?? sample[0].rank_group ?? null,
      best_rank_absolute: sample[0].best_rank_absolute ?? sample[0].rank_absolute ?? null,
      property_url: sample[0].property_url
    }
    : null
}, null, 2));

const { count } = await sb.from('keyword_rankings').select('*', { count: 'exact', head: true });
console.log(JSON.stringify({ total_rows: count }));

const { data: recent, error: e2 } = await sb
  .from('keyword_rankings')
  .select('audit_date,last_refreshed_at,location_name,location_code,device,keyword')
  .order('last_refreshed_at', { ascending: false })
  .limit(8);
console.log(JSON.stringify({ recent_err: e2?.message || null, recent }, null, 2));
