/**
 * Continues an in-progress Traditional SEO render (and then broken-links)
 * so ① survives closing the tab. Idle when no run is active.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { authoriseCron, sendJson } from '../../lib/ceo-weekly/shared.js';
import { latestTradSeoRun } from '../../lib/fault-monitor/store.js';
import { tickRun } from '../../lib/fault-monitor/runner.js';
import { loadBrokenPages, tickBrokenLinks } from '../../lib/trad-seo-render/broken-job.js';
import { loadRunPages } from '../../lib/trad-seo-render/pages-store.js';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });
  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const latest = await latestTradSeoRun(sb);
  if (!latest) return sendJson(res, 200, { ok: true, idle: true });
  if (latest.status === 'running') {
    const tick = await tickRun(sb, latest.id, { budgetMs: 200000 });
    return sendJson(res, 200, { ok: true, phase: 'render', run_id: latest.id, ...tick });
  }
  const pages = await loadRunPages(sb, latest.id);
  const already = await loadBrokenPages(sb, latest.id);
  const doneKeys = new Set(already.map((r) => r.page_url));
  const remaining = pages.filter((p) => !doneKeys.has(p.page_url));
  if (!remaining.length) return sendJson(res, 200, { ok: true, idle: true, run_id: latest.id });
  const tick = await tickBrokenLinks(sb, latest.id, remaining, { budgetMs: 180000 });
  return sendJson(res, 200, { ok: true, phase: 'broken_links', run_id: latest.id, done: tick.remaining <= 0, ...tick });
}
