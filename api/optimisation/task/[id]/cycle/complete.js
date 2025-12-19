// /api/optimisation/task/[id]/cycle/complete.js
// Complete or archive a cycle for an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../../lib/api/requireAdminOrShare.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Write operation - require admin only (reject share mode)
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
    return; // Response already sent
  }

  if (isShareMode(req)) {
    return sendJSON(res, 403, { error: 'Write operations not allowed in share mode' });
  }

  try {
    const { id } = req.query;
    if (!id) {
      return sendJSON(res, 400, { error: 'Task ID required' });
    }

    const { action, cycle_id } = req.body;
    if (!action || !['complete', 'archive'].includes(action)) {
      return sendJSON(res, 400, { error: 'Action must be "complete" or "archive"' });
    }

    if (!cycle_id) {
      return sendJSON(res, 400, { error: 'Cycle ID required' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get the cycle to verify it exists and belongs to this task
    const { data: cycle, error: cycleError } = await supabase
      .from('optimisation_task_cycles')
      .select('id, task_id, cycle_no, status')
      .eq('id', cycle_id)
      .eq('task_id', id)
      .single();

    if (cycleError || !cycle) {
      return sendJSON(res, 404, { error: 'Cycle not found' });
    }

    // Update cycle status and end_date
    const updateData = {
      end_date: new Date().toISOString(),
      status: action === 'complete' ? 'completed' : 'archived'
    };

    const { data: updatedCycle, error: updateError } = await supabase
      .from('optimisation_task_cycles')
      .update(updateData)
      .eq('id', cycle_id)
      .select()
      .single();

    if (updateError) {
      console.error('[Optimisation Cycle] Error updating cycle:', updateError);
      return sendJSON(res, 500, { error: 'Failed to update cycle: ' + updateError.message });
    }

    // If this was the active cycle, clear the active_cycle_id from the task
    const { data: task } = await supabase
      .from('optimisation_tasks')
      .select('active_cycle_id')
      .eq('id', id)
      .single();

    if (task && task.active_cycle_id === cycle_id) {
      await supabase
        .from('optimisation_tasks')
        .update({ active_cycle_id: null, cycle_active: null })
        .eq('id', id);
    }

    // Create a timeline event
    await supabase
      .from('optimisation_task_events')
      .insert({
        task_id: id,
        cycle_id: cycle_id,
        cycle_number: cycle.cycle_no,
        event_type: action === 'complete' ? 'cycle_completed' : 'cycle_archived',
        event_at: new Date().toISOString(),
        note: `Cycle ${cycle.cycle_no} ${action === 'complete' ? 'completed' : 'archived'}`
      });

    // Get updated task with cycles
    const { data: updatedTask } = await supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .eq('id', id)
      .single();

    // Get all cycles for this task
    const { data: allCycles } = await supabase
      .from('optimisation_task_cycles')
      .select('id, cycle_no, start_date, end_date, objective_title, primary_kpi, target_value, target_direction, timeframe_days, plan, objective, objective_status, objective_progress, due_at, status')
      .eq('task_id', id)
      .order('cycle_no', { ascending: false });

    return sendJSON(res, 200, {
      cycle: updatedCycle,
      task: updatedTask,
      cycles: allCycles || []
    });

  } catch (error) {
    console.error('[Optimisation Cycle] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

