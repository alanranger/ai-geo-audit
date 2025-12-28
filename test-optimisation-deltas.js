/**
 * Test Optimisation Task Delta Calculations
 * 
 * This script verifies that deltas are calculated correctly between:
 * - Task baseline measurements (whenever they were taken)
 * - Latest audit data (from audit_date, noting GSC data is 2 days behind)
 * 
 * Usage: node test-optimisation-deltas.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testOptimisationDeltas() {
  console.log('🔍 Testing Optimisation Task Delta Calculations\n');
  
  // 1. Get latest audit date
  const { data: latestAudit, error: auditError } = await supabase
    .from('audit_results')
    .select('audit_date, property_url, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position')
    .eq('property_url', 'https://www.alanranger.com')
    .order('audit_date', { ascending: false })
    .limit(1)
    .single();
  
  if (auditError || !latestAudit) {
    console.error('❌ Failed to fetch latest audit:', auditError?.message || 'No audit found');
    return;
  }
  
  console.log(`✅ Latest Audit Date: ${latestAudit.audit_date}`);
  console.log(`   Note: GSC data is 2 days behind, so data reflects: ${new Date(new Date(latestAudit.audit_date).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}\n`);
  
  // 2. Get previous audit date
  const { data: previousAudit, error: prevError } = await supabase
    .from('audit_results')
    .select('audit_date, property_url, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position')
    .eq('property_url', 'https://www.alanranger.com')
    .lt('audit_date', latestAudit.audit_date)
    .order('audit_date', { ascending: false })
    .limit(1)
    .single();
  
  if (prevError || !previousAudit) {
    console.log('⚠️  No previous audit found (this is OK if this is the first audit)');
  } else {
    console.log(`✅ Previous Audit Date: ${previousAudit.audit_date}`);
    console.log(`   GSC Clicks: ${previousAudit.gsc_clicks} → ${latestAudit.gsc_clicks} (Δ: ${latestAudit.gsc_clicks - previousAudit.gsc_clicks})`);
    console.log(`   GSC Impressions: ${previousAudit.gsc_impressions} → ${latestAudit.gsc_impressions} (Δ: ${latestAudit.gsc_impressions - previousAudit.gsc_impressions})`);
    console.log(`   GSC CTR: ${previousAudit.gsc_ctr}% → ${latestAudit.gsc_ctr}% (Δ: ${(parseFloat(latestAudit.gsc_ctr) - parseFloat(previousAudit.gsc_ctr)).toFixed(2)}pp)`);
    console.log(`   Avg Position: ${previousAudit.gsc_avg_position} → ${latestAudit.gsc_avg_position} (Δ: ${(parseFloat(latestAudit.gsc_avg_position) - parseFloat(previousAudit.gsc_avg_position)).toFixed(2)})\n`);
  }
  
  // 3. Get tasks with baselines and latest measurements
  const { data: tasks, error: tasksError } = await supabase
    .from('optimisation_tasks')
    .select('id, keyword_text, target_url, status, active_cycle_id')
    .not('status', 'in', '(done,cancelled,deleted)')
    .limit(5);
  
  if (tasksError || !tasks || tasks.length === 0) {
    console.error('❌ Failed to fetch tasks:', tasksError?.message || 'No tasks found');
    return;
  }
  
  console.log(`✅ Found ${tasks.length} active tasks\n`);
  
  // 4. For each task, get baseline and latest measurements
  for (const task of tasks) {
    console.log(`📊 Task: ${task.keyword_text || task.target_url || task.id}`);
    console.log(`   Status: ${task.status}`);
    
    // Get baseline measurement
    const { data: baseline, error: baselineError } = await supabase
      .from('optimisation_task_events')
      .select('event_at, metrics, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position')
      .eq('task_id', task.id)
      .eq('event_type', 'measurement')
      .eq('is_baseline', true)
      .order('event_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // Get latest measurement
    const { data: latest, error: latestError } = await supabase
      .from('optimisation_task_events')
      .select('event_at, metrics, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position')
      .eq('task_id', task.id)
      .eq('event_type', 'measurement')
      .eq('is_baseline', false)
      .order('event_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (baselineError || latestError) {
      console.log(`   ⚠️  Error fetching measurements: ${baselineError?.message || latestError?.message}`);
      continue;
    }
    
    if (!baseline) {
      console.log(`   ⚠️  No baseline measurement found`);
    } else {
      const baselineDate = new Date(baseline.event_at).toISOString().split('T')[0];
      console.log(`   📅 Baseline: ${baselineDate}`);
      
      // Extract metrics from JSONB field
      const baselineMetrics = baseline.metrics || {};
      const baselineClicks = baselineMetrics.gsc_clicks_28d || baseline.gsc_clicks;
      const baselineImpressions = baselineMetrics.gsc_impressions_28d || baseline.gsc_impressions;
      const baselineCtr = baselineMetrics.gsc_ctr_28d || baseline.gsc_ctr;
      const baselineRank = baselineMetrics.current_rank || baseline.gsc_avg_position;
      
      console.log(`      Clicks: ${baselineClicks ?? 'N/A'}`);
      console.log(`      Impressions: ${baselineImpressions ?? 'N/A'}`);
      console.log(`      CTR: ${baselineCtr != null ? (baselineCtr * 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`      Rank: ${baselineRank ?? 'N/A'}`);
    }
    
    if (!latest) {
      console.log(`   ⚠️  No latest measurement found`);
    } else {
      const latestDate = new Date(latest.event_at).toISOString().split('T')[0];
      console.log(`   📅 Latest: ${latestDate}`);
      
      // Extract metrics from JSONB field
      const latestMetrics = latest.metrics || {};
      const latestClicks = latestMetrics.gsc_clicks_28d || latest.gsc_clicks;
      const latestImpressions = latestMetrics.gsc_impressions_28d || latest.gsc_impressions;
      const latestCtr = latestMetrics.gsc_ctr_28d || latest.gsc_ctr;
      const latestRank = latestMetrics.current_rank || latest.gsc_avg_position;
      
      console.log(`      Clicks: ${latestClicks ?? 'N/A'}`);
      console.log(`      Impressions: ${latestImpressions ?? 'N/A'}`);
      console.log(`      CTR: ${latestCtr != null ? (latestCtr * 100).toFixed(2) + '%' : 'N/A'}`);
      console.log(`      Rank: ${latestRank ?? 'N/A'}`);
      
      // Calculate deltas
      if (baseline && typeof baselineClicks === 'number' && typeof latestClicks === 'number') {
        const deltaClicks = latestClicks - baselineClicks;
        const deltaImpressions = latestImpressions - baselineImpressions;
        const deltaCtr = latestCtr != null && baselineCtr != null ? (latestCtr - baselineCtr) * 100 : null;
        const deltaRank = latestRank != null && baselineRank != null ? latestRank - baselineRank : null;
        
        console.log(`   📈 Deltas:`);
        console.log(`      Clicks: ${deltaClicks > 0 ? '+' : ''}${deltaClicks}`);
        console.log(`      Impressions: ${deltaImpressions > 0 ? '+' : ''}${deltaImpressions}`);
        if (deltaCtr != null) {
          console.log(`      CTR: ${deltaCtr > 0 ? '+' : ''}${deltaCtr.toFixed(2)}pp`);
        }
        if (deltaRank != null) {
          console.log(`      Rank: ${deltaRank > 0 ? '+' : ''}${deltaRank.toFixed(2)} (${deltaRank < 0 ? 'improved' : deltaRank > 0 ? 'worsened' : 'unchanged'})`);
        }
      }
    }
    
    console.log('');
  }
  
  console.log('✅ Delta calculation test complete!');
  console.log('\n📝 Summary:');
  console.log('   - Deltas should compare baseline (whenever taken) vs latest audit data');
  console.log('   - GSC data is 2 days behind the audit_date');
  console.log('   - Metrics are stored in the metrics JSONB field (gsc_clicks_28d, etc.)');
}

testOptimisationDeltas().catch(console.error);

