/** Named baseline for Competitor Analysis metrics (§3F/§3G pattern). */
export const COMPETITOR_ANALYSIS_BASELINE = Object.freeze({
  schema_version: 1,
  baseline_name: 'competitor-analysis-v1',
  baseline_date: '2026-07-16',
});

export const MONEY_KEYWORD_CLASSES = Object.freeze(['local-money', 'regional-money', 'national-money']);

/** Hidden when noise toggle ON (independents-only mode). */
export const NOISE_DOMAIN_TYPES = Object.freeze(
  new Set(['platform', 'directory', 'government', 'institution', 'publisher', 'vendor'])
);

export const AUTO_SUGGEST_FLAG_THRESHOLD = 10;

export const SURFACES_FOR_RIVALS = Object.freeze(['organic', 'local_pack']);
