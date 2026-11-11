/**
 * After a Booking Sheet upload: re-fetch every Revenue-tab section that reads booking-sheet data
 * (no page reload) and report which sections were refreshed.
 *
 * Steps are grouped by the payload that feeds them. Lanes run concurrently; steps inside a lane
 * run in order (diagnosis renders against the fresh Revenue Truth summary, so it follows it).
 */

export const BOOKING_REFRESH_STEPS = {
  'revenue-truth': {
    payload: 'revenue-truth-summary + revenue-truth-findings',
    sections: [
      'Where we are now', 'GP by month vs survival chart', 'What the numbers say', 'Top declines & growth',
      'Category breakdown (12 categories)', 'Product breakdown', 'Page breakdown', 'Market split',
      'Channel mix', 'New vs existing clients', 'Funding & fees', 'Opportunity stack'
    ]
  },
  diagnosis: {
    payload: 'revenue-funnel-diagnosis',
    sections: ['§9 hubs (money pages by tier)']
  },
  'funnel-summary': {
    payload: 'revenue-funnel-summary',
    sections: ['Survival Cockpit (tiers this month & YTD)', 'Revenue snapshot', 'Revenue by source']
  },
  'sync-banner': {
    payload: 'revenue sync status',
    sections: ['Revenue sync banner']
  }
};

export const BOOKING_REFRESH_PLAN = [['revenue-truth', 'diagnosis'], ['funnel-summary'], ['sync-banner']];

async function runStep(key, runners, onStep) {
  const step = BOOKING_REFRESH_STEPS[key];
  const run = runners[key];
  let result;
  try {
    if (typeof run !== 'function') throw new Error('no refresher available');
    await run();
    result = { key, ok: true, sections: step.sections };
  } catch (err) {
    result = { key, ok: false, sections: step.sections, error: err?.message || String(err) };
  }
  if (onStep) onStep(result);
  return result;
}

async function runLane(lane, runners, onStep) {
  const out = [];
  for (const key of lane) out.push(await runStep(key, runners, onStep));
  return out;
}

/** Runs the plan; never throws. Returns { refreshed: [section], failed: [{ key, sections, error }] }. */
export async function runBookingUploadRefresh(runners, { plan = BOOKING_REFRESH_PLAN, onStep } = {}) {
  const lanes = await Promise.all(plan.map((lane) => runLane(lane, runners, onStep)));
  const results = lanes.flat();
  return {
    refreshed: results.filter((r) => r.ok).flatMap((r) => r.sections),
    failed: results.filter((r) => !r.ok).map(({ key, sections, error }) => ({ key, sections, error }))
  };
}

/** Log line for one finished step in the upload result window. */
export function refreshStepLine(result) {
  const list = result.sections.join(', ');
  return result.ok ? `Refreshed: ${list}.` : `Not refreshed (${result.error}): ${list}.`;
}

/** Final status line for the upload result window. */
export function refreshSummaryLine({ refreshed, failed }) {
  if (!failed.length) return `Booking Sheet imported — ${refreshed.length} sections refreshed (listed below).`;
  const missed = failed.reduce((n, f) => n + f.sections.length, 0);
  return `Booking Sheet imported — ${refreshed.length} sections refreshed, ${missed} not refreshed (see log; reload the page).`;
}

/** Re-reads the Pipeline & Funnel summary that draws the Survival Cockpit; throws if it didn't reload. */
export async function refreshFunnelSummary(win) {
  if (typeof win?.rfFetchSummary !== 'function') throw new Error('Pipeline & Funnel script not loaded');
  const before = win.rfLatestSummary;
  await win.rfFetchSummary();
  if (!win.rfLatestSummary || win.rfLatestSummary === before) throw new Error('revenue-funnel-summary did not reload');
}
