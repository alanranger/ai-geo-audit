// /api/optimisation/dashboard.js
// Dashboard summary API - returns enriched tasks, tiles, impact, and timeseries

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare } from '../../lib/api/requireAdminOrShare.js';
import { KPI_METADATA } from '../../lib/optimisation/objectiveSchema.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

// KPI map for extracting values from measurements
// Handles both gsc_ prefixed fields (from baseline measurements) and regular fields
const KPI_EXTRACTORS = {
  clicks_28d: (m) => m?.gsc_clicks_28d ?? m?.clicks_28d ?? null,
  impressions_28d: (m) => m?.gsc_impressions_28d ?? m?.impressions_28d ?? null,
  ctr_28d: (m) => m?.gsc_ctr_28d ?? m?.ctr_28d ?? null,
  current_rank: (m) => m?.gsc_position_28d ?? m?.current_rank ?? m?.rank ?? null,
  opportunity_score: (m) => m?.opportunity_score ?? null,
  ai_overview: (m) => m?.ai_overview ?? null,
  ai_citations: (m) => m?.ai_citations ?? null,
};

// Compute RAG status
function computeRAGStatus(objective, baselineValue, latestValue, dueAt, now) {
  if (!objective || !objective.kpi) {
    return 'no_data';
  }

  const kpiMeta = KPI_METADATA[objective.kpi];
  if (!kpiMeta) {
    return 'no_data';
  }

  // Check if we have baseline and latest
  if (baselineValue == null || latestValue == null) {
    return 'no_data';
  }

  // Calculate delta (improvement direction)
  let delta = null;
  if (kpiMeta.direction === 'higher_better') {
    delta = latestValue - baselineValue;
  } else if (kpiMeta.direction === 'lower_better') {
    delta = baselineValue - latestValue;
  } else if (kpiMeta.direction === 'boolean_true_better') {
    const baselineNum = baselineValue ? 1 : 0;
    const latestNum = latestValue ? 1 : 0;
    delta = latestNum - baselineNum;
  }

  // Check if target is met
  let isMet = false;
  if (objective.target_type === 'delta') {
    if (delta != null) {
      isMet = delta >= objective.target;
    }
  } else {
    // Absolute target
    if (latestValue != null) {
      if (kpiMeta.direction === 'higher_better') {
        isMet = latestValue >= objective.target;
      } else if (kpiMeta.direction === 'lower_better') {
        isMet = latestValue <= objective.target;
      } else if (kpiMeta.direction === 'boolean_true_better') {
        isMet = latestValue === true;
      }
    }
  }

  // Check overdue
  if (dueAt) {
    const dueDate = new Date(dueAt);
    if (now > dueDate && !isMet) {
      return 'overdue';
    }
    // Check at risk (due within 7 days)
    const daysUntilDue = (dueDate - now) / (1000 * 60 * 60 * 24);
    if (daysUntilDue <= 7 && daysUntilDue > 0 && !isMet) {
      return 'at_risk';
    }
  }

  if (isMet) {
    return 'on_track'; // Met is also "on track" for display
  }

  return 'on_track';
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Admin key OR share token (read-only allowed)
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
    return; // Response already sent
  }
  
  // Get scope parameter (default: active_cycle)
  const scope = req.query.scope || 'active_cycle';

  try {
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get current user from auth header if available
    const authHeader = req.headers.authorization;
    let userId = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }

    // Fetch all tasks
    let query = supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .order('last_activity_at', { ascending: false });

    if (userId) {
      query = query.eq('owner_user_id', userId);
    }

    const { data: tasks, error: tasksError } = await query;

    if (tasksError) {
      console.error('[Dashboard] Tasks query error:', tasksError);
      return sendJSON(res, 500, { error: tasksError.message });
    }

    if (!tasks || tasks.length === 0) {
      return sendJSON(res, 200, {
        tasks: [],
        tiles: {
          ctr: { on_track: 0, at_risk: 0, overdue: 0 },
          rank: { improved: 0, worse: 0, flat: 0 },
          ai_gap: 0,
          needs_measurement: 0,
          overdue_cycles: 0,
        },
        impact: {
          estimated_extra_clicks: 0,
          ai_citation_gap: 0,
        },
        timeseries: {
          measurementsPerWeek: [],
          medianDeltaByKpi: [],
        },
      });
    }

    const taskIds = tasks.map(t => t.id).filter(Boolean);
    
    // Fetch is_test_task flags for all tasks
    const { data: taskFlags, error: flagsError } = await supabase
      .from('optimisation_tasks')
      .select('id, is_test_task')
      .in('id', taskIds);
    
    const testTaskMap = new Map();
    if (taskFlags && !flagsError) {
      taskFlags.forEach(t => {
        testTaskMap.set(t.id, t.is_test_task || false);
      });
    }

    // Fetch all measurement events for these tasks (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoIso = ninetyDaysAgo.toISOString();

    const { data: events, error: eventsError } = await supabase
      .from('optimisation_task_events')
      .select('task_id, cycle_id, cycle_number, created_at, metrics, is_baseline')
      .eq('event_type', 'measurement')
      .in('task_id', taskIds)
      .gte('created_at', ninetyDaysAgoIso)
      .order('created_at', { ascending: false });

    if (eventsError) {
      console.error('[Dashboard] Events query error:', eventsError);
      // Continue without events
    }

    // Group events by task_id
    const eventsByTask = new Map();
    if (events) {
      for (const e of events) {
        if (!eventsByTask.has(e.task_id)) {
          eventsByTask.set(e.task_id, []);
        }
        eventsByTask.get(e.task_id).push(e);
      }
    }

    // Fetch active cycles with objectives
    const { data: cycles, error: cyclesError } = await supabase
      .from('optimisation_task_cycles')
      .select('task_id, id, cycle_no, objective, objective_status, objective_progress, due_at, start_date')
      .in('task_id', taskIds)
      .not('objective', 'is', null);

    if (cyclesError) {
      console.error('[Dashboard] Cycles query error:', cyclesError);
    }

    // Map cycles by task_id
    const cyclesByTask = new Map();
    if (cycles) {
      for (const c of cycles) {
        if (!cyclesByTask.has(c.task_id)) {
          cyclesByTask.set(c.task_id, []);
        }
        cyclesByTask.get(c.task_id).push(c);
      }
    }

    const now = new Date();
    const enrichedTasks = [];
    const tileCounts = {
      ctr: { on_track: 0, at_risk: 0, overdue: 0 },
      rank: { improved: 0, worse: 0, flat: 0 },
      ai_gap: 0,
      needs_measurement: 0,
      overdue_cycles: 0,
    };
    const impactTotals = {
      estimated_extra_clicks: 0,
      ai_citation_gap: 0,
    };

    // Process each task
    for (const task of tasks) {
      const taskEvents = eventsByTask.get(task.id) || [];
      const taskCycles = cyclesByTask.get(task.id) || [];
      
      // Find active cycle based on scope
      let activeCycle = null;
      if (scope === 'active_cycle') {
        // For active cycle scope, only use the current active cycle
        activeCycle = taskCycles.find(c => c.id === task.active_cycle_id) || 
                     taskCycles.find(c => c.cycle_no === task.cycle_active) ||
                     (taskCycles.length > 0 ? taskCycles.sort((a, b) => b.cycle_no - a.cycle_no).find(c => 
                       c.objective_status !== 'archived' && c.objective_status !== 'completed'
                     ) : null);
      } else {
        // For all_tasks scope, use the most recent cycle with objective
        activeCycle = taskCycles.length > 0 
          ? taskCycles.sort((a, b) => b.cycle_no - a.cycle_no)[0]
          : null;
      }

      // Filter events for active cycle (or all events if scope is all_tasks and no cycle)
      const cycleEvents = activeCycle
        ? taskEvents.filter(e => 
            (e.cycle_id && e.cycle_id === activeCycle.id) ||
            (e.cycle_number && e.cycle_number === activeCycle.cycle_no)
          )
        : (scope === 'all_tasks' ? taskEvents : []);

      // Sort cycle events by date (ascending for baseline/latest, descending for sparkline)
      cycleEvents.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      // Get baseline and latest measurements
      let baselineMeasurement = null;
      let latestMeasurement = null;
      let baselineEvent = null;
      if (cycleEvents.length > 0) {
        // Baseline: prefer the most recent baseline marker (supports rebaselining); fallback to first measurement.
        const baselineCandidates = cycleEvents.filter(e => e && e.is_baseline === true && e.metrics);
        baselineEvent = baselineCandidates.length > 0
          ? baselineCandidates[baselineCandidates.length - 1]
          : cycleEvents[0];

        if (baselineEvent && baselineEvent.metrics) {
          baselineMeasurement = baselineEvent.metrics;
        }
        
        // Latest is always the most recent measurement
        latestMeasurement = cycleEvents[cycleEvents.length - 1].metrics;
      }

      // Extract objective KPI values
      let objectiveKpiKey = null;
      let baselineValue = null;
      let latestValue = null;
      let delta = null;
      let objectiveRag = 'no_data';
      let dueAt = null;

      if (activeCycle && activeCycle.objective) {
        objectiveKpiKey = activeCycle.objective.kpi;
        const extractor = KPI_EXTRACTORS[objectiveKpiKey];
        if (extractor) {
          baselineValue = extractor(baselineMeasurement);
          latestValue = extractor(latestMeasurement);
          
          // Calculate delta
          if (baselineValue != null && latestValue != null) {
            const kpiMeta = KPI_METADATA[objectiveKpiKey];
            if (kpiMeta) {
              if (kpiMeta.direction === 'higher_better') {
                delta = latestValue - baselineValue;
              } else if (kpiMeta.direction === 'lower_better') {
                delta = baselineValue - latestValue;
              } else if (kpiMeta.direction === 'boolean_true_better') {
                const baselineNum = baselineValue ? 1 : 0;
                const latestNum = latestValue ? 1 : 0;
                delta = latestNum - baselineNum;
              }
            }
          }

          dueAt = activeCycle.due_at;
          objectiveRag = computeRAGStatus(
            activeCycle.objective,
            baselineValue,
            latestValue,
            dueAt,
            now
          );
        }
      }

      // Check if needs measurement (>30 days or missing)
      // Use latest_metrics.captured_at or cycle event created_at
      let lastMeasuredAt = null;
      if (cycleEvents.length > 0) {
        lastMeasuredAt = cycleEvents[cycleEvents.length - 1].created_at;
      } else if (task.latest_metrics?.captured_at) {
        lastMeasuredAt = task.latest_metrics.captured_at;
      }
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const needsMeasurement = !lastMeasuredAt || new Date(lastMeasuredAt) < thirtyDaysAgo;
      if (needsMeasurement) {
        tileCounts.needs_measurement++;
      }

      // Calculate "due in" days
      let dueIn = null;
      if (dueAt) {
        const dueDate = new Date(dueAt);
        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        if (daysUntilDue < 0) {
          dueIn = `Overdue ${Math.abs(daysUntilDue)}d`;
        } else {
          dueIn = `${daysUntilDue}d`;
        }
      }

      // Generate sparkline points (last 10 measurements for objective KPI)
      const sparklinePoints = [];
      if (objectiveKpiKey && cycleEvents.length > 0) {
        const extractor = KPI_EXTRACTORS[objectiveKpiKey];
        if (extractor) {
          const points = cycleEvents
            .slice(-10) // Last 10
            .map(e => extractor(e.metrics))
            .filter(v => v != null);
          sparklinePoints.push(...points);
        }
      }

      // Update tile counts
      if (objectiveKpiKey === 'ctr_28d' && objectiveRag !== 'no_data') {
        if (objectiveRag === 'on_track') tileCounts.ctr.on_track++;
        else if (objectiveRag === 'at_risk') tileCounts.ctr.at_risk++;
        else if (objectiveRag === 'overdue') tileCounts.ctr.overdue++;
      } else if (objectiveKpiKey === 'current_rank' && delta != null) {
        if (delta > 0) tileCounts.rank.improved++;
        else if (delta < 0) tileCounts.rank.worse++;
        else tileCounts.rank.flat++;
      }

      // Check AI gap
      if (objectiveKpiKey === 'ai_citations' && latestMeasurement) {
        const aiOverview = latestMeasurement.ai_overview;
        const aiCitations = latestMeasurement.ai_citations;
        if (aiOverview === true && (aiCitations === 0 || aiCitations == null)) {
          tileCounts.ai_gap++;
          impactTotals.ai_citation_gap++;
        }
      }

      // Check overdue cycles
      if (dueAt && new Date(dueAt) < now && objectiveRag === 'overdue') {
        tileCounts.overdue_cycles++;
      }

      // Calculate estimated extra clicks for CTR tasks
      if (objectiveKpiKey === 'ctr_28d' && baselineValue != null && latestValue != null) {
        const impressions = latestMeasurement?.impressions_28d || baselineMeasurement?.impressions_28d || 0;
        if (impressions > 0 && activeCycle?.objective) {
          let goalCtr = null;
          if (activeCycle.objective.target_type === 'delta') {
            goalCtr = baselineValue + activeCycle.objective.target;
          } else {
            goalCtr = activeCycle.objective.target;
          }
          if (goalCtr != null && goalCtr > latestValue) {
            const extraClicks = impressions * (goalCtr - latestValue);
            impactTotals.estimated_extra_clicks += extraClicks;
          }
        }
      }

      // Get is_test_task from map
      const isTestTask = testTaskMap.get(task.id) || false;
      
      // Format measurements for client (convert events to measurement objects)
      // IMPORTANT: include is_baseline so the frontend traffic lights can align with the drawer's baseline selection.
      const measurements = cycleEvents.map(e => ({
        captured_at: e.created_at,
        is_baseline: e.is_baseline === true,
        ...e.metrics
      }));

      // Enrich task
      enrichedTasks.push({
        ...task,
        is_test_task: isTestTask,
        objectiveKpiKey,
        baselineValue,
        latestValue,
        delta,
        objectiveRag,
        dueAt,
        dueIn,
        needsMeasurement,
        sparklinePoints,
        measurements, // Include measurements for traffic light calculations
        // Include objective from cycle for table display
        objective: activeCycle?.objective || null,
        // Include baseline and latest metrics objects for table display
        baseline_metrics: baselineMeasurement ? {
          ...baselineMeasurement,
          captured_at: baselineEvent?.created_at || cycleEvents[0]?.created_at
        } : null,
        latest_metrics: latestMeasurement ? {
          ...latestMeasurement,
          captured_at: cycleEvents[cycleEvents.length - 1]?.created_at
        } : null,
        cycles: taskCycles, // Include cycles for scope filtering
      });
    }

    // Calculate timeseries data
    const measurementsPerWeek = [];
    const medianDeltaByKpi = {};

    if (events && events.length > 0) {
      // Group measurements by week
      const weekMap = new Map();
      for (const e of events) {
        const date = new Date(e.created_at);
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay()); // Sunday
        weekStart.setHours(0, 0, 0, 0);
        const weekKey = weekStart.toISOString().split('T')[0];
        
        if (!weekMap.has(weekKey)) {
          weekMap.set(weekKey, 0);
        }
        weekMap.set(weekKey, weekMap.get(weekKey) + 1);
      }

      // Convert to array
      for (const [weekStart, count] of weekMap.entries()) {
        measurementsPerWeek.push({ weekStart, count });
      }
      measurementsPerWeek.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      // Calculate median deltas by KPI (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentEvents = events.filter(e => new Date(e.created_at) >= thirtyDaysAgo);

      // Group by task and cycle, then calculate deltas
      const deltasByKpi = {};
      for (const task of enrichedTasks) {
        if (task.objectiveKpiKey && task.delta != null) {
          if (!deltasByKpi[task.objectiveKpiKey]) {
            deltasByKpi[task.objectiveKpiKey] = [];
          }
          deltasByKpi[task.objectiveKpiKey].push(task.delta);
        }
      }

      // Calculate medians
      for (const [kpi, deltas] of Object.entries(deltasByKpi)) {
        if (deltas.length > 0) {
          deltas.sort((a, b) => a - b);
          const mid = Math.floor(deltas.length / 2);
          const median = deltas.length % 2 === 0
            ? (deltas[mid - 1] + deltas[mid]) / 2
            : deltas[mid];
          medianDeltaByKpi[kpi] = median;
        }
      }
    }

    return sendJSON(res, 200, {
      tasks: enrichedTasks,
      tiles: tileCounts,
      impact: impactTotals,
      timeseries: {
        measurementsPerWeek,
        medianDeltaByKpi: Object.entries(medianDeltaByKpi).map(([kpi, value]) => ({ kpi, value })),
      },
    });
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return sendJSON(res, 500, { error: error.message });
  }
}

