// lib/optimisation/metricTraffic.js
// Utility functions for classifying metric changes (Better/Same/Worse) across tasks

/**
 * Check if a task status is considered "active" for traffic light calculations
 * Active statuses: planned, in_progress, monitoring
 * Excluded: done, paused, cancelled
 */
export function isActiveStatus(status) {
  return ['planned', 'in_progress', 'monitoring'].includes(status);
}

/**
 * Get baseline and latest measurement values from a task's measurement events
 * @param {Array} measurements - Array of measurement events (sorted by date)
 * @param {string} scope - 'active_cycle' or 'all_tasks'
 * @param {Object} activeCycle - The active cycle object (if scope is 'active_cycle')
 * @returns {Object|null} { baseline, latest } or null if insufficient data
 */
export function getBaselineLatest(measurements, scope, activeCycle = null) {
  if (!measurements || measurements.length === 0) {
    return null;
  }

  let eligibleMeasurements = [...measurements];

  // Filter by scope
  if (scope === 'active_cycle' && activeCycle) {
    const cycleStartDate = activeCycle.started_at ? new Date(activeCycle.started_at) : null;
    if (cycleStartDate) {
      eligibleMeasurements = eligibleMeasurements.filter(m => {
        const mDate = m.captured_at ? new Date(m.captured_at) : null;
        return mDate && mDate >= cycleStartDate;
      });
    }
  }

  // Need at least 2 measurements to compute baseline/latest
  if (eligibleMeasurements.length < 2) {
    return null;
  }

  // Sort by date (oldest first)
  eligibleMeasurements.sort((a, b) => {
    const dateA = a.captured_at ? new Date(a.captured_at) : new Date(0);
    const dateB = b.captured_at ? new Date(b.captured_at) : new Date(0);
    return dateA - dateB;
  });

  const baseline = eligibleMeasurements[0];
  const latest = eligibleMeasurements[eligibleMeasurements.length - 1];

  return { baseline, latest };
}

/**
 * Extract numeric value for a metric from a measurement object
 */
function getMetricValue(measurement, metricKey) {
  if (!measurement) return null;

  const extractors = {
    ctr_28d: (m) => m?.ctr_28d ?? null,
    impressions_28d: (m) => m?.impressions_28d ?? null,
    clicks_28d: (m) => m?.clicks_28d ?? null,
    current_rank: (m) => m?.current_rank ?? m?.rank ?? null,
    opportunity_score: (m) => m?.opportunity_score ?? null,
    ai_overview: (m) => m?.ai_overview ?? null,
    ai_citations: (m) => m?.ai_citations ?? null,
  };

  const extractor = extractors[metricKey];
  if (!extractor) return null;

  return extractor(measurement);
}

/**
 * Classify a metric change as "better", "same", or "worse"
 * @param {string} metricKey - The metric identifier (e.g., 'ctr_28d')
 * @param {Object} baseline - Baseline measurement object
 * @param {Object} latest - Latest measurement object
 * @returns {string|null} 'better' | 'same' | 'worse' | null
 */
export function classifyMetric(metricKey, baseline, latest) {
  if (!baseline || !latest) {
    return null;
  }

  const baselineValue = getMetricValue(baseline, metricKey);
  const latestValue = getMetricValue(latest, metricKey);

  // If either value is null/undefined, cannot classify
  if (baselineValue == null || latestValue == null) {
    return null;
  }

  // CTR (28d) - stored as ratio (0-1), compare as percentage points
  if (metricKey === 'ctr_28d') {
    const deltaPp = (latestValue - baselineValue) * 100;
    if (Math.abs(deltaPp) < 0.10) {
      return 'same';
    }
    return deltaPp >= 0.10 ? 'better' : 'worse';
  }

  // Impressions (28d)
  if (metricKey === 'impressions_28d') {
    const delta = latestValue - baselineValue;
    const tol = Math.max(20, Math.round(baselineValue * 0.02));
    if (Math.abs(delta) < tol) {
      return 'same';
    }
    return delta >= tol ? 'better' : 'worse';
  }

  // Clicks (28d)
  if (metricKey === 'clicks_28d') {
    const delta = latestValue - baselineValue;
    const tol = Math.max(5, Math.round(baselineValue * 0.05));
    if (Math.abs(delta) < tol) {
      return 'same';
    }
    return delta >= tol ? 'better' : 'worse';
  }

  // Rank (lower is better)
  if (metricKey === 'current_rank') {
    const delta = latestValue - baselineValue; // positive means rank got worse (increased)
    if (Math.abs(delta) < 0.5) {
      return 'same';
    }
    return delta <= -0.5 ? 'better' : 'worse';
  }

  // AI Citations
  if (metricKey === 'ai_citations') {
    const delta = latestValue - baselineValue;
    if (delta === 0) {
      return 'same';
    }
    return delta > 0 ? 'better' : 'worse';
  }

  // AI Overview (boolean)
  if (metricKey === 'ai_overview') {
    const baselineBool = baselineValue === true || baselineValue === 'On' || baselineValue === 1;
    const latestBool = latestValue === true || latestValue === 'On' || latestValue === 1;
    
    if (baselineBool === latestBool) {
      return 'same';
    }
    // Better: Off -> On, Worse: On -> Off
    return (!baselineBool && latestBool) ? 'better' : 'worse';
  }

  // Opportunity Score
  if (metricKey === 'opportunity_score') {
    const delta = latestValue - baselineValue;
    if (Math.abs(delta) < 2) {
      return 'same';
    }
    return delta >= 2 ? 'better' : 'worse';
  }

  // Unknown metric
  return null;
}

/**
 * Compute traffic light counts for all metrics across a set of tasks
 * @param {Array} tasks - Array of task objects with measurements
 * @param {string} scope - 'active_cycle' or 'all_tasks'
 * @returns {Object} Traffic light counts by metric and bucket
 */
export function computeTrafficLightCounts(tasks, scope) {
  const counts = {
    ctr_28d: { worse: 0, same: 0, better: 0 },
    impressions_28d: { worse: 0, same: 0, better: 0 },
    clicks_28d: { worse: 0, same: 0, better: 0 },
    current_rank: { worse: 0, same: 0, better: 0 },
    ai_citations: { worse: 0, same: 0, better: 0 },
    ai_overview: { worse: 0, same: 0, better: 0 },
    opportunity_score: { worse: 0, same: 0, better: 0 },
  };

  const metricKeys = Object.keys(counts);

  for (const task of tasks) {
    // Only count active tasks
    if (!isActiveStatus(task.status)) {
      continue;
    }

    // Get active cycle if scope is 'active_cycle'
    const activeCycle = scope === 'active_cycle' 
      ? (task.cycles?.find(c => c.is_active) || null)
      : null;

    // Get measurements
    const measurements = task.measurements || [];
    const baselineLatest = getBaselineLatest(measurements, scope, activeCycle);

    if (!baselineLatest) {
      // Task doesn't have enough measurements, skip
      continue;
    }

    // Classify each metric
    for (const metricKey of metricKeys) {
      const classification = classifyMetric(
        metricKey,
        baselineLatest.baseline,
        baselineLatest.latest
      );

      if (classification) {
        counts[metricKey][classification]++;
      }
    }
  }

  return counts;
}

