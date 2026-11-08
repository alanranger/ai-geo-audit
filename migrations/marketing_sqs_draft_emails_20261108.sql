-- Squarespace Drafts as read by the PC collector (final fix round item 10, read-only GET
-- /api/newsletters/v1.0/composer/emails?emailState=DRAFT + /emails/{id}). A sibling of sqs_scheduled_emails: a draft is
-- never a send or a reservation, so it is kept out of the table the send budget reads. Never deleted: a draft not listed
-- on a later complete read becomes 'gone' (scheduled, sent or deleted in Squarespace). Linking is by ids only; an
-- unmatched draft is shown as "unmatched platform draft" with a link action. Nothing is created from a draft.
create table if not exists public.sqs_draft_emails (
  email_id text primary key,
  subject text,
  email_type text,
  created_on timestamptz,
  modified_on timestamptz,
  mailing_list_ids text[] not null default '{}',
  mailing_list_names text[] not null default '{}',
  state text not null default 'draft' check (state in ('draft', 'gone')),
  first_seen_at timestamptz not null default now(),
  collected_at timestamptz not null default now(),
  gone_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  campaign_key text,
  link_state text not null default 'unlinked' check (link_state in ('linked', 'ambiguous', 'unlinked', 'external')),
  link_basis text,
  link_candidates text[] not null default '{}',
  link_set_by text,
  link_set_at timestamptz,
  run_id uuid
);
alter table public.sqs_draft_emails enable row level security;
comment on table public.sqs_draft_emails is 'Squarespace Drafts (collector, read-only). Not sends, not reservations. Unmatched = no campaign record has this draft id or its list.';
