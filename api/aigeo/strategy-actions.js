// GET/PATCH /api/aigeo/strategy-actions
// Actions with an evidence rule (lib/strategy-action-evidence.mjs) tick themselves from the collected send evidence:
// GET brings their is_ticked / ticked_at in line, PATCH refuses a manual tick on them (409). Other actions tick by hand.
import { createClient } from '@supabase/supabase-js';
import { ensureStrategyActions } from '../../lib/strategy-action-seed.mjs';
import { evidenceRuleFor, loadActionsWithEvidence } from '../../lib/strategy-action-evidence.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function client() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** The refusal message for a manual tick on an evidence-ruled action, or null when a manual tick is allowed. */
export function manualTickRefusal(action) {
  const rule = evidenceRuleFor(action);
  return rule ? `"${action.label}" ticks itself from evidence (${rule.label}); manual ticks are only for actions the dashboard cannot see` : null;
}

export function actionPatch(body, now) {
  const patch = { updated_at: now };
  if (typeof body.is_ticked === 'boolean') {
    patch.is_ticked = body.is_ticked;
    patch.ticked_at = body.is_ticked ? now : null;
  }
  if (body.due_week_start) patch.due_week_start = String(body.due_week_start).slice(0, 10);
  if (body.label != null && String(body.label).trim()) patch.label = String(body.label).trim();
  return patch;
}

async function patchAction(supabase, propertyUrl, body, res) {
  const id = Number(body.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const { data: row, error: e1 } = await supabase.from('strategy_quarter_actions').select('action_key, label').eq('id', id).eq('property_url', propertyUrl).maybeSingle();
  if (e1) throw e1;
  if (!row) return res.status(404).json({ error: 'action not found' });
  const refusal = typeof body.is_ticked === 'boolean' ? manualTickRefusal(row) : null;
  if (refusal) return res.status(409).json({ ok: false, error: refusal });
  const { data, error } = await supabase.from('strategy_quarter_actions').update(actionPatch(body, new Date().toISOString()))
    .eq('id', id).eq('property_url', propertyUrl).select('*').maybeSingle();
  if (error) throw error;
  return res.status(200).json({ ok: true, action: data });
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
      return res.status(200).json({ ok: true, actions: await loadActionsWithEvidence(supabase, propertyUrl) });
    }
    if (req.method === 'PATCH') return await patchAction(supabase, propertyUrl, req.body || {}, res);
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
