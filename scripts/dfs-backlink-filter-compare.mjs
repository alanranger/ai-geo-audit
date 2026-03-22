/**
 * Compare DataForSEO backlinks/live: unfiltered vs recommended spam URL filters.
 *
 * Env:
 *   DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD (same as dataforseo-backlink-pages.js), or
 *   DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (same as dataforseo-client.js)
 *
 * Usage:
 *   npm run test:dfs-backlink-filters
 *   node scripts/dfs-backlink-filter-compare.mjs --target=alanranger.com --limit=100
 *
 * Note: `backlinks/live` accepts **one task per HTTP request**; this script sends two requests.
 */

import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dfsBacklinksLiveRankScale } from '../lib/dfs-backlink-limits.js';
import { dfsSpamUrlFilters } from '../lib/dfs-spam-filters.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });

const ENDPOINT = 'https://api.dataforseo.com/v3/backlinks/backlinks/live';

function argVal(prefix, fallback) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function authHeader(login, password) {
  const token = Buffer.from(`${login}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function summarizeTask(task, label) {
  const sc = task?.status_code;
  const msg = task?.status_message != null ? String(task.status_message) : null;
  const result0 = Array.isArray(task?.result) ? task.result[0] : null;
  const items = Array.isArray(result0?.items) ? result0.items : [];
  const total = result0?.total_count;
  const cost = task?.cost;
  const sample = items.slice(0, 5).map((it) => ({
    domain_from: it?.domain_from ?? null,
    url_from: String(it?.url_from || '').slice(0, 120)
  }));
  const bad = items.filter((it) => /seo-anomaly|bhs-links|dark-side-links|quarterlinks/i.test(String(it?.url_from || '')));
  return {
    label,
    status_code: sc,
    status_message: msg,
    cost,
    total_count: total,
    items_returned: items.length,
    bad_in_page: bad.length,
    sample
  };
}

async function postOneTask(login, password, task) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: authHeader(login, password),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([task])
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, http: res.status, err: `non_json:${text.slice(0, 200)}`, task: null };
  }
  const top = json?.status_code;
  if (!res.ok || top !== 20000) {
    return {
      ok: false,
      http: res.status,
      err: String(json?.status_message || `http_${res.status}`),
      task: null
    };
  }
  const t = json?.tasks?.[0];
  if (!t) return { ok: false, http: res.status, err: 'missing_tasks[0]', task: null };
  return { ok: true, http: res.status, err: null, task: t };
}

async function main() {
  const login = String(process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN || '').trim();
  const password = String(
    process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD || ''
  ).trim();
  if (!login || !password) {
    console.error(
      'Missing DataForSEO credentials. Set DATAFORSEO_API_LOGIN + DATAFORSEO_API_PASSWORD ' +
        'or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD in .env / .env.local.'
    );
    process.exit(1);
  }

  const target = String(argVal('--target=', 'alanranger.com')).trim() || 'alanranger.com';
  const limit = Math.min(1000, Math.max(1, parseInt(String(argVal('--limit=', '100')), 10) || 100));

  const base = {
    target,
    mode: 'as_is',
    limit,
    backlinks_status_type: 'live',
    rank_scale: dfsBacklinksLiveRankScale()
  };

  const r1 = await postOneTask(login, password, { ...base });
  const r2 = await postOneTask(login, password, { ...base, filters: dfsSpamUrlFilters() });

  const out = { target, limit, tasks: [] };
  if (!r1.ok) {
    out.tasks.push({ label: 'unfiltered', error: r1.err });
  } else {
    out.tasks.push(summarizeTask(r1.task, 'unfiltered'));
  }
  if (!r2.ok) {
    out.tasks.push({ label: 'filtered (4x url_from not_like)', error: r2.err });
  } else {
    out.tasks.push(summarizeTask(r2.task, 'filtered (4x url_from not_like)'));
  }

  const fatal = !r1.ok || !r2.ok;
  console.log(JSON.stringify(out, null, 2));
  if (fatal) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
