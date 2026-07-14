/**
 * Begin a full keyword audit day: DELETE all keyword_rankings for the date
 * so the subsequent upserts REPLACE the day instead of silting onto it.
 *
 * POST /api/supabase/begin-keyword-audit-day
 * Body: { auditDate: 'YYYY-MM-DD', propertyUrl: string }
 */

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const auditDate = String(body.auditDate || '').trim();
    const propertyUrl = String(body.propertyUrl || '').trim().replace(/\/+$/, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDate) || !propertyUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'auditDate (YYYY-MM-DD) and propertyUrl are required',
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
    }

    const url = `${supabaseUrl}/rest/v1/keyword_rankings?audit_date=eq.${encodeURIComponent(auditDate)}&property_url=eq.${encodeURIComponent(propertyUrl)}`;
    const del = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=representation',
      },
    });
    if (!del.ok) {
      const text = await del.text();
      return res.status(del.status).json({ status: 'error', message: text.slice(0, 300) });
    }
    const deleted = await del.json();
    const deletedCount = Array.isArray(deleted) ? deleted.length : 0;
    return res.status(200).json({
      status: 'ok',
      auditDate,
      propertyUrl,
      deleted: deletedCount,
      mode: 'delete_then_write',
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch (e) {
    return res.status(500).json({ status: 'error', message: e.message || 'Internal error' });
  }
}
