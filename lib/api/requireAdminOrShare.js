// lib/api/requireAdminOrShare.js
// Combined auth: admin key OR share token (read-only)

import { requireAdmin } from './requireAdmin.js';
import { requireShareReadOnly } from './requireShareReadOnly.js';

/**
 * Wrapper that checks for admin key OR share token
 * Returns { mode: 'admin' | 'share' | null, authorized: boolean }
 * If not authorized, sends error response and returns { authorized: false }
 */
export function requireAdminOrShare(req, res, sendJSON) {
  // Try admin key first (but don't let it send response if it fails)
  // We need to check admin key without sending response, so we can try share token
  
  // Check admin key manually (same logic as requireAdmin but without sending response)
  const expected = process.env.ARP_ADMIN_KEY;
  if (expected && String(expected).trim()) {
    const provided = req.headers["x-arp-admin-key"] || "";
    if (provided && provided === expected) {
      // Admin key matches - check origin if needed
      const allowed = parseAllowedOrigins();
      if (allowed.length > 0) {
        let originToCheck = req.headers.origin;
        if (!originToCheck && req.headers.referer) {
          try {
            const url = new URL(req.headers.referer);
            originToCheck = `${url.protocol}//${url.host}`;
          } catch (e) {
            originToCheck = null;
          }
        }
        if (!isOriginAllowed(originToCheck, allowed) && !isSameOrigin(originToCheck, req)) {
          sendJSON(res, 403, { error: "Forbidden origin" });
          return { authorized: false };
        }
      }
      // Admin key is valid
      return { mode: 'admin', authorized: true };
    }
  }
  
  // Admin key failed or not provided - try share token
  if (requireShareReadOnly(req, res, sendJSON)) {
    return { mode: 'share', authorized: true };
  }

  // Neither worked - send 401
  sendJSON(res, 401, { error: 'Unauthorized - admin key or share token required' });
  return { authorized: false };
}

// Helper functions from requireAdmin.js
function parseAllowedOrigins() {
  const raw = process.env.ARP_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowed) {
  if (!origin) return false;
  return allowed.includes(origin);
}

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
 * Check if request is in share mode (read-only)
 * Use this in write endpoints to reject share mode
 */
export function isShareMode(req) {
  return req.isShareReadOnly === true;
}

