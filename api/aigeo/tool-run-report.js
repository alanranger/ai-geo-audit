/**
 * POST /api/aigeo/tool-run-report — run summaries from Schema Tools, the chatbot
 * ingest screen and the shared-resources sync job (silent fault monitor D2/D3/D6).
 *
 * chat-ingest reports are verified here: every URL the screen counted as ingested
 * must have a page_entities row written since the run started, otherwise it is
 * recorded as failed (the ingest can return success without writing a row).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';
import { sendJson } from '../../lib/ceo-weekly/shared.js';

const TOOLS = new Set(['schema-tools', 'chat-ingest', 'shared-resources-sync']);
const MAX_LIST = 1000;
const VERIFY_SLACK_MS = 5 * 60000;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function str(v, n = 500) {
  return v == null ? null : String(v).slice(0, n);
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function failedList(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_LIST).map((f) => (
    typeof f === 'string' ? { url: str(f), reason: 'failed' } : { url: str(f?.url), reason: str(f?.reason, 300) || 'failed' }
  )).filter((f) => f.url);
}

function summaryJson(v) {
  if (!v || typeof v !== 'object') return {};
  const s = JSON.stringify(v);
  return s.length > 20000 ? { truncated: true } : v;
}

export function buildRow(body) {
  return {
    tool: body.tool,
    flow: str(body.flow, 60),
    run_id: str(body.run_id, 80),
    started_at: body.started_at && !Number.isNaN(Date.parse(body.started_at)) ? new Date(body.started_at).toISOString() : null,
    version: str(body.version, 80),
    state: str(body.state, 20),
    items_processed: int(body.items_processed),
    failed: failedList(body.failed),
    not_published: (Array.isArray(body.not_published) ? body.not_published : []).slice(0, MAX_LIST).map((s) => str(s, 300)),
    supabase_errors: int(body.supabase_errors),
    errors: int(body.errors),
    summary: summaryJson(body.summary)
  };
}

async function unwrittenUrls(sb, okUrls, startedAt) {
  const since = new Date(Date.parse(startedAt) - VERIFY_SLACK_MS).toISOString();
  const written = new Set();
  for (let i = 0; i < okUrls.length; i += 150) {
    const part = okUrls.slice(i, i + 150);
    const { data, error } = await sb.from('page_entities').select('page_url').in('page_url', part).gte('last_seen', since);
    if (error) throw new Error(`verify_read:${error.message}`);
    (data || []).forEach((r) => written.add(r.page_url));
  }
  return okUrls.filter((u) => !written.has(u));
}

async function verifyIngest(sb, row, body) {
  const okUrls = (Array.isArray(body.ok_urls) ? body.ok_urls : []).slice(0, 2000).map((u) => String(u));
  if (!okUrls.length || !row.started_at) return row;
  const missing = await unwrittenUrls(sb, okUrls, row.started_at);
  row.failed = [...row.failed, ...missing.map((url) => ({ url, reason: 'reported ingested but no page_entities row was written' }))];
  row.summary = { ...row.summary, ok_reported: okUrls.length, verified_written: okUrls.length - missing.length };
  return row;
}

async function pruneHeartbeats(sb) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  await sb.from('tool_run_reports').delete().eq('tool', 'shared-resources-sync').lt('run_at', cutoff);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!TOOLS.has(body.tool)) return sendJson(res, 400, { ok: false, error: 'unknown tool' });
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    let row = buildRow(body);
    if (row.tool === 'chat-ingest') row = await verifyIngest(sb, row, body);
    const { data, error } = await sb.from('tool_run_reports').insert(row).select('id, run_at').single();
    if (error) throw new Error(error.message);
    if (row.tool === 'shared-resources-sync') await pruneHeartbeats(sb);
    return sendJson(res, 200, { ok: true, id: data.id, failed: row.failed.length });
  } catch (err) {
    console.error('[tool-run-report]', err);
    return sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
}
