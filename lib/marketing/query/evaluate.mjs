/**
 * Query evaluator (pure). Three-valued: 'yes' / 'no' / 'unknown'. Unknown is never read as "no":
 *   - missing data (no postcode, feed unavailable, emails not collected) → unknown
 *   - "has not" / "at most" tests on history with gaps or probable (name-only) records → unknown
 *   - "has" tests are met by confirmed records only; a probable-only match is unknown
 * Record conditions (booking / purchase / upcoming booking / click) bind every part to the SAME record: "clicked a
 * lightroom link in the last 90 days" needs one click that is both a lightroom link and within 90 days.
 * Dates: inclusive "on or after", exclusive "before"; relative windows use calendar days / months to Europe/London dates.
 */
import { FIELD, UNKNOWN, evidence } from './fields.mjs';
import { MAX_PURCHASES } from '../value.mjs';
import { shortId, topicsOf } from './topics.mjs';

const YES = 'yes';
const NO = 'no';
const UNK = 'unknown';

export const londonDay = (iso) => (iso ? (String(iso).length <= 10 ? String(iso) : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })) : null);
export function shiftDate(today, n, unit, sign = -1) {
  const d = new Date(`${today}T12:00:00Z`);
  if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + sign * n); else d.setUTCDate(d.getUTCDate() + sign * n);
  return d.toISOString().slice(0, 10);
}

/* ---------- plain values ---------- */

const cmp = { gte: (x, a) => x >= a, lte: (x, a) => x <= a, eq: (x, a) => x === a };
const LOWER = new Set(['gte']);

function numTest(op, x, val) {
  if (op === 'between') return x >= Number(val?.[0]) && x <= Number(val?.[1]);
  return cmp[op](x, Number(val));
}

/** History numbers: confirmed decides "at least"; "at most / exactly" also needs complete evidence (probable included). */
function evidenceNum(op, e, val) {
  if (op === 'between') return all3([evidenceNum('gte', e, val?.[0]), evidenceNum('lte', e, val?.[1])]);
  if (LOWER.has(op)) return numTest(op, e.c, val) ? YES : (numTest(op, e.cp, val) || e.incomplete ? UNK : NO);
  if (op === 'eq') return all3([evidenceNum('gte', e, val), evidenceNum('lte', e, val)]);
  if (!numTest(op, e.c, val)) return NO;
  return numTest(op, e.cp, val) && !e.incomplete ? YES : UNK;
}

function dateTest(op, day, val, today) {
  if (!day) return false;
  if (op === 'after') return day >= val;
  if (op === 'before') return day < val;
  if (op === 'between') return day >= val?.[0] && day <= val?.[1];
  if (op === 'within_last') return day >= shiftDate(today, Number(val?.n), val?.unit);
  if (op === 'older_than') return day < shiftDate(today, Number(val?.n), val?.unit);
  return false;
}

const asList = (val) => (Array.isArray(val) ? val : String(val ?? '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
function textTest(op, x, val) {
  const s = String(x).toLowerCase();
  if (op === 'is') return s === String(val ?? '').trim().toLowerCase();
  if (op === 'is_not') return s !== String(val ?? '').trim().toLowerCase();
  return asList(val).includes(s);
}
function enumTest(op, x, val) {
  const have = (Array.isArray(x) ? x : [x]).map((s) => String(s).toLowerCase());
  const hit = asList(val).some((w) => have.includes(w));
  return op === 'in' ? hit : !hit;
}

const tri = (b) => (b ? YES : NO);
function valueResult(field, op, x, val, today) {
  if (op === 'known') return tri(x !== UNKNOWN);
  if (op === 'unknown') return tri(x === UNKNOWN);
  if (x === UNKNOWN) return UNK;
  if (field.type === 'bool') return tri(op === 'is_true' ? x === true : x === false);
  if (x && x.evidence) return evidenceNum(op, x, val);
  if (field.type === 'number') return tri(numTest(op, Number(x), val));
  if (field.type === 'date') return tri(dateTest(op, londonDay(x), val, today));
  if (field.type === 'enum') return tri(enumTest(op, x, val));
  return tri(textTest(op, x, val));
}

/* ---------- same-record conditions ---------- */

const has = (text, part) => String(text || '').toLowerCase().includes(String(part).toLowerCase());
/** Every part of a record condition, each tested against the same record (absent parts always pass). */
const RECORD_TESTS = [
  (rec, m) => !m.cats?.length || m.cats.some((c) => (rec.cats || []).includes(c)),
  (rec, m) => !m.title_contains || has(rec.title, m.title_contains),
  (rec, m) => !m.url_contains || has(rec.url, m.url_contains),
  (rec, m, day, today) => m.time !== 'past' || (!!day && day < today),
  (rec, m, day, today) => m.time !== 'future' || (!!day && day >= today),
  (rec, m, day, today) => !m.within || dateTest('within_last', day, m.within, today),
  (rec, m, day, today) => !m.after || dateTest('after', day, m.after, today),
  (rec, m, day, today) => !m.before || dateTest('before', day, m.before, today),
  (rec, m, day) => !m.on || day === m.on,
  (rec, m) => m.min_net == null || Number(rec.net) >= Number(m.min_net),
  (rec, m) => !m.email_id || shortId(rec.email_id) === shortId(m.email_id),
  (rec, m) => !m.email_ids?.length || m.email_ids.map(shortId).includes(shortId(rec.email_id)),
  (rec, m) => !m.topics?.length || m.topics.some((t) => topicsOf(rec.url).includes(t))
];

function recordMatch(rec, m, today) {
  const day = londonDay(rec.date || rec.at);
  return RECORD_TESTS.every((t) => t(rec, m, day, today));
}

/** Could a probable (name-only) record match? Only categories are known for those; anything else can't be ruled out. */
function probableMayMatch(f, m) {
  const anyProbable = Object.values(f.cats || {}).some((k) => k.p > 0) || !!f.last_booking_probable;
  if (!anyProbable) return false;
  if (!m.cats?.length) return true;
  return m.cats.some((c) => (f.cats?.[c]?.p || 0) > 0);
}

const RECORDS = {
  bookings: (R) => ({ list: (R.f.bookings || []).filter((b) => b.role !== 'buyer_for_other').map((b) => ({ ...b, level: 'c' })), truncated: (R.f.booking_count || 0) > (R.f.bookings || []).length, probable: true }),
  future: (R) => ({ list: (R.f.future || []).map((b) => ({ ...b, cats: b.cats || [] })), truncated: (R.f.future || []).length >= 20, probable: true }),
  purchases: (R) => ({ list: (R.f.purchases || []).filter((p) => !p.cancelled), truncated: (R.f.purchases || []).length >= MAX_PURCHASES, probable: true }),
  clicks: (R, m) => clickRecords(R, m),
  deliveries: (R, m) => campaignRecords(R, m, 'd'),
  opens: (R, m) => campaignRecords(R, m, 'o')
};

/** Is every campaign the condition could mean inside the stored window (latest 40 fully collected campaigns)? */
function campaignCovered(R, m, list) {
  const w = R.campaigns;
  if (m.email_id) return w.byId.has(shortId(m.email_id));
  if (m.email_ids?.length) return m.email_ids.every((id) => w.byId.has(shortId(id)));
  const from = m.after || (m.within ? shiftDate(R.today, Number(m.within.n), m.within.unit) : null);
  if (from && w.start && from >= w.start) return true;
  return (R.f.engagement?.delivered_campaigns || 0) <= list.length;
}

/** Campaigns delivered ('d') or opened ('o') to this person, dated by the campaign's send date. */
function campaignRecords(R, m, kind) {
  const ids = R.f.camps?.[kind] || [];
  const list = ids.map((id) => ({ email_id: id, date: R.campaigns.byId.get(id)?.sent_on || null, level: 'c' }));
  const covered = campaignCovered(R, m, ids);
  return { list, truncated: !covered, unseen: !covered, probable: false };
}

/**
 * Link clicks (newest 60 kept per person). For a campaign-specific condition the stored per-campaign "clicked" list is
 * authoritative, so a heavy clicker's older clicks can't hide behind the 60 cap: each clicked campaign missing from the
 * kept clicks is added as a record with no link (it satisfies only the campaign / date parts).
 */
function clickRecords(R, m) {
  const kept = (R.f.clicks || []).map((c) => ({ ...c, level: 'c' }));
  const byCampaign = !!(m.email_id || m.email_ids?.length) && Array.isArray(R.f.camps?.k) && !!R.campaigns;
  if (!byCampaign) return { list: kept, truncated: kept.length >= 60, probable: false };
  const seen = new Set(kept.map((c) => shortId(c.email_id)));
  const extra = R.f.camps.k.filter((id) => !seen.has(id)).map((id) => ({ email_id: id, url: '', at: R.campaigns.byId.get(id)?.sent_on || null, level: 'c' }));
  const covered = campaignCovered(R, { email_id: m.email_id, email_ids: m.email_ids }, R.f.camps.d || []);
  const linkHidden = extra.length > 0 && !!(m.topics?.length || m.url_contains);
  return { list: [...kept, ...extra], truncated: !covered || linkHidden, unseen: !covered, probable: false };
}

/** Campaign records need collected email events, a rebuilt exposure list and the campaign window. */
function campaignUnknown(field, R) {
  if (!['deliveries', 'opens'].includes(field.records)) return false;
  return !R.f.email || !R.engagementComplete || !R.campaigns || !R.exposureBuilt || R.f.camps === undefined;
}

function clickCoverage(R) {
  if (!R.f.email || !R.engagementComplete) return UNK;
  return (R.f.engagement?.delivered_campaigns || 0) > 0 ? null : 'not_exposed';
}

function probableHits(field, src, hits, confirmed, R, m) {
  const extra = field.records === 'bookings' && probableMayMatch(R.f, m) ? 1 : 0;
  return hits.length - confirmed + extra;
}

/** "Has no …" is only a firm yes when nothing could be hiding: no probable match, no cut-off list, no gaps, emails seen. */
function noneIsDoubtful(field, src, probable, R) {
  if (probable || src.truncated) return true;
  if (src.probable && R.f.history_incomplete) return true;
  return field.records === 'clicks' && clickCoverage(R) === 'not_exposed';
}

const sumNet = (xs) => Math.round(xs.reduce((a, x) => a + (Number(x.net) || 0), 0) * 100) / 100;

/** "At least / at most N times" and "total £ at least / at most" over the matching records (same window, same parts). */
function aggregateResult(op, hits, probable, doubtful, m) {
  const isSum = op.startsWith('sum_');
  const conf = hits.filter((h) => h.level !== 'p');
  const c = isSum ? sumNet(conf) : conf.length;
  const cp = isSum ? sumNet(hits) : conf.length + probable;
  return evidenceNum(op.endsWith('gte') ? 'gte' : 'lte', evidence(c, cp, doubtful), isSum ? m.amount : m.count);
}

const AGG_OPS = new Set(['count_gte', 'count_lte', 'sum_gte', 'sum_lte']);

function recordsResult(field, op, val, R) {
  if (field.records === 'clicks' && clickCoverage(R) === UNK) return { r: UNK, hits: 0 };
  if (campaignUnknown(field, R)) return { r: UNK, hits: 0 };
  const m = val || {};
  const src = RECORDS[field.records](R, m);
  const hits = src.list.filter((rec) => recordMatch(rec, m, R.today));
  const confirmed = hits.filter((h) => h.level !== 'p').length;
  const probable = probableHits(field, src, hits, confirmed, R, m);
  if (AGG_OPS.has(op)) return { r: aggregateResult(op, hits, probable, noneIsDoubtful(field, src, probable, R), m), hits: confirmed };
  if (op === 'exists') return { r: confirmed ? YES : (probable || src.unseen ? UNK : NO), hits: confirmed };
  if (confirmed) return { r: NO, hits: confirmed };
  return { r: noneIsDoubtful(field, src, probable, R) ? UNK : YES, hits: 0 };
}

/* ---------- tree ---------- */

function all3(rs) { return rs.includes(NO) ? NO : (rs.includes(UNK) ? UNK : YES); }
function any3(rs) { return rs.includes(YES) ? YES : (rs.includes(UNK) ? UNK : NO); }
function none3(rs) { const a = any3(rs); return a === YES ? NO : (a === NO ? YES : UNK); }
const COMBINE = { all: all3, any: any3, none: none3 };

export function evalCond(node, R) {
  const field = FIELD.get(node.field);
  if (!field) return { r: UNK, node };
  if (field.test) return { r: field.test(R, node.op, node.value), node };
  if (field.type === 'records' && !field.get) return { ...recordsResult(field, node.op, node.value, R), node };
  const x = field.get(R);
  return { r: valueResult(field, node.op, x, node.value, R.today), node, x: x === UNKNOWN ? null : x };
}

export function evalNode(node, R) {
  if (node.type !== 'group') return evalCond(node, R);
  const kids = (node.items || []).map((n) => evalNode(n, R));
  return { r: kids.length ? COMBINE[node.match || 'all'](kids.map((k) => k.r)) : YES, node, kids };
}

/** Row context for one person (anchor + facts) and the query context. */
export const rowCtx = (p, ctx) => ({
  f: p.facts || {}, anchor: p.anchor_key || '', centre: ctx.centre, today: ctx.today, asOf: ctx.asOf || ctx.today, engagementComplete: ctx.engagementComplete, academyFeed: ctx.academyFeed !== false,
  windows: ctx.windows, campaigns: ctx.campaigns || null, exposureBuilt: ctx.exposureBuilt !== false, academyDates: !!ctx.academyDates
});
