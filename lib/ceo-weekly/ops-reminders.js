/**
 * Dated manual reminders (public.ops_reminders): steps Alan has to do by hand on a date (first one: the Bluebell price
 * rise on 1 Feb 2027). The Monday brief shows an open reminder in the week it falls due and in every brief after while
 * it's open (amber once overdue); Alan marks it done on the dashboard (api/aigeo/ops-reminders.js, admin key).
 * Once overdue, a reminder with a self_check runs it read-only: squarespace_sale_prices reads the product's public
 * store JSON (GET only, same read as lib/strategy-diary.mjs) and never changes a price.
 */
import { addDaysYmd, londonWeekStartYmd } from './shared.js';
import { esc } from './brief-layout.js';

const TABLE = 'ops_reminders';
const COLS = 'id, reminder_key, due_date, title, steps, link, self_check, done, done_at';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UA = 'Mozilla/5.0 (compatible; AlanRanger-AIGEOAudit/1.0)';

/** "Mon 1 Feb 2027" */
export function dueLabel(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** done · upcoming (after the week of weekStart) · due (inside it) · overdue (before it). */
export function reminderState(r, weekStart) {
  if (r.done) return 'done';
  if (r.due_date > addDaysYmd(weekStart, 6)) return 'upcoming';
  return r.due_date >= weekStart ? 'due' : 'overdue';
}

/** The open reminders the brief for weekStart shows: due that week or overdue, earliest first. */
export function briefReminders(rows, weekStart) {
  return (rows || [])
    .map((r) => ({ ...r, state: reminderState(r, weekStart) }))
    .filter((r) => r.state === 'due' || r.state === 'overdue')
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

// ---------------- self-check: Squarespace sale prices (read-only) ----------------

/** The product's public store JSON item ({ id, variants: [{ price, salePrice, onSale }] }, prices in pence). GET only. */
export async function readSquarespaceProduct(productUrl, fetchFn = fetch) {
  const r = await fetchFn(`${productUrl}?format=json`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`squarespace_http_${r.status}`);
  const j = await r.json();
  return j?.item || null;
}

const salePounds = (v) => (v.onSale && v.salePrice != null ? Math.round(Number(v.salePrice)) / 100 : null);

/** Counts variants still at the old sale price, at the new one, and anything else (other price or not on sale). */
export function salePriceCheck(item, cfg) {
  if (!item || String(item.id) !== String(cfg.product_id)) return { state: 'error', error: 'product not found at its link' };
  const oldSet = new Set((cfg.old_sale_gbp || []).map(Number));
  const newSet = new Set((cfg.new_sale_gbp || []).map(Number));
  const sales = (item.variants || []).map(salePounds);
  const stillOld = sales.filter((p) => oldSet.has(p)).length;
  const atNew = sales.filter((p) => newSet.has(p)).length;
  const other = sales.length - stillOld - atNew;
  let state = 'changed';
  if (stillOld) state = 'not_done';
  else if (other || !sales.length) state = 'check';
  return { state, total: sales.length, still_old: stillOld, at_new: atNew, other };
}

const CHECKS = {
  squarespace_sale_prices: async (cfg, deps) => salePriceCheck(await (deps.readProduct || readSquarespaceProduct)(cfg.product_url, deps.fetchFn), cfg),
};

/** Runs an overdue reminder's self-check; null when it has none or isn't overdue yet. Never throws. */
export async function runSelfCheck(r, deps = {}) {
  const run = CHECKS[r.self_check?.kind];
  if (r.state !== 'overdue' || !run) return null;
  try {
    return { ...(await run(r.self_check, deps)), read_at: (deps.now || new Date()).toISOString() };
  } catch (e) {
    return { state: 'error', error: e?.message || String(e) };
  }
}

// ---------------- reads / writes ----------------

/** metrics.ops_reminders for the brief of weekStart. A failed read comes back as { error } (shown red), never as "none". */
export async function loadBriefReminders(sb, weekStartIn, deps = {}) {
  const weekStart = weekStartIn || londonWeekStartYmd();
  try {
    const { data, error } = await sb.from(TABLE).select(COLS).eq('done', false).lte('due_date', addDaysYmd(weekStart, 6)).order('due_date');
    if (error) throw new Error(error.message);
    const items = briefReminders(data, weekStart);
    for (const r of items) r.check = await runSelfCheck(r, deps);
    return { week_start: weekStart, items };
  } catch (e) {
    return { week_start: weekStart, items: [], error: e?.message || String(e) };
  }
}

/** Dashboard list: every open reminder with its state for this week (upcoming ones included). */
export async function listOpenReminders(sb, weekStart) {
  const { data, error } = await sb.from(TABLE).select(COLS).eq('done', false).order('due_date');
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({ ...r, state: reminderState(r, weekStart), due_label: dueLabel(r.due_date) }));
}

/** Marks one reminder done (or reopens it). Returns the row, or null when the id doesn't exist. */
export async function setReminderDone(sb, id, done, now = new Date().toISOString()) {
  const { data, error } = await sb.from(TABLE).update({ done, done_at: done ? now : null, updated_at: now }).eq('id', id).select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

// ---------------- brief card ----------------

const gbpList = (xs) => (xs || []).map((n) => `£${n}`).join(' / ');

function checkSub(r) {
  const c = r.check;
  const cfg = r.self_check || {};
  if (!c) return null;
  if (c.state === 'not_done') return { tone: 'amber', text: `Not done yet: Squarespace still shows ${c.still_old} of ${c.total} variants at ${gbpList(cfg.old_sale_gbp)}` };
  if (c.state === 'changed') return { tone: 'green', text: `Squarespace shows all ${c.total} variants at ${gbpList(cfg.new_sale_gbp)} · mark it done on the dashboard` };
  if (c.state === 'check') return { tone: 'amber', text: `Check on Squarespace: ${c.other} of ${c.total} variants not at ${gbpList(cfg.new_sale_gbp)} or not on sale` };
  return { tone: 'amber', text: `Couldn't read the Squarespace prices (${c.error}) · still open` };
}

function stateSub(r) {
  if (r.state === 'overdue') return checkSub(r) || { tone: 'amber', text: `Overdue since ${dueLabel(r.due_date)} · not marked done` };
  return { tone: 'grey', text: 'Due this week · mark it done on the dashboard when finished' };
}

function reminderValueHtml(r) {
  const title = r.link ? `<a href="${esc(r.link)}" style="color:#1857c4;text-decoration:none">${esc(r.title)}</a>` : esc(r.title);
  const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => `<li style="margin:2px 0">${esc(s)}</li>`).join('');
  return steps ? `${title}<ol style="margin:6px 0 0 18px;padding:0;font-size:12px;font-weight:400;color:#475467">${steps}</ol>` : title;
}

function reminderRow(r) {
  const tag = r.state === 'overdue' ? '<span style="font-size:11px;color:#b45309;font-weight:700">overdue</span>' : '<span style="font-size:11px;color:#98a2b3">due this week</span>';
  return { labelHtml: `<b style="color:#101828">Due ${esc(dueLabel(r.due_date))}</b><br>${tag}`, valueHtml: reminderValueHtml(r), sub: stateSub(r) };
}

const CARD_TITLE = 'REMINDERS · DATED MANUAL STEPS';

/** Card (brief-layout renderCardHtml shape) for metrics.ops_reminders; null when nothing is due. */
export function buildRemindersCard(rem) {
  if (rem?.error) return { title: CARD_TITLE, right: 'reminders list', rows: [{ label: 'Reminders', value: "Couldn't read the reminders list", sub: { tone: 'red', text: rem.error } }] };
  if (!rem?.items?.length) return null;
  return { title: CARD_TITLE, right: 'due this week or overdue · mark done on the dashboard', rows: rem.items.map(reminderRow) };
}
