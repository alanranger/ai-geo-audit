/**
 * Client list health (8 Nov 2026; GPT client-list-health A–E + approved v2 mock-up). Three independent, versioned tags
 * per person, read by the SAME query evaluator (fields.mjs getters), so Customers filters, saved groups and snapshots
 * use exactly the rule the panel counts:
 *   purchase_band v2  latest dated PAID purchase (Squarespace + Booking Sheet + plan payments, confirmed records only,
 *                     not cancelled / duplicate / refunded / zero) in calendar months to the Europe/London as-of day,
 *                     boundaries inclusive: 0–6 / >6–12 / >12–24 / >24 / no evidenced purchase / unknown.
 *   email_health v1   combined rule on the latest KNOWN recorded open / click time (first open / click per campaign),
 *                     counted in whole Europe/London calendar days: hot / warm (click / open-only) / cooling / cold /
 *                     no recorded response / too few / unknown. The open / click bands in engagement.mjs are unchanged
 *                     (they count elapsed time from the event, so a person at a boundary can differ by one day).
 *   consent_state v1  exclusive display precedence blocked > can email > not subscribed > email, no Squarespace contact
 *                     > no email; overlapping reasons kept. Consent is never inferred from a purchase, booking, plan or
 *                     membership.
 * Overlay markers (booked ahead, active plan / member, relationship hold) change the suggested action and protect from
 * clean-up; they never change a tag.
 */
import { isListed } from './record-type.mjs';

/** purchase_band v2 (8 Nov 2026): confirmed paid purchases that are all undated → Unknown (v1 read them as none). */
export const VERSIONS = { purchase_band: 2, email_health: 1, consent_state: 1 };
export const EMAIL_RULE = { hot_days: 30, warm_days: 90, cooling_days: 180, min_delivered: 3 };
export const PURCHASE_BANDS = ['p0_6', 'p6_12', 'p12_24', 'p24_plus', 'p_none', 'p_unknown'];
export const EMAIL_STATES = ['hot', 'warm_click', 'warm_open', 'cooling', 'cold', 'no_response', 'too_few', 'e_unknown'];
/** Matrix column order (mock-up v2); the display precedence is CONSENT_PRECEDENCE. */
export const CONSENT_STATES = ['can_email', 'not_subscribed', 'blocked', 'email_no_contact', 'no_email'];
export const CONSENT_PRECEDENCE = ['blocked', 'can_email', 'not_subscribed', 'email_no_contact', 'no_email'];
const RECENT = ['p0_6', 'p6_12'];
const NOT_ELIGIBLE = ['not_subscribed', 'blocked', 'no_email', 'email_no_contact'];
const ENGAGED = ['hot', 'warm_click', 'warm_open'];

export const LABELS = {
  p0_6: '0–6 months', p6_12: '>6–12 months', p12_24: '>12–24 months', p24_plus: '>24 months (lapsed)', p_none: 'No evidenced purchase (covered history)', p_unknown: 'Unknown / insufficient history',
  hot: 'Hot (click ≤30 days)', warm_click: 'Warm, click-supported', warm_open: 'Warm, open-only', cooling: 'Cooling (91–180 days)', cold: 'Cold (>180 days)', no_response: 'No recorded response', too_few: 'Too few emails', e_unknown: 'Email health unknown',
  can_email: 'Can email', not_subscribed: 'Not subscribed', blocked: 'Blocked (suppression list)', email_no_contact: 'Email, no Squarespace contact', no_email: 'No email held'
};

/* ---------- dates ---------- */

export const londonDay = (iso) => (iso ? (String(iso).length <= 10 ? String(iso) : new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })) : null);
const pad = (x) => String(x).padStart(2, '0');

/** The same day n calendar months earlier, clamped to the month's last day (31 Aug − 6 months = 28/29 Feb). */
export function monthsBefore(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = y * 12 + (m - 1) - n;
  const yy = Math.floor(t / 12);
  const mm = t - yy * 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, last))}`;
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
export const thresholds = (asOf) => ({ m6: monthsBefore(asOf, 6), m12: monthsBefore(asOf, 12), m24: monthsBefore(asOf, 24) });

/* ---------- tag 1: last evidenced purchase ---------- */

const isPaid = (x) => !x.cancelled && !x.duplicate_of && !x.refund_line && Number(x.net) > 0;
const newest = (xs) => xs.reduce((a, x) => (!a || londonDay(x.date) > londonDay(a.date) ? x : a), null);
const probableBooking = (f) => !!f.last_booking_probable || Object.values(f.cats || {}).some((k) => (k?.p || 0) > 0);

function bandOf(day, t) {
  if (day >= t.m6) return 'p0_6';
  if (day >= t.m12) return 'p6_12';
  return day >= t.m24 ? 'p12_24' : 'p24_plus';
}

/**
 * Latest dated confirmed paid purchase → band; probable (name-only) purchases are shown but never set the band.
 * Confirmed paid purchases that all lack a date (e.g. plan payments with no payment date) are evidence of buying with
 * no recency: Unknown, never "no evidenced purchase".
 */
export function purchaseTag(f = {}, asOf) {
  const paid = (f.purchases || []).filter(isPaid);
  const conf = paid.filter((x) => x.level === 'c');
  const last = newest(conf.filter((x) => x.date));
  const prob = newest(paid.filter((x) => x.level === 'p' && x.date));
  const undated = conf.filter((x) => !x.date).length;
  const t = thresholds(asOf);
  const base = { version: VERSIONS.purchase_band, thresholds: t, incomplete: !!f.history_incomplete, undated_confirmed: undated, probable_last: prob ? londonDay(prob.date) : null, probable_title: prob?.title || null };
  if (last) return { ...base, band: bandOf(londonDay(last.date), t), last: londonDay(last.date), last_src: last.src, last_title: last.title || null };
  const reason = unknownPurchaseReason(undated, paid.some((x) => x.level === 'p'), f);
  return { ...base, band: reason ? 'p_unknown' : 'p_none', last: null, reason: reason || 'no_paid_purchase_in_covered_history' };
}
function unknownPurchaseReason(undated, probable, f) {
  if (undated) return 'confirmed_purchases_without_dates';
  if (probable) return 'probable_only';
  if (f.history_incomplete) return 'history_incomplete';
  return probableBooking(f) ? 'probable_booking_only' : null;
}

/* ---------- tag 2: email health ---------- */

const later = (a, b) => (!a || (b && b > a) ? b : a);

/** Latest known recorded response (first open / click per campaign, real event time). */
function responseOf(e) {
  const click = londonDay(e.last_click_at);
  const open = londonDay(e.last_open_at);
  return { click, open, latest: later(click, open), kind: click && click === later(click, open) ? 'click' : (open ? 'open' : null) };
}

function positiveState(r, asOf, rule) {
  const dc = r.click ? daysBetween(r.click, asOf) : null;
  const dOpen = r.open ? daysBetween(r.open, asOf) : null;
  if (dc != null && dc <= rule.hot_days) return 'hot';
  if (dc != null && dc <= rule.warm_days) return 'warm_click';
  return dOpen != null && dOpen <= rule.warm_days ? 'warm_open' : null;
}

function silentState(f, e, ctx, rule) {
  if ((e.opened_campaigns || 0) + (e.clicked_campaigns || 0) > 0) return ['e_unknown', 'response_without_event_time'];
  const n = e.delivered_campaigns || 0;
  if (n >= rule.min_delivered) return ctx.complete ? ['no_response', null] : ['e_unknown', 'coverage_incomplete'];
  if (n > 0) return ['too_few', null];
  const after = ctx.lastCampaign && f.profile_created && londonDay(f.profile_created) > ctx.lastCampaign;
  return ['e_unknown', after ? 'subscribed_after_last_collected_campaign' : 'not_emailed_yet'];
}

/** ctx = { asOf, complete (every campaign's events collected), lastCampaign (YYYY-MM-DD) }. */
export function emailTag(f = {}, ctx = {}, rule = EMAIL_RULE) {
  const base = { version: VERSIONS.email_health, min_delivered: rule.min_delivered, delivered: f.engagement?.delivered_campaigns || 0 };
  if (!f.email) return { ...base, state: 'e_unknown', reason: 'no_email', latest: null };
  const e = f.engagement || {};
  const r = responseOf(e);
  const out = { ...base, latest: r.latest, latest_kind: r.kind, last_click: r.click, last_open: r.open, label: 'latest known recorded response' };
  const pos = positiveState(r, ctx.asOf, rule);
  if (pos) return { ...out, state: pos, days: daysBetween(r.latest, ctx.asOf) };
  if (r.latest) return { ...out, ...staleState(r.latest, ctx, rule) };
  const [state, reason] = silentState(f, e, ctx, rule);
  return { ...out, state, reason };
}
function staleState(latest, ctx, rule) {
  const days = daysBetween(latest, ctx.asOf);
  if (days <= rule.cooling_days) return { state: 'cooling', days, partial: !ctx.complete };
  return ctx.complete ? { state: 'cold', days } : { state: 'e_unknown', days, reason: 'coverage_incomplete' };
}

/* ---------- tag 3: can we email them ---------- */

/** Every reason that applies (overlapping), then the one shown by precedence. */
const CONSENT_REASONS = [
  [(f) => f.email && f.suppressed, (f) => `blocked:${f.suppressed}`],
  [(f) => !f.email, () => 'no_email'],
  [(f) => f.email && f.profile_state === 'none', () => 'no_squarespace_contact'],
  [(f) => f.email && f.profile_state === 'deleted', () => 'squarespace_contact_deleted'],
  [(f) => f.profile_state === 'active' && !f.subscribed, () => 'not_subscribed'],
  [(f, can) => can, () => 'subscribed']
];
export function consentTag(f = {}) {
  const can = !!(f.email && f.subscribed && f.profile_state === 'active' && !f.suppressed && !f.stale);
  const reasons = CONSENT_REASONS.filter(([has]) => has(f, can)).map(([, text]) => text(f));
  return { version: VERSIONS.consent_state, state: consentState(f, can), reasons };
}
function consentState(f, can) {
  if (f.email && f.suppressed) return 'blocked';
  if (can) return 'can_email';
  if (f.email && f.profile_state === 'active') return 'not_subscribed';
  return f.email ? 'email_no_contact' : 'no_email';
}

/* ---------- overlay markers ---------- */

export function nextBooking(f = {}, asOf) {
  return (f.future || []).filter((b) => b.level === 'c' && b.date && londonDay(b.date) >= asOf).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}
const activePlan = (f, asOf) => (f.plans || []).some((p) => p.starts && p.starts <= asOf && (!p.ends || p.ends >= asOf));
const isMember = (f) => ['paid_active', 'trial_active'].includes(f.academy_detail?.status) || f.academy === 'member';

export function overlays(f = {}, asOf) {
  const b = nextBooking(f, asOf);
  return { booked_ahead: b ? { date: londonDay(b.date), title: b.title || null } : null, active_plan: activePlan(f, asOf), member: isMember(f), relationship_hold: f.relationship_hold || null };
}

/* ---------- query getters (fields.mjs): R = evaluator row context ---------- */

const asOfOf = (R) => R.asOf || R.today;
const emailCtx = (R) => ({ asOf: asOfOf(R), complete: !!R.engagementComplete, lastCampaign: R.campaigns?.list?.[0]?.sent_on || null });
export function purchaseBandOf(R) { return purchaseTag(R.f, asOfOf(R)).band; }
export function lastPaidOf(R) { return purchaseTag(R.f, asOfOf(R)).last; }
export function emailHealthOf(R) { return emailTag(R.f, emailCtx(R)).state; }
export function latestResponseOf(R) { return R.f.email ? emailTag(R.f, emailCtx(R)).latest : null; }
export function consentStateOf(R) { return consentTag(R.f).state; }
export function bookedAheadOf(R) { return !!nextBooking(R.f, asOfOf(R)); }
export function planOrMemberOf(R) { const o = overlays(R.f, asOfOf(R)); return o.active_plan || o.member; }
export function holdOf(R) { return !!R.f.relationship_hold; }

/** Owner / test address: Alan's business @alanranger.com records (admin) or an address flagged as his own. */
export const isOwner = (f) => !!(f?.admin || f?.owner);
export function ownerOf(R) { return isOwner(R.f); }

/* ---------- month-window email conditions (three-valued: 'yes' / 'no' / 'unknown') ---------- */

/** Stored campaigns delivered to this person on or after `cutoff` (the latest 40 fully collected campaigns). */
function deliveredSince(f, R, cutoff) {
  const ids = f.camps?.d;
  if (!Array.isArray(ids) || !R.campaigns?.byId) return 0;
  return ids.filter((id) => String(R.campaigns.byId.get(id)?.sent_on || '') >= cutoff).length;
}
const validMonths = (n) => Number.isInteger(Number(n)) && Number(n) >= 1 && Number(n) <= 120;

/**
 * "No recorded open OR click in the last N calendar months": no open AND no click on or after the cutoff day, with at
 * least min_delivered stored campaigns delivered in the window. Not emailed enough / no data / incomplete = unknown.
 */
export function noResponseWithin(f, R, months) {
  const ctx = emailCtx(R);
  if (!validMonths(months) || !f.email) return 'unknown';
  const cutoff = monthsBefore(ctx.asOf, Number(months));
  const e = f.engagement || {};
  const r = responseOf(e);
  if (r.latest && r.latest >= cutoff) return 'no';
  if (!ctx.complete || (!r.latest && (e.opened_campaigns || 0) + (e.clicked_campaigns || 0) > 0)) return 'unknown';
  return deliveredSince(f, R, cutoff) >= EMAIL_RULE.min_delivered ? 'yes' : 'unknown';
}

/** "Opened within the last N calendar months" (a recorded first open on or after the cutoff day). */
export function openedWithin(f, R, months) {
  const ctx = emailCtx(R);
  if (!validMonths(months) || !f.email) return 'unknown';
  const e = f.engagement || {};
  const open = londonDay(e.last_open_at);
  if (open && open >= monthsBefore(ctx.asOf, Number(months))) return 'yes';
  if (!ctx.complete) return 'unknown';
  if (open) return 'no';
  return (e.opened_campaigns || 0) > 0 ? 'unknown' : 'no';
}

/* ---------- row badges (every table that lists people uses these; the browser only paints them) ---------- */

export const BADGE_LABELS = {
  purchase: { p0_6: 'Recent', p6_12: 'Active', p12_24: 'Cooling', p24_plus: 'Lapsed', p_none: 'No evidenced purchase', p_unknown: 'Unknown' },
  email: { hot: 'Hot', warm_click: 'Warm · click', warm_open: 'Warm · open-only', cooling: 'Cooling', cold: 'Cold', no_response: 'No recorded response', too_few: 'Too few emails', e_unknown: 'Unknown' },
  consent: { can_email: 'Can email', not_subscribed: 'Not subscribed', blocked: 'Blocked', email_no_contact: 'No Squarespace contact', no_email: 'No email held' }
};
const FIRST_EVENT = 'Squarespace records only the first open and first click of each email, so this is the latest KNOWN recorded response, not proof of the last interaction; an open is weaker evidence than a click.';
const ukDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none');
const reasonText = (r) => (r ? ` (${String(r).replace(/_/g, ' ')})` : '');

function purchaseTip(t, asOf) {
  const prob = t.probable_last ? ` Probable (name match) sale ${ukDay(t.probable_last)}: shown, never sets the band.` : '';
  return `PURCHASE health v${t.version} (calendar months to ${ukDay(asOf)}, Europe/London, boundaries inclusive): Recent = 0–6 months · Active = >6–12 · Cooling = >12–24 · Lapsed = >24 · No evidenced purchase (covered history) · Unknown (probable-only, undated or incomplete). Last evidenced paid purchase: ${ukDay(t.last)}${t.last_src ? ` (${t.last_src.replace('_', ' ')})` : ''}${reasonText(t.reason)}.${prob}${t.incomplete ? ' History has gaps.' : ''}`;
}
function emailTip(t) {
  const latest = t.latest ? `${ukDay(t.latest)} (${t.latest_kind}, ${t.days} days ago)` : 'none recorded';
  return `EMAIL health v${t.version} (whole Europe/London calendar days): Hot = click ≤30 days · Warm = click or open ≤90 (click-supported / open-only) · Cooling = 91–180 · Cold = >180 · No recorded response = ${t.min_delivered}+ delivered, no open or click · Too few emails · Unknown. Latest known recorded response: ${latest}; ${t.delivered} campaigns delivered${reasonText(t.reason)}. ${FIRST_EVENT}`;
}
function marksOf(f, o) {
  return [
    o.booked_ahead && { key: 'booked', icon: '📅', tip: `Booked ahead: ${o.booked_ahead.title || 'event'} ${ukDay(o.booked_ahead.date)}` },
    (o.active_plan || o.member) && { key: 'plan', icon: '★', tip: o.active_plan ? 'Active Pick n Mix plan' : 'Academy member / trial running' },
    o.relationship_hold && { key: 'hold', icon: '⏸', tip: `Relationship hold: ${o.relationship_hold.reason}` },
    isOwner(f) && { key: 'owner', icon: '👤', tip: 'Owner / test address (Alan): counted apart, never as a client' }
  ].filter(Boolean);
}

/** The three row badges + overlay marks, from the same tag functions as the panel and the person detail. */
export function badgesOf(f = {}, R = {}) {
  const asOf = asOfOf(R);
  const p = purchaseTag(f, asOf);
  const e = emailTag(f, emailCtx(R));
  const c = consentTag(f);
  return {
    purchase: { key: p.band, label: BADGE_LABELS.purchase[p.band], last: p.last, tip: purchaseTip(p, asOf) },
    email: { key: e.state, label: BADGE_LABELS.email[e.state], last: e.latest, tip: emailTip(e) },
    consent: { key: c.state, label: BADGE_LABELS.consent[c.state], tip: `Can we email them v${c.version}: ${c.reasons.join(', ').replace(/_/g, ' ') || '—'}. Never inferred from a purchase, booking, plan or membership.` },
    marks: marksOf(f, overlays(f, asOf)), owner: isOwner(f)
  };
}
/** One as-of watermark + rule versions for a set of badges. */
export const badgeWatermark = (R) => ({ as_of: asOfOf(R), versions: VERSIONS });

/** Everything the person detail shows (tags with their evidence, overlapping reasons, overlays). */
export function personHealth(f, R) {
  const asOf = asOfOf(R);
  return { as_of: asOf, purchase: purchaseTag(f, asOf), email: emailTag(f, emailCtx(R)), consent: consentTag(f), overlays: overlays(f, asOf), labels: LABELS };
}

/* ---------- exact queries (what Customers runs when a number is clicked) ---------- */

const C = (field, op, value = null) => ({ type: 'cond', field, op, value });
const G = (items) => ({ type: 'group', match: 'all', items });
const PEOPLE = [C('record_type', 'in', ['person']), C('owner', 'is_false')];
export const Q = {
  people: (...items) => G([...PEOPLE, ...items]),
  owners: () => G([C('owner', 'is_true')]),
  band: (bands) => C('purchase_band', 'in', bands),
  consent: (states) => C('consent_state', 'in', states),
  email: (states) => C('email_health', 'in', states),
  booked: () => C('booked_ahead', 'is_true')
};
const num = (n, root, name) => ({ n, root, name });

/* ---------- panel aggregation ---------- */

function emptyCell() { return { people: 0, emails: new Set(), net: 0, booked: 0 }; }

function tallyPerson(m, f, R) {
  const band = purchaseBandOf(R);
  const col = consentStateOf(R);
  const cell = m.cells[band][col];
  cell.people += 1;
  if (f.email) cell.emails.add(f.email);
  cell.net += Number(f.value?.c?.net) || 0;
  if (bookedAheadOf(R)) cell.booked += 1;
  if (col === 'can_email') { const s = emailHealthOf(R); m.email[s] = (m.email[s] || 0) + 1; m.emailByBand[band][s] = (m.emailByBand[band][s] || 0) + 1; }
}

const tile9Rule = (f) => !f?.stale && f?.profile_state === 'active' && !!f.subscribed && !f.suppressed;

function tallyOther(m, p, R) {
  const f = p.facts || {};
  if (isOwner(f) && isListed(f)) { m.owners.push({ kind: f.admin ? 'business' : 'personal', band: purchaseBandOf(R), consent: consentStateOf(R) }); return; }
  if (f.record_type === 'organisation' && isListed(f)) { const s = consentStateOf(R); m.orgs[s] = (m.orgs[s] || 0) + 1; return; }
  if (f.record_type === 'system' && !f.stale && !f.attached_to) m.system += 1;
}

function tile9Split(m, p) {
  const f = p.facts;
  if (!tile9Rule(f)) return;
  const k = isListed(f) ? (f.record_type || 'person') : (f.record_type === 'system' ? 'system' : 'not_listed');
  m.tile9[k] = (m.tile9[k] || 0) + 1;
}

/** One pass over customer_person rows; `rowOf(p)` = the evaluator row context for that person. */
export function tallyHealth(people, rowOf) {
  const m = { cells: {}, email: {}, emailByBand: {}, orgs: {}, system: 0, owners: [], tile9: {} };
  for (const b of PURCHASE_BANDS) { m.cells[b] = Object.fromEntries(CONSENT_STATES.map((c) => [c, emptyCell()])); m.emailByBand[b] = {}; }
  for (const p of people) {
    tile9Split(m, p);
    const f = p.facts || {};
    const R = rowOf(p);
    if (isListed(f) && (f.record_type || 'person') === 'person' && !isOwner(f)) tallyPerson(m, f, R);
    else tallyOther(m, p, R);
  }
  return m;
}

const sumCells = (cells) => cells.reduce((a, c) => ({ people: a.people + c.people, emails: new Set([...a.emails, ...c.emails]), net: a.net + c.net, booked: a.booked + c.booked }), emptyCell());
const rounded = (x) => Math.round(x * 100) / 100;

function cellOut(c, band, col) {
  const root = Q.people(Q.band([band]), Q.consent([col]));
  const name = `${LABELS[band]} × ${LABELS[col]}`;
  const highlight = RECENT.includes(band) && col !== 'can_email';
  const out = { people: num(c.people, root, name), addresses: c.emails.size, highlight };
  if (highlight) Object.assign(out, { net: num(rounded(c.net), root, `${name} (known confirmed net £)`), booked_ahead: num(c.booked, Q.people(Q.band([band]), Q.consent([col]), Q.booked()), `${name}, booked ahead`) });
  return out;
}

function matrixOut(m) {
  const rows = PURCHASE_BANDS.map((band) => {
    const cells = Object.fromEntries(CONSENT_STATES.map((col) => [col, cellOut(m.cells[band][col], band, col)]));
    const t = sumCells(CONSENT_STATES.map((col) => m.cells[band][col]));
    return { band, label: LABELS[band], cells, total: { people: num(t.people, Q.people(Q.band([band])), LABELS[band]), addresses: t.emails.size } };
  });
  const cols = Object.fromEntries(CONSENT_STATES.map((col) => {
    const t = sumCells(PURCHASE_BANDS.map((b) => m.cells[b][col]));
    return [col, { people: num(t.people, Q.people(Q.consent([col])), LABELS[col]), addresses: t.emails.size }];
  }));
  const all = sumCells(PURCHASE_BANDS.flatMap((b) => CONSENT_STATES.map((c) => m.cells[b][c])));
  return { rows, cols, total: { people: num(all.people, Q.people(), 'All listed people'), addresses: all.emails.size }, columns: CONSENT_STATES, labels: LABELS };
}

const cellsOf = (m, bands, cols) => sumCells(bands.flatMap((b) => cols.map((c) => m.cells[b][c])));
const emailIn = (m, bands, states) => bands.reduce((a, b) => a + states.reduce((x, s) => x + (m.emailByBand[b][s] || 0), 0), 0);

function recentCard(m) {
  const all = cellsOf(m, RECENT, NOT_ELIGIBLE);
  const part = (col) => num(cellsOf(m, RECENT, [col]).people, Q.people(Q.band(RECENT), Q.consent([col])), `Recent buyers (12 months): ${LABELS[col]}`);
  return {
    total: num(all.people, Q.people(Q.band(RECENT), Q.consent(NOT_ELIGIBLE)), 'Recent buyers (12 months) not email-eligible'),
    not_subscribed: part('not_subscribed'), blocked: part('blocked'), no_email: part('no_email'), email_no_contact: part('email_no_contact'),
    booked_ahead: num(all.booked, Q.people(Q.band(RECENT), Q.consent(NOT_ELIGIBLE), Q.booked()), 'Recent buyers not email-eligible, booked ahead'),
    net: rounded(all.net), addresses: all.emails.size
  };
}

function lapsedCard(m) {
  const can = [Q.band(['p24_plus']), Q.consent(['can_email'])];
  return {
    total: num(emailIn(m, ['p24_plus'], ENGAGED), Q.people(...can, Q.email(ENGAGED)), 'Lapsed buyers (>24 months), can email, recorded engagement ≤90 days'),
    click_supported: num(emailIn(m, ['p24_plus'], ['hot', 'warm_click']), Q.people(...can, Q.email(['hot', 'warm_click'])), 'Lapsed buyers, click-supported'),
    open_only: num(emailIn(m, ['p24_plus'], ['warm_open']), Q.people(...can, Q.email(['warm_open'])), 'Lapsed buyers, open-only')
  };
}

function prospectCard(m) {
  return {
    total: num(m.cells.p_none.can_email.people, Q.people(Q.band(['p_none']), Q.consent(['can_email'])), 'Subscribers with no evidenced purchase'),
    engaged: num(emailIn(m, ['p_none'], ENGAGED), Q.people(Q.band(['p_none']), Q.consent(['can_email']), Q.email(ENGAGED)), 'Subscribers, no evidenced purchase, engaged ≤90 days'),
    unknown_history: num(m.cells.p_unknown.can_email.people, Q.people(Q.band(['p_unknown']), Q.consent(['can_email'])), 'Subscribers, purchase history unknown')
  };
}

function unknownCard(m) {
  const t = cellsOf(m, ['p_unknown'], CONSENT_STATES);
  return { total: num(t.people, Q.people(Q.band(['p_unknown'])), 'Purchase history unknown'), can_email: num(m.cells.p_unknown.can_email.people, Q.people(Q.band(['p_unknown']), Q.consent(['can_email'])), 'Purchase history unknown, can email') };
}

function emailHealthOut(m) {
  const states = Object.fromEntries(EMAIL_STATES.map((s) => [s, num(m.email[s] || 0, Q.people(Q.consent(['can_email']), Q.email([s])), `Can email: ${LABELS[s]}`)]));
  const sum = EMAIL_STATES.reduce((a, s) => a + (m.email[s] || 0), 0);
  const denom = cellsOf(m, PURCHASE_BANDS, ['can_email']).people;
  return { denominator: num(denom, Q.people(Q.consent(['can_email'])), 'Can email (people)'), states, sum, sums_exactly: sum === denom, rule: EMAIL_RULE };
}

function reconciliation(m) {
  const canPeople = cellsOf(m, PURCHASE_BANDS, ['can_email']).people;
  const owners = m.owners.filter((o) => o.consent === 'can_email').length;
  const orgs = m.orgs.can_email || 0;
  const tile9 = Object.values(m.tile9).reduce((a, x) => a + x, 0);
  return {
    can_email_people: canPeople, owner_addresses: owners, admin_address: owners, organisations: orgs, sum: canPeople + owners + orgs, tile9,
    gap: tile9 - (canPeople + owners + orgs), tile9_by_record: m.tile9,
    note: 'tile 9 = Squarespace profiles that are active, subscribed and not suppressed (overview identity.subscribed_unsuppressed). Owner / test addresses (Alan) are counted apart, never as clients. Any gap is listed by record type.'
  };
}

export function rulesText(cov = {}) {
  return [
    `Last evidenced purchase v${VERSIONS.purchase_band}: latest paid purchase across Squarespace orders${cov.squarespace_from ? ` (from ${cov.squarespace_from})` : ''}, the Booking Sheet${cov.booking_sheet_from ? ` (from ${cov.booking_sheet_from})` : ''} and Pick n Mix plan payments, each sale once; cancelled, duplicate, refunded and zero sales excluded; never an event or import date. Calendar months back from today (Europe/London), boundaries inclusive (exactly 6 months = 0–6). Buyer's own purchases only; attendees don't inherit. Probable (name-match) history is shown on the person but never sets the band: no confirmed purchase + probable or incomplete history = Unknown. Confirmed paid purchases with no date (e.g. plan payments without a payment date) = Unknown, never "no evidenced purchase"; when some are dated, the latest dated one sets the band.`,
    `Email health v${VERSIONS.email_health}: latest known recorded response (Squarespace records the first open and first click of each email). Email windows count whole Europe/London calendar days from the day of the recorded response to today (a response yesterday = 1 day; 180 days = still cooling, 181 = cold); the separate open / click bands count elapsed time and can differ by a day at a boundary. Hot = click ≤${EMAIL_RULE.hot_days} days; Warm = click or open ≤${EMAIL_RULE.warm_days} days (click-supported / open-only); Cooling = ${EMAIL_RULE.warm_days + 1}–${EMAIL_RULE.cooling_days} days; Cold = >${EMAIL_RULE.cooling_days} days (complete coverage only); No recorded response = ${EMAIL_RULE.min_delivered}+ delivered in covered campaigns, no open or click (a review signal, not proof); Too few = fewer delivered, no response; Unknown = no email, coverage incomplete or not emailed yet. An open is weaker evidence than a click. The existing open / click bands are unchanged.`,
    `Can we email them v${VERSIONS.consent_state}: blocked (suppression list) > can email (subscribed, live Squarespace contact, not blocked) > not subscribed (contact opted out / never opted in) > email, no Squarespace contact > no email held. Overlapping reasons are kept on the person.`,
    'Markers on each person: booked ahead · active plan or member · relationship hold. They change the suggested action and protect from clean-up, without changing the tags.',
    'Owner / test addresses (Alan\'s business @alanranger.com addresses and any address flagged as his own) are counted apart from clients in every count, segment and snapshot; their records, orders and consent are unchanged.'
  ];
}
export const NEVER_LINE = 'Never: this panel subscribes nobody, clears no block, sends nothing and deletes nothing. Snapshots always re-check consent. "No email held": ask only when needed for a booking — that is not marketing consent.';

/** The panel: matrix, four cards, email health, reconciliation to tile 9, rules (all numbers carry their query). */
export function clientHealth(people, rowOf, meta = {}) {
  const m = tallyHealth(people, rowOf);
  return {
    versions: VERSIONS, as_of_day: meta.asOf || null, matrix: matrixOut(m),
    cards: { recent_not_eligible: recentCard(m), lapsed_engaged: lapsedCard(m), subscribers_no_purchase: prospectCard(m), purchase_unknown: unknownCard(m) },
    email_health: emailHealthOut(m), reconciliation: reconciliation(m),
    apart: { organisations: { total: Object.values(m.orgs).reduce((a, x) => a + x, 0), by_consent: m.orgs, query: G([C('record_type', 'in', ['organisation'])]) }, system_labels: m.system, owners: { total: m.owners.length, list: m.owners, query: Q.owners() } },
    rules: rulesText(meta.coverage), never: NEVER_LINE, coverage: meta.coverage || null
  };
}

/** Tile 9's figures (Agent B): recent buyers not email-eligible, split, and the can-email count. */
export function healthSummary(h) {
  const c = h.cards.recent_not_eligible;
  return {
    recent_not_eligible: { total: c.total.n, not_subscribed: c.not_subscribed.n, blocked: c.blocked.n, no_email: c.no_email.n, email_no_contact: c.email_no_contact.n, booked_ahead: c.booked_ahead.n },
    can_email: h.reconciliation.tile9, can_email_people: h.reconciliation.can_email_people, owner_addresses: h.reconciliation.owner_addresses, admin_address: h.reconciliation.owner_addresses, organisations: h.reconciliation.organisations, gap: h.reconciliation.gap
  };
}
