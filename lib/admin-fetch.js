/**
 * Scheduled / sync routes accept only Vercel Cron (Bearer CRON_SECRET) or the dashboard admin key
 * (lib/api/cronAuth.js). The dashboard's buttons for those routes call fetch() directly, so this adds the admin key
 * saved in this browser to exactly those calls on this site. Loaded first; nothing else is changed.
 */
(function () {
  const PROTECTED = /^\/api\/(cron\/[a-z0-9-]+|aigeo\/(squarespace-revenue-sync|stripe-revenue-sync|citation-consistency|mentions-ingestion)|optimisation\/bulk-update)$/;
  const SITE = 'ai-geo-audit.vercel.app';
  const original = window.fetch.bind(window);
  const savedKey = () => sessionStorage.getItem('arp_admin_key') || localStorage.getItem('arp_admin_key') || '';

  function needsKey(input) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
      return (url.origin === window.location.origin || url.hostname === SITE) && PROTECTED.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  window.fetch = function adminFetch(input, init) {
    if (!needsKey(input)) return original(input, init);
    const key = savedKey();
    if (!key) return original(input, init);
    const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    if (!headers.has('x-arp-admin-key')) headers.set('x-arp-admin-key', key);
    return original(input, { ...(init || {}), headers });
  };
})();
