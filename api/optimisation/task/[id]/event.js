// /api/optimisation/task/[id]/event.js
// Add an event to a task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../lib/api/requireAdminOrShare.js';

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

    const { event_type, note, gsc_clicks, gsc_impressions, gsc_ctr, gsc_avg_position } = req.body;

    if (!event_type) {
      return sendJSON(res, 400, { error: 'event_type required' });
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

    // Verify task ownership and get active cycle
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('owner_user_id, cycle_active, active_cycle_id')
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

    // Insert event
    const eventData = {
      task_id: id,
      event_type,
      note: note || null,
      cycle_id: task.active_cycle_id || null,
      cycle_number: cycleNo,
      owner_user_id: userId,
      gsc_clicks: gsc_clicks || null,
      gsc_impressions: gsc_impressions || null,
      gsc_ctr: gsc_ctr || null,
      gsc_avg_position: gsc_avg_position || null
    };

    const { data: event, error } = await supabase
      .from('optimisation_task_events')
      .insert(eventData)
      .select()
      .single();

    if (error) {
      console.error('[Optimisation Event] Insert error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { event });
  } catch (error) {
    console.error('[Optimisation Event] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

