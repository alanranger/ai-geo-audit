-- Exact audience a linked send went to (8 Nov 2026): { list: { email_id, list_names, sends, sent_at, captured_at },
-- recipients: { count, person_ids, unmatched, source, captured_at } }. Write-once per key: once a key is stored it is
-- never rewritten (the saved segment may change later; the sent audience doesn't). Person ids only, no emails.
alter table public.strategy_campaigns
  add column if not exists sent_audience jsonb;

comment on column public.strategy_campaigns.sent_audience is 'Write-once evidence of the sent audience: list names + send count at link time, DELIVERED recipients (person ids) once collected.';

create or replace function public.strategy_campaigns_keep_sent_audience() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.sent_audience is not null then
    new.sent_audience := coalesce(new.sent_audience, '{}'::jsonb) || old.sent_audience;
  end if;
  return new;
end;
$$;

drop trigger if exists strategy_campaigns_keep_sent_audience on public.strategy_campaigns;
create trigger strategy_campaigns_keep_sent_audience
  before update on public.strategy_campaigns
  for each row execute function public.strategy_campaigns_keep_sent_audience();
