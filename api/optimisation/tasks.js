// /api/optimisation/tasks.js
// Get all optimisation tasks

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/api/requireAdmin.js';

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
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Admin key gate
  if (!requireAdmin(req, res, sendJSON)) {
    return; // Response already sent
  }

  try {
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

    // Query the status view to get all tasks
    let query = supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .order('last_activity_at', { ascending: false });

    if (userId) {
      query = query.eq('owner_user_id', userId);
    }

    const { data: tasks, error } = await query;

    if (error) {
      console.error('[Optimisation Tasks] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    // Fetch goal status for all tasks
    const taskIds = (tasks || []).map(t => t.id).filter(Boolean);
    let goalStatusMap = {};
    
    if (taskIds.length > 0) {
      let goalQuery = supabase
        .from('vw_optimisation_task_goal_status')
        .select('task_id, goal_state, objective_kpi, objective_target_delta, objective_due_at, objective_delta')
        .in('task_id', taskIds);

      const { data: goalStatuses, error: goalError } = await goalQuery;
      
      if (goalError) {
        console.error('[Optimisation Tasks] Goal status query error:', goalError);
        // Don't fail, just log
      } else if (goalStatuses) {
        goalStatuses.forEach(gs => {
          goalStatusMap[gs.task_id] = {
            goal_state: gs.goal_state || 'not_set',
            objective_kpi: gs.objective_kpi,
            objective_target_delta: gs.objective_target_delta,
            objective_due_at: gs.objective_due_at,
            objective_delta: gs.objective_delta
          };
        });
      }
    }

    // Merge goal status into tasks
    const enrichedTasks = (tasks || []).map(task => ({
      ...task,
      ...goalStatusMap[task.id]
    }));

    return sendJSON(res, 200, { tasks: enrichedTasks });
  } catch (error) {
    console.error('[Optimisation Tasks] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

