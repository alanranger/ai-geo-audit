// /api/supabase/query-debug-logs.js
// Query debug logs from Supabase with filtering and search
// Allows searching and inspecting logs without copy-paste

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  try {
    const { 
      propertyUrl, 
      type, 
      search, 
      sessionId,
      limit = 100,
      offset = 0,
      startDate,
      endDate
    } = req.query;

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Build query
    let query = supabase
      .from('debug_logs')
      .select('*', { count: 'exact' })
      .order('timestamp', { ascending: false });

    // Apply filters
    if (propertyUrl) {
      query = query.eq('property_url', propertyUrl);
    }
    
    if (type && ['info', 'warn', 'error', 'success'].includes(type)) {
      query = query.eq('type', type);
    }
    
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }
    
    if (search) {
      // Use full-text search on message field
      query = query.textSearch('message', search, {
        type: 'websearch',
        config: 'english'
      });
    }
    
    if (startDate) {
      query = query.gte('timestamp', startDate);
    }
    
    if (endDate) {
      query = query.lte('timestamp', endDate);
    }

    // Apply pagination
    const limitNum = Math.min(parseInt(limit) || 100, 1000); // Max 1000
    const offsetNum = parseInt(offset) || 0;
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      if (error.message && error.message.includes('does not exist')) {
        return sendJSON(res, 200, {
          logs: [],
          total: 0,
          message: 'Table does not exist',
          suggestion: 'Run migration 20250117_create_debug_logs_table.sql'
        });
      }
      console.error('[query-debug-logs] Supabase error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, {
      logs: data || [],
      total: count || 0,
      limit: limitNum,
      offset: offsetNum
    });

  } catch (err) {
    console.error('[query-debug-logs] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}
