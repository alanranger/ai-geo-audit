// /api/optimisation/task/[id]/measurement.js
// Add a measurement snapshot to an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../lib/api/requireAdminOrShare.js';
import { evaluateObjective } from '../../../../lib/optimisation/evaluateObjective.js';

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
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: POST` });
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

    // Idempotency check: If a measurement was created in the last 5 minutes, return existing
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentMeasurement } = await supabase
      .from('optimisation_task_events')
      .select('id, created_at, metrics')
      .eq('task_id', id)
      .eq('event_type', 'measurement')
      .or(`cycle_id.eq.${task.active_cycle_id},cycle_number.eq.${cycleNo}`)
      .gte('created_at', fiveMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentMeasurement) {
      // Return existing measurement (idempotent)
      const { data: updatedTask } = await supabase
        .from('vw_optimisation_task_status')
        .select('*')
        .eq('id', id)
        .single();
      
      return sendJSON(res, 200, { 
        event: recentMeasurement, 
        task: updatedTask,
        skipped: true,
        message: 'Measurement already captured recently (within 5 minutes). Returning existing measurement.'
      });
    }

    // Insert measurement event
    const eventData = {
      task_id: id,
      event_type: 'measurement',
      note: note || 'Latest measurement captured',
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

    // Auto-evaluate objective if cycle has one
    if (task.active_cycle_id) {
      // Get current cycle with objective
      const { data: cycle, error: cycleError } = await supabase
        .from('optimisation_task_cycles')
        .select('id, objective, objective_status, objective_progress')
        .eq('id', task.active_cycle_id)
        .single();

      if (!cycleError && cycle && cycle.objective) {
        // Fetch baseline and latest measurements for this cycle
        const { data: measurements } = await supabase
          .from('optimisation_task_events')
          .select('metrics, created_at')
          .eq('task_id', id)
          .or(`cycle_id.eq.${task.active_cycle_id},cycle_number.eq.${cycleNo}`)
          .not('metrics', 'is', null)
          .order('created_at', { ascending: true });

        let baselineMeasurement = null;
        let latestMeasurement = null;

        if (measurements && measurements.length > 0) {
          // Baseline = earliest measurement
          baselineMeasurement = measurements[0].metrics;
          // Latest = most recent measurement (should be the one we just created)
          latestMeasurement = measurements[measurements.length - 1].metrics;
        }

        // Evaluate objective
        try {
          const evaluation = evaluateObjective(
            cycle.objective,
            baselineMeasurement,
            latestMeasurement,
            new Date()
          );

          // Update cycle with status and progress
          const { error: updateError } = await supabase
            .from('optimisation_task_cycles')
            .update({
              objective_status: evaluation.status,
              objective_progress: evaluation.progress,
              objective_updated_at: new Date().toISOString()
            })
            .eq('id', task.active_cycle_id);

          if (updateError) {
            console.error('[Optimisation Measurement] Cycle update error:', updateError);
            // Don't fail, just log
          }
        } catch (evalError) {
          console.error('[Optimisation Measurement] Objective evaluation error:', evalError);
          // Don't fail, just log
        }
      }
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

    // Also fetch updated cycle with objective_status and objective_progress
    let updatedCycle = null;
    if (task.active_cycle_id) {
      const { data: cycle } = await supabase
        .from('optimisation_task_cycles')
        .select('id, objective, objective_status, objective_progress, due_at')
        .eq('id', task.active_cycle_id)
        .single();
      updatedCycle = cycle;
    }

    return sendJSON(res, 201, { 
      event, 
      task: updatedTask,
      cycle: updatedCycle
    });
  } catch (error) {
    console.error('[Optimisation Measurement] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}


