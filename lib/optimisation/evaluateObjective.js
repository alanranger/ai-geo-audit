// lib/optimisation/evaluateObjective.js
// Objective evaluation logic (server-side source of truth)

import { validateObjective, extractKpiValue, KPI_METADATA } from './objectiveSchema.js';

/**
 * Evaluate an objective against baseline and latest measurements
 * @param {Object} objective - Normalised objective object
 * @param {Object} baselineMeasurement - Baseline measurement metrics (or null)
 * @param {Object} latestMeasurement - Latest measurement metrics (or null)
 * @param {Date} now - Current date (defaults to now)
 * @returns {{status: string, progress: Object}}
 */
export function evaluateObjective(objective, baselineMeasurement, latestMeasurement, now = new Date()) {
  // Validate objective first
  const validation = validateObjective(objective);
  if (!validation.ok) {
    return {
      status: 'not_set',
      progress: null
    };
  }

  const obj = validation.normalisedObjective;

  // Extract values
  const baselineValue = baselineMeasurement ? extractKpiValue(obj.kpi, baselineMeasurement) : null;
  const latestValue = latestMeasurement ? extractKpiValue(obj.kpi, latestMeasurement) : null;

  // Get KPI metadata
  const kpiMeta = KPI_METADATA[obj.kpi];
  if (!kpiMeta) {
    return {
      status: 'not_set',
      progress: null
    };
  }

  // Compute improvement delta (signed, in "improving" direction)
  let delta = null;
  if (baselineValue !== null && latestValue !== null) {
    if (kpiMeta.direction === 'higher_better') {
      delta = latestValue - baselineValue;
    } else if (kpiMeta.direction === 'lower_better') {
      // For rank: improvement is positive when rank decreases (e.g., 5 -> 3 = +2 improvement)
      delta = baselineValue - latestValue;
    } else if (kpiMeta.direction === 'boolean_true_better') {
      // Convert boolean to number for delta calculation
      const baselineNum = baselineValue ? 1 : 0;
      const latestNum = latestValue ? 1 : 0;
      delta = latestNum - baselineNum;
    }
  } else if (latestValue !== null && baselineValue === null) {
    // Only latest exists, no baseline yet
    delta = 0;
  }

  // Determine if target is met
  let met = false;
  if (obj.target_type === 'delta') {
    // Delta target: check if improvement delta meets/exceeds target
    if (delta !== null) {
      if (kpiMeta.direction === 'boolean_true_better') {
        met = latestValue === true;
      } else {
        met = delta >= obj.target;
      }
    }
  } else if (obj.target_type === 'absolute') {
    // Absolute target: check if latest value meets target
    if (latestValue !== null) {
      if (kpiMeta.direction === 'higher_better') {
        met = latestValue >= obj.target;
      } else if (kpiMeta.direction === 'lower_better') {
        met = latestValue <= obj.target;
      } else if (kpiMeta.direction === 'boolean_true_better') {
        met = latestValue === true;
      }
    }
  }

  // Determine status
  let status = 'not_set';
  if (met) {
    status = 'met';
  } else if (obj.due_at) {
    const dueDate = new Date(obj.due_at);
    if (now > dueDate) {
      status = 'overdue';
    } else {
      status = 'on_track';
    }
  } else {
    status = 'on_track';
  }

  // Build progress object
  const progress = {
    baseline_value: baselineValue,
    latest_value: latestValue,
    delta: delta,
    target: obj.target,
    target_type: obj.target_type,
    remaining_to_target: null
  };

  // Calculate remaining_to_target
  if (!met && latestValue !== null && obj.target_type === 'delta' && delta !== null) {
    progress.remaining_to_target = Math.max(0, obj.target - delta);
  } else if (!met && latestValue !== null && obj.target_type === 'absolute') {
    if (kpiMeta.direction === 'higher_better') {
      progress.remaining_to_target = Math.max(0, obj.target - latestValue);
    } else if (kpiMeta.direction === 'lower_better') {
      progress.remaining_to_target = Math.max(0, latestValue - obj.target);
    }
  }

  return {
    status,
    progress
  };
}

