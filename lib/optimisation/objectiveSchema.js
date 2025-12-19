// lib/optimisation/objectiveSchema.js
// Canonical objective schema definition and validation

/**
 * Valid KPI values
 */
export const VALID_KPIS = [
  'clicks_28d',
  'impressions_28d',
  'ctr_28d',
  'current_rank',
  'opportunity_score',
  'ai_overview',
  'ai_citations'
];

/**
 * KPI metadata: direction, value extractor, default target_type
 */
export const KPI_METADATA = {
  clicks_28d: {
    direction: 'higher_better',
    extractor: (metrics) => metrics?.clicks_28d ?? metrics?.gsc_clicks_28d ?? null,
    defaultTargetType: 'delta'
  },
  impressions_28d: {
    direction: 'higher_better',
    extractor: (metrics) => metrics?.impressions_28d ?? metrics?.gsc_impressions_28d ?? null,
    defaultTargetType: 'delta'
  },
  ctr_28d: {
    direction: 'higher_better',
    extractor: (metrics) => metrics?.ctr_28d ?? metrics?.gsc_ctr_28d ?? null,
    defaultTargetType: 'delta'
  },
  current_rank: {
    direction: 'lower_better',
    extractor: (metrics) => metrics?.current_rank ?? metrics?.rank ?? null,
    defaultTargetType: 'absolute'
  },
  opportunity_score: {
    direction: 'higher_better',
    extractor: (metrics) => metrics?.opportunity_score ?? null,
    defaultTargetType: 'delta'
  },
  ai_overview: {
    direction: 'boolean_true_better',
    extractor: (metrics) => metrics?.ai_overview ?? false,
    defaultTargetType: 'absolute'
  },
  ai_citations: {
    direction: 'higher_better',
    extractor: (metrics) => metrics?.ai_citations ?? null,
    defaultTargetType: 'delta'
  }
};

/**
 * Validate and normalize an objective object
 * @param {Object} obj - Raw objective object
 * @returns {{ok: boolean, errors: string[], normalisedObjective: Object|null}}
 */
export function validateObjective(obj) {
  const errors = [];
  
  if (!obj || typeof obj !== 'object') {
    return { ok: false, errors: ['Objective must be an object'], normalisedObjective: null };
  }

  // Required: title
  if (!obj.title || typeof obj.title !== 'string' || obj.title.trim().length === 0) {
    errors.push('title is required and must be a non-empty string');
  }

  // Required: kpi
  if (!obj.kpi || typeof obj.kpi !== 'string') {
    errors.push('kpi is required and must be a string');
  } else if (!VALID_KPIS.includes(obj.kpi)) {
    errors.push(`kpi must be one of: ${VALID_KPIS.join(', ')}`);
  }

  // Required: target
  if (obj.target === undefined || obj.target === null) {
    errors.push('target is required');
  } else {
    const kpiMeta = obj.kpi ? KPI_METADATA[obj.kpi] : null;
    if (kpiMeta) {
      if (kpiMeta.direction === 'boolean_true_better') {
        if (typeof obj.target !== 'boolean') {
          errors.push('target must be a boolean for ai_overview KPI');
        }
      } else {
        if (typeof obj.target !== 'number') {
          errors.push('target must be a number');
        }
      }
    }
  }

  // Optional: target_type (default based on KPI)
  let targetType = obj.target_type;
  if (!targetType && obj.kpi) {
    const kpiMeta = KPI_METADATA[obj.kpi];
    if (kpiMeta) {
      targetType = kpiMeta.defaultTargetType;
    } else {
      targetType = 'delta'; // fallback
    }
  }
  if (targetType && !['delta', 'absolute'].includes(targetType)) {
    errors.push('target_type must be "delta" or "absolute"');
  }

  // Optional: due_at (ISO string or null)
  let dueAt = obj.due_at;
  if (dueAt !== null && dueAt !== undefined) {
    if (typeof dueAt !== 'string') {
      errors.push('due_at must be an ISO date string or null');
    } else {
      // Validate ISO format
      const date = new Date(dueAt);
      if (isNaN(date.getTime())) {
        errors.push('due_at must be a valid ISO date string');
      } else {
        dueAt = date.toISOString();
      }
    }
  }

  // Optional: plan (string or null)
  const plan = obj.plan !== undefined && obj.plan !== null ? String(obj.plan) : null;

  if (errors.length > 0) {
    return { ok: false, errors, normalisedObjective: null };
  }

  // Build normalised objective
  const normalisedObjective = {
    title: String(obj.title).trim(),
    kpi: String(obj.kpi),
    target: obj.kpi === 'ai_overview' ? Boolean(obj.target) : Number(obj.target),
    target_type: targetType || 'delta',
    due_at: dueAt || null,
    plan: plan
  };

  return { ok: true, errors: [], normalisedObjective };
}

/**
 * Extract KPI value from a measurement metrics object
 * @param {string} kpi - KPI name
 * @param {Object} metrics - Measurement metrics object
 * @returns {number|boolean|null}
 */
export function extractKpiValue(kpi, metrics) {
  const meta = KPI_METADATA[kpi];
  if (!meta || !metrics) {
    return null;
  }
  return meta.extractor(metrics);
}

