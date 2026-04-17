/**
 * Get previous audit's Ranking & AI pillar percentages.
 * Returns the prior audit row's saved ranking_ai_data.summary.pillar_scores.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const { propertyUrl, currentAuditDate } = req.query || {};
    if (!propertyUrl || !currentAuditDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required query params: propertyUrl, currentAuditDate'
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase credentials are not configured.'
      });
    }

    const normalizePropertyUrl = (value) => {
      if (!value || typeof value !== 'string') return null;
      let raw = value.trim();
      if (!raw) return null;
      try {
        if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
        const url = new URL(raw);
        return `${url.protocol}//${url.hostname}`;
      } catch {
        return raw;
      }
    };

    const buildPropertyUrlCandidates = (value) => {
      const normalized = normalizePropertyUrl(value);
      if (!normalized) return [];
      const url = new URL(normalized);
      const candidates = [normalized];
      if (url.hostname.startsWith('www.')) {
        const alt = new URL(normalized);
        alt.hostname = url.hostname.replace(/^www\./, '');
        candidates.push(alt.origin);
      } else {
        const alt = new URL(normalized);
        alt.hostname = `www.${url.hostname}`;
        candidates.push(alt.origin);
      }
      return [...new Set(candidates)];
    };

    const parseJson = (value) => {
      if (!value) return null;
      if (typeof value === 'object') return value;
      if (typeof value !== 'string') return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    };

    const authHeaders = {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    };

    let previousRow = null;
    const candidates = buildPropertyUrlCandidates(propertyUrl);
    for (const candidate of candidates) {
      const previousUrl =
        `${supabaseUrl}/rest/v1/audit_results` +
        `?property_url=eq.${encodeURIComponent(candidate)}` +
        `&audit_date=lt.${encodeURIComponent(currentAuditDate)}` +
        `&order=audit_date.desc` +
        `&limit=1` +
        `&select=audit_date,ranking_ai_data`;

      const response = await fetch(previousUrl, { method: 'GET', headers: authHeaders });
      if (!response.ok) continue;
      const rows = await response.json();
      if (Array.isArray(rows) && rows.length > 0) {
        previousRow = rows[0];
        break;
      }
    }

    if (!previousRow) {
      return res.status(200).json({ status: 'ok', data: null });
    }

    const rankingAiData = parseJson(previousRow.ranking_ai_data);
    const summary = rankingAiData?.summary || null;
    const pillarScores = summary?.pillar_scores || summary?.pillarScores || null;

    return res.status(200).json({
      status: 'ok',
      data: {
        auditDate: previousRow.audit_date || null,
        pillarScores: pillarScores || null
      }
    });
  } catch (error) {
    console.error('[get-previous-ranking-pillars] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error?.message || String(error)
    });
  }
}

