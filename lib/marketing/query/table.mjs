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

const vc = (f) => f.value?.c || {};
const vp = (f) => f.value?.p || {};
const next = (f) => (f.future || []).filter((b) => b.level === 'c').sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
const kindOf = (p) => (p.facts?.admin ? 'admin' : p.anchor_key.split(':')[0]);
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);

export const COLUMNS = {
  name: { label: 'Name', get: (p) => p.facts.name || p.display_name || null },
  email: { label: 'Email', get: (p) => p.facts.email || null },
  kind: { label: 'Record', get: kindOf },
  record_type: { label: 'Type', get: (p) => p.facts.record_type || 'person' },
  attached_records: { label: 'Name records under it', get: (p) => p.facts.attached_records || null },
  eligible: { label: 'Can email', get: (p, R) => FIELD.get('eligible').get(R) },
  subscribed: { label: 'Subscribed', get: (p) => (p.facts.profile_state === 'none' ? null : !!p.facts.subscribed) },
  suppressed: { label: 'Suppressed', get: (p) => p.facts.suppressed || null },
  spend_net: { label: 'Known net £', money: true, get: (p) => vc(p.facts).net ?? 0 },
  spend_probable: { label: '+ probable £', money: true, get: (p) => vp(p.facts).net || null },
  spend_r12: { label: '12-month £', money: true, get: (p) => vc(p.facts).r12_net ?? 0 },
  orders: { label: 'Orders', get: (p) => vc(p.facts).orders ?? 0 },
  places: { label: 'Places', get: (p) => vc(p.facts).places ?? 0 },
  bookings: { label: 'Bookings', get: (p) => p.facts.booking_count ?? 0 },
  aov: { label: 'Avg order £', money: true, get: (p) => vc(p.facts).aov ?? null },
  refunds: { label: 'Refunded £', money: true, get: (p) => vc(p.facts).refunds || null },
  first_purchase: { label: 'First purchase', date: true, get: (p) => p.facts.value?.cp?.first || null },
  last_purchase: { label: 'Last purchase', date: true, get: (p) => p.facts.value?.cp?.last || null },
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
  open_band: { label: 'Opens', get: (p, R) => engagementView(p.facts.engagement, R.engagementComplete, R.windows, R.today).open },
  history_incomplete: { label: 'History gaps', get: (p) => !!p.facts.history_incomplete },
  identity_review: { label: 'Identity review', get: (p, R) => FIELD.get('identity_review').get(R) },
  sources: { label: 'Sources', get: (p) => Object.entries(p.facts.sources || {}).map(([k, n]) => `${k} ${n}`).join(', ') || null },
  contact_created: { label: 'Contact created', date: true, get: (p) => dayOf(p.facts.profile_created) }
};

export const PRESETS = {
  overview: { label: 'Marketing overview', columns: ['name', 'email', 'eligible', 'spend_net', 'orders', 'last_purchase', 'next_event', 'miles', 'open_band'] },
  value: { label: 'Customer value', columns: ['name', 'spend_net', 'spend_probable', 'spend_r12', 'orders', 'places', 'aov', 'refunds', 'first_purchase', 'last_purchase'] },
  history: { label: 'Purchase history', columns: ['name', 'spend_net', 'last_product', 'last_category', 'bookings', 'places', 'first_purchase', 'last_purchase', 'next_event'] },
  email: { label: 'Email activity', columns: ['name', 'email', 'spend_net', 'eligible', 'delivered', 'opened', 'clicked', 'last_emailed', 'last_open', 'last_click'] },
  quality: { label: 'Data quality', columns: ['name', 'record_type', 'kind', 'spend_net', 'history_incomplete', 'identity_review', 'attached_records', 'sources', 'postcode', 'contact_created'] },
  cleanup: { label: 'Clean-up', columns: ['name', 'email', 'record_type', 'kind', 'subscribed', 'suppressed', 'spend_net', 'orders', 'next_event', 'academy', 'last_open', 'last_click'] }
};

const PAGE_SIZE = 50;
const sortVal = (v) => (v == null ? null : (typeof v === 'boolean' ? Number(v) : v));

function sorter(key, dir, cells) {
  const sign = dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const x = sortVal(cells.get(a.person_id)[key]);
    const y = sortVal(cells.get(b.person_id)[key]);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    if (x != null && x !== y) return (x < y ? -1 : 1) * sign;
    return a.person_id < b.person_id ? -1 : 1;
  };
}

function headerTotals(matched) {
  const eligibleEmails = new Set(matched.filter((m) => m.R && FIELD.get('eligible').get(m.R)).map((m) => m.p.facts.email));
  const sum = (fn) => Math.round(matched.reduce((a, m) => a + (fn(m.p.facts) || 0), 0));
  return { people: matched.length, eligible_addresses: eligibleEmails.size, spend_net: sum((f) => vc(f).net), spend_probable: sum((f) => vp(f).net), orders: sum((f) => vc(f).orders), bookings: sum((f) => f.booking_count), places: sum((f) => vc(f).places) };
}

/** Run a query over everyone → one page of rows + totals for all matches; `show: 'unknown'` lists the undecided ones. */
export function runQuery(people, rawQuery, ctx, opts = {}) {
  const query = validateQuery(rawQuery);
  const cols = (opts.columns || PRESETS.overview.columns).filter((c) => COLUMNS[c]);
  const want = opts.show === 'unknown' ? 'unknown' : 'yes';
  const results = { yes: 0, no: 0, unknown: 0 };
  const matched = [];
  const wantsSystem = JSON.stringify(query.root).includes('"field":"record_type"');
  for (const p of people) {
    if (!isListed(p.facts) && !(wantsSystem && p.facts?.record_type === 'system' && !p.facts.attached_to && !p.facts.stale)) continue;
    const R = { ...rowCtx(p, ctx), windows: ctx.windows };
    const r = evalNode(query.root, R).r;
    results[r] += 1;
    if (r === want) matched.push({ p, R });
  }
  const sortKey = COLUMNS[opts.sort] ? opts.sort : 'spend_net';
  const cells = new Map(matched.map(({ p, R }) => [p.person_id, Object.fromEntries([...new Set([...cols, sortKey])].map((c) => [c, COLUMNS[c].get(p, R)]))]));
  const ordered = matched.map((m) => m.p).sort(sorter(sortKey, opts.dir, cells));
  const page = Math.max(0, Number(opts.page) || 0);
  const rows = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p) => ({ person_id: p.person_id, cells: cells.get(p.person_id), next_title: COLUMNS.next_event.title(p) }));
  return { query, english: describe(query.root), results, header: headerTotals(matched), total: matched.length, page, page_size: PAGE_SIZE, sort: sortKey, dir: opts.dir === 'asc' ? 'asc' : 'desc', columns: cols, rows, members: ordered };
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
