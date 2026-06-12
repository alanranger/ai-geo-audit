/**
 * Recompute authority component scores from stored query_pages using current ranking rules.
 * Updates authority_score + authority_by_segment for a date range.
 *
 * Dry run:
 *   node scripts/backfill-authority-ranking-period.mjs --from=2026-05-25 --to=2026-06-11
 *
 * Apply:
 *   node scripts/backfill-authority-ranking-period.mjs --from=2026-05-25 --to=2026-06-11 --apply
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { calculatePillarScores } from '../lib/audit/pillarScores.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const fromDate = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1];
const toDate = process.argv.find((a) => a.startsWith('--to='))?.split('=')[1];
const propertyFilter = process.argv.find((a) => a.startsWith('--property='))?.split('=')[1] || 'alanranger';

if (!fromDate || !toDate) {
  console.error('Usage: --from=YYYY-MM-DD --to=YYYY-MM-DD [--apply] [--property=alanranger]');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function defaultBacklinkMetrics(score) {
  if (typeof score === 'number' && Number.isFinite(score) && score > 0) {
    return { referringDomains: score, totalBacklinks: score * 10, followRatio: 0.85 };
  }
  return { referringDomains: 87, totalBacklinks: 870, followRatio: 0.85 };
}

async function main() {
  let query = supabase
    .from('audit_results')
    .select(
      'id, property_url, audit_date, authority_score, authority_behaviour_score, authority_ranking_score, authority_backlink_score, authority_review_score, backlink_metrics, is_partial'
    )
    .gte('audit_date', fromDate)
    .lte('audit_date', toDate)
    .order('audit_date', { ascending: true });

  if (propertyFilter) query = query.ilike('property_url', `%${propertyFilter}%`);

  const { data, error } = await query;
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  const updates = [];
  for (const row of data || []) {
    const { data: detail, error: detailErr } = await supabase
      .from('audit_results')
      .select('query_pages')
      .eq('id', row.id)
      .single();
    if (detailErr) {
      console.error(`${row.audit_date} fetch query_pages failed:`, detailErr.message);
      continue;
    }
    const qp = detail?.query_pages;
    if (!Array.isArray(qp) || qp.length === 0) {
      const date = String(row.audit_date).split('T')[0];
      console.log(`${date} SKIP (no query_pages)`);
      continue;
    }

    const backlinkMetrics = row.backlink_metrics || defaultBacklinkMetrics(row.authority_backlink_score);
    const scores = calculatePillarScores(
      { queryPages: qp, topQueries: [], ctr: 5, position: 10 },
      null,
      null,
      null,
      backlinkMetrics
    );

    const ac = scores.authorityComponents;
    const patch = {
      authority_score: scores.authority.score,
      authority_behaviour_score: ac.behaviour,
      authority_ranking_score: ac.ranking,
      authority_backlink_score: ac.backlinks,
      authority_review_score: ac.reviews,
      authority_by_segment: scores.authority.bySegment,
      updated_at: new Date().toISOString(),
    };

    const date = String(row.audit_date).split('T')[0];
    const changed =
      row.authority_score !== patch.authority_score ||
      row.authority_ranking_score !== patch.authority_ranking_score ||
      row.authority_behaviour_score !== patch.authority_behaviour_score;

    console.log(
      `${date} ${row.property_url}: ${row.authority_score}→${patch.authority_score} ` +
        `(rank ${row.authority_ranking_score}→${patch.authority_ranking_score}, beh ${row.authority_behaviour_score}→${patch.authority_behaviour_score})` +
        `${row.is_partial ? ' [partial]' : ''}${changed ? '' : ' (unchanged)'}`
    );

    if (changed) updates.push({ id: row.id, ...patch });
  }

  console.log(`\n${updates.length} row(s) need update.`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write updates.');
    return;
  }

  for (const patch of updates) {
    const { id, ...fields } = patch;
    const { error: upErr } = await supabase.from('audit_results').update(fields).eq('id', id);
    if (upErr) console.error(`Update failed id ${id}:`, upErr.message);
  }

  console.log(`Applied ${updates.length} update(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
