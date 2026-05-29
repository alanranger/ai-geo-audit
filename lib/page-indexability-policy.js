/** Page indexability policy resolver — mirrors policy_for_url() SQL semantics. */

function normStoredPath(path) {
  return String(path ?? '').toLowerCase().replace(/\/+$/, '');
}

/** Normalise any URL input to path shape (leading slash, lowercase, no query/fragment/trailing slash). */
export function normalizePath(url) {
  if (url == null || url === '') return '';
  let path = String(url).trim().toLowerCase();
  path = path.replace(/^https?:\/\/[^/]+/, '');
  path = path.replace(/[?#].*$/, '');
  path = path.replace(/\/+$/, '');
  return path;
}

function rowMatches(path, row) {
  const rule = normStoredPath(row.url_or_prefix);
  if (row.match_type === 'exact') return path === rule;
  if (row.match_type === 'prefix') return path === rule || path.startsWith(`${rule}/`);
  return false;
}

function rowRank(row) {
  const exact = row.match_type === 'exact' ? 1 : 0;
  return [exact, normStoredPath(row.url_or_prefix).length];
}

/** Return the single best-matching policy row, or null. */
export function resolvePolicy(url, policies) {
  const path = normalizePath(url);
  if (!path || !Array.isArray(policies) || !policies.length) return null;
  const matches = policies.filter((row) => rowMatches(path, row));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const [aExact, aLen] = rowRank(a);
    const [bExact, bLen] = rowRank(b);
    if (bExact !== aExact) return bExact - aExact;
    return bLen - aLen;
  });
  return matches[0];
}

function toDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Active only when effective_date is set and asOfDate is on/after that date. */
export function isPolicyActive(row, asOfDate = new Date()) {
  if (!row || row.effective_date == null) return false;
  return toDateOnly(asOfDate) >= toDateOnly(row.effective_date);
}

/**
 * Pure date-straddle classifier for a monthly period vs a policy effective date.
 * String-only comparison — no Date objects, no timezones.
 *
 * @param {string} periodStart ISO date 'YYYY-MM-DD', first day of the month.
 * @param {string|null|undefined} effectiveDate ISO date 'YYYY-MM-DD' or nullish.
 * @returns {'inactive'|'pre'|'straddle'|'post'}
 */
export function policyPeriodStatus(periodStart, effectiveDate) {
  if (!effectiveDate) return 'inactive';
  if (!periodStart || typeof periodStart !== 'string') {
    throw new Error('policyPeriodStatus: periodStart must be YYYY-MM-DD');
  }
  const [yStr, mStr] = periodStart.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error('policyPeriodStatus: invalid periodStart ' + periodStart);
  }
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const periodEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

  if (periodEnd <= effectiveDate) return 'pre';
  if (periodStart >= effectiveDate) return 'post';
  return 'straddle';
}

export function isoDateOnly(value) {
  if (value == null || value === '') return null;
  return String(value).slice(0, 10);
}

/** Per-period guard for synthetic/monthly rows (visibility_loss boolean). */
export function applyPolicyVisibilityLossRowGuard(row) {
  const periodStatus = policyPeriodStatus(row.period_start, isoDateOnly(row.policy_effective_date));
  if (row.visibility_loss !== true || periodStatus === 'inactive' || periodStatus === 'pre') {
    return { ...row, policy_suppression_reason: null };
  }
  if (periodStatus === 'post') {
    return { ...row, visibility_loss: false, policy_suppression_reason: 'expected_zero_per_policy' };
  }
  return { ...row, visibility_loss: false, policy_suppression_reason: 'policy_transition_month' };
}

/** Page-level guard after classifyVisibilityLoss (uses recent_period_starts). */
export function applyPageVisibilityLossPolicyGuard(computed, visibilityLossState) {
  if (!visibilityLossState) {
    return { state: null, policy_suppression_reason: null };
  }
  const effectiveDate = isoDateOnly(computed.policy_effective_date);
  if (!effectiveDate) {
    return { state: visibilityLossState, policy_suppression_reason: null };
  }
  const periods = (computed.recent_period_starts || []).map(isoDateOnly).filter(Boolean);
  let hasStraddle = false;
  let allPost = periods.length > 0;
  for (const ps of periods) {
    const st = policyPeriodStatus(ps, effectiveDate);
    if (st === 'straddle') hasStraddle = true;
    if (st !== 'post') allPost = false;
  }
  if (hasStraddle) {
    return { state: null, policy_suppression_reason: 'policy_transition_month' };
  }
  if (allPost && periods.length) {
    return { state: null, policy_suppression_reason: 'expected_zero_per_policy' };
  }
  return { state: visibilityLossState, policy_suppression_reason: null };
}

/**
 * Determine whether a (slug, period) row should be counted in indexable-only KPIs.
 * Pure — relies on policyPeriodStatus for the date math.
 *
 * @param {object} row Must have: policy_value, policy_effective_date, period_start.
 * @returns {boolean}
 */
export function isRowIndexable(row) {
  if (!row) return true;
  const pv = row.policy_value;
  if (pv == null) return true;
  if (pv === 'indexed') return true;
  if (pv === 'other') return false;
  const status = policyPeriodStatus(isoDateOnly(row.period_start), isoDateOnly(row.policy_effective_date));
  return status === 'inactive' || status === 'pre';
}
