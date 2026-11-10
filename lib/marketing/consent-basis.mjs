/**
 * Consent basis recorded by Alan (marketing_decisions kind 'consent_basis'; QUESTION-2026-11-10-soft-opt-in-stage-2).
 * One batch row (ref_key = the batch key) + one row per person keyed by the sha256 email hash (no personal data).
 * Only a per-person row whose decision is the basis itself applies; an exclusion ("declined at checkout") or a revoked
 * row never does. The rebuild reads them every run, so facts.consent_source survives rebuilds and the Squarespace
 * import / profile sync. It explains WHY a person may be emailed; subscribed / suppressed / profile_state are untouched.
 */
import { emailHash, selectAll } from './store.mjs';

export const SOFT_OPT_IN = 'soft_opt_in_existing_customer';
export const SOFT_OPT_IN_BATCH = 'soft-opt-in-existing-customer-2026-11';
export const SOFT_OPT_IN_LABEL = 'Soft opt-in (existing customer, Nov 2026)';
export const SOFT_OPT_IN_EXCLUDED = 'excluded: declined at checkout';
const HASH = /^[0-9a-f]{64}$/;

/** email hash → consent basis, from active per-person consent_basis rows. */
export function consentBasisByHash(rows) {
  const live = (rows || []).filter((r) => r.kind === 'consent_basis' && HASH.test(r.ref_key || '') && r.decision === SOFT_OPT_IN);
  return new Map(live.map((r) => [r.ref_key, SOFT_OPT_IN]));
}

/** The basis for one address, if Alan recorded one. */
export const consentBasisOf = (basis, email) => (email && basis?.size ? basis.get(emailHash(email)) || null : null);

export const loadConsentBasis = (sb) => selectAll(sb, 'marketing_decisions', 'decision_key, kind, ref_key, decision', (q) => q.eq('kind', 'consent_basis')).catch(() => []);
