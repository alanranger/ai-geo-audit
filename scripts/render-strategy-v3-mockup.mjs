/**
 * DESIGN mockup only — Strategy tab v3 from live Squarespace + sheet data.
 * node scripts/render-strategy-v3-mockup.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { loadSquarespaceEventFeeds, themeMatchesTitle } from '../lib/squarespace-events-feed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const PROP = 'https://www.alanranger.com';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function gbp(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '£' + Math.round(Number(n)).toLocaleString('en-GB');
}
function dayName(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function capacityFor(e) {
  if (e.kind === 'course') return 4;
  if (e.type === 'residential') return 4;
  if (/batsford/i.test(e.title)) return 6;
  if (e.places_left != null) return Math.max(e.places_left + e.booked, 1);
  return 4;
}
function breakEven(e) {
  return e.type === 'residential' ? 3 : 2;
}
function priceGuess(e) {
  if (e.kind === 'course') return 150;
  if (e.type === 'residential') return 1195;
  if (/batsford/i.test(e.title)) return 99;
  if (/walk/i.test(e.title)) return 35;
  return 125;
}
function statusFor(e, cap, be) {
  if (e.booked >= cap) return 'Full';
  if (e.booked === 0) return 'No bookings';
  if (e.booked < be) return 'Below break-even';
  return 'OK';
}

const feeds = await loadSquarespaceEventFeeds();
const { data: workshops } = await sb.from('booking_sheet_workshop_attendees').select('event_start, theme_location, client_name, is_multi_day, paid').eq('property_url', PROP);
const { data: courses } = await sb.from('booking_sheet_course_attendees').select('from_date, to_date, event_name, client_name, is_beginners, is_booking_row').eq('property_url', PROP);
const { data: actions } = await sb.from('strategy_quarter_actions').select('*').eq('property_url', PROP).eq('quarter_key', 'q1-2026').order('sort_order');
const summary = await (await fetch(`https://ai-geo-audit.vercel.app/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent(PROP)}`)).json();

function countBooked(title, date, kind) {
  if (kind === 'course') {
    return (courses || []).filter((r) => r.is_booking_row && r.is_beginners && r.client_name && (r.from_date || r.to_date) === date).length;
  }
  let n = 0;
  for (const r of workshops || []) {
    if (!r.client_name || !themeMatchesTitle(r.theme_location, title)) continue;
    if (!r.event_start || r.event_start === date) n += 1;
    else {
      const dd = Math.abs((new Date(`${r.event_start}T12:00:00Z`) - new Date(`${date}T12:00:00Z`)) / 86400000);
      if (dd <= 3) n += 1;
    }
  }
  return n;
}

// Group beginners Week 1/2/3 → one course row keyed by Week 1 date
const courseGroups = new Map();
for (const e of feeds.beginners) {
  if (!/week\s*(\d)\s*of\s*3/i.test(e.title) && !/beginner|lightroom/i.test(e.title)) continue;
  const m = e.title.match(/week\s*(\d)\s*of\s*3/i);
  const week = m ? Number(m[1]) : 1;
  const base = e.title.replace(/week\s*\d\s*of\s*3/ig, 'Week 1 of 3').replace(/\s*-\s*\d{1,2}-\d{1,2}\s*$/, '').trim();
  // use week1 date as key when possible
  let key = base;
  if (week === 1) key = `${e.date}|${base}`;
  else {
    // attach to nearest prior week1 of same base
    const hit = [...courseGroups.keys()].reverse().find((k) => k.endsWith(base) || k.includes(base.slice(0, 40)));
    key = hit || `${e.date}|${base}`;
  }
  if (!courseGroups.has(key)) {
    courseGroups.set(key, {
      date: e.date,
      title: base.replace(/Week 1 of 3/i, '3-week course').slice(0, 80),
      kind: 'course',
      type: 'course',
      places_left: null,
      url: e.url,
      weeks: []
    });
  }
  const g = courseGroups.get(key);
  if (week === 1) g.date = e.date;
  g.weeks.push(week);
}

const today = new Date().toISOString().slice(0, 10);
const end12 = new Date(Date.now() + 84 * 86400000).toISOString().slice(0, 10);

const diary = [];
for (const e of feeds.workshops) {
  if (e.date < today || e.date > end12) continue;
  const span = e.end ? Math.round((new Date(e.end) - new Date(e.date)) / 86400000) + 1 : 1;
  const type = span >= 2 ? 'residential' : (/walk/i.test(e.title) ? 'walk' : 'day');
  const booked = countBooked(e.title, e.date, 'workshop');
  diary.push({
    date: e.date,
    title: e.title,
    kind: 'workshop',
    type,
    places_left_web: e.places_left,
    booked,
    url: e.url
  });
}
for (const g of courseGroups.values()) {
  if (g.date < today || g.date > end12) continue;
  const booked = countBooked(g.title, g.date, 'course');
  diary.push({
    date: g.date,
    title: g.title,
    kind: 'course',
    type: 'course',
    places_left_web: null,
    booked,
    url: g.url
  });
}
diary.sort((a, b) => a.date.localeCompare(b.date));

const rows = diary.map((e) => {
  const cap = capacityFor(e);
  const be = breakEven(e);
  const price = priceGuess(e);
  const left = e.kind === 'course' ? Math.max(0, cap - e.booked) : (e.places_left_web != null ? e.places_left_web : Math.max(0, cap - e.booked));
  const status = statusFor(e, cap, be);
  const mismatch = e.kind !== 'course' && e.places_left_web != null && (cap - e.booked) !== e.places_left_web
    && Math.abs((cap - e.booked) - e.places_left_web) >= 1;
  // refine mismatch: sheet booked vs website implied booked
  const webImpliedBooked = e.places_left_web != null ? Math.max(0, capacityFor({ ...e, places_left: e.places_left_web, booked: 0 }) - e.places_left_web) : null;
  const mismatch2 = e.places_left_web != null && e.booked !== (capacityFor(e) - e.places_left_web) && e.booked > 0 && e.places_left_web === capacityFor(e);
  const flag = (e.places_left_web != null && e.booked === 0 && e.places_left_web === capacityFor({ ...e, booked: 0, places_left: e.places_left_web }))
    || (e.places_left_web != null && e.booked > 0 && e.places_left_web >= capacityFor(e) - 1 && e.booked >= 2);
  return {
    ...e,
    cap,
    be,
    price,
    left,
    status,
    bookedGbp: e.booked * price,
    unsoldGbp: left * price,
    mismatch: flag || mismatch2,
    day: dayName(e.date)
  };
});

const push = rows
  .filter((e) => {
    const end8 = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10);
    return e.date <= end8 && (e.status === 'Below break-even' || e.status === 'No bookings' || e.left >= 2);
  })
  .map((e) => ({ ...e, score: e.unsoldGbp / Math.max(1, (new Date(e.date) - Date.now()) / 86400000) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);

const done = (actions || []).filter((a) => a.is_ticked).length;
const gpT3 = summary.gp_t3;
const surv = summary.survival_gp || 3700;

const tableRows = rows.map((e) => `<tr data-type="${esc(e.type)}" data-status="${esc(e.status)}" class="${e.status !== 'OK' && e.status !== 'Full' ? 'needs' : ''}">
  <td>${esc(e.day)}</td>
  <td class="left">${esc(e.title.slice(0, 64))}<div class="muted">${esc(e.type)}</div></td>
  <td>${gbp(e.price)}</td>
  <td>${e.cap}</td>
  <td>${e.booked}</td>
  <td>${e.left}</td>
  <td>${e.be}</td>
  <td><span class="pill ${e.status === 'OK' ? 'ok' : e.status === 'Full' ? 'full' : 'bad'}">${esc(e.status)}</span></td>
  <td>${gbp(e.bookedGbp)}</td>
  <td>${gbp(e.unsoldGbp)}</td>
  <td>${e.mismatch ? '<span class="pill bad">MISMATCH</span>' : '—'}</td>
  <td class="left">${e.url ? `<a href="https://www.alanranger.com${esc(e.url)}" target="_blank">open</a>` : '—'}</td>
</tr>`).join('\n');

const pushRows = push.map((e) => `<tr>
  <td>${esc(e.day)}</td>
  <td class="left">${esc(e.title.slice(0, 56))}</td>
  <td class="left">${e.booked < e.be ? `needs ${e.be - e.booked} more to run` : `${e.left} places, ${gbp(e.unsoldGbp)} unsold`}</td>
  <td class="muted">PROPOSED</td>
  <td>${e.url ? `<a href="https://www.alanranger.com${esc(e.url)}">open</a>` : '—'}</td>
</tr>`).join('\n');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Strategy mockup v3</title>
<style>
:root { --bg:#0b1118; --panel:#121a24; --border:#1f2937; --text:#e5e7eb; --muted:#94a3b8; --brand:#f59e0b; --ok:#22c55e; --bad:#ef4444; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 Figtree,Segoe UI,sans-serif; }
.wrap { max-width:1200px; margin:0 auto; padding:1.25rem 1.5rem 3rem; }
h1 { color:var(--brand); margin:0 0 .25rem; font-size:1.6rem; }
.sub { color:var(--muted); margin:0 0 1.25rem; }
.sec { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:1rem 1.1rem; margin-bottom:1rem; }
.sec h2 { margin:0 0 .65rem; font-size:1.05rem; }
.muted { color:var(--muted); font-size:.78rem; }
table { width:100%; border-collapse:collapse; font-size:.82rem; }
th,td { padding:.4rem .45rem; border-bottom:1px solid #1f2937; text-align:center; vertical-align:top; }
th { color:var(--muted); text-transform:uppercase; font-size:.68rem; letter-spacing:.04em; }
td.left, th.left { text-align:left; }
.pill { display:inline-block; padding:.1rem .4rem; border-radius:4px; font-size:.68rem; font-weight:700; }
.pill.ok { background:#14532d; color:#bbf7d0; }
.pill.full { background:#1e3a8a; color:#bfdbfe; }
.pill.bad { background:#7f1d1d; color:#fecaca; }
.filters { display:flex; gap:.6rem; flex-wrap:wrap; margin-bottom:.7rem; color:var(--muted); font-size:.8rem; }
.filters label { background:#0b1118; border:1px solid var(--border); padding:.3rem .55rem; border-radius:6px; }
.trends { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; }
.trend { background:#0b1118; border:1px solid var(--border); border-radius:8px; padding:.7rem; min-height:110px; }
.trend h3 { margin:0 0 .35rem; font-size:.78rem; color:var(--muted); }
.trend .big { font-size:1.2rem; font-weight:800; color:var(--brand); }
.trend svg { width:100%; height:48px; display:block; margin-top:.35rem; }
.q { display:flex; gap:1rem; flex-wrap:wrap; align-items:flex-start; }
.qcard { flex:1; min-width:16rem; background:#0b1118; border:1px solid var(--brand); border-radius:8px; padding:.75rem; }
.banner { background:#1f2937; color:#fde68a; padding:.5rem .75rem; border-radius:6px; margin-bottom:1rem; font-size:.85rem; }
a { color:#93c5fd; }
</style></head>
<body><div class="wrap" id="shot">
  <div class="banner">MOCKUP v3 — real live data · not built yet · awaiting Alan approval</div>
  <h1>Strategy &amp; KPIs</h1>
  <p class="sub">Current position &amp; gaps to fill · next 12 weeks · <a href="#">plan document ↗</a></p>

  <div class="sec">
    <h2>A · Next 12 weeks — diary &amp; gaps</h2>
    <div class="filters">
      <label><input type="checkbox" checked disabled> All types</label>
      <label><input type="checkbox" disabled> Needs action only</label>
      <span class="muted">${rows.length} events · break-even day=2 / residential=3</span>
    </div>
    <div style="overflow-x:auto">
    <table id="diary">
      <thead><tr>
        <th>Date</th><th class="left">Event</th><th>Price</th><th>Cap</th><th>Booked</th><th>Left</th><th>B/E</th><th>Status</th><th>£ booked</th><th>£ unsold</th><th>Flag</th><th class="left">Link</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
  </div>

  <div class="sec">
    <h2>B · Where to push this week <span class="muted">(max 5)</span></h2>
    <table>
      <thead><tr><th>Date</th><th class="left">Event</th><th class="left">Gap</th><th>Decide by</th><th>Link</th></tr></thead>
      <tbody>${pushRows || '<tr><td colspan="5">Nothing below break-even in next 8 weeks</td></tr>'}</tbody>
    </table>
  </div>

  <div class="sec">
    <h2>C · Trends <span class="muted">(context only)</span></h2>
    <div class="trends">
      <div class="trend"><h3>1 · GP / month (T3)</h3><div class="big">${gbp(gpT3)}</div><div class="muted">vs survival ${gbp(surv)}</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#f59e0b" stroke-width="2" points="0,28 20,24 40,26 60,22 80,18 100,20 120,16"/><line x1="0" y1="14" x2="120" y2="14" stroke="#64748b" stroke-dasharray="3 3"/></svg>
      </div>
      <div class="trend"><h3>2 · Non-JLR beginners</h3><div class="big">${summary.headline?.beginners_fill_pct ?? '—'}% fill</div><div class="muted">L12 vs prior · JLR faint</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#34d399" stroke-width="2" points="0,30 30,26 60,20 90,22 120,14"/><polyline fill="none" stroke="#475569" stroke-width="1.5" points="0,34 30,32 60,30 90,28 120,27"/></svg>
      </div>
      <div class="trend"><h3>3 · Workshop attendees</h3><div class="big">day / res</div><div class="muted">quarterly · 3 years</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#60a5fa" stroke-width="2" points="0,22 40,18 80,24 120,16"/><polyline fill="none" stroke="#c084fc" stroke-width="2" points="0,30 40,28 80,26 120,22"/></svg>
      </div>
      <div class="trend"><h3>4 · Avg / run</h3><div class="big">${summary.workshop_signals?.residential_avg ?? '—'} res</div><div class="muted">day vs residential</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#f472b6" stroke-width="2" points="0,20 40,18 80,16 120,14"/></svg>
      </div>
    </div>
  </div>

  <div class="sec">
    <h2>D · This quarter</h2>
    <div class="q">
      <div class="qcard">
        <div><b>Q1 Oct–Dec 2026 — Relaunch</b> <span class="pill ok">${done} of ${(actions || []).length} done</span></div>
        <div class="muted">Targets vs now: plans ${(summary.headline?.plans_active ?? 0)} / 3 · non-JLR beginners ${summary.roadmap_now?.beginners_non_jlr ?? 0} / 8 · GP T3 ${gbp(gpT3)} / £2.8k · returning ${gbp(summary.headline?.returning_r12)} / £16k</div>
        <ul style="margin:.5rem 0 0;padding-left:1.1rem;font-size:.8rem;max-height:9rem;overflow:auto">
          ${(actions || []).slice(0, 8).map((a) => `<li style="${a.is_ticked ? 'opacity:.55;text-decoration:line-through' : ''}">${esc(a.label)}</li>`).join('')}
        </ul>
      </div>
      <div class="muted" style="flex:0 0 12rem;padding-top:.5rem">Q2–Q4 collapsed in live build</div>
    </div>
  </div>

  <div class="sec muted">E · Plans — hidden until ≥1 Plans row exists (${esc(summary.plan_clients?.empty_reason || 'ready')})</div>
</div></body></html>`;

const htmlPath = resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v3.html');
writeFileSync(htmlPath, html, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.screenshot({ path: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v3.png'), fullPage: true });
await browser.close();
console.log(JSON.stringify({
  htmlPath,
  png: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v3.png'),
  diary_rows: rows.length,
  push_rows: push.length,
  courses_from_date: (courses || []).filter((c) => c.from_date).length,
  courses_n: (courses || []).length,
  workshops_n: (workshops || []).length
}, null, 2));
