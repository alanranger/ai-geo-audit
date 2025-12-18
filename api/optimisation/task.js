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
    const { 
      keyword_text, 
      target_url, 
      task_type, 
      status, 
      title, 
      notes, 
      baselineMetrics,
      // Cycle 1 objective fields (Phase 4)
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      // Phase B objective fields
      objective_kpi,
      objective_metric,
      objective_direction,
      objective_target_delta,
      objective_timeframe_days,
      objective_due_at,
      objective_plan,
      cycle_started_at
    } = req.body;

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

    // Insert task with Phase B objective fields
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .insert({
        keyword_text,
        target_url,
        task_type: task_type || 'on_page',
        status: status || 'planned',
        title: title || null,
        notes: notes || null,
        owner_user_id: userId,
        // Phase B objective fields
        objective_title: objective_title || null,
        objective_kpi: objective_kpi || null,
        objective_metric: objective_metric || null,
        objective_direction: objective_direction || target_direction || null,
        objective_target_delta: objective_target_delta != null ? parseFloat(objective_target_delta) : null,
        objective_timeframe_days: objective_timeframe_days != null ? parseInt(objective_timeframe_days) : (timeframe_days != null ? parseInt(timeframe_days) : null),
        objective_due_at: objective_due_at || null,
        objective_plan: objective_plan || plan || null,
        cycle_started_at: cycle_started_at || (objective_title || objective_kpi || objective_metric ? new Date().toISOString() : null)
      })
      .select()
      .single();

    if (taskError) {
      console.error('[Optimisation Task] Insert error:', taskError);
      return sendJSON(res, 500, { error: taskError.message });
    }

    // Create Cycle 1
    const cycleData = {
      task_id: task.id,
      cycle_no: 1,
      status: status || 'planned',
      objective_title: objective_title || null,
      primary_kpi: primary_kpi || null,
      target_value: target_value != null ? parseFloat(target_value) : null,
      target_direction: target_direction || null,
      timeframe_days: timeframe_days != null ? parseInt(timeframe_days) : null,
      hypothesis: hypothesis || null,
      plan: plan || null,
      start_date: new Date().toISOString()
    };

    const { data: cycle, error: cycleError } = await supabase
      .from('optimisation_task_cycles')
      .insert(cycleData)
      .select()
      .single();

    if (cycleError) {
      console.error('[Optimisation Task] Cycle insert error:', cycleError);
      return sendJSON(res, 500, { error: cycleError.message });
    }

    // Update task with active_cycle_id
    const { error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({ active_cycle_id: cycle.id })
      .eq('id', task.id);

    if (updateError) {
      console.error('[Optimisation Task] Update active_cycle_id error:', updateError);
      // Don't fail, but log
    }

    // Insert created event with baseline metrics snapshot, linked to cycle
    const eventData = {
      task_id: task.id,
      event_type: 'created',
      note: 'Created from Ranking & AI module',
      owner_user_id: userId,
      cycle_id: cycle.id,
      cycle_number: 1,
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

    // Fetch updated task with cycle info
    const { data: updatedTask, error: fetchError } = await supabase
      .from('optimisation_tasks')
      .select('*')
      .eq('id', task.id)
      .single();

    if (fetchError) {
      console.error('[Optimisation Task] Fetch updated task error:', fetchError);
    }

    return sendJSON(res, 201, { task: updatedTask || task, cycle });
  } catch (error) {
    console.error('[Optimisation Task] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
