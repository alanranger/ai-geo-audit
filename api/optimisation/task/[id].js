// /api/optimisation/task/[id].js
// Update an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../lib/api/requireAdminOrShare.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  // Handle GET (read-only - allow share mode)
  if (req.method === 'GET') {
    const auth = requireAdminOrShare(req, res, sendJSON);
    if (!auth.authorized) {
      return; // Response already sent
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

      // Get task with status view (includes baseline/latest metrics)
      const { data: task, error: taskError } = await supabase
        .from('vw_optimisation_task_status')
        .select('*')
        .eq('id', id)
        .single();

      if (taskError || !task) {
        return sendJSON(res, 404, { error: 'Task not found' });
      }

      // Get active cycle with objective (Phase 5)
      let cycle = null;
      if (task.active_cycle_id) {
        const { data: cycleData } = await supabase
          .from('optimisation_task_cycles')
          .select('id, objective, objective_status, objective_progress, due_at')
          .eq('id', task.active_cycle_id)
          .single();
        cycle = cycleData;
      }

      // Get goal status (fallback for backward compatibility)
      const { data: goalStatus } = await supabase
        .from('vw_optimisation_task_goal_status')
        .select('goal_state, objective_kpi, objective_target_delta, objective_due_at, objective_delta, objective_direction')
        .eq('task_id', id)
        .single();

      // Get events (timeline)
      const { data: events } = await supabase
        .from('optimisation_task_events')
        .select('*')
        .eq('task_id', id)
        .order('created_at', { ascending: false });

      return sendJSON(res, 200, {
        task: {
          ...task,
          // Phase 5: Use objective_status from cycle, fallback to goal_state
          objective_status: cycle?.objective_status || goalStatus?.goal_state || 'not_set',
          objective: cycle?.objective || null,
          objective_progress: cycle?.objective_progress || null,
          objective_due_at: cycle?.due_at || goalStatus?.objective_due_at || null,
          // Legacy fields for backward compatibility
          goal_state: goalStatus?.goal_state || 'not_set',
          objective_kpi: goalStatus?.objective_kpi,
          objective_target_delta: goalStatus?.objective_target_delta,
          objective_delta: goalStatus?.objective_delta,
          objective_direction: goalStatus?.objective_direction
        },
        cycle: cycle,
        events: events || []
      });
    } catch (error) {
      console.error('[Optimisation Task] GET error:', error);
      return sendJSON(res, 500, { error: error.message || 'Internal server error' });
    }
  }

  // For write operations (PATCH, DELETE), require admin only
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
    return; // Response already sent
  }

  // Reject share mode for write operations
  if (isShareMode(req)) {
    return sendJSON(res, 403, { error: 'Write operations not allowed in share mode' });
  }

  // Handle DELETE (hard delete)
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        return sendJSON(res, 400, { error: 'Task ID required' });
      }

      const supabase = createClient(
        need('SUPABASE_URL'),
        need('SUPABASE_SERVICE_ROLE_KEY')
      );

      // Delete all events first (foreign key constraint)
      const { error: eventsError } = await supabase
        .from('optimisation_task_events')
        .delete()
        .eq('task_id', id);

      if (eventsError) {
        console.error('[Optimisation Task] Delete events error:', eventsError);
        return sendJSON(res, 500, { error: eventsError.message });
      }

      // Delete the task
      const { error: taskError } = await supabase
        .from('optimisation_tasks')
        .delete()
        .eq('id', id);

      if (taskError) {
        console.error('[Optimisation Task] Delete task error:', taskError);
        return sendJSON(res, 500, { error: taskError.message });
      }

      return sendJSON(res, 200, { message: 'Task deleted successfully' });
    } catch (error) {
      console.error('[Optimisation Task] Delete error:', error);
      return sendJSON(res, 500, { error: error.message || 'Internal server error' });
    }
  }

  if (req.method !== 'PATCH') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: GET, PATCH, or DELETE` });
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

    // Get current task to check ownership and get old status
    const { data: currentTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('status, owner_user_id, active_cycle_id')
      .eq('id', id)
      .single();

    if (fetchError || !currentTask) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && currentTask.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    // Separate task updates from cycle objective updates
    const {
      status,
      title,
      notes,
      // Cycle objective fields (Phase 4)
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      // Phase B objective fields
      objective_kpi,
      objective_target_delta,
      objective_due_at,
      objective_plan,
      ...otherUpdates
    } = req.body;

    const updates = { ...otherUpdates };
    if (status !== undefined) updates.status = status;
    if (title !== undefined) updates.title = title;
    if (notes !== undefined) updates.notes = notes;
    
    // Phase B objective fields
    if (objective_title !== undefined) updates.objective_title = objective_title;
    if (objective_kpi !== undefined) updates.objective_kpi = objective_kpi;
    if (objective_target_delta !== undefined) updates.objective_target_delta = objective_target_delta != null ? parseFloat(objective_target_delta) : null;
    if (target_direction !== undefined) updates.objective_direction = target_direction;
    if (objective_due_at !== undefined) updates.objective_due_at = objective_due_at || null;
    if (objective_plan !== undefined) updates.objective_plan = objective_plan;

    // Update task if there are task-level updates
    let task = currentTask;
    if (Object.keys(updates).length > 0) {
      const { data: updatedTask, error: updateError } = await supabase
      .from('optimisation_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Optimisation Task] Update error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }
      task = updatedTask;
    }

    // Update active cycle if objective fields are provided
    if (currentTask.active_cycle_id && (
      objective_title !== undefined ||
      primary_kpi !== undefined ||
      target_value !== undefined ||
      target_direction !== undefined ||
      timeframe_days !== undefined ||
      hypothesis !== undefined ||
      plan !== undefined
    )) {
      const cycleUpdates = {};
      if (objective_title !== undefined) cycleUpdates.objective_title = objective_title;
      if (primary_kpi !== undefined) cycleUpdates.primary_kpi = primary_kpi;
      if (target_value !== undefined) cycleUpdates.target_value = target_value != null ? parseFloat(target_value) : null;
      if (target_direction !== undefined) cycleUpdates.target_direction = target_direction;
      if (timeframe_days !== undefined) cycleUpdates.timeframe_days = timeframe_days != null ? parseInt(timeframe_days) : null;
      if (hypothesis !== undefined) cycleUpdates.hypothesis = hypothesis;
      if (plan !== undefined) cycleUpdates.plan = plan;
      cycleUpdates.updated_at = new Date().toISOString();

      const { error: cycleUpdateError } = await supabase
        .from('optimisation_task_cycles')
        .update(cycleUpdates)
        .eq('id', currentTask.active_cycle_id);

      if (cycleUpdateError) {
        console.error('[Optimisation Task] Cycle update error:', cycleUpdateError);
        // Don't fail, but log
      }
    }

    // If status changed, add event linked to active cycle
    if (status && status !== currentTask.status) {
      const eventData = {
        task_id: id,
        event_type: 'status_changed',
        note: `Status: ${currentTask.status} → ${status}`,
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
        console.error('[Optimisation Task] Event insert error:', eventError);
        // Don't fail the request
      }
    }

    return sendJSON(res, 200, { task });
  } catch (error) {
    console.error('[Optimisation Task] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
