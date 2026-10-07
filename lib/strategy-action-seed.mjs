/** Default Strategy quarter actions (2026–27). Idempotent upsert by action_key. */

export const STRATEGY_QUARTERS = [
  {
    key: 'q1-2026',
    label: 'Q1 Oct–Dec 2026 — Relaunch',
    objective: 'Pick n Mix relaunch + Strategy live',
    targets: { plans: 3, beginners_non_jlr: 8, gp_t3: 2800, returning_r12: 11000 }
  },
  {
    key: 'q2-2027',
    label: 'Q2 Jan–Mar 2027 — Fill',
    objective: 'Calendar + first reviews',
    targets: { plans: 6, beginners_non_jlr: 17, gp_t3: 3000, returning_r12: 12000 }
  },
  {
    key: 'q3-2027',
    label: 'Q3 Apr–Jun 2027 — Prove',
    objective: 'Conversion & referrals',
    targets: { plans: 9, beginners_non_jlr: 27, gp_t3: 3300, returning_r12: 14000 }
  },
  {
    key: 'q4-2027',
    label: 'Q4 Jul–Sep 2027 — Renew',
    objective: 'Renewals + next-year targets',
    targets: { plans: 12, beginners_non_jlr: 37, gp_t3: 3500, returning_r12: 16000 }
  }
];

export const ROADMAP_MILESTONES = [
  { key: 'dec26', label: 'Dec 26', plans: 3, beginners_non_jlr: 8, returning_r12: 11000, gp_t3: 2800 },
  { key: 'mar27', label: 'Mar 27', plans: 6, beginners_non_jlr: 17, returning_r12: 12000, gp_t3: 3000 },
  { key: 'jun27', label: 'Jun 27', plans: 9, beginners_non_jlr: 27, returning_r12: 14000, gp_t3: 3300 },
  { key: 'sep27', label: 'Sep 27', plans: 12, beginners_non_jlr: 37, returning_r12: 16000, gp_t3: 3500 }
];

/** @returns {{ action_key, quarter_key, label, due_week_start, sort_order, is_ticked }[]} */
export function defaultStrategyActions() {
  const q1 = [
    ['q1-remove-beg-12-14', 'Remove beginners 12 & 14 Oct', '2026-10-12', false],
    ['q1-batsford-30-31', 'Batsford 30 & 31 Oct removed', '2026-10-12', true],
    ['q1-rename-batsford', 'Rename Batsford product to "23 - 29 Oct"', '2026-10-12', false],
    ['q1-batsford-email', 'Batsford bring-a-friend email sent', '2026-10-12', false],
    ['q1-plans-tab', 'Plans tab live in Booking Sheet', '2026-10-12', false],
    ['q1-drop-listings', 'Remove LD 12 Mar / Hartland 3 Sep / Snowdonia 6 Mar / Northumb 18 Mar / Gower 28 May / Yorks 3 Jun / Exmoor 12 Jun', '2026-10-12', false],
    ['q1-strategy-brief', 'Strategy tab + Monday brief live', '2026-10-19', false],
    ['q1-vyrnwy-date', 'Add Lake Vyrnwy spring weekend date', '2026-10-19', false],
    ['q1-xmas-decide', 'Decide Christmas Evening (10 Dec) / Christmas Walk (29 Dec)', '2026-10-19', false],
    ['q1-pnm-page', 'Pick n Mix page rewritten with new terms + example plans', '2026-10-26', false],
    ['q1-plan-sheet', 'Last-night plan sheet + 7-day follow-up email', '2026-10-26', false],
    ['q1-max4-copy', 'Residential pages lead with "max 4, one car"', '2026-10-26', false],
    ['q1-ld-3nights', 'Lake District → 3 nights Thu–Sun ~£1,195', '2026-10-26', false],
    ['q1-pnm-newsletter', 'Pick n Mix launch newsletter', '2026-11-02', false],
    ['q1-xmas-gift', 'Christmas gift push for beginners course', '2026-11-16', false]
  ].map(([action_key, label, due_week_start, is_ticked], i) => ({
    action_key, quarter_key: 'q1-2026', label, due_week_start, sort_order: i + 1, is_ticked,
    ticked_at: is_ticked ? '2026-10-07T12:00:00Z' : null
  }));

  const q2 = [
    ['q2-res-calendar', '2027 residential calendar set from fill history'],
    ['q2-offer-plans', 'Residential dates offered to plan clients first'],
    ['q2-reviews', 'First quarterly reviews held'],
    ['q2-spring-beg', 'Spring beginners courses promoted']
  ].map(([action_key, label], i) => ({
    action_key, quarter_key: 'q2-2027', label, due_week_start: '2027-03-01', sort_order: i + 1,
    is_ticked: false, ticked_at: null
  }));

  const q3 = [
    ['q3-review-conv', 'Review plan conversion & credit use; adjust example plans'],
    ['q3-referrals', 'Ask plan clients for referrals + Google reviews'],
    ['q3-vyrnwy-run', 'Lake Vyrnwy spring weekend run']
  ].map(([action_key, label], i) => ({
    action_key, quarter_key: 'q3-2027', label, due_week_start: '2027-06-01', sort_order: i + 1,
    is_ticked: false, ticked_at: null
  }));

  const q4 = [
    ['q4-renewals', 'Renewal offers from month 10 with year-2 path'],
    ['q4-next-targets', "Set next year's targets from actuals"]
  ].map(([action_key, label], i) => ({
    action_key, quarter_key: 'q4-2027', label, due_week_start: '2027-09-01', sort_order: i + 1,
    is_ticked: false, ticked_at: null
  }));

  return [...q1, ...q2, ...q3, ...q4];
}

export async function ensureStrategyActions(supabase, propertyUrl) {
  const { data: existing } = await supabase
    .from('strategy_quarter_actions')
    .select('action_key')
    .eq('property_url', propertyUrl);
  const have = new Set((existing || []).map((r) => r.action_key));
  const missing = defaultStrategyActions()
    .filter((r) => !have.has(r.action_key))
    .map((r) => ({
      ...r,
      property_url: propertyUrl,
      updated_at: new Date().toISOString()
    }));
  if (!missing.length) return { inserted: 0 };
  const { error } = await supabase.from('strategy_quarter_actions').insert(missing);
  if (error) throw error;
  return { inserted: missing.length };
}
