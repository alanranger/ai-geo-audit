/**
 * Customer table driven by a structured query: filter → sort → page on the server. Header totals cover every matching
 * person, not just the page; money is summed once per person from that person's own sales (buyer attribution, each
 * sale counted once), confirmed and probable kept apart. Ties sort by person ID so pages are stable.
 */
import { engagementView } from '../engagement.mjs';
import { milesBetween } from '../facts.mjs';
import { condText, describe, validateQuery } from './english.mjs';
import { evalNode, rowCtx } from './evaluate.mjs';
import { FIELD } from './fields.mjs';
import { isListed } from '../record-type.mjs';
import { CONSENT_PRECEDENCE, EMAIL_STATES, PURCHASE_BANDS, badgeWatermark, badgesOf, isOwner } from '../client-health.mjs';
import { topicLabel, topicsOf } from './topics.mjs';
import { orderValue, valueBreakdown } from '../value.mjs';

const vc = (f) => f.value?.c || {};
/** Latest evidence of any kind: a confirmed or probable purchase, or a booking (incl. name-only Booking Sheet rows). */
const lastActivity = (f) => [f.value?.cp?.last, f.last_booking].filter(Boolean).map((d) => String(d).slice(0, 10)).sort().pop() || null;
const vp = (f) => f.value?.p || {};
const next = (f) => (f.future || []).filter((b) => b.level === 'c').sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
const kindOf = (p) => (p.facts?.admin ? 'admin' : p.anchor_key.split(':')[0]);
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);
const DONE_ORDER = ['beginners', 'lightroom', 'course', 'day_workshop', 'woodland', 'abstract_macro', 'residential', 'one_to_one', 'mentoring', 'academy', 'pick_n_mix', 'voucher_bought'];
/** Of the last 10 stored campaigns delivered to this person, how many they opened (null before exposure is stored). */
function openedLast10(p) {
  const c = p.facts.camps;
  if (!c?.d?.length) return null;
  const opened = new Set(c.o || []);
  return c.d.slice(0, 10).filter((id) => opened.has(id)).length;
}
function clickTopic(click) {
  if (!click) return null;
  const t = topicsOf(click.url).filter((k) => k !== 'workshops' && k !== 'blog')[0] || topicsOf(click.url)[0];
  return t ? topicLabel(t) : String(click.url).replace(/^alanranger\.com/, '').slice(0, 40);
}

export const COLUMNS = {
  name: { label: 'Name', get: (p) => p.facts.name || p.display_name || null },
  email: { label: 'Email', get: (p) => p.facts.email || null },
  kind: { label: 'Record', get: kindOf },
  record_type: { label: 'Type', get: (p) => p.facts.record_type || 'person' },
  attached_records: { label: 'Name records under it', get: (p) => p.facts.attached_records || null },
  eligible: { label: 'Can email', get: (p, R) => FIELD.get('eligible').get(R) },
  subscribed: { label: 'Subscribed', get: (p) => (p.facts.profile_state === 'none' ? null : !!p.facts.subscribed) },
  suppressed: { label: 'Suppressed', get: (p) => p.facts.suppressed || null },
  spend_net: { label: 'Known net £', money: true, get: (p) => vc(p.facts).net ?? 0, sub: (p) => valueBreakdown(vc(p.facts)) },
  spend_probable: { label: '+ probable £', money: true, get: (p) => vp(p.facts).net || null },
  spend_r12: { label: '12-month £', money: true, get: (p) => vc(p.facts).r12_net ?? 0 },
  orders: { label: 'Orders (incl. plan payments)', get: (p) => orderValue(vc(p.facts)).sales, sub: (p) => valueBreakdown(vc(p.facts)) },
  places: { label: 'Places', get: (p) => vc(p.facts).places ?? 0 },
  bookings: { label: 'Bookings', get: (p) => p.facts.booking_count ?? 0 },
  aov: { label: 'Avg order £ (net ÷ orders)', money: true, get: (p) => orderValue(vc(p.facts)).aov, sub: (p) => valueBreakdown(vc(p.facts)) },
  refunds: { label: 'Refunded £', money: true, get: (p) => vc(p.facts).refunds || null },
  first_purchase: { label: 'First purchase', date: true, get: (p) => p.facts.value?.cp?.first || null },
  last_purchase: { label: 'Last activity (any evidence)', date: true, get: (p) => lastActivity(p.facts) },
  last_product: { label: 'Last product', get: (p) => p.facts.value?.cp?.last_title || null },
  last_category: { label: 'Last category', get: (p) => (p.facts.value?.cp?.last_cats || []).join(', ') || null },
  next_event: { label: 'Next booked', date: true, get: (p) => next(p.facts)?.date || null, title: (p) => next(p.facts)?.title || null },
  miles: { label: 'Miles', get: (p, R) => { const m = milesBetween(R.centre, p.facts); return m == null ? null : Math.round(m); } },
  postcode: { label: 'Postcode', get: (p) => p.facts.postcode || null },
  academy: { label: 'Academy', get: (p, R) => (R.academyFeed ? (p.facts.academy || 'none') : null) },
  last_emailed: { label: 'Last emailed', date: true, get: (p) => dayOf(p.facts.engagement?.last_delivered_at) },
  last_open: { label: 'Last open', date: true, get: (p) => dayOf(p.facts.engagement?.last_open_at) },
  last_click: { label: 'Last click', date: true, get: (p) => dayOf(p.facts.engagement?.last_click_at) },
  delivered: { label: 'Emails got', get: (p) => p.facts.engagement?.delivered_campaigns ?? null },
  opened: { label: 'Opened', get: (p) => p.facts.engagement?.opened_campaigns ?? null },
  clicked: { label: 'Clicked', get: (p) => p.facts.engagement?.clicked_campaigns ?? null },
  open_band: { label: 'Email activity', get: (p, R) => engagementView(p.facts.engagement, R.engagementComplete, R.windows, R.today).open },
  opened_last10: { label: 'Opened (last 10)', get: openedLast10 },
  last_clicked: { label: 'Last clicked', date: true, get: (p) => dayOf(p.facts.clicks?.[0]?.at), sub: (p) => clickTopic(p.facts.clicks?.[0]) },
  has_done: { label: 'Has done', chips: true, get: (p) => DONE_ORDER.filter((c) => (p.facts.cats?.[c]?.c || 0) > 0 || (c === 'academy' && p.facts.academy === 'member')) },
  last_booking: { label: 'Last booking', date: true, get: (p) => p.facts.last_booking || null },
  history_incomplete: { label: 'History gaps', get: (p) => !!p.facts.history_incomplete },
  identity_review: { label: 'Identity review', get: (p, R) => FIELD.get('identity_review').get(R) },
  sources: { label: 'Sources', get: (p) => Object.entries(p.facts.sources || {}).map(([k, n]) => `${k} ${n}`).join(', ') || null },
  contact_created: { label: 'Contact created', date: true, get: (p) => dayOf(p.facts.profile_created) },
  purchase_band: { label: 'Purchase health (v2)', option: true, order: PURCHASE_BANDS, get: (p, R) => FIELD.get('purchase_band').get(R) },
  last_paid_purchase: { label: 'Last paid purchase (confirmed)', date: true, get: (p, R) => fieldOrNull('last_paid_purchase', R) },
  email_health: { label: 'Email health (v2)', option: true, order: EMAIL_STATES, get: (p, R) => FIELD.get('email_health').get(R) },
  latest_response: { label: 'Latest known response', date: true, get: (p, R) => fieldOrNull('latest_response', R) },
  consent_state: { label: 'Can email (v1)', option: true, order: CONSENT_PRECEDENCE, get: (p, R) => FIELD.get('consent_state').get(R) },
  booked_ahead: { label: 'Booked ahead', get: (p, R) => FIELD.get('booked_ahead').get(R) },
  relationship_hold: { label: 'Hold', get: (p) => !!p.facts.relationship_hold }
};
function fieldOrNull(key, R) {
  const x = FIELD.get(key).get(R);
  return typeof x === 'symbol' ? null : x;
}

export const PRESETS = {
  overview: { label: 'Marketing overview', columns: ['name', 'open_band', 'opened_last10', 'last_clicked', 'miles', 'has_done', 'last_booking', 'spend_net'] },
  contact: { label: 'Contact & consent', columns: ['name', 'email', 'eligible', 'spend_net', 'orders', 'last_purchase', 'next_event', 'miles', 'open_band'] },
  value: { label: 'Customer value', columns: ['name', 'spend_net', 'spend_probable', 'spend_r12', 'orders', 'places', 'aov', 'refunds', 'first_purchase', 'last_paid_purchase', 'last_purchase'] },
  history: { label: 'Purchase history', columns: ['name', 'spend_net', 'last_product', 'last_category', 'bookings', 'places', 'first_purchase', 'last_purchase', 'next_event'] },
  email: { label: 'Email activity', columns: ['name', 'email', 'spend_net', 'delivered', 'opened', 'clicked', 'last_emailed', 'last_open', 'last_click'] },
  quality: { label: 'Data quality', columns: ['name', 'record_type', 'kind', 'spend_net', 'history_incomplete', 'identity_review', 'attached_records', 'sources', 'postcode', 'contact_created'] },
  cleanup: { label: 'Clean-up', columns: ['name', 'email', 'record_type', 'kind', 'subscribed', 'suppressed', 'spend_net', 'orders', 'next_event', 'academy', 'last_open', 'last_click'] },
  health: { label: 'Client health', columns: ['name', 'last_paid_purchase', 'latest_response', 'last_open', 'last_click', 'spend_net', 'next_event', 'relationship_hold'] }
};
/** Shown on every row in every preset (beside the name), from the shared health tags: never a hidden column. */
export const BADGE_COLUMNS = ['purchase_band', 'email_health', 'consent_state'];

const PAGE_SIZE = 50;
const sortVal = (v) => (v == null ? null : (typeof v === 'boolean' ? Number(v) : v));

function sorter(key, dir, cells) {
  const sign = dir === 'asc' ? 1 : -1;
  const ord = COLUMNS[key]?.order;
  const val = (id) => (ord ? ord.indexOf(cells.get(id)[key]) : sortVal(cells.get(id)[key]));
  return (a, b) => {
    const x = val(a.person_id);
    const y = val(b.person_id);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    if (x != null && x !== y) return (x < y ? -1 : 1) * sign;
    return a.person_id < b.person_id ? -1 : 1;
  };
}

const isOrg = (f) => f?.record_type === 'organisation';
/** Totals for people only (as the health panel): organisations and owner / test addresses (Alan) are counted apart. */
function headerTotals(all) {
  const matched = all.filter((m) => !isOwner(m.p.facts) && !isOrg(m.p.facts) && m.p.facts?.record_type !== 'system');
  const owners = all.filter((m) => isOwner(m.p.facts)).length;
  const organisations = all.filter((m) => isOrg(m.p.facts) && !isOwner(m.p.facts)).length;
  const eligibleEmails = new Set(matched.filter((m) => m.R && FIELD.get('eligible').get(m.R)).map((m) => m.p.facts.email));
  const sum = (fn) => Math.round(matched.reduce((a, m) => a + (fn(m.p.facts) || 0), 0));
  return { people: matched.length, organisations, owner_addresses: owners, records: all.length, eligible_addresses: eligibleEmails.size, spend_net: sum((f) => vc(f).net), spend_probable: sum((f) => vp(f).net), orders: sum((f) => orderValue(vc(f)).sales), bookings: sum((f) => f.booking_count), places: sum((f) => vc(f).places) };
}

/** Which records are rows: listed people (system labels only when the query asks for record type), matching the search. */
function rowFilter(query, search) {
  const wantsSystem = JSON.stringify(query.root).includes('"field":"record_type"');
  const q = String(search || '').trim().toLowerCase();
  const found = (p) => !q || String(p.facts?.name || p.display_name || '').toLowerCase().includes(q) || String(p.facts?.email || '').includes(q) || p.person_id === q;
  const systemRow = (f) => wantsSystem && f?.record_type === 'system' && !f.attached_to && !f.stale;
  return (p) => (isListed(p.facts) || systemRow(p.facts)) && found(p);
}

/** Run a query over everyone → one page of rows + totals for all matches; `show: 'unknown'` lists the undecided ones. */
export function runQuery(people, rawQuery, ctx, opts = {}) {
  const query = validateQuery(rawQuery);
  const cols = (opts.columns || PRESETS.overview.columns).filter((c) => COLUMNS[c]);
  const want = opts.show === 'unknown' ? 'unknown' : 'yes';
  const results = { yes: 0, no: 0, unknown: 0 };
  const matched = [];
  const include = rowFilter(query, opts.q);
  for (const p of people) {
    if (!include(p)) continue;
    const R = { ...rowCtx(p, ctx), windows: ctx.windows };
    const r = evalNode(query.root, R).r;
    results[r] += 1;
    if (r === want) matched.push({ p, R });
  }
  const sortKey = COLUMNS[opts.sort] ? opts.sort : 'spend_net';
  const cells = new Map(matched.map(({ p, R }) => [p.person_id, Object.fromEntries([...new Set([...cols, sortKey])].map((c) => [c, COLUMNS[c].get(p, R)]))]));
  const rowR = new Map(matched.map(({ p, R }) => [p.person_id, R]));
  const ordered = matched.map((m) => m.p).sort(sorter(sortKey, opts.dir, cells));
  const page = Math.max(0, Number(opts.page) || 0);
  const subs = (p) => Object.fromEntries(cols.filter((c) => COLUMNS[c].sub).map((c) => [c, COLUMNS[c].sub(p)]));
  const rows = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p) => ({ person_id: p.person_id, cells: cells.get(p.person_id), subs: subs(p), next_title: COLUMNS.next_event.title(p), badges: badgesOf(p.facts, rowR.get(p.person_id)) }));
  return { query, english: describe(query.root), results, header: headerTotals(matched), total: matched.length, page, page_size: PAGE_SIZE, sort: sortKey, dir: opts.dir === 'asc' ? 'asc' : 'desc', columns: cols, badge_columns: BADGE_COLUMNS, health: badgeWatermark({ asOf: ctx.asOf, today: ctx.today }), rows, members: ordered, summary: opts.summary ? baseSummary(people, ctx) : undefined };
}

/**
 * Summary tiles above the quick filters: everyone listed (not the current filter), people only — organisations and
 * owner / test addresses are counted apart, as in the health panel. Bands count subscribed people only.
 */
export function baseSummary(people, ctx) {
  const out = { people: 0, organisations: 0, owner_addresses: 0, subscribed: 0, warm: 0, cooling: 0, cold: 0, within_30: 0 };
  for (const p of people) {
    if (!isListed(p.facts)) continue;
    if (isOwner(p.facts)) { out.owner_addresses += 1; continue; }
    if (isOrg(p.facts)) { out.organisations += 1; continue; }
    out.people += 1;
    const m = milesBetween(ctx.centre, p.facts);
    if (m != null && m <= 30) out.within_30 += 1;
    if (!p.facts.subscribed || p.facts.suppressed || p.facts.profile_state !== 'active') continue;
    out.subscribed += 1;
    const b = engagementView(p.facts.engagement, ctx.engagementComplete, ctx.windows, ctx.today).open;
    if (b === 'warm') out.warm += 1;
    else if (b === 'cooling' || b === 'cooling_partial') out.cooling += 1;
    else if (b === 'cold') out.cold += 1;
  }
  return out;
}

/** Why one person is in / out: every condition with its result and the evidence it used. */
export function explain(p, rawQuery, ctx) {
  const query = validateQuery(rawQuery);
  const out = [];
  const walk = (res, depth) => {
    const n = res.node;
    out.push({ depth, text: n.type === 'group' ? `${{ all: 'ALL', any: 'ANY', none: 'NONE' }[n.match]} of:` : condText(n), result: res.r, evidence: evidenceText(res) });
    (res.kids || []).forEach((k) => walk(k, depth + 1));
  };
  const top = evalNode(query.root, { ...rowCtx(p, ctx), windows: ctx.windows });
  walk(top, 0);
  return { result: top.r, english: describe(query.root), lines: out };
}

function evidenceText(res) {
  if (res.hits != null) return res.hits ? `${res.hits} matching record(s)` : null;
  const x = res.x;
  if (x && x.evidence) return `confirmed ${x.c}${x.cp !== x.c ? `, with probable ${x.cp}` : ''}${x.incomplete ? ', history has gaps' : ''}`;
  if (x == null) return res.r === 'unknown' ? 'not known' : null;
  return Array.isArray(x) ? x.join(', ') : String(x);
}
