/**
 * Recompute audit_results.authority_score from stored 4 component columns.
 * Fixes chart/pillar divergence when authority_score was saved without valid components.
 *
 * Usage (dry run):
 *   node scripts/backfill-authority-from-components.mjs
 *
 * Apply updates:
 *   node scripts/backfill-authority-from-components.mjs --apply
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local or .env
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  recomputeAuthorityTotal,
  resolveAuthorityFromHistoryRecord,
} from '../lib/audit/authorityScore.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const propertyFilter = process.argv.find((a) => a.startsWith('--property='))?.split('=')[1];

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  let query = supabase
    .from('audit_results')
    .select(
      'id, property_url, audit_date, authority_score, authority_behaviour_score, authority_ranking_score, authority_backlink_score, authority_review_score'
    )
    .order('audit_date', { ascending: true });

  if (propertyFilter) {
    query = query.ilike('property_url', `%${propertyFilter}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  const lastGoodByProperty = new Map();
  let examined = 0;
  let wouldUpdate = 0;
  const updates = [];

  for (const row of data || []) {
    examined += 1;
    const prop = row.property_url;
    if (!lastGoodByProperty.has(prop)) {
      lastGoodByProperty.set(prop, {
        authority_behaviour_score: null,
        authority_ranking_score: null,
        authority_backlink_score: null,
        authority_review_score: null,
      });
    }
    const lastGood = lastGoodByProperty.get(prop);
    const record = {
      date: row.audit_date,
      authority_score: row.authority_score,
      authority_behaviour_score: row.authority_behaviour_score,
      authority_ranking_score: row.authority_ranking_score,
      authority_backlink_score: row.authority_backlink_score,
      authority_review_score: row.authority_review_score,
      authorityBehaviourScore: row.authority_behaviour_score,
      authorityRankingScore: row.authority_ranking_score,
      authorityBacklinkScore: row.authority_backlink_score,
      authorityReviewScore: row.authority_review_score,
    };
    const resolved = resolveAuthorityFromHistoryRecord(record, lastGood);

    if (resolved) {
      lastGood.authority_behaviour_score = resolved.behaviour;
      lastGood.authority_ranking_score = resolved.ranking;
      lastGood.authority_backlink_score = resolved.backlinks;
      lastGood.authority_review_score = resolved.reviews;
    }

    const hasComponentColumns = [
      row.authority_behaviour_score,
      row.authority_ranking_score,
      row.authority_backlink_score,
      row.authority_review_score,
    ].some((v) => typeof v === 'number' && Number.isFinite(v));

    if (!hasComponentColumns) continue;

    const target = resolved?.total ?? null;
    if (target === null) continue;

    const stored = row.authority_score;
    const mismatch = stored === null || Math.abs(stored - target) > 1;
    if (!mismatch) continue;

    wouldUpdate += 1;
    const date = String(row.audit_date).split('T')[0];
    console.log(
      `${date} ${prop}: authority ${stored} → ${target} (b=${row.authority_behaviour_score} r=${row.authority_ranking_score} bl=${row.authority_backlink_score} rv=${row.authority_review_score})`
    );
    updates.push({ id: row.id, authority_score: target });
  }

  console.log(`\nExamined ${examined} rows; ${wouldUpdate} need authority_score correction.`);

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write updates.');
    return;
  }

  for (const patch of updates) {
    const { error: upErr } = await supabase
      .from('audit_results')
      .update({ authority_score: patch.authority_score, updated_at: new Date().toISOString() })
      .eq('id', patch.id);
    if (upErr) {
      console.error(`Update failed for id ${patch.id}:`, upErr.message);
    }
  }

  console.log(`Applied ${updates.length} updates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
