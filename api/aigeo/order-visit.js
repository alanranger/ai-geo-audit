/**
 * Confirmation-page capture. Order number plus the stored first touch.
 * No name, email, or address.
 */
import { createClient } from '@supabase/supabase-js';

const ALLOWED = ['https://www.alanranger.com', 'https://alanranger.com'];

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(status).json(body);
}

function allowedOrigin(req) {
  const origin = String(req.headers.origin || req.headers.referer || '');
  return ALLOWED.some((host) => origin === host || origin.startsWith(`${host}/`));
}

function clean(value, max) {
  const text = String(value || '').trim().slice(0, max);
  return text || null;
}

function bodyOf(req) {
  try {
    if (!req.body) return {};
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (err) {
    return {};
  }
}

function when(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text : null;
}

function orderKey(value) {
  const raw = String(value || '').trim();
  if (!/^\d{1,6}$/.test(raw)) return null;
  return String(parseInt(raw, 10));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { ok: false });
  if (!allowedOrigin(req)) return send(res, 403, { ok: false });
  const body = bodyOf(req);
  const orderNumber = orderKey(body.order_number);
  const source = clean(body.utm_source, 64);
  if (!orderNumber || source !== 'chatgpt') return send(res, 200, { ok: false });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  const { error } = await sb.from('order_visit_attribution').upsert({
    order_number: orderNumber,
    signup_source: clean(body.signup_source, 64),
    utm_source: source,
    utm_medium: clean(body.utm_medium, 64),
    utm_campaign: clean(body.utm_campaign, 128),
    utm_content: clean(body.utm_content, 128),
    landing_path: clean(body.landing_path, 200),
    captured_at: when(body.captured_at)
  }, { onConflict: 'order_number', ignoreDuplicates: true });
  if (error) return send(res, 200, { ok: false });
  return send(res, 200, { ok: true });
}
