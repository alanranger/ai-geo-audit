/**
 * Squarespace email-report collector (runs on Alan's PC, dedicated browser profile — never his everyday browser).
 *
 *   npm run marketing:collector-login      once: opens a window, Alan signs in to Squarespace himself (password is never
 *                                          typed or stored by this script); close the window when the dashboard shows
 *   npm run marketing:collector            daily (scheduled task): send meter + sent-campaign totals + recipient events
 *                                          for recent campaigns and any not yet complete (resumes where it stopped)
 *   npm run marketing:collector-backfill   every sent campaign's recipient events (checkpoint per campaign; re-runnable)
 *   npm run marketing:list-jobs            every 5 min (scheduled task): runs any "Load into Squarespace list" the
 *                                          dashboard queued — consent checked by the dashboard before and after
 *   add --dry to read without posting (prints counts only)
 *
 * Posts to /api/aigeo/marketing (action=collector) with the admin key from this machine's env files. Expired login,
 * a changed Squarespace response or an interrupted run is reported as a stale / failed run, never as zero.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { listSent, PAGE_HELPERS, readEventUsers, readMeter, readSummary } from './page-reads.mjs';
import { createList, csvSwitchedOn, optOut, readLists, subscribedTotal, uploadCsv } from './page-writes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROFILE = path.join(process.env.LOCALAPPDATA || os.homedir(), 'AlanRanger', 'sqs-collector-profile');
const SITE = 'https://alan-ranger.squarespace.com/config/marketing/campaigns';
const API = `${process.env.MARKETING_API_BASE || 'https://ai-geo-audit.vercel.app'}/api/aigeo/marketing`;
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const RECENT_DAYS = 45;
const EVENT_TYPES = ['DELIVERED', 'OPENED', 'CLICKED', 'UNSUBSCRIBED'];
const RELOGIN = 'Squarespace login expired: in the AI GEO Audit folder run "npm run marketing:collector-login", sign in with Google in the Chrome window, then close it';

function adminKey() {
  if (process.env.ARP_ADMIN_KEY) return process.env.ARP_ADMIN_KEY;
  for (const f of ['.env.local', '.env.vercel.prod']) {
    const file = path.join(ROOT, f);
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY='));
    if (line) return line.slice('ARP_ADMIN_KEY='.length).replace(/^"|"$/g, '').trim();
  }
  throw new Error('ARP_ADMIN_KEY not found in env or .env files');
}

async function api(method, body, query = '') {
  if (DRY && method === 'POST') return { ok: true, dry: true };
  const r = await fetch(`${API}${query}`, { method, headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': adminKey() }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(`api ${r.status}: ${j.error || 'failed'}`);
  return j;
}
const post = (kindOf, data) => api('POST', { action: 'collector', kind_of: kindOf, data });

/** Same installed Chrome as the sign-in window (a profile written by one Chrome build must be read by the same build). */
async function openSite(headless) {
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless, channel: 'chrome', viewport: { width: 1280, height: 900 } }).catch((err) => {
    throw new Error(/lock|in use|already/i.test(String(err?.message)) ? 'PROFILE_IN_USE: close the Squarespace sign-in window, then run again' : `CHROME_LAUNCH: ${String(err?.message || err).split('\n')[0]}`);
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  return { ctx, page };
}

function installedChrome() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')).find((p) => fs.existsSync(p)) || null;
}

/**
 * Google refuses sign-in in a browser started under automation (Playwright adds --enable-automation / --no-sandbox and
 * sets navigator.webdriver). So the one-time sign-in opens Alan's normal installed Chrome on the collector's own profile
 * folder with no automation flags and nothing attached; the scheduled runs later reuse the session saved in that folder.
 */
function loginLaunch() {
  const exe = installedChrome();
  if (!exe) throw new Error('Google Chrome is not installed in the usual place');
  return { exe, args: [`--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', SITE] };
}

async function login() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const { exe, args } = loginLaunch();
  console.log('A normal Chrome window is opening on the collector\'s own profile (not your everyday Chrome).');
  console.log('Sign in to Squarespace there (Google sign-in is fine; this script never sees or types your password).');
  console.log('When the Email Campaigns page shows, close that Chrome window.');
  const child = spawn(exe, args, { stdio: 'ignore' });
  await new Promise((resolve) => child.on('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const { ctx, page } = await openSite(true);
  const ok = await signedIn(page).catch(() => false);
  await ctx.close();
  console.log(ok ? 'Signed in: the session is saved for the nightly collector.' : 'Not signed in yet: run npm run marketing:collector-login again and finish the sign-in before closing the window.');
}

async function signedIn(page) {
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  if (!/alan-ranger\.squarespace\.com\/config/.test(page.url())) return false;
  await page.evaluate(PAGE_HELPERS);
  return page.evaluate(() => window.__arpGet('/api/newsletters/v1.0/composer/billing/billing-state').then(() => true, () => false));
}

function pickEventTargets(sent, state, backfill) {
  const done = new Map(state.map((s) => [s.email_id, s]));
  const recent = Date.now() - RECENT_DAYS * 86400000;
  return sent.filter((c) => backfill ? !done.get(c.email_id)?.events_complete : (Date.parse(c.sent_on) >= recent || !done.get(c.email_id)?.events_complete))
    .sort((a, b) => String(b.sent_on).localeCompare(String(a.sent_on)));
}

async function campaignEvents(page, c, summary) {
  const rows = [];
  for (const type of EVENT_TYPES) rows.push(...await page.evaluate(readEventUsers, { emailId: c.email_id, type }));
  for (const u of summary.url_clicks) rows.push(...await page.evaluate(readEventUsers, { emailId: c.email_id, type: 'CLICKED', url: u.url }));
  const delivered = rows.filter((r) => r.event_type === 'DELIVERED').length;
  if (delivered !== summary.delivered) throw new Error(`INCOMPLETE delivered list for ${c.email_id}: ${delivered}/${summary.delivered}`);
  return rows;
}

async function postEvents(emailId, rows) {
  for (let i = 0; i < rows.length; i += 2000) await post('events', { email_id: emailId, events: rows.slice(i, i + 2000), complete: i + 2000 >= rows.length });
  if (!rows.length) await post('events', { email_id: emailId, events: [], complete: true });
}

const eta = (t0, done, total) => (done ? Math.round(((Date.now() - t0) / done) * (total - done) / 60000) : null);

async function collect(page, runId, backfill, maxMinutes) {
  const meter = await page.evaluate(readMeter);
  await post('meter', { ...meter, run_id: runId });
  const sent = await page.evaluate(listSent);
  const state = DRY ? [] : (await api('GET', null, '?action=collector-state')).campaigns;
  const known = new Set(state.map((s) => s.email_id));
  const summaries = new Map();
  const refresh = sent.filter((c) => !known.has(c.email_id) || Date.parse(c.sent_on) >= Date.now() - RECENT_DAYS * 86400000);
  for (const c of refresh) summaries.set(c.email_id, { ...c, ...(await page.evaluate(readSummary, c.email_id)) });
  for (let i = 0; i < refresh.length; i += 25) await post('campaigns', { campaigns: refresh.slice(i, i + 25).map((c) => summaries.get(c.email_id)) });
  const targets = pickEventTargets(sent, state, backfill);
  const t0 = Date.now();
  let done = 0;
  let events = 0;
  for (const c of targets) {
    if ((Date.now() - t0) / 60000 > maxMinutes) break;
    const summary = summaries.get(c.email_id) || { ...c, ...(await page.evaluate(readSummary, c.email_id)) };
    const rows = await campaignEvents(page, c, summary);
    await postEvents(c.email_id, rows);
    done += 1;
    events += rows.length;
    await post('run', { run_id: runId, items_done: done, items_total: targets.length, checkpoint: { last_email_id: c.email_id }, session_ok: true });
    console.log(`${done}/${targets.length} (${Math.round((done / targets.length) * 100)}%) · ${rows.length} events · ETA ${eta(t0, done, targets.length) ?? '?'} min`);
  }
  return { meter_used: meter.used, meter_quota: meter.quota, campaigns_listed: sent.length, summaries_refreshed: refresh.length, event_campaigns_done: done, event_campaigns_target: targets.length, events, complete: done === targets.length };
}

const csvCell = (v) => {
  const s = String(v ?? '').replace(/^[=+\-@\t\r]+/, '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const loadStep = (job, n, step) => api('POST', { action: 'list-load-progress', run_id: job.run_id, export_id: job.export_id, items_done: n, items_total: 4, step }).catch(() => {});

async function targetList(page, name) {
  const same = (await page.evaluate(readLists)).find((l) => l.name === name);
  if (same && same.count > 0) throw new Error(`a Squarespace list called "${name}" already has ${same.count} contacts; rename the snapshot`);
  return same || page.evaluate(createList, name);
}

async function waitForCount(page, listId, want) {
  let seen = null;
  for (let i = 0; i < 36; i += 1) {
    seen = (await page.evaluate(readLists)).find((l) => l.id === listId)?.count ?? null;
    if (seen != null && seen >= want) return seen;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  return seen;
}

/** One "Load into Squarespace list" job: check → create list → import passed people → re-check (dashboard decides). */
async function runLoad(page, job) {
  await loadStep(job, 1, 'Re-reading consent from Squarespace before the import');
  const pre = await api('POST', { action: 'list-load-precheck', export_id: job.export_id });
  if (!pre.import.length) throw new Error(`nobody passed the consent check (${JSON.stringify(pre.dropped)}); nothing imported`);
  const before = await page.evaluate(subscribedTotal);
  await loadStep(job, 2, `Creating list and importing ${pre.import.length} people`);
  const list = await targetList(page, job.list_name);
  const csv = ['Email Address,First Name,Last Name', ...pre.import.map((m) => [m.email, csvCell(m.first_name), csvCell(m.last_name)].join(','))].join('\n');
  const importStart = Date.now() - 60000;
  await page.evaluate(uploadCsv, { listId: list.id, csv, filename: `arp-${job.export_id.slice(0, 8)}.csv` });
  await loadStep(job, 3, 'Waiting for Squarespace to finish the import');
  const count = await waitForCount(page, list.id, pre.import.length);
  const after = await page.evaluate(subscribedTotal);
  await loadStep(job, 4, 'Re-reading consent after the import');
  const sw = await page.evaluate(csvSwitchedOn, { ids: pre.import.map((m) => m.profile_id).filter(Boolean), sinceMs: importStart });
  const post2 = await api('POST', { action: 'list-load-postcheck', export_id: job.export_id, list_id: list.id, list_count: count, all_subscribers_before: before, all_subscribers_after: after, switched_ids: sw.switched, unreadable: sw.unreadable.length });
  const fix = post2.fix_ids?.length ? await undoFlips(page, job, list.id, post2.fix_ids) : null;
  return { list_id: list.id, imported: pre.import.length, dropped: pre.dropped, list_count: count, all_subscribers_before: before, all_subscribers_after: after, status: fix?.status || post2.status, flips: post2.flips, fixed: fix?.fixed ?? 0, all_subscribers_after_fix: fix?.all_subscribers ?? null };
}

/** The import switched these people on: opt them out again (Squarespace also drops them from the list), then confirm. */
async function undoFlips(page, job, listId, ids) {
  await loadStep(job, 4, `Setting ${ids.length} person(s) back to unsubscribed`);
  await page.evaluate(optOut, ids);
  await new Promise((ok) => setTimeout(ok, 15000));
  const count = (await page.evaluate(readLists)).find((l) => l.id === listId)?.count ?? null;
  const allSubs = await page.evaluate(subscribedTotal);
  const r = await api('POST', { action: 'list-load-fixed', export_id: job.export_id, list_count: count, all_subscribers_after_fix: allSubs });
  return { ...r, all_subscribers: allSubs };
}

/** "Re-read plan files" from the dashboard: read the Pick n Mix statements on this PC, then rebuild the customer view. */
async function planImportJob() {
  const { job } = await api('GET', null, '?action=plan-import-next');
  if (!job) return;
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--env-file=.env.local', 'scripts/pnm-plans/import.mjs', `--run-id=${job.run_id}`], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', resolve);
  });
  if (code === 0) await api('POST', { action: 'sync', step: 'customers' }).catch((e) => console.error(e.message));
}

/** Scheduled every few minutes: opens the browser only when the dashboard has queued a load. */
async function jobs() {
  await planImportJob().catch((e) => console.error(`plan import: ${e.message}`));
  for (let n = 0; n < 5; n += 1) {
    const { job } = await api('GET', null, '?action=list-load-next');
    if (!job) return;
    let ctx = null;
    try {
      const site = await openSite(true);
      ctx = site.ctx;
      if (!(await signedIn(site.page))) throw new Error('SESSION_EXPIRED');
      const summary = await runLoad(site.page, job);
      await api('POST', { action: 'list-load-finish', run_id: job.run_id, export_id: job.export_id, status: 'ok', summary });
      console.log(JSON.stringify(summary));
    } catch (err) {
      const msg = /SESSION_EXPIRED/.test(String(err?.message)) ? RELOGIN : String(err?.message || err);
      await api('POST', { action: 'list-load-finish', run_id: job.run_id, export_id: job.export_id, status: 'failed', error: msg }).catch(() => {});
      console.error(msg);
      process.exitCode = 1;
    } finally {
      if (ctx) await ctx.close();
    }
  }
}

const MODES = { '--login': login, '--print-login': () => console.log(JSON.stringify(loginLaunch())), '--jobs': jobs };

async function main() {
  const mode = Object.keys(MODES).find((m) => args.has(m));
  if (mode) return MODES[mode]();
  const backfill = args.has('--backfill');
  const { run_id: runId } = DRY ? { run_id: null } : await post('run', { kind: backfill ? 'collector:backfill' : 'collector', host: os.hostname() });
  let ctx = null;
  try {
    const site = await openSite(true);
    ctx = site.ctx;
    const { page } = site;
    if (!(await signedIn(page))) throw new Error('SESSION_EXPIRED');
    const summary = await collect(page, runId, backfill, backfill ? 600 : 50);
    await post('run', { run_id: runId, status: summary.complete ? 'ok' : 'partial', session_ok: true, summary });
    console.log(JSON.stringify(summary));
  } catch (err) {
    const msg = String(err?.message || err);
    const expired = /SESSION_EXPIRED/.test(msg);
    await post('run', { run_id: runId, status: expired ? 'stale' : 'failed', session_ok: !expired, error: expired ? RELOGIN : msg }).catch(() => {});
    console.error(expired ? RELOGIN : msg);
    process.exitCode = 1;
  } finally {
    if (ctx) await ctx.close();
  }
}

main();
