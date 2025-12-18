// /api/optimisation/task/[id]/cycle.js
// Start a new optimisation cycle

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../../../lib/api/requireAdmin.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
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

    // Get current task
    const { data: currentTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('cycle_active, status, owner_user_id')
      .eq('id', id)
      .single();

    if (fetchError || !currentTask) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && currentTask.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    const newCycle = (currentTask.cycle_active || 1) + 1;

    // Update task: increment cycle, set status to in_progress
    const { data: task, error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({
        cycle_active: newCycle,
        status: 'in_progress' // Default to in_progress when starting new cycle
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Optimisation Cycle] Update error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // Add change_deployed event
    const { error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert({
        task_id: id,
        event_type: 'change_deployed',
        note: `Cycle incremented to ${newCycle}`,
        owner_user_id: userId
      });

    if (eventError) {
      console.error('[Optimisation Cycle] Event insert error:', eventError);
      // Don't fail the request
    }

    return sendJSON(res, 200, { task });
  } catch (error) {
    console.error('[Optimisation Cycle] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
