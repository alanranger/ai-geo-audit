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

export const deriveGscUrlIndexedStatus = (pageUrl, gsc) => {
  if (isUtilityUrl(pageUrl)) return 'pass';
  if (!gsc || typeof gsc !== 'object') return 'warn';
  if (gsc.apiError) return 'warn';
  if (gsc.httpOk === false) return 'warn';
  const covRaw = String(gsc.coverageState || '');
  const cl = covRaw.toLowerCase();
  if (cl.includes('submitted') && cl.includes('indexed')) return 'pass';
  if (cl.includes('duplicate') && cl.includes('google')) return 'pass';
  if (cl.includes('user') && cl.includes('canonical')) return 'pass';
  if (cl.includes('noindex')) return 'pass';
  if (cl.includes('unknown to google')) return 'fail';
  if (cl.includes('not indexed') || cl.includes('currently not indexed')) return 'warn';
  if (cl.includes('redirect')) return 'warn';
  const ver = String(gsc.verdict || '').toUpperCase();
  if (ver === 'PASS') return 'pass';
  if (ver === 'FAIL') return 'fail';
  return 'warn';
};
