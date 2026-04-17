/**
 * Returns the last N audits' ranking_ai_pillar_scores for a given
 * property URL, ordered oldest -> newest. Used by the "AI Visibility
 * Score" hero tile's sparkline on the Keyword Ranking and AI tab.
 *
 * GET /api/supabase/get-ranking-pillar-history
 *   ?propertyUrl=https://www.alanranger.com
 *   &limit=10              (optional, default 10, max 50)
 *
 * Response:
 *   {
 *     status: 'ok',
 *     data: {
 *       audits: [
 *         { auditDate: '2026-04-12T...', pillarScores: {...} },
 *         ...
 *       ]
 *     },
 *     meta: { generatedAt: '...', count: N }
 *   }
 *
 * The endpoint returns audits even if their pillar_scores column is
 * null so the client can draw gaps in the sparkline. If the underlying
 * table is missing (fresh project) the endpoint returns status
 * 'missing_table' so the UI can degrade gracefully.
 */

export const config = { runtime: 'nodejs' };

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function stripProtocol(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function buildCandidateUrls(propertyUrl) {
  const raw = String(propertyUrl || '').trim();
  if (!raw) return [];
  const stripped = stripProtocol(raw);
  const candidates = new Set([raw]);
  candidates.add(`https://${stripped}`);
  candidates.add(`http://${stripped}`);
  candidates.add(stripped);
  const noWww = stripped.replace(/^www\./i, '');
  if (noWww && noWww !== stripped) {
    candidates.add(`https://${noWww}`);
    candidates.add(`http://${noWww}`);
    candidates.add(noWww);
    candidates.add(`https://www.${noWww}`);
    candidates.add(`http://www.${noWww}`);
    candidates.add(`www.${noWww}`);
  }
  return Array.from(candidates);
}

async function fetchAuditsForCandidate(supabaseUrl, supabaseKey, candidate, limit) {
  const baseUrl =
    `${supabaseUrl}/rest/v1/audit_results` +
    `?property_url=eq.${encodeURIComponent(candidate)}` +
    `&order=audit_date.desc` +
    `&limit=${encodeURIComponent(limit)}` +
    `&select=audit_date,ranking_ai_pillar_scores`;

  const resp = await fetch(baseUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });

  if (resp.ok) {
    const rows = await resp.json();
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  }

  const errText = await resp.text().catch(() => '');
  const missingTable = errText.includes('does not exist');
  return { ok: false, errText, missingTable };
}

async function findRowsAcrossCandidates(supabaseUrl, supabaseKey, candidates, limit) {
  let lastError = null;
  for (const candidate of candidates) {
    const result = await fetchAuditsForCandidate(supabaseUrl, supabaseKey, candidate, limit);
    if (result.ok) {
      if (result.rows.length > 0) {
        return { rows: result.rows, missingTable: false, lastError: null };
      }
      continue;
    }
    if (result.missingTable) {
      return { rows: [], missingTable: true, lastError: null };
    }
    lastError = result.errText || 'unknown';
  }
  return { rows: [], missingTable: false, lastError };
}

function parseLimit(raw) {
  const n = raw != null ? Number(raw) : 10;
  const safe = Number.isFinite(n) ? n : 10;
  return Math.min(Math.max(safe, 1), 50);
}

function mapAuditsOldestFirst(rows) {
  return rows
    .map((row) => ({
      auditDate: row.audit_date,
      pillarScores: row.ranking_ai_pillar_scores || null
    }))
    .reverse();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const supabaseUrl = need('SUPABASE_URL');
    const supabaseKey = need('SUPABASE_SERVICE_ROLE_KEY');
    const propertyUrl = req.query.propertyUrl ? String(req.query.propertyUrl) : '';
    if (!propertyUrl) {
      return sendJson(res, 400, { status: 'error', message: 'Missing propertyUrl query param.' });
    }
    const limit = parseLimit(req.query.limit);
    const candidates = buildCandidateUrls(propertyUrl);
    const { rows, missingTable, lastError } = await findRowsAcrossCandidates(
      supabaseUrl, supabaseKey, candidates, limit
    );

    if (missingTable) {
      return sendJson(res, 200, { status: 'missing_table', message: 'audit_results table not found.' });
    }
    if (rows.length === 0 && lastError) {
      return sendJson(res, 500, { status: 'error', message: lastError });
    }

    const audits = mapAuditsOldestFirst(rows);
    return sendJson(res, 200, {
      status: 'ok',
      data: { audits },
      meta: { generatedAt: new Date().toISOString(), count: audits.length }
    });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
