/**
 * Check if "photography tuition" keyword was captured in the last audit
 * and what rank data is available
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPhotographyTuition() {
  try {
    console.log('🔍 Checking for "photography tuition" keyword in audit data...');
    console.log('');
    
    // Get the latest audit result
    const { data: audits, error } = await supabase
      .from('audit_results')
      .select('id, property_url, audit_date, created_at, search_data')
      .order('audit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      throw error;
    }

    if (!audits || audits.length === 0) {
      console.log('❌ No audit results found');
      return;
    }

    console.log(`📊 Found ${audits.length} recent audit(s)`);
    console.log('');

    // Check each audit for the keyword
    for (const audit of audits) {
      const auditDate = audit.audit_date || audit.created_at;
      console.log(`📅 Checking audit from ${auditDate}:`);
      console.log(`   Property: ${audit.property_url}`);
      
      const searchData = audit.search_data;
      if (!searchData) {
        console.log('   ⚠️  No search_data in audit');
        continue;
      }

      // Check queryTotals
      const queryTotals = searchData.queryTotals || [];
      console.log(`   📊 queryTotals: ${queryTotals.length} keywords`);
      
      // Search for photography tuition (case-insensitive, partial match)
      const matchingQueries = queryTotals.filter(qt => {
        const keyword = (qt.query || qt.keyword || '').toLowerCase();
        return keyword.includes('photography tuition') || keyword.includes('photography-tuition');
      });

      if (matchingQueries.length > 0) {
        console.log(`   ✅ Found ${matchingQueries.length} matching keyword(s):`);
        matchingQueries.forEach(qt => {
          const keyword = qt.query || qt.keyword || 'unknown';
          const rank = qt.best_rank || qt.avg_position || qt.position || 'N/A';
          const clicks = qt.clicks || 0;
          const impressions = qt.impressions || 0;
          console.log(`      - "${keyword}": rank=${rank}, clicks=${clicks}, impressions=${impressions}`);
          console.log(`        best_rank: ${qt.best_rank || 'N/A'}, avg_position: ${qt.avg_position || 'N/A'}, position: ${qt.position || 'N/A'}`);
        });
      } else {
        console.log('   ❌ No matching keyword found in queryTotals');
        
        // Show sample keywords for debugging
        if (queryTotals.length > 0) {
          console.log('   📋 Sample keywords (first 10):');
          queryTotals.slice(0, 10).forEach(qt => {
            console.log(`      - "${qt.query || qt.keyword || 'unknown'}"`);
          });
        }
      }

      // Check queryPages
      const queryPages = searchData.queryPages || [];
      if (queryPages.length > 0) {
        const matchingPages = queryPages.filter(qp => {
          const keyword = (qp.query || qp.keyword || '').toLowerCase();
          return keyword.includes('photography tuition') || keyword.includes('photography-tuition');
        });
        
        if (matchingPages.length > 0) {
          console.log(`   ✅ Found ${matchingPages.length} matching query+page entry(ies):`);
          matchingPages.forEach(qp => {
            const keyword = qp.query || qp.keyword || 'unknown';
            const url = qp.page || qp.url || 'unknown';
            const rank = qp.position || qp.avg_position || 'N/A';
            console.log(`      - "${keyword}" → ${url}: rank=${rank}`);
          });
        }
      }

      console.log('');
    }

    // Also check if there's a task for this keyword
    console.log('🔍 Checking for optimisation task...');
    // Note: This would require the optimisation tables which may not be in this Supabase instance
    console.log('   (Optimisation task data would be in a different database/table)');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

checkPhotographyTuition();
