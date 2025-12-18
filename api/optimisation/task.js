// /api/optimisation/task.js
// Create a new optimisation task

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
    const { keyword_text, target_url, task_type, status, title, notes, baselineMetrics } = req.body;

    if (!keyword_text || !target_url) {
      return sendJSON(res, 400, { error: 'keyword_text and target_url required' });
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
    // This is a well-known UUID for "system" user in single-user apps
    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Insert task
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .insert({
        keyword_text,
        target_url,
        task_type: task_type || 'on_page',
        status: status || 'planned',
        title: title || null,
        notes: notes || null,
        owner_user_id: userId
      })
      .select()
      .single();

    if (taskError) {
      console.error('[Optimisation Task] Insert error:', taskError);
      return sendJSON(res, 500, { error: taskError.message });
    }

    // Insert created event with baseline metrics snapshot
    const eventData = {
      task_id: task.id,
      event_type: 'created',
      note: 'Created from Ranking & AI module',
      owner_user_id: userId,
      cycle_number: task.cycle_active || 1,
      source: 'ranking_ai'
    };

    // Add baseline metrics if provided
    if (baselineMetrics) {
      eventData.metrics = {
        ...baselineMetrics,
        captured_at: baselineMetrics.captured_at || new Date().toISOString()
      };
    }

    const { error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert(eventData);

    if (eventError) {
      console.error('[Optimisation Task] Event insert error:', eventError);
      // Don't fail the request, just log
    }

    return sendJSON(res, 201, { task });
  } catch (error) {
    console.error('[Optimisation Task] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
