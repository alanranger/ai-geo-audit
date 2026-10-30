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

/** Persist page_url on the property host (keep www). Matching still tolerates apex elsewhere. */
function canonicalizeOverridePageUrl(pageUrl, propertyUrl) {
  const raw = String(pageUrl || '').trim();
  const prop = String(propertyUrl || '').trim();
  if (!raw) return '';
  try {
    const page = new URL(raw);
    const cleanPath = String(page.pathname || '/').replace(/\/+$/, '') || '/';
    if (prop) {
      const base = new URL(/^https?:\/\//i.test(prop) ? prop : `https://${prop}`);
      return `${base.protocol}//${base.host}${cleanPath}`;
    }
    return `${page.protocol}//${page.host}${cleanPath}`;
  } catch {
    return raw;
  }
}

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const propertyUrl = String(body?.propertyUrl || '').trim();
  const pageUrl = canonicalizeOverridePageUrl(body?.pageUrl, propertyUrl);
  const targetKeyword = String(body?.targetKeyword ?? '').trim();
  const targetClass = body?.targetClass != null ? String(body.targetClass).trim() : null;
  const notes = body?.notes != null ? String(body.notes) : null;
  if (!pageUrl) {
    return sendJson(res, 400, { status: 'error', message: 'pageUrl is required.' });
  }

  // Also consider legacy apex twin (www stripped) so Save keyword doesn't fork rows.
  let apexTwin = '';
  try {
    const u = new URL(pageUrl);
    const host = u.hostname.replace(/^www\./i, '');
    if (host && u.hostname.toLowerCase().startsWith('www.')) {
      apexTwin = `${u.protocol}//${host}${u.pathname}`;
    }
  } catch { /* ignore */ }

  // Empty keyword with no class → delete (legacy clear). With class → upsert cleared row.
  if (!targetKeyword && !targetClass) {
    const del = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .delete()
      .eq('property_url', propertyUrl)
      .in('page_url', apexTwin ? [pageUrl, apexTwin] : [pageUrl]);
    if (del.error) throw del.error;
  } else {
    // SAFETY: modal "Save keyword" only sends targetKeyword. Preserve curated
    // target_class + notes on update. New rows get a safe default class.
    const { data: existingRows, error: existingErr } = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .select('page_url, target_class, notes')
      .eq('property_url', propertyUrl)
      .in('page_url', apexTwin ? [pageUrl, apexTwin] : [pageUrl])
      .limit(2);
    if (existingErr) throw existingErr;
    const list = Array.isArray(existingRows) ? existingRows : [];
    const existing = list.find((r) => r.page_url === pageUrl) || list[0] || null;

    let nextClass = targetClass || existing?.target_class || null;
    if (!nextClass && targetKeyword) {
      // New modal-created row: never legacy_unreviewed. Prefer tracked when body hints LOCKED.
      const lockedHint = body?.trackedIn151 === true || body?.inLocked151 === true;
      nextClass = lockedHint ? 'tracked' : 'longtail_by_design';
    }
    const nextNotes = notes != null ? notes : (existing?.notes ?? '');

    const now = new Date().toISOString();
    const row = {
      property_url: propertyUrl,
      page_url: pageUrl,
      target_keyword: targetKeyword,
      target_class: nextClass,
      notes: nextNotes,
      updated_at: now
    };
    const upsert = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .upsert(row, { onConflict: 'property_url,page_url' })
      .select('*');
    if (upsert.error) throw upsert.error;
    // Drop legacy non-www twin so inventory + overrides stay on www.
    if (apexTwin && apexTwin !== pageUrl) {
      await supabase
        .from('traditional_seo_target_keyword_overrides')
        .delete()
        .eq('property_url', propertyUrl)
        .eq('page_url', apexTwin);
    }
  }

  let query = supabase.from('traditional_seo_target_keyword_overrides').select('*').order('updated_at', { ascending: false });
  if (propertyUrl) query = query.eq('property_url', propertyUrl);
  const { data, error } = await query;
  if (error) throw error;

  let csv09 = null;
  try {
    const { buildCsv09Body, loadLocked } = await import('../../lib/configIntegrity/checks.mjs');
    const { commitCsv09 } = await import('../../lib/commit-09-csv.mjs');
    const { runIntegrityCheck } = await import('../../lib/configIntegrity/runIntegrityCheck.mjs');
    const csv = buildCsv09Body(data || [], loadLocked());
    csv09 = await commitCsv09(csv, 'chore(seo): save 09-url-target-keywords.csv after keyword override');
    await runIntegrityCheck({ persist: true, csv09Disk: csv, runSource: 'override-09-commit' });
  } catch (err) {
    csv09 = { error: String(err?.message || err) };
  }

  return sendJson(res, 200, {
    status: 'ok',
    overrides: Array.isArray(data) ? data : [],
    meta: {
      generatedAt: new Date().toISOString(),
      csv09,
      csvExportReminder:
        '09 CSV saves itself when you change a keyword. Export 09 keywords is the catch-up button if health still says out of sync.'
    }
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
