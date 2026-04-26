// /api/aigeo/keyword-alignment-review.js
//
// Read-only diagnostic for aligning:
// - Ranking & AI tracked keywords (latest keyword_rankings audit)
// - Traditional SEO URL target keywords (KE cache + manual overrides)
// - Optimisation keyword tasks

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY_URL = 'https://www.alanranger.com';
const ACTIVE_TASK_STATUSES = new Set(['done', 'cancelled', 'deleted']);

function need(key) {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
}

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
}

function keywordKey(value) {
  return String(value || '').trim().toLowerCase();
}

function displayPath(url) {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.pathname || '/';
  } catch (_err) {
    return String(url || '');
  }
}

function isActiveTask(task) {
  return !ACTIVE_TASK_STATUSES.has(String(task?.status || '').toLowerCase());
}

function addToMapArray(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

async function latestRankingRows(supabase, propertyUrl) {
  const latest = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error && latest.error.code !== 'PGRST116') throw latest.error;
  const auditDate = latest.data?.audit_date || null;
  if (!auditDate) return { auditDate: null, rows: [] };
  const rows = await supabase
    .from('keyword_rankings')
    .select('keyword,best_rank_group,search_volume,ai_alan_citations_count,best_url,page_type,segment')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .limit(2000);
  if (rows.error) throw rows.error;
  return { auditDate, rows: rows.data || [] };
}

async function loadTraditionalSources(supabase, propertyUrl) {
  const cache = await supabase
    .from('keyword_target_metrics_cache')
    .select('page_url,keyword,search_volume')
    .ilike('page_url', '%alanranger.com%')
    .limit(5000);
  if (cache.error) throw cache.error;
  const overrides = await supabase
    .from('traditional_seo_target_keyword_overrides')
    .select('page_url,target_keyword')
    .eq('property_url', propertyUrl)
    .limit(2000);
  if (overrides.error) throw overrides.error;
  return { cacheRows: cache.data || [], overrideRows: overrides.data || [] };
}

async function loadOptimisationTasks(supabase) {
  const tasks = await supabase
    .from('optimisation_tasks')
    .select('id,keyword_text,target_url,status,task_type')
    .limit(2000);
  if (tasks.error) throw tasks.error;
  return tasks.data || [];
}

function buildTraditionalMap(cacheRows, overrideRows) {
  const map = new Map();
  for (const row of cacheRows) {
    const key = keywordKey(row.keyword);
    addToMapArray(map, key, {
      source: 'keyword_metrics_cache',
      keyword: row.keyword,
      page_url: row.page_url,
      search_volume: row.search_volume
    });
  }
  for (const row of overrideRows) {
    const key = keywordKey(row.target_keyword);
    addToMapArray(map, key, {
      source: 'target_keyword_override',
      keyword: row.target_keyword,
      page_url: row.page_url,
      search_volume: null
    });
  }
  return map;
}

function summarizeRankingRows(rows, traditionalMap, taskMap) {
  return rows.map((row) => {
    const key = keywordKey(row.keyword);
    const trad = traditionalMap.get(key) || [];
    const tasks = taskMap.get(key) || [];
    return {
      keyword: row.keyword,
      best_rank_group: row.best_rank_group,
      search_volume: row.search_volume,
      ai_alan_citations_count: row.ai_alan_citations_count,
      best_url: row.best_url,
      page_type: row.page_type,
      segment: row.segment,
      traditional_url_count: new Set(trad.map((r) => r.page_url)).size,
      active_task_count: tasks.filter(isActiveTask).length,
      task_count: tasks.length
    };
  });
}

function summarizeTraditionalOnly(traditionalMap, rankingKeys) {
  const rows = [];
  for (const [key, entries] of traditionalMap.entries()) {
    if (rankingKeys.has(key)) continue;
    const volumes = entries.map((e) => Number(e.search_volume || 0));
    const maxVolume = Math.max(0, ...volumes);
    const urls = [...new Set(entries.map((e) => e.page_url).filter(Boolean))];
    rows.push({
      keyword: entries[0]?.keyword || key,
      url_count: urls.length,
      max_search_volume: maxVolume,
      sample_urls: urls.slice(0, 5).map(displayPath),
      recommendation: recommendTraditionalOnly(key, maxVolume, urls)
    });
  }
  rows.sort((a, b) => b.max_search_volume - a.max_search_volume || b.url_count - a.url_count);
  return rows;
}

function recommendTraditionalOnly(key, volume, urls) {
  const urlText = urls.join(' ').toLowerCase();
  const commercial = /(course|courses|workshop|workshops|classes|lessons|tuition|training|mentoring|masterclass|photographer|commercial|headshot|gift|voucher)/.test(`${key} ${urlText}`);
  const internal = /^(login|help|upgrade|privacy policy|terms and conditions|contact us|gallery|case study)$/.test(key);
  if (internal) return 'traditional_only_internal_or_generic';
  if (commercial && volume >= 50) return 'review_for_ranking_ai';
  if (commercial) return 'traditional_only_unless_priority_page';
  return 'traditional_only';
}

function summarizeTaskAlignment(tasks, rankingKeys, traditionalMap) {
  return tasks
    .filter((task) => keywordKey(task.keyword_text))
    .map((task) => {
      const key = keywordKey(task.keyword_text);
      const inRanking = rankingKeys.has(key);
      return {
        id: task.id,
        keyword: task.keyword_text,
        status: task.status,
        task_type: task.task_type,
        active: isActiveTask(task),
        in_ranking_ai: inRanking,
        in_traditional_seo: traditionalMap.has(key),
        recommendation: inRanking ? 'ok' : 'do_not_measure_until_tracked'
      };
    });
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', error: 'Method not allowed. Expected GET.' });
  }

  try {
    const propertyUrl = String(req.query.propertyUrl || DEFAULT_PROPERTY_URL).trim();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const [{ auditDate, rows: rankingRows }, traditional, tasks] = await Promise.all([
      latestRankingRows(supabase, propertyUrl),
      loadTraditionalSources(supabase, propertyUrl),
      loadOptimisationTasks(supabase)
    ]);

    const traditionalMap = buildTraditionalMap(traditional.cacheRows, traditional.overrideRows);
    const taskMap = new Map();
    for (const task of tasks) addToMapArray(taskMap, keywordKey(task.keyword_text), task);

    const rankingKeys = new Set(rankingRows.map((row) => keywordKey(row.keyword)).filter(Boolean));
    const ranking = summarizeRankingRows(rankingRows, traditionalMap, taskMap);
    const traditionalOnly = summarizeTraditionalOnly(traditionalMap, rankingKeys);
    const taskAlignment = summarizeTaskAlignment(tasks, rankingKeys, traditionalMap);

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        property_url: propertyUrl,
        latest_ranking_audit_date: auditDate,
        summary: {
          ranking_ai_keywords: rankingRows.length,
          traditional_distinct_keywords: traditionalMap.size,
          traditional_keywords_in_ranking_ai: countWhere([...traditionalMap.keys()], (key) => rankingKeys.has(key)),
          traditional_keywords_not_in_ranking_ai: countWhere([...traditionalMap.keys()], (key) => !rankingKeys.has(key)),
          optimisation_keyword_tasks: taskAlignment.length,
          active_optimisation_keyword_tasks: countWhere(taskAlignment, (task) => task.active),
          active_tasks_in_ranking_ai: countWhere(taskAlignment, (task) => task.active && task.in_ranking_ai),
          active_tasks_not_in_ranking_ai: countWhere(taskAlignment, (task) => task.active && !task.in_ranking_ai)
        },
        ranking,
        traditional_only: traditionalOnly.slice(0, 300),
        optimisation_tasks: taskAlignment
      },
      meta: { generated_at: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[keyword-alignment-review] Error:', error);
    return sendJson(res, 500, { status: 'error', error: error.message || String(error) });
  }
}
