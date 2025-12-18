// /api/optimisation/status.js
// Fetch optimisation task statuses in bulk

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
    const { keyword_keys, url_keys } = req.body;

    if (!keyword_keys || !Array.isArray(keyword_keys) || keyword_keys.length === 0) {
      return sendJSON(res, 400, { error: 'keyword_keys array required' });
    }

    if (!url_keys || !Array.isArray(url_keys)) {
      return sendJSON(res, 400, { error: 'url_keys array required' });
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

    // Query the status view with filters
    // Exclude deleted tasks - if a task is deleted, it shouldn't exist (hard delete),
    // but filter by status just to be safe in case of stale data
    let query = supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .in('keyword_key', keyword_keys)
      .neq('status', 'deleted'); // Exclude deleted tasks

    if (url_keys.length > 0) {
      query = query.in('target_url_clean', url_keys);
    }

    if (userId) {
      query = query.eq('owner_user_id', userId);
    }

    const { data: statuses, error: statusError } = await query;

    if (statusError) {
      console.error('[Optimisation Status] Query error:', statusError);
      return sendJSON(res, 500, { error: statusError.message });
    }

    // Get progress data for all tasks
    const taskIds = (statuses || []).map(s => s.id).filter(Boolean);
    let progressData = {};
    
    if (taskIds.length > 0) {
      const { data: progress, error: progressError } = await supabase
        .from('vw_optimisation_task_progress')
        .select('task_id, objective_state, due_at, days_remaining')
        .in('task_id', taskIds);

      if (progressError) {
        console.error('[Optimisation Status] Progress query error:', progressError);
        // Don't fail, just log
      } else if (progress) {
        // Create a map of task_id -> progress
        progress.forEach(p => {
          progressData[p.task_id] = {
            objective_state: p.objective_state || 'not_set',
            due_at: p.due_at,
            days_remaining: p.days_remaining
          };
        });
      }
    }

    // Merge progress data into statuses
    const enrichedStatuses = (statuses || []).map(status => ({
      ...status,
      objective_state: progressData[status.id]?.objective_state || 'not_set',
      due_at: progressData[status.id]?.due_at || null,
      days_remaining: progressData[status.id]?.days_remaining || null
    }));

    return sendJSON(res, 200, { statuses: enrichedStatuses });
  } catch (error) {
    console.error('[Optimisation Status] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
