/**
 * Authoritative shared recipes (served with the query catalogue; the Customers recipe buttons read them, so the browser
 * never keeps its own copy of an agreed rule).
 *
 * Pick n Mix candidates (agreed broad rule, the Tue 10 Nov cohort; QUESTION-2026-11-08 final fix round item 2):
 * subscribed, present in Squarespace and unsuppressed ("can email"); opened a campaign within 6 calendar months; AND
 * (any booking or purchase in the last 24 months OR a Pick n Mix purchase at any time); every workshop / product category.
 * People only: Alan's one business copy is added at delivery, never in the people count.
 */
const C = (field, op, value = null) => ({ type: 'cond', field, op, value });
const G = (match, items) => ({ type: 'group', match, items });
const months = (n) => ({ n, unit: 'months' });

export const PNM_CANDIDATES = {
  key: 'pnm_candidates', version: 1, label: 'Pick n Mix candidates (agreed broad rule)', agreed: '8 Nov 2026 (Tue 10 Nov launch cohort)',
  query: { version: 1, root: G('all', [
    C('eligible', 'is_true'),
    C('last_open', 'within_last', months(6)),
    G('any', [C('booking', 'exists', { within: months(24) }), C('purchase', 'exists', { within: months(24) }), C('purchase', 'exists', { cats: ['pick_n_mix'] })])
  ]) },
  basis: 'can email (subscribed, in Squarespace, unsuppressed) · opened a campaign within 6 calendar months · any booking or purchase in 24 months OR a Pick n Mix purchase at any time · all categories · people only (1 business copy added at delivery)'
};

export const RECIPES = { pnm_candidates: PNM_CANDIDATES };
