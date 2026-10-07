/**
 * MOCKUP ONLY — Strategy tab v5 full page (restored sections + v4 diary with Part 1 fixes).
 * node scripts/render-strategy-v5-mockup.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { buildStrategySummary } from '../lib/strategy-summary.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const data = await buildStrategySummary(sb);

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function gbp(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '£' + Math.round(Number(n)).toLocaleString('en-GB');
}
function tag(kind) {
  return `<span class="sec-tag">${esc(kind)}</span>`;
}
function dayName(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function ragChip(rag, full) {
  const label = full ? 'GREEN ✓' : String(rag || '').toUpperCase();
  return `<span class="rag ${esc(rag)}">${esc(label)}</span>`;
}
function eventLink(e) {
  if (!e.url) return esc(e.title);
  const href = e.url.startsWith('http') ? e.url : `https://www.alanranger.com${e.url}`;
  return `<a class="elink" href="${esc(href)}" target="_blank">${esc(e.title)}</a>`;
}
function fmtChange(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return (Number(n) >= 0 ? '+' : '') + Number(n).toFixed(1) + '%';
}

const headline = data.headline || {};
const now = data.roadmap_now || {};
const sources = data.beginners_sources || {};
const ws = data.workshop_signals || {};
const survival = data.survival_gp || 3700;
const stretch1 = data.stretch?.stretch1 || 4000;
const stretch2 = data.stretch?.stretch2 || 4700;
const series = data.gp_series || [];
const last24 = series.slice(-24);
const byPeriod = new Map(series.map((s) => [s.period, s.gp]));

const chartW = 1100;
const chartH = 340;
const pad = { l: 56, r: 20, t: 28, b: 40 };
const vals = last24.flatMap((s) => {
  const [y, m] = s.period.split('-').map(Number);
  const ly = byPeriod.get(`${y - 1}-${String(m).padStart(2, '0')}`);
  return [s.gp, ly].filter((x) => x != null);
});
const ymax = Math.max(survival * 1.15, stretch2, ...vals, 1);
const xAt = (i) => pad.l + (i / Math.max(last24.length - 1, 1)) * (chartW - pad.l - pad.r);
const yAt = (v) => pad.t + (1 - v / ymax) * (chartH - pad.t - pad.b);
const thisPts = last24.map((s, i) => `${xAt(i)},${yAt(s.gp)}`).join(' ');
const lyPts = last24.map((s, i) => {
  const [y, m] = s.period.split('-').map(Number);
  const ly = byPeriod.get(`${y - 1}-${String(m).padStart(2, '0')}`);
  return ly == null ? null : `${xAt(i)},${yAt(ly)}`;
}).filter(Boolean).join(' ');
const ySurv = yAt(survival);
const grid = [0.25, 0.5, 0.75, 1].map((t) => {
  const v = t * ymax;
  const y = yAt(v);
  return `<line x1="${pad.l}" y1="${y}" x2="${chartW - pad.r}" y2="${y}" stroke="#1f2937"/><text x="${pad.l - 8}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end">${gbp(v)}</text>`;
}).join('');
const xLabels = last24.map((s, i) => (i % 2 && i !== last24.length - 1 ? ''
  : `<text x="${xAt(i)}" y="${chartH - 12}" fill="#94a3b8" font-size="11" text-anchor="middle">${esc(s.period.slice(2))}</text>`)).join('');

function actionsHtml() {
  const byQ = {};
  for (const a of data.actions || []) (byQ[a.quarter_key] = byQ[a.quarter_key] || []).push(a);
  return (data.quarters || []).map((q) => {
    const acts = byQ[q.key] || [];
    const done = acts.filter((a) => a.is_ticked).length;
    const isCur = q.key === data.current_quarter;
    const lis = acts.map((a) => `<li class="${a.is_ticked ? 'done' : ''}">${a.is_ticked ? '☑' : '☐'} ${esc(a.label)} <span class="muted">${esc(a.due_week_start || '')}</span></li>`).join('');
    const t = q.targets || {};
    return `<div class="qcard ${isCur ? 'cur' : ''}"><h4>${esc(q.label)} <span class="muted">${done}/${acts.length}</span></h4>
      <div class="obj">${esc(q.objective)}</div><ul>${lis}</ul>
      <div class="muted">Targets: ${t.plans} plans · ${t.beginners_non_jlr} beg · GP ${gbp(t.gp_t3)} · ret ${gbp(t.returning_r12)}</div></div>`;
  }).join('');
}

const diaryRows = (data.diary || []).map((e) => `<tr>
  <td>${esc(dayName(e.date))}</td>
  <td class="left">${eventLink(e)}<div class="muted">${esc(e.capacity_source || '')}${e.note ? ' · ' + esc(e.note) : ''}</div></td>
  <td>${gbp(e.price)}</td><td>${e.cap}</td><td>${e.booked}</td><td>${e.left}</td>
  <td>${e.fill_pct != null ? e.fill_pct + '%' : '—'}</td><td>${e.be}</td>
  <td>${ragChip(e.rag, e.full)}</td><td>${esc(e.status)}</td>
  <td>${gbp(e.booked_gbp)}</td><td>${gbp(e.unsold_gbp)}</td>
  <td>${e.mismatch ? '<span class="flag">MISMATCH</span>' : '—'}</td>
</tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Strategy mockup v5</title>
<style>
:root{--bg:#0b1118;--panel:#121a24;--border:#1f2937;--text:#e5e7eb;--muted:#94a3b8;--brand:#f59e0b}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Figtree,Segoe UI,sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:1.2rem 1.4rem 3rem}
h1{color:var(--brand);margin:0 0 .3rem;font-size:1.55rem}
.banner{background:#1f2937;color:#fde68a;padding:.5rem .75rem;border-radius:6px;margin-bottom:1rem;font-size:.85rem}
.sec{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:1rem 1.1rem;margin-bottom:1rem;position:relative}
.sec h2{margin:0 0 .65rem;font-size:1.05rem;padding-right:7rem}
.sec-tag{position:absolute;top:.55rem;right:.7rem;font-size:.65rem;color:#64748b;letter-spacing:.04em;text-transform:uppercase}
.muted{color:var(--muted);font-size:.76rem}
.pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem}
.pillar{background:#0b1118;border:1px solid var(--border);border-radius:8px;padding:.75rem}
.pillar h4{margin:0 0 .35rem;color:var(--brand)}
.quarters{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem}
.qcard{background:#0b1118;border:1px solid var(--border);border-radius:8px;padding:.65rem;font-size:.78rem}
.qcard.cur{border-color:var(--brand)}
.qcard ul{margin:.35rem 0;padding-left:0;list-style:none;max-height:10rem;overflow:auto}
.qcard li.done{opacity:.55;text-decoration:line-through}
.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem}
.tile{background:#0b1118;border:1px solid var(--border);border-radius:8px;padding:.75rem}
.tile .big{font-size:1.35rem;font-weight:800;color:var(--brand)}
table{width:100%;border-collapse:collapse;font-size:.8rem}
th,td{padding:.35rem .4rem;border-bottom:1px solid #1f2937;text-align:center;vertical-align:top}
th{color:var(--muted);text-transform:uppercase;font-size:.65rem}
td.left,th.left{text-align:left}
.elink{color:#93c5fd;text-decoration:none}
.rag{display:inline-block;min-width:4rem;padding:.12rem .35rem;border-radius:4px;font-size:.65rem;font-weight:800;color:#fff}
.rag.red{background:#dc2626}.rag.amber{background:#d97706}.rag.green{background:#16a34a}
.flag{background:#7f1d1d;color:#fecaca;padding:.1rem .35rem;border-radius:4px;font-size:.65rem;font-weight:700}
.two{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.trends{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem}
.trend{background:#0b1118;border:1px solid var(--border);border-radius:8px;padding:.7rem}
.trend .big{font-size:1.1rem;font-weight:800;color:var(--brand)}
@media(max-width:900px){.pillars,.quarters,.strip,.two,.trends{grid-template-columns:1fr}}
</style></head><body><div class="wrap" id="shot">
<div class="banner">MOCKUP v5 — full page from live data · not built yet · awaiting Alan approval · section labels: RESTORED / KEPT v4 / CHANGED</div>
<h1>Strategy &amp; KPIs</h1>
<p class="muted">Current position, gaps, and plan · <a class="elink" href="#">plan document ↗</a></p>

<div class="sec">${tag('RESTORED')}<h2>1 · Strategy pillars</h2>
  <div class="pillars">
    <div class="pillar"><h4>Fill the front door</h4><p>£150 3-evening beginners at home (max 4). Google, gift vouchers, referrals. JLR = upside only.</p></div>
    <div class="pillar"><h4>Keep them</h4><p>“Your first year” Pick n Mix on every beginners last night — from £600 / £50pm; reviews quarterly; Academy free 12m.</p></div>
    <div class="pillar"><h4>Protect margins</h4><p>Fewer proven workshops; max 4 / one car on residentials; plan clients first refusal; hold 1-2-1 prices.</p></div>
  </div>
</div>

<div class="sec">${tag('RESTORED')}<h2>2 · Quarter cards Q1–Q4</h2>
  <div class="quarters">${actionsHtml()}</div>
</div>

<div class="sec">${tag('RESTORED')}<h2>3 · Headline strip</h2>
  <div class="strip">
    <div class="tile"><div class="muted">1 · GP / month (T3)</div><div class="big">${gbp(headline.gp_t3)}</div><div class="muted">vs survival ${gbp(survival)}</div></div>
    <div class="tile"><div class="muted">2 · Beginners seats</div><div class="big">${headline.beginners_fill_pct != null ? headline.beginners_fill_pct + '%' : '—'}</div><div class="muted">R12 · next 8w ${headline.beginners_next_8w?.booked || 0}/${headline.beginners_next_8w?.seats || 0}</div></div>
    <div class="tile"><div class="muted">5 · Plans active</div><div class="big">${headline.plans_active != null ? headline.plans_active : '—'}</div><div class="muted">${esc(headline.plans_meta || 'No plans yet')}</div></div>
    <div class="tile"><div class="muted">9 · Returning £ (R12)</div><div class="big">${gbp(headline.returning_r12)}</div><div class="muted">excl JLR &amp; ≥£3k</div></div>
  </div>
</div>

<div class="sec">${tag('CHANGED — priority')}<h2>4 · GP by month vs survival <span class="muted">(full width · 24 months · this year / last year / survival ${gbp(survival)} · stretch ${gbp(stretch1)} / ${gbp(stretch2)})</span></h2>
  <svg viewBox="0 0 ${chartW} ${chartH}" style="width:100%;height:${chartH}px;background:#0b1118;border-radius:8px;border:1px solid #1f2937">
    ${grid}
    <line x1="${pad.l}" y1="${ySurv}" x2="${chartW - pad.r}" y2="${ySurv}" stroke="#94a3b8" stroke-dasharray="6 4" stroke-width="2"/>
    <text x="${chartW - pad.r}" y="${ySurv - 6}" fill="#94a3b8" font-size="12" text-anchor="end">Survival ${gbp(survival)}</text>
    <line x1="${pad.l}" y1="${yAt(stretch1)}" x2="${chartW - pad.r}" y2="${yAt(stretch1)}" stroke="#64748b" stroke-dasharray="3 5"/>
    <line x1="${pad.l}" y1="${yAt(stretch2)}" x2="${chartW - pad.r}" y2="${yAt(stretch2)}" stroke="#475569" stroke-dasharray="3 5"/>
    <polyline fill="none" stroke="#64748b" stroke-width="2" points="${lyPts}"/>
    <polyline fill="none" stroke="#f59e0b" stroke-width="3" points="${thisPts}"/>
    ${xLabels}
    <text x="${pad.l}" y="18" fill="#f59e0b" font-size="12">This year</text>
    <text x="${pad.l + 90}" y="18" fill="#64748b" font-size="12">Last year</text>
  </svg>
</div>

<div class="sec">${tag('RESTORED')}<h2>5 · Roadmap milestones</h2>
  <table><thead><tr><th class="left">Metric</th><th>Dec 26</th><th>Mar 27</th><th>Jun 27</th><th>Sep 27</th><th>Now</th></tr></thead>
  <tbody>
    <tr><td class="left">Plans sold</td><td>3</td><td>6</td><td>9</td><td>12</td><td><b>${now.plans_sold ?? 0}</b></td></tr>
    <tr><td class="left">Non-JLR beginners taught</td><td>8</td><td>17</td><td>27</td><td>37</td><td><b>${now.beginners_non_jlr ?? 0}</b></td></tr>
    <tr><td class="left">Returning £ (R12)</td><td>£16k</td><td>£18k</td><td>£20k</td><td>£23k</td><td><b>${gbp(now.returning_r12)}</b></td></tr>
    <tr><td class="left">GP avg (T3m)</td><td>£2.8k</td><td>£3.0k</td><td>£3.3k</td><td>£3.5k</td><td><b>${gbp(now.gp_t3)}</b></td></tr>
  </tbody></table>
</div>

<div class="sec">${tag('KEPT v4 + CHANGED Part1')}<h2>E · Next 12 weeks — diary &amp; gaps</h2>
  <div class="muted" style="margin-bottom:.5rem">${(data.diary || []).length} events · RAG chips · day/walk cap 6 · MISMATCH only when booked+left≠cap</div>
  <div style="overflow-x:auto"><table>
    <thead><tr><th>Date</th><th class="left">Event</th><th>Price</th><th>Cap</th><th>Booked</th><th>Left</th><th>Fill</th><th>B/E</th><th>RAG</th><th>Status</th><th>£ booked</th><th>£ unsold</th><th>Flags</th></tr></thead>
    <tbody>${diaryRows}</tbody>
  </table></div>
</div>

<div class="sec">${tag('KEPT v4 + CHANGED Part1')}<h2>F · Where to push + Action needed</h2>
  <table><thead><tr><th>Date</th><th class="left">Event</th><th>RAG</th><th class="left">Gap</th></tr></thead>
  <tbody>${(data.push || []).map((e) => `<tr><td>${esc(dayName(e.date))}</td><td class="left">${eventLink(e)}</td><td>${ragChip(e.rag)}</td><td class="left">${esc(e.gap)}</td></tr>`).join('')}</tbody></table>
  <ul style="font-size:.82rem;margin:.7rem 0 0;padding-left:1.1rem">
    ${(data.action_needed || []).slice(0, 12).map((a) => `<li>${esc(a.title)} — ${esc(a.detail || '')}</li>`).join('')}
  </ul>
</div>

<div class="sec">${tag('RESTORED — always shown')}<h2>8 · Plan clients</h2>
  ${!(data.plan_clients?.rows || []).length
    ? '<p class="muted">No plans yet — empty-state row until first plan is added</p>'
    : `<table><thead><tr><th class="left">Client</th><th>Type</th><th>Value</th><th>Start</th><th>Credit</th><th>Pace</th><th>Next review</th><th>Held</th><th>Status</th><th>Flags</th></tr></thead>
      <tbody>${(data.plan_clients.rows || []).map((r) => `<tr>
        <td class="left">${esc(r.client)}</td><td>${esc(r.plan_type)}</td><td>${gbp(r.plan_value)}</td><td>${esc(r.start_date || '—')}</td>
        <td>${gbp(r.credit_used)}</td><td>${r.pace_pct == null ? '—' : r.pace_pct + '%'}</td>
        <td>${esc(r.next_review_due || '—')}</td><td>${r.reviews_held}/4</td><td>${esc(r.status || '—')}</td>
        <td>${(r.flags || []).join(', ') || '—'}</td></tr>`).join('')}</tbody></table>`}
</div>

<div class="sec">${tag('RESTORED — last 6')}<h2>9 · Beginners → plan conversion by course</h2>
  <table><thead><tr><th>Dates</th><th class="left">Course</th><th>Attendees</th><th>JLR</th><th>Plans ≤60d</th><th>Conv %</th></tr></thead>
  <tbody>${(data.beginners_conversion?.rows || []).map((r) => `<tr>
    <td>${esc(r.dates)}</td><td class="left">${esc(r.event)}</td><td>${r.attendees}</td><td>${r.jlr}</td>
    <td>${r.plans_60d == null ? '—' : r.plans_60d}</td><td>${r.conversion_pct == null ? '—' : r.conversion_pct + '%'}</td>
  </tr>`).join('') || '<tr><td colspan="6">No rows</td></tr>'}</tbody></table>
</div>

<div class="two">
  <div class="sec">${tag('RESTORED')}<h2>A · Beginners by source</h2>
    <table><thead><tr><th class="left">Source</th><th>Seats</th></tr></thead>
    <tbody>${['Google', 'Gift', 'Existing & referral', 'JLR', 'Other'].map((k) =>
      `<tr><td class="left">${esc(k)}</td><td>${sources[k] || 0}</td></tr>`).join('')}</tbody></table>
  </div>
  <div class="sec">${tag('RESTORED')}<h2>B · Plans &amp; workshops signals</h2>
    <table><tbody>
      <tr><td class="left">Residential avg / run</td><td>${ws.residential_avg ?? '—'}</td></tr>
      <tr><td class="left">Residentials ≤2 (60d)</td><td>${ws.residentials_at_risk_60d ?? 0}</td></tr>
      <tr><td class="left">Plan credit / reviews</td><td class="muted">${esc(data.plan_clients?.empty_reason || 'see Plan clients')}</td></tr>
    </tbody></table>
  </div>
</div>

<div class="sec">${tag('KEPT v4')}<h2>D · KPI scorecard (prior-12)</h2>
  <div style="overflow-x:auto"><table>
    <thead><tr><th class="left">KPI</th><th>QTD</th><th>L12</th><th>Prior</th><th>Change</th><th>Target</th><th>Status</th></tr></thead>
    <tbody>${(data.kpi_scorecard || []).map((k) => `<tr>
      <td class="left">${esc(k.name)}</td><td>${esc(k.qtd)}</td><td>${esc(k.l12)}</td><td>${esc(k.prior)}</td>
      <td>${fmtChange(k.change)}</td><td>${esc(k.target)}</td><td>${esc(k.status)}</td></tr>`).join('')}</tbody>
  </table></div>
</div>

<div class="sec">${tag('RESTORED')}<h2>C · All 11 KPIs</h2>
  <table><thead><tr><th>#</th><th class="left">KPI</th><th>Actual</th><th>Target</th><th>Status</th></tr></thead>
  <tbody>${(data.kpis || []).map((k) => {
    let actual = k.actual;
    if (k.unit === 'gbp') actual = gbp(k.actual);
    else if (k.actual == null) actual = '—';
    else if (k.unit === 'pct') actual = `${k.actual}%`;
    return `<tr><td>${k.id}</td><td class="left">${esc(k.label)}</td><td>${esc(actual)}</td>
      <td>${k.unit === 'gbp' ? gbp(k.target) : esc(k.target)}</td><td>${esc(k.status)}</td></tr>`;
  }).join('')}</tbody></table>
</div>

<div class="sec">${tag('KEPT v4')}<h2>G · Trends cards</h2>
  <div class="trends">
    <div class="trend"><div class="muted">GP T3</div><div class="big">${gbp(data.trends?.gp_t3)}</div><div class="muted">prior ${gbp(data.trends?.gp_t3_prior)}</div></div>
    <div class="trend"><div class="muted">Beginners fill</div><div class="big">${data.trends?.beginners_fill ?? '—'}%</div><div class="muted">prior ${data.trends?.beginners_fill_prior ?? '—'}%</div></div>
    <div class="trend"><div class="muted">Workshop attendees</div><div class="big">day ${data.trends?.day_attendees_l12 ?? '—'} · res ${data.trends?.res_attendees_l12 ?? '—'}</div></div>
    <div class="trend"><div class="muted">Avg / run</div><div class="big">day ${data.trends?.day_avg_l12 ?? '—'} · res ${data.trends?.res_avg_l12 ?? '—'}</div></div>
  </div>
</div>
</div></body></html>`;

const htmlPath = resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v5.html');
writeFileSync(htmlPath, html, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.screenshot({ path: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v5.png'), fullPage: true });
await browser.close();
console.log(JSON.stringify({
  htmlPath,
  png: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v5.png'),
  diary: data.diary?.length,
  kpis: data.kpis?.length,
  scorecard: data.kpi_scorecard?.length
}, null, 2));
