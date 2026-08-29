/**
 * Run log for the Acquisition nightly pulls.
 *
 * Every run writes a row whether it succeeds or not. A pull that silently
 * stops firing then shows up as an absent/stale row rather than being assumed
 * healthy — the same failure mode that hid the Academy email outage.
 */
import { createClient } from '@supabase/supabase-js';

export function detectTriggerSource(req) {
  if (String(req?.headers?.['x-vercel-cron'] || '') === '1') return 'vercel_cron';
  if (req?.method === 'POST') return 'dashboard';
  return 'manual';
}

export function isRequestAuthorized(req) {
  if (String(req?.headers?.['x-vercel-cron'] || '') === '1') return true;
  if (req?.method === 'POST') return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req?.headers?.['x-cron-secret'] === secret || req?.query?.secret === secret;
}

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function startRun(job, triggerSource) {
  const sb = client();
  if (!sb) return null;
  const { data } = await sb
    .from('acquisition_sync_runs')
    .insert({ job, trigger_source: triggerSource, status: 'running' })
    .select('id')
    .single();
  return data?.id || null;
}

export async function finishRun(runId, patch) {
  if (!runId) return;
  const sb = client();
  if (!sb) return;
  await sb
    .from('acquisition_sync_runs')
    .update({ finished_at: new Date().toISOString(), ...patch })
    .eq('id', runId);
}
