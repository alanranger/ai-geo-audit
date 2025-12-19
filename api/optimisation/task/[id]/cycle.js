// /api/optimisation/task/[id]/cycle.js
// Create a new cycle for an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../lib/api/requireAdminOrShare.js';

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
    const { id } = req.query;
    if (!id) {
      return sendJSON(res, 400, { error: 'Task ID required' });
    }

    // Parse objective from body (can be either old format or new Phase 5 format)
    const {
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      objective // Phase 5 format (jsonb object)
    } = req.body;

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

    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Get current task and active cycle
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('*, active_cycle_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    // Get current cycle to find latest measurement
    let currentCycle = null;
    let currentCycleNo = task.cycle_active || 1;
    if (task.active_cycle_id) {
      const { data: cycle } = await supabase
        .from('optimisation_task_cycles')
        .select('id, cycle_no, objective, due_at')
        .eq('id', task.active_cycle_id)
        .single();
      if (cycle) {
        currentCycle = cycle;
        currentCycleNo = cycle.cycle_no;
      }
    }

    // Find most recent measurement event for current cycle (this becomes baseline for new cycle)
    const { data: latestMeasurement } = await supabase
      .from('optimisation_task_events')
      .select('id, metrics, created_at')
      .eq('task_id', id)
      .eq('event_type', 'measurement')
      .or(`cycle_id.eq.${task.active_cycle_id || 'null'},cycle_number.eq.${currentCycleNo}`)
      .not('metrics', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Get the highest cycle number for this task
    const { data: existingCycles, error: cyclesError } = await supabase
      .from('optimisation_task_cycles')
      .select('cycle_no')
      .eq('task_id', id)
      .order('cycle_no', { ascending: false })
      .limit(1);

    if (cyclesError) {
      console.error('[Optimisation Cycle] Error fetching existing cycles:', cyclesError);
    }

    const nextCycleNo = existingCycles && existingCycles.length > 0 
      ? existingCycles[0].cycle_no + 1 
      : currentCycleNo + 1;

    // End the previous cycle if it exists
    if (task.active_cycle_id) {
      await supabase
        .from('optimisation_task_cycles')
        .update({ end_date: new Date().toISOString() })
        .eq('id', task.active_cycle_id);
    }

    // Calculate due_at from objective timeframe if available
    const now = new Date();
    let dueAt = null;
    if (objective && objective.due_at) {
      dueAt = new Date(objective.due_at).toISOString();
    } else if (objective && objective.timeframe_days) {
      dueAt = new Date(now.getTime() + objective.timeframe_days * 24 * 60 * 60 * 1000).toISOString();
    } else if (timeframe_days) {
      dueAt = new Date(now.getTime() + parseInt(timeframe_days) * 24 * 60 * 60 * 1000).toISOString();
    } else if (currentCycle && currentCycle.due_at) {
      // If previous cycle had a due date, calculate new one from start date
      const prevDue = new Date(currentCycle.due_at);
      const prevStart = currentCycle.start_date ? new Date(currentCycle.start_date) : now;
      const daysDiff = Math.round((prevDue - prevStart) / (24 * 60 * 60 * 1000));
      if (daysDiff > 0) {
        dueAt = new Date(now.getTime() + daysDiff * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // Build objective in Phase 5 format if provided, otherwise use legacy fields
    let objectiveData = null;
    if (objective && typeof objective === 'object') {
      objectiveData = objective;
    } else if (objective_title || primary_kpi || target_value != null) {
      // Convert legacy format to Phase 5 format
      const { validateObjective } = await import('../../../../lib/optimisation/objectiveSchema.js');
      const legacyObj = {
        title: objective_title || 'Objective',
        kpi: primary_kpi || 'clicks_28d',
        target: target_value != null ? parseFloat(target_value) : 0,
        target_type: target_direction === 'increase' ? 'delta' : (target_direction === 'decrease' ? 'delta' : 'delta'),
        due_at: dueAt,
        plan: plan || null
      };
      const validation = validateObjective(legacyObj);
      if (validation.ok) {
        objectiveData = validation.normalisedObjective;
      }
    }

    // Create new cycle
    const cycleData = {
      task_id: id,
      cycle_no: nextCycleNo,
      status: task.status || 'planned',
      objective_title: objective_title || null, // Keep for backward compatibility
      primary_kpi: primary_kpi || null,
      target_value: target_value != null ? parseFloat(target_value) : null,
      target_direction: target_direction || null,
      timeframe_days: timeframe_days != null ? parseInt(timeframe_days) : null,
      hypothesis: hypothesis || null,
      plan: plan || null,
      objective: objectiveData, // Phase 5 format
      start_date: now.toISOString(), // Use start_date (existing column)
      due_at: dueAt // Phase 6: set due date from objective timeframe
    };

    const { data: cycle, error: cycleError } = await supabase
      .from('optimisation_task_cycles')
      .insert(cycleData)
      .select()
      .single();

    if (cycleError) {
      console.error('[Optimisation Cycle] Insert error:', cycleError);
      return sendJSON(res, 500, { error: cycleError.message });
    }

    // Update task with new active_cycle_id, increment cycle_active, and clear objective fields
    const { error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({ 
        active_cycle_id: cycle.id,
        cycle_active: nextCycleNo,
        cycle_started_at: new Date().toISOString(),
        // Clear objective fields for new cycle
        objective_title: null,
        objective_kpi: null,
        objective_metric: null,
        objective_target_delta: null,
        objective_target_value: null,
        objective_direction: null,
        objective_due_at: null,
        objective_timeframe_days: null,
        objective_plan: null
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Optimisation Cycle] Update task error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // Create cycle_start event (Phase 6)
    const cycleStartEvent = {
      task_id: id,
      event_type: 'cycle_start',
      note: `Cycle ${nextCycleNo} started`,
      owner_user_id: userId,
      cycle_id: cycle.id,
      cycle_number: nextCycleNo,
      metrics: latestMeasurement ? {
        baseline_from_measurement_event_id: latestMeasurement.id,
        baseline_captured_at: latestMeasurement.created_at
      } : null
    };

    const { data: cycleStartEventData, error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert(cycleStartEvent)
      .select()
      .single();

    if (eventError) {
      console.error('[Optimisation Cycle] Event insert error:', eventError);
      // Don't fail, just log
    }

    // Get updated task with baseline/latest from view
    const { data: updatedTask } = await supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .eq('id', id)
      .single();

    return sendJSON(res, 201, { 
      cycle,
      cycle_start_event: cycleStartEventData,
      task: updatedTask,
      baseline_from_measurement: latestMeasurement ? {
        id: latestMeasurement.id,
        captured_at: latestMeasurement.created_at
      } : null
    });
  } catch (error) {
    console.error('[Optimisation Cycle] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
