// /api/portfolio/get-snapshots.js
// Fetch portfolio snapshots for Portfolio tab

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
      kpi,
      segment,
      scope = 'active_only',
      timeGrain = 'weekly'
    } = req.query;

    if (!kpi || !segment) {
      return sendJSON(res, 400, { error: 'Missing required parameters: kpi, segment' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Query snapshots
    let query = supabase
      .from('portfolio_snapshots_v2')
      .select('*')
      .eq('kpi', kpi)
      .eq('segment', segment)
      .eq('scope', scope)
      .order('created_at', { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error('[Portfolio Get Snapshots] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    // Bucket by time grain
    const bucketed = {};
    data.forEach(snapshot => {
      const date = new Date(snapshot.created_at);
      let bucketKey;
      
      if (timeGrain === 'weekly') {
        // ISO week (Monday start)
        const dayOfWeek = date.getDay();
        const diff = date.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust to Monday
        const monday = new Date(date.setDate(diff));
        bucketKey = monday.toISOString().split('T')[0];
      } else {
        // Monthly
        bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      }
      
      // Keep the latest snapshot per bucket
      if (!bucketed[bucketKey] || new Date(snapshot.created_at) > new Date(bucketed[bucketKey].created_at)) {
        bucketed[bucketKey] = snapshot;
      }
    });

    // Convert to array sorted by date
    const result = Object.values(bucketed)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    return sendJSON(res, 200, { 
      snapshots: result,
      count: result.length,
      timeGrain
    });

  } catch (err) {
    console.error('[Portfolio Get Snapshots] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}


