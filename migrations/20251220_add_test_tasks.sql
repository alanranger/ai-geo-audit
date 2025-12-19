-- Migration: Add 30 test tasks with various stages, KPIs, objectives, and 8 weeks of measurement history
-- These tasks are marked with is_test_task = true and should be excluded from bulk updates

-- First, add is_test_task column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'optimisation_tasks' 
    AND column_name = 'is_test_task'
  ) THEN
    ALTER TABLE public.optimisation_tasks ADD COLUMN is_test_task BOOLEAN DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_optimisation_tasks_is_test_task ON public.optimisation_tasks(is_test_task);
  END IF;
END $$;

-- Generate test tasks with various configurations
DO $$
DECLARE
  test_user_id UUID := '00000000-0000-0000-0000-000000000000';
  task_record RECORD;
  cycle_record RECORD;
  event_record RECORD;
  task_id_var UUID;
  cycle_id_var UUID;
  i INTEGER;
  week_offset INTEGER;
  base_date TIMESTAMPTZ;
  measurement_date TIMESTAMPTZ;
  kpi_value NUMERIC;
  baseline_value NUMERIC;
  target_value NUMERIC;
  statuses TEXT[] := ARRAY['planned', 'in_progress', 'monitoring', 'done', 'paused', 'cancelled'];
  kpis TEXT[] := ARRAY['clicks_28d', 'impressions_28d', 'ctr_28d', 'current_rank', 'ai_citations', 'opportunity_score'];
  task_types TEXT[] := ARRAY['on_page', 'content', 'technical', 'internal_links'];
  keywords TEXT[] := ARRAY[
    'test photography courses', 'test camera lessons', 'test photography workshops',
    'test beginner photography', 'test advanced photography', 'test portrait photography',
    'test landscape photography', 'test wedding photography', 'test commercial photography',
    'test photography classes near me', 'test photography training', 'test photography education',
    'test photography certification', 'test photography diploma', 'test photography degree',
    'test photography masterclass', 'test photography tutorial', 'test photography guide',
    'test photography tips', 'test photography techniques', 'test photography skills',
    'test photography equipment', 'test photography gear', 'test photography accessories',
    'test photography software', 'test photography editing', 'test photography post processing',
    'test photography portfolio', 'test photography gallery', 'test photography showcase'
  ];
BEGIN
  -- Delete existing test tasks first (cleanup)
  DELETE FROM public.optimisation_task_events WHERE task_id IN (
    SELECT id FROM public.optimisation_tasks WHERE is_test_task = true
  );
  DELETE FROM public.optimisation_task_cycles WHERE task_id IN (
    SELECT id FROM public.optimisation_tasks WHERE is_test_task = true
  );
  DELETE FROM public.optimisation_tasks WHERE is_test_task = true;

  -- Create 30 test tasks
  FOR i IN 1..30 LOOP
    -- Select random values
    base_date := NOW() - (INTERVAL '8 weeks');
    task_id_var := gen_random_uuid();
    
    -- Insert task
    INSERT INTO public.optimisation_tasks (
      id,
      owner_user_id,
      keyword_text,
      target_url,
      task_type,
      status,
      title,
      is_test_task,
      cycle_active,
      created_at,
      updated_at
    ) VALUES (
      task_id_var,
      test_user_id,
      keywords[1 + (i - 1) % array_length(keywords, 1)],
      '/test-page-' || i,
      (task_types[1 + (i - 1) % array_length(task_types, 1)])::optim_task_type,
      (statuses[1 + (i - 1) % array_length(statuses, 1)])::optim_task_status,
      'TEST: ' || keywords[1 + (i - 1) % array_length(keywords, 1)],
      true,
      1,
      base_date,
      base_date
    );

    -- Create cycle
    cycle_id_var := gen_random_uuid();
    INSERT INTO public.optimisation_task_cycles (
      id,
      task_id,
      cycle_no,
      status,
      start_date,
      due_at,
      objective,
      objective_status,
      objective_progress,
      created_at
    ) VALUES (
      cycle_id_var,
      task_id_var,
      1,
      CASE 
        WHEN statuses[1 + (i - 1) % array_length(statuses, 1)] IN ('done', 'cancelled', 'paused') THEN 'archived'
        ELSE 'active'
      END,
      base_date,
      base_date + (INTERVAL '1 day' * (30 + (i % 60))), -- Various timeframes: 30-90 days
      jsonb_build_object(
        'title', 'TEST Objective ' || i,
        'kpi', kpis[1 + (i - 1) % array_length(kpis, 1)],
        'target', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN 0.01 + (i % 5) * 0.005 -- 0.01 to 0.03
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 10 + (i % 20) -- 10 to 30
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN 1 + (i % 5) -- 1 to 5
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN 50 + (i % 30) -- 50 to 80
          ELSE 100 + (i % 200) -- 100 to 300
        END,
        'target_type', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 'absolute'
          ELSE 'delta'
        END,
        'due_at', (base_date + (INTERVAL '1 day' * (30 + (i % 60))))::text,
        'plan', 'TEST: This is test data for Phase 9 dashboard visualization'
      ),
      CASE 
        WHEN (i % 4) = 0 THEN 'overdue'
        WHEN (i % 4) = 1 THEN 'on_track'
        WHEN (i % 4) = 2 THEN 'met'
        ELSE 'on_track'
      END,
      jsonb_build_object(
        'baseline_value', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN 0.01
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 20.0
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN 0.0
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN 40.0
          ELSE 100.0
        END,
        'latest_value', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN 0.01 + (i % 3) * 0.005
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 20.0 - (i % 5)
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN (i % 3)
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN 40.0 + (i % 20)
          ELSE 100.0 + (i % 50)
        END,
        'delta', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN (i % 5) -- positive for rank improvement
          ELSE (i % 10) - 5 -- -5 to +5
        END,
        'target', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN 0.01 + (i % 5) * 0.005
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 10 + (i % 20)
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN 1 + (i % 5)
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN 50 + (i % 30)
          ELSE 100 + (i % 200)
        END,
        'target_type', CASE 
          WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 'absolute'
          ELSE 'delta'
        END
      ),
      base_date
    );

    -- Update task with active cycle
    UPDATE public.optimisation_tasks 
    SET active_cycle_id = cycle_id_var
    WHERE id = task_id_var;

    -- Create 8 weeks of measurement history (one per week) with fluctuations
    FOR week_offset IN 0..7 LOOP
      measurement_date := base_date + (INTERVAL '1 week' * week_offset);
      
      -- Calculate fluctuating values based on week
      baseline_value := CASE 
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN 0.01
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN 20.0
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN 0.0
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN 40.0
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'impressions_28d' THEN 1000.0
        WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'clicks_28d' THEN 50.0
        ELSE 100.0
      END;
      
      -- Add fluctuation: some weeks up, some down, some flat
      kpi_value := baseline_value + (
        CASE 
          WHEN week_offset % 3 = 0 THEN (i % 5) * 0.1 -- Up trend
          WHEN week_offset % 3 = 1 THEN -(i % 3) * 0.1 -- Down trend
          ELSE 0 -- Flat
        END
      );
      
      -- Ensure values stay in reasonable ranges
      IF kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN
        kpi_value := GREATEST(0.001, LEAST(0.1, kpi_value));
      ELSIF kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN
        kpi_value := GREATEST(1.0, LEAST(50.0, kpi_value));
      ELSIF kpis[1 + (i - 1) % array_length(kpis, 1)] IN ('ai_citations', 'opportunity_score') THEN
        kpi_value := GREATEST(0.0, LEAST(100.0, kpi_value));
      ELSIF kpis[1 + (i - 1) % array_length(kpis, 1)] IN ('impressions_28d', 'clicks_28d') THEN
        kpi_value := GREATEST(0.0, kpi_value);
      END IF;

      -- Insert measurement event
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
        'TEST: Weekly measurement ' || (week_offset + 1),
        jsonb_build_object(
          'clicks_28d', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'clicks_28d' THEN kpi_value ELSE 50 + (week_offset * 2) + (i % 10) END,
          'impressions_28d', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'impressions_28d' THEN kpi_value ELSE 1000 + (week_offset * 50) + (i % 100) END,
          'ctr_28d', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ctr_28d' THEN kpi_value ELSE 0.01 + (week_offset * 0.001) + (i % 5) * 0.001 END,
          'current_rank', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'current_rank' THEN kpi_value ELSE 20.0 - (week_offset * 0.5) - (i % 5) END,
          'ai_citations', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'ai_citations' THEN kpi_value ELSE (week_offset % 3) + (i % 3) END,
          'ai_overview', (i % 3) = 0, -- Every 3rd task has AI overview
          'opportunity_score', CASE WHEN kpis[1 + (i - 1) % array_length(kpis, 1)] = 'opportunity_score' THEN kpi_value ELSE 40 + (week_offset * 2) + (i % 20) END,
          'captured_at', measurement_date::text
        ),
        test_user_id,
        measurement_date
      );
    END LOOP;

    -- Create a timeline event for cycle start
    INSERT INTO public.optimisation_task_events (
      id,
      task_id,
      cycle_id,
      cycle_number,
      event_type,
      note,
      owner_user_id,
      created_at
    ) VALUES (
      gen_random_uuid(),
      task_id_var,
      cycle_id_var,
      1,
      'cycle_start',
      'TEST: Cycle 1 started',
      test_user_id,
      base_date
    );

    -- Create a few status change events for variety
    IF i % 5 = 0 THEN
      INSERT INTO public.optimisation_task_events (
        id,
        task_id,
        cycle_id,
        cycle_number,
        event_type,
        note,
        owner_user_id,
        created_at
      ) VALUES (
        gen_random_uuid(),
        task_id_var,
        cycle_id_var,
        1,
        'status_changed',
        'TEST: Status changed to ' || statuses[1 + (i - 1) % array_length(statuses, 1)],
        test_user_id,
        base_date + INTERVAL '2 weeks'
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Created 30 test tasks with 8 weeks of measurement history each';
END $$;

