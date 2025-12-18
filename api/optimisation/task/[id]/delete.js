// /api/optimisation/task/[id]/delete.js
// Hard delete an optimisation task and all its events

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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: DELETE` });
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

    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Verify task exists and ownership
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('id, owner_user_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && task.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    // Delete all events first (foreign key constraint)
    const { error: eventsError } = await supabase
      .from('optimisation_task_events')
      .delete()
      .eq('task_id', id);

    if (eventsError) {
      console.error('[Optimisation Task Delete] Events delete error:', eventsError);
      return sendJSON(res, 500, { error: `Failed to delete events: ${eventsError.message}` });
    }

    // Delete all cycles
    const { error: cyclesError } = await supabase
      .from('optimisation_task_cycles')
      .delete()
      .eq('task_id', id);

    if (cyclesError) {
      console.error('[Optimisation Task Delete] Cycles delete error:', cyclesError);
      return sendJSON(res, 500, { error: `Failed to delete cycles: ${cyclesError.message}` });
    }

    // Delete the task
    const { error: taskDeleteError } = await supabase
      .from('optimisation_tasks')
      .delete()
      .eq('id', id);

    if (taskDeleteError) {
      console.error('[Optimisation Task Delete] Task delete error:', taskDeleteError);
      return sendJSON(res, 500, { error: `Failed to delete task: ${taskDeleteError.message}` });
    }

    return sendJSON(res, 200, { message: 'Task deleted successfully' });
  } catch (error) {
    console.error('[Optimisation Task Delete] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}


