// /api/supabase/delete-audit-result.js
// Admin-only: delete a single audit_results row for a given (propertyUrl, auditDate).

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/api/requireAdmin.js';
import { normalizePropertyUrl } from '../aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { status: 'error', error: 'Method not allowed. Expected POST.' });
  }

  if (!requireAdmin(req, res, sendJSON)) return;

  try {
    const { propertyUrl, auditDate } = req.body || {};
    if (!propertyUrl || !auditDate) {
      return sendJSON(res, 400, { status: 'error', error: 'Missing required fields: propertyUrl, auditDate' });
    }

    const siteUrl = normalizePropertyUrl(String(propertyUrl));
    const dateStr = String(auditDate).split('T')[0];

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    // Delete exactly the row for this audit date.
    const { data, error, count } = await supabase
      .from('audit_results')
      .delete({ count: 'exact' })
      .eq('property_url', siteUrl)
      .eq('audit_date', dateStr)
      .select('id,audit_date,is_partial,schema_total_pages');

    if (error) {
      return sendJSON(res, 500, { status: 'error', error: error.message });
    }

    return sendJSON(res, 200, {
      status: 'ok',
      deletedCount: count ?? (Array.isArray(data) ? data.length : 0),
      deleted: data || [],
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJSON(res, 500, {
      status: 'error',
      error: e?.message || String(e),
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


