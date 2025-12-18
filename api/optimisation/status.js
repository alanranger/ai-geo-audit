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
    let query = supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .in('keyword_key', keyword_keys);

    if (url_keys.length > 0) {
      query = query.in('target_url_clean', url_keys);
    }

    if (userId) {
      query = query.eq('owner_user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Optimisation Status] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { statuses: data || [] });
  } catch (error) {
    console.error('[Optimisation Status] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
