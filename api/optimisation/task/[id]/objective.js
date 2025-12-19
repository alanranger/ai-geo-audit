// /api/optimisation/task/[id]/objective.js
// Update objective fields on an optimisation task

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

    // Extract objective fields from request body (Phase B)
    const {
      objective_title,
      objective_kpi,
      objective_metric,
      objective_direction,
      objective_target_value,
      objective_target_delta, // Phase B field
      objective_timeframe_days,
      objective_due_at, // Phase B field
      objective_plan
    } = req.body;

    // Build update object (only include defined fields)
    const updates = {};
    if (objective_title !== undefined) updates.objective_title = objective_title;
    if (objective_kpi !== undefined) updates.objective_kpi = objective_kpi;
    if (objective_metric !== undefined) updates.objective_metric = objective_metric;
    if (objective_direction !== undefined) updates.objective_direction = objective_direction;
    // Support both Phase 4 (objective_target_value) and Phase B (objective_target_delta)
    if (objective_target_delta !== undefined) {
      updates.objective_target_delta = objective_target_delta != null ? parseFloat(objective_target_delta) : null;
    } else if (objective_target_value !== undefined) {
      updates.objective_target_value = objective_target_value != null ? parseFloat(objective_target_value) : null;
      // Also set objective_target_delta for Phase B compatibility
      updates.objective_target_delta = objective_target_value != null ? parseFloat(objective_target_value) : null;
    }
    if (objective_timeframe_days !== undefined) updates.objective_timeframe_days = objective_timeframe_days != null ? parseInt(objective_timeframe_days) : null;
    if (objective_due_at !== undefined) updates.objective_due_at = objective_due_at || null;
    if (objective_plan !== undefined) updates.objective_plan = objective_plan;

    // Set cycle_started_at if not already set and we're setting an objective
    if (!currentTask.cycle_started_at && (objective_metric || objective_direction || objective_target_delta || objective_target_value)) {
      updates.cycle_started_at = new Date().toISOString();
    }

    // Update task
    const { data: updatedTask, error: updateError } = await supabase
      .from('optimisation_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Optimisation Task Objective] Update error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // Also update the active cycle if it exists (for backward compatibility)
    if (currentTask.active_cycle_id) {
      const cycleUpdates = {};
      if (objective_title !== undefined) cycleUpdates.objective_title = objective_title;
      if (objective_kpi !== undefined) cycleUpdates.primary_kpi = objective_kpi;
      if (objective_target_value !== undefined) cycleUpdates.target_value = objective_target_value != null ? parseFloat(objective_target_value) : null;
      if (objective_direction !== undefined) cycleUpdates.target_direction = objective_direction;
      if (objective_timeframe_days !== undefined) cycleUpdates.timeframe_days = objective_timeframe_days != null ? parseInt(objective_timeframe_days) : null;
      if (objective_plan !== undefined) cycleUpdates.plan = objective_plan;
      cycleUpdates.updated_at = new Date().toISOString();

      const { error: cycleUpdateError } = await supabase
        .from('optimisation_task_cycles')
        .update(cycleUpdates)
        .eq('id', currentTask.active_cycle_id);

      if (cycleUpdateError) {
        console.error('[Optimisation Task Objective] Cycle update error:', cycleUpdateError);
        // Don't fail, but log
      }
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

    return sendJSON(res, 200, { task: updatedTask });
  } catch (error) {
    console.error('[Optimisation Task Objective] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

