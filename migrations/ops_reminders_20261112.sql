-- Dated manual reminders (QUESTION-2026-11-12 monday-brief-dated-action-reminders-bluebell-price; agreed with Alan).
-- Manual steps the app can't do itself. Each one shows in the Monday brief for the week it falls due and in every
-- brief after while it's open; Alan marks it done on the dashboard (PATCH /api/aigeo/ops-reminders, admin key).
-- self_check (optional): a read-only check the brief runs once the item is overdue, e.g. Squarespace sale prices.
-- Service role only: RLS on, no policies, anon / authenticated revoked. Idempotent.

create table if not exists public.ops_reminders (
  id bigint generated always as identity primary key,
  reminder_key text not null unique,
  property_url text not null default 'https://www.alanranger.com',
  due_date date not null,
  title text not null,
  steps jsonb not null default '[]'::jsonb,
  link text,
  self_check jsonb,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_reminders_done_at_matches check (done = (done_at is not null))
);

create index if not exists ops_reminders_open_due_idx on public.ops_reminders (due_date) where not done;

alter table public.ops_reminders enable row level security;
revoke all on public.ops_reminders from anon, authenticated;

insert into public.ops_reminders (reminder_key, due_date, title, steps, link, self_check)
values (
  'bluebell-price-rise-2027-02-01',
  date '2027-02-01',
  'Bluebell price rise: change 18 variants to £110 / £165',
  jsonb_build_array(
    'Open the Squarespace product "BLUEBELL WOODLANDS Photography - Warks - 20 Apr - 29 Apr" (product id 5c2c8834c2241bc8b409723c).',
    '12 half-day variants (the 5:45am–9:45am and 10:30am–2:30pm sessions on each date): change the sale price £99 → £110.',
    '6 all-day variants (one per date): change the sale price £150 → £165.',
    'Keep "on sale" ticked on all 18, so the £125 / £175 list prices still show crossed out.',
    'Check the product page shows £110 / £165 with £125 / £175 crossed out, then mark this done on the dashboard. The February and March emails already say £110 / £165.'
  ),
  'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops',
  jsonb_build_object(
    'kind', 'squarespace_sale_prices',
    'product_id', '5c2c8834c2241bc8b409723c',
    'product_url', 'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops',
    'old_sale_gbp', jsonb_build_array(99, 150),
    'new_sale_gbp', jsonb_build_array(110, 165),
    'expected_variants', 18
  )
)
on conflict (reminder_key) do nothing;
