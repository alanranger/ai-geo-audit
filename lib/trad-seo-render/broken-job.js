import { urlKey } from '../fault-monitor/prefetch.js';
import { classifyLinkHttpStatus } from '../traditional-seo-broken-links.js';

const TABLE = 'traditional_seo_broken_link_pages';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function probe(url) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 12000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', Accept: 'text/html' }
    });
    clearTimeout(t);
    if (res.status === 429) return { status: 429, kind: 'blocked' };
    return { status: res.status, kind: classifyLinkHttpStatus(res.status) };
  } catch (e) {
    return { status: 0, kind: 'unknown', error: String(e?.message || e).slice(0, 120) };
  }
}

export async function tickBrokenLinks(sb, runId, pages, { budgetMs = 180000, forceNotChecked = [] } = {}) {
  const forced = new Set(forceNotChecked);
  const cache = new Map();
  const deadline = Date.now() + budgetMs;
  let done = 0;
  for (const page of pages) {
    if (Date.now() >= deadline) break;
    const url = page.page_url;
    const targets = page.extract_row?.seoInternalLinkTargets || [];
    if (forced.has(url)) {
      await upsertBroken(sb, runId, url, 'not_checked', 'not_checked', 'Forced blocked in sample test');
      done += 1;
      continue;
    }
    if (page.outcome !== 'checked') {
      await upsertBroken(sb, runId, url, 'not_checked', 'not_checked', page.reason || 'page not checked');
      done += 1;
      continue;
    }
    let broken = [];
    let blocked = 0;
    for (const t of targets) {
      if (Date.now() >= deadline) break;
      if (!cache.has(t)) {
        const hit = await probe(t);
        if (hit.status === 429) {
          await sleep(8000);
          cache.set(t, await probe(t));
        } else cache.set(t, hit);
        await sleep(400);
      }
      const hit = cache.get(t);
      if (hit.kind === 'broken') broken.push(t);
      if (hit.status === 429 || hit.status === 0) blocked += 1;
    }
    if (targets.length && blocked === targets.length) {
      await upsertBroken(sb, runId, url, 'not_checked', 'not_checked', 'Squarespace blocked link checks');
    } else if (broken.length) {
      await upsertBroken(sb, runId, url, 'checked', 'fail', `Broken: ${broken.slice(0, 3).join(', ')}`);
    } else {
      await upsertBroken(sb, runId, url, 'checked', 'pass', 'No 404/410 on same-site outbound links');
    }
    done += 1;
  }
  return { done, total: pages.length, remaining: pages.length - done };
}

async function upsertBroken(sb, runId, url, outcome, status, note) {
  const { error } = await sb.from(TABLE).upsert({
    run_id: runId,
    url_key: urlKey(url),
    page_url: url,
    checked_at: new Date().toISOString(),
    outcome,
    status,
    note
  }, { onConflict: 'run_id,url_key' });
  if (error) throw new Error(`broken_save:${error.message}`);
}

export async function loadBrokenPages(sb, runId) {
  const { data, error } = await sb.from(TABLE).select('*').eq('run_id', runId);
  if (error) throw new Error(`broken_read:${error.message}`);
  return data || [];
}
