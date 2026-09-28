/**
 * Conservative DFS spend / attempt caps for Ranking capture paths.
 * Applies to thin retries + confirmation calls inside one handler/run.
 *
 * Env (optional, visible/configurable):
 *   DFS_RUN_COST_CAP_USD          default 2.00
 *   DFS_RUN_ATTEMPT_CAP           default 180  (incl. retries + confirms)
 *   DFS_CONFIRM_MAX_PER_RUN       default 12
 *   DFS_CONFIRM_MAX_PER_KEYWORD   default 1
 *   DFS_THIN_MAX_ATTEMPTS         default 3
 *   DFS_UNIT_COST_EST_USD         default 0.008 (preflight estimate only)
 */

function envNum(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function getDfsSpendLimits() {
  return Object.freeze({
    run_cost_cap_usd: envNum('DFS_RUN_COST_CAP_USD', 2),
    run_attempt_cap: Math.round(envNum('DFS_RUN_ATTEMPT_CAP', 180)),
    confirm_max_per_run: Math.round(envNum('DFS_CONFIRM_MAX_PER_RUN', 12)),
    confirm_max_per_keyword: Math.round(envNum('DFS_CONFIRM_MAX_PER_KEYWORD', 1)),
    thin_max_attempts: Math.round(envNum('DFS_THIN_MAX_ATTEMPTS', 3)),
    unit_cost_est_usd: envNum('DFS_UNIT_COST_EST_USD', 0.008),
  });
}

/** Mutable tracker for one handler / cron tick invocation. */
export function createDfsSpendTracker(limits = getDfsSpendLimits()) {
  const state = {
    attempts: 0,
    cost_usd: 0,
    confirms_used: 0,
    stopped_reason: null,
  };

  function canAttempt(estCost = limits.unit_cost_est_usd) {
    if (state.stopped_reason) return { ok: false, reason: state.stopped_reason };
    if (state.attempts >= limits.run_attempt_cap) {
      state.stopped_reason = 'run_attempt_cap';
      return { ok: false, reason: 'run_attempt_cap' };
    }
    if (state.cost_usd + Number(estCost || 0) > limits.run_cost_cap_usd + 0.0001) {
      state.stopped_reason = 'run_cost_cap';
      return { ok: false, reason: 'run_cost_cap' };
    }
    return { ok: true, reason: null };
  }

  function recordAttempt(costUsd) {
    state.attempts += 1;
    const c = Number(costUsd);
    if (Number.isFinite(c) && c > 0) state.cost_usd += c;
  }

  function canConfirm(keywordConfirmCount = 0) {
    if (state.stopped_reason) return { ok: false, reason: state.stopped_reason };
    if (keywordConfirmCount >= limits.confirm_max_per_keyword) {
      return { ok: false, reason: 'confirm_per_keyword_cap' };
    }
    if (state.confirms_used >= limits.confirm_max_per_run) {
      return { ok: false, reason: 'confirm_per_run_cap' };
    }
    return canAttempt(limits.unit_cost_est_usd);
  }

  function recordConfirm() {
    state.confirms_used += 1;
  }

  function snapshot() {
    return {
      ...limits,
      attempts_used: state.attempts,
      cost_usd_used: Number(state.cost_usd.toFixed(6)),
      confirms_used: state.confirms_used,
      stopped_reason: state.stopped_reason,
    };
  }

  return { limits, canAttempt, recordAttempt, canConfirm, recordConfirm, snapshot };
}
