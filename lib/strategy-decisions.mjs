/**
 * "Decisions for Alan" on Strategy (clean layout, 8 Nov 2026): only decisions Alan must make (targets, offers, prices,
 * approvals), computed from data, never typed in. GPT / Claude / Cursor tasks never appear. Pure; no writes.
 *
 * Rule implemented (the only one the data supports today): the NEXT dated Roadmap milestone for non-JLR beginners
 * cannot be met. Beginners are only taught on a running (promoted) course that starts on or before the milestone; when
 * the places on those courses plus the beginners already taught are fewer than the milestone, the target needs Alan's
 * call. A milestone Alan has already decided (roadmap entry `decided`: who / when / why) is not raised again; the
 * milestone after it is checked once it is the next one.
 */
const MONTH_KEY = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const ukDay = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const ukMonth = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

/** "dec26" → { by: '2026-12-31' }: the milestone's last day. */
export function milestoneDate(key) {
  if (!/^[a-z]{3}\d{2}$/.test(String(key || ''))) return null;
  return new Date(Date.UTC(2000 + Number(key.slice(3)), MONTH_KEY[key.slice(0, 3)] + 1, 0)).toISOString().slice(0, 10);
}

/** The next beginners milestone (its explicit `due`, else the month-end key), whether or not Alan has decided it. */
function nextBeginnersMilestone(roadmap, today) {
  return (roadmap || []).map((r) => ({ ...r, by: String(r.due || '').slice(0, 10) || milestoneDate(r.key) })).filter((r) => r.by && r.by >= today && Number(r.beginners_non_jlr) > 0)
    .sort((a, b) => a.by.localeCompare(b.by))[0] || null;
}
/** The next milestone, unless Alan has already decided it. */
function pendingMilestone(roadmap, today) {
  const ms = nextBeginnersMilestone(roadmap, today);
  return ms && !ms.decided ? ms : null;
}
const pnmCourses = (insights) => [...(insights?.rows?.mix || [])].find((t) => t.key === 'mix-pick-n-mix')?.numbers?.courses || [];

/**
 * Beginners target decision. `courses` = the Pick n Mix tile's course list (lib/strategy-insights/mix.mjs: start, booked,
 * state, cap when known); `cap` = places per course (4, the beginners course size).
 */
const qShort = (q) => (q ? String(q.label || q.key).split(' ·')[0] : null);
/** The quarter holding the milestone and the one after it ("Q1", "Q2") from the quarter plan, when available. */
function quartersFor(quarters, by) {
  const list = [...(quarters || [])].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  const i = list.findIndex((q) => q.start_date <= by && by <= q.end_date);
  return { now: qShort(list[i]), next: i >= 0 ? qShort(list[i + 1]) : null };
}

export function beginnersDecision({ today, roadmap, taught, courses, cap = 4, quarters }) {
  const ms = pendingMilestone(roadmap, today);
  if (!ms) return null;
  const q = quartersFor(quarters, ms.by);
  const running = (courses || []).filter((c) => c.state === 'running');
  const before = running.filter((c) => c.start <= ms.by);
  const reachable = Number(taught || 0) + before.reduce((a, c) => a + Math.max(cap, Number(c.booked) || 0), 0);
  if (reachable >= Number(ms.beginners_non_jlr)) return null;
  const next = running[0] || null;
  const nextTxt = next ? `the next promoted course is ${ukDay(next.start)} (${next.booked} booked)` : 'no promoted beginners course is dated';
  return {
    key: `beginners-${ms.key}`, kind: 'target',
    what: `${q.now ? `${q.now} target` : 'Target'}: ${ms.beginners_non_jlr} non-JLR beginners by ${ukDay(ms.by)}`,
    why: `${Number(taught || 0)} taught so far and ${nextTxt}, so the ${ukMonth(ms.by)} milestone can't be met`,
    options: ['Keep', q.next ? `Move to ${q.next}` : 'Move to the next quarter', 'Change'], due: ms.by,
    numbers: { target: Number(ms.beginners_non_jlr), taught: Number(taught || 0), reachable, next_course: next?.start || null, next_booked: next ? Number(next.booked) : null },
    source: 'Targets panel roadmap milestone · live website course dates and bookings (same list as the Pick n Mix tile)'
  };
}

/**
 * Strategy "Needs Alan": the SAME list as Marketing "Waiting on you" (lib/marketing/decision-state.mjs `open`), so
 * count = Marketing's Waiting count. Computed target decisions (e.g. beginners) are a separate group, never in `count`;
 * `total` = count + targets. A failed read gives count null with the error, never a guessed 0.
 */
const openRow = (o) => ({ type: o.type, key: o.key, what: o.what, why: o.why, due: o.due || null, late: !!o.late, channel: o.channel || null });
export function needsAlan(dec, targets = []) {
  const t = (targets || []).length;
  const base = { targets: t, definition: 'Needs Alan = Marketing "Waiting on you" (one shared decision state); target decisions are listed apart and not in this count', source: 'lib/marketing/decision-state.mjs' };
  if (!dec || dec.error) return { ...base, count: null, open: [], total: null, error: dec?.error || 'decision state unavailable' };
  return {
    ...base, count: dec.count, open: (dec.open || []).map(openRow), total: dec.count + t, today: dec.today, as_of: dec.as_of,
    plan_approved: !!dec.plan_approved, published: (dec.published || []).map((p) => p.step_key), production_queue: (dec.production_queue || []).length
  };
}

/** All Alan decisions the data supports (currently the beginners target rule only). */
export function alanDecisions({ today, roadmap, roadmapFallback, taught, insights, quarterPlan }) {
  const list = [beginnersDecision({ today, roadmap: roadmap?.length ? roadmap : roadmapFallback, taught, courses: pnmCourses(insights), quarters: quarterPlan?.quarters })];
  return list.filter(Boolean);
}
