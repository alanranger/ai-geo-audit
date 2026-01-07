// /api/supabase/save-debug-log-entry.js
// Save a single debug log entry to Supabase
// Called automatically by debugLog() function in audit-dashboard.html

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed. Use POST.' });
  }

  try {
    const { timestamp, message, type, propertyUrl, sessionId, userAgent } = req.body;

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return sendJSON(res, 400, { error: 'message is required and must be a string' });
    }

    if (!type || !['info', 'warn', 'error', 'success'].includes(type)) {
      return sendJSON(res, 400, { error: 'type must be one of: info, warn, error, success' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Insert log entry - try with all fields first
    let insertData = {
      timestamp: timestamp || new Date().toISOString(),
      message: message.substring(0, 10000), // Limit message length to 10KB
      type: type
    };
    
    // Add optional fields if they exist (handle schema cache issues gracefully)
    if (propertyUrl) insertData.property_url = propertyUrl;
    if (sessionId) insertData.session_id = sessionId;
    if (userAgent) insertData.user_agent = userAgent;
    
    let { data, error } = await supabase
      .from('debug_logs')
      .insert(insertData)
      .select()
      .single();

    // If property_url column error (schema cache issue), retry without optional fields
    if (error && error.message && error.message.includes('property_url')) {
      console.warn('[save-debug-log-entry] Schema cache issue with property_url, retrying without optional fields');
      const { data: retryData, error: retryError } = await supabase
        .from('debug_logs')
        .insert({
          timestamp: timestamp || new Date().toISOString(),
          message: message.substring(0, 10000),
          type: type
        })
        .select()
        .single();
      
      if (retryError) {
        console.error('[save-debug-log-entry] Retry also failed:', retryError);
        return sendJSON(res, 500, { error: retryError.message });
      }
      
      data = retryData;
      error = null;
    }

    if (error) {
      // If table doesn't exist, return a helpful error (don't crash)
      if (error.message && error.message.includes('does not exist')) {
        console.warn('[save-debug-log-entry] Table debug_logs does not exist. Run migration first.');
        return sendJSON(res, 200, {
          saved: false,
          error: 'Table does not exist',
          message: 'debug_logs table not found. Migration may not be applied.',
          suggestion: 'Run migration 20250117_create_debug_logs_table.sql'
        });
      }
      console.error('[save-debug-log-entry] Supabase error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, {
      saved: true,
      id: data.id,
      timestamp: data.timestamp
    });

  } catch (err) {
    console.error('[save-debug-log-entry] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}
