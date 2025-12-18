// /api/optimisation/task/[id].js
// Update an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

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
  if (req.method !== 'PATCH') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
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

    // Get current task to check ownership and get old status
    const { data: currentTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('status, owner_user_id')
      .eq('id', id)
      .single();

    if (fetchError || !currentTask) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && currentTask.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    const { status, ...otherUpdates } = req.body;
    const updates = { ...otherUpdates };
    if (status) updates.status = status;

    // Update task
    const { data: task, error: updateError } = await supabase
      .from('optimisation_tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[Optimisation Task] Update error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // If status changed, add event
    if (status && status !== currentTask.status) {
      const { error: eventError } = await supabase
        .from('optimisation_task_events')
        .insert({
          task_id: id,
          event_type: 'status_changed',
          note: `Status: ${currentTask.status} → ${status}`,
          owner_user_id: userId
        });

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
