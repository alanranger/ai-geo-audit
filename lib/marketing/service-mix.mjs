/**
 * Marketing "Next 12 weeks: what we're promoting, by service" + "Service × channel coverage" (QUESTION-2026-11-12
 * service-mix-tiles, Alan 00:08). The browser counts exactly the by-channel tile's items; this module gives each of
 * them a service tier from stored data only, in this order:
 *   1. its own destination link (social placement link_url, the Google Business post's page, an event campaign's
 *      page) → canonical_products product page / event page → product (v_event_product_links_best2) / service page;
 *   2. its campaign's stored Booking Sheet categories (strategy_campaigns.categories);
 *   3. its campaign's events (strategy_campaigns.event_keys);
 *   4. its featured links (each module of an email or post);
 *   5. its primary initiative's target lines (strategy_initiatives.target.lines[].category).
 * The first that resolves is the PRIMARY tier; any others are secondary modules (hover only, never counted again).
 * Nothing resolves → "Not service-specific", with the reason. Product category → tier = lib/revenue-tier-mapping.js;
 * % of target = the Survival Cockpit's own tier targets (funnelTargetsFrom over FUNNEL_TIERS); flag thresholds =
 * business_targets.campaign_targets.service_mix (defaults 0.5× / 1.5×). Read-only.
 */
import { tierFromProductCategory, TIER_DEFINITIONS, BOOKING_CATEGORY_ALIASES } from '../revenue-tier-mapping.js';
import { FUNNEL_TIERS } from '../money-pages-by-tier.mjs';
import { funnelTargetsFrom } from '../funnel-targets.mjs';
import { sheetCategoryNumber } from './categories.mjs';

const SITE = 'https://www.alanranger.com';
export const DEFAULT_THRESHOLDS = { under: 0.5, over: 1.5 };

/** Tile rows in the mock's order; `tiers` = revenue-tier keys (lib/revenue-tier-mapping.js) that land in the row. */
export const SERVICE_ROWS = [
  { key: 'workshops_residential', label: 'Workshops (Residential)', tiers: ['workshops_residential'] },
  { key: 'workshops_nonres', label: 'Workshops (Non-Res)', tiers: ['workshops_non_residential'] },
  { key: 'courses', label: 'Courses', tiers: ['courses_masterclasses'] },
  { key: 'gift_vouchers', label: 'Gift vouchers', tiers: ['gift_vouchers_inc'] },
  { key: 'pnm_academy', label: 'Pick n Mix / Academy', tiers: ['pick_n_mix_inc', 'academy'] },
  { key: 'services', label: '1-2-1 & Services', sub: '1-2-1, mentoring', tiers: ['one_to_one_lessons', 'mentoring'] },
  { key: 'hire', label: 'Hire / Commercial', sub: 'commissions', tiers: ['commissions'] },
  { key: 'prints', label: 'Prints & royalties', tiers: ['prints_royalties'] },
  { key: 'none', label: 'Not service-specific', sub: 'education, thank-you, Light & Logic', tiers: [] }
];
const ROW_OF_TIER = new Map(SERVICE_ROWS.flatMap((r) => r.tiers.map((t) => [t, r.key])));
/** Booking Sheet category number (1–12) → revenue tier, from the same definitions (Inc / Out lines fold together). */
const TIER_OF_NUMBER = new Map([
  ...Object.entries(TIER_DEFINITIONS).map(([k, d]) => [sheetCategoryNumber(d.bookingCategory), k]),
  ...Object.entries(BOOKING_CATEGORY_ALIASES).map(([label, k]) => [sheetCategoryNumber(label), k])
]);
export const rowOfCategory = (cat) => ROW_OF_TIER.get(tierFromProductCategory(cat)) || null;
export const rowOfNumber = (num) => ROW_OF_TIER.get(TIER_OF_NUMBER.get(Number(num))) || null;
const rowLabel = (key) => SERVICE_ROWS.find((r) => r.key === key)?.label || key;

/** Site path of a link (lower case, no trailing slash); null for another site (YouTube, Squarespace config, …). */
export function pathOf(url) {
  if (!url) return null;
  try {
    const u = new URL(url, SITE);
    if (!/(^|\.)alanranger\.com$/i.test(u.hostname)) return null;
    return u.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

/* ---------- references (canonical products, event → product, campaigns, initiatives, settings) ---------- */

function addTo(map, key, row) {
  if (!key || !row) return;
  (map.get(key) || map.set(key, new Set()).get(key)).add(row);
}
/** canonical_products → product page → rows and service page → rows (live rows only). */
export function productIndex(rows) {
  const product = new Map();
  const hub = new Map();
  for (const r of (rows || []).filter((x) => !x.is_retired)) {
    const row = rowOfCategory(r.category);
    addTo(product, pathOf(r.product_url), row);
    addTo(hub, pathOf(r.service_page_url), row);
  }
  return { product, hub };
}
const one = (set) => (set && set.size === 1 ? [...set][0] : null);

/** A link → { row, via } through its product page, its event's product, else its service page; null when nothing fits. */
export function resolveLink(url, refs) {
  const p = pathOf(url);
  if (!p) return null;
  const byProduct = one(refs.product.get(p));
  if (byProduct) return { row: byProduct, via: `product page ${p}` };
  const ev = refs.event.get(p);
  const byEvent = ev ? one(refs.product.get(ev)) : null;
  if (byEvent) return { row: byEvent, via: `event ${p} → product ${ev}` };
  const byHub = one(refs.hub.get(p));
  return byHub ? { row: byHub, via: `service page ${p}` } : null;
}

const linkSignals = (urls, refs, what) => (urls || []).map((u) => resolveLink(u, refs)).filter(Boolean).map((s) => ({ ...s, via: `${what}: ${s.via}` }));
const eventPath = (key) => String(key || '').split('|').slice(1).join('|') || null;
const numberSignals = (nums, what) => (nums || []).map((c) => ({ row: rowOfNumber(c), via: `${what} (Booking Sheet ${c})` })).filter((s) => s.row);
function initiativeSignals(key, refs, what) {
  const ini = refs.initiatives.get(key);
  return numberSignals((ini?.target?.lines || []).map((l) => l.category).filter((c) => c != null), `${what} "${ini?.title || key}" target`);
}

/** Every signal for one item, in the stated order; the first is the primary tier. */
function signalsOf(it, refs) {
  const camp = refs.campaigns.get(it.campaign_key) || null;
  return [
    ...linkSignals(it.own_links, refs, 'link'),
    ...numberSignals(camp?.categories, 'campaign categories'),
    ...linkSignals((camp?.event_keys || [camp?.event_key]).map(eventPath).filter(Boolean).map((p) => `${SITE}${p}`), refs, 'campaign event'),
    ...linkSignals(it.links, refs, 'featured'),
    ...initiativeSignals(it.initiative_key, refs, 'initiative'),
    ...(it.supports || []).flatMap((k) => initiativeSignals(k, refs, 'supporting initiative'))
  ];
}
const NONE_WHY = 'no link to a product or service page, no campaign categories or event, and its initiative has no target category';
/** { row, via, title, secondary[] } for one item; "none" with the reason when nothing resolves. */
export function tagOf(it, refs) {
  const sig = signalsOf(it, refs);
  if (!sig.length) return { row: 'none', via: NONE_WHY, title: it.title || null, secondary: [] };
  const seen = new Set([sig[0].row]);
  const secondary = sig.slice(1).filter((s) => !seen.has(s.row) && seen.add(s.row)).map((s) => ({ row: s.row, label: rowLabel(s.row), via: s.via }));
  return { row: sig[0].row, via: sig[0].via, title: it.title || null, secondary };
}

/* ---------- the items the by-channel tile counts (refs = its item refs) ---------- */

/** Social step → its placements' destination links (one post, several placements: the same link). */
function placementLinks(board) {
  const out = new Map();
  for (const p of board?.placements || []) if (p.link_url) (out.get(p.step_key) || out.set(p.step_key, []).get(p.step_key)).push(p.link_url);
  return out;
}
const gbpPage = (key) => String(key).split('|').slice(3).join('|') || null;
/** An event campaign's own send (event|<date>|<page>): that event page. */
function eventCampaignLink(it) {
  const k = String(it.campaign_key || it.key || '').replace(/^send\|/, '');
  return k.startsWith('event|') ? [`${SITE}${eventPath(eventPath(k))}`] : [];
}
/** Content-mix items, Google Business exception posts and Shorts, each with its own links. */
export function itemsToTag({ mix, board, campaign }) {
  const links = placementLinks(board);
  const mixItems = (mix?.items || []).map((x) => ({ ...x, own_links: [...(links.get(x.key) || []), ...eventCampaignLink(x)] }));
  const steps = [...(campaign?.weeks || []).flatMap((w) => w.steps || []), ...(campaign?.carried?.future || [])].filter((x) => x.gbp === 'exception');
  const gbp = steps.map((x) => ({ key: x.key, title: x.step, own_links: gbpPage(x.key) ? [`${SITE}${gbpPage(x.key)}`] : [], links: (x.featured || []).map((f) => f.url).filter(Boolean) }));
  const shorts = (board?.content || []).filter((a) => a.format === 'short_video').map((a) => ({ key: a.asset_key, title: a.title, own_links: [a.url || a.provider?.url].filter(Boolean) }));
  return [...mixItems, ...gbp, ...shorts];
}
/** Event pages the items mention (Google Business posts, event campaigns): the event → product lookup reads only these. */
export function eventUrlsOf(items, campaignRows) {
  const paths = new Set();
  for (const it of items) for (const u of [...(it.own_links || []), ...(it.links || [])]) if (pathOf(u)) paths.add(pathOf(u));
  for (const r of campaignRows || []) for (const k of [r.event_key, ...(r.event_keys || [])]) if (eventPath(k)) paths.add(eventPath(k).toLowerCase());
  return [...paths].map((p) => `${SITE}${p}`);
}

/* ---------- targets ---------- */

/** Each target row's monthly target = the Survival Cockpit tier whose first revenue tier lands in that row. */
export function targetsOf(master) {
  const ft = master ? funnelTargetsFrom(master, FUNNEL_TIERS.map((t) => ({ id: t.id, categories: t.cats }))) : null;
  const out = {};
  for (const t of FUNNEL_TIERS) {
    const row = ROW_OF_TIER.get(t.diag[0]);
    if (row && ft) out[row] = { tier: t.id, label: t.label, monthly: ft.tiers[t.id]?.monthly_target ?? 0, categories: t.cats };
  }
  return out;
}
/** The separate gift target: the initiative whose approved target counts Booking Sheet gift-voucher receipts. */
export function giftTargetOf(initiatives) {
  const ini = [...(initiatives || [])].find((i) => (i.target?.lines || []).some((l) => rowOfNumber(l.category) === 'gift_vouchers'));
  if (!ini) return null;
  return { title: ini.title, total: ini.target.total ?? null, from: ini.target.window?.start || ini.start_date || null, to: ini.target.window?.end || ini.end_date || null };
}
export function thresholdsOf(campaignTargets, setAt) {
  const s = campaignTargets?.service_mix || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const stored = s.under_share_ratio != null && s.over_share_ratio != null;
  return {
    under: num(s.under_share_ratio, DEFAULT_THRESHOLDS.under), over: num(s.over_share_ratio, DEFAULT_THRESHOLDS.over),
    source: stored ? `stored setting (business_targets.campaign_targets.service_mix${setAt ? `, ${setAt}` : ''})` : 'default 0.5× / 1.5× (business_targets.campaign_targets.service_mix not set yet)'
  };
}

/** The payload the two tiles read (s.service_mix). */
export function buildServiceMix({ mix, board, campaign, master, refs, campaignTargets, setAt }) {
  const items = itemsToTag({ mix, board, campaign });
  const tags = Object.fromEntries(items.map((it) => [it.key, tagOf(it, refs)]));
  return {
    rows: SERVICE_ROWS.map(({ key, label, sub }) => ({ key, label, sub: sub || null })),
    tags, targets: targetsOf(master), gift: giftTargetOf([...refs.initiatives.values()]), thresholds: thresholdsOf(campaignTargets, setAt),
    basis: 'tier = the item\'s own link → product (canonical_products, event → product), else its campaign\'s Booking Sheet categories, its campaign\'s events, its featured links, its initiative\'s target category; % of target = Survival Cockpit tier monthly target ÷ the six tiers\' total'
  };
}

/* ---------- load (read-only) ---------- */

const rowsOf = (label) => (r) => {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data || [];
};
/** canonical products, campaign categories / events, initiatives, the event → product links needed, the settings row. */
export async function loadServiceRefs(supabase, propertyUrl, items) {
  const [products, campaignRows, initiatives, targets] = await Promise.all([
    supabase.from('canonical_products').select('product_url, service_page_url, category, is_retired').limit(2000).then(rowsOf('canonical_products')),
    supabase.from('strategy_campaigns').select('campaign_key, categories, event_key, event_keys').eq('property_url', propertyUrl).limit(2000).then(rowsOf('strategy_campaigns')),
    supabase.from('strategy_initiatives').select('initiative_key, title, target, start_date, end_date').eq('property_url', propertyUrl).limit(500).then(rowsOf('strategy_initiatives')),
    supabase.from('business_targets').select('campaign_targets, effective_from, updated_at').eq('property_url', propertyUrl).order('effective_from', { ascending: false }).limit(1).then(rowsOf('business_targets'))
  ]);
  const urls = eventUrlsOf(items, campaignRows);
  const links = urls.length ? await supabase.from('v_event_product_links_best2').select('event_url, product_url').in('event_url', urls).then(rowsOf('v_event_product_links_best2')) : [];
  return {
    refs: { ...productIndex(products), event: new Map(links.map((l) => [pathOf(l.event_url), pathOf(l.product_url)])), campaigns: new Map(campaignRows.map((r) => [r.campaign_key, r])), initiatives: new Map(initiatives.map((i) => [i.initiative_key, i])) },
    campaignTargets: targets[0]?.campaign_targets || null, setAt: targets[0]?.updated_at || targets[0]?.effective_from || null
  };
}
/** Strategy summary hook: never breaks the summary; a failure is reported (the tiles then say so). */
export async function softServiceMix(supabase, propertyUrl, { quarterPlan, board, campaign, master }) {
  const mix = quarterPlan?.purpose_mix;
  try {
    if (!mix?.items) return { error: 'content-mix list not available' };
    const items = itemsToTag({ mix, board, campaign });
    const loaded = await loadServiceRefs(supabase, propertyUrl, items);
    return buildServiceMix({ mix, board: board?.error ? null : board, campaign, master, ...loaded });
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}
