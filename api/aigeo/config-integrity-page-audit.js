/**
 * On-demand page audit for cannibalisation rows:
 * - fetch "from" page HTML → exact-path link + keyword-in-anchor?
 * - HEAD/GET "to" page → existence / final path
 * Caches results in public.config_integrity_page_audit.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import {
  normalizePath,
  scanPageForLink,
  linkStatusFromScan,
  toAbsoluteUrl
} from '../../lib/configIntegrity/pageLinkAudit.mjs';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapPool(items, concurrency, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'AlanRangerSEO-PageAudit/1.0 (+https://www.alanranger.com)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    const finalUrl = resp.url || url;
    const status = resp.status;
    const text = status >= 200 && status < 400 ? await resp.text() : '';
    // Cap body for safety
    const html = text.length > 1_500_000 ? text.slice(0, 1_500_000) : text;
    return { ok: resp.ok, status, finalUrl, html, error: null };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, html: '', error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

async function ensureTable(sb) {
  // Soft probe — if missing, caller returns clear error
  const { error } = await sb.from('config_integrity_page_audit').select('finding_key').limit(1);
  if (error && /does not exist|schema cache/i.test(error.message || '')) {
    const e = new Error('missing_table:config_integrity_page_audit');
    e.code = 'MISSING_TABLE';
    throw e;
  }
  if (error) throw error;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  try {
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false }
    });
    const propertyUrl = String(
      req.query?.propertyUrl || req.body?.propertyUrl || 'https://www.alanranger.com'
    ).trim();

    if (req.method === 'GET') {
      await ensureTable(sb);
      const keys = String(req.query?.keys || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      let q = sb
        .from('config_integrity_page_audit')
        .select('*')
        .eq('property_url', propertyUrl)
        .order('checked_at', { ascending: false });
      if (keys.length) q = q.in('finding_key', keys.slice(0, 200));
      else q = q.limit(500);
      const { data, error } = await q;
      if (error) throw error;
      return sendJson(res, 200, {
        status: 'ok',
        results: data || [],
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
    }

    await ensureTable(sb);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return sendJson(res, 400, { status: 'error', message: 'items[] required (findingKey, keyword, fromPath, toPath).' });
    }
    if (items.length > 80) {
      return sendJson(res, 400, { status: 'error', message: 'Max 80 items per request.' });
    }

    const started = Date.now();
    // Prefetch unique from/to URLs once
    const fromUrls = new Map(); // path -> absolute
    const toUrls = new Map();
    for (const it of items) {
      const fromP = normalizePath(it.fromPath || it.preferred_path || '');
      const toP = normalizePath(it.toPath || it.assigned_path || '');
      if (fromP) fromUrls.set(fromP, toAbsoluteUrl(fromP));
      if (toP) toUrls.set(toP, toAbsoluteUrl(toP));
    }

    const htmlByPath = new Map();
    const toMetaByPath = new Map();

    await mapPool([...fromUrls.entries()], 4, async ([path, url]) => {
      const r = await fetchHtml(url);
      htmlByPath.set(path, r);
      await sleep(120);
    });

    await mapPool([...toUrls.entries()], 4, async ([path, url]) => {
      const r = await fetchHtml(url);
      const finalPath = normalizePath(r.finalUrl || url);
      toMetaByPath.set(path, {
        ok: r.ok && r.status >= 200 && r.status < 400,
        status: r.status,
        finalPath,
        matchesLocked: finalPath === path,
        error: r.error
      });
      await sleep(80);
    });

    const checkedAt = new Date().toISOString();
    const rows = [];
    for (const it of items) {
      const findingKey = String(it.findingKey || it.finding_key || '').trim();
      const keyword = String(it.keyword || it.subject || '').trim();
      const fromPath = normalizePath(it.fromPath || it.preferred_path || '');
      const toPath = normalizePath(it.toPath || it.assigned_path || '');
      if (!findingKey || !fromPath || !toPath) continue;

      const fromFetch = htmlByPath.get(fromPath) || { ok: false, html: '', status: 0, error: 'not_fetched' };
      const scan = fromFetch.html
        ? scanPageForLink(fromFetch.html, toPath, keyword)
        : { linkPresent: false, strongAnchor: false, sampleHref: '', sampleAnchor: '' };
      const linkStatus = fromFetch.error && !fromFetch.html ? 'error' : linkStatusFromScan(scan);
      const target = toMetaByPath.get(toPath) || {
        ok: false,
        status: 0,
        finalPath: '',
        matchesLocked: false,
        error: 'not_fetched'
      };

      const row = {
        finding_key: findingKey,
        property_url: propertyUrl,
        keyword,
        from_path: fromPath,
        to_path: toPath,
        link_status: linkStatus,
        sample_href: scan.sampleHref || null,
        sample_anchor: scan.sampleAnchor || null,
        from_http_status: fromFetch.status || null,
        from_fetch_error: fromFetch.error || null,
        target_ok: Boolean(target.ok && target.matchesLocked),
        target_http_status: target.status || null,
        target_final_path: target.finalPath || null,
        target_matches_locked: Boolean(target.matchesLocked),
        anchor_text: keyword,
        link_to_url: toAbsoluteUrl(toPath),
        checked_at: checkedAt,
        detail: {
          linkPresent: scan.linkPresent,
          strongAnchor: scan.strongAnchor,
          targetError: target.error || null
        }
      };
      rows.push(row);
    }

    if (rows.length) {
      const { error } = await sb.from('config_integrity_page_audit').upsert(rows, {
        onConflict: 'finding_key'
      });
      if (error) throw error;
    }

    return sendJson(res, 200, {
      status: 'ok',
      results: rows,
      meta: {
        generatedAt: checkedAt,
        durationMs: Date.now() - started,
        uniqueFromPages: fromUrls.size,
        uniqueToPages: toUrls.size,
        findings: rows.length,
        matchRule:
          'href path equals should-be path (ignore host/slash) AND anchor text contains keyword (normalized). Path-only = weak; none = Fix needed.'
      }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('missing_env:')) {
      return sendJson(res, 500, { status: 'error', message: 'Supabase env not configured.' });
    }
    if (msg.includes('missing_table') || err?.code === 'MISSING_TABLE') {
      return sendJson(res, 500, {
        status: 'error',
        message:
          'Apply DB table config_integrity_page_audit first (Cursor migration). Page audit cannot cache without it.'
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
