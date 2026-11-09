/**
 * Surface / Top-of-page dial labels (9 Nov 2026): the dials are scored on the fixed LOCKED keyword cohort,
 * so the label shows "of N keywords"; a scan whose keywords flipped unusually often carries the non-blocking
 * "volatile capture" note stored by the ranking guard (ranking_quality_detail.stability.guard.volatility.note).
 * Classic browser script (no imports): window.rankingDialCohort.
 */
(function attachRankingDialCohort(root) {
  function lockedSize() {
    const map = root.__KEYWORD_CLASS_LOCKED_BY_KEYWORD;
    return map && typeof map === 'object' ? Object.keys(map).length : 0;
  }

  /** "of 94 keywords", or "90 of 94 keywords" when some cohort keywords have no row this scan. */
  function cohortLabel(rows, size = lockedSize()) {
    const n = Array.isArray(rows) ? rows.length : 0;
    if (!size) return n ? `of ${n} keywords` : '';
    return n >= size ? `of ${size} keywords` : `${n} of ${size} keywords`;
  }

  /** @param {object|null} heroFetch fetchLatestAuditAndCombinedRows() result ({ latestAudit, combinedRows }) */
  function stabilityOf(heroFetch) {
    const audit = heroFetch?.latestAudit;
    const detail = audit?.ranking_quality_detail || audit?.rankingQualityDetail;
    return detail?.stability || null;
  }

  function volatilityNote(heroFetch) {
    return stabilityOf(heroFetch)?.guard?.volatility?.note || '';
  }

  /** Cohort size stored by the ranking finalize (ranking_quality_detail.stability.cohort.size), else the LOCKED map. */
  function cohortSize(heroFetch) {
    const stored = Number(stabilityOf(heroFetch)?.cohort?.size);
    return stored > 0 ? stored : lockedSize();
  }

  /** Dial suffix (" · of 94 keywords") and the coverage line with the volatility note appended. */
  function heroLabels(rows, heroFetch = null, coverageLine = '') {
    const label = cohortLabel(rows, cohortSize(heroFetch));
    const note = volatilityNote(heroFetch);
    return {
      suffix: label ? ` · ${label}` : '',
      coverageLine: [coverageLine, note].filter(Boolean).join(' '),
    };
  }

  root.rankingDialCohort = { lockedSize, cohortSize, cohortLabel, volatilityNote, heroLabels };
})(globalThis);
