/**
 * Conservative DFS spend / attempt caps for Ranking capture paths.
 * Shared logical-run budget across dashboard batches and Monday ticks.
 *
 * Env (optional, visible/configurable):
 *   DFS_RUN_COST_CAP_USD          default 2.00
 *   DFS_RUN_ATTEMPT_CAP           default 180  (incl. retries + confirms)
 *   DFS_CONFIRM_MAX_PER_RUN       default 12
 *   DFS_CONFIRM_MAX_PER_KEYWORD   default 1
 *   DFS_THIN_MAX_ATTEMPTS         default 3
 *   DFS_UNIT_COST_EST_USD         default 0.008 (base SERP, no AIO expand)
 *   DFS_AIO_EXPAND_COST_EST_USD   default 0.025 (optional AI overview expand)
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
    aio_expand_cost_est_usd: envNum('DFS_AIO_EXPAND_COST_EST_USD', 0.025),
  });
}

/** Conservative unit estimate for a call (AIO expand must not use unsafe 0.008). */
export function estimateDfsCallCost(limits = getDfsSpendLimits(), opts = {}) {
  if (opts.expandAiOverview) return limits.aio_expand_cost_est_usd;
  const override = Number(opts.estCost);
  if (Number.isFinite(override) && override > 0) return override;
  return limits.unit_cost_est_usd;
}

/**
 * Mutable tracker for one logical run (dashboard full/filtered/single or Monday tick).
 * Pass prior snapshot as second arg to continue remaining budget across HTTP batches.
 */
export function createDfsSpendTracker(limits = getDfsSpendLimits(), prior = null) {
  const state = {
    attempts: Math.max(0, Math.round(Number(prior?.attempts_used) || 0)),
    cost_usd: Math.max(0, Number(prior?.cost_usd_used) || 0),
    confirms_used: Math.max(0, Math.round(Number(prior?.confirms_used) || 0)),
    stopped_reason: prior?.stopped_reason || null,
  };

  function gateCheck(estCost) {
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

  /** Read-only check (no reservation). Prefer reserveAttempt under concurrency. */
  function canAttempt(estCost = limits.unit_cost_est_usd) {
    return gateCheck(estCost);
  }

  /**
   * Reserve attempt + conservative cost BEFORE the concurrent DFS call.
   * Prevents overshoot when many workers pass canAttempt then all call.
   */
  function reserveAttempt(estCost = limits.unit_cost_est_usd) {
    const reserved = Number(estCost);
    const cost = Number.isFinite(reserved) && reserved > 0 ? reserved : limits.unit_cost_est_usd;
    const gate = gateCheck(cost);
    if (!gate.ok) return { ok: false, reason: gate.reason, reserved: 0 };
    state.attempts += 1;
    state.cost_usd += cost;
    return { ok: true, reason: null, reserved: cost };
  }

  /**
   * After call: replace reserved estimate with actual when known.
   * Unknown/missing actual keeps the conservative reserved amount.
   */
  function settleAttempt(reserved, actualCost) {
    const reservedN = Number(reserved) || 0;
    const actual = Number(actualCost);
    if (!Number.isFinite(actual) || actual < 0) return;
    state.cost_usd = Math.max(0, state.cost_usd - reservedN + actual);
  }

  /** Legacy path — prefer reserveAttempt + settleAttempt under concurrency. */
  function recordAttempt(costUsd) {
    state.attempts += 1;
    const c = Number(costUsd);
    if (Number.isFinite(c) && c > 0) state.cost_usd += c;
    else state.cost_usd += limits.unit_cost_est_usd;
  }

  function canConfirm(keywordConfirmCount = 0, estCost = limits.unit_cost_est_usd) {
    if (state.stopped_reason) return { ok: false, reason: state.stopped_reason };
    if (keywordConfirmCount >= limits.confirm_max_per_keyword) {
      return { ok: false, reason: 'confirm_per_keyword_cap' };
    }
    if (state.confirms_used >= limits.confirm_max_per_run) {
      return { ok: false, reason: 'confirm_per_run_cap' };
    }
    return gateCheck(estCost);
  }

  /** Reserve confirm slot + attempt budget before confirmation call. */
  function reserveConfirm(keywordConfirmCount = 0, estCost = limits.unit_cost_est_usd) {
    const gate = canConfirm(keywordConfirmCount, estCost);
    if (!gate.ok) return { ok: false, reason: gate.reason, reserved: 0 };
    state.confirms_used += 1;
    return reserveAttempt(estCost);
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

  return {
    limits,
    canAttempt,
    reserveAttempt,
    settleAttempt,
    recordAttempt,
    canConfirm,
    reserveConfirm,
    recordConfirm,
    snapshot,
  };
}
