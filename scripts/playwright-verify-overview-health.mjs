/**
 * Live check (Agent D, 8 Nov 2026) of the Marketing Overview 10 tiles + Client list health panel against the
 * independent expected figures from scripts/verify-overview-health-sql.mjs (run that first).
 *   node scripts/playwright-verify-overview-health.mjs [expected.json]
 * Env: DASH_BASE (default live Vercel), PANE_VIEWPORT (default 1250 → Marketing pane ≈ 800 px), SKIP_CLICKS=1.
 * Screenshots stay LOCAL (they can show names): C:/TEMP/overview-health-verify. Read-only: nothing is saved or sent.
 * All selectors live in SEL below so they can be adjusted in one place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const URL = `${BASE}/audit-dashboard.html?tab=marketing#marketing`;
const EXPECTED = process.argv[2] || 'C:/TEMP/overview-health-expected.json';
const OUT = 'C:/TEMP/overview-health-verify';
const PANE_VIEWPORT = Number(process.env.PANE_VIEWPORT) || 1250;
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
const X = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

/** Agent B: lib/marketing-overview-tiles.js · Agent C: lib/marketing-client-health.js · Customers: lib/marketing-query*.js */
const SEL = {
  tilesHost: '#mk-overview-tiles',
  tile: '#mk-overview-tiles .mko-tile',
  tileGrid: '#mk-overview-tiles .mko-grid',
  rowLabel: '#mk-overview-tiles .mko-row',
  tileTitle: '.mko-title', tileHead: '.mko-head', tileLine: '.mko-line', tileSrc: '.mko-src',
  ragClass: /\br-(red|amber|green|grey)\b/,
  tile9Go: '#mk-overview-tiles .mko-tile[data-mko-go="health"]',
  panel: '#mk-client-health',
  card: '#mk-client-health .ch-card', cardTitle: '.ch-ct', cardBig: '.ch-big',
  matrix: '#mk-client-health .ch-matrix',
  num: '.ch-num',
  note: '#mk-client-health .ch-note',
  legendItem: '#mk-client-health .ch-legend .ch-leg',
  healthHeading: '#mk-client-health h4',
  customersMatch: '#mq-match',
  customersLoading: '#mq-results .rt-loading'
};
const TITLES = ['Sales still needed', 'Dated places', 'Non-dated sales needed', 'Repeat clients', 'Academy progression', 'Next 4 weeks: content mix', 'Needs Alan', 'Email allowance', 'Eligible audience', 'Data & alignment health'];
const ROW_SIZES = [3, 3, 4];
const COL_OF = [[/no squarespace contact/i, 'no_contact'], [/no email held/i, 'no_email'], [/not subscribed/i, 'not_subscribed'], [/blocked/i, 'blocked'], [/can email/i, 'can_email']];
const BAND_OF = [[/^0\D6/, 'm0_6'], [/^6\D12/, 'm6_12'], [/^12\D24/, 'm12_24'], [/^24\+/, 'm24p'], [/^No evidenced/i, 'none'], [/^Unknown/i, 'unknown']];
const STATE_OF = [[/^Hot/, 'hot'], [/^Warm, click/, 'warm_click'], [/^Warm, open/, 'warm_open'], [/^Cooling/, 'cooling'], [/^Cold/, 'cold'], [/^No recorded/, 'no_response'], [/^Too few/, 'too_few'], [/^Unknown/, 'unknown']];

const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note: String(note) });
const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const intIn = (txt, re) => { const m = String(txt).replace(/,/g, '').match(re); return m ? Number(m[1]) : null; };
const pick = (pairs, txt) => pairs.find(([re]) => re.test(String(txt).trim()))?.[1] || null;
const k = (v) => { const a = Math.abs(Number(v)); return a >= 1000 ? `£${(Math.round(a / 100) / 10).toLocaleString('en-GB')}k` : `£${Math.round(a).toLocaleString('en-GB')}`; };
const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const browser = await chromium.launch({ headless: true, channel: 'chrome' });

async function openAt(width) {
  const page = await browser.newPage({ viewport: { width, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((kk) => { sessionStorage.setItem('arp_admin_key', kk); }, key);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await waitTiles(page);
  return { page, errors };
}

/** 10 tiles present, Strategy tiles filled (no "Loading…"), tile 9 buyer split filled (no "…"). */
async function waitTiles(page) {
  await page.waitForSelector(SEL.tile, { timeout: 180000 }).catch(() => {});
  await page.waitForFunction((s) => {
    const t = [...document.querySelectorAll(s.tile)];
    return t.length === 10 && !t.some((x) => /Loading…/.test(x.textContent)) && !/not email-eligible: …/.test(t[8].textContent);
  }, SEL, { timeout: 180000 }).catch(() => {});
}

async function readTiles(page) {
  return page.$$eval(SEL.tile, (els, s) => els.map((e) => ({
    cls: e.className,
    title: e.querySelector(s.tileTitle)?.firstChild?.textContent?.trim() || '',
    head: e.querySelector(s.tileHead)?.textContent?.trim() || '',
    lines: [...e.querySelectorAll(s.tileLine)].map((l) => l.textContent.trim()),
    src: e.querySelector(s.tileSrc)?.textContent?.trim() || '',
    titleColor: getComputedStyle(e.querySelector(s.tileTitle) || e).color,
    titleWeight: Number(getComputedStyle(e.querySelector(s.tileTitle) || e).fontWeight),
    overflow: e.scrollWidth > e.clientWidth + 2,
    width: Math.round(e.getBoundingClientRect().width)
  })), SEL);
}

const ragOf = (t) => (t.cls.match(SEL.ragClass) || [])[1] || 'none';
const text = (t) => [t.head, ...t.lines].join(' | ');

// ---------- tile checks ----------
function layoutChecks(tiles, grids, rowLabels, tag) {
  check(`${tag}: 10 tiles`, tiles.length === 10, tiles.length);
  check(`${tag}: 3 rows of 3 / 3 / 4`, JSON.stringify(grids) === JSON.stringify(ROW_SIZES), JSON.stringify(grids));
  check(`${tag}: row A label says don't add them`, /don.t add them/i.test(rowLabels[0] || ''), rowLabels[0]);
  check(`${tag}: titles in order`, JSON.stringify(tiles.map((t) => t.title)) === JSON.stringify(TITLES), tiles.map((t) => t.title).join(' | '));
  check(`${tag}: titles white + bold`, tiles.every((t) => t.titleColor === 'rgb(255, 255, 255)' && t.titleWeight >= 700), `${tiles[0]?.titleColor} ${tiles[0]?.titleWeight}`);
  check(`${tag}: no tile wider than its box`, tiles.every((t) => !t.overflow), tiles.filter((t) => t.overflow).map((t) => t.title).join(','));
  check(`${tag}: every tile has a source line`, tiles.every((t) => t.src.length > 5));
}

function ragChecks(tiles) {
  const rag = tiles.map(ragOf);
  check('RAG: every tile has a RAG class', rag.every((r) => r !== 'none'), rag.join(','));
  check('RAG: tile 6 (not available) is grey', rag[5] === 'grey', rag[5]);
  check('RAG: tiles 7, 8, 9 never red (normal states)', ![rag[6], rag[7], rag[8]].includes('red'), rag.slice(6, 9).join(','));
  check('RAG: tile 10 red only when Blocked', rag[9] !== 'red' || /^Blocked/.test(tiles[9].head), `${rag[9]} · ${tiles[9].head}`);
  return rag;
}

function moneyChecks(tiles) {
  const n3 = X.strategy.money_next_3;
  const m = X.strategy.money_this_month;
  check('tile 1 = Strategy required to 31 Jan', tiles[0].head.includes(k(n3.required)), `${tiles[0].head} vs ${k(n3.required)}`);
  check('tile 1 month split as Strategy', text(tiles[0]).includes(String(n3.month_split).split(' (')[0]), n3.month_split);
  check('tile 1 "November so far" with Strategy sales + target', /November so far/.test(text(tiles[0])) && text(tiles[0]).includes(`£${Math.round(m.sales).toLocaleString('en-GB')}`) && text(tiles[0]).includes(`£${m.sales_target.toLocaleString('en-GB')}`), tiles[0].lines.join(' | '));
  check('tile 2 = potential / likely / in hand', [k(n3.potential), k(n3.forecast), k(n3.inHand)].every((v) => text(tiles[1]).includes(v)), `${text(tiles[1])} vs ${k(n3.potential)} ${k(n3.forecast)} ${k(n3.inHand)}`);
  check('tile 3 = non-dated alternatives + last year', [k(n3.nonDated), k(n3.nonDatedIfForecast), k(n3.lyNonDated)].every((v) => text(tiles[2]).includes(v)) && /not added/.test(text(tiles[2])), text(tiles[2]));
}

function repeatChecks(tile) {
  const r = X.strategy.mix_returning;
  const t4 = text(tile);
  const [, , gbp12, msCell] = r.returning_gbp_12m || [];
  const ms = /milestone (£[\d.]+k)/.exec(String(msCell || ''))?.[1];
  check('tile 4 = returning £ rolling 12m', t4.includes(String(gbp12)), `${tile.head} vs ${gbp12}`);
  check('tile 4 next dated milestone + £ behind', (!ms || t4.includes(ms)) && /behind|reached/.test(t4), `${ms} · ${tile.lines[0]}`);
  check('tile 4 repeat rate with denominator', t4.includes(`${(r.of || [])[0]} of ${(r.of || [])[1]}`) && t4.includes(String(r.headline)), `${r.headline} ${r.of}`);
  const plan = (r.plan_payments_12m || [])[2];
  check('tile 4 plan payments line (spec)', plan ? t4.includes(String(plan)) : /plan payments/.test(t4), plan ? `${plan} · ${tile.lines.join(' | ')}` : `Strategy returning tile has no plan-payments row right now · ${tile.lines.join(' | ')}`);
}

function academyChecks(tile, tile6) {
  const a = X.strategy.mix_academy;
  const t5 = text(tile);
  const parts = [...(a.trials || []).slice(2, 4), ...(a.new_paying || []).slice(2, 4)].map((v) => String(v).replace(/^[-+]/, ''));
  check('tile 5 = paying members', tile.head.startsWith(String(a.paying)), `${tile.head} vs ${a.paying}`);
  check('tile 5 trials + new paying with Δ vs Jan–Mar', parts.length === 4 && parts.every((v) => t5.includes(v)) && /Jan.Mar/.test(t5), t5);
  check('tile 5 no trial→paid ratio figure', /No trial.paid ratio/i.test(t5) && !/trial.paid ratio\s*\d/i.test(t5));
  const t6 = text(tile6);
  check('tile 6 interim not-available state with owner + next step', /Not yet available/.test(tile6.head) && /Interim/.test(t6) && /Owner/.test(t6) && !/\d+\s*(Sell|Educate|Inspire|Nurture)/.test(t6), t6);
}

function mixChecks(tiles) {
  repeatChecks(tiles[3]);
  academyChecks(tiles[4], tiles[5]);
}

function deliveryChecks(tiles) {
  const t7 = text(tiles[6]);
  const late = X.tile7_inputs.late[0];
  check('tile 7 headline = decision count', /^(\d+ decisions?|No decisions waiting)/.test(tiles[6].head), tiles[6].head);
  check('tile 7 late item with its original due date', !late || (t7.includes(late.label) && t7.includes(ukDay(late.due)) && /late/i.test(t7)), late ? `${late.label} due ${ukDay(late.due)} · ${tiles[6].lines[0]}` : 'none late');
  check('tile 7 waiting-on-trigger shown, not counted late', new RegExp(`${X.tile7_inputs.waiting_on_trigger} waiting on trigger`).test(t7), tiles[6].lines.join(' | '));
  check('tile 7 next due item', !X.tile7_inputs.next_due || t7.includes(X.tile7_inputs.next_due.label), X.tile7_inputs.next_due?.label);
  const m = X.tile8;
  const stale = m.meter_age_hours > 24;
  check('tile 8 = sqs_send_meter left after reservations', num(tiles[7].head) === m.left_after_reservations, `${tiles[7].head} vs ${m.left_after_reservations}`);
  check('tile 8 used / quota / reserved line', text(tiles[7]).includes(`${m.used.toLocaleString('en-GB')} of ${m.quota.toLocaleString('en-GB')} used`) && text(tiles[7]).includes(`${m.reserved} reserved`), tiles[7].lines[0]);
  const shownStale = /STALE/.test(tiles[7].head);
  check('tile 8 stale handling (STALE ⇒ amber, never red / 0; > 24 h old ⇒ STALE)', (!shownStale || ragOf(tiles[7]) === 'amber') && (!stale || shownStale) && ragOf(tiles[7]) !== 'red' && (m.left_after_reservations === 0 || num(tiles[7].head) !== 0), `age ${m.meter_age_hours} h · ${ragOf(tiles[7])} · ${tiles[7].head}`);
  check('tile 8 shows meter read time', /read /.test(tiles[7].src), tiles[7].src);
}

function audienceChecks(tiles) {
  const c = X.cards.recent_buyers_not_email_eligible;
  const t9 = text(tiles[8]);
  check('tile 9 "N can be emailed" = independent count', intIn(tiles[8].head, /^(\d+) can be emailed/) === X.tile9.can_be_emailed, `${tiles[8].head} vs ${X.tile9.can_be_emailed}`);
  const m = t9.replace(/,/g, '').match(/(\d+) recent buyers \(12 months\) not email-eligible: (\d+) not subscribed · (\d+) blocked · (\d+) no email held/);
  check('tile 9 text pattern', !!m, tiles[8].lines[0]);
  check('tile 9 split = independent card', m && Number(m[1]) === c.total && Number(m[2]) === c.not_subscribed && Number(m[3]) === c.blocked && Number(m[4]) === c.no_email_held, `${m?.slice(1).join('/')} vs ${c.total}/${c.not_subscribed}/${c.blocked}/${c.no_email_held}`);
  check('tile 9 email-no-contact shown only when > 0', c.email_no_squarespace_contact > 0 ? /email, no Squarespace contact/.test(t9) : !/email, no Squarespace contact/.test(t9));
  check('tile 10 headline Ready / Attention · N / Blocked · N', /^(Ready|Attention · \d+|Blocked · \d+)/.test(tiles[9].head), `${tiles[9].head} · ${tiles[9].lines[0]}`);
}

/** Hide fixed overlays (e.g. the debug log bar) in this test browser only, so element screenshots aren't covered. */
async function hideOverlays(page) {
  await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden'; });
}

async function screenshotRows(page, tag) {
  await hideOverlays(page);
  const grids = page.locator(SEL.tileGrid);
  for (let i = 0; i < await grids.count(); i += 1) await grids.nth(i).screenshot({ path: path.join(OUT, `${tag}-row-${'ABC'[i]}.png`) });
  await page.locator(SEL.tilesHost).screenshot({ path: path.join(OUT, `${tag}-tiles-all.png`) });
}

async function tileSuite(page, tag, full) {
  const tiles = await readTiles(page);
  const grids = await page.$$eval(SEL.tileGrid, (els) => els.map((g) => g.querySelectorAll('.mko-tile').length));
  const rowLabels = await page.$$eval(SEL.rowLabel, (els) => els.map((e) => e.textContent));
  layoutChecks(tiles, grids, rowLabels, tag);
  await screenshotRows(page, tag);
  if (!full) return tiles;
  const rag = ragChecks(tiles);
  moneyChecks(tiles);
  mixChecks(tiles);
  deliveryChecks(tiles);
  audienceChecks(tiles);
  console.log('tiles read:', JSON.stringify(tiles.map((t, i) => ({ n: i + 1, rag: rag[i], head: t.head }))));
  return tiles;
}

// ---------- client list health ----------
async function openPanel(page) {
  await page.click(SEL.tile9Go);
  await page.waitForSelector(SEL.matrix, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function readMatrix(page) {
  return page.$eval(SEL.matrix, (tbl, s) => {
    const first = (td) => (td?.querySelector(s.num)?.textContent ?? td?.textContent ?? '').trim();
    const cols = [...tbl.querySelectorAll('thead th')].map((th) => th.firstChild?.textContent?.trim() || th.textContent.trim());
    const rows = [...tbl.querySelectorAll('tbody tr')].map((tr) => ({ label: tr.querySelector('td')?.querySelector('b')?.textContent?.trim() || tr.querySelector('td')?.textContent?.trim(), cells: [...tr.querySelectorAll('td')].slice(1).map(first), hl: [...tr.querySelectorAll('td')].slice(1).map((td) => ({ hl: td.classList.contains('hl'), sub: td.querySelector('.ch-sub')?.textContent?.trim() || '' })) }));
    const foot = [...tbl.querySelectorAll('tfoot td')].slice(1).map(first);
    return { cols, rows, foot };
  }, SEL);
}

/** Expected matrix = panel universe (people + Alan's own records, marked); organisations apart. */
function matrixChecks(mx) {
  const M = X.matrix_panel;
  const colKeys = mx.cols.slice(1, -1).map((c) => pick(COL_OF, c));
  check('matrix: 5 consent columns recognised', colKeys.length === 5 && colKeys.every(Boolean), mx.cols.join(' | '));
  check('matrix: 6 purchase rows recognised', mx.rows.length === 6 && mx.rows.every((r) => pick(BAND_OF, r.label)), mx.rows.map((r) => r.label).join(' | '));
  const bad = [];
  for (const r of mx.rows) {
    const b = pick(BAND_OF, r.label);
    colKeys.forEach((c, i) => { if (b && c && num(r.cells[i]) !== M.cells[b][c]) bad.push(`${b}×${c} ${r.cells[i]} vs ${M.cells[b][c]}`); });
    if (b && num(r.cells[5]) !== M.row_totals[b]) bad.push(`${b} total ${r.cells[5]} vs ${M.row_totals[b]}`);
  }
  colKeys.forEach((c, i) => { if (c && num(mx.foot[i]) !== M.col_totals[c]) bad.push(`col ${c} ${mx.foot[i]} vs ${M.col_totals[c]}`); });
  if (num(mx.foot[5]) !== M.total) bad.push(`grand ${mx.foot[5]} vs ${M.total}`);
  check('matrix: all 30 cells + row/col/grand totals = independent SQL (people + own address)', !bad.length, bad.join(' · ') || '36 numbers equal');
  return colKeys;
}

function amberChecks(mx, colKeys) {
  const bad = [];
  for (const r of mx.rows) {
    const b = pick(BAND_OF, r.label);
    colKeys.forEach((c, i) => {
      const want = (b === 'm0_6' || b === 'm6_12') && c !== 'can_email';
      if (want !== r.hl[i].hl) bad.push(`${b}×${c} highlight ${r.hl[i].hl}`);
      const exp = X.amber_cells[b]?.[c];
      if (want && exp?.booked_ahead && intIn(r.hl[i].sub, /(\d+) booked ahead/) !== exp.booked_ahead) bad.push(`${b}×${c} booked ahead "${r.hl[i].sub}" vs ${exp.booked_ahead}`);
    });
  }
  check('matrix: amber = recent-buyer non-eligible cells only; booked-ahead counts', !bad.length, bad.slice(0, 6).join(' · '));
}

async function readCards(page) {
  return page.$$eval(SEL.card, (els, s) => els.map((e) => ({ title: e.querySelector(s.cardTitle)?.textContent?.trim(), big: e.querySelector(s.cardBig)?.textContent?.trim(), text: e.textContent.replace(/\s+/g, ' ') })), SEL);
}

function cardChecks(cards) {
  const C = X.cards_panel;
  const by = (re) => cards.find((c) => re.test(c.title || '')) || { text: '', big: '' };
  const r = by(/Recent buyers/);
  const l = by(/Lapsed buyers/);
  const s = by(/no evidenced purchase/);
  const u = by(/history unknown/);
  check('4 cards with approved titles', cards.length === 4 && [r, l, s, u].every((c) => c.title), cards.map((c) => c.title).join(' | '));
  const rc = C.recent_buyers_not_email_eligible;
  check('card recent buyers = independent', num(r.big) === rc.total && intIn(r.text, /(\d+) not subscribed/) === rc.not_subscribed && intIn(r.text, /(\d+) blocked/) === rc.blocked && intIn(r.text, /(\d+) no email held/) === rc.no_email_held && intIn(r.text, /(\d+) have a booking/) === rc.booked_ahead, `${r.text.slice(0, 200)} vs ${JSON.stringify(rc)}`);
  const lc = C.lapsed_buyers_with_recorded_engagement;
  check('card lapsed with engagement = independent', num(l.big) === lc.total && intIn(l.text, /(\d+) click-supported/) === lc.click_supported && intIn(l.text, /(\d+) open-only/) === lc.open_only, `${l.big}/${intIn(l.text, /(\d+) click-supported/)}/${intIn(l.text, /(\d+) open-only/)} vs ${lc.total}/${lc.click_supported}/${lc.open_only}`);
  const sc = C.subscribers_no_evidenced_purchase;
  check('card subscribers no evidenced purchase = independent', num(s.big) === sc.total && intIn(s.text, /(\d+) engaged in 90 days/) === sc.engaged_90d, `${s.big}/${intIn(s.text, /(\d+) engaged/)} vs ${sc.total}/${sc.engaged_90d}`);
  check('card subscribers: "never bought" wording not used', !/never bought/i.test(s.text.replace(/"never bought"/g, '')));
  const uc = C.purchase_history_unknown;
  check('card purchase history unknown = independent', num(u.big) === uc.total, `${u.big} vs ${uc.total}`);
}

async function readHealth(page) {
  const heading = await page.$$eval(SEL.healthHeading, (els) => els.map((e) => e.textContent).find((t) => /Email health/.test(t)) || '');
  const legend = await page.$$eval(SEL.legendItem, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  return { heading, legend };
}

/** States must equal one of the day-counting conventions (named in the note so the lead can confirm the documented one). */
function healthChecks(h) {
  const E = X.email_health;
  const denom = intIn(h.heading, /Email health of the (\d+)/);
  check('email health denominator = can-email count (people + own address)', denom === E.can_email_panel.total, `${denom} vs ${E.can_email_panel.total} (people only ${E.can_email_people.total})`);
  const got = {};
  for (const l of h.legend) { const st = pick(STATE_OF, l); if (st) got[st] = num(l.split(' · ')[0].match(/(\d[\d,]*)\s*$/)?.[1]); }
  const diff = (pool) => X.email_states.filter((st) => got[st] !== pool[st]).map((st) => `${st} ${got[st]} vs ${pool[st]}`);
  const variants = Object.entries(E.panel_day_variants);
  const hit = variants.find(([, pool]) => !diff(pool).length);
  check('email health: all 8 states shown (Unknown even when 0)', X.email_states.every((st) => st in got), Object.keys(got).join(','));
  check('email health states = independent (any day-counting convention)', !!hit, hit ? `matches ${hit[0]}` : diff(E.can_email_panel).join(' · '));
  check('email health states sum to the denominator', Object.values(got).reduce((a, v) => a + (v || 0), 0) === denom, `${Object.values(got).reduce((a, v) => a + (v || 0), 0)} vs ${denom}`);
}

async function reconChecks(page, tile9Head) {
  const note = (await page.$$eval(SEL.note, (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')))).find((t) => /tile 9 count/.test(t)) || '';
  const R = X.tile9.reconciliation;
  const m = note.replace(/,/g, '').match(/= (\d+) people \+ your own address; add (\d+) organisation clients? = (\d+) · tile 9 count (\d+)/);
  check('reconciliation line present and ✓', !!m && /reconciles/.test(note), note.slice(0, 220));
  check('reconciliation numbers = independent (people + admin + organisations = tile 9)', m && Number(m[1]) === R.people && Number(m[2]) === R.organisations && Number(m[3]) === R.sum && Number(m[4]) === X.tile9.can_be_emailed, `${m?.slice(1).join('/')} vs ${R.people}/${R.organisations}/${R.sum}/${X.tile9.can_be_emailed}`);
  check('reconciliation tile 9 count = tile 9 headline', m && Number(m[4]) === intIn(tile9Head, /^(\d+)/), `${m?.[4]} vs ${tile9Head}`);
  check('Alan\'s own address marked; organisations + system labels counted apart', /Your own address is in/.test(note) && /Organisations \(\d+\)/.test(note) && /system/.test(note));
}

// ---------- clicks into Customers ----------
async function customersCount(page, prev) {
  await page.waitForFunction(([sel, p]) => { const t = document.querySelector(sel)?.textContent || ''; return /people match/.test(t) && t !== p; }, [SEL.customersMatch, prev], { timeout: 90000 }).catch(() => {});
  await page.waitForSelector(SEL.customersLoading, { state: 'detached', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(500);
  return intIn(await page.textContent(SEL.customersMatch).catch(() => ''), /(\d+) people match/);
}

async function clickNumber(page, locator, label) {
  const shown = num(await locator.textContent());
  const prev = await page.textContent(SEL.customersMatch).catch(() => '');
  await locator.click();
  const got = await customersCount(page, prev);
  check(`click ${label}: Customers count = number clicked`, got === shown, `${got} vs ${shown}`);
  await page.locator(SEL.panel).scrollIntoViewIfNeeded();
}

async function clickSuite(page, mx, colKeys) {
  const cell = (band, col) => page.locator(`${SEL.matrix} tbody tr`).nth(mx.rows.findIndex((r) => pick(BAND_OF, r.label) === band)).locator('td').nth(colKeys.indexOf(col) + 1).locator(SEL.num).first();
  await clickNumber(page, cell('m0_6', 'not_subscribed'), 'matrix 0–6 × not subscribed');
  await clickNumber(page, cell('none', 'can_email'), 'matrix no evidenced purchase × can email');
  await clickNumber(page, cell('unknown', 'blocked'), 'matrix unknown × blocked');
  await clickNumber(page, page.locator(SEL.card).filter({ hasText: 'Recent buyers' }).locator(`${SEL.cardBig} ${SEL.num}`), 'card recent buyers not email-eligible');
  await clickNumber(page, page.locator(SEL.card).filter({ hasText: 'Lapsed buyers' }).locator(`${SEL.cardBig} ${SEL.num}`), 'card lapsed buyers with engagement');
}

async function panelSuite(page, tag, full) {
  const t9 = (await readTiles(page))[8]?.head || '';
  await openPanel(page);
  check(`${tag}: panel opens from tile 9`, await page.locator(SEL.matrix).count() === 1);
  await hideOverlays(page);
  await page.locator(SEL.panel).screenshot({ path: path.join(OUT, `${tag}-client-health.png`) });
  const ov = await page.$eval(SEL.panel, (p) => p.scrollWidth > p.clientWidth + 2).catch(() => true);
  check(`${tag}: panel not wider than the pane (matrix scrolls inside)`, !ov);
  if (!full) return;
  const mx = await readMatrix(page);
  const colKeys = matrixChecks(mx);
  amberChecks(mx, colKeys);
  cardChecks(await readCards(page));
  healthChecks(await readHealth(page));
  await reconChecks(page, t9);
  if (!process.env.SKIP_CLICKS) await clickSuite(page, mx, colKeys);
}

// ---------- run ----------
async function reloadSuite(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitTiles(page);
  const n = await page.locator(SEL.tile).count();
  const blank = await page.evaluate(() => (document.querySelector('section[data-panel="marketing"], #marketing-root, #mk-root')?.innerText || document.body.innerText).trim().length < 200);
  check('refresh: tiles render again (no blank tab)', n === 10 && !blank, `${n} tiles`);
}

const wide = await openAt(1600);
check('direct load (1600): tiles render', await wide.page.locator(SEL.tile).count() === 10);
await tileSuite(wide.page, '1600', true);
await panelSuite(wide.page, '1600', true);
await reloadSuite(wide.page);
check('no page errors (1600)', !wide.errors.length, wide.errors.slice(0, 3).join(' | '));
await wide.page.close();

const narrow = await openAt(PANE_VIEWPORT);
const paneW = await narrow.page.evaluate((s) => Math.round(document.querySelector(s)?.getBoundingClientRect().width || 0), SEL.tilesHost);
console.log(`pane width at ${PANE_VIEWPORT} px window: ${paneW} px`);
check(`pane width about 800 px (window ${PANE_VIEWPORT})`, paneW >= 700 && paneW <= 900, `${paneW} px`);
const nt = await tileSuite(narrow.page, 'pane', false);
check('pane: every tile at least 200 px wide', nt.every((t) => t.width >= 200), nt.map((t) => t.width).join(','));
await panelSuite(narrow.page, 'pane', false);
check('no page errors (pane)', !narrow.errors.length, narrow.errors.slice(0, 3).join(' | '));
await browser.close();

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note !== '' ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED of ${results.length}`);
