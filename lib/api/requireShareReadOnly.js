// lib/api/requireShareReadOnly.js
// Share token verification for read-only access

import crypto from 'crypto';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

/**
 * Base64URL encode (URL-safe base64)
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
  // Add padding if needed
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Verify share token and set req.isShareReadOnly if valid
 * Returns true if valid share token, false otherwise
 */
export function requireShareReadOnly(req, res, sendJSON) {
  const shareKey = process.env.ARP_SHARE_KEY;
  if (!shareKey) {
    // Share mode not configured - allow through (will fail later if needed)
    return false;
  }

  // Get token from query param or header
  const token = req.query?.st || req.headers['x-arp-share-token'] || '';
  
  if (!token) {
    return false;
  }

  try {
    // Parse token: <payload>.<signature>
    const parts = token.split('.');
    if (parts.length !== 2) {
      return false;
    }

    const [payloadB64, signatureB64] = parts;
    
    // Decode payload
    const payloadStr = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadStr);

    // Verify expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      sendJSON(res, 401, { error: 'Share token expired' });
      return false;
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', shareKey)
      .update(payloadB64)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    if (signatureB64 !== expectedSignature) {
      return false;
    }

    // Verify scope
    if (payload.scope !== 'read_only') {
      return false;
    }

    // Set flag on request
    req.isShareReadOnly = true;
    req.shareTokenPayload = payload;
    return true;
  } catch (error) {
    console.error('[Share Auth] Token verification error:', error);
    return false;
  }
}

