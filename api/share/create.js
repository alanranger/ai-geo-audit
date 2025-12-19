// /api/share/create.js
// Generate a share token for read-only access (admin-only endpoint)

export const config = { runtime: 'nodejs' };

import { requireAdmin } from '../../../lib/api/requireAdmin.js';
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
  if (!requireAdmin(req, res, sendJSON)) {
    return; // Response already sent
  }

  try {
    const shareKey = need('ARP_SHARE_KEY');
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
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));

    // Create signature
    const signature = crypto
      .createHmac('sha256', shareKey)
      .update(payloadB64)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

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
    console.error('[Share Create] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}

