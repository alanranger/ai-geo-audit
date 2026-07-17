/**
 * Stamp last_refreshed_at + publish audit_results.ranking_ai_data for a clean baseline day
 * so Ranking / AI Health / Competitor tabs pick the same audit.
 *
 * Usage: node scripts/publish-clean-baseline-ranking-blob.mjs --date=YYYY-MM-DD
 */
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { buildSummary } from '../lib/keyword-ranking/refresh-core.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);
const nowIso = new Date().toISOString();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase credentials');
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: rows, error } = await sb
    .from('keyword_rankings')
    .select('*')
    .eq('property_url', PROPERTY)
    .eq('audit_date', auditDate);
  if (error) throw error;
  if (!rows?.length) throw new Error(`No keyword_rankings for ${auditDate}`);

  const { error: stampErr } = await sb
    .from('keyword_rankings')
    .update({ last_refreshed_at: nowIso })
    .eq('property_url', PROPERTY)
    .eq('audit_date', auditDate);
  if (stampErr) throw stampErr;

  const summary = buildSummary(rows);
  const ranking_ai_data = {
    source: 'keyword_rankings_table',
    summary: { ...summary, audit_date: auditDate },
    combinedRows: rows,
    timestamp: nowIso,
    lastRunTimestamp: nowIso,
  };

  const { error: upErr } = await sb.from('audit_results').upsert(
    {
      property_url: PROPERTY,
      audit_date: auditDate,
      ranking_ai_data,
      updated_at: nowIso,
    },
    { onConflict: 'property_url,audit_date' }
  );
  if (upErr) throw upErr;

  console.log(JSON.stringify({
    audit_date: auditDate,
    rows: rows.length,
    last_refreshed_at: nowIso,
    cited: rows.filter((r) => (r.ai_alan_citations_count || 0) > 0).length,
    aio_served: rows.filter((r) => r.has_ai_overview || r.ai_overview_present_any).length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
