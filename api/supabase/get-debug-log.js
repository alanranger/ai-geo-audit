// /api/supabase/get-debug-log.js
// Fetch debug log from Supabase audit_debug_logs table

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
  res.status(status).send(JSON.stringify(obj, null, 2));
};

export default async function handler(req, res) {
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
    const { propertyUrl, auditDate } = req.query;

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Build query
    let query = supabase
      .from('audit_debug_logs')
      .select('*')
      .order('updated_at', { ascending: false });

    if (propertyUrl) {
      query = query.eq('property_url', propertyUrl);
    }
    if (auditDate) {
      query = query.eq('audit_date', auditDate);
    }

    // Get latest log (or specific date if provided)
    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      if (error.message && error.message.includes('does not exist')) {
        return sendJSON(res, 200, {
          error: 'Table does not exist',
          message: 'audit_debug_logs table not found. Migration may not be applied.',
          suggestion: 'Debug logs will be saved once the table is created.'
        });
      }
      return sendJSON(res, 500, { error: error.message });
    }

    if (!data) {
      return sendJSON(res, 200, {
        message: 'No debug log found',
        propertyUrl: propertyUrl || 'any',
        auditDate: auditDate || 'latest'
      });
    }

    return sendJSON(res, 200, {
      propertyUrl: data.property_url,
      auditDate: data.audit_date,
      filename: data.filename,
      entriesCount: data.entries_count,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      logText: data.log_text
    });

  } catch (err) {
    console.error('[Get Debug Log] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

