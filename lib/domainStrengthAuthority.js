/**
 * Pure helper for turning Domain Strength scores into a simple priority flag.
 */

/**
 * @typedef {'high'|'medium'|'low'} AuthorityPriority
 */

/**
 * @param {number|null} score
 * @returns {AuthorityPriority|null}
 */
export function getAuthorityPriority(score) {
  if (score == null) return null;
  if (score < 40) return 'high';
  if (score < 60) return 'medium';
  return 'low';
}
