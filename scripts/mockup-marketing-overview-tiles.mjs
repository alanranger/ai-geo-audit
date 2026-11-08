/**
 * Part 4 (7 Nov 2026 combined fixes): MOCK-UP of the 10 Marketing Overview tiles with live numbers, for Alan's approval
 * BEFORE any build. Reads the live Strategy + Marketing APIs (counts and £ only — no customer data), renders a static
 * page in the dashboard style and screenshots it at desktop (1600 px) and pane (800 px) widths.
 *   node scripts/mockup-marketing-overview-tiles.mjs <out-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = process.argv[2] || 'C:/TEMP/mockup-tiles';
const key = fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).find((l) => l.startsWith('ARP_ADMIN_KEY=')).slice(14).replace(/^"|"$/g, '').trim();
fs.mkdirSync(OUT, { recursive: true });

const [strat, mk] = await Promise.all([
  fetch(`${BASE}/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`).then((r) => r.json()),
  fetch(`${BASE}/api/aigeo/marketing?action=overview`, { headers: { 'x-arp-admin-key': key } }).then((r) => r.json())
]);
const ins = strat.insights;
const tile = (k) => [...ins.rows.money, ...ins.rows.demand, ...ins.rows.mix].find((t) => t.key === k);
const m2 = tile('money-next-3');
const ret = tile('mix-returning');
const acad = tile('mix-academy');
const n2 = m2.numbers;
const k = (v) => `£${(Math.round(v / 100) / 10).toLocaleString('en-GB')}k`;
const n = (v) => Number(v || 0).toLocaleString('en-GB');
const ukDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const actions = strat.actions || [];
const week = strat.week_start;
const curQ = strat.current_quarter;
const open = actions.filter((a) => !a.is_ticked && a.quarter_key === curQ);
const overdue = open.filter((a) => a.status !== 'waiting' && a.due_week_start < week);
const waiting = open.filter((a) => a.status === 'waiting');
const nextAct = open.filter((a) => a.status !== 'waiting').sort((a, b) => a.due_week_start.localeCompare(b.due_week_start))[0];
const meter = mk.meter;
const ident = mk.identity;
const warn = [];
for (const s of ['profiles', 'orders', 'postcodes', 'customers']) if (mk.runs[`sync:${s}`]?.status !== 'ok') warn.push(`sync ${s}`);
if (mk.meter.state !== 'fresh') warn.push('send meter stale');
if (ident.suppressed_but_subscribed) warn.push(`${ident.suppressed_but_subscribed} suppressed people subscribed again`);
const retRow = ret.table.rows.find((r) => /Returning £/.test(r[0].v ?? r[0].text ?? r[0]));
const cellTxt = (c) => (c && typeof c === 'object' ? (c.v ?? c.text) : c);

const T = [
  { row: 'A', n: 1, title: 'Sales still needed', head: k(n2.required), sub: `to ${ukDay(n2.window_end)} · seasonal sales targets Nov–Jan`, more: `${tile('money-this-month').headline.label.replace('sales · ', '')}`, src: 'Strategy · Money tile 2 (same numbers)' },
  { row: 'A', n: 2, title: 'Dated places', head: `${k(n2.potential)} potential`, head2: `${k(n2.forecast)} likely`, sub: `every unsold place at full price · likely = forecast from lead times, approved offers applied`, more: `${k(n2.inHand)} already booked on these dates`, src: 'diary + snapshots · Strategy forecast', est: true },
  { row: 'A', n: 3, title: 'Non-dated sales', head: `${k(n2.nonDated)} needed`, sub: `if every dated place sells · ${k(n2.nonDatedIfForecast)} if only the forecast sells (alternatives, not added)`, more: `same 3 months last year ${k(n2.lyNonDated)}`, src: 'Booking Sheet · Strategy Money tile 2' },
  { row: 'B', n: 4, title: 'Repeat clients', head: cellTxt(retRow?.[2]) || '—', sub: `returning sales, rolling 12 months · ${cellTxt(retRow?.[3]) || ''}`, more: `${ret.headline.value} of clients came back since 2024 (${ret.comparison.match(/^\d+ of \d+/)?.[0]})`, src: 'Booking Sheet + plan statements · Strategy Mix tile 2' },
  { row: 'B', n: 5, title: 'Academy progression', head: `${acad.headline.value} paying`, sub: acad.table.rows.map((r) => `${cellTxt(r[0])} ${cellTxt(r[2])}/month`).join(' · '), more: acad.note, src: 'Memberstack · Booking Sheet Academy sales' },
  { row: 'B', n: 6, title: 'Next 4 weeks: content mix', head: 'Not yet available', sub: 'Sell · Educate · Inspire · Nurture needs a purpose tag on each step (not stored yet)', more: 'Shown as unavailable until steps carry purposes — no invented counts', src: 'campaign steps (purpose tags missing)', na: true },
  { row: 'C', n: 7, title: 'Needs Alan', head: `${overdue.length} overdue`, sub: nextAct ? `next: ${nextAct.label} · ${ukDay(nextAct.due_week_start)}` : 'nothing waiting on you', more: `${waiting.length} waiting on a trigger (not overdue)`, src: 'quarter actions · campaign stages' },
  { row: 'C', n: 8, title: 'Email allowance', head: `${n(meter.after_reservations)} left`, sub: `${n(meter.used)} of ${n(meter.quota)} used · ${n(meter.reserved)} reserved · resets ${ukDay(meter.cycle?.reset)}`, more: `meter read ${ukDay(meter.captured_at)}`, src: 'Squarespace send meter (collector)' },
  { row: 'C', n: 9, title: 'Eligible audience', head: `${n(ident.subscribed_unsuppressed)} emailable`, sub: `${n(ident.subscribed)} opted in · ${n(ident.suppressed_but_subscribed)} blocked by suppression · ${n(ident.persons)} people`, more: 'name-only, organisations, system labels and Alan\'s address kept apart', src: 'Squarespace consent + suppression list' },
  { row: 'C', n: 10, title: 'Data & alignment health', head: warn.length ? `Attention · ${warn.length}` : 'Ready', sub: warn.length ? warn[0] : 'all sources read in the last day', more: `customers rebuilt ${ukDay(mk.runs['sync:customers']?.finished_at)} · emails ${mk.coverage?.email_campaigns?.complete ?? mk.engagement?.coverage?.complete ?? '—'} campaigns collected`, src: 'run log · coverage', warn: warn.length > 0 }
];

const card = (t) => `<div class="tile ${t.na ? 'na' : ''} ${t.warn ? 'warn' : ''}"><div class="num">${t.n}</div><div class="lab">${t.title}${t.est ? ' <span class="est">estimate</span>' : ''}</div>
  <div class="head">${t.head}${t.head2 ? ` <span class="sep">/</span> ${t.head2}` : ''}</div><div class="sub">${t.sub}</div><div class="more">${t.more || ''}</div><div class="src">${t.src} · click → detail</div></div>`;
const row = (r, label) => `<div class="rowlab">${label}</div><div class="grid g${r === 'C' ? 4 : 3}">${T.filter((t) => t.row === r).map(card).join('')}</div>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{background:#0b1118;color:#e5e7eb;font-family:Inter,Segoe UI,Arial,sans-serif;margin:0;padding:18px}
.banner{font-size:12px;color:#94a3b8;margin-bottom:10px}.wrap{border:1px solid #1f2937;border-radius:12px;padding:16px;background:#0f172a}
h2{margin:0 0 4px;font-size:20px}.meta{font-size:12px;color:#94a3b8;margin-bottom:12px}.prio{font-size:13px;margin-bottom:12px}
.rowlab{font-size:11px;letter-spacing:.06em;color:#94a3b8;margin:14px 0 6px;text-transform:uppercase}
.grid{display:grid;gap:10px}.g3{grid-template-columns:repeat(3,minmax(0,1fr))}.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(max-width:900px){.g3,.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tile{position:relative;border:1px solid #1f2937;border-left:4px solid #3b82f6;border-radius:10px;padding:10px 12px;background:#111827}
.tile.na{border-left-color:#64748b;opacity:.85}.tile.warn{border-left-color:#f59e0b}
.num{position:absolute;top:8px;right:10px;font-size:11px;color:#64748b}.lab{font-size:12px;color:#cbd5e1}
.head{font-size:22px;font-weight:700;margin:4px 0}.sep{color:#64748b}.sub{font-size:12px;color:#cbd5e1}.more{font-size:12px;color:#94a3b8;margin-top:4px}
.src{font-size:10.5px;color:#64748b;margin-top:6px}.est{font-size:10px;background:#1e3a8a;color:#bfdbfe;border-radius:4px;padding:0 4px}
.foot{margin-top:14px;font-size:12px;color:#94a3b8;border-top:1px dashed #334155;padding-top:8px}</style></head><body>
<div class="banner">MOCK-UP for approval · Marketing &amp; Campaigns → Overview · live numbers ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })} · not built yet</div>
<div class="wrap"><h2>Marketing &amp; Campaigns</h2><div class="meta">Period: ${ukDay(new Date().toISOString())} → ${ukDay(n2.window_end)} · data as of ${ukDay(ins.built_at)}</div>
<div class="prio"><b>Business priority:</b> close the sales gap while building repeat clients and Academy progression.</div>
${row('A', 'Row A — business progress')}${row('B', 'Row B — relationship growth and editorial balance')}${row('C', 'Row C — delivery, audience and readiness')}
<div class="foot">Every number is read from the same shared figures as Strategy (no copies). Tiles 1–3 are mutually exclusive money; tiles 4–5 overlap them (different views of the same sales). Tile 6 shows "not yet available" until steps carry a purpose. Each tile opens its detail (Strategy gap, event breakdown, segment, queue, meter, run log). Then below: "This week" task list · Active programmes.</div></div></body></html>`;
const file = path.join(OUT, 'marketing-overview-tiles-mockup.html');
fs.writeFileSync(file, html);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
for (const w of [1600, 800]) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  await page.goto(`file:///${file.replace(/\\/g, '/')}`);
  await page.screenshot({ path: path.join(OUT, `marketing-overview-tiles-mockup-${w}.png`), fullPage: true });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(T.map((t) => ({ n: t.n, head: t.head, head2: t.head2 || undefined })), null, 0));
