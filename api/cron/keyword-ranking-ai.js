import { classifyKeywordSegment } from '../../lib/segment/classifyKeywordSegment.js';
import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
};

const normalizeKeyword = (value) => String(value || '').trim().toLowerCase();

const getSchedule = async (baseUrl) => {
  const scheduleResp = await fetchJson(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=ranking_ai`);
  return scheduleResp?.data?.jobs?.ranking_ai || { frequency: 'daily', timeOfDay: '11:10' };
};

const getKeywords = async (baseUrl) => {
  const keywordsResp = await fetchJson(`${baseUrl}/api/keywords/get`);
  return (keywordsResp?.keywords || keywordsResp?.data || []).map(String).filter(Boolean);
};

const splitIntoBatches = (keywords, size) => {
  const batches = [];
  for (let i = 0; i < keywords.length; i += size) {
    batches.push(keywords.slice(i, i + size));
  }
  return batches;
};

const runBatches = async (items, batchSize, handler, concurrency = 2) => {
  const batches = splitIntoBatches(items, batchSize);
  const results = [];
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, batches.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < batches.length) {
      const currentIndex = index;
      index += 1;
      const batch = batches[currentIndex];
      const batchResult = await handler(batch);
      if (Array.isArray(batchResult) && batchResult.length > 0) {
        results.push(...batchResult);
      }
    }
  });

  await Promise.all(workers);
  return results;
};

const fetchSerpRows = async (baseUrl, keywords) => runBatches(
  keywords,
  20,
  async (batch) => {
    const serpResp = await fetchJson(
      `${baseUrl}/api/aigeo/serp-rank-test?keywords=${encodeURIComponent(batch.join(','))}`
    );
    return Array.isArray(serpResp?.per_keyword) ? serpResp.per_keyword : [];
  }
);

const fetchAiRows = async (baseUrl, keywords) => runBatches(
  keywords,
  10,
  async (batch) => {
    const aiResp = await fetchJson(`${baseUrl}/api/aigeo/ai-mode-serp-batch-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: batch })
    });
    return Array.isArray(aiResp?.per_query) ? aiResp.per_query : [];
  }
);

const buildCombinedRows = (serpRows, aiRows) => {
  const aiMap = new Map(aiRows.map(row => [normalizeKeyword(row?.query), row]));
  return serpRows.map((row) => {
    const keyword = row?.keyword || '';
    const ai = aiMap.get(normalizeKeyword(keyword)) || {};
    const segmentInfo = classifyKeywordSegment({
      keyword,
      pageType: row?.page_type || row?.pageType || null,
      rankingUrl: row?.best_url || null
    });
    return {
      keyword,
      segment: segmentInfo.segment,
      segment_source: 'auto',
      segment_confidence: segmentInfo.confidence,
      segment_reason: segmentInfo.reason,
      best_rank_group: row?.best_rank_group ?? null,
      best_rank_absolute: row?.best_rank_absolute ?? null,
      best_url: row?.best_url || null,
      best_title: row?.best_title || null,
      has_ai_overview: Boolean(row?.has_ai_overview || ai?.has_ai_overview),
      ai_total_citations: ai?.total_citations ?? 0,
      ai_alan_citations_count: ai?.alanranger_citations_count ?? 0,
      ai_alan_citations: ai?.alanranger_citations || [],
      ai_sample_citations: ai?.sample_citations || [],
      serp_features: row?.serp_features || null,
      ai_overview_present_any: row?.ai_overview_present_any ?? row?.has_ai_overview ?? false,
      local_pack_present_any: row?.local_pack_present_any ?? false,
      paa_present_any: row?.paa_present_any ?? false,
      featured_snippet_present_any: row?.featured_snippet_present_any ?? false,
      search_volume: row?.search_volume ?? null,
      search_volume_trend: row?.search_volume_trend ?? null
    };
  });
};

const buildSummary = (combinedRows) => ({
  total_keywords: combinedRows.length,
  keywords_with_rank: combinedRows.filter(r => r.best_rank_group !== null && r.best_rank_group !== undefined).length,
  keywords_with_ai_overview: combinedRows.filter(r => r.has_ai_overview).length,
  keywords_where_alanranger_cited: combinedRows.filter(r => r.ai_alan_citations_count > 0).length,
  keywords_top_3: combinedRows.filter(r => r.best_rank_group !== null && r.best_rank_group <= 3).length,
  keywords_top_10: combinedRows.filter(r => r.best_rank_group !== null && r.best_rank_group <= 10).length
});

const buildKeywordRows = (combinedRows, auditDate, propertyUrl) => combinedRows.map((row) => ({
  audit_date: auditDate,
  property_url: propertyUrl,
  keyword: row.keyword,
  segment: row.segment,
  segment_source: row.segment_source,
  segment_confidence: row.segment_confidence,
  segment_reason: row.segment_reason,
  best_rank_group: row.best_rank_group,
  best_rank_absolute: row.best_rank_absolute,
  best_url: row.best_url,
  best_title: row.best_title,
  has_ai_overview: row.has_ai_overview,
  ai_total_citations: row.ai_total_citations,
  ai_alan_citations_count: row.ai_alan_citations_count,
  ai_alan_citations: row.ai_alan_citations,
  ai_sample_citations: row.ai_sample_citations,
  serp_features: row.serp_features,
  ai_overview_present_any: row.ai_overview_present_any,
  local_pack_present_any: row.local_pack_present_any,
  paa_present_any: row.paa_present_any,
  featured_snippet_present_any: row.featured_snippet_present_any,
  search_volume: row.search_volume,
  search_volume_trend: row.search_volume_trend
}));

const saveKeywordBatch = async (baseUrl, payload) => {
  await fetchJson(`${baseUrl}/api/supabase/save-keyword-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

const upsertAuditResults = async (payload) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;
  await fetchJson(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });
};

const updateSchedule = async (baseUrl, schedule, nowIso, status, errorMessage = null) => {
  const nextRunAt = computeNextRunAt({
    frequency: schedule.frequency,
    timeOfDay: schedule.timeOfDay,
    lastRunAt: nowIso
  });
  await fetchJson(`${baseUrl}/api/supabase/save-cron-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: {
        ranking_ai: {
          frequency: schedule.frequency,
          timeOfDay: schedule.timeOfDay,
          lastRunAt: nowIso,
          nextRunAt,
          lastStatus: status,
          lastError: errorMessage
        }
      }
    })
  });
};


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

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return sendJson(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const forceRun = req.query.force === '1' || req.query.force === 'true';

  try {
    const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
    const fallbackBaseUrl = req.headers.host
      ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
      : 'http://localhost:3000';
    const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
    const nowIso = new Date().toISOString();

    const schedule = await getSchedule(baseUrl);

    if (!forceRun && !shouldRunNow(schedule)) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'Schedule not due.',
        schedule,
        meta: { generatedAt: nowIso }
      });
    }

    const keywords = await getKeywords(baseUrl);
    if (!keywords.length) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'No keywords found.',
        meta: { generatedAt: nowIso }
      });
    }

    const serpRows = await fetchSerpRows(baseUrl, keywords);
    const aiRows = await fetchAiRows(baseUrl, keywords);
    const combinedRows = buildCombinedRows(serpRows, aiRows);

    const auditDate = new Date().toISOString().slice(0, 10);
    const summary = buildSummary(combinedRows);
    const keywordRows = buildKeywordRows(combinedRows, auditDate, propertyUrl);

    await saveKeywordBatch(baseUrl, { propertyUrl, auditDate, keywords: keywordRows });
    await upsertAuditResults({
      property_url: propertyUrl,
      audit_date: auditDate,
      ranking_ai_data: { summary, combinedRows, lastRunTimestamp: nowIso },
      updated_at: nowIso,
      timestamp: nowIso
    });
    await updateSchedule(baseUrl, schedule, nowIso, 'ok');

    return sendJson(res, 200, {
      status: 'ok',
      message: 'Keyword ranking & AI audit complete.',
      summary,
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    try {
      const fallbackBaseUrl = req.headers.host
        ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
        : 'http://localhost:3000';
      const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
      const nowIso = new Date().toISOString();
      const schedule = await getSchedule(baseUrl);
      await updateSchedule(baseUrl, schedule, nowIso, 'error', err.message);
    } catch (error_) {
      console.warn('[Keyword Ranking Cron] Failed to update schedule status:', error_.message);
    }
    console.error('[Keyword Ranking Cron] Error:', err.message);
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
