-- Social follow-ups (questions 2026-11-08 linkedin-weekly-entry-by-gpt-api, tidy-up item 1, social-standard B3).
--   source 'gpt' (LinkedIn weekly figures entered by GPT through the API) alongside 'api' (Meta) and 'manual' (Alan).
--   social_posts.entered_by: who typed a manual / GPT post.
--   social_post_snapshots: one row per post per day, so posts are compared at the same age. Upsert only.
--   Facebook post shares stored as 0 only because Meta omitted the field are "no data": set to null (counted first).

alter table public.social_account_daily drop constraint if exists social_account_daily_source_check;
alter table public.social_account_daily add constraint social_account_daily_source_check check (source in ('api', 'manual', 'gpt'));
alter table public.social_posts drop constraint if exists social_posts_source_check;
alter table public.social_posts add constraint social_posts_source_check check (source in ('api', 'manual', 'gpt'));
alter table public.social_posts add column if not exists entered_by text;

create table if not exists public.social_post_snapshots (
  channel       text not null check (channel in ('facebook', 'instagram', 'linkedin')),
  post_id       text not null,
  captured_date date not null,
  reach         integer check (reach >= 0),
  impressions   integer check (impressions >= 0),
  likes         integer check (likes >= 0),
  comments      integer check (comments >= 0),
  shares        integer check (shares >= 0),
  saves         integer check (saves >= 0),
  source        text not null check (source in ('api', 'manual', 'gpt')),
  collected_at  timestamptz not null default now(),
  primary key (channel, post_id, captured_date)
);
alter table public.social_post_snapshots enable row level security;
drop trigger if exists social_post_snapshots_no_delete on public.social_post_snapshots;
create trigger social_post_snapshots_no_delete before delete on public.social_post_snapshots
  for each row execute function public.social_refuse_delete();
comment on table public.social_post_snapshots is 'Per-post figures by day (same-age comparison). Upsert only (delete refused).';

update public.social_posts set shares = null where channel = 'facebook' and source = 'api' and shares = 0;
