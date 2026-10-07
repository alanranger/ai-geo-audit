// GET/PATCH /api/aigeo/strategy-actions
import { createClient } from '@supabase/supabase-js';
import { ensureStrategyActions } from '../../lib/strategy-action-seed.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function client() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }
  const supabase = client();
  const propertyUrl = String(req.query.propertyUrl || req.body?.propertyUrl || DEFAULT_PROPERTY);

  try {
    if (req.method === 'GET') {
      await ensureStrategyActions(supabase, propertyUrl);
      const { data, error } = await supabase
        .from('strategy_quarter_actions')
        .select('*')
        .eq('property_url', propertyUrl)
        .order('quarter_key')
        .order('sort_order');
      if (error) throw error;
      return res.status(200).json({ ok: true, actions: data || [] });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const id = Number(body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const patch = { updated_at: new Date().toISOString() };
      if (typeof body.is_ticked === 'boolean') {
        patch.is_ticked = body.is_ticked;
        patch.ticked_at = body.is_ticked ? new Date().toISOString() : null;
      }
      if (body.due_week_start) patch.due_week_start = String(body.due_week_start).slice(0, 10);
      if (body.label != null && String(body.label).trim()) patch.label = String(body.label).trim();
      const { data, error } = await supabase
        .from('strategy_quarter_actions')
        .update(patch)
        .eq('id', id)
        .eq('property_url', propertyUrl)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'action not found' });
      return res.status(200).json({ ok: true, action: data });
    }

    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
