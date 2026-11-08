/**
 * GET /api/aigeo/marketing-schedule-extras (x-arp-admin-key). Read-only extras for the Marketing schedule
 * (lib/marketing-schedule.js); nothing is written:
 *  - moments: fixed selling moments (public.marketing_selling_moments, active rows) for "Selling this week";
 *  - drafts: campaign records with a Squarespace draft (sqs_draft_id), with the proposed send time GPT stored in
 *    stage_history and the draft asset note (strategy_content_assets.used_in = send|<campaign_key>) as the brief.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const PROP = 'https://www.alanranger.com';
const send = (res, status, body) => res.status(status).json(body);

/** The latest stage_history entry that carries a proposed time / draft id / cohort. */
function proposedOf(history) {
  const list = Array.isArray(history) ? history : [];
  const hit = [...list].reverse().find((h) => h && (h.proposed_send_at || h.provider_draft_id)) || {};
  return { proposed_send_at: hit.proposed_send_at || null, cohort: hit.cohort || null, gate: hit.gate || null, optional: !!hit.optional };
}

async function loadDrafts(sb, propertyUrl) {
  const { data, error } = await sb.from('strategy_campaigns').select('campaign_key, title, stage, planned_send_on, sqs_draft_id, stage_history')
    .eq('property_url', propertyUrl).not('sqs_draft_id', 'is', null).neq('stage', 'cancelled').limit(200);
  if (error) throw new Error(error.message);
  const keys = (data || []).map((r) => `send|${r.campaign_key}`);
  const assets = keys.length ? await sb.from('strategy_content_assets').select('asset_key, title, status, used_in, note').eq('property_url', propertyUrl).overlaps('used_in', keys).limit(500) : { data: [] };
  if (assets.error) throw new Error(assets.error.message);
  return (data || []).map((r) => {
    const notes = (assets.data || []).filter((a) => (a.used_in || []).includes(`send|${r.campaign_key}`)).map((a) => a.note).filter(Boolean);
    return { campaign_key: r.campaign_key, stage: r.stage, planned_send_on: r.planned_send_on, sqs_draft_id: r.sqs_draft_id, brief: notes.join(' · ') || null, ...proposedOf(r.stage_history) };
  });
}

async function loadMoments(sb, propertyUrl) {
  const { data, error } = await sb.from('marketing_selling_moments').select('moment_key, label, starts_on, ends_on, kind, priority, note')
    .eq('property_url', propertyUrl).eq('active', true).order('starts_on').limit(500);
  if (error) throw new Error(error.message);
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  if (!url || !key) return send(res, 500, { ok: false, error: 'Missing Supabase credentials' });
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const propertyUrl = String(req.query.propertyUrl || PROP);
    const [moments, drafts] = await Promise.all([loadMoments(sb, propertyUrl), loadDrafts(sb, propertyUrl)]);
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { ok: true, moments, drafts });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
