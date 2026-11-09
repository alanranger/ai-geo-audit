-- Prospects (QUESTION-2026-11-09 (r), Alan approved via GPT): revenue type, committed work, receivables, partner records.
--   revenue_type: new_sale (default; the weighted pipeline) / partner_development (ongoing B2B partner, no specific order:
--     listed, never in £ totals, no stalled alarm) / committed_work (allocated, delivery pending: full value in its cash
--     month as "committed", never paid automatically) / receivable (invoiced, payment unverified: "Cash to collect", never
--     pipeline or new sales; paid only on Booking Sheet / provider evidence).
--   stage "allocated" = Allocated · delivery pending (committed work only); delivery_due + invoice_by for committed work.
-- prospect_upsert (unchanged entry point) accepts the new keys through its helpers below. The table had 0 rows.
alter table public.prospect_enquiry
  add column if not exists revenue_type text not null default 'new_sale',
  add column if not exists delivery_due date,
  add column if not exists invoice_by date;
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_revenue_type_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_revenue_type_chk check (revenue_type in ('new_sale', 'partner_development', 'committed_work', 'receivable'));
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_stage_check;
alter table public.prospect_enquiry add constraint prospect_enquiry_stage_check check (stage in ('qualify', 'quote', 'scheduled', 'allocated', 'booked_paid', 'closed_lost'));
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_allocated_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_allocated_chk check (stage <> 'allocated' or revenue_type = 'committed_work');
create index if not exists prospect_enquiry_revenue_type_idx on public.prospect_enquiry (revenue_type);
comment on column public.prospect_enquiry.revenue_type is 'new_sale (weighted pipeline) / partner_development (counted, never in £ totals) / committed_work (full value in cash month, "committed") / receivable (Cash to collect, never new sales).';
comment on column public.prospect_enquiry.delivery_due is 'Committed work: delivery deadline (e.g. judging due).';
comment on column public.prospect_enquiry.invoice_by is 'Committed work: date the invoice must be sent by.';

-- Choice fields: + revenue_type, + stage allocated.
create or replace function public.prospect_norm_fields(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  n int;
  v text;
  allowed jsonb;
  texts constant jsonb := '{"client_or_org":200,"next_action":300,"lost_reason":300,"notes":500,"value_basis_note":500,"source_ref":200}';
  enums constant jsonb := '{"type":["1-2-1","mentoring","commission","corporate training","Academy","voucher / gift","other"],"stage":["qualify","quote","scheduled","allocated","booked_paid","closed_lost"],"owner":["Alan","GPT","Claude"],"customer_market":["D2C","B2B","unclassified"],"value_basis":["agreed","quoted","estimated","unknown"],"review_status":["recent","revalidate"],"source":["email","phone","web form","referral"],"revenue_type":["new_sale","partner_development","committed_work","receivable"]}';
begin
  for k, n in select key, value::int from jsonb_each_text(texts) loop
    if p ? k then o := o || jsonb_build_object(k, left(nullif(btrim(p ->> k), ''), n)); end if;
  end loop;
  for k, allowed in select key, value from jsonb_each(enums) loop
    continue when not p ? k;
    v := nullif(btrim(p ->> k), '');
    if v is null and k = 'source' then o := o || jsonb_build_object(k, null); continue; end if;
    if v is null or not allowed ? v then
      raise exception '% must be one of: %', k, (select string_agg(x, ', ') from jsonb_array_elements_text(allowed) x);
    end if;
    o := o || jsonb_build_object(k, v);
  end loop;
  if o ? 'client_or_org' and o ->> 'client_or_org' is null then raise exception 'client_or_org cannot be empty'; end if;
  return o;
end $$;

-- Dates, money and ids: + delivery_due, invoice_by.
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
  return o;
end $$;

-- Stage rules: + allocated is committed work only (and its default); booked_paid stays the admin API's job.
create or replace function public.prospect_check(prev public.prospect_enquiry, v jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  rtype text := coalesce(v ->> 'revenue_type', prev.revenue_type, 'new_sale');
  stage text := coalesce(v ->> 'stage', prev.stage, case rtype when 'committed_work' then 'allocated' when 'receivable' then 'scheduled' else 'qualify' end);
begin
  if prev.id is not null then
    if v ? 'enquiry_date' and v ->> 'enquiry_date' is null then raise exception 'enquiry_date cannot be cleared'; end if;
  else
    if v ->> 'client_or_org' is null or v ->> 'type' is null then raise exception 'a new enquiry needs client_or_org and type'; end if;
    if v ->> 'enquiry_date' is null then raise exception 'a new enquiry needs enquiry_date (the date it was received, YYYY-MM-DD)'; end if;
    if v ->> 'value_basis' is null and coalesce((v ->> 'value_gbp')::numeric, 0) > 0 then raise exception 'a new enquiry with a value needs value_basis (agreed / quoted / estimated / unknown)'; end if;
  end if;
  if stage = 'allocated' and rtype <> 'committed_work' then raise exception 'stage allocated (Allocated · delivery pending) is for revenue_type committed_work only'; end if;
  if stage = 'booked_paid' and prev.stage is distinct from 'booked_paid' then
    raise exception 'booked_paid needs a Booking Sheet sale for the same client (or, for a receivable, provider evidence): use POST /api/aigeo/prospects with matched_sale / paid_evidence';
  end if;
  if stage = 'closed_lost' and coalesce(v ->> 'lost_reason', prev.lost_reason) is null then raise exception 'closed_lost needs lost_reason'; end if;
end $$;

create or replace function public.prospect_insert(v jsonb, p_id text, pid uuid, how text, p_via text, p_by text, p_now timestamptz) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  r public.prospect_enquiry := jsonb_populate_record(null::public.prospect_enquiry, v);
  rtype text := coalesce(r.revenue_type, 'new_sale');
begin
  insert into public.prospect_enquiry (id, client_or_org, person_id, type, value_gbp, stage, cash_month, next_action, next_action_date, owner,
    last_touch_at, source, lost_reason, notes, enquiry_date, customer_market, value_basis, value_basis_note, review_status, source_ref,
    revenue_type, delivery_due, invoice_by, created_by, created_at, updated_at)
  values (coalesce(p_id, gen_random_uuid()::text), r.client_or_org, pid, r.type, coalesce(r.value_gbp, 0),
    coalesce(r.stage, case rtype when 'committed_work' then 'allocated' when 'receivable' then 'scheduled' else 'qualify' end), r.cash_month, r.next_action,
    r.next_action_date, coalesce(r.owner, 'Alan'), coalesce(r.last_touch_at, p_now), r.source, r.lost_reason, r.notes, r.enquiry_date,
    coalesce(r.customer_market, 'unclassified'), coalesce(r.value_basis, 'unknown'), r.value_basis_note, coalesce(r.review_status, 'recent'), r.source_ref,
    rtype, r.delivery_due, r.invoice_by, p_by, p_now, p_now)
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
    revenue_type = r.revenue_type, delivery_due = r.delivery_due, invoice_by = r.invoice_by, updated_at = p_now
  where id = prev.id;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (prev.id, p_now, p_by, p_via, prev.stage, r.stage, changes);
  return res || jsonb_build_object('updated', true, 'stage', r.stage, 'revenue_type', r.revenue_type, 'changes', changes);
end $$;

comment on function public.prospect_upsert(jsonb) is 'Prospects load/update for Claude via Supabase SQL (QUESTION-2026-11-09 (p) + (r)); same rules as POST /api/aigeo/prospects. Input keys: id|enquiry_ref, via, enquiry_date, client_or_org, client_email, person_id, type, revenue_type, value_gbp, value_basis, value_basis_note, customer_market, review_status, stage, cash_month, delivery_due, invoice_by, next_action, next_action_date, owner, last_touch_at, source, source_ref, lost_reason, notes. Returns {id, enquiry_ref, person_short_id, match_method, created|updated|unchanged}. postgres / service_role only.';

revoke all on function public.prospect_norm_fields(jsonb), public.prospect_norm_values(jsonb), public.prospect_check(public.prospect_enquiry, jsonb),
  public.prospect_insert(jsonb, text, uuid, text, text, text, timestamptz), public.prospect_update(public.prospect_enquiry, jsonb, text, text, text, timestamptz),
  public.prospect_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.prospect_upsert(jsonb) to postgres, service_role;
