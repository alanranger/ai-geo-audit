/** Supabase helpers for the Marketing tab: paged reads past the 1,000-row PostgREST cap and chunked upserts. */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const PAGE = 1000;

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Stable page order: the listed plain columns (up to 4), or the table's key for `*` reads. Unordered pages can skip rows. */
const STAR_KEYS = { sqs_profiles: ['profile_id'], sqs_orders: ['order_id'], marketing_engagement_v: ['email'], sqs_email_campaigns: ['email_id'] };
export function pageOrder(table, columns) {
  if (String(columns).trim() === '*') return STAR_KEYS[table] || [];
  return String(columns).split(',').map((c) => c.trim()).filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c)).slice(0, 4);
}

export async function selectAll(sb, table, columns, build = (q) => q) {
  const rows = [];
  const keys = pageOrder(table, columns);
  for (let from = 0; ; from += PAGE) {
    const ordered = keys.reduce((q, k) => q.order(k, { ascending: true }), build(sb.from(table).select(columns)));
    const { data, error } = await ordered.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function upsertChunks(sb, table, rows, onConflict, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

export const normEmail = (e) => (e == null || String(e).trim() === '' ? null : String(e).trim().toLowerCase());
export const emailHash = (e) => crypto.createHash('sha256').update(normEmail(e) || '').digest('hex');
export const normName = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();

/** UK postcode → "AB1 2CD", or null when it doesn't look like a UK postcode. */
export function normPostcode(p) {
  const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(s)) return null;
  return `${s.slice(0, -3)} ${s.slice(-3)}`;
}

export async function logRun(sb, row) {
  const { data, error } = await sb.from('marketing_collector_runs').insert(row).select('run_id').single();
  if (error) throw new Error(`marketing_collector_runs: ${error.message}`);
  return data.run_id;
}

export async function finishRun(sb, runId, patch) {
  const { error } = await sb.from('marketing_collector_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('run_id', runId);
  if (error) throw new Error(`marketing_collector_runs: ${error.message}`);
}
