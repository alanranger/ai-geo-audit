// /api/optimisation/task/[id].js
// Update an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../lib/api/requireAdmin.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'PATCH') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: PATCH` });
  }

  // Admin key gate
  if (!requireAdmin(req, res, sendJSON)) {
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
      // Cycle objective fields
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      ...otherUpdates
    } = req.body;

    const updates = { ...otherUpdates };
    if (status !== undefined) updates.status = status;
    if (title !== undefined) updates.title = title;
    if (notes !== undefined) updates.notes = notes;

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
