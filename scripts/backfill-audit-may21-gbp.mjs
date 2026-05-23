/**
 * Backfill 2026-05-21 audit_results row: GBP OAuth failed that day so
 * local_entity / service_area / brand were saved as 0. GSC on that date was valid.
 * Restores GBP fields from 2026-05-20 and recomputes brand_overlay from May 21 GSC metrics.
 *
 * Usage: node scripts/backfill-audit-may21-gbp.mjs
 *        node scripts/backfill-audit-may21-gbp.mjs --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROPERTY = 'https://www.alanranger.com';
const BAD_DATE = '2026-05-21';
const REF_DATE = '2026-05-20';
const dryRun = process.argv.includes('--dry-run');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(resolve(__dirname, '..', name), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const i = line.indexOf('=');
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    } catch {
      /* ignore */
    }
  }
}

function normalisePositionForBrand(pos, minPos = 1, maxPos = 10) {
  if (pos == null) return 0;
  const clamped = Math.max(minPos, Math.min(maxPos, pos));
  const t = (clamped - minPos) / (maxPos - minPos);
  return 100 - t * 100;
}

function computeBrandOverlay(args) {
  const {
    brandQueryShare = 0,
    brandCtr = 0,
    brandAvgPosition = null,
    reviewScore = 0,
    entityScore = 0
  } = args;
  const shareScore = Math.min(brandQueryShare / 0.3, 1) * 100;
  const ctrScore = Math.min(brandCtr / 0.4, 1) * 100;
  const posScore = normalisePositionForBrand(brandAvgPosition, 1, 10);
  const brandSearchScore = 0.4 * shareScore + 0.3 * ctrScore + 0.3 * posScore;
  const combined = 0.4 * brandSearchScore + 0.3 * reviewScore + 0.3 * entityScore;
  let label = 'Strong';
  if (combined < 40) label = 'Weak';
  else if (combined < 70) label = 'Developing';
  const notes = [];
  if (brandQueryShare < 0.1) notes.push('Low share of branded searches in GSC.');
  if (brandCtr < 0.25) notes.push('Branded CTR is below 25%.');
  if (brandAvgPosition == null || brandAvgPosition > 5) {
    notes.push('Branded queries do not consistently rank in top-5.');
  }
  if (reviewScore < 70) notes.push('Review rating / volume is still maturing.');
  if (entityScore < 70) notes.push('Knowledge-panel / entity coverage could be stronger.');
  return {
    score: Math.round(combined),
    label,
    brandQueryShare,
    brandCtr,
    brandAvgPosition: brandAvgPosition ?? 0,
    reviewScore,
    entityScore,
    notes
  };
}

async function main() {
  loadEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key);

  const { data: bad, error: e1 } = await sb
    .from('audit_results')
    .select('*')
    .eq('property_url', PROPERTY)
    .eq('audit_date', BAD_DATE)
    .maybeSingle();
  if (e1 || !bad) {
    console.error('No audit row for', BAD_DATE, e1?.message);
    process.exit(1);
  }

  const { data: ref, error: e2 } = await sb
    .from('audit_results')
    .select('local_entity_score,service_area_score,locations,service_areas,nap_consistency_score,knowledge_panel_detected,gbp_rating,gbp_review_count')
    .eq('property_url', PROPERTY)
    .eq('audit_date', REF_DATE)
    .maybeSingle();
  if (e2 || !ref) {
    console.error('No reference audit for', REF_DATE, e2?.message);
    process.exit(1);
  }

  const prev = bad.brand_overlay || {};
  const entityScore = ref.local_entity_score ?? 100;
  const brandOverlay = computeBrandOverlay({
    brandQueryShare: prev.brandQueryShare ?? 0,
    brandCtr: prev.brandCtr ?? 0,
    brandAvgPosition: prev.brandAvgPosition ?? null,
    reviewScore: prev.reviewScore ?? 84,
    entityScore
  });

  const patch = {
    local_entity_score: ref.local_entity_score ?? 100,
    service_area_score: ref.service_area_score ?? 100,
    locations: ref.locations ?? [],
    service_areas: ref.service_areas ?? [],
    nap_consistency_score: ref.nap_consistency_score ?? 100,
    knowledge_panel_detected: ref.knowledge_panel_detected === true,
    brand_overlay: brandOverlay,
    brand_score: brandOverlay.score
  };

  console.log('Before:', {
    local: bad.local_entity_score,
    service: bad.service_area_score,
    brand: bad.brand_score,
    visibility: bad.visibility_score
  });
  console.log('After:', {
    local: patch.local_entity_score,
    service: patch.service_area_score,
    brand: patch.brand_score,
    visibility: bad.visibility_score,
    entityInOverlay: brandOverlay.entityScore
  });

  if (dryRun) {
    console.log('Dry run — no update written.');
    return;
  }

  const { error: upd } = await sb
    .from('audit_results')
    .update(patch)
    .eq('property_url', PROPERTY)
    .eq('audit_date', BAD_DATE);

  if (upd) {
    console.error('Update failed:', upd.message);
    process.exit(1);
  }
  console.log('Updated audit_results for', BAD_DATE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
