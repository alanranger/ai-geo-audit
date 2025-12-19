// /api/optimisation/tasks.js
// Get all optimisation tasks

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../lib/api/requireAdminOrShare.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Admin key OR share token (read-only allowed)
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
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

    // Fetch objective status and progress from cycles (Phase 5)
    const taskIds = (tasks || []).map(t => t.id).filter(Boolean);
    let objectiveStatusMap = {};
    
    if (taskIds.length > 0) {
      // Get active cycles with objective data
      const { data: cycles, error: cyclesError } = await supabase
        .from('optimisation_task_cycles')
        .select('task_id, objective, objective_status, objective_progress, due_at')
        .in('task_id', taskIds)
        .not('objective', 'is', null);

      if (cyclesError) {
        console.error('[Optimisation Tasks] Cycles query error:', cyclesError);
        // Don't fail, just log
      } else if (cycles) {
        // Map by task_id (assuming one active cycle per task)
        cycles.forEach(cycle => {
          objectiveStatusMap[cycle.task_id] = {
            objective: cycle.objective,
            objective_status: cycle.objective_status || 'not_set',
            objective_progress: cycle.objective_progress,
            objective_due_at: cycle.due_at
          };
        });
      }

      // Also fetch from goal status view for backward compatibility
      let goalQuery = supabase
        .from('vw_optimisation_task_goal_status')
        .select('task_id, goal_state, objective_kpi, objective_target_delta, objective_due_at, objective_delta, objective_direction')
        .in('task_id', taskIds);

      const { data: goalStatuses, error: goalError } = await goalQuery;
      
      if (goalError) {
        console.error('[Optimisation Tasks] Goal status query error:', goalError);
        // Don't fail, just log
      } else if (goalStatuses) {
        goalStatuses.forEach(gs => {
          // Only use goal_state if we don't have objective_status from cycle
          if (!objectiveStatusMap[gs.task_id]) {
            objectiveStatusMap[gs.task_id] = {
              goal_state: gs.goal_state || 'not_set',
              objective_kpi: gs.objective_kpi,
              objective_target_delta: gs.objective_target_delta,
              objective_due_at: gs.objective_due_at,
              objective_delta: gs.objective_delta,
              objective_direction: gs.objective_direction
            };
          } else {
            // Merge goal_state as fallback
            objectiveStatusMap[gs.task_id].goal_state = gs.goal_state || 'not_set';
          }
        });
      }
    }

    // Merge objective status into tasks
    const enrichedTasks = (tasks || []).map(task => ({
      ...task,
      ...objectiveStatusMap[task.id],
      // Use objective_status from cycle if available, otherwise goal_state
      objective_status: objectiveStatusMap[task.id]?.objective_status || objectiveStatusMap[task.id]?.goal_state || 'not_set'
    }));

    return sendJSON(res, 200, { tasks: enrichedTasks });
  } catch (error) {
    console.error('[Optimisation Tasks] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

