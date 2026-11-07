/**
 * Strategy & Actions "Where we stand and why" (agreed with Alan 7 Nov 2026): one-line summary + MONEY · DEMAND &
 * FULFILMENT · MIX & GROWTH rows. Built from what buildStrategySummary already loaded (same targets, GP method, diary)
 * plus Search Console, GA4, event snapshots, the Marketing customer table and Memberstack. Every tile carries its
 * window, source and freshness; estimates are labelled.
 */
import { gbp, rateLookup } from './common.mjs';
import { demandRow } from './demand.mjs';
import { mixRow } from './mix.mjs';
import { moneyRow } from './money.mjs';

const PAGE = 1000;
async function pageAll(sb, table, cols, build = (q) => q) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(sb.from(table).select(cols)).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

async function academyMembers(fetchFn = fetch) {
  const key = process.env.MEMBERSTACK_SECRET_KEY;
  if (!key) return { available: false };
  const members = [];
  let after = null;
  for (let i = 0; i < 100; i += 1) {
    const r = await fetchFn(`https://admin.memberstack.com/members?${new URLSearchParams({ limit: '100', ...(after ? { after } : {}) })}`, { headers: { 'X-API-KEY': key } });
    if (!r.ok) return { available: false };
    const j = await r.json();
    members.push(...(j.data || []));
    if (!j.hasNextPage) break;
    after = j.endCursor;
  }
  const trials = {};
  let paying = 0;
  for (const m of members) {
    const plans = m.planConnections || [];
    if (plans.some((p) => p.status === 'ACTIVE' && !/trial/i.test(p.planName || ''))) paying += 1;
    if (plans.some((p) => /trial/i.test(p.planName || '')) && m.createdAt) { const k = String(m.createdAt).slice(0, 7); trials[k] = (trials[k] || 0) + 1; }
  }
  return { available: true, members: members.length, paying, trials_by_month: trials };
}

/**
 * Pick n Mix from the plan statements (same counting rule as Marketing → Customers): active plans, plans started since
 * the relaunch, and plan payments in the last 12 months that are NOT already a Squarespace order or Booking Sheet row.
 */
const RELAUNCH = '2026-10-01';
async function planInfo(sb, today) {
  const [plans, people] = await Promise.all([
    pageAll(sb, 'pnm_plans', 'plan_key, starts, ends, paid_total'),
    pageAll(sb, 'customer_person', 'purchases:facts->purchases')
  ]);
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const planPays = people.flatMap((p) => (p.purchases || []).filter((x) => x.src === 'plan' && x.level === 'c' && x.date && x.date > yearAgo && x.date <= today));
  return {
    available: plans.length > 0, total: plans.length,
    active: plans.filter((p) => p.starts && p.starts <= today && (!p.ends || p.ends >= today)).length,
    since_relaunch: plans.filter((p) => p.starts && p.starts >= RELAUNCH).length,
    income_r12: Math.round(planPays.reduce((a, x) => a + (Number(x.net) || 0), 0))
  };
}

async function loadExtras(sb, propertyUrl, today) {
  const y = Number(today.slice(0, 4));
  const [gscRows, ga4Rows, snaps, overrides, people, terms, imported, academy] = await Promise.all([
    pageAll(sb, 'gsc_monthly_by_page', 'page_url, year, month, clicks, impressions, avg_position_imp_weighted, days_with_data', (q) => q.eq('property_url', propertyUrl).in('year', [y - 1, y])),
    sb.from('ga4_site_metrics_28d').select('date_start, date_end, attributed_sessions_28d, event_counts_attributed').eq('property_url', propertyUrl).order('date_end', { ascending: false }).limit(200).then((r) => r.data || []),
    pageAll(sb, 'strategy_event_snapshots', 'snapshot_date, event_date, event_key, title, event_type, capacity, qty_in_stock, sheet_booked, places_left', (q) => q.eq('property_url', propertyUrl)),
    sb.from('strategy_event_overrides').select('event_key, offer_note, offer_code, offer_ends, promote_mode').eq('property_url', propertyUrl).then((r) => r.data || []),
    pageAll(sb, 'customer_person', 'person_id, anchor_key, attached:facts->>attached_to, rtype:facts->>record_type'),
    sb.from('canonical_products').select('product_title, product_url').eq('category', 'subscription/payment-plan').eq('is_retired', false).then((r) => liveTerms(r.data || [])).catch(() => null),
    sb.from('booking_sheet_transactions').select('imported_at').eq('property_url', propertyUrl).order('imported_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data?.imported_at || null),
    academyMembers().catch(() => ({ available: false }))
  ]);
  return { gscRows, ga4Rows, snaps, overrides, people, terms, imported, academy, planInfo: await planInfo(sb, today) };
}

const PERIOD = { 1: 'a month', 3: 'a quarter', 12: 'a year up front' };

/** Live Pick n Mix terms from the product pages' public JSON (lowest variant per plan). */
async function liveTerms(rows, fetchFn = fetch) {
  const parts = await Promise.all(rows.map(async (r) => {
    const res = await fetchFn(`${r.product_url}?format=json`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlanRanger-AIGEOAudit/1.0)' } });
    const it = (await res.json()).item || {};
    const prices = (it.variants || []).map((v) => Number(v.priceMoney?.value ?? v.price)).filter((n) => n > 0);
    const months = (it.subscriptionPlan || it.productSubscriptionSettings)?.billingPeriod?.value;
    return prices.length && PERIOD[months] ? { months, text: `from £${Math.min(...prices).toLocaleString('en-GB')} ${PERIOD[months]}` } : null;
  }));
  return parts.filter(Boolean).sort((a, b) => a.months - b.months).map((p) => p.text).join(' · ') || null;
}

function summaryLine(rows) {
  const [m1, m2, m3, m4] = rows.money;
  const [d1] = rows.demand;
  const n = m2.numbers;
  return `${m1.title.split('·')[1].trim()}: ${m1.headline.value} sales so far (${m1.numbers.of_target_pct ?? '—'}% of the ${gbp(m1.numbers.sales_target)} sales target). Next 3 months need ${m2.headline.value} — every dated place is worth ${m2.boxes[0].value}, so ${m2.boxes[2].value} must come from non-dated sales (${n.lyNonDated ? `last year ${m2.boxes[2].sub.split('same 3 months last year ')[1]}` : 'no comparison'}). Sales YTD ${m3.headline.value}, GP margin ${m4.headline.value}${m4.headline.delta ? ` (${m4.headline.delta.text})` : ''}; clicks to the selling pages ${d1.headline.delta.text} on last year.`;
}

/** `base` = the pieces buildStrategySummary already has (txns, gpRates, master, diary, workshops, courses, plans, …). */
export async function buildStrategyInsights(sb, propertyUrl, base) {
  const today = base.today;
  const x = await loadExtras(sb, propertyUrl, today);
  const ctx = {
    ...base, today, rate: rateLookup(base.gpRates), sheetImported: x.imported,
    offers: new Map(x.overrides.filter((o) => o.offer_note && (!o.offer_ends || String(o.offer_ends).slice(0, 10) >= today)).map((o) => [o.event_key, o.offer_note])),
    gscRows: x.gscRows, ga4Rows: x.ga4Rows, snaps: x.snaps, people: x.people, terms: x.terms, academy: x.academy, planInfo: x.planInfo,
    dontPromote: new Set(x.overrides.filter((o) => o.promote_mode === 'dont_promote').map((o) => o.event_key))
  };
  const money = moneyRow(ctx).map((t) => ({ ...t, freshness: t.freshness || x.imported }));
  const demand = demandRow(ctx).map((t) => ({ ...t, freshness: t.freshness || x.imported }));
  const mix = mixRow({ ...ctx, money2: money[1].numbers }).map((t) => ({ ...t, freshness: t.freshness || (t.key === 'mix-academy' && x.academy?.available ? new Date().toISOString() : x.imported), freshness_label: t.freshness_label || (t.key === 'mix-academy' && x.academy?.available ? 'Memberstack read' : null) }));
  const rows = { money, demand, mix };
  return { as_of: today, built_at: new Date().toISOString(), booking_sheet_imported_at: x.imported, summary: summaryLine(rows), rows };
}
