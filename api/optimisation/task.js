// /api/optimisation/task.js
// Create a new optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../lib/api/requireAdminOrShare.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Write operation - require admin only (reject share mode)
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
    return; // Response already sent
  }

  if (isShareMode(req)) {
    return sendJSON(res, 403, { error: 'Write operations not allowed in share mode' });
  }

  try {
    const {
      keyword_text,
      target_url,
      task_type, 
      status, 
      title, 
      notes, 
      baselineMetrics: baselineMetricsRaw,
      // Cycle 1 objective fields (Phase 4)
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      // Phase B objective fields
      objective_kpi,
      objective_metric,
      objective_direction,
      objective_target_delta,
      objective_timeframe_days,
      objective_due_at,
      objective_plan,
      cycle_started_at
    } = req.body;

    // For page-level tasks (on_page), keyword_text can be empty - use target_url as fallback
    // For keyword-level tasks, both are required
    if (!target_url) {
      return sendJSON(res, 400, { error: 'target_url is required' });
    }
    
    // If keyword_text is empty and this is a page-level task, use target_url as keyword_text
    // Otherwise, keyword_text is required for keyword-level tasks
    if (!keyword_text && task_type !== 'on_page') {
      return sendJSON(res, 400, { error: 'keyword_text is required for non-page-level tasks' });
    }
    
    // For page-level tasks with empty keyword_text, use target_url as keyword_text (API requires non-empty)
    const final_keyword_text = keyword_text || (task_type === 'on_page' ? target_url : '');

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get current user from auth header if available
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }

    // For single-user admin key approach, use a placeholder UUID if no auth
    // This is a well-known UUID for "system" user in single-user apps
    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Insert task with Phase B objective fields
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .insert({
        keyword_text: final_keyword_text,
        target_url,
        task_type: task_type || 'on_page',
        status: status || 'planned',
        title: title || null,
        notes: notes || null,
        owner_user_id: userId,
        // Phase B objective fields
        objective_title: objective_title || null,
        objective_kpi: objective_kpi || null,
        objective_metric: objective_metric || null,
        objective_direction: objective_direction || target_direction || null,
        objective_target_delta: objective_target_delta != null ? parseFloat(objective_target_delta) : null,
        objective_timeframe_days: objective_timeframe_days != null ? parseInt(objective_timeframe_days) : (timeframe_days != null ? parseInt(timeframe_days) : null),
        objective_due_at: objective_due_at || null,
        objective_plan: objective_plan || plan || null,
        cycle_started_at: cycle_started_at || (objective_title || objective_kpi || objective_metric ? new Date().toISOString() : null)
      })
      .select()
      .single();

    if (taskError) {
      console.error('[Optimisation Task] Insert error:', taskError);
      return sendJSON(res, 500, { error: taskError.message });
    }

    // Create Cycle 1 for new task
    // Note: This is a new task creation, so we always start with Cycle 1
    // If cycles already exist (shouldn't happen for new tasks), log a warning but still create Cycle 1
    const { data: existingCycles } = await supabase
      .from('optimisation_task_cycles')
      .select('cycle_no')
      .eq('task_id', task.id)
      .order('cycle_no', { ascending: false })
      .limit(1);
    
    if (existingCycles && existingCycles.length > 0) {
      console.warn(`[Optimisation Task] WARNING: Cycles already exist for new task ${task.id}. This should not happen. Creating Cycle 1 anyway.`);
    } else {
      console.log(`[Optimisation Task] Creating Cycle 1 for new task ${task.id}`);
    }
    
    // Build Phase 5 objective JSONB object if objective fields are provided
    let objectiveJsonb = null;
    if (objective_title || objective_kpi || objective_metric) {
      // Determine target value (prefer objective_target_delta, fallback to objective_target_value or target_value)
      let targetVal = objective_target_delta != null ? parseFloat(objective_target_delta) : 
                     (objective_target_value != null ? parseFloat(objective_target_value) : 
                     (target_value != null ? parseFloat(target_value) : null));
      
      // Determine target_type based on KPI and direction
      const kpiKey = objective_kpi || objective_metric || primary_kpi;
      const direction = objective_direction || target_direction;
      
      // For "at_least" or "at_most" direction, it's an absolute target
      // For "increase" or "decrease" direction, it's a delta target
      let targetType = 'delta'; // default
      if (direction === 'at_least' || direction === 'at_most') {
        targetType = 'absolute';
      } else if (direction === 'increase' || direction === 'decrease') {
        targetType = 'delta';
      } else if (kpiKey && (kpiKey.includes('rank') || kpiKey === 'ai_overview')) {
        // Rank and AI overview are always absolute
        targetType = 'absolute';
      }
      
      // Convert CTR percentage to ratio if needed (for absolute targets)
      // If target is > 1 and KPI is CTR-related, assume it's a percentage and convert to ratio
      if (targetType === 'absolute' && targetVal != null && targetVal > 1 && 
          kpiKey && (kpiKey.includes('ctr') || kpiKey === 'ctr_28d')) {
        targetVal = targetVal / 100;
        console.log(`[Optimisation Task] Converted CTR target from percentage (${targetVal * 100}%) to ratio (${targetVal})`);
      }
      
      // Calculate due_at from objective_due_at or timeframe
      let dueAt = null;
      if (objective_due_at) {
        dueAt = objective_due_at;
      } else if (objective_timeframe_days != null || timeframe_days != null) {
        const days = objective_timeframe_days != null ? parseInt(objective_timeframe_days) : parseInt(timeframe_days);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() + days);
        dueAt = startDate.toISOString();
      }
      
      objectiveJsonb = {
        title: objective_title || null,
        kpi: objective_kpi || objective_metric || primary_kpi || null,
        target: targetVal,
        target_type: targetType,
        due_at: dueAt,
        plan: objective_plan || plan || null
      };
      
      console.log('[Optimisation Task] Building Phase 5 objective JSONB:', objectiveJsonb);
    }
    
    const cycleData = {
      task_id: task.id,
      cycle_no: 1, // Always create Cycle 1 for new tasks
      status: status || 'planned',
      // Phase 4 fields (for backward compatibility)
      objective_title: objective_title || null,
      primary_kpi: primary_kpi || objective_kpi || objective_metric || null,
      target_value: objective_target_delta != null ? parseFloat(objective_target_delta) : 
                   (objective_target_value != null ? parseFloat(objective_target_value) : 
                   (target_value != null ? parseFloat(target_value) : null)),
      target_direction: objective_direction || target_direction || null,
      timeframe_days: objective_timeframe_days != null ? parseInt(objective_timeframe_days) : 
                      (timeframe_days != null ? parseInt(timeframe_days) : null),
      hypothesis: hypothesis || null,
      plan: objective_plan || plan || null,
      // Phase 5 objective JSONB
      objective: objectiveJsonb,
      due_at: objectiveJsonb?.due_at || null,
      start_date: new Date().toISOString()
    };

    const { data: cycle, error: cycleError } = await supabase
      .from('optimisation_task_cycles')
      .insert(cycleData)
      .select()
      .single();

    if (cycleError) {
      console.error('[Optimisation Task] Cycle insert error:', cycleError);
      return sendJSON(res, 500, { error: cycleError.message });
    }

    // Update task with active_cycle_id
    const { error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({ active_cycle_id: cycle.id })
      .eq('id', task.id);

    if (updateError) {
      console.error('[Optimisation Task] Update active_cycle_id error:', updateError);
      // Don't fail, but log
    }

    // Determine source from request body or default to 'ranking_ai'
    const source = req.body.source || 'ranking_ai';
    
    // Log baseline metrics received
    console.log('[Optimisation Task] Received baselineMetrics:', baselineMetricsRaw);
    console.log('[Optimisation Task] Source:', source);
    
    // Parse baselineMetrics if it's a string (shouldn't happen, but handle it)
    const baselineMetrics = typeof baselineMetricsRaw === 'string' ? JSON.parse(baselineMetricsRaw) : baselineMetricsRaw;
    
    if (baselineMetrics) {
      console.log('[Optimisation Task] Parsed baselineMetrics:', {
        clicks: baselineMetrics.gsc_clicks_28d,
        impressions: baselineMetrics.gsc_impressions_28d,
        ctr: baselineMetrics.gsc_ctr_28d,
        position: baselineMetrics.gsc_position_28d
      });
    } else {
      console.warn('[Optimisation Task] ⚠️ No baselineMetrics provided in request');
    }
    
    // Insert created event
    const createdEventData = {
        task_id: task.id,
        event_type: 'created',
        note: source === 'money_pages' ? 'Created from Money Pages module' : 'Created from Ranking & AI module',
      owner_user_id: userId,
      cycle_id: cycle.id,
      cycle_number: 1,
      source: source
    };

    const { error: createdEventError } = await supabase
      .from('optimisation_task_events')
      .insert(createdEventData);

    if (createdEventError) {
      console.error('[Optimisation Task] Created event insert error:', createdEventError);
      // Don't fail the request, just log
    }

    // Insert baseline measurement event if baseline metrics provided
    let baselineMeasurementCreated = false;
    if (baselineMetrics) {
      console.log('[Optimisation Task] Creating baseline measurement with metrics:', {
        task_id: task.id,
        cycle_id: cycle.id,
        clicks: baselineMetrics.gsc_clicks_28d,
        impressions: baselineMetrics.gsc_impressions_28d,
        ctr: baselineMetrics.gsc_ctr_28d,
        position: baselineMetrics.gsc_position_28d
      });
      
      const measurementEventData = {
        task_id: task.id,
        event_type: 'measurement',
        note: 'Baseline measurement from task creation',
        owner_user_id: userId,
        cycle_id: cycle.id,
        cycle_number: 1,
        source: source,
        is_baseline: true, // Mark as baseline measurement
        metrics: {
          ...baselineMetrics,
          captured_at: baselineMetrics.captured_at || new Date().toISOString()
        }
      };

      const { data: insertedMeasurement, error: measurementEventError } = await supabase
        .from('optimisation_task_events')
        .insert(measurementEventData)
        .select()
        .single();

      if (measurementEventError) {
        console.error('[Optimisation Task] Baseline measurement event insert error:', measurementEventError);
        console.error('[Optimisation Task] Measurement event data that failed:', JSON.stringify(measurementEventData, null, 2));
        console.error('[Optimisation Task] Full error details:', {
          code: measurementEventError.code,
          message: measurementEventError.message,
          details: measurementEventError.details,
          hint: measurementEventError.hint
        });
        // Don't fail the request, but log extensively for debugging
      } else {
        console.log('[Optimisation Task] ✓ Baseline measurement created successfully');
        console.log('[Optimisation Task] Inserted measurement event:', {
          id: insertedMeasurement?.id,
          event_type: insertedMeasurement?.event_type,
          is_baseline: insertedMeasurement?.is_baseline,
          metrics: insertedMeasurement?.metrics
        });
        // Return flag to indicate baseline was created
        baselineMeasurementCreated = true;
      }
    } else {
      console.warn('[Optimisation Task] ⚠️ No baselineMetrics provided - baseline measurement will not be created');
    }

    // Fetch updated task with cycle info
    const { data: updatedTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('*')
      .eq('id', task.id)
      .single();

    if (fetchError) {
      console.error('[Optimisation Task] Fetch updated task error:', fetchError);
    }

    return sendJSON(res, 201, { 
      task: updatedTask || task, 
      cycle,
      baselineMeasurementCreated: baselineMeasurementCreated
    });
  } catch (error) {
    console.error('[Optimisation Task] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
