/**
 * PC side of the clean-up execution (collector.mjs --jobs, signed-in collector Chrome profile). The dashboard decides
 * who may be acted on (cleanup-exec.mjs claimBatch re-checks every person right before); this only runs Squarespace's
 * own "Opt out of email marketing" for the profile IDs it is handed, then reads each one's consent back. Nothing is
 * deleted. Bounded: at most MAX_BATCHES batches per scheduled run; whatever is left continues on the next run.
 */
export const WAIT_AFTER_OPTOUT_MS = 10000;
export const MAX_BATCHES = 12;

const sleep = (n) => new Promise((ok) => setTimeout(ok, n));
const msg = (e) => String(e?.message || e);

/** One batch: opt out, wait, read consent back (even after an error: some may have landed), report. */
export async function actBatch(page, job, act, { api, pageFns, wait = sleep }) {
  const ids = act.map((a) => a.profile_id);
  let error = null;
  try {
    await page.evaluate(pageFns.optOut, ids);
  } catch (e) {
    error = msg(e);
  }
  await wait(WAIT_AFTER_OPTOUT_MS);
  const read = await page.evaluate(pageFns.consentStatus, ids).catch(() => ({ status: {} }));
  return api('POST', { action: 'cleanup-exec-result', manifest_id: job.manifest_id, run_id: job.run_id, sent: ids, status: read.status || {}, error });
}

async function runBatches(page, job, deps) {
  const ref = { manifest_id: job.manifest_id, run_id: job.run_id };
  await deps.api('POST', { action: 'cleanup-exec-start', ...ref, all_subscribers: await page.evaluate(deps.pageFns.subscribedTotal) });
  const tot = { batches: 0, sent: 0, done: 0, failed: 0, skipped: 0, finished: false };
  for (let n = 0; n < MAX_BATCHES; n += 1) {
    const b = await deps.api('POST', { action: 'cleanup-exec-batch', ...ref });
    tot.skipped += b.counts?.skipped || 0;
    tot.finished = !!b.finished;
    if (!b.act?.length) {
      if (b.more) continue;
      break;
    }
    const r = await actBatch(page, job, b.act, deps);
    tot.batches += 1;
    tot.sent += b.act.length;
    tot.done += r.done || 0;
    tot.failed += r.failed || 0;
    (deps.log || console.log)(`clean-up batch ${tot.batches}: ${r.done} done, ${r.failed} failed (${r.done_total} done so far)`);
  }
  return tot;
}

/**
 * Called from jobs() with the collector's api() and an open() that returns a signed-in { ctx, page } (or throws).
 * A dry collector run (--dry) never claims a clean-up.
 */
export async function cleanupExecJob({ api, open, pageFns, wait, log = console.log, dry = false }) {
  if (dry) return null;
  const { job, waiting, refused } = await api('GET', null, '?action=cleanup-exec-next');
  if (!job) {
    if (waiting || refused) log(`clean-up: ${waiting || refused}`);
    return null;
  }
  const ref = { action: 'cleanup-exec-finish', manifest_id: job.manifest_id, run_id: job.run_id };
  let site = null;
  try {
    site = await open();
    const summary = await runBatches(site.page, job, { api, pageFns, wait, log });
    await api('POST', { ...ref, status: 'ok', summary, all_subscribers_after: await site.page.evaluate(pageFns.subscribedTotal).catch(() => null) });
    log(`clean-up: ${summary.done} done, ${summary.failed} failed, ${summary.skipped} skipped${summary.finished ? ' (manifest finished)' : ''}`);
    return summary;
  } catch (err) {
    await api('POST', { ...ref, status: 'failed', error: msg(err) }).catch(() => {});
    throw err;
  } finally {
    if (site) await site.ctx.close();
  }
}
