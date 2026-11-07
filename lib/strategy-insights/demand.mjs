/** DEMAND & FULFILMENT row: search reach, enquiry / booking-intent events, booked ahead, events run. */
import { isMoneyPagePath } from '../revenue-funnel-money-pages.js';
import { cell, gbp, pct, ragDelta, round, sameDayLastYear, signPct, sumTx } from './common.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pathOf = (u) => { try { return new URL(u).pathname; } catch { return String(u || ''); } };
/** Blog posts sit at the site root, so the comparison row is every page outside the money-page list. */
const isOther = (u) => !isMoneyPagePath(pathOf(u));

/* ---------- 1 · search reach ---------- */

function gscAgg(rows) {
  const out = { clicks: 0, impressions: 0, posW: 0, pages: 0, partial: false };
  for (const r of rows) {
    out.clicks += Number(r.clicks) || 0;
    out.impressions += Number(r.impressions) || 0;
    out.posW += (Number(r.avg_position_imp_weighted) || 0) * (Number(r.impressions) || 0);
    out.pages += 1;
  }
  out.position = out.impressions ? out.posW / out.impressions : null;
  return out;
}

const num = (n) => n.toLocaleString('en-GB');
const deltaCell = (a, b) => { const d = pct(a, b); return cell(signPct(d), ragDelta(d)); };

function positionCell(now, ly) {
  if (now.position == null || ly.position == null) return cell('—');
  const d = now.position - ly.position;
  return cell(`${d > 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(1)} places`, d > 0.5 ? 'red' : 'green');
}

function searchRows(now, ly, other, otherLy) {
  const muted = { muted: true };
  return [
    [cell('Clicks · course, workshop & service pages'), cell(num(ly.clicks)), cell(num(now.clicks)), deltaCell(now.clicks, ly.clicks)],
    [cell('Avg Google position (lower = better)'), cell(ly.position?.toFixed(1) ?? '—'), cell(now.position?.toFixed(1) ?? '—'), positionCell(now, ly)],
    [cell('Impressions'), cell(num(ly.impressions)), cell(num(now.impressions)), deltaCell(now.impressions, ly.impressions)],
    [cell('Other pages: blog posts & tools (for comparison)', null, muted), cell(num(otherLy.clicks), null, muted), cell(num(other.clicks), null, muted), deltaCell(other.clicks, otherLy.clicks)]
  ];
}

function searchNote(d, otherD) {
  if (d == null || d >= -10) return 'Search reach to the selling pages is holding.';
  return otherD > 0 ? 'The blog is growing; the pages that sell have dropped in Google.' : 'Fewer people are finding the pages that sell — and the blog is down too.';
}

/** Last complete calendar month (same month last year as the comparison). */
function lastMonth(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 || 12;
  return { m, yr: m === 12 ? y - 1 : y };
}

export function searchTile(ctx) {
  const { gscRows, today } = ctx;
  const { m, yr } = lastMonth(today);
  const pick = (yy, pred) => gscAgg(gscRows.filter((r) => r.year === yy && r.month === m && pred(r.page_url)));
  const money = (u) => isMoneyPagePath(pathOf(u));
  const now = pick(yr, money);
  const ly = pick(yr - 1, money);
  const other = pick(yr, isOther);
  const otherLy = pick(yr - 1, isOther);
  const maxDays = Math.max(0, ...gscRows.filter((r) => r.year === yr && r.month === m).map((r) => Number(r.days_with_data) || 0));
  const partial = maxDays < new Date(Date.UTC(yr, m, 0)).getUTCDate() ? ' · month not complete in Search Console yet' : '';
  const d = pct(now.clicks, ly.clicks);
  const label = MONTHS[m - 1];
  return {
    key: 'demand-search', row: 'demand', title: 'People finding your course & workshop pages',
    headline: { value: num(now.clicks), label: `clicks in ${label}`, delta: { text: signPct(d), rag: ragDelta(d) } },
    comparison: `vs ${num(ly.clicks)} in ${label} ${yr - 1} · Google Search Console · the dashboard's money-page list (${now.pages} pages with data now, ${ly.pages} last year)${partial}`,
    table: { cols: [label, String(yr - 1), String(yr), 'Δ'], rows: searchRows(now, ly, other, otherLy) },
    note: searchNote(d, pct(other.clicks, otherLy.clicks)),
    link: { label: 'Search visibility →', panel: 'revenue-funnel' },
    source: `Search Console monthly by page · ${label} ${yr} vs ${label} ${yr - 1}`
  };
}

/* ---------- 2 · enquiry and booking-intent events ---------- */

const INTENT = [['Contact form sent', 'contact_us_form_submit'], ['Other forms sent', 'form_submit'], ['Acuity booking clicks', 'acuity_click'], ['Checkouts started', 'begin_checkout']];
const REFERENCE = [['Form fields clicked (form_start)', 'form_start'], ['Chat opened', 'chat_start'], ['Button clicks', 'cta_click']];

function ga4Window(row) {
  const ev = row.event_counts_attributed || {};
  const sessions = Number(row.attributed_sessions_28d) || 0;
  const total = INTENT.reduce((a, [, k]) => a + (Number(ev[k]) || 0), 0);
  return { ev, sessions, total, per1000: sessions ? (total / sessions) * 1000 : null, start: row.date_start, end: row.date_end };
}

function bookingsIn(txns, from, to) {
  const rows = txns.filter((t) => t.txn_date >= from && t.txn_date <= to && Number(t.amount) > 0 && [1, 2, 3, 6, 7].includes(Number(t.category_order)));
  return { n: rows.length, gbp: sumTx(txns, from, to) };
}

export function intentTile(ctx) {
  const { ga4Rows, txns } = ctx;
  const latest = ga4Rows[0];
  const base = [...ga4Rows].reverse().find((r) => r.event_counts_attributed);
  if (!latest || !base) return { key: 'demand-intent', row: 'demand', title: 'Enquiries → bookings', headline: { value: '—', label: 'GA4 not available' }, note: 'No bot-filtered GA4 window stored yet.', source: 'GA4' };
  const a = ga4Window(base);
  const b = ga4Window(latest);
  const d = pct(b.total, a.total);
  const row = ([label, k], muted) => [cell(label, null, { muted }), cell(Number(a.ev[k]) || 0, null, { muted }), cell(Number(b.ev[k]) || 0, null, { muted }), cell(signPct(pct(Number(b.ev[k]) || 0, Number(a.ev[k]) || 0)), muted ? 'grey' : ragDelta(pct(Number(b.ev[k]) || 0, Number(a.ev[k]) || 0)), { muted })];
  const nowB = bookingsIn(txns, b.start, b.end);
  const lyB = bookingsIn(txns, sameDayLastYear(b.start), sameDayLastYear(b.end));
  const perD = pct(b.per1000, a.per1000);
  return {
    key: 'demand-intent', row: 'demand', title: 'Enquiries → bookings',
    headline: { value: String(b.total), label: 'enquiry and booking-intent events · 28 days', delta: { text: signPct(d), rag: ragDelta(d) } },
    comparison: `${nowB.n} bookings (${signPct(pct(nowB.n, lyB.n))} vs last year) · GA4 site-wide (bot traffic filtered) + Booking Sheet`,
    table: { cols: ['28 days', `to ${ukDay(a.end)}`, `to ${ukDay(b.end)}`, 'Δ'], sections: [
      { rows: [[cell('Visits (sessions)'), cell(a.sessions.toLocaleString('en-GB')), cell(b.sessions.toLocaleString('en-GB')), cell(signPct(pct(b.sessions, a.sessions)), ragDelta(pct(b.sessions, a.sessions)))]] },
      { head: 'Enquiry and booking-intent events', rows: [...INTENT.map((x) => row(x, false)),
        [cell('Total', null, { bold: true }), cell(a.total), cell(b.total), cell(signPct(d), ragDelta(d))],
        [cell('Per 1,000 visits', null, { bold: true }), cell(a.per1000?.toFixed(1) ?? '—'), cell(b.per1000?.toFixed(1) ?? '—'), cell(signPct(perD), ragDelta(perD))]] },
      { head: 'Not enquiries (shown for reference)', rows: REFERENCE.map((x) => row(x, true)) },
      { head: 'Sales (Booking Sheet) · vs same 28 days last year', rows: [
        [cell('Bookings'), cell(lyB.n), cell(nowB.n), cell(signPct(pct(nowB.n, lyB.n)), ragDelta(pct(nowB.n, lyB.n)))],
        [cell('Sales £'), cell(gbp(lyB.gbp)), cell(gbp(nowB.gbp)), cell(signPct(pct(nowB.gbp, lyB.gbp)), ragDelta(pct(nowB.gbp, lyB.gbp)))]] }
    ] },
    note: ctx.searchDown && perD > 0 ? 'Commercial search reach has fallen; recorded intent per visit is higher.' : (perD > 0 ? 'Recorded intent per visit is higher.' : 'Recorded intent per visit is lower.'),
    foot: `GA4 history starts May 2026, so this compares with the earliest bot-filtered 28 days (to ${ukDay(a.end)}); year-on-year from next spring. Bookings are never divided by GA4 events.`,
    link: { label: 'Pipeline & Funnel →', panel: 'revenue-funnel' },
    source: `GA4 28-day windows (bot-filtered) · Booking Sheet · last GA4 window ends ${ukDay(b.end)}`
  };
}

/* ---------- 3 · booked ahead ---------- */

const TYPE_ROWS = [['Courses (incl. Lightroom)', ['course']], ['Day workshops & walks', ['day', 'walk']], ['Residentials', ['residential']]];

function snapshotSold(snaps, snapDate, horizonDays) {
  const end = new Date(Date.parse(`${snapDate}T00:00:00Z`) + horizonDays * 86400000).toISOString().slice(0, 10);
  const rows = snaps.filter((s) => s.snapshot_date === snapDate && s.event_date >= snapDate && s.event_date <= end);
  const booked = rows.reduce((a, s) => a + (Number(s.sheet_booked) || 0), 0);
  const cap = rows.reduce((a, s) => a + (Number(s.capacity) || 0), 0);
  return { events: rows.length, booked, cap, pct: cap ? (booked / cap) * 100 : null };
}

const TARGET_PER_EVENT = 3;
const sumOf = (list, k) => list.reduce((acc, e) => acc + (e[k] || 0), 0);
const perEventRag = (per) => {
  if (per == null) return 'grey';
  if (per >= TARGET_PER_EVENT) return 'green';
  return per >= TARGET_PER_EVENT * 0.5 ? 'amber' : 'red';
};

function aheadRows(events) {
  return TYPE_ROWS.map(([label, types]) => {
    const ev = events.filter((e) => types.includes(e.type));
    const per = ev.length ? sumOf(ev, 'booked') / ev.length : null;
    return [cell(label), cell(ev.length), cell(`${sumOf(ev, 'booked')} / ${sumOf(ev, 'cap')}`), cell(per == null ? '—' : per.toFixed(1), perEventRag(per))];
  });
}

/** The snapshot nearest to a month ago (the earliest one while history is shorter than a month). */
function monthAgo(snaps, today) {
  const dates = [...new Set(snaps.map((s) => s.snapshot_date))].sort();
  const cut = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
  const ref = dates.filter((d) => d <= cut).pop() || dates[0] || null;
  return { dates, ref, then: ref ? snapshotSold(snaps, ref, 84) : null };
}

const thenText = (then) => (then?.pct == null ? '—' : `${Math.round(then.pct)}% · ${then.booked} of ${then.cap} places, ${then.events} events`);

export function bookedAheadTile(ctx) {
  const { diary, snaps, today } = ctx;
  const events = diary.filter((e) => e.date >= today);
  const booked = sumOf(events, 'booked');
  const cap = sumOf(events, 'cap');
  const p = cap ? (booked / cap) * 100 : null;
  const { dates, ref, then } = monthAgo(snaps, today);
  const dPts = then?.pct != null && p != null ? p - then.pct : null;
  const rows = aheadRows(events);
  const span = dates.length ? `${ukDay(dates[0])} – ${ukDay(dates[dates.length - 1])}` : '—';
  return {
    key: 'demand-booked-ahead', row: 'demand', title: 'Booked ahead · next 3 months',
    headline: { value: p == null ? '—' : `${Math.round(p)}%`, label: `· ${booked} of ${cap} places sold`, delta: dPts == null ? null : { text: `${dPts >= 0 ? '▲' : '▼'}${Math.abs(dPts).toFixed(0)} pts`, rag: dPts >= 0 ? 'green' : 'red' } },
    comparison: `current forward position: ${events.length} dated events in the next 12 weeks · a month ago (${ref ? ukDay(ref) : '—'}): ${thenText(then)} (the sets of events differ) · target ${TARGET_PER_EVENT} people per event`,
    table: { cols: ['Type', 'Events', 'Booked', 'Per event'], rows },
    note: rows.some((r) => r[3].rag === 'red') ? 'Courses and day events are almost empty — exactly the high-margin work.' : 'Forward bookings are on track for the target per event.',
    foot: 'Daily snapshots began 7 Oct, so this compares with a month ago; the same events\' booking trajectory and the previous 3 months follow as history builds; year-on-year from next autumn.',
    link: { label: 'Next 4 weeks →', anchor: 'st-next4' },
    source: `diary (live site stock + Booking Sheet) · event snapshots ${span}`
  };
}

/* ---------- 4 · how full, did they run ---------- */

const runKey = (s) => `${s.event_date}|${s.event_type === 'walk' ? 'day' : s.event_type}|${String(s.title || '').toLowerCase().replace(/\b(am|pm|morning|afternoon|sunrise|sunset)\b/g, '').replace(/[^a-z]+/g, ' ').trim().slice(0, 40)}`;

function sheetRan(ev, ctx) {
  if (ev.type === 'course') return ctx.courses.some((c) => c.from_date === ev.date && c.client_name);
  return ctx.workshops.some((w) => w.event_start === ev.date && w.client_name && (ev.type === 'residential') === !!w.is_multi_day);
}

/** Every event listed since snapshots began whose date has passed: ran / withdrawn / cancelled (reason). */
export function runOutcomes(ctx) {
  const { snaps, today } = ctx;
  const byEvent = new Map();
  for (const s of snaps) {
    if (s.event_date >= today) continue;
    const k = runKey(s);
    const prev = byEvent.get(k);
    if (!prev || s.snapshot_date > prev.last.snapshot_date) byEvent.set(k, { key: k, date: s.event_date, type: s.event_type === 'walk' ? 'day' : s.event_type, title: s.title, last: s });
  }
  return [...byEvent.values()].map((e) => {
    const lastDay = new Date(Date.parse(`${e.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const siteSold = Math.max(0, (Number(e.last.capacity) || 0) - (Number(e.last.qty_in_stock) || 0));
    if (e.last.snapshot_date < lastDay) return { ...e, outcome: 'withdrawn', siteSold };
    if (sheetRan(e, ctx)) return { ...e, outcome: 'ran', siteSold };
    const diaryBooked = Math.max(siteSold, Number(e.last.sheet_booked) || 0);
    const reason = diaryBooked > 0 ? 'had bookings, reason not recorded (e.g. weather)' : 'no bookings';
    return { ...e, outcome: 'cancelled', reason, siteSold: diaryBooked, mismatch: diaryBooked > 0 };
  });
}

const parseLine = (s) => String(s || '').split(/\s*\/\s*/).map((x) => Number(String(x).replace('%', '')));

export function runTile(ctx) {
  const { scorecard, snaps } = ctx;
  const f = Object.fromEntries((scorecard || []).map((k) => [k.key, k]));
  const fill = parseLine(f.F4?.l12);
  const fillP = parseLine(f.F4?.prior);
  const outcomes = runOutcomes(ctx);
  const per = (k) => ({ l12: f[k]?.l12, prior: f[k]?.prior });
  const rowA = (label, k, i) => { const v = per(k); const d = pct(v.l12, v.prior); return [cell(label), cell(v.prior ?? '—'), cell(v.l12 ?? '—'), cell(signPct(d), ragDelta(d)), cell(Number.isFinite(fill[i]) ? `${fill[i]}%` : '—', null, { title: `prior ${Number.isFinite(fillP[i]) ? `${fillP[i]}%` : '—'}` })]; };
  const typeRow = (label, type) => {
    const o = outcomes.filter((e) => e.type === type);
    const ran = o.filter((e) => e.outcome === 'ran').length;
    const wd = o.filter((e) => e.outcome === 'withdrawn').length;
    const cx = o.filter((e) => e.outcome === 'cancelled');
    const listed = o.length - wd;
    const reasons = Object.entries(cx.reduce((m, c) => ({ ...m, [c.reason]: (m[c.reason] || 0) + 1 }), {})).map(([r, n]) => `${n} ${r}`).join('; ');
    return [cell(label), cell(o.length), cell(ran), cell(listed ? `${Math.round((ran / listed) * 100)}%` : '—', listed ? (ran / listed >= 0.8 ? 'green' : (ran / listed >= 0.5 ? 'amber' : 'red')) : 'grey'), cell(wd), cell(cx.length ? `${cx.length}: ${reasons}` : 0)];
  };
  const since = [...new Set(snaps.map((s) => s.snapshot_date))].sort()[0];
  const mism = outcomes.filter((e) => e.mismatch);
  const head = per('F1');
  const d = pct(head.l12, head.prior);
  return {
    key: 'demand-runs', row: 'demand', title: 'Events: how full, and did they run?',
    headline: { value: String(head.l12 ?? '—'), label: 'people per day workshop', delta: { text: signPct(d), rag: ragDelta(d) } },
    comparison: 'finished events, last 12 months vs previous 12 · target 3 per event · fill % = attendees ÷ each event\'s capacity',
    table: { cols: ['Finished events', 'prev 12m', 'last 12m', 'Δ', 'Fill %'], rows: [rowA('Day workshops', 'F1', 0), rowA('Residentials', 'F2', 1), rowA('Beginners courses', 'F3', 2)] },
    table2: { cols: [`Since ${since ? ukDay(since) : '—'}`, 'Listed', 'Ran', 'Ran %', 'Withdrawn', 'Cancelled (reason)'], rows: [typeRow('Day workshops & walks', 'day'), typeRow('Residentials', 'residential'), typeRow('Courses', 'course')] },
    note: outcomes.filter((e) => e.type === 'course' && e.outcome === 'ran').length ? 'Day workshops are thinner than last year.' : 'Day workshops are thinner and no beginners course has run since snapshots began — no route into Pick n Mix.',
    foot: `Ran = the Booking Sheet shows attendees on that date. Withdrawn = removed from the website before the date (not a failure). Capacity is stored per event in the daily snapshots.${mism.length ? ` Diary showed bookings but the Booking Sheet has no attendees: ${mism.map((m) => `${String(m.title).split(/[|–-]/)[0].trim()} ${ukDay(m.date)} (diary ${m.siteSold}, sheet 0)`).join('; ')}.` : ''}`,
    link: { label: 'Fill high-margin dates →', anchor: 'st-next4' },
    source: 'Booking Sheet attendees · daily website event snapshots · KPI scorecard F1–F4', outcomes: outcomes.map(({ last, ...o }) => o)
  };
}

export function demandRow(ctx) {
  const s = searchTile(ctx);
  const searchDown = /^-/.test(s.headline.delta?.text || '');
  return [s, intentTile({ ...ctx, searchDown }), bookedAheadTile(ctx), runTile(ctx)];
}
export { round };
