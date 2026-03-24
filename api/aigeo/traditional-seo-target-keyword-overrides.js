export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

async function handleGet(req, res, supabase) {
  const propertyUrl = String(req.query.propertyUrl || '').trim();
  let query = supabase.from('traditional_seo_target_keyword_overrides').select('*').order('updated_at', { ascending: false });
  if (propertyUrl) query = query.eq('property_url', propertyUrl);
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, {
    status: 'ok',
    overrides: Array.isArray(data) ? data : [],
    meta: { generatedAt: new Date().toISOString() }
  });
}

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const propertyUrl = String(body?.propertyUrl || '').trim();
  const pageUrl = String(body?.pageUrl || '').trim();
  const targetKeyword = String(body?.targetKeyword ?? '').trim();
  if (!pageUrl) {
    return sendJson(res, 400, { status: 'error', message: 'pageUrl is required.' });
  }

  if (!targetKeyword) {
    const del = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .delete()
      .eq('property_url', propertyUrl)
      .eq('page_url', pageUrl);
    if (del.error) throw del.error;
  } else {
    const now = new Date().toISOString();
    const upsert = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .upsert(
        {
          property_url: propertyUrl,
          page_url: pageUrl,
          target_keyword: targetKeyword,
          updated_at: now
        },
        { onConflict: 'property_url,page_url' }
      )
      .select('*');
    if (upsert.error) throw upsert.error;
  }

  let query = supabase.from('traditional_seo_target_keyword_overrides').select('*').order('updated_at', { ascending: false });
  if (propertyUrl) query = query.eq('property_url', propertyUrl);
  const { data, error } = await query;
  if (error) throw error;
  return sendJson(res, 200, {
    status: 'ok',
    overrides: Array.isArray(data) ? data : [],
    meta: { generatedAt: new Date().toISOString() }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed.' });
  }
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') return await handleGet(req, res, supabase);
    return await handlePost(req, res, supabase);
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        overrides: [],
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'traditional_seo_target_keyword_overrides table missing — run sql/20260323_traditional_seo_target_keyword_overrides.sql'
        }
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg, meta: { generatedAt: new Date().toISOString() } });
  }
}
