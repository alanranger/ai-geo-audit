// /api/optimisation/task/[id]/objective.js
// Update objective fields on an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../lib/api/requireAdminOrShare.js';
import { validateObjective } from '../../../../lib/optimisation/objectiveSchema.js';
import { evaluateObjective } from '../../../../lib/optimisation/evaluateObjective.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'PATCH') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: PATCH` });
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
    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Get current task to check ownership and get active_cycle_id
    const { data: currentTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('owner_user_id, active_cycle_id, cycle_started_at')
      .eq('id', id)
      .single();

    if (fetchError || !currentTask) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && currentTask.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    // Get or create active cycle
    let activeCycleId = currentTask.active_cycle_id;
    let cycleNo = currentTask.cycle_active || 1;

    if (!activeCycleId) {
      // Create Cycle 1 if it doesn't exist
      const { data: newCycle, error: cycleCreateError } = await supabase
        .from('optimisation_task_cycles')
        .insert({
          task_id: id,
          cycle_no: 1,
          status: currentTask.status || 'planned',
          start_date: new Date().toISOString()
        })
        .select()
        .single();

      if (cycleCreateError) {
        console.error('[Optimisation Task Objective] Cycle create error:', cycleCreateError);
        return sendJSON(res, 500, { error: cycleCreateError.message });
      }

      activeCycleId = newCycle.id;
      cycleNo = 1;

      // Update task with active_cycle_id
      await supabase
        .from('optimisation_tasks')
        .update({ active_cycle_id: activeCycleId, cycle_active: 1 })
        .eq('id', id);
    }

    // Extract objective from request body (new Phase 5 format)
    const {
      title,
      kpi,
      target,
      target_type,
      due_at,
      plan
    } = req.body;

    // If no objective fields provided, clear objective
    if (title === undefined && kpi === undefined && target === undefined) {
      // Clear objective
      const { error: clearError } = await supabase
        .from('optimisation_task_cycles')
        .update({
          objective: null,
          objective_status: 'not_set',
          objective_progress: null,
          due_at: null,
          objective_updated_at: new Date().toISOString()
        })
        .eq('id', activeCycleId);

      if (clearError) {
        console.error('[Optimisation Task Objective] Clear error:', clearError);
        return sendJSON(res, 500, { error: clearError.message });
      }

      const { data: updatedCycle } = await supabase
        .from('optimisation_task_cycles')
        .select('*')
        .eq('id', activeCycleId)
        .single();

      return sendJSON(res, 200, { 
        cycle: updatedCycle,
        objective: null,
        objective_status: 'not_set',
        objective_progress: null
      });
    }

    // Validate and normalize objective
    const objectiveObj = {
      title: title || '',
      kpi: kpi || '',
      target: target,
      target_type: target_type,
      due_at: due_at || null,
      plan: plan || null
    };

    const validation = validateObjective(objectiveObj);
    if (!validation.ok) {
      return sendJSON(res, 400, { 
        error: 'Invalid objective',
        errors: validation.errors
      });
    }

    const normalisedObjective = validation.normalisedObjective;

    // Fetch baseline and latest measurements for evaluation
    const { data: measurements } = await supabase
      .from('optimisation_task_events')
      .select('metrics, created_at')
      .eq('task_id', id)
      .or(`cycle_id.eq.${activeCycleId},cycle_number.eq.${cycleNo}`)
      .not('metrics', 'is', null)
      .order('created_at', { ascending: true });

    let baselineMeasurement = null;
    let latestMeasurement = null;

    if (measurements && measurements.length > 0) {
      baselineMeasurement = measurements[0].metrics;
      latestMeasurement = measurements[measurements.length - 1].metrics;
    }

    // Evaluate objective
    const evaluation = evaluateObjective(
      normalisedObjective,
      baselineMeasurement,
      latestMeasurement,
      new Date()
    );

    // Update cycle with objective, status, and progress
    const dueAt = normalisedObjective.due_at ? new Date(normalisedObjective.due_at).toISOString() : null;

    const { data: updatedCycle, error: cycleUpdateError } = await supabase
      .from('optimisation_task_cycles')
      .update({
        objective: normalisedObjective,
        objective_status: evaluation.status,
        objective_progress: evaluation.progress,
        due_at: dueAt,
        objective_updated_at: new Date().toISOString()
      })
      .eq('id', activeCycleId)
      .select()
      .single();

    if (cycleUpdateError) {
      console.error('[Optimisation Task Objective] Cycle update error:', cycleUpdateError);
      return sendJSON(res, 500, { error: cycleUpdateError.message });
    }

    // Insert event for objective update
    const eventData = {
      task_id: id,
      event_type: 'note',
      note: 'Objective updated',
      owner_user_id: userId
    };

    // Link to active cycle if it exists
    if (currentTask.active_cycle_id) {
      eventData.cycle_id = currentTask.active_cycle_id;
      // Get cycle number for backward compatibility
      const { data: cycle } = await supabase
        .from('optimisation_task_cycles')
        .select('cycle_no')
        .eq('id', currentTask.active_cycle_id)
        .single();
      if (cycle) {
        eventData.cycle_number = cycle.cycle_no;
      }
    }

    const { error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert(eventData);

    if (eventError) {
      console.error('[Optimisation Task Objective] Event insert error:', eventError);
      // Don't fail the request
    }

    return sendJSON(res, 200, { 
      cycle: updatedCycle,
      objective: normalisedObjective,
      objective_status: evaluation.status,
      objective_progress: evaluation.progress
    });
  } catch (error) {
    console.error('[Optimisation Task Objective] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

