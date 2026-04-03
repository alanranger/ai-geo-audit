/** Mirror dashboard `traditionalSeoRuleStatusForUrl` for `gsc_url_indexed` (excluding utility URLs). */

const utilityPath = (url) => {
  try {
    return String(new URL(String(url || '')).pathname || '/').toLowerCase();
  } catch {
    return '';
  }
};

const isUtilityUrl = (url) => {
  const path = utilityPath(url);
  if (!path) return false;
  const utilityRes = [
    /^\/academy\/login(?:\/|$)/i,
    /^\/academy\/trial-expired(?:\/|$)/i,
    /^\/academy\/robo-ranger(?:\/|$)/i,
    /\/wp-admin(?:\/|$)/i,
    /\/checkout(?:\/|$)/i,
    /\/cart(?:\/|$)/i,
    /\/account(?:\/|$)/i,
    /\/members?(?:\/|$)/i,
  ];
  return utilityRes.some((re) => re.test(path));
};

const gscCoverageImpliesPass = (cl) =>
  (cl.includes('submitted') && cl.includes('indexed')) ||
  (cl.includes('indexed') && !cl.includes('not indexed')) ||
  (cl.includes('duplicate') && cl.includes('google')) ||
  (cl.includes('user') && cl.includes('canonical')) ||
  cl.includes('noindex');

const gscCoverageImpliesFail = (cl) =>
  cl.includes('unknown to google') ||
  cl.includes('not indexed') ||
  cl.includes('currently not indexed') ||
  cl.includes('redirect');

/** Pass = GSC confirms indexed (or equivalent). Fail = anything else (no warn). */
export const deriveGscUrlIndexedStatus = (pageUrl, gsc) => {
  if (isUtilityUrl(pageUrl)) return 'pass';
  if (!gsc || typeof gsc !== 'object') return 'fail';
  if (gsc.apiError) return 'fail';
  if (gsc.httpOk === false) return 'fail';
  const cl = String(gsc.coverageState || '').toLowerCase();
  if (gscCoverageImpliesPass(cl)) return 'pass';
  if (gscCoverageImpliesFail(cl)) return 'fail';
  const ver = String(gsc.verdict || '').toUpperCase();
  if (ver === 'PASS') return 'pass';
  if (ver === 'FAIL') return 'fail';
  return 'fail';
};
