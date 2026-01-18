export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { computeAiMetricsForPageUrl } from '../../lib/optimisation/aiMetrics.js';
import { normalizeUrlForMatching } from '../../lib/audit/moneyPages.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
  res.status(status).send(JSON.stringify(obj));
};

const normalizeKeyword = (value) => String(value || '').trim().toLowerCase();

const findKeywordRow = (combinedRows, keyword) => {
  const target = normalizeKeyword(keyword);
  return combinedRows.find((row) => normalizeKeyword(row?.keyword) === target);
};

const findQueryTotals = (queryTotals, keyword) => {
  const target = normalizeKeyword(keyword);
  return queryTotals.find((qt) => normalizeKeyword(qt?.query || qt?.keyword) === target);
};

const findMoneyPageRow = (moneyPagesMetrics, url) => {
  if (!moneyPagesMetrics?.rows || !url) return null;
  const target = normalizeUrlForMatching(url);
  return moneyPagesMetrics.rows.find((row) => {
    const rowUrl = row?.url || row?.page_url || row?.page || '';
    return normalizeUrlForMatching(rowUrl) === target;
  }) || null;
};

const buildKeywordMetrics = (keyword, combinedRows, queryTotals) => {
  const row = findKeywordRow(combinedRows, keyword) || null;
  const queryTotal = findQueryTotals(queryTotals, keyword) || null;

  const ctrValue = queryTotal?.ctr;
  const gscCtr = Number.isFinite(ctrValue) ? (ctrValue / 100) : null;

  return {
    gsc_clicks_28d: queryTotal?.clicks ?? null,
    gsc_impressions_28d: queryTotal?.impressions ?? null,
    gsc_ctr_28d: gscCtr,
    current_rank: row?.best_rank_group ?? row?.best_rank_absolute ?? null,
    opportunity_score: row?.opportunity_score ?? null,
    ai_overview: Boolean(row?.has_ai_overview || row?.ai_overview_present_any),
    ai_citations: row?.ai_alan_citations_count
      ?? (Array.isArray(row?.ai_alan_citations) ? row.ai_alan_citations.length : null),
    ai_citations_total: row?.ai_total_citations ?? null,
    classic_ranking_url: row?.best_url ?? null,
    page_type: row?.page_type ?? row?.pageType ?? null,
    segment: row?.segment ?? null,
    captured_at: new Date().toISOString()
  };
};

const buildUrlMetrics = (url, combinedRows, moneyPagesMetrics) => {
  const row = findMoneyPageRow(moneyPagesMetrics, url);
  let ctr = row?.ctr ?? row?.ctr_28d ?? null;
  if (ctr != null && ctr > 1) ctr = ctr / 100;
  const ai = computeAiMetricsForPageUrl(url, combinedRows);

  return {
    gsc_clicks_28d: row?.clicks ?? row?.clicks_28d ?? null,
    gsc_impressions_28d: row?.impressions ?? row?.impressions_28d ?? null,
    gsc_ctr_28d: ctr,
    current_rank: row?.avgPosition ?? row?.position ?? null,
    ai_overview: ai.ai_overview,
    ai_citations: ai.ai_citations,
    captured_at: new Date().toISOString()
  };
};

const shouldSkipMeasurement = async (supabase, taskId) => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recentMeasurement } = await supabase
    .from('optimisation_task_events')
    .select('id')
    .eq('task_id', taskId)
    .eq('event_type', 'measurement')
    .gte('created_at', fiveMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return Boolean(recentMeasurement);
};

const getLatestAuditData = async (supabase, propertyUrl) => {
  const { data: latestAudit } = await supabase
    .from('audit_results')
    .select('search_data, ranking_ai_data, scores, money_pages_metrics, audit_date, property_url')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const searchData = latestAudit?.search_data || latestAudit?.searchData || {};
  const queryTotals = Array.isArray(searchData?.queryTotals) ? searchData.queryTotals : [];
  const rankingAiData = latestAudit?.ranking_ai_data || {};
  let combinedRows = [];
  if (Array.isArray(rankingAiData?.combinedRows)) {
    combinedRows = rankingAiData.combinedRows;
  } else if (Array.isArray(rankingAiData?.combined_rows)) {
    combinedRows = rankingAiData.combined_rows;
  }

  const moneyPagesMetrics =
    latestAudit?.scores?.moneyPagesMetrics ||
    latestAudit?.money_pages_metrics ||
    latestAudit?.moneyPagesMetrics ||
    null;

  return { queryTotals, combinedRows, moneyPagesMetrics };
};

const loadTasks = async (supabase) => {
  const { data: tasks, error: tasksError } = await supabase
    .from('optimisation_tasks')
    .select('id, keyword_text, target_url, target_url_clean, active_cycle_id, cycle_active, status, owner_user_id, is_test_task')
    .neq('status', 'deleted');

  if (tasksError) {
    throw new Error(tasksError.message);
  }

  return tasks || [];
};

const buildMetricsForTask = (task, combinedRows, queryTotals, moneyPagesMetrics) => {
  const keyword = String(task.keyword_text || '').trim();
  if (keyword.length > 0) {
    return buildKeywordMetrics(keyword, combinedRows, queryTotals);
  }

  const url = task.target_url_clean || task.target_url || null;
  if (!url) return null;

  return buildUrlMetrics(url, combinedRows, moneyPagesMetrics);
};

const insertMeasurement = async (supabase, task, metrics) => {
  const { error } = await supabase
    .from('optimisation_task_events')
    .insert({
      task_id: task.id,
      event_type: 'measurement',
      note: 'Latest measurement captured (cron)',
      is_baseline: false,
      cycle_id: task.active_cycle_id || null,
      cycle_number: task.cycle_active || null,
      metrics,
      owner_user_id: task.owner_user_id || null
    });

  return error;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { status: 'error', message: 'Method not allowed. Use POST.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'];
  if (cronSecret && requestSecret !== cronSecret) {
    return sendJSON(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request'
    });
  }

  try {
    const propertyUrl = req.query?.propertyUrl || req.body?.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { queryTotals, combinedRows, moneyPagesMetrics } = await getLatestAuditData(supabase, propertyUrl);
    const tasks = await loadTasks(supabase);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const task of tasks) {
      if (task.is_test_task) {
        skipped += 1;
        continue;
      }
      if (await shouldSkipMeasurement(supabase, task.id)) {
        skipped += 1;
        continue;
      }
      const metrics = buildMetricsForTask(task, combinedRows, queryTotals, moneyPagesMetrics);

      if (!metrics) {
        skipped += 1;
        continue;
      }

      const insertError = await insertMeasurement(supabase, task, metrics);

      if (insertError) {
        failed += 1;
      } else {
        updated += 1;
      }
    }

    return sendJSON(res, 200, {
      status: 'ok',
      message: 'Bulk task update completed',
      data: {
        updated,
        skipped,
        failed
      }
    });
  } catch (err) {
    return sendJSON(res, 500, { status: 'error', message: err.message });
  }
}
