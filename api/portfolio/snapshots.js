// /api/portfolio/snapshots.js
// Fetch portfolio snapshot data for Portfolio tab

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
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: GET` });
  }

  try {
    const { 
      kpi = 'ctr_28d',
      segment = 'all',
      scope = 'all',
      timeGrain = 'weekly',
      startDate,
      endDate
    } = req.query;

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Build query
    let query = supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('kpi', kpi)
      .eq('segment', segment)
      .eq('scope', scope)
      .eq('period_type', timeGrain)
      .order('period_start', { ascending: true });

    // Apply date range if provided
    if (startDate) {
      query = query.gte('period_start', startDate);
    }
    if (endDate) {
      query = query.lte('period_start', endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Portfolio Snapshots] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    return sendJSON(res, 200, { 
      snapshots: data || [],
      count: data?.length || 0
    });

  } catch (err) {
    console.error('[Portfolio Snapshots] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

