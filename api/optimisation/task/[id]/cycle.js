// /api/optimisation/task/[id]/cycle.js
// Create a new cycle for an optimisation task

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminOrShare, isShareMode } from '../../../../lib/api/requireAdminOrShare.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
  res.status(status).send(JSON.stringify(obj));
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key, x-arp-share-token');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: 'Method not allowed' });
  }

  // Write operation - require admin only (reject share mode)
  const auth = requireAdminOrShare(req, res, sendJSON);
  if (!auth.authorized) {
    return; // Response already sent
  }

  if (isShareMode(req)) {
    return sendJSON(res, 403, { error: 'Write operations not allowed in share mode' });
  }

  try {
    const { id } = req.query;
    if (!id) {
      return sendJSON(res, 400, { error: 'Task ID required' });
    }

    // Parse objective from body (can be either old format or new Phase 5 format)
    const {
      objective_title,
      primary_kpi,
      target_value,
      target_direction,
      timeframe_days,
      hypothesis,
      plan,
      objective // Phase 5 format (jsonb object)
    } = req.body;

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

    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // Get current task and active cycle
    const { data: task, error: taskError } = await supabase
      .from('optimisation_tasks')
      .select('*, active_cycle_id')
      .eq('id', id)
      .single();

    if (taskError || !task) {
      return sendJSON(res, 404, { error: 'Task not found' });
    }

    // Get current cycle to find latest measurement
    let currentCycle = null;
    let currentCycleNo = task.cycle_active || 1;
    if (task.active_cycle_id) {
      const { data: cycle } = await supabase
        .from('optimisation_task_cycles')
        .select('id, cycle_no, objective, due_at')
        .eq('id', task.active_cycle_id)
        .single();
      if (cycle) {
        currentCycle = cycle;
        currentCycleNo = cycle.cycle_no;
      }
    }

    // Fetch baseline from latest audit in Supabase (proper source of truth)
    // Get task's keyword and URL to query keyword_rankings table
    const taskKeyword = task.keyword_text || task.keyword_key;
    const taskUrl = task.target_url_clean || task.target_url;
    const hasKeyword = !!(taskKeyword && String(taskKeyword).trim());
    let baselineFromAudit = null;

    // FIX: For keyword tasks, URL matching should be optional (same as frontend Fix 1)
    if (hasKeyword) {
      // Get property URL (site domain) for querying keyword_rankings
      // property_url in keyword_rankings is the site domain (e.g., "https://www.alanranger.com")
      // best_url is the specific page URL
      const propertyUrl = task.property_url || 'https://www.alanranger.com';
      const normalizedPropertyUrl = propertyUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
      
      // Normalize task URL for best_url matching (if provided)
      const normalizedTaskUrl = taskUrl ? taskUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase() : null;
      
      // Fetch latest audit data for this keyword from keyword_rankings table
      // For keyword tasks: match by keyword + property_url (site domain), best_url is optional
      let auditRows = null;
      let auditError = null;
      
      // Query by keyword and property_url (site domain) - this is required
      // If task has a URL, we can optionally filter by best_url, but don't require it
      let query = supabase
        .from('keyword_rankings')
        .select('*')
        .eq('keyword', taskKeyword)
        .eq('property_url', propertyUrl) // Match site domain
        .order('audit_date', { ascending: false });
      
      // Execute query
      const { data: allMatches, error: queryError } = await query;
      
      if (!queryError && allMatches && allMatches.length > 0) {
        // If task has URL, prefer exact best_url match, but accept any match
        if (normalizedTaskUrl) {
          // Try to find exact best_url match first
          const exactMatch = allMatches.find(row => {
            const rowBestUrl = (row.best_url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
            return rowBestUrl === normalizedTaskUrl || rowBestUrl.includes(normalizedTaskUrl) || normalizedTaskUrl.includes(rowBestUrl);
          });
          
          if (exactMatch) {
            auditRows = exactMatch;
            auditError = null;
            console.log('[Optimisation Cycle] Found keyword match with URL match');
          } else {
            // No URL match, but keyword matches - use first result (URL optional for keyword tasks)
            auditRows = allMatches[0];
            auditError = null;
            console.log('[Optimisation Cycle] Found keyword match without URL match (using first result)');
          }
        } else {
          // No task URL - use first keyword match
          auditRows = allMatches[0];
          auditError = null;
          console.log('[Optimisation Cycle] Found keyword match (no task URL)');
        }
      } else {
        auditRows = null;
        auditError = queryError;
      }

      if (!auditError && auditRows) {
        // Extract metrics from audit row
        // Get GSC data from searchData.queryTotals if available
        let gscClicks = null;
        let gscImpressions = null;
        let gscCtr = null;
        
        // Try to get from latest audit's queryTotals
        // Fetch latest audit to get queryTotals
        const { data: latestAudit } = await supabase
          .from('audit_results')
          .select('search_data, query_totals')
          .eq('property_url', task.property_url || 'https://www.alanranger.com')
          .order('audit_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        if (latestAudit) {
          // Try query_totals field first (newer format)
          let queryTotals = latestAudit.query_totals;
          if (!queryTotals && latestAudit.search_data) {
            const searchData = typeof latestAudit.search_data === 'string' 
              ? JSON.parse(latestAudit.search_data) 
              : latestAudit.search_data;
            queryTotals = searchData?.queryTotals;
          }
          
          if (Array.isArray(queryTotals)) {
            const queryTotal = queryTotals.find(qt => 
              (qt.query || qt.keyword || '').toLowerCase() === taskKeyword.toLowerCase()
            );
            if (queryTotal) {
              gscClicks = queryTotal.clicks || null;
              gscImpressions = queryTotal.impressions || null;
              gscCtr = queryTotal.ctr != null ? (queryTotal.ctr / 100) : null; // Convert percentage to decimal
            }
          }
        }

        // Parse AI citations
        let aiCitations = auditRows.ai_alan_citations || [];
        if (typeof aiCitations === 'string') {
          try {
            aiCitations = JSON.parse(aiCitations);
          } catch (e) {
            aiCitations = [];
          }
        }
        if (!Array.isArray(aiCitations)) aiCitations = [];

        baselineFromAudit = {
          gsc_clicks_28d: gscClicks,
          gsc_impressions_28d: gscImpressions,
          gsc_ctr_28d: gscCtr,
          current_rank: auditRows.best_rank_group || auditRows.best_rank_absolute || null,
          opportunity_score: auditRows.opportunity_score || null,
          ai_overview: auditRows.has_ai_overview || false,
          ai_citations: aiCitations.length || 0,
          ai_citations_total: auditRows.ai_total_citations || 0,
          classic_ranking_url: auditRows.best_url || null,
          page_type: auditRows.page_type || null,
          segment: auditRows.segment || null,
          captured_at: auditRows.audit_date ? new Date(auditRows.audit_date + 'T00:00:00').toISOString() : new Date().toISOString(),
          audit_date: auditRows.audit_date,
          is_baseline_from_audit: true
        };

        console.log('[Optimisation Cycle] Found baseline from audit:', {
          audit_date: auditRows.audit_date,
          keyword: taskKeyword,
          url: normalizedTaskUrl || '(no URL)',
          best_url: auditRows.best_url || '(no best_url)',
          metrics: baselineFromAudit,
          match_type: normalizedTaskUrl && auditRows.best_url ? 'keyword+best_url' : 'keyword-only'
        });
      } else if (auditError) {
        console.warn('[Optimisation Cycle] Error fetching audit data:', auditError);
      } else {
        console.log('[Optimisation Cycle] No audit data found for keyword:', { keyword: taskKeyword, url: normalizedTaskUrl || '(no URL)' });
      }
    } else if (!hasKeyword && taskUrl) {
      // URL-only task: Could fetch from Money Pages, but for now fall back to latest measurement
      // This matches the frontend behavior where URL tasks use Money Pages data
      console.log('[Optimisation Cycle] URL-only task - will use latest measurement as baseline');
    }

    // Fallback: Find most recent measurement event for current cycle (if no audit data)
    let latestMeasurement = null;
    if (!baselineFromAudit) {
      const { data: measurementData } = await supabase
        .from('optimisation_task_events')
        .select('id, metrics, created_at')
        .eq('task_id', id)
        .eq('event_type', 'measurement')
        .or(`cycle_id.eq.${task.active_cycle_id || 'null'},cycle_number.eq.${currentCycleNo}`)
        .not('metrics', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      latestMeasurement = measurementData;
    }

    // Get the highest cycle number for this task
    const { data: existingCycles, error: cyclesError } = await supabase
      .from('optimisation_task_cycles')
      .select('cycle_no')
      .eq('task_id', id)
      .order('cycle_no', { ascending: false })
      .limit(1);

    if (cyclesError) {
      console.error('[Optimisation Cycle] Error fetching existing cycles:', cyclesError);
    }

    const nextCycleNo = existingCycles && existingCycles.length > 0 
      ? existingCycles[0].cycle_no + 1 
      : currentCycleNo + 1;

    // End the previous cycle if it exists
    if (task.active_cycle_id) {
      await supabase
        .from('optimisation_task_cycles')
        .update({ end_date: new Date().toISOString() })
        .eq('id', task.active_cycle_id);
    }

    // Calculate due_at from objective timeframe if available
    const now = new Date();
    let dueAt = null;
    if (objective && objective.due_at) {
      dueAt = new Date(objective.due_at).toISOString();
    } else if (objective && objective.timeframe_days) {
      dueAt = new Date(now.getTime() + objective.timeframe_days * 24 * 60 * 60 * 1000).toISOString();
    } else if (timeframe_days) {
      dueAt = new Date(now.getTime() + parseInt(timeframe_days) * 24 * 60 * 60 * 1000).toISOString();
    } else if (currentCycle && currentCycle.due_at) {
      // If previous cycle had a due date, calculate new one from start date
      const prevDue = new Date(currentCycle.due_at);
      const prevStart = currentCycle.start_date ? new Date(currentCycle.start_date) : now;
      const daysDiff = Math.round((prevDue - prevStart) / (24 * 60 * 60 * 1000));
      if (daysDiff > 0) {
        dueAt = new Date(now.getTime() + daysDiff * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // Build objective in Phase 5 format if provided, otherwise use legacy fields
    let objectiveData = null;
    if (objective && typeof objective === 'object') {
      objectiveData = objective;
    } else if (objective_title || primary_kpi || target_value != null) {
      // Convert legacy format to Phase 5 format
      const { validateObjective, KPI_METADATA } = await import('../../../../lib/optimisation/objectiveSchema.js');
      
      // Map legacy primary_kpi values to Phase 5 KPI format
      const kpiMapping = {
        'clicks': 'clicks_28d',
        'impressions': 'impressions_28d',
        'ctr': 'ctr_28d',
        'rank': 'current_rank',
        'opportunity_score': 'opportunity_score',
        'ai_overview': 'ai_overview',
        'ai_citations': 'ai_citations'
      };
      
      let mappedKpi = primary_kpi;
      if (primary_kpi && kpiMapping[primary_kpi.toLowerCase()]) {
        mappedKpi = kpiMapping[primary_kpi.toLowerCase()];
      } else if (primary_kpi && !primary_kpi.includes('_')) {
        // If it's a simple name like "impressions", try to map it
        const lowerKpi = primary_kpi.toLowerCase();
        if (lowerKpi === 'impressions' || lowerKpi === 'impression') {
          mappedKpi = 'impressions_28d';
        } else if (lowerKpi === 'clicks' || lowerKpi === 'click') {
          mappedKpi = 'clicks_28d';
        } else if (lowerKpi === 'ctr') {
          mappedKpi = 'ctr_28d';
        } else if (lowerKpi === 'rank' || lowerKpi === 'ranking') {
          mappedKpi = 'current_rank';
        }
      }
      
      const legacyObj = {
        title: objective_title || 'Objective',
        kpi: mappedKpi || 'clicks_28d',
        target: target_value != null ? parseFloat(target_value) : 0,
        target_type: target_direction === 'increase' ? 'delta' : (target_direction === 'decrease' ? 'delta' : 'delta'),
        due_at: dueAt,
        plan: plan || null
      };
      
      const validation = validateObjective(legacyObj);
      if (validation.ok) {
        objectiveData = validation.normalisedObjective;
        console.log('[Optimisation Cycle] Created objective from legacy fields:', objectiveData);
      } else {
        console.error('[Optimisation Cycle] Objective validation failed:', validation.errors);
        // Still create objective even if validation fails (for backward compatibility)
        objectiveData = {
          title: objective_title || 'Objective',
          kpi: mappedKpi || 'clicks_28d',
          target: target_value != null ? parseFloat(target_value) : 0,
          target_type: 'delta',
          due_at: dueAt,
          plan: plan || null
        };
      }
    }

    // Create new cycle
    const cycleData = {
      task_id: id,
      cycle_no: nextCycleNo,
      status: task.status || 'planned',
      objective_title: objective_title || null, // Keep for backward compatibility
      primary_kpi: primary_kpi || null,
      target_value: target_value != null ? parseFloat(target_value) : null,
      target_direction: target_direction || null,
      timeframe_days: timeframe_days != null ? parseInt(timeframe_days) : null,
      hypothesis: hypothesis || null,
      plan: plan || null,
      objective: objectiveData, // Phase 5 format
      start_date: now.toISOString(), // Use start_date (existing column)
      due_at: dueAt // Phase 6: set due date from objective timeframe
    };

    const { data: cycle, error: cycleError } = await supabase
      .from('optimisation_task_cycles')
      .insert(cycleData)
      .select()
      .single();

    if (cycleError) {
      console.error('[Optimisation Cycle] Insert error:', cycleError);
      return sendJSON(res, 500, { error: cycleError.message });
    }

    // Update task with new active_cycle_id, increment cycle_active, and clear objective fields
    const { error: updateError } = await supabase
      .from('optimisation_tasks')
      .update({ 
        active_cycle_id: cycle.id,
        cycle_active: nextCycleNo,
        cycle_started_at: new Date().toISOString(),
        // Clear objective fields for new cycle
        objective_title: null,
        objective_kpi: null,
        objective_metric: null,
        objective_target_delta: null,
        objective_target_value: null,
        objective_direction: null,
        objective_due_at: null,
        objective_timeframe_days: null,
        objective_plan: null
      })
      .eq('id', id);

    if (updateError) {
      console.error('[Optimisation Cycle] Update task error:', updateError);
      return sendJSON(res, 500, { error: updateError.message });
    }

    // Create cycle_start event (Phase 6)
    const cycleStartEvent = {
      task_id: id,
      event_type: 'cycle_start',
      note: `Cycle ${nextCycleNo} started`,
      owner_user_id: userId,
      cycle_id: cycle.id,
      cycle_number: nextCycleNo,
      metrics: baselineFromAudit ? {
        baseline_from_audit: true,
        audit_date: baselineFromAudit.audit_date,
        captured_at: baselineFromAudit.captured_at
      } : (latestMeasurement ? {
        baseline_from_measurement_event_id: latestMeasurement.id,
        baseline_captured_at: latestMeasurement.created_at
      } : null)
    };

    const { data: cycleStartEventData, error: eventError } = await supabase
      .from('optimisation_task_events')
      .insert(cycleStartEvent)
      .select()
      .single();

    if (eventError) {
      console.error('[Optimisation Cycle] Event insert error:', eventError);
      // Don't fail, just log
    }

    // Create baseline measurement event in new cycle from latest audit (Phase 6)
    // This ensures the view can find the baseline for the new cycle
    const baselineMetrics = baselineFromAudit || (latestMeasurement?.metrics || null);
    
    if (baselineMetrics) {
      const baselineMeasurementEvent = {
        task_id: id,
        event_type: 'measurement',
        note: baselineFromAudit 
          ? `Baseline measurement from audit ${baselineFromAudit.audit_date}`
          : `Baseline measurement from Cycle ${currentCycleNo}`,
        owner_user_id: userId,
        cycle_id: cycle.id,
        cycle_number: nextCycleNo,
        metrics: {
          ...baselineMetrics,
          captured_at: baselineMetrics.captured_at || latestMeasurement?.created_at || new Date().toISOString(),
          is_baseline: true,
          baseline_from_audit: baselineFromAudit ? true : false,
          baseline_from_cycle: baselineFromAudit ? null : currentCycleNo
        }
      };

      const { error: baselineEventError } = await supabase
        .from('optimisation_task_events')
        .insert(baselineMeasurementEvent);

      if (baselineEventError) {
        console.error('[Optimisation Cycle] Baseline measurement event insert error:', baselineEventError);
        // Don't fail, just log - the cycle_start event has the baseline info
      } else {
        console.log('[Optimisation Cycle] Created baseline measurement event for new cycle from', 
          baselineFromAudit ? `audit ${baselineFromAudit.audit_date}` : `Cycle ${currentCycleNo}`);
      }
    }

    // Get updated task with baseline/latest from view
    const { data: updatedTask } = await supabase
      .from('vw_optimisation_task_status')
      .select('*')
      .eq('id', id)
      .single();

    return sendJSON(res, 201, { 
      cycle,
      cycle_start_event: cycleStartEventData,
      task: updatedTask,
      baseline_from_audit: baselineFromAudit ? {
        audit_date: baselineFromAudit.audit_date,
        captured_at: baselineFromAudit.captured_at
      } : null,
      baseline_from_measurement: !baselineFromAudit && latestMeasurement ? {
        id: latestMeasurement.id,
        captured_at: latestMeasurement.created_at
      } : null
    });
  } catch (error) {
    console.error('[Optimisation Cycle] Error:', error);
    return sendJSON(res, 500, { error: error.message || 'Internal server error' });
  }
}
