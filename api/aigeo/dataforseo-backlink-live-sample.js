export const config = { runtime: 'nodejs' };

const DFS_LIVE = 'https://api.dataforseo.com/v3/backlinks/backlinks/live';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function dfsCreds() {
  const login = String(
    process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN || ''
  ).trim();
  const password = String(
    process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD || ''
  ).trim();
  if (!login || !password) return null;
  return { login, password };
}

function authHeader(login, password) {
  return `Basic ${Buffer.from(`${login}:${password}`, 'utf8').toString('base64')}`;
}

function parseBody(req) {
  if (req.method === 'GET') return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function pickTarget(req) {
  const q = req.query || {};
  const b = parseBody(req);
  const raw = String(b.page_url || b.target || q.page_url || q.target || '').trim();
  return raw;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
  }
  const creds = dfsCreds();
  if (!creds) {
    return sendJson(res, 503, {
      status: 'error',
      message: 'DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD not configured.'
    });
  }
  const target = pickTarget(req);
  if (!target) {
    return sendJson(res, 400, {
      status: 'error',
      message: 'Provide page_url or target (full page URL or domain per DataForSEO docs).'
    });
  }
  const limit = Math.min(20, Math.max(1, Number(req.query?.limit) || 5));
  try {
    const task = {
      target,
      mode: 'as_is',
      limit,
      backlinks_status_type: 'live'
    };
    const r = await fetch(DFS_LIVE, {
      method: 'POST',
      headers: {
        Authorization: authHeader(creds.login, creds.password),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([task])
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      return sendJson(res, 502, { status: 'error', message: 'DataForSEO non-JSON response' });
    }
    const top = json?.status_code;
    if (!r.ok || top !== 20000) {
      return sendJson(res, 502, {
        status: 'error',
        message: String(json?.status_message || `DataForSEO ${top}`)
      });
    }
    const t0 = json?.tasks?.[0];
    const sc = t0?.status_code;
    if (sc !== 20000 && String(sc) !== '20000') {
      return sendJson(res, 502, {
        status: 'error',
        message: String(t0?.status_message || `task ${sc}`)
      });
    }
    const resBlock = t0?.result;
    const row0 = Array.isArray(resBlock) && resBlock.length ? resBlock[0] : resBlock;
    const items = Array.isArray(row0?.items) ? row0.items : [];
    const cost = t0?.cost != null ? Number(t0.cost) : null;
    const slice = items.slice(0, limit);
    const rankPreview = slice.map((it) => ({
      url_from: it?.url_from ?? it?.urlFrom ?? null,
      url_to: it?.url_to ?? it?.urlTo ?? null,
      rank: it?.rank ?? null,
      domain_from_rank: it?.domain_from_rank ?? it?.domainFromRank ?? null,
      page_from_rank: it?.page_from_rank ?? it?.pageFromRank ?? null,
      domain_from: it?.domain_from ?? it?.domainFrom ?? null
    }));
    return sendJson(res, 200, {
      status: 'ok',
      data: {
        target,
        limit,
        items_returned: items.length,
        cost,
        rankPreview,
        items: slice
      },
      meta: {
        generatedAt: new Date().toISOString(),
        docs: 'https://docs.dataforseo.com/v3/backlinks-backlinks-live/'
      }
    });
  } catch (e) {
    return sendJson(res, 500, { status: 'error', message: String(e?.message || e) });
  }
}
