/**
 * DataForSEO backlinks/live — recommended spam URL exclusions (SEOSpace CSV–derived).
 * @see Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md
 */

export const DFS_SPAM_FILTERS_VERSION = 'v1';

/** @returns {(string|[string,string,string])[]} */
export function dfsSpamUrlFilters() {
  return [
    ['url_from', 'not_like', '%seo-anomaly%'],
    'and',
    ['url_from', 'not_like', '%bhs-links%'],
    'and',
    ['url_from', 'not_like', '%dark-side-links%'],
    'and',
    ['url_from', 'not_like', '%quarterlinks%']
  ];
}
