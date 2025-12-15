/**
 * Retag Keyword Segments Script (Direct - uses provided keys)
 * 
 * Re-classifies all keywords in the keyword_rankings table using intent-based rules.
 * Skips rows with segment_source='manual' to preserve manual overrides.
 * 
 * Usage: node scripts/retag-keyword-segments-direct.js
 */

import { createClient } from '@supabase/supabase-js';
import { classifyKeywordSegment } from '../lib/segment/classifyKeywordSegment.js';

// Use provided keys directly
const supabaseUrl = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function retagKeywordSegments() {
  console.log('🔄 Starting keyword segment re-tagging...\n');

  try {
    // Fetch all keyword rows
    console.log('📥 Fetching all keyword rows from keyword_rankings table...');
    const { data: rows, error: fetchError } = await supabase
      .from('keyword_rankings')
      .select('id, keyword, segment, page_type, best_url, segment_source')
      .order('keyword');

    if (fetchError) {
      throw new Error(`Failed to fetch keywords: ${fetchError.message}`);
    }

    if (!rows || rows.length === 0) {
      console.log('⚠️  No keyword rows found in database.');
      return;
    }

    console.log(`✓ Found ${rows.length} keyword rows\n`);

    // Classify each keyword
    const updates = [];
    const changes = [];
    const segmentCounts = { brand: 0, money: 0, education: 0, other: 0 };
    const changeCounts = { brand: 0, money: 0, education: 0, other: 0 };

    for (const row of rows) {
      // Skip manual overrides
      if (row.segment_source === 'manual') {
        continue;
      }

      const classification = classifyKeywordSegment({
        keyword: row.keyword,
        pageType: row.page_type || null,
        rankingUrl: row.best_url || null
      });

      const newSegment = classification.segment;
      const oldSegment = (row.segment || 'other').toLowerCase();

      // Count by new segment
      if (segmentCounts.hasOwnProperty(newSegment)) {
        segmentCounts[newSegment]++;
      } else {
        segmentCounts.other++;
      }

      // Track changes (normalize both for comparison)
      if (oldSegment !== newSegment) {
        changes.push({
          keyword: row.keyword,
          old: oldSegment,
          new: newSegment,
          reason: classification.reason
        });
        if (changeCounts.hasOwnProperty(newSegment)) {
          changeCounts[newSegment]++;
        } else {
          changeCounts.other++;
        }
      }

      // Prepare update (always update to ensure consistency)
      updates.push({
        id: row.id,
        segment: newSegment,
        segment_confidence: classification.confidence,
        segment_reason: classification.reason,
        segment_source: 'auto',
        updated_at: new Date().toISOString()
      });
    }

    console.log(`📊 Classification summary:`);
    console.log(`   Total rows processed: ${rows.length}`);
    console.log(`   Manual overrides skipped: ${rows.filter(r => r.segment_source === 'manual').length}`);
    console.log(`   Rows to update: ${updates.length}`);
    console.log(`   Changes: ${changes.length}\n`);

    console.log(`📈 New segment distribution:`);
    Object.entries(segmentCounts).forEach(([segment, count]) => {
      console.log(`   ${segment}: ${count}`);
    });
    console.log('');

    if (changes.length > 0) {
      console.log(`🔄 Changes by new segment:`);
      Object.entries(changeCounts).forEach(([segment, count]) => {
        if (count > 0) {
          console.log(`   → ${segment}: ${count}`);
        }
      });
      console.log('');

      console.log(`📋 Top 20 examples of changes:`);
      changes.slice(0, 20).forEach((change, idx) => {
        console.log(`   ${idx + 1}. "${change.keyword}"`);
        console.log(`      ${change.old} → ${change.new} (${change.reason})`);
      });
      console.log('');
    }

    // Update rows in batches
    if (updates.length > 0) {
      console.log(`💾 Updating ${updates.length} rows in database...`);
      
      const BATCH_SIZE = 100;
      let updated = 0;
      
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        
        // Update each row individually to avoid constraint issues
        for (const update of batch) {
          const { error: updateError } = await supabase
            .from('keyword_rankings')
            .update({
              segment: update.segment,
              segment_confidence: update.segment_confidence,
              segment_reason: update.segment_reason,
              segment_source: update.segment_source,
              updated_at: update.updated_at
            })
            .eq('id', update.id);

          if (updateError) {
            console.error(`❌ Error updating row ${update.id} (${update.keyword}):`, updateError.message);
          } else {
            updated++;
          }
        }
        
        console.log(`   ✓ Processed batch ${Math.floor(i / BATCH_SIZE) + 1} (${updated}/${updates.length} rows)`);
      }

      console.log(`\n✅ Successfully updated ${updated} keyword rows`);
    } else {
      console.log('ℹ️  No rows to update (all segments already correct or manually overridden)');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
retagKeywordSegments()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });

