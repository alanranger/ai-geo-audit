// Convert a Revenue Funnel priority into a tracked Optimisation Task.
//
// POST { priorityId, propertyUrl? }
//   - Reads the priority row
//   - Inserts a matching row in optimisation_tasks + first cycle in
//     optimisation_task_cycles
//   - Links the priority back to the task (optimisation_task_id)
//   - Flips priority.status to 'in_progress'
//
// The created task is a URL-only ("on_page") task targeting the first page in
// pages_affected (or the property root if none). This makes it show up in the
// existing Optimisation Tracking tab where the user can add measurements.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const PLACEHOLDER_USER = '00000000-0000-0000-0000-000000000000';

// Map the priority.primary_kpi to an Optimisation Tracking KPI name.
const KPI_MAP = {
  ctr_28d: 'ctr_28d',
  ai_citations: 'ai_citations',
  money_page_click_share: 'gsc_clicks_28d',
  enquiries: 'gsc_clicks_28d',
  clicks_28d: 'gsc_clicks_28d',
  impressions_28d: 'gsc_impressions_28d',
  rank: 'best_rank_group'
};

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function buildTargetUrl(propertyUrl, pages) {
  const base = propertyUrl.replace(/\/+$/, '');
  if (!Array.isArray(pages) || !pages.length) return base + '/';
  const first = String(pages[0] || '').trim();
  if (!first) return base + '/';
  if (/^https?:\/\//i.test(first)) return first;
  return base + (first.startsWith('/') ? first : `/${first}`);
}

function buildObjective(priority, mappedKpi) {
  if (!mappedKpi) return null;
  return {
    title: priority.title,
    kpi: mappedKpi,
    target: priority.kpi_target_value != null ? Number(priority.kpi_target_value) : null,
    target_type: 'absolute',
    due_at: null,
    plan: priority.description || null
  };
}

async function loadPriority(supabase, id) {
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const err = new Error('priority_not_found');
    err.statusCode = 404;
    throw err;
  }
  return data;
}

async function insertTask(supabase, priority, targetUrl, mappedKpi) {
  const objective = buildObjective(priority, mappedKpi);
  // NOTE: do NOT set `target_url_clean` — it is a generated column on
  // optimisation_tasks and inserts will fail with 428C9 otherwise.
  const row = {
    keyword_text: priority.title.slice(0, 240),
    target_url: targetUrl,
    task_type: 'on_page',
    status: 'in_progress',
    title: priority.title,
    notes: priority.description || null,
    owner_user_id: PLACEHOLDER_USER,
    objective_title: priority.title,
    objective_kpi: mappedKpi,
    objective_metric: mappedKpi,
    objective_direction: priority.kpi_target_direction === 'down' ? 'at_most' : 'at_least',
    objective_target_value: priority.kpi_target_value != null ? Number(priority.kpi_target_value) : null,
    objective_plan: priority.description || null,
    cycle_started_at: new Date().toISOString(),
    started_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('optimisation_tasks')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return { task: data, objective };
}

async function insertCycle(supabase, taskId, priority, objective) {
  const cycle = {
    task_id: taskId,
    cycle_no: 1,
    status: 'in_progress',
    objective_title: priority.title,
    primary_kpi: objective ? objective.kpi : null,
    target_value: priority.kpi_target_value != null ? Number(priority.kpi_target_value) : null,
    target_direction: priority.kpi_target_direction === 'down' ? 'at_most' : 'at_least',
    baseline_value: priority.kpi_baseline_value != null ? Number(priority.kpi_baseline_value) : null,
    hypothesis: priority.description || null,
    plan: priority.description || null,
    objective: objective,
    // Allowed values for objective_status:
    //   not_set | on_track | overdue | met
    // Starting a brand-new cycle has no measurements yet, so we record
    // 'on_track' when we have an objective and 'not_set' otherwise.
    objective_status: objective ? 'on_track' : 'not_set',
    due_at: null,
    start_date: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('optimisation_task_cycles')
    .insert(cycle)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function linkAndActivate(supabase, taskId, cycleId, priorityId) {
  await supabase
    .from('optimisation_tasks')
    .update({ active_cycle_id: cycleId })
    .eq('id', taskId);
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .update({ optimisation_task_id: taskId, status: 'in_progress' })
    .eq('id', priorityId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const body = parseBody(req);
  const priorityId = String(body.priorityId || '').trim();
  if (!priorityId) return send(res, 400, { error: 'priorityId_required' });
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY).trim();

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const priority = await loadPriority(supabase, priorityId);
    if (priority.optimisation_task_id) {
      return send(res, 200, { ok: true, alreadyLinked: true, taskId: priority.optimisation_task_id, priority });
    }
    const targetUrl = buildTargetUrl(propertyUrl, priority.pages_affected);
    const mappedKpi = KPI_MAP[priority.primary_kpi] || null;
    const { task, objective } = await insertTask(supabase, priority, targetUrl, mappedKpi);
    const cycle = await insertCycle(supabase, task.id, priority, objective);
    const updatedPriority = await linkAndActivate(supabase, task.id, cycle.id, priorityId);
    return send(res, 200, { ok: true, taskId: task.id, cycleId: cycle.id, priority: updatedPriority });
  } catch (err) {
    const status = err?.statusCode || 500;
    return send(res, status, { error: 'start_task_failed', message: err?.message || String(err) });
  }
}
