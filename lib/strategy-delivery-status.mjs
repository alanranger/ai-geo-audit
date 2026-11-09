/**
 * Strategy next actions and "Next delivery" in the ONE delivery-status vocabulary (lib/marketing/delivery-status.mjs,
 * board: lib/marketing/delivery-status-board.mjs). Read-only. Index keys match Strategy deliveries and Marketing items:
 * emails by campaign key and `send|<campaign key>`, social placements and tasks by step key.
 * A step with several placements shows its least-advanced one; it is closed only when every placement is. Pure; the
 * summary reads the board (lib/strategy-summary.mjs).
 */
import { status, ukDay, ukDayTime } from './marketing/delivery-status.mjs';

export const CLOSED_CODES = new Set(['sent', 'published', 'done', 'cancelled']);
const RANK = ['late', 'failed', 'verification_unavailable', 'checking', 'needs_approval', 'in_preparation', 'scheduled', 'cancelled', 'done', 'sent', 'published'];
const rank = (s) => (RANK.includes(s.code) ? RANK.indexOf(s.code) : RANK.length);
const londonDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;

/** "🕒 Scheduled Tue 10 Nov 10:00am" · "📄 In preparation · Planned Tue 10 Nov 6:30pm": icon + word, then the dated when. */
export function statusLine(s, day) {
  if (!s) return null;
  let when = s.when === s.label ? '' : s.when || '';
  if (day && !MONTH.test(when)) when = /^\w+ \d/.test(when) ? when.replace(/^(\w+) /, `$1 ${ukDay(day)} `) : [ukDay(day), when].filter(Boolean).join(' · ');
  return when.startsWith(s.label) ? `${s.icon} ${when}` : [`${s.icon} ${s.label}`, when].filter(Boolean).join(' · ');
}

const put = (out, key, s) => {
  if (!key || !s) return;
  const prev = out[key];
  if (!prev || rank(s) < rank(prev)) out[key] = s;
};
/** { key → status } from the board; null when the board is unavailable. */
export function statusIndex(board) {
  if (!board || board.error) return null;
  const out = {};
  for (const e of board.emails || []) {
    put(out, e.key, e.status);
    put(out, e.campaign_key, e.status);
    if (e.campaign_key) put(out, `send|${e.campaign_key}`, e.status);
  }
  for (const p of board.placements || []) put(out, p.step_key, p.status);
  for (const t of board.tasks || []) put(out, t.step_key, t.status);
  return out;
}

/** A delivery's status: the board's, else the same vocabulary from the plan record (draft / scheduled / planned). */
export function fallbackStatus(d) {
  if (d.scheduled_for && d.status === 'scheduled') return status('scheduled', { at: d.scheduled_for, when: `Scheduled ${ukDayTime(d.scheduled_for)}`, evidence: 'campaign record (operator-verified schedule)' });
  return status('in_preparation', { when: d.day ? `Planned ${ukDay(d.day)}` : 'No date yet', blocker: d.draft ? 'draft' : 'from the plan' });
}

/** A closed board status (sent / published / done / cancelled) closes the delivery: never a draft or a next action. */
function withStatus(d, s) {
  if (!s) return d;
  if (!CLOSED_CODES.has(s.code)) return { ...d, delivery_status: s };
  return { ...d, delivery_status: s, status: s.code, sent: s.code === 'sent' || s.code === 'published' || !!d.sent, draft: false };
}
export function attachStatus(list, index) {
  return index ? list.map((d) => withStatus(d, index[d.key] || (d.alias && index[d.alias]) || null)) : list;
}

/** For the browser's Next delivery line: status + its line per key (small, no ids beyond keys). */
export function statusOut(board, index) {
  if (!index) return { error: board?.error || 'delivery status unavailable', by_key: {} };
  const by = Object.fromEntries(Object.entries(index).map(([k, s]) => [k, { code: s.code, label: s.label, icon: s.icon, tone: s.tone, when: s.when, at: s.at, line: statusLine(s, s.at ? londonDay(s.at) : null) }]));
  return { as_of: board.as_of, last_checked: board.last_checked || null, by_key: by };
}
