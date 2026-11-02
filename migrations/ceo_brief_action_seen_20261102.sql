-- Card C "other actions" (batch 8 task 17e, Alan option B): no Done button. An action stays while its trigger
-- holds; the brief shows "raised N weeks running" from first_seen_week. Written only by a real Monday send.
create table if not exists public.ceo_brief_action_seen (
  property_url text not null,
  action_key text not null,
  first_seen_week date not null,
  last_seen_week date not null,
  primary key (property_url, action_key)
);
alter table public.ceo_brief_action_seen enable row level security;
