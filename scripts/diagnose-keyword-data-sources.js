/**
 * Diagnostic script to understand data source differences for "photography tuition" keyword
 * 
 * This script will:
 * 1. Check what data exists in Supabase query_totals
 * 2. Check what data exists in Supabase ranking_ai_data
 * 3. Check what data exists in keyword_rankings table
 * 4. Compare field names and structures
 * 5. Identify why Optimization Task module can't find the data
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

const KEYWORD = 'photography tuition';

async function diagnoseKeywordDataSources() {
  try {
    console.log(`🔍 Diagnosing data sources for keyword: "${KEYWORD}"`);
    console.log('='.repeat(80));
    console.log('');

    // 1. Get latest audit from audit_results
    console.log('1. CHECKING LATEST AUDIT IN audit_results TABLE');
    console.log('-'.repeat(80));
    const { data: audits, error: auditError } = await supabase
      .from('audit_results')
      .select('id, property_url, audit_date, query_totals, ranking_ai_data')
      .eq('property_url', 'https://www.alanranger.com')
      .order('audit_date', { ascending: false })
      .limit(1);

    if (auditError) {
      console.error('❌ Error fetching audit_results:', auditError);
      return;
    }

    if (!audits || audits.length === 0) {
      console.log('❌ No audit results found');
      return;
    }

    const latestAudit = audits[0];
    console.log(`✅ Found latest audit: ${latestAudit.audit_date}`);
    console.log('');

    // 2. Check query_totals field
    console.log('2. CHECKING query_totals FIELD');
    console.log('-'.repeat(80));
    const queryTotals = latestAudit.query_totals;
    if (!queryTotals || !Array.isArray(queryTotals)) {
      console.log('❌ query_totals is null or not an array');
    } else {
      console.log(`✅ query_totals is an array with ${queryTotals.length} items`);
      
      // Search for "photography tuition"
      const matchingQueries = queryTotals.filter(qt => {
        const keyword = (qt.query || qt.keyword || '').toLowerCase();
        return keyword.includes('photography tuition') || keyword === 'photography tuition';
      });

      if (matchingQueries.length > 0) {
        console.log(`✅ Found ${matchingQueries.length} matching keyword(s) in query_totals:`);
        matchingQueries.forEach((qt, idx) => {
          console.log(`\n   Match ${idx + 1}:`);
          console.log(`   - keyword/query: "${qt.query || qt.keyword || 'N/A'}"`);
          console.log(`   - clicks: ${qt.clicks || 'N/A'}`);
          console.log(`   - impressions: ${qt.impressions || 'N/A'}`);
          console.log(`   - ctr: ${qt.ctr || 'N/A'}`);
          console.log(`   - best_rank: ${qt.best_rank || 'N/A'}`);
          console.log(`   - avg_position: ${qt.avg_position || 'N/A'}`);
          console.log(`   - has_ai_overview: ${qt.has_ai_overview || 'N/A'}`);
          console.log(`   - ai_alan_citations_count: ${qt.ai_alan_citations_count || 'N/A'}`);
          console.log(`   - ai_total_citations: ${qt.ai_total_citations || 'N/A'}`);
          console.log(`   - best_url: ${qt.best_url || qt.targetUrl || 'N/A'}`);
          console.log(`   - All fields: ${Object.keys(qt).join(', ')}`);
        });
      } else {
        console.log(`❌ No matching keyword found in query_totals`);
        console.log(`   Sample keywords (first 5):`);
        queryTotals.slice(0, 5).forEach(qt => {
          console.log(`   - "${qt.query || qt.keyword || 'unknown'}"`);
        });
      }
    }
    console.log('');

    // 3. Check ranking_ai_data field
    console.log('3. CHECKING ranking_ai_data FIELD');
    console.log('-'.repeat(80));
    const rankingAiData = latestAudit.ranking_ai_data;
    if (!rankingAiData) {
      console.log('❌ ranking_ai_data is null');
    } else {
      console.log(`✅ ranking_ai_data exists`);
      const combinedRows = rankingAiData.combinedRows;
      if (!combinedRows || !Array.isArray(combinedRows)) {
        console.log('❌ ranking_ai_data.combinedRows is null or not an array');
      } else {
        console.log(`✅ combinedRows is an array with ${combinedRows.length} items`);
        
        // Search for "photography tuition"
        const matchingRows = combinedRows.filter(r => {
          const keyword = (r.keyword || '').toLowerCase();
          return keyword.includes('photography tuition') || keyword === 'photography tuition';
        });

        if (matchingRows.length > 0) {
          console.log(`✅ Found ${matchingRows.length} matching keyword(s) in combinedRows:`);
          matchingRows.forEach((r, idx) => {
            console.log(`\n   Match ${idx + 1}:`);
            console.log(`   - keyword: "${r.keyword || 'N/A'}"`);
            console.log(`   - best_rank_group: ${r.best_rank_group || 'N/A'}`);
            console.log(`   - best_rank_absolute: ${r.best_rank_absolute || 'N/A'}`);
            console.log(`   - has_ai_overview: ${r.has_ai_overview || 'N/A'}`);
            console.log(`   - ai_alan_citations_count: ${r.ai_alan_citations_count || 'N/A'}`);
            console.log(`   - ai_total_citations: ${r.ai_total_citations || 'N/A'}`);
            console.log(`   - best_url: ${r.best_url || r.targetUrl || 'N/A'}`);
            console.log(`   - gsc_clicks_28d: ${r.gsc_clicks_28d || 'N/A'}`);
            console.log(`   - gsc_impressions_28d: ${r.gsc_impressions_28d || 'N/A'}`);
            console.log(`   - All fields: ${Object.keys(r).join(', ')}`);
          });
        } else {
          console.log(`❌ No matching keyword found in combinedRows`);
          console.log(`   Sample keywords (first 5):`);
          combinedRows.slice(0, 5).forEach(r => {
            console.log(`   - "${r.keyword || 'unknown'}"`);
          });
        }
      }
    }
    console.log('');

    // 4. Check keyword_rankings table
    console.log('4. CHECKING keyword_rankings TABLE');
    console.log('-'.repeat(80));
    const { data: keywordRows, error: keywordError } = await supabase
      .from('keyword_rankings')
      .select('*')
      .eq('property_url', 'https://www.alanranger.com')
      .eq('audit_date', latestAudit.audit_date)
      .ilike('keyword', `%${KEYWORD}%`)
      .limit(5);

    if (keywordError) {
      console.error('❌ Error fetching keyword_rankings:', keywordError);
    } else if (!keywordRows || keywordRows.length === 0) {
      console.log(`❌ No matching keyword found in keyword_rankings table`);
    } else {
      console.log(`✅ Found ${keywordRows.length} matching keyword(s) in keyword_rankings:`);
      keywordRows.forEach((row, idx) => {
        console.log(`\n   Match ${idx + 1}:`);
        console.log(`   - keyword: "${row.keyword || 'N/A'}"`);
        console.log(`   - best_rank_group: ${row.best_rank_group || 'N/A'}`);
        console.log(`   - best_rank_absolute: ${row.best_rank_absolute || 'N/A'}`);
        console.log(`   - has_ai_overview: ${row.has_ai_overview || 'N/A'}`);
        console.log(`   - ai_alan_citations_count: ${row.ai_alan_citations_count || 'N/A'}`);
        console.log(`   - ai_total_citations: ${row.ai_total_citations || 'N/A'}`);
        console.log(`   - best_url: ${row.best_url || 'N/A'}`);
        console.log(`   - All fields: ${Object.keys(row).join(', ')}`);
      });
    }
    console.log('');

    // 5. Compare field names
    console.log('5. FIELD NAME COMPARISON');
    console.log('-'.repeat(80));
    console.log('query_totals fields:');
    if (queryTotals && queryTotals.length > 0) {
      console.log(`   ${Object.keys(queryTotals[0]).join(', ')}`);
    } else {
      console.log('   (no data)');
    }
    
    console.log('\ncombinedRows fields:');
    if (rankingAiData && rankingAiData.combinedRows && rankingAiData.combinedRows.length > 0) {
      console.log(`   ${Object.keys(rankingAiData.combinedRows[0]).join(', ')}`);
    } else {
      console.log('   (no data)');
    }
    
    console.log('\nkeyword_rankings table fields:');
    if (keywordRows && keywordRows.length > 0) {
      console.log(`   ${Object.keys(keywordRows[0]).join(', ')}`);
    } else {
      console.log('   (no data)');
    }
    console.log('');

    // 6. Summary
    console.log('6. SUMMARY');
    console.log('='.repeat(80));
    const matchingQueries = queryTotals ? queryTotals.filter(qt => {
      const keyword = (qt.query || qt.keyword || '').toLowerCase();
      return keyword.includes('photography tuition') || keyword === 'photography tuition';
    }) : [];
    const matchingRows = rankingAiData && rankingAiData.combinedRows ? rankingAiData.combinedRows.filter(r => {
      const keyword = (r.keyword || '').toLowerCase();
      return keyword.includes('photography tuition') || keyword === 'photography tuition';
    }) : [];
    
    const hasQueryTotals = queryTotals && matchingQueries && matchingQueries.length > 0;
    const hasCombinedRows = rankingAiData && rankingAiData.combinedRows && matchingRows && matchingRows.length > 0;
    const hasKeywordRankings = keywordRows && keywordRows.length > 0;

    console.log(`✅ query_totals contains keyword: ${hasQueryTotals ? 'YES' : 'NO'}`);
    console.log(`✅ ranking_ai_data.combinedRows contains keyword: ${hasCombinedRows ? 'YES' : 'NO'}`);
    console.log(`✅ keyword_rankings table contains keyword: ${hasKeywordRankings ? 'YES' : 'NO'}`);
    console.log('');

    if (hasQueryTotals && hasCombinedRows) {
      console.log('📊 COMPARISON:');
      const qt = matchingQueries[0];
      const cr = matchingRows[0];
      
      console.log(`\n   query_totals:`);
      console.log(`   - Rank field: best_rank=${qt.best_rank || 'N/A'}, avg_position=${qt.avg_position || 'N/A'}`);
      console.log(`   - AI Overview: has_ai_overview=${qt.has_ai_overview || 'N/A'}`);
      console.log(`   - AI Citations: ai_alan_citations_count=${qt.ai_alan_citations_count || 'N/A'}`);
      
      console.log(`\n   combinedRows:`);
      console.log(`   - Rank field: best_rank_group=${cr.best_rank_group || 'N/A'}, best_rank_absolute=${cr.best_rank_absolute || 'N/A'}`);
      console.log(`   - AI Overview: has_ai_overview=${cr.has_ai_overview || 'N/A'}`);
      console.log(`   - AI Citations: ai_alan_citations_count=${cr.ai_alan_citations_count || 'N/A'}`);
      
      console.log(`\n   ⚠️  FIELD MISMATCH:`);
      console.log(`   - query_totals uses: best_rank or avg_position`);
      console.log(`   - combinedRows uses: best_rank_group or best_rank_absolute`);
      console.log(`   - These are DIFFERENT fields from DIFFERENT sources!`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

diagnoseKeywordDataSources();
