// /api/optimisation/task/[id]/progress.js
// Get progress data for an optimisation task (from vw_optimisation_task_progress)

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: GET` });
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

    // Get task core fields
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('*')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && task.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    // Get progress data from view
    const { data: progress, error: progressError } = await supabase
      .from('vw_optimisation_task_progress')
      .select('*')
      .eq('task_id', id)
      .single();

    if (progressError && progressError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('[Optimisation Task Progress] Query error:', progressError);
      return sendJSON(res, 500, { error: progressError.message });
    }

    // If no progress data, return task with default progress
    const progressData = progress || {
      task_id: id,
      objective_state: 'not_set',
      baseline_metrics: null,
      latest_metrics: null,
      due_at: null,
      days_remaining: null
    };

    return sendJSON(res, 200, {
      task,
      progress: progressData
    });
  } catch (error) {
    console.error('[Optimisation Task Progress] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

