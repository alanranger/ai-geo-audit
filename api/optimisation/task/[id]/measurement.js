// /api/optimisation/task/[id]/measurement.js
// Add a measurement snapshot to an optimisation task

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
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: POST` });
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

    const { metrics, note } = req.body;

    if (!metrics || typeof metrics !== 'object') {
      return sendJSON(res, 400, { error: 'metrics object required' });
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

    // Get task to verify ownership and get active cycle
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('id, owner_user_id, cycle_active, active_cycle_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    if (userId && task.owner_user_id !== userId) {
      return sendJSON(res, 403, { error: 'Forbidden' });
    }

    // Get cycle number if active_cycle_id exists
    let cycleNo = task.cycle_active || 1;
    if (task.active_cycle_id) {
      const { data: cycle } = await supabase
        .from('optimisation_task_cycles')
        .select('cycle_no')
        .eq('id', task.active_cycle_id)
        .single();
      if (cycle) {
        cycleNo = cycle.cycle_no;
      }
    }

    // Insert measurement event
    const eventData = {
      task_id: id,
      event_type: 'measurement',
      note: note || null,
      cycle_id: task.active_cycle_id || null,
      cycle_number: cycleNo,
      metrics: {
        ...metrics,
        captured_at: metrics.captured_at || new Date().toISOString()
      },
      owner_user_id: userId
    };

    const { data: event, error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert(eventData)
      .select()
      .single();

    if (eventError) {
      console.error('[Optimisation Measurement] Insert error:', eventError);
      return sendJSON(res, 500, { error: eventError.message });
    }

    // Fetch updated task status from view (includes baseline/latest metrics)
    const { data: updatedTask, error: statusError } = await supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .eq('id', id)
      .single();

    if (statusError) {
      console.error('[Optimisation Measurement] Status fetch error:', statusError);
      // Still return success, just without updated status
      return sendJSON(res, 201, { event });
    }

    return sendJSON(res, 201, { event, task: updatedTask });
  } catch (error) {
    console.error('[Optimisation Measurement] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}


