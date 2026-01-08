// /api/share/create.js
// Generate a share token for read-only access (admin-only endpoint)

export const config = { runtime: 'nodejs' };

import { requireAdmin } from '../../lib/api/requireAdmin.js';
import crypto from 'crypto';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
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

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Admin key gate (only admins can create share tokens)
  // This checks ARP_ADMIN_KEY environment variable
  if (!requireAdmin(req, res, sendJSON)) {
    // requireAdmin already sent error response (401 if key mismatch, 500 if ARP_ADMIN_KEY missing)
    console.error('[Share Create] Admin authentication failed - check ARP_ADMIN_KEY in Vercel and ensure client admin key matches');
    return; // Response already sent
  }

  try {
    // Check if ARP_SHARE_KEY is set
    const shareKey = process.env.ARP_SHARE_KEY;
    if (!shareKey || !String(shareKey).trim()) {
      console.error('[Share Create] ARP_SHARE_KEY is missing or empty');
      console.error('[Share Create] ARP_SHARE_KEY value:', shareKey ? `[${shareKey.length} chars, first 10: ${shareKey.substring(0, 10)}...]` : 'undefined');
      return sendJSON(res, 500, { 
        error: 'ARP_SHARE_KEY environment variable is not set or is empty. Please configure it in Vercel environment variables with a non-empty value.' 
      });
    }
    
    console.log('[Share Create] Both ARP_ADMIN_KEY and ARP_SHARE_KEY are configured');
    
    const { expiryDays = 30 } = req.body || {};

    // Validate expiry (1-90 days)
    const days = Math.max(1, Math.min(90, parseInt(expiryDays) || 30));
    const exp = Math.floor(Date.now() / 1000) + (days * 24 * 60 * 60);

    // Create payload
    const payload = {
      scope: 'read_only',
      exp: exp,
      created: Math.floor(Date.now() / 1000)
    };

    // Encode payload
    let payloadB64;
    try {
      payloadB64 = base64UrlEncode(JSON.stringify(payload));
    } catch (encodeError) {
      console.error('[Share Create] Error encoding payload:', encodeError);
      return sendJSON(res, 500, { error: `Failed to encode payload: ${encodeError.message}` });
    }

    // Create signature
    let signature;
    try {
      signature = crypto
        .createHmac('sha256', shareKey)
        .update(payloadB64)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    } catch (cryptoError) {
      console.error('[Share Create] Error creating signature:', cryptoError);
      return sendJSON(res, 500, { error: `Failed to create signature: ${cryptoError.message}` });
    }

    // Create token
    const token = `${payloadB64}.${signature}`;

    // Get base URL from request
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'ai-geo-audit.vercel.app';
    const baseUrl = `${protocol}://${host}`;
    const shareUrl = `${baseUrl}/a?share=1&st=${token}`;

    return sendJSON(res, 200, {
      shareUrl,
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      expiresInDays: days
    });
  } catch (error) {
    console.error('[Share Create] Unexpected error:', error);
    console.error('[Share Create] Error stack:', error.stack);
    return sendJSON(res, 500, { 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

