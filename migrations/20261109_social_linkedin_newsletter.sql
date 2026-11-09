-- LinkedIn week row: Light & Logic newsletter figures, kept in their own columns (never mixed with profile / post
-- figures or Squarespace subscribers). Written only when GPT supplies them (question 2026-11-09 item 4).
alter table public.social_account_daily add column if not exists newsletter_subscribers integer check (newsletter_subscribers >= 0);
alter table public.social_account_daily add column if not exists newsletter_issue_views integer check (newsletter_issue_views >= 0);
alter table public.social_account_daily add column if not exists newsletter_issue_date date;
alter table public.social_account_daily add column if not exists newsletter_issue_url text;
comment on column public.social_account_daily.newsletter_subscribers is 'LinkedIn Light & Logic newsletter subscribers (GPT-entered). Not profile followers, not Squarespace subscribers.';
comment on column public.social_account_daily.newsletter_issue_views is 'Views of the latest Light & Logic issue (GPT-entered), as of the entry.';
