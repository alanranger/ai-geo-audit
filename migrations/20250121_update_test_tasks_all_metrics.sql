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
      -- Start date: 8 weeks ago (for baseline)
      -- Latest measurement: within last 7 days (for chart eligibility)
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
    
    -- Use task ID hash to create independent patterns for each metric
    -- This ensures we get varied combinations: some metrics positive, some negative
    pattern_num := abs(hashtext(task_id_var::text)) % 19;
    
    -- Calculate metric values with INDEPENDENT patterns for each metric
    -- Each metric uses a different hash offset to get independent variation
    -- This creates tasks with mixed positive/negative changes across metrics
    
    -- CTR: Use pattern_num % 3 to get 0=worse, 1=same, 2=better
    CASE (pattern_num % 3)
      WHEN 0 THEN
        -- Worse: decrease by 0.20-0.50 percentage points (exceeds threshold)
        ctr_baseline := baseline_ctr;
        ctr_latest := baseline_ctr - (0.002 + ((pattern_num % 6) * 0.0005));
      WHEN 1 THEN
        -- Same: change by less than 0.10 percentage points (within threshold)
        ctr_baseline := baseline_ctr;
        ctr_latest := baseline_ctr + (((pattern_num % 5) - 2) * 0.00008);
      ELSE
        -- Better: increase by 0.20-0.50 percentage points (exceeds threshold)
        ctr_baseline := baseline_ctr;
        ctr_latest := baseline_ctr + (0.002 + ((pattern_num % 6) * 0.0005));
    END CASE;
    
    -- Impressions: Use (pattern_num + 1) % 3 for independent variation
    CASE ((pattern_num + 1) % 3)
      WHEN 0 THEN
        -- Worse: decrease by 50-150
        impressions_baseline := baseline_impressions;
        impressions_latest := baseline_impressions - (50 + ((pattern_num % 5) * 20));
      WHEN 1 THEN
        -- Same: change by less than 20 (within threshold)
        impressions_baseline := baseline_impressions;
        impressions_latest := baseline_impressions + (((pattern_num % 5) - 2) * 5);
      ELSE
        -- Better: increase by 50-150
        impressions_baseline := baseline_impressions;
        impressions_latest := baseline_impressions + (50 + ((pattern_num % 5) * 20));
    END CASE;
    
    -- Clicks: Use (pattern_num + 2) % 3 for independent variation
    CASE ((pattern_num + 2) % 3)
      WHEN 0 THEN
        -- Worse: decrease by 8-20
        clicks_baseline := baseline_clicks;
        clicks_latest := baseline_clicks - (8 + (pattern_num % 6));
      WHEN 1 THEN
        -- Same: change by less than 5 (within threshold)
        clicks_baseline := baseline_clicks;
        clicks_latest := baseline_clicks + (((pattern_num % 5) - 2) * 1);
      ELSE
        -- Better: increase by 8-20
        clicks_baseline := baseline_clicks;
        clicks_latest := baseline_clicks + (8 + (pattern_num % 6));
    END CASE;
    
    -- Rank: Use (pattern_num + 3) % 3 for independent variation
    -- Lower rank is better, so negative delta (baseline - latest) = improvement
    CASE ((pattern_num + 3) % 3)
      WHEN 0 THEN
        -- Worse: rank increases (higher number = worse)
        rank_baseline := baseline_rank;
        rank_latest := baseline_rank + (1.5 + ((pattern_num % 5) * 0.5)); -- 1.5-4.0 increase
      WHEN 1 THEN
        -- Same: change by less than 0.5 (within threshold)
        rank_baseline := baseline_rank;
        rank_latest := baseline_rank + (((pattern_num % 5) - 2) * 0.1);
      ELSE
        -- Better: rank decreases (lower number = better)
        rank_baseline := baseline_rank;
        rank_latest := baseline_rank - (1.5 + ((pattern_num % 5) * 0.5)); -- 1.5-4.0 decrease
    END CASE;
    
    -- AI Citations: Use (pattern_num + 4) % 3 for independent variation
    CASE ((pattern_num + 4) % 3)
      WHEN 0 THEN
        -- Worse: decrease from 3 to 0
        ai_citations_baseline := 3;
        ai_citations_latest := 0;
      WHEN 1 THEN
        -- Same: no change
        ai_citations_baseline := 1 + (pattern_num % 2);
        ai_citations_latest := ai_citations_baseline;
      ELSE
        -- Better: increase from 0 to 3-8
        ai_citations_baseline := 0;
        ai_citations_latest := 3 + (pattern_num % 6);
    END CASE;
    
    -- AI Overview: Use (pattern_num + 5) % 3 for independent variation
    CASE ((pattern_num + 5) % 3)
      WHEN 0 THEN
        -- Worse: goes from true to false
        ai_overview_baseline := true;
        ai_overview_latest := false;
      WHEN 1 THEN
        -- Same: no change
        ai_overview_baseline := (pattern_num % 2) = 0;
        ai_overview_latest := ai_overview_baseline;
      ELSE
        -- Better: goes from false to true
        ai_overview_baseline := false;
        ai_overview_latest := true;
    END CASE;
    
    -- Create 8 weeks of measurements with progression from baseline to latest
    -- Ensure latest measurement is within last 7 days for chart eligibility
    -- Start from 7 weeks ago, end at 0-7 days ago (randomized per task for variety)
    FOR week_offset IN 0..7 LOOP
      -- Calculate date: start from 7 weeks ago, progress to recent (within last 7 days)
      -- This ensures all tasks have measurements in the last 30 days for the chart
      measurement_date := (NOW() - INTERVAL '7 weeks') + (INTERVAL '1 week' * week_offset) + (INTERVAL '1 day' * (pattern_num % 7));
      
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
  
  RAISE NOTICE 'Updated all test tasks with comprehensive measurements across all 6 metrics (CTR, Impressions, Clicks, Rank, AI Citations, AI Overview)';
END $$;

