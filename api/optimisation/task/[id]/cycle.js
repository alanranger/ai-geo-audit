// /api/optimisation/task/[id]/cycle.js
// Create a new cycle for an optimisation task

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

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

    const {
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan
    } = req.body;

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

    // Get current task and active cycle
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('*, active_cycle_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    // Get the highest cycle number for this task
    const { data: existingCycles, error: cyclesError } = await supabase
      .from('optimisation_task_cycles')
      .select('cycle_no')
      .eq('task_id', id)
      .order('cycle_no', { ascending: false })
      .limit(1);

    if (cyclesError) {
      console.error('[Optimisation Cycle] Error fetching existing cycles:', cyclesError);
    }

    const nextCycleNo = existingCycles && existingCycles.length > 0 
      ? existingCycles[0].cycle_no + 1 
      : (task.cycle_active || 1) + 1;

    // End the previous cycle if it exists
    if (task.active_cycle_id) {
      await supabase
        .from('optimisation_task_cycles')
        .update({ end_date: new Date().toISOString() })
        .eq('id', task.active_cycle_id);
    }

    // Create new cycle
    const cycleData = {
      task_id: id,
      cycle_no: nextCycleNo,
      status: task.status || 'planned',
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
      console.error('[Optimisation Cycle] Insert error:', cycleError);
      return sendJSON(res, 500, { error: cycleError.message });
    }

    // Update task with new active_cycle_id and increment cycle_active
    const { error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({ 
        active_cycle_id: cycle.id,
        cycle_active: nextCycleNo
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Optimisation Cycle] Update task error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // Create event for new cycle
    const { error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert({
        task_id: id,
        event_type: 'status_changed',
        note: `Started Cycle ${nextCycleNo}`,
        owner_user_id: userId,
        cycle_id: cycle.id,
        cycle_number: nextCycleNo
      });

    if (eventError) {
      console.error('[Optimisation Cycle] Event insert error:', eventError);
      // Don't fail, just log
    }

    return sendJSON(res, 201, { cycle });
  } catch (error) {
    console.error('[Optimisation Cycle] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
