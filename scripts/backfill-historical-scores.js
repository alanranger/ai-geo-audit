/**
 * One-off script to calculate and backfill historical Authority and Visibility scores
 * 
 * This script:
 * 1. Fetches all audit_results records where authority_score or visibility_score is NULL
 * 2. For each record, gets corresponding GSC data from gsc_timeseries
 * 3. Calculates Authority and Visibility scores using the same logic as the dashboard
 * 4. Updates the audit_results table with the calculated scores
 * 
 * Usage: node scripts/backfill-historical-scores.js
 * 
 * Requires environment variables:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Try multiple env file locations
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local or .env');
  console.error('   Or pass them as command-line arguments:');
  console.error('   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-historical-scores.js');
  process.exit(1);
}

console.log(`✅ Using Supabase URL: ${supabaseUrl.substring(0, 30)}...`);

const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to clamp score between 0 and 100
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Calculate position score from average position
function calculatePositionScore(position) {
  const clampedPos = Math.max(1, Math.min(40, position));
  const scale = (clampedPos - 1) / 39;
  return 100 - scale * 90;
}

// Calculate CTR score from CTR (handles both decimal 0-1 and percentage 0-100)
function calculateCtrScore(ctr) {
  // GSC timeseries stores CTR as decimal (0-1), but audit_results might store as percentage
  // Normalize to decimal first
  let ctrDecimal = ctr;
  if (ctr > 1) {
    // Assume it's a percentage, convert to decimal
    ctrDecimal = ctr / 100;
  }
  // Apply formula: (ctr / 0.10) * 100, capped at 100
  return Math.min((ctrDecimal / 0.10) * 100, 100);
}

// Calculate Visibility score from position
function calculateVisibilityScore(position) {
  const posScore = calculatePositionScore(position);
  return clampScore(posScore);
}

// Calculate Authority score from GSC metrics (simplified version when topQueries not available)
function calculateAuthorityScore(position, ctr) {
  const posScore = calculatePositionScore(position);
  const ctrScore = calculateCtrScore(ctr);
  
  // Simplified Authority calculation (same as dashboard fallback)
  // Behaviour: Use aggregate CTR as proxy
  const estimatedBehaviourScore = Math.min(ctrScore * 0.7, 70);
  
  // Ranking: Use position score
  const estimatedRankingScore = posScore * 0.6;
  const estimatedShareScore = 20; // Conservative estimate for top-10 share
  const estimatedRanking = estimatedRankingScore + estimatedShareScore;
  
  // Placeholders (since we don't have historical backlink/review data)
  const backlinkScore = 50;
  const reviewScore = 50;
  
  const authority = clampScore(
    0.4 * estimatedBehaviourScore +
    0.2 * estimatedRanking +
    0.2 * backlinkScore +
    0.2 * reviewScore
  );
  
  return authority;
}

async function backfillHistoricalScores() {
  const propertyUrl = 'https://www.alanranger.com';
  
  console.log('🔍 Fetching audit records needing calculation...');
  
  // Fetch all audit records that need Authority or Visibility scores
  const { data: auditRecords, error: fetchError } = await supabase
    .from('audit_results')
    .select('id, audit_date, authority_score, visibility_score, gsc_avg_position, gsc_ctr')
    .eq('property_url', propertyUrl)
    .or('authority_score.is.null,visibility_score.is.null')
    .order('audit_date', { ascending: true });
  
  if (fetchError) {
    console.error('❌ Error fetching audit records:', fetchError);
    return;
  }
  
  if (!auditRecords || auditRecords.length === 0) {
    console.log('✅ No records need calculation. All scores are already populated.');
    return;
  }
  
  console.log(`📊 Found ${auditRecords.length} records needing calculation`);
  
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const record of auditRecords) {
    try {
      let authorityScore = record.authority_score;
      let visibilityScore = record.visibility_score;
      let needsUpdate = false;
      
      // Try to get GSC data for this audit date
      // First try exact date match
      let gscData = null;
      const { data: exactMatch, error: exactError } = await supabase
        .from('gsc_timeseries')
        .select('date, position, ctr')
        .eq('property_url', propertyUrl)
        .eq('date', record.audit_date)
        .limit(1)
        .maybeSingle();
      
      if (exactMatch) {
        gscData = exactMatch;
      } else {
        // If no exact match, try to get closest date (within 3 days)
        const auditDate = new Date(record.audit_date);
        const threeDaysAgo = new Date(auditDate);
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const threeDaysLater = new Date(auditDate);
        threeDaysLater.setDate(threeDaysLater.getDate() + 3);
        
        const { data: closestMatch, error: closestError } = await supabase
          .from('gsc_timeseries')
          .select('date, position, ctr')
          .eq('property_url', propertyUrl)
          .gte('date', threeDaysAgo.toISOString().split('T')[0])
          .lte('date', threeDaysLater.toISOString().split('T')[0])
          .order('date', { ascending: true })
          .limit(1)
          .maybeSingle();
        
        if (closestMatch) {
          gscData = closestMatch;
          console.log(`   📅 Using closest GSC data: ${closestMatch.date} (target: ${record.audit_date})`);
        }
      }
      
      // Calculate Visibility score
      if (visibilityScore === null) {
        if (gscData && gscData.position !== null && gscData.position !== undefined) {
          visibilityScore = calculateVisibilityScore(parseFloat(gscData.position));
          needsUpdate = true;
          console.log(`   📊 Calculated Visibility: ${visibilityScore} from position ${gscData.position}`);
        } else if (record.gsc_avg_position !== null && record.gsc_avg_position !== undefined) {
          // Fallback to stored avg_position in audit_results
          visibilityScore = calculateVisibilityScore(parseFloat(record.gsc_avg_position));
          needsUpdate = true;
          console.log(`   📊 Calculated Visibility: ${visibilityScore} from stored avg_position ${record.gsc_avg_position}`);
        } else {
          console.log(`   ⚠️  Skipping ${record.audit_date}: No position data available for Visibility`);
          skipped++;
          continue;
        }
      }
      
      // Calculate Authority score
      if (authorityScore === null) {
        if (gscData && gscData.position !== null && gscData.position !== undefined && gscData.ctr !== null && gscData.ctr !== undefined) {
          authorityScore = calculateAuthorityScore(
            parseFloat(gscData.position),
            parseFloat(gscData.ctr)
          );
          needsUpdate = true;
          console.log(`   📊 Calculated Authority: ${authorityScore} from position ${gscData.position}, CTR ${gscData.ctr}`);
        } else if (record.gsc_avg_position !== null && record.gsc_avg_position !== undefined && record.gsc_ctr !== null && record.gsc_ctr !== undefined) {
          // Fallback to stored values in audit_results
          authorityScore = calculateAuthorityScore(
            parseFloat(record.gsc_avg_position),
            parseFloat(record.gsc_ctr)
          );
          needsUpdate = true;
          console.log(`   📊 Calculated Authority: ${authorityScore} from stored avg_position ${record.gsc_avg_position}, CTR ${record.gsc_ctr}`);
        } else {
          console.log(`   ⚠️  Skipping ${record.audit_date}: No position/CTR data available for Authority`);
          skipped++;
          continue;
        }
      }
      
      // Update the record if we calculated new scores
      if (needsUpdate) {
        const updateData = {};
        if (authorityScore !== null && record.authority_score === null) {
          updateData.authority_score = authorityScore;
        }
        if (visibilityScore !== null && record.visibility_score === null) {
          updateData.visibility_score = visibilityScore;
        }
        
        const { error: updateError } = await supabase
          .from('audit_results')
          .update(updateData)
          .eq('id', record.id);
        
        if (updateError) {
          console.error(`   ❌ Error updating ${record.audit_date}:`, updateError.message);
          errors++;
        } else {
          const updates = [];
          if (authorityScore !== null && record.authority_score === null) updates.push(`authority=${authorityScore}`);
          if (visibilityScore !== null && record.visibility_score === null) updates.push(`visibility=${visibilityScore}`);
          console.log(`   ✅ Updated ${record.audit_date}: ${updates.join(', ')}`);
          updated++;
        }
      }
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error processing ${record.audit_date}:`, error.message);
      errors++;
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`   ✅ Updated: ${updated} records`);
  console.log(`   ⚠️  Skipped: ${skipped} records (no GSC data)`);
  console.log(`   ❌ Errors: ${errors} records`);
  console.log(`   📝 Total processed: ${auditRecords.length} records`);
}

// Run the script
backfillHistoricalScores()
  .then(() => {
    console.log('\n✅ Backfill complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

