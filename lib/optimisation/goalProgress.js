// lib/optimisation/goalProgress.js
// Shared helper for computing and formatting goal progress

import { KPI_METADATA } from './objectiveSchema.js';

/**
 * KPI display metadata: how to format values and deltas for each KPI
 */
const KPI_DISPLAY_METADATA = {
  clicks_28d: {
    type: 'count',
    formatValue: (val) => val != null ? Math.round(val).toLocaleString('en-GB') : '—',
    formatDelta: (delta) => {
      if (delta == null) return '—';
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${Math.round(delta).toLocaleString('en-GB')}`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        return Math.round(target).toLocaleString('en-GB');
      }
      // Delta: show as "+X" or "-X"
      const sign = target >= 0 ? '+' : '';
      return `${sign}${Math.round(target).toLocaleString('en-GB')}`;
    }
  },
  impressions_28d: {
    type: 'count',
    formatValue: (val) => {
      if (val == null) return '—';
      if (val >= 1000) {
        return (val / 1000).toFixed(1) + 'k';
      }
      return Math.round(val).toLocaleString('en-GB');
    },
    formatDelta: (delta) => {
      if (delta == null) return '—';
      const sign = delta >= 0 ? '+' : '';
      if (Math.abs(delta) >= 1000) {
        return `${sign}${(delta / 1000).toFixed(1)}k`;
      }
      return `${sign}${Math.round(delta).toLocaleString('en-GB')}`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        if (target >= 1000) {
          return (target / 1000).toFixed(1) + 'k';
        }
        return Math.round(target).toLocaleString('en-GB');
      }
      // Delta: show as "+X" or "-X"
      const sign = target >= 0 ? '+' : '';
      if (Math.abs(target) >= 1000) {
        return `${sign}${(target / 1000).toFixed(1)}k`;
      }
      return `${sign}${Math.round(target).toLocaleString('en-GB')}`;
    }
  },
  ctr_28d: {
    type: 'rate_decimal', // Stored as 0-1, display as %, delta as pp
    formatValue: (val) => {
      if (val == null) return '—';
      return (val * 100).toFixed(2) + '%';
    },
    formatDelta: (delta) => {
      if (delta == null) return '—';
      // Delta is in decimal (0-1), convert to percentage points
      const deltaPp = delta * 100;
      const sign = deltaPp >= 0 ? '+' : '';
      return `${sign}${deltaPp.toFixed(2)}pp`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        // Absolute target is stored as decimal (0-1), display as %
        return (target * 100).toFixed(2) + '%';
      }
      // Delta target: for CTR, if baseline is 0, we can't do relative %
      // Show as percentage points if baseline is 0 or very small
      if (baseline == null || baseline === 0 || baseline < 0.001) {
        // Treat as absolute percentage points
        return `+${(target * 100).toFixed(2)}pp`;
      }
      // Relative percentage: "increase by 100%" means double (baseline * 2)
      // But we store target as the delta in decimal, so we need to compute what that means
      // If user says "increase by 100%", target should be baseline (100% of baseline)
      // Actually, for CTR with delta targets, we should show as percentage points
      // The target is the absolute delta in decimal units
      const targetPp = target * 100;
      const sign = target >= 0 ? '+' : '';
      return `${sign}${targetPp.toFixed(2)}pp`;
    }
  },
  current_rank: {
    type: 'rank_lower_better',
    formatValue: (val) => val != null ? Math.round(val).toString() : '—',
    formatDelta: (delta) => {
      if (delta == null) return '—';
      // For rank, positive delta means improvement (rank went down)
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${Math.round(delta)}`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        return Math.round(target).toString();
      }
      // Delta: positive means rank should decrease by this amount
      const sign = target >= 0 ? '+' : '';
      return `${sign}${Math.round(target)}`;
    }
  },
  opportunity_score: {
    type: 'score_0_100',
    formatValue: (val) => val != null ? Math.round(val).toString() : '—',
    formatDelta: (delta) => {
      if (delta == null) return '—';
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${Math.round(delta)}`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        return Math.round(target).toString();
      }
      const sign = target >= 0 ? '+' : '';
      return `${sign}${Math.round(target)}`;
    }
  },
  ai_overview: {
    type: 'boolean',
    formatValue: (val) => val === true ? 'On' : (val === false ? 'Off' : '—'),
    formatDelta: (delta) => {
      if (delta == null) return '—';
      if (delta > 0) return '+1';
      if (delta < 0) return '-1';
      return '0';
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      return target === true ? 'On' : 'Off';
    }
  },
  ai_citations: {
    type: 'count',
    formatValue: (val) => val != null ? Math.round(val).toString() : '—',
    formatDelta: (delta) => {
      if (delta == null) return '—';
      const sign = delta >= 0 ? '+' : '';
      return `${sign}${Math.round(delta)}`;
    },
    formatTarget: (target, targetType, baseline) => {
      if (target == null) return '—';
      if (targetType === 'absolute') {
        return Math.round(target).toString();
      }
      const sign = target >= 0 ? '+' : '';
      return `${sign}${Math.round(target)}`;
    }
  }
};

/**
 * Compute goal progress with proper KPI-specific handling
 * @param {Object} params
 * @param {string} params.kpiKey - KPI identifier (e.g., 'ctr_28d')
 * @param {number|null} params.baseline - Baseline value
 * @param {number|null} params.latest - Latest value
 * @param {string} params.targetDirection - 'increase' or 'decrease' (for display)
 * @param {number} params.targetValue - Target value
 * @param {string} params.targetType - 'delta' or 'absolute'
 * @returns {Object} Progress calculation result
 */
export function computeGoalProgress({ kpiKey, baseline, latest, targetDirection, targetValue, targetType }) {
  const kpiMeta = KPI_METADATA[kpiKey];
  const displayMeta = KPI_DISPLAY_METADATA[kpiKey];
  
  if (!kpiMeta || !displayMeta) {
    return {
      baselineValue: baseline,
      latestValue: latest,
      deltaValue: null,
      targetAbsValue: null,
      remainingToTarget: null,
      progressRatio: 0,
      isMet: false,
      baselineLabel: '—',
      latestLabel: '—',
      deltaLabel: '—',
      targetLabel: '—',
      progressLabel: '—'
    };
  }

  // Calculate delta (improvement direction)
  let delta = null;
  if (baseline != null && latest != null) {
    if (kpiMeta.direction === 'higher_better') {
      delta = latest - baseline;
    } else if (kpiMeta.direction === 'lower_better') {
      // For rank: improvement is positive when rank decreases
      delta = baseline - latest;
    } else if (kpiMeta.direction === 'boolean_true_better') {
      const baselineNum = baseline ? 1 : 0;
      const latestNum = latest ? 1 : 0;
      delta = latestNum - baselineNum;
    }
  }

  // Calculate absolute target value
  let targetAbsValue = null;
  if (targetType === 'delta') {
    if (baseline != null) {
      if (kpiKey === 'ctr_28d' && baseline === 0) {
        // Special case: CTR with baseline 0, treat target as absolute pp
        targetAbsValue = targetValue; // targetValue is already in decimal (0-1)
      } else {
        // For "increase by X%", if it's a percentage KPI, compute absolute target
        if (kpiKey === 'ctr_28d') {
          // For CTR, "increase by 100%" means double (baseline * 2)
          // But targetValue is the delta in decimal units, not percentage
          // So targetAbsValue = baseline + targetValue
          targetAbsValue = baseline + targetValue;
        } else {
          // For other KPIs, absolute target = baseline + targetValue
          targetAbsValue = baseline + targetValue;
        }
      }
    }
  } else {
    // Absolute target
    targetAbsValue = targetValue;
  }

  // Determine if met
  let isMet = false;
  if (targetType === 'delta') {
    if (delta != null) {
      isMet = delta >= targetValue;
    }
  } else {
    if (latest != null) {
      if (kpiMeta.direction === 'higher_better') {
        isMet = latest >= targetValue;
      } else if (kpiMeta.direction === 'lower_better') {
        isMet = latest <= targetValue;
      } else if (kpiMeta.direction === 'boolean_true_better') {
        isMet = latest === true;
      }
    }
  }

  // Calculate remaining to target
  let remainingToTarget = null;
  if (!isMet && latest != null) {
    if (targetType === 'delta') {
      if (delta != null) {
        remainingToTarget = Math.max(0, targetValue - delta);
      }
    } else {
      if (kpiMeta.direction === 'higher_better') {
        remainingToTarget = Math.max(0, targetValue - latest);
      } else if (kpiMeta.direction === 'lower_better') {
        remainingToTarget = Math.max(0, latest - targetValue);
      }
    }
  }

  // Calculate progress ratio (0-1)
  let progressRatio = 0;
  if (targetType === 'delta' && targetValue !== 0) {
    if (delta != null) {
      progressRatio = Math.min(1, Math.max(0, delta / targetValue));
    }
  } else if (targetType === 'absolute' && baseline != null && targetValue != null) {
    if (kpiMeta.direction === 'higher_better') {
      const range = targetValue - baseline;
      if (range > 0 && latest != null) {
        progressRatio = Math.min(1, Math.max(0, (latest - baseline) / range));
      }
    } else if (kpiMeta.direction === 'lower_better') {
      const range = baseline - targetValue;
      if (range > 0 && latest != null) {
        progressRatio = Math.min(1, Math.max(0, (baseline - latest) / range));
      }
    }
  }

  // Format labels
  const baselineLabel = displayMeta.formatValue(baseline);
  const latestLabel = displayMeta.formatValue(latest);
  const deltaLabel = displayMeta.formatDelta(delta);
  const targetLabel = displayMeta.formatTarget(targetValue, targetType, baseline);
  
  // Build progress label
  let progressLabel = '—';
  if (baseline != null && latest != null && targetValue != null) {
    if (targetType === 'delta') {
      // Show: "X/Y (+Z)" where X is current progress, Y is target, Z is remaining
      if (remainingToTarget != null && remainingToTarget > 0) {
        progressLabel = `${deltaLabel}/${targetLabel} (${displayMeta.formatDelta(remainingToTarget)} remaining)`;
      } else if (isMet) {
        progressLabel = `${deltaLabel}/${targetLabel} (Met)`;
      } else {
        progressLabel = `${deltaLabel}/${targetLabel}`;
      }
    } else {
      // Absolute target: show progress ratio or remaining
      if (remainingToTarget != null && remainingToTarget > 0) {
        progressLabel = `${latestLabel}/${targetLabel} (${displayMeta.formatValue(remainingToTarget)} remaining)`;
      } else if (isMet) {
        progressLabel = `${latestLabel}/${targetLabel} (Met)`;
      } else {
        progressLabel = `${latestLabel}/${targetLabel}`;
      }
    }
  }

  return {
    baselineValue: baseline,
    latestValue: latest,
    deltaValue: delta,
    targetAbsValue,
    remainingToTarget,
    progressRatio,
    isMet,
    baselineLabel,
    latestLabel,
    deltaLabel,
    targetLabel,
    progressLabel
  };
}

