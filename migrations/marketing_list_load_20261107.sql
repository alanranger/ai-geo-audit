-- Work order 2 (7 Nov 2026): load an audience snapshot into a Squarespace mailing list with consent checks before the
-- import, after it, and just before the send.
alter table public.marketing_segment_exports add column if not exists is_test boolean not null default false;
alter table public.marketing_segment_exports add column if not exists sqs_list_id text;
alter table public.marketing_segment_exports add column if not exists loaded_at timestamptz;
alter table public.marketing_segment_exports add column if not exists load_result jsonb;
alter table public.marketing_segment_exports add column if not exists presend_at timestamptz;
alter table public.marketing_segment_exports add column if not exists presend_result jsonb;
alter table public.marketing_segment_export_members add column if not exists precheck_state text;
alter table public.marketing_segment_export_members add column if not exists postcheck_state text;
