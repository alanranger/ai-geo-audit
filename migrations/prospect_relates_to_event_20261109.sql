-- Prospects (QUESTION-2026-11-09 (v), Alan approved 19:13): relates_to_event = the dated event an enquiry is about.
--   Stored as "YYYY-MM-DD|/page-path" (event date | product page path: the same key as strategy_event_overrides and
--   strategy_event_promotion_flags). Input may be "YYYY-MM-DD|https://…/page" or a path; host, query and trailing "/" are
--   dropped. When set, the enquiry counts under the Sales gap "Dated events" (capped at that event's places left), never in
--   the non-dated pipeline. Nullable; existing rows are untouched (all null).
-- prospect_upsert (unchanged entry point) accepts the new key through prospect_norm_values / prospect_insert / prospect_update.
alter table public.prospect_enquiry add column if not exists relates_to_event text;
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_relates_to_event_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_relates_to_event_chk check (relates_to_event is null or relates_to_event ~ '^\d{4}-\d{2}-\d{2}\|/\S+$');
comment on column public.prospect_enquiry.relates_to_event is 'Dated event this enquiry is about: YYYY-MM-DD|/page-path (null = non-dated). Counted under Sales gap Dated events, capped at the event''s places left.';

-- "2026-11-28|https://www.alanranger.com/x/y/?a=1" → "2026-11-28|/x/y"; blank → null; anything else raises.
create or replace function public.prospect_event_ref(v text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  s text := nullif(btrim(v), '');
  d text;
  path text;
begin
  if s is null then return null; end if;
  d := split_part(s, '|', 1);
  path := lower(btrim(substr(s, length(d) + 2)));
  path := regexp_replace(regexp_replace(regexp_replace(path, '^https?://[^/]+', ''), '[?#].*$', ''), '/+$', '');
  if d !~ '^\d{4}-\d{2}-\d{2}$' or position('|' in s) = 0 or path !~ '^/\S+$' then
    raise exception 'relates_to_event must be "YYYY-MM-DD|/event-page-path" (or the full page URL after the |)';
  end if;
  return d || '|' || path;
end $$;

-- Dates, money and ids: + relates_to_event.
create or replace function public.prospect_norm_values(p jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  foreach k in array array['enquiry_date', 'next_action_date', 'delivery_due', 'invoice_by'] loop
    continue when not p ? k;
    v := nullif(btrim(p ->> k), '');
    if v is not null and v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'dates must be YYYY-MM-DD'; end if;
    o := o || jsonb_build_object(k, v::date);
  end loop;
  if (o ->> 'enquiry_date')::date > current_date + 1 then raise exception 'enquiry_date cannot be in the future'; end if;
  if p ? 'cash_month' then
    v := nullif(btrim(p ->> 'cash_month'), '');
    if v is not null and v !~ '^\d{4}-\d{2}(-\d{2})?$' then raise exception 'cash_month must be YYYY-MM (or a date in that month)'; end if;
    o := o || jsonb_build_object('cash_month', (left(v, 7) || '-01')::date);
  end if;
  if p ? 'value_gbp' then
    v := coalesce(nullif(btrim(p ->> 'value_gbp'), ''), '0');
    if v !~ '^\d+(\.\d+)?$' or v::numeric > 1e6 then raise exception 'value_gbp must be a number of pounds ≥ 0'; end if;
    o := o || jsonb_build_object('value_gbp', round(v::numeric, 2));
  end if;
  if p ? 'last_touch_at' then
    begin
      o := o || jsonb_build_object('last_touch_at', nullif(btrim(p ->> 'last_touch_at'), '')::timestamptz);
    exception when others then raise exception 'last_touch_at must be a date or ISO time';
    end;
  end if;
  if nullif(p ->> 'person_id', '') is not null then
    if p ->> 'person_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'person_id must be a customer_person uuid'; end if;
    o := o || jsonb_build_object('person_id', (p ->> 'person_id')::uuid);
  end if;
  if p ? 'relates_to_event' then o := o || jsonb_build_object('relates_to_event', public.prospect_event_ref(p ->> 'relates_to_event')); end if;
  return o;
end $$;

create or replace function public.prospect_insert(v jsonb, p_id text, pid uuid, how text, p_via text, p_by text, p_now timestamptz) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  r public.prospect_enquiry := jsonb_populate_record(null::public.prospect_enquiry, v);
  rtype text := coalesce(r.revenue_type, 'new_sale');
begin
  insert into public.prospect_enquiry (id, client_or_org, person_id, type, value_gbp, stage, cash_month, next_action, next_action_date, owner,
    last_touch_at, source, lost_reason, notes, enquiry_date, customer_market, value_basis, value_basis_note, review_status, source_ref,
    revenue_type, delivery_due, invoice_by, relates_to_event, created_by, created_at, updated_at)
  values (coalesce(p_id, gen_random_uuid()::text), r.client_or_org, pid, r.type, coalesce(r.value_gbp, 0),
    coalesce(r.stage, case rtype when 'committed_work' then 'allocated' when 'receivable' then 'scheduled' else 'qualify' end), r.cash_month, r.next_action,
    r.next_action_date, coalesce(r.owner, 'Alan'), coalesce(r.last_touch_at, p_now), r.source, r.lost_reason, r.notes, r.enquiry_date,
    coalesce(r.customer_market, 'unclassified'), coalesce(r.value_basis, 'unknown'), r.value_basis_note, coalesce(r.review_status, 'recent'), r.source_ref,
    rtype, r.delivery_due, r.invoice_by, r.relates_to_event, p_by, p_now, p_now)
  returning * into r;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (r.id, p_now, p_by, p_via, null, r.stage, jsonb_build_object('created', true, 'client', how));
  return jsonb_build_object('id', r.id, 'enquiry_ref', r.enquiry_ref, 'person_short_id', public.prospect_short_id(pid), 'match_method', how, 'created', true, 'stage', r.stage, 'revenue_type', r.revenue_type);
end $$;

create or replace function public.prospect_update(prev public.prospect_enquiry, v jsonb, how text, p_via text, p_by text, p_now timestamptz) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  r public.prospect_enquiry := jsonb_populate_record(prev, v);
  was jsonb := to_jsonb(prev);
  now_ jsonb := to_jsonb(r);
  changes jsonb := '{}'::jsonb;
  k text;
  res jsonb := jsonb_build_object('id', prev.id, 'enquiry_ref', prev.enquiry_ref, 'person_short_id', public.prospect_short_id(r.person_id), 'match_method', how);
begin
  for k in select jsonb_object_keys(v) loop
    if (was -> k) is distinct from (now_ -> k) then changes := changes || jsonb_build_object(k, jsonb_build_object('from', was -> k, 'to', now_ -> k)); end if;
  end loop;
  if changes = '{}'::jsonb then return res || jsonb_build_object('unchanged', true); end if;
  update public.prospect_enquiry set client_or_org = r.client_or_org, person_id = r.person_id, type = r.type, value_gbp = r.value_gbp, stage = r.stage,
    cash_month = r.cash_month, next_action = r.next_action, next_action_date = r.next_action_date, owner = r.owner, last_touch_at = r.last_touch_at,
    source = r.source, lost_reason = r.lost_reason, notes = r.notes, enquiry_date = r.enquiry_date, customer_market = r.customer_market,
    value_basis = r.value_basis, value_basis_note = r.value_basis_note, review_status = r.review_status, source_ref = r.source_ref,
    revenue_type = r.revenue_type, delivery_due = r.delivery_due, invoice_by = r.invoice_by, relates_to_event = r.relates_to_event, updated_at = p_now
  where id = prev.id;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (prev.id, p_now, p_by, p_via, prev.stage, r.stage, changes);
  return res || jsonb_build_object('updated', true, 'stage', r.stage, 'revenue_type', r.revenue_type, 'changes', changes);
end $$;

comment on function public.prospect_upsert(jsonb) is 'Prospects load/update for Claude via Supabase SQL (QUESTION-2026-11-09 (p) + (r) + (v)); same rules as POST /api/aigeo/prospects. Input keys: id|enquiry_ref, via, enquiry_date, client_or_org, client_email, person_id, type, revenue_type, value_gbp, value_basis, value_basis_note, customer_market, review_status, stage, cash_month, delivery_due, invoice_by, relates_to_event ("YYYY-MM-DD|/event-page-path"), next_action, next_action_date, owner, last_touch_at, source, source_ref, lost_reason, notes. Returns {id, enquiry_ref, person_short_id, match_method, created|updated|unchanged}. postgres / service_role only.';

revoke all on function public.prospect_event_ref(text), public.prospect_norm_values(jsonb), public.prospect_insert(jsonb, text, uuid, text, text, text, timestamptz),
  public.prospect_update(public.prospect_enquiry, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.prospect_upsert(jsonb) to postgres, service_role;
