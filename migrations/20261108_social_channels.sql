-- Social channels on Marketing & Campaigns (questions 2026-11-08 build-social-channel-tiles-and-recent-posts +
-- meta-connect-button-oauth). Server-side only: RLS on, no policies (the service role is the only reader/writer).
--   social_connections   one row per provider ('meta' = Facebook Page + linked Instagram business account).
--                        token_encrypted is AES-256-GCM with SOCIAL_TOKEN_KEY (Vercel env); never sent to a browser.
--   social_oauth_states  one-use OAuth `state` values (sha256 only), 10-minute life: CSRF protection for the callback.
--   social_account_daily account figures per channel per day (period_days 1 = Meta daily read, 7 = LinkedIn manual week).
--   social_posts         one row per post. Both data tables are upsert only: a DELETE is refused by a trigger.

create table if not exists public.social_connections (
  channel           text primary key check (channel in ('meta')),
  page_id           text not null,
  page_name         text,
  ig_user_id        text,
  ig_username       text,
  token_encrypted   text not null,
  scopes            text[] not null default '{}',
  connected_at      timestamptz not null default now(),
  expires_at        timestamptz,
  status            text not null default 'connected' check (status in ('connected', 'expired', 'error')),
  last_checked_at   timestamptz,
  last_collected_at timestamptz,
  last_error        text
);

create table if not exists public.social_oauth_states (
  state_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table if not exists public.social_account_daily (
  channel      text not null check (channel in ('facebook', 'instagram', 'linkedin')),
  date         date not null,
  followers    integer check (followers >= 0),
  reach        integer check (reach >= 0),
  impressions  integer check (impressions >= 0),
  reactions    integer check (reactions >= 0),
  comments     integer check (comments >= 0),
  shares       integer check (shares >= 0),
  posts        integer check (posts >= 0),
  period_days  integer not null default 1 check (period_days in (1, 7)),
  source       text not null default 'api' check (source in ('api', 'manual')),
  entered_by   text,
  collected_at timestamptz not null default now(),
  primary key (channel, date)
);

create table if not exists public.social_posts (
  channel      text not null check (channel in ('facebook', 'instagram', 'linkedin')),
  post_id      text not null,
  posted_at    timestamptz not null,
  title        text,
  permalink    text,
  media_type   text,
  reach        integer check (reach >= 0),
  impressions  integer check (impressions >= 0),
  likes        integer check (likes >= 0),
  comments     integer check (comments >= 0),
  shares       integer check (shares >= 0),
  saves        integer check (saves >= 0),
  source       text not null default 'api' check (source in ('api', 'manual')),
  collected_at timestamptz not null default now(),
  primary key (channel, post_id)
);
create index if not exists social_posts_posted_at_idx on public.social_posts (posted_at desc);

alter table public.social_connections   enable row level security;
alter table public.social_oauth_states  enable row level security;
alter table public.social_account_daily enable row level security;
alter table public.social_posts         enable row level security;

create or replace function public.social_refuse_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is upsert only: rows are never deleted', tg_table_name;
end $$;

drop trigger if exists social_account_daily_no_delete on public.social_account_daily;
create trigger social_account_daily_no_delete before delete on public.social_account_daily
  for each row execute function public.social_refuse_delete();
drop trigger if exists social_posts_no_delete on public.social_posts;
create trigger social_posts_no_delete before delete on public.social_posts
  for each row execute function public.social_refuse_delete();

comment on table public.social_connections is 'Meta connection (Page + IG). token_encrypted = AES-256-GCM (SOCIAL_TOKEN_KEY). Never return token_encrypted to a browser. Disconnect deletes this row only.';
comment on table public.social_account_daily is 'Social account figures per channel/day. Upsert only (delete refused). source=manual for LinkedIn weekly entry (period_days 7).';
comment on table public.social_posts is 'Social posts per channel. Upsert only (delete refused). source=manual for LinkedIn.';
