-- Migration: Update test tasks to have comprehensive measurements across all 7 metrics
-- This ensures traffic light logic can be properly tested with good distribution

DO $$
DECLARE
  test_user_id UUID := '00000000-0000-0000-0000-000000000000';
  task_record RECORD;
  cycle_record RECORD;
  task_id_var UUID;
  cycle_id_var UUID;
  measurement_date TIMESTAMPTZ;
  base_date TIMESTAMPTZ;
  week_offset INTEGER;
  i INTEGER;
  
  -- Baseline values for each metric
  baseline_ctr NUMERIC := 0.015; -- 1.5%
  baseline_impressions NUMERIC := 1000;
  baseline_clicks NUMERIC := 50;
  baseline_rank NUMERIC := 20.0;
  baseline_ai_citations NUMERIC := 0;
  baseline_ai_overview BOOLEAN := false;
  baseline_opportunity NUMERIC := 40.0;
  
  -- Pattern for creating varied outcomes
  -- Each task will have a pattern number (0-18) that determines its metric outcomes
  pattern_num INTEGER;
  
  -- Values for each metric based on pattern
  ctr_baseline NUMERIC;
  ctr_latest NUMERIC;
  impressions_baseline NUMERIC;
  impressions_latest NUMERIC;
  clicks_baseline NUMERIC;
  clicks_latest NUMERIC;
  rank_baseline NUMERIC;
  rank_latest NUMERIC;
  ai_citations_baseline NUMERIC;
  ai_citations_latest NUMERIC;
  ai_overview_baseline BOOLEAN;
  ai_overview_latest BOOLEAN;
  opportunity_baseline NUMERIC;
  opportunity_latest NUMERIC;
BEGIN
  -- Get all test tasks with their active cycles
  FOR task_record IN 
    SELECT t.id, t.status, t.active_cycle_id, t.cycle_active
    FROM public.optimisation_tasks t
    WHERE t.is_test_task = true
    ORDER BY t.created_at
  LOOP
    task_id_var := task_record.id;
    
    -- Get or create active cycle
    IF task_record.active_cycle_id IS NOT NULL THEN
      SELECT id INTO cycle_id_var FROM public.optimisation_task_cycles 
      WHERE id = task_record.active_cycle_id;
    END IF;
    
    IF cycle_id_var IS NULL THEN
      -- Create a cycle if none exists
      cycle_id_var := gen_random_uuid();
      base_date := NOW() - INTERVAL '8 weeks';
      
      INSERT INTO public.optimisation_task_cycles (
        id, task_id, cycle_no, status, start_date, due_at,
        objective, objective_status, created_at
      ) VALUES (
        cycle_id_var,
        task_id_var,
        1,
        CASE WHEN task_record.status IN ('done', 'cancelled', 'paused') THEN 'archived' ELSE 'active' END,
        base_date,
        base_date + INTERVAL '60 days',
        jsonb_build_object(
          'title', 'Test Objective',
          'kpi', 'ctr_28d',
          'target', 0.02,
          'target_type', 'delta'
        ),
        'on_track',
        base_date
      );
      
      UPDATE public.optimisation_tasks 
      SET active_cycle_id = cycle_id_var, cycle_active = 1
      WHERE id = task_id_var;
    ELSE
      -- Get cycle start date
      SELECT start_date INTO base_date FROM public.optimisation_task_cycles 
      WHERE id = cycle_id_var;
      IF base_date IS NULL THEN
        base_date := NOW() - INTERVAL '8 weeks';
      END IF;
    END IF;
    
    -- Delete existing measurement events for this task
    DELETE FROM public.optimisation_task_events 
    WHERE task_id = task_id_var AND event_type = 'measurement';
    
    -- Use task ID hash to create consistent pattern (0-18)
    -- This ensures each task gets a unique but consistent pattern
    pattern_num := abs(hashtext(task_id_var::text)) % 19;
    
    -- Calculate metric values based on pattern
    -- Pattern determines which metrics are better/same/worse
    -- We want good distribution across all combinations
    
    -- CTR: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    -- Threshold: >= 0.10 percentage points (0.001 in ratio)
    IF pattern_num <= 5 THEN
      -- Worse: decrease by 0.15-0.40 percentage points (exceeds threshold)
      ctr_baseline := baseline_ctr;
      ctr_latest := baseline_ctr - (0.0015 + (pattern_num * 0.0003));
    ELSIF pattern_num <= 11 THEN
      -- Same: change by less than 0.10 percentage points (within threshold)
      ctr_baseline := baseline_ctr;
      ctr_latest := baseline_ctr + ((pattern_num - 6) * 0.00008);
    ELSE
      -- Better: increase by 0.15-0.40 percentage points (exceeds threshold)
      ctr_baseline := baseline_ctr;
      ctr_latest := baseline_ctr + (0.0015 + ((pattern_num - 12) * 0.0003));
    END IF;
    
    -- Impressions: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    -- Threshold: >= max(20, baseline * 0.02) = 20 for baseline 1000
    IF pattern_num <= 5 THEN
      impressions_baseline := baseline_impressions;
      impressions_latest := baseline_impressions - (30 + (pattern_num * 10)); -- 30-80 decrease
    ELSIF pattern_num <= 11 THEN
      impressions_baseline := baseline_impressions;
      impressions_latest := baseline_impressions + ((pattern_num - 6) * 3); -- 0-15 change (within threshold)
    ELSE
      impressions_baseline := baseline_impressions;
      impressions_latest := baseline_impressions + (30 + ((pattern_num - 12) * 10)); -- 30-80 increase
    END IF;
    
    -- Clicks: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    -- Threshold: >= max(5, baseline * 0.05) = 5 for baseline 50
    IF pattern_num <= 5 THEN
      clicks_baseline := baseline_clicks;
      clicks_latest := baseline_clicks - (6 + pattern_num); -- 6-11 decrease
    ELSIF pattern_num <= 11 THEN
      clicks_baseline := baseline_clicks;
      clicks_latest := baseline_clicks + ((pattern_num - 6) * 0.8); -- 0-4 change (within threshold)
    ELSE
      clicks_baseline := baseline_clicks;
      clicks_latest := baseline_clicks + (6 + (pattern_num - 12)); -- 6-11 increase
    END IF;
    
    -- Rank: Pattern 0-5 = worse (higher rank), 6-11 = same, 12-18 = better (lower rank)
    -- Threshold: >= 0.5 change
    IF pattern_num <= 5 THEN
      rank_baseline := baseline_rank;
      rank_latest := baseline_rank + (0.8 + (pattern_num * 0.3)); -- 0.8-2.3 increase (worse)
    ELSIF pattern_num <= 11 THEN
      rank_baseline := baseline_rank;
      rank_latest := baseline_rank + ((pattern_num - 6) * 0.08); -- 0-0.4 change (within threshold)
    ELSE
      rank_baseline := baseline_rank;
      rank_latest := baseline_rank - (0.8 + ((pattern_num - 12) * 0.3)); -- 0.8-2.3 decrease (better)
    END IF;
    
    -- AI Citations: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    IF pattern_num <= 5 THEN
      ai_citations_baseline := 2;
      ai_citations_latest := 0;
    ELSIF pattern_num <= 11 THEN
      ai_citations_baseline := 1;
      ai_citations_latest := 1;
    ELSE
      ai_citations_baseline := 0;
      ai_citations_latest := 2 + (pattern_num - 12);
    END IF;
    
    -- AI Overview: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    IF pattern_num <= 5 THEN
      ai_overview_baseline := true;
      ai_overview_latest := false;
    ELSIF pattern_num <= 11 THEN
      ai_overview_baseline := (pattern_num % 2) = 0;
      ai_overview_latest := ai_overview_baseline;
    ELSE
      ai_overview_baseline := false;
      ai_overview_latest := true;
    END IF;
    
    -- Opportunity Score: Pattern 0-5 = worse, 6-11 = same, 12-18 = better
    -- Threshold: >= 2 change
    IF pattern_num <= 5 THEN
      opportunity_baseline := baseline_opportunity;
      opportunity_latest := baseline_opportunity - (3 + pattern_num); -- 3-8 decrease
    ELSIF pattern_num <= 11 THEN
      opportunity_baseline := baseline_opportunity;
      opportunity_latest := baseline_opportunity + ((pattern_num - 6) * 0.3); -- 0-1.5 change (within threshold)
    ELSE
      opportunity_baseline := baseline_opportunity;
      opportunity_latest := baseline_opportunity + (3 + (pattern_num - 12)); -- 3-8 increase
    END IF;
    
    -- Create 8 weeks of measurements with progression from baseline to latest
    FOR week_offset IN 0..7 LOOP
      measurement_date := base_date + (INTERVAL '1 week' * week_offset);
      
      -- Interpolate between baseline and latest
      INSERT INTO public.optimisation_task_events (
        id,
        task_id,
        cycle_id,
        cycle_number,
        event_type,
        note,
        metrics,
        owner_user_id,
        created_at
      ) VALUES (
        gen_random_uuid(),
        task_id_var,
        cycle_id_var,
        1,
        'measurement',
        'TEST: Measurement week ' || (week_offset + 1) || ' (pattern ' || pattern_num || ')',
        jsonb_build_object(
          'ctr_28d', ctr_baseline + ((ctr_latest - ctr_baseline) * (week_offset::NUMERIC / 7.0)),
          'impressions_28d', ROUND(impressions_baseline + ((impressions_latest - impressions_baseline) * (week_offset::NUMERIC / 7.0))),
          'clicks_28d', ROUND(clicks_baseline + ((clicks_latest - clicks_baseline) * (week_offset::NUMERIC / 7.0))),
          'current_rank', rank_baseline + ((rank_latest - rank_baseline) * (week_offset::NUMERIC / 7.0)),
          'ai_citations', CASE 
            WHEN week_offset < 4 THEN ai_citations_baseline 
            ELSE ai_citations_latest 
          END,
          'ai_overview', CASE 
            WHEN week_offset < 4 THEN ai_overview_baseline 
            ELSE ai_overview_latest 
          END,
          'opportunity_score', ROUND(opportunity_baseline + ((opportunity_latest - opportunity_baseline) * (week_offset::NUMERIC / 7.0))),
          'captured_at', measurement_date::text
        ),
        test_user_id,
        measurement_date
      );
    END LOOP;
    
    RAISE NOTICE 'Updated test task % with pattern % (CTR: % -> %, Rank: % -> %, AI Citations: % -> %)', 
      task_id_var, pattern_num, ctr_baseline, ctr_latest, rank_baseline, rank_latest, 
      ai_citations_baseline, ai_citations_latest;
  END LOOP;
  
  RAISE NOTICE 'Updated all test tasks with comprehensive measurements across all 7 metrics';
END $$;

