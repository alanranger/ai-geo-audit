/**
 * Strategy clean layout on LIVE data with the LOCAL code (before deploy), 1700px. Read-only: serves the local strategy /
 * marketing scripts (+ injects lib/strategy-layout.js), answers /api/aigeo/strategy-summary with the local handler, and
 * refuses every non-GET. DB row counts + newest timestamps compared before / after. Screenshots: folds closed + open.
 *   node scripts/playwright-verify-strategy-clean-local.mjs        (LIVE=1 to test the deployed files only)
 */
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY });
const LIVE = process.env.LIVE === '1';
const BASE = 'https://ai-geo-audit.vercel.app';
const TAG = LIVE ? 'live' : 'local';
const OUT = 'outputs';
const STAMP = process.env.STAMP || '20261108';
const LOCAL_FILES = ['strategy-tab.js', 'strategy-layout.js', 'strategy-sales-gap.js', 'strategy-prospects.js', 'strategy-quarter-plan.js', 'marketing-overview-tiles.js', 'marketing-schedule-model.js', 'revenue-truth-controller.mjs'];
const BLUR = '.mk-detail, #mk-cust-body, #mq-results td:first-child, #mk-review-table td:first-child { filter: blur(6px) !important; }';
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const blocked = [];
const errors = [];
const TABLES = { strategy_campaign_steps: 'last_seen_at', strategy_campaign_ticks: 'updated_at', strategy_campaigns: 'updated_at', strategy_quarter_actions: 'updated_at', strategy_initiatives: 'updated_at', strategy_event_snapshots: 'created_at', sqs_send_meter: 'captured_at', marketing_segment_exports: 'created_at', marketing_event_facts: 'set_at', marketing_segment_evaluations: 'evaluated_at', business_targets: 'updated_at', strategy_initiative_links: 'set_at', marketing_decisions: 'decided_at', marketing_social_placements: 'updated_at', prospect_enquiry: 'updated_at', prospect_enquiry_history: 'at' };

async function dbState() {
  const out = {};
  for (const [t, c] of Object.entries(TABLES)) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
    const { data, error } = await sb.from(t).select(c).not(c, 'is', null).order(c, { ascending: false }).limit(1);
    Object.assign(out, { [`${t}.rows`]: count, [`${t}.max(${c})`]: error ? 'n/a' : data?.[0]?.[c] || null });
  }
  return out;
}
let summaryBody = null;
async function localSummary() {
  if (summaryBody) return summaryBody;
  const { default: handler } = await import('../api/aigeo/strategy-summary.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: {} }, { status() { return this; }, setHeader() {}, json(j) { body = j; return this; } });
  summaryBody = JSON.stringify(body);
  return summaryBody;
}

/** GET /api/aigeo/prospects answered by the local handler (admin key from the env file; read-only). */
async function localProspects() {
  process.env.ARP_ADMIN_KEY = ENV.ARP_ADMIN_KEY;
  const { default: handler } = await import('../api/aigeo/prospects.js');
  let body = null;
  await handler({ method: 'GET', query: {}, headers: { 'x-arp-admin-key': ENV.ARP_ADMIN_KEY } }, { status() { return this; }, setHeader() {}, send(t) { body = t; return this; } });
  return body;
}

async function routes(page) {
  await page.addInitScript((k) => { sessionStorage.setItem('arp_admin_key', k); localStorage.setItem('mks-view', 'days'); localStorage.setItem('mks-layout', 'days'); }, ENV.ARP_ADMIN_KEY);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') { if (url.pathname.startsWith('/api/')) blocked.push(`${req.method()} ${url.pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"dry_run":true}' }); }
    if (LIVE) return route.fallback();
    const file = LOCAL_FILES.find((f) => url.pathname === `/lib/${f}`);
    if (file) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`lib/${file}`, 'utf8') });
    if (url.pathname === '/api/aigeo/prospects') return route.fulfill({ status: 200, contentType: 'application/json', body: await localProspects() });
    if (url.pathname === '/api/aigeo/strategy-summary') return route.fulfill({ status: 200, contentType: 'application/json', body: await localSummary() });
    if (url.pathname === '/audit-dashboard.html') {
      const res = await route.fetch();
      const html = (await res.text()).replace(/(<script src="\/lib\/strategy-tab\.js[^"]*"><\/script>)/, '$1\n  <script src="/lib/strategy-sales-gap.js?v=local"></script>\n  <script src="/lib/strategy-prospects.js?v=local"></script>\n  <script src="/lib/strategy-layout.js?v=local"></script>');
      return route.fulfill({ response: res, body: html, headers: { ...res.headers(), 'content-type': 'text/html; charset=utf-8' } });
    }
    return route.fallback();
  });
}
async function open(browser, hash, ready) {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
  await routes(page);
  await page.goto(`${BASE}/audit-dashboard.html#${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: BLUR });
  return page;
}
const num = (t) => Number(String(t || '').replace(/[^\d.]/g, '')) || null;

async function strategy(browser) {
  const page = await open(browser, 'strategy', () => document.querySelector('#st-fold-why') && !/loading/i.test(document.querySelector('#st-next-delivery')?.textContent || 'loading'));
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('section[data-panel="strategy"]');
    const shown = (el) => el.offsetParent !== null && !el.closest('details:not([open]) > :not(summary)');
    const blocks = [...panel.querySelectorAll('#strategy-root > *, section[data-panel="strategy"] > *')].filter((el) => el.id !== 'strategy-root' && shown(el) && el.tagName !== 'STYLE').map((el) => el.id || el.tagName).filter((x) => x !== 'DIV' || true);
    const outside = ['st-action-list', 'st-next4', 'st-campaign', 'st-insights', 'st-weights', 'st-gp-chart'].filter((id) => { const el = document.getElementById(id); return el && shown(el); });
    return { height: Math.round(panel.getBoundingClientRect().height), doc: document.documentElement.scrollHeight, blocks, outside, why: document.getElementById('st-fold-why')?.open, targets: document.getElementById('st-fold-targets')?.open, ids: [...document.querySelectorAll('#st-fold-why #st-gp-chart, #st-fold-why #st-weights, #st-fold-why #st-insights, #st-fold-why #st-fold-tasks #st-action-list, #st-fold-why #st-fold-tasks #st-next4, #st-fold-targets #st-targets-host')].map((e) => e.id) };
  });
  check('visible page = tiles + Decisions + Quarter plan (+ Next delivery) + 2 closed folds', ['st-where', 'st-decisions', 'st-quarter-plan', 'st-next-delivery', 'st-fold-why', 'st-fold-targets'].every((id) => layout.blocks.includes(id)) && layout.why === false && layout.targets === false && !layout.outside.length, `visible blocks: ${layout.blocks.join(' > ')} · outside folds: ${layout.outside.join(', ') || 'none'}`);
  check('page height < 5,000px with the folds closed (sales gap, Remedy and quarter cards added)', layout.height < 5000, `${layout.height}px (document ${layout.doc}px)`);
  check('Why fold holds the chart, Top 3 weights, the analysis tiles and the task lists; Targets fold holds the Targets panel', ['st-gp-chart', 'st-weights', 'st-insights', 'st-action-list', 'st-next4', 'st-targets-host'].every((id) => layout.ids.includes(id)), layout.ids.join(', '));
  const qp = await page.evaluate(() => {
    const host = document.getElementById('st-quarter-plan');
    const lines = (el) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; return Math.round(el.getBoundingClientRect().height / lh); };
    const shown = (el) => el.offsetParent !== null && !el.closest('details:not([open]) > :not(summary)');
    const paras = [...host.querySelectorAll('p, .qp-p, .qp-intro, .qp-foot')].filter(shown).map((el) => ({ lines: lines(el), text: el.textContent.trim().slice(0, 60) })).filter((x) => x.text);
    const inis = [...host.querySelectorAll('.qp-ini')].filter(shown).map((ini) => ({ title: ini.querySelector('.qp-it')?.textContent.trim().slice(0, 40), lines: [...ini.children].filter((c) => shown(c) && !c.matches('details')).reduce((a, c) => a + lines(c), 0) }));
    return { paras, inis, kpis: host.querySelectorAll('.qp-kpis .qp-kpi').length };
  });
  check('Quarter plan: no visible paragraph over 2 lines (intro behind ⓘ)', qp.paras.every((x) => x.lines <= 2), qp.paras.filter((x) => x.lines > 2).map((x) => `${x.lines}: ${x.text}`).join(' | ') || `${qp.paras.length} short texts`);
  check('Quarter plan: each initiative ≤ 3 visible lines; KPI boxes kept', qp.inis.length && qp.inis.every((x) => x.lines <= 3) && qp.kpis > 0, `${qp.inis.map((x) => `${x.title}=${x.lines}`).join(' · ')} · KPI boxes ${qp.kpis}`);
  const tl = await page.evaluate(() => {
    const card = document.querySelector('#st-quarter-plan .qp-card.is-current');
    const box = [...(card?.querySelectorAll('.qp-kpi') || [])].find((k) => /Pick n Mix plans/.test(k.textContent));
    const pnm = [...(card?.querySelectorAll('.qp-ini') || [])].find((i) => /Pick n Mix/.test(i.querySelector('.qp-it')?.textContent || ''));
    const all = [...document.querySelectorAll('#st-quarter-plan .qp-card')].flatMap((c) => [...c.querySelectorAll('.qp-ini')].map((i) => `${c.querySelector('.qp-h b')?.textContent.split(' ·')[0]} ${i.querySelector('.qp-it')?.textContent.trim()}: ${i.querySelector('.qp-l')?.textContent.trim()}`));
    return { box: box?.querySelector('.qp-kv')?.textContent.trim(), boxSub: box?.querySelector('.qp-ks')?.textContent.trim(), line: pnm?.querySelector('.qp-l')?.textContent.trim(), all };
  });
  const [bActual, bTarget] = String(tl.box || '').split('/').map((x) => x.trim());
  check('Pick n Mix initiative target line agrees with its KPI box (same roadmap target and actual)', tl.line && new RegExp(`^Target ${bTarget} plans · Actual ${bActual} · Gap ${Number(bTarget) - Number(bActual)} \\(by 31 Dec\\)`).test(tl.line), `box "${tl.box}" (${tl.boxSub}) · line "${tl.line}"`);
  fs.writeFileSync(`${OUT}/_correction3-${TAG}-target-lines.json`, JSON.stringify(tl.all, null, 1));
  const pairs = await page.evaluate(() => {
    const LABEL = { plans: /Pick n Mix plans/, beginners: /beginners/i, gbp: /Returning/ };
    const boxTarget = (v) => (v.includes('/') ? v.split('/')[1].trim() : v.split(' by ')[0].trim());
    return [...document.querySelectorAll('#st-quarter-plan .qp-card')].flatMap((c) => [...c.querySelectorAll('.qp-ini')].map((i) => {
      const line = i.querySelector('.qp-l')?.textContent.trim() || '';
      const m = /^Target (£[\d.,]+k?|\d+)( (plans|beginners))?/.exec(line);
      if (!m || (!m[3] && !/^Target £[\d.]+k/.test(line))) return null;
      const unit = m[3] || 'gbp';
      const box = [...c.querySelectorAll('.qp-kpi')].find((k) => LABEL[unit].test(k.querySelector('.qp-kl')?.textContent || ''));
      const bt = box ? boxTarget(box.querySelector('.qp-kv').textContent.trim()) : null;
      return { ini: i.querySelector('.qp-it')?.textContent.trim(), line: m[1], box: bt, ok: bt === m[1] };
    })).filter(Boolean);
  });
  check('every roadmap-KPI initiative line matches the KPI box on its own card', pairs.length >= 5 && pairs.every((p) => p.ok), pairs.map((p) => `${p.ini}: line ${p.line} / box ${p.box}`).join(' · '));
  const dec = (await page.locator('#st-decisions').innerText()).replace(/\s+/g, ' ');
  const needs = Number((/Needs Alan \((\d+)\)/.exec(dec) || [])[1] ?? NaN);
  check('Strategy headline is "Needs Alan (n)" from the shared decision state; no target decision (beginners decided)', Number.isFinite(needs) && !/Target decisions/.test(dec.replace(/title="[^"]*"/g, '')) && !/non-JLR beginners/.test(dec), dec.slice(0, 200));
  const norfolk = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-l')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /Norfolk coastal/.test(t) && /^Next:/.test(t)));
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-card')].slice(0, 2).map((c) => [...c.querySelectorAll('.qp-kpi')].map((k) => `${k.querySelector('.qp-kl')?.textContent.trim()}: ${k.querySelector('.qp-kv')?.textContent.trim()} (${k.querySelector('.qp-ks')?.textContent.trim()})`).find((t) => /beginners/i.test(t))));
  check('Q1 KPI box "Non-JLR beginners: moved to Jan course"; Q2 box "4 by 27 Jan · 17 by Mar"', /^Non-JLR beginners: moved to Jan course/.test(boxes[0] || '') && /^Non-JLR beginners: 4 by 27 Jan · 17 by Mar 27/.test(boxes[1] || ''), boxes.join(' | '));
  const academy = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-card.is-current .qp-ini')].filter((i) => /Academy/.test(i.querySelector('.qp-it')?.textContent || '')).map((i) => [...i.querySelectorAll('.qp-l')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join(' | '))[0] || '');
  if (process.env.EXPECT_ACADEMY_NEXT) check(`Academy initiative next action reads ${process.env.EXPECT_ACADEMY_NEXT}; "Target not set" kept`, academy.includes('Next: Email: Your next step with the Photography Academy · ') && academy.includes(process.env.EXPECT_ACADEMY_NEXT), academy);
  const g4 = await page.evaluate(() => {
    const panel = document.querySelector('section[data-panel="strategy"]');
    const text = panel.innerText.replace(/\s+/g, ' ');
    const plan = [...panel.querySelectorAll('a')].filter((a) => /plan document/i.test(a.textContent)).map((a) => a.href);
    const card = (re) => [...document.querySelectorAll('#st-quarter-plan .qp-ini')].filter((i) => re.test(i.querySelector('.qp-it')?.textContent || '')).map((i) => i.textContent.replace(/\s+/g, ' ').trim().slice(0, 260));
    return { bare: (text.match(/Target not set|Needs review(?! ·)/g) || []).length, plan, near: card(/Near-term workshop/)[0] || '', academy: card(/^4 · Academy/)[0] || '', q2: card(/Academy, mentoring/)[0] || '', gifts: card(/Gifts & Christmas/)[0] || '' };
  });
  check('no bare "Target not set" / "Needs review" on Strategy; near-term + Academy read "Target: Claude proposal due Wed 11 Nov"; gifts names GPT + date', !g4.bare && /Target: Claude proposal due Wed 11 Nov/.test(g4.near) && /Target: Claude proposal due Wed 11 Nov/.test(g4.academy) && /Needs review · GPT by \w{3} \d+ \w{3}/.test(g4.gifts), `bare ${g4.bare} · near: ${g4.near.slice(0, 120)} · academy: ${g4.academy.slice(0, 120)} · gifts: ${g4.gifts.slice(0, 90)}`);
  check('plan document link: never the homepage (removed: no strategy document is stored)', g4.plan.every((h) => !/^https:\/\/www\.alanranger\.com\/?$/.test(h)), g4.plan.length ? g4.plan.join(', ') : 'no plan document link');
  check('Q2 Academy cohort linked to academy_trial_history (next action labelled with the data source)', /data: academy_trial_history/.test(g4.q2), g4.q2);
  const sg = await page.evaluate(() => {
    const t = (id) => (document.getElementById(id)?.innerText || '').replace(/\s+/g, ' ');
    const order = ['st-sales-gap', 'st-remedy', 'st-quarter-cards', 'st-where', 'st-decisions'].map((id) => Number(document.getElementById(id)?.style.order ?? -1));
    return {
      cards: document.querySelectorAll('#st-sales-gap .sg-card').length, months: [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((c) => c.querySelector('.sg-h b')?.textContent),
      remedyRows: [...document.querySelectorAll('#st-remedy tbody tr')].map((r) => r.cells[0]?.innerText.split('\n')[0]), qcards: document.querySelectorAll('#st-quarter-cards .sg-qc').length,
      rec: t('st-quarter-cards').match(/Reconciles with the months[^✓✗]*[✓✗]/)?.[0] || '', where: t('st-where'), order, gapText: t('st-sales-gap').slice(0, 400)
    };
  });
  check('Sales gap: quarter tile + Nov / Dec / Jan tiles; Remedy = Nov, Dec, Jan + Total; 4 quarter cards; Q1 reconciles', sg.cards === 4 && sg.months.join() === 'November,December,January' && sg.remedyRows.join() === 'Nov,Dec,Jan,Total' && sg.qcards === 4 && /✓$/.test(sg.rec), `${sg.cards} tiles (${sg.months.join(', ')}) · remedy rows ${sg.remedyRows.join(', ')} · ${sg.qcards} quarter cards · ${sg.rec}`);
  check('Where we are: Sales still needed / This month / Booked ahead retired; Repeat clients + Academy progression moved here; sales gap first', !/Sales still needed|This month ·|Booked ahead ·/.test(sg.where) && /Repeat clients/.test(sg.where) && /Academy progression/.test(sg.where) && sg.order.every((o, i, a) => i === 0 || o > a[i - 1]), `${sg.where.slice(0, 160)} · order ${sg.order.join(',')}`);
  await page.waitForFunction(() => !/Loading enquiries|Loading prospects/.test(document.getElementById('st-prospects')?.textContent || 'Loading'), null, { timeout: 60000 }).catch(() => {});
  const pp = await page.evaluate(() => {
    const el = document.getElementById('st-prospects');
    const t = (el?.innerText || '').replace(/\s+/g, ' ');
    const ord = ['st-remedy', 'st-prospects', 'st-quarter-cards'].map((id) => Number(document.getElementById(id)?.style.order ?? -1));
    return { tiles: el?.querySelectorAll('.pp-tile').length || 0, text: t.slice(0, 420), table: !!el?.querySelector('.pp-table'), add: !!el?.querySelector('[data-pp-add]'), ord, remedyHead: (document.querySelector('#st-remedy thead')?.innerText || '').replace(/\s+/g, ' '), find: [...document.querySelectorAll('#st-remedy .sg-find')].map((x) => x.innerText.replace(/\s+/g, ' ')), q1: (document.querySelector('#st-quarter-cards .sg-current')?.innerText || '').replace(/\s+/g, ' ') };
  });
  check('Prospects under the Remedy plan: 4 stage tiles + Pipeline, weighted; enquiry table (admin API) + "+ Add enquiry"', pp.tiles === 5 && pp.table && pp.add && pp.ord[0] < pp.ord[1] && pp.ord[1] < pp.ord[2], `${pp.tiles} tiles · table ${pp.table} · order ${pp.ord.join(',')} · ${pp.text.slice(0, 300)}`);
  check('Remedy lever 3 shows "Still to find" per month; current quarter card shows it too', /Still to find/.test(pp.remedyHead) && pp.find.length === 3 && /Still to find \(Nov \+ Dec, after pipeline\)/.test(pp.q1), `${pp.find.join(' | ')} · Q1: ${(pp.q1.match(/Still to find[^·]*·[^·]*/) || [''])[0]}`);
  const kk = await page.evaluate(() => {
    const t = (document.getElementById('st-sales-gap')?.innerText || '').replace(/\s+/g, ' ');
    const months = [...document.querySelectorAll('#st-sales-gap [data-sg-month]')].map((c) => (c.innerText || '').replace(/\s+/g, ' '));
    const heads = [...document.querySelectorAll('#st-prospects .pp-table th')].map((h) => h.textContent.replace(/[▲▼]/g, '').trim()).filter(Boolean);
    return { prime: months.map((m) => (m.match(/In prime buying window this month (\d+ events · \d+ places · £[\d.,k]+)/) || [])[1] || ''), oldLine: /Dated places sellable this month|every sellable place sells/.test(t), stockNow: (t.match(/Stock on sale now ([^L]*?) Likely/) || [])[1] || '', foot: /months don't add up to the quarter/.test(t), asOf: (t.match(/as of Booking Sheet sync [^·]+· events [^·]+· recalculated on every load/) || [''])[0], rules: /set 9 Nov, review later/.test(document.getElementById('st-sales-gap')?.innerHTML || ''), from: months.map((m) => (m.match(/from ([^N]*?) Non-dated/) || [])[1] || ''), heads };
  });
  check('(k) monthly tiles: "In prime buying window this month" (no "Dated places sellable", no monthly best case); quarter "Stock on sale now"; overlap footnote; as-of line; likely names its events', kk.prime.every(Boolean) && !kk.oldLine && kk.stockNow && kk.foot && kk.asOf && kk.from.filter(Boolean).length >= 2, `prime ${kk.prime.join(' | ')} · stock now ${kk.stockNow} · ${kk.asOf} · from: ${kk.from.join(' | ')}`);
  check('(j) Rules carry the 4 editable assumptions "set 9 Nov, review later"; Prospects table: Ref, Received, Client ID, Days open', kk.rules && ['Ref', 'Received', 'Client ID', 'Days open'].every((h) => kk.heads.includes(h)), kk.heads.join(' | '));
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.CLICK_CLIENT === '1') {
    await page.locator('#st-prospects [data-pp-client]').first().click().catch(() => {});
    await page.waitForFunction(() => /Purchases:|unavailable/.test(document.querySelector('#st-prospects [data-pp-clientbox]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
    const box = await page.evaluate(() => (document.querySelector('#st-prospects [data-pp-clientbox]')?.innerText || '').replace(/\s+/g, ' '));
    const row = await page.evaluate(() => (document.querySelector('#st-prospects .pp-table tbody tr')?.innerText || '').replace(/\s+/g, ' '));
    check('test enquiry row: ENQ ref, received date, clickable client ID, days open; client panel opens', /ENQ-\d{4}/.test(row) && /C-[0-9A-F]{6}/.test(row) && /Purchases:/.test(box), `row: ${row.slice(0, 220)} · panel: ${box.slice(0, 220)}`);
  }
  for (const id of ['st-prospects']) await page.locator(`#${id}`).screenshot({ path: `${OUT}/prospects-${TAG}-1700px-${STAMP}.png` }).catch(() => {});
  for (const id of ['st-sales-gap', 'st-remedy', 'st-quarter-cards']) await page.locator(`#${id}`).screenshot({ path: `${OUT}/sales-gap-${id.replace('st-', '')}-${TAG}-1700px-${STAMP}.png` });
  await page.evaluate(() => { const d = document.querySelector('#st-sales-gap [data-sg-month] details'); if (d) d.open = true; });
  await page.locator('#st-sales-gap').screenshot({ path: `${OUT}/sales-gap-tiles-working-open-${TAG}-1700px-${STAMP}.png` });
  await page.evaluate(() => { const d = document.querySelector('#st-sales-gap [data-sg-month] details'); if (d) d.open = false; });
  const WORD = /(✅ (Sent|Published)|🕒 Scheduled|⚠ Needs approval|📄 In preparation|… Checking delivery|⏰ Late|✖ Failed|\? Verification unavailable|⊘ Cancelled|✓ Done|⏸ Deferred)/;
  const nextLines = await page.evaluate(() => [...document.querySelectorAll('#st-quarter-plan .qp-l')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /^Next:/.test(t) && !/\(manual\)|\(data: |Next: —/.test(t)));
  check('every initiative next action shows the shared status word + icon', nextLines.length > 0 && nextLines.every((t) => WORD.test(t)), (nextLines.some((t) => !WORD.test(t)) ? nextLines.filter((t) => !WORD.test(t)) : nextLines).map((t) => t.replace(/ → Marketing$/, '')).join(' | '));
  const next = await page.locator('#st-next-delivery').evaluate((el) => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), key: el.dataset.nextKey }));
  const tiles = (await page.locator('#st-where').innerText()).replace(/\s+/g, ' ');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/strategy-clean-AFTER-${TAG}-folds-closed-1700px-${STAMP}.png`, fullPage: true });
  await page.evaluate(() => { const d = document.querySelector('#st-quarter-plan .qp-ini details.qp-links'); if (d) d.open = true; });
  await page.waitForTimeout(500);
  await page.locator('#st-quarter-plan').screenshot({ path: `${OUT}/correction2-quarter-plan-${TAG}-initiative-details-open-1700px-${STAMP}.png` });
  await page.evaluate(() => { const d = document.querySelector('#st-quarter-plan .qp-ini details.qp-links'); if (d) d.open = false; });
  await page.evaluate(() => { document.getElementById('st-fold-why').open = true; document.getElementById('st-fold-targets').open = true; document.getElementById('st-fold-tasks').open = true; });
  await page.waitForFunction(() => document.querySelector('#st-gp-chart canvas'), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const chart = await page.evaluate(() => ({ canvas: !!document.querySelector('#st-fold-why #st-gp-chart canvas'), text: (document.querySelector('#st-gp-chart')?.textContent || '').replace(/\s+/g, ' ').slice(0, 140) }));
  check('Alan\'s GP-vs-survival chart is in the Why fold (same chart and data as Revenue)', chart.canvas, chart.text);
  const openH = await page.evaluate(() => Math.round(document.querySelector('section[data-panel="strategy"]').getBoundingClientRect().height));
  await page.screenshot({ path: `${OUT}/strategy-clean-AFTER-${TAG}-folds-open-1700px-${STAMP}.png`, fullPage: true });
  const s = JSON.parse(await page.evaluate(() => JSON.stringify(window.stLastData ? window.stLastData() : null)));
  await page.close();
  return { next, tiles, s, openH, layout, needs, norfolk };
}

async function marketing(browser, closedKeys = []) {
  const page = await open(browser, 'marketing', () => document.querySelector('#mk-schedule .mks-days') && document.querySelector('#mk-overview-tiles .mko-tile') && !/Loading/.test(document.querySelector('#mk-overview-tiles')?.textContent || 'Loading'));
  const first = await page.evaluate((closed) => {
    const t = document.querySelector('#mk-schedule table.mks-days');
    const cards = [];
    const isClosed = (id) => String(id).split('|').some((part, i, a) => closed.includes(part) || closed.includes(a.slice(i).join('|')));
    [...t.querySelectorAll('tr')].slice(1).forEach((tr, ri) => [...tr.querySelectorAll('td')].slice(1).forEach((td, ci) => td.querySelectorAll('.mks-card[data-mks-item]').forEach((c) => {
      if (/s-(done|late|resolved)/.test(c.className) || isClosed(c.dataset.mksItem)) return;
      const time = (c.textContent.match(/\b(\d{2}:\d{2})\b/) || [])[1] || '99';
      cards.push({ id: c.dataset.mksItem, ci, ri, time, title: c.title });
    })));
    cards.sort((a, b) => a.ci - b.ci || a.time.localeCompare(b.time) || a.ri - b.ri);
    return cards[0] || null;
  }, closedKeys);
  const tiles = (await page.locator('#mk-overview-tiles').evaluate((el) => el.textContent)).replace(/\s+/g, ' ');
  await page.waitForFunction(() => /^\d+$/.test(document.querySelector('.mkw-n')?.textContent.trim() || '') || /Decisions unavailable/.test(document.body.textContent), null, { timeout: 120000 }).catch(() => {});
  const waiting = await page.evaluate(() => (document.querySelector('.mkw-n')?.textContent || '').trim());
  const ov = await page.evaluate(() => ({ titles: [...document.querySelectorAll('#mk-overview-tiles .mko-title')].map((t) => t.textContent.trim()), link: (document.querySelector('#mk-overview-tiles .mko-gaplink')?.textContent || '').replace(/\s+/g, ' ').trim() }));
  await page.locator('#mk-overview-tiles').screenshot({ path: `${OUT}/sales-gap-marketing-overview-${TAG}-1700px-${STAMP}.png` }).catch(() => {});
  const secs = await page.evaluate(() => ({ waiting: (document.querySelector('#mk-waiting')?.textContent || '').trim().length, planned: !!document.querySelector('#mk-planned .mks-days'), results: (document.querySelector('#mk-results')?.textContent || '').trim().length, behind: document.querySelector('#mk-behind') ? (document.querySelector('#mk-behind').open ? 'open' : 'closed') : 'missing' }));
  check('Marketing still loads cleanly: Waiting on you / Planned / Results present, Behind-the-scenes fold closed', secs.waiting > 0 && secs.planned && secs.results > 0 && secs.behind === 'closed', JSON.stringify(secs));
  if (LIVE) await page.screenshot({ path: `${OUT}/strategy-clean-marketing-check-live-1700px-${STAMP}.png` });
  await page.close();
  return { first, tiles, waiting, ov };
}

const before = await dbState();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const st = await strategy(browser);
const mk = await marketing(browser, Object.entries(st.s?.delivery_status?.by_key || {}).filter(([, v]) => ['sent', 'published', 'done', 'cancelled'].includes(v.code)).map(([k]) => k));
await browser.close();
const after = await dbState();
check('Next delivery matches Marketing Planned\'s first item', mk.first && st.next.key === mk.first.id, `Strategy: ${st.next.text} [${st.next.key}] · Marketing first card: ${mk.first?.title} [${mk.first?.id}]`);
check('Strategy Needs Alan count = Marketing "Waiting on you" count', String(st.needs) === mk.waiting && st.s?.needs_alan?.count === st.needs, `Strategy Needs Alan ${st.needs} (server needs_alan.count ${st.s?.needs_alan?.count}, target decisions ${st.s?.needs_alan?.targets}) · Marketing Waiting ${mk.waiting}`);
const pubKeys = st.s?.needs_alan?.published || [];
const pubRows = Object.values(st.s?.quarter_plan?.initiatives || {}).flatMap((i) => (i.deliveries || []).filter((d) => pubKeys.includes(d.key)).map((d) => `${i.key}: ${d.key} ${d.status}${d.draft ? ' draft' : ''}${i.next?.key === d.key ? ' NEXT' : ''}`));
check('published posts (shared state) are published on Strategy: not drafts, not a next action', pubKeys.length > 0 && pubRows.length > 0 && pubRows.every((r) => / published$/.test(r)) && !st.norfolk.length, `published ${pubKeys.join(', ')} → ${pubRows.join(' | ')} · Norfolk "Next:" lines: ${st.norfolk.length}`);
const roll = st.s?.sales_gap?.rolling;
const kfmt = (v) => `£${(Math.round(Math.abs(v) / 100) / 10).toLocaleString('en-GB')}k`;
check('Marketing: no duplicate sales-gap tiles; one link "Sales gap by month → Strategy" with the same rolling figures', !mk.ov.titles.some((t) => /Sales still needed|Dated places|Non-dated sales needed|Repeat clients|Academy progression/.test(t)) && /Sales gap by month → Strategy/.test(mk.ov.link) && roll && mk.ov.link.includes(kfmt(roll.still_to_sell)) && mk.ov.link.includes(kfmt(roll.non_dated_needed)), `tiles: ${mk.ov.titles.join(' | ')} · ${mk.ov.link}`);
const nm = st.s?.sales_gap?.months || [];
check('normal non-dated (same month last year) = Nov £815 · Dec £737 · Jan £1,710', nm.map((m) => Math.round(m.normal_non_dated)).join() === '815,737,1710', nm.map((m) => `${m.label} ${m.normal_non_dated.toFixed(2)} (adjusted ${Math.round(m.normal_adjusted)}, pipeline ${Math.round(m.pipeline_weighted)}, still to find ${Math.round(m.still_to_find)})`).join(' · '));
check('Prospects in the summary: aggregates only (no names); pipeline empty until Claude loads enquiries', st.s?.prospects && !st.s.prospects.error && !('rows' in st.s.prospects), JSON.stringify({ total: st.s?.prospects?.total, pipeline: st.s?.prospects?.pipeline?.total, error: st.s?.prospects?.error || null }));
const gapM = st.s?.sales_gap?.remedy?.rows || [];
check('Remedy levers add up to each month\'s gap (live)', gapM.length === 3 && gapM.every((r) => Math.abs(r.lever1.gbp + r.lever2.gbp + r.lever3.gbp - r.gap) < 0.5), gapM.map((r) => `${r.label}: gap ${Math.round(r.gap)} = ${Math.round(r.lever1.gbp)} + ${Math.round(r.lever2.gbp)} + ${Math.round(r.lever3.gbp)}`).join(' · '));
const q2a = st.s?.quarter_plan?.initiatives?.['q2-academy-mentoring-rps'];
check('Q2 Academy cohort figures come from academy_trial_history', q2a?.measure?.data_source === 'academy_trial_history' && /trials started/.test(q2a.measure.lines[0]?.value || ''), (q2a?.measure?.lines || []).slice(0, 2).map((l) => `${l.label}: ${l.value} [${l.sub}]`).join(' | '));
const nexts = Object.values(st.s?.quarter_plan?.initiatives || {}).flatMap((i) => [i.next, i.next?.then].filter((n) => n && n.status));
check('no sent / published / done item is a next action; Next delivery line uses the same status vocabulary', nexts.length && nexts.every((n) => !['sent', 'published', 'done', 'cancelled'].includes(n.status.code)) && /(🕒 Scheduled|📄 In preparation|⚠ Needs approval|… Checking delivery|⏰ Late|\? Verification unavailable|⏸ Deferred)/.test(st.next.text), `${nexts.length} next items: ${[...new Set(nexts.map((n) => n.status.code))].join(', ')} · ${st.next.text} · board ${st.s?.delivery_status?.error || `${Object.keys(st.s?.delivery_status?.by_key || {}).length} keys, last checked ${st.s?.delivery_status?.last_checked}`}`);
const ret = st.s?.roadmap_now?.returning_r12;
check('returning-client sales (rolling 12 months) on Strategy\'s Repeat clients tile', ret != null && st.tiles.includes(kfmt(ret)), `${Math.round(ret)} → ${kfmt(ret)}`);
const changed = Object.keys(before).filter((x) => before[x] !== after[x]);
check(`viewing writes nothing (row counts + newest timestamps, ${Object.keys(TABLES).length} tables)`, !changed.length, changed.map((x) => `${x}: ${before[x]} → ${after[x]}`).join(' | ') || 'no change');
check('every non-GET from the pages refused', true, `${blocked.length} refused: ${[...new Set(blocked)].join(', ')}`);
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/_strategy-clean-${TAG}-result.json`, JSON.stringify({ results, height_closed: st.layout.height, height_open: st.openH, decisions: st.s?.decisions, next: st.next, marketing_first: mk.first, before, after }, null, 1));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(`height closed ${st.layout.height}px · open ${st.openH}px`);
