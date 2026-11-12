/**
 * QUESTION-2026-11-12 monday-brief-dated-action-reminders-bluebell-price: the dashboard reminders strip with LOCAL
 * lib/ops-reminders-strip.js and the LOCAL api/aigeo/ops-reminders.js GET on LIVE data, 1700px. Read-only: every
 * non-GET request is refused; the "Mark done" click is intercepted (dummy key, fake ok) so nothing is marked done.
 *   node scripts/playwright-verify-ops-reminders-local.mjs
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

for (const m of fs.readFileSync('.env.local', 'utf8').matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
  if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '').replace(/\\n$/, '');
}
const { default: handler } = await import('../api/aigeo/ops-reminders.js');
const OUT = 'outputs';
const DUMMY_KEY = 'dummy-key-for-wiring-check';
const results = [];
const check = (name, ok, note = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${note ? ` · ${String(note).replace(/\s+/g, ' ').slice(0, 220)}` : ''}`); };

/** The local handler's GET response body (live Supabase, service role, read-only). */
async function localGet() {
  const res = { code: 0, body: '', setHeader() {}, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  return res;
}

const refused = [];
const patches = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('dialog', (d) => d.accept());
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), DUMMY_KEY);
// Playwright tries the most recently added route first: the catch-all refusal goes in before the reminders route.
await page.route('**/api/**', (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fallback();
  refused.push(`${req.method()} ${new URL(req.url()).pathname}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' });
});
await page.route('**/api/aigeo/ops-reminders*', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') {
    const r = await localGet();
    return route.fulfill({ status: r.code, contentType: 'application/json', body: r.body });
  }
  patches.push({ method: req.method(), key_sent: req.headers()['x-arp-admin-key'] === DUMMY_KEY, body: JSON.parse(req.postData() || '{}') });
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"intercepted":true}' });
});

await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#ceo-brief-hold-banner', { state: 'attached', timeout: 120000 });
await page.addScriptTag({ content: fs.readFileSync('lib/ops-reminders-strip.js', 'utf8') });
await page.waitForSelector('#ops-reminders-strip [data-ops-reminder]', { timeout: 60000 });
await page.waitForTimeout(2500);

const strip = page.locator('#ops-reminders-strip');
const text = (await strip.innerText()).replace(/\s+/g, ' ');
check('strip sits directly under the CEO-brief hold banner', await page.evaluate(() => document.getElementById('ceo-brief-hold-banner').nextElementSibling?.id === 'ops-reminders-strip'));
check('Bluebell reminder shown as upcoming, due Mon 1 Feb 2027, with its link', /Upcoming/.test(text) && text.includes('Due Mon 1 Feb 2027') && text.includes('Bluebell price rise: change 18 variants to £110 / £165')
  && await strip.locator('a[href="https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops"]').count() === 1, text.slice(0, 200));
check('"Mark done" button present', await strip.locator('[data-ops-done]').count() === 1);
await strip.locator('details').evaluateAll((ds) => ds.forEach((d) => { d.open = true; }));
await page.waitForTimeout(400);
const box = await page.evaluate(() => {
  const main = document.querySelector('main.aigeo-main').getBoundingClientRect();
  const s = document.getElementById('ops-reminders-strip').getBoundingClientRect();
  return { x: main.x, y: Math.max(0, s.y - 24), width: main.width, height: s.height + 48 };
});
await page.screenshot({ path: `${OUT}/ops-reminder-strip-local-1700px-20261112.png`, clip: box });
await strip.locator('[data-ops-done]').hover();
await strip.locator('[data-ops-done]').screenshot({ path: `${OUT}/ops-reminder-done-button-local-1700px-20261112.png` });

await strip.locator('[data-ops-done]').click();
await page.waitForTimeout(2500);
check('Mark done sends one PATCH { id: 1, done: true } with the saved admin key (intercepted, nothing written)',
  patches.length === 1 && patches[0].method === 'PATCH' && patches[0].key_sent && patches[0].body.id === 1 && patches[0].body.done === true, JSON.stringify(patches.map((p) => ({ ...p, key_sent: p.key_sent }))));
check('no reminder write reached the server; other page writes refused', !refused.some((r) => /ops-reminders/.test(r)), `refused: ${[...new Set(refused)].join(', ') || 'none'}`);
const live = JSON.parse((await localGet()).body);
check('reminder still open in the database (not marked done)', live.reminders.some((r) => r.id === 1 && r.done === false));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
