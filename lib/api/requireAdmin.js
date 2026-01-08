// lib/api/requireAdmin.js
// Admin gate for service-role API routes (Vercel serverless functions)

/**
 * Parse allowed origins from environment variable
 */
function parseAllowedOrigins() {
  const raw = process.env.ARP_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Check if origin is in allowed list
 */
function isOriginAllowed(origin, allowed) {
  if (!origin) return false;
  return allowed.includes(origin);
}

/**
 * Allow same-origin requests even when ARP_ALLOWED_ORIGINS is configured.
 * This makes Vercel preview deployments work without needing to list every preview URL.
 */
function isSameOrigin(origin, req) {
  if (!origin) return false;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return false;
  try {
    const o = new URL(origin);
    return o.host === host;
  } catch (e) {
    return false;
  }
}

/**
 * Admin gate for service-role API routes.
 * Returns true if authorized, false if not (and sends error response).
 * 
 * @param {Object} req - Vercel serverless function request object
 * @param {Object} res - Vercel serverless function response object
 * @param {Function} sendJSON - Function to send JSON response (res, status, obj)
 * @returns {boolean} - true if authorized, false if denied (response already sent)
 */
export function requireAdmin(req, res, sendJSON) {
  const expected = process.env.ARP_ADMIN_KEY;
  if (!expected) {
    console.error('[requireAdmin] ARP_ADMIN_KEY environment variable is missing in Vercel');
    sendJSON(res, 500, { error: "Server misconfigured: ARP_ADMIN_KEY missing. Please configure ARP_ADMIN_KEY in Vercel environment variables." });
    return false;
  }
  
  if (!String(expected).trim()) {
    console.error('[requireAdmin] ARP_ADMIN_KEY is set but is empty or whitespace-only');
    sendJSON(res, 500, { error: "Server misconfigured: ARP_ADMIN_KEY is empty. Please set a non-empty value in Vercel environment variables." });
    return false;
  }

  // 1) Admin key header check
  const provided = req.headers["x-arp-admin-key"] || "";
  if (!provided || provided !== expected) {
    sendJSON(res, 401, { error: "Unauthorized" });
    return false;
  }

  // 2) Same-origin guard (helps reduce drive-by abuse; not a full security boundary)
  const allowed = parseAllowedOrigins();
  if (allowed.length > 0) {
    let originToCheck = req.headers.origin;
    
    // If no origin header, try to extract from referer
    if (!originToCheck && req.headers.referer) {
      try {
        const url = new URL(req.headers.referer);
        originToCheck = `${url.protocol}//${url.host}`;
      } catch (e) {
        // Invalid referer URL, skip origin check
        originToCheck = null;
      }
    }
    
    // Allow:
    // - explicitly allowed origins (ARP_ALLOWED_ORIGINS)
    // - same-origin requests (origin host matches request host)
    if (!isOriginAllowed(originToCheck, allowed) && !isSameOrigin(originToCheck, req)) {
      sendJSON(res, 403, { error: "Forbidden origin" });
      return false;
    }
  }

  return true; // Authorized
}
