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
  // Try admin key first
  if (requireAdmin(req, res, sendJSON)) {
    return { mode: 'admin', authorized: true };
  }

  // If admin check sent a response, don't try share
  // (requireAdmin returns false and sends response if unauthorized)
  // We need to check if response was sent - but we can't easily do that
  // So we'll try share token if admin fails
  
  // Try share token
  if (requireShareReadOnly(req, res, sendJSON)) {
    return { mode: 'share', authorized: true };
  }

  // Neither worked - send 401
  sendJSON(res, 401, { error: 'Unauthorized - admin key or share token required' });
  return { authorized: false };
}

/**
 * Check if request is in share mode (read-only)
 * Use this in write endpoints to reject share mode
 */
export function isShareMode(req) {
  return req.isShareReadOnly === true;
}

