/** Supabase helpers for the Marketing tab: paged reads past the 1,000-row PostgREST cap and chunked upserts. */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const PAGE = 1000;

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function selectAll(sb, table, columns, build = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(sb.from(table).select(columns)).range(from, from + PAGE - 1);
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
