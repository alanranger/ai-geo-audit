export const config = { runtime: 'nodejs', maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function normalizeSiteUrlForInspect(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('sc-domain:')) return s;
  let u = s;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  return `${u}/`;
}

async function getAccessToken() {
  const clientId = need('GOOGLE_CLIENT_ID');
  const clientSecret = need('GOOGLE_CLIENT_SECRET');
  const refreshToken = need('GOOGLE_REFRESH_TOKEN');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    const err = new Error(`token_refresh_failed:${tokenResponse.status}`);
    err.detail = tokenData;
    throw err;
  }
  return tokenData.access_token;
}

async function inspectOne(accessToken, siteUrl, inspectionUrl) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
      languageCode: 'en-GB',
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  const idx = json?.inspectionResult?.indexStatusResult;
  return {
    inspectionUrl,
    httpOk: res.ok,
    httpStatus: res.status,
    verdict: idx?.verdict ?? null,
    coverageState: idx?.coverageState ?? null,
    pageFetchState: idx?.pageFetchState ?? null,
    googleCanonical: idx?.googleCanonical ?? null,
    error: json?.error || (!res.ok ? json : null),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed.' });
  }
  try {
    const body = req.body || {};
    const propertyUrl = String(body.propertyUrl || '').trim();
    const urls = Array.isArray(body.urls) ? body.urls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    const max = 12;
    if (!propertyUrl) {
      return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
    }
    if (!urls.length) {
      return sendJson(res, 400, { status: 'error', message: 'urls must be a non-empty array.' });
    }
    if (urls.length > max) {
      return sendJson(res, 400, {
        status: 'error',
        message: `Too many URLs in one request (max ${max}).`,
      });
    }
    const siteUrl = normalizeSiteUrlForInspect(propertyUrl);
    if (!siteUrl) {
      return sendJson(res, 400, { status: 'error', message: 'Invalid propertyUrl.' });
    }
    const accessToken = await getAccessToken();
    const results = [];
    const delayMs = 280;
    for (let i = 0; i < urls.length; i += 1) {
      const inspectionUrl = urls[i];
      const row = await inspectOne(accessToken, siteUrl, inspectionUrl);
      results.push(row);
      if (i < urls.length - 1) await sleep(delayMs);
    }
    return sendJson(res, 200, {
      status: 'ok',
      siteUrl,
      results,
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.startsWith('missing_env:')) {
      return sendJson(res, 500, {
        status: 'error',
        message: 'Google OAuth is not configured on the server (GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN).',
      });
    }
    if (msg.startsWith('token_refresh_failed:')) {
      return sendJson(res, 401, {
        status: 'error',
        message: 'Google token refresh failed — re-authorise Search Console OAuth.',
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
