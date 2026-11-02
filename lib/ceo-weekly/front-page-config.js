/** Monday brief front page — Alan's targets (MONDAY-BRIEF-REDESIGN-DECISIONS-2026-11-02-alan.md). */
export const FRONT_PAGE = {
  tiles: {
    peoplePerEventTarget: 3,
    bookingsPer1kTarget: 2.6,
    commercialClicksTarget: 333,
    academyTrialsMonthly: 115,
    academyConversionsMonthly: 3,
    aiAnswersTarget: 6,
    aiAnswersBy: 'end of March'
  },
  /** One colour rule for every tile: ≥100% green · 90–99% amber · <90% red · grey = can't judge. */
  colourBands: { green: 1, amber: 0.9 },
  actions: {
    fillMinDays: 7,
    fillMaxDays: 90,
    suppressDays: 28,
    giftVoucher: { category: 8, months: [11, 12], seasonStartMonth: 11, dropShare: 0.5 },
    academyNudge: { minEnded7d: 3 },
    watchedPages: [
      {
        key: 'website:free-online-photography-course',
        page: 'free-online-photography-course',
        label: 'Free online photography course: diagnose the ranking slide',
        tag: 'not a 1-week fix · on rescue plan',
        note: 'feeds Academy trials',
        yoyDropShare: 0.5,
        kind: 'diagnose'
      }
    ]
  }
};
