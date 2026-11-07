-- Marketing & Campaigns tab (7 Nov 2026): customers, identity, Squarespace sync, segments, suppression, send meter, email reports.
-- All tables have RLS on and no policies: only the service role (server routes) can read or write. Personal data never leaves
-- authenticated server routes.

create table if not exists public.sqs_profiles (
  profile_id text primary key,
  email text,
  first_name text,
  last_name text,
  has_account boolean,
  created_on timestamptz,
  accepts_marketing boolean,
  is_customer boolean,
  postcode text,
  country_code text,
  order_count integer,
  total_order_gbp numeric,
  first_order_on timestamptz,
  last_order_on timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz
);
create index if not exists sqs_profiles_email_idx on public.sqs_profiles (lower(email));

create table if not exists public.sqs_orders (
  order_id text primary key,
  order_number integer,
  created_on timestamptz,
  modified_on timestamptz,
  customer_email text,
  customer_id text,
  attendee_email text,
  attendee_first_name text,
  attendee_last_name text,
  billing_postcode text,
  billing_country text,
  grand_total_gbp numeric,
  refunded_total_gbp numeric,
  fulfillment_status text,
  payment_state text,
  channel text,
  testmode boolean,
  synced_at timestamptz not null default now()
);
create index if not exists sqs_orders_number_idx on public.sqs_orders (order_number);
create index if not exists sqs_orders_email_idx on public.sqs_orders (lower(customer_email));

create table if not exists public.sqs_order_lines (
  order_id text not null references public.sqs_orders (order_id) on delete cascade,
  line_index integer not null,
  line_id text,
  product_id text,
  product_name text,
  variant_options jsonb,
  sku text,
  quantity integer,
  unit_price_gbp numeric,
  line_type text,
  primary key (order_id, line_index)
);

create table if not exists public.postcode_geo_cache (
  postcode text primary key,
  lat double precision,
  lng double precision,
  status text not null,
  looked_up_at timestamptz not null default now()
);

create table if not exists public.customer_person (
  person_id uuid primary key default gen_random_uuid(),
  anchor_key text not null unique,
  email text,
  display_name text,
  facts jsonb not null default '{}'::jsonb,
  facts_built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_identity_link (
  source text not null,
  source_id text not null,
  person_id uuid not null references public.customer_person (person_id) on delete cascade,
  match_method text not null,
  candidate_person_id uuid references public.customer_person (person_id) on delete set null,
  confirmed boolean not null default false,
  raw_ref text,
  detail jsonb,
  updated_at timestamptz not null default now(),
  primary key (source, source_id)
);
create index if not exists customer_identity_link_person_idx on public.customer_identity_link (person_id);

create table if not exists public.marketing_suppression (
  email_hash text primary key,
  reason text not null,
  source text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  note text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text
);

create table if not exists public.marketing_segments (
  segment_id text primary key,
  name text not null,
  description text,
  definition jsonb not null,
  is_builtin boolean not null default false,
  set_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_segment_exports (
  export_id uuid primary key default gen_random_uuid(),
  segment_ids text[] not null,
  campaign_key text,
  list_name text not null,
  definition_snapshot jsonb not null,
  source_sync_at timestamptz,
  eligible_count integer not null,
  exclusions jsonb not null default '{}'::jsonb,
  status text not null default 'pending_import',
  status_history jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_segment_export_members (
  export_id uuid not null references public.marketing_segment_exports (export_id) on delete cascade,
  person_id uuid not null,
  email text not null,
  first_name text,
  last_name text,
  primary key (export_id, person_id)
);

create table if not exists public.sqs_send_meter (
  captured_at timestamptz primary key,
  cycle_reset_at timestamptz,
  quota_emails integer,
  used_emails integer,
  blast_campaigns_used integer,
  is_sending_disabled boolean,
  run_id uuid
);

create table if not exists public.sqs_email_campaigns (
  email_id text primary key,
  subject text,
  sent_on timestamptz,
  email_type text,
  mailing_list_names text[],
  message_count integer,
  delivered integer,
  opened integer,
  clicked integer,
  unsubscribed integer,
  url_clicks jsonb,
  campaign_key text,
  collected_at timestamptz not null default now(),
  events_collected_at timestamptz,
  events_complete boolean not null default false
);

create table if not exists public.sqs_email_events (
  email_id text not null,
  event_type text not null,
  recipient_id text not null,
  url text not null default '',
  email text,
  event_count integer,
  event_at timestamptz,
  collected_at timestamptz not null default now(),
  primary key (email_id, event_type, recipient_id, url)
);
create index if not exists sqs_email_events_email_idx on public.sqs_email_events (lower(email));

create table if not exists public.marketing_collector_runs (
  run_id uuid primary key default gen_random_uuid(),
  kind text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  status text not null default 'running',
  session_ok boolean,
  items_total integer,
  items_done integer,
  checkpoint jsonb,
  summary jsonb,
  error text,
  host text
);
create index if not exists marketing_collector_runs_kind_idx on public.marketing_collector_runs (kind, started_at desc);

alter table public.strategy_campaigns add column if not exists sqs_email_id text;
alter table public.strategy_campaigns add column if not exists segment_ids text[];
alter table public.strategy_campaigns add column if not exists reserved_sends integer;
alter table public.strategy_campaigns add column if not exists actual_sends integer;
alter table public.strategy_campaigns add column if not exists export_id uuid;

do $$
declare t text;
begin
  foreach t in array array['sqs_profiles','sqs_orders','sqs_order_lines','postcode_geo_cache','customer_person','customer_identity_link',
    'marketing_suppression','marketing_segments','marketing_segment_exports','marketing_segment_export_members','sqs_send_meter',
    'sqs_email_campaigns','sqs_email_events','marketing_collector_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
