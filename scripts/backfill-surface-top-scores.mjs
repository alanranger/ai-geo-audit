/**
 * One-shot: compute Surface Visibility + Top of page from keyword_rankings
 * and PATCH audit_results for dates that still have NULL scores.
 *
 * Usage: node --env-file=.env.local scripts/backfill-surface-top-scores.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const propertyUrl = process.env.PROPERTY_URL || 'https://www.alanranger.com';
const baseline = '2026-07-13';

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: dates, error: dateErr } = await sb
  .from('keyword_rankings')
  .select('audit_date')
  .eq('property_url', propertyUrl)
  .gte('audit_date', baseline)
  .order('audit_date', { ascending: true });

if (dateErr) {
  console.error(dateErr);
  process.exit(1);
}

const uniqueDates = [...new Set((dates || []).map((r) => String(r.audit_date).slice(0, 10)))];
console.log(`Dates with keyword_rankings >= ${baseline}: ${uniqueDates.join(', ') || '(none)'}`);

let updated = 0;
for (const d of uniqueDates) {
  const { data: rows, error } = await sb
    .from('keyword_rankings')
    .select('*')
    .eq('property_url', propertyUrl)
    .eq('audit_date', d);
  if (error) {
    console.warn(`Skip ${d}: ${error.message}`);
    continue;
  }
  const hasStack = (rows || []).some((r) => Array.isArray(r.serp_surface_stack) && r.serp_surface_stack.length > 0);
  if (!hasStack) {
    console.log(`Skip ${d}: no surface stacks`);
    continue;
  }
  const surface = Math.round(Number(computeSurfaceVisibilityRollup(rows).overall) || 0);
  const top = Math.round(Number(computeTopOfPageRollup(rows).overall) || 0);

  const { data: patched, error: patchErr } = await sb
    .from('audit_results')
    .update({
      surface_visibility_score: surface,
      top_of_page_score: top,
    })
    .eq('property_url', propertyUrl)
    .eq('audit_date', d)
    .select('audit_date');

  if (patchErr) {
    console.warn(`PATCH failed ${d}: ${patchErr.message}`);
    continue;
  }
  const n = Array.isArray(patched) ? patched.length : 0;
  console.log(`${d}: surface=${surface} top=${top} rows_updated=${n}`);
  if (n) updated += 1;
}

console.log(`Done. Updated ${updated} audit_results date(s).`);
