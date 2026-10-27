/**
 * URL keys + the HTTP outcome of a render (status, where it ended up, X-Robots-Tag).
 * Taken from the browser navigation so each page costs one request to the site.
 */

export function urlKey(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${host}${path.toLowerCase()}`;
  } catch {
    return String(raw || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

/** A redirect to the same page (http→https, www, trailing slash) is not a fault. */
export function isSelfRedirect(url, location) {
  return !!location && urlKey(url) === urlKey(location);
}

/** { status, location, xRobots } where a navigation that ended on another URL reads as a 301 to it. */
export function navigationOutcome(url, render) {
  const finalUrl = render?.measure?.finalUrl || null;
  const moved = !!finalUrl && !isSelfRedirect(url, finalUrl);
  return {
    status: moved ? 301 : render?.status ?? null,
    location: moved ? finalUrl : null,
    xRobots: render?.xRobots || ''
  };
}
