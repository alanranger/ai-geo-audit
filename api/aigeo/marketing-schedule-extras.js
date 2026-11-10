/**
 * GET /api/aigeo/marketing-schedule-extras (x-arp-admin-key). Read-only extras for the Marketing schedule
 * (lib/marketing-schedule.js); nothing is written:
 *  - moments: fixed selling moments (public.marketing_selling_moments, active rows) for "Selling this week";
 *  - drafts: campaign records with a Squarespace draft (sqs_draft_id), with the proposed send time GPT stored in
 *    stage_history and the draft asset note (strategy_content_assets.used_in = send|<campaign_key>) as the brief;
 *  - promotions: Light & Logic edition promotion modules inside an email (content assets whose used_in links the
 *    newsletter, the email's send|<campaign_key> and the edition row delivery|gpt-ll-newsletter-<day>). The module
 *    rides on that email's own sends (budgeted once there); the newsletter itself never uses Squarespace credits.
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

export const NEWSLETTER_REF = 'newsletter|light-and-logic';
const refOf = (list, prefix) => (list || []).find((u) => String(u).startsWith(prefix))?.slice(prefix.length) || null;
/**
 * The module record is evidence only until the email is edited in Squarespace after it was recorded (the collector reads
 * the draft's modified time, not its content): then `confirmed: false` and the views stop presenting it as in the email.
 */
function confirmedAt(recordedAt, editedAt) {
  if (!editedAt || !recordedAt) return true;
  return Date.parse(editedAt) <= Date.parse(recordedAt);
}
/** assets → [{ asset_key, campaign_key, edition_step_key, edition_day, stage, planned_send_on, status, note, recorded_at, provider_edited_at, confirmed }]. */
export function promotionsOf(assets, campaigns, edits = new Map()) {
  const camp = new Map((campaigns || []).map((c) => [c.campaign_key, c]));
  return (assets || []).filter((a) => (a.used_in || []).includes(NEWSLETTER_REF)).map((a) => {
    const campaignKey = refOf(a.used_in, 'send|');
    const edition = refOf(a.used_in, 'delivery|');
    const c = camp.get(campaignKey) || {};
    const editedAt = edits.get(c.sqs_draft_id) || null;
    return { asset_key: a.asset_key, title: a.title, status: a.status, note: a.note || null, campaign_key: campaignKey, edition_step_key: edition, edition_day: (String(edition || '').match(/\d{4}-\d{2}-\d{2}$/) || [null])[0], stage: c.stage || null, planned_send_on: c.planned_send_on || null, recorded_at: a.set_at || null, provider_edited_at: editedAt, confirmed: confirmedAt(a.set_at, editedAt) };
  }).filter((p) => p.campaign_key && p.edition_step_key);
}
/** email id → the latest Squarespace edit time the collector read (Drafts list modified time; kept once scheduled). */
async function providerEdits(sb, camps) {
  const ids = (camps || []).map((c) => c.sqs_draft_id).filter(Boolean);
  if (!ids.length) return new Map();
  const { data, error } = await sb.from('sqs_draft_emails').select('email_id, modified_on').in('email_id', ids);
  if (error) throw new Error(error.message);
  return new Map((data || []).filter((r) => r.modified_on).map((r) => [r.email_id, r.modified_on]));
}
async function loadPromotions(sb, propertyUrl) {
  const { data, error } = await sb.from('strategy_content_assets').select('asset_key, title, status, used_in, note, set_at').eq('property_url', propertyUrl).contains('used_in', [NEWSLETTER_REF]).limit(100);
  if (error) throw new Error(error.message);
  const keys = [...new Set((data || []).map((a) => refOf(a.used_in, 'send|')).filter(Boolean))];
  const camps = keys.length ? await sb.from('strategy_campaigns').select('campaign_key, stage, planned_send_on, sqs_draft_id').eq('property_url', propertyUrl).in('campaign_key', keys) : { data: [] };
  if (camps.error) throw new Error(camps.error.message);
  return promotionsOf(data, camps.data, await providerEdits(sb, camps.data));
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
    const [moments, drafts, gbp, promotions] = await Promise.all([loadMoments(sb, propertyUrl), loadDrafts(sb, propertyUrl), sb.from('gbp_performance_monthly').select('fetched_at').order('fetched_at', { ascending: false }).limit(1).maybeSingle(), loadPromotions(sb, propertyUrl)]);
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { ok: true, moments, drafts, promotions, gbp_stats_fetched_at: gbp?.data?.fetched_at || null });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
