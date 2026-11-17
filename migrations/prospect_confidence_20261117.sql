-- Prospects: per-record confidence (QUESTION-2026-11-17). No backfill.
-- Effective confidence = alan_confidence_pct, else confidence_pct, else the stage default.
-- GPT sets confidence_* through prospect_upsert. Alan's override is alan_confidence_pct and wins.

alter table public.prospect_enquiry
  add column if not exists confidence_pct smallint,
  add column if not exists confidence_reason text,
  add column if not exists confidence_set_at timestamptz,
  add column if not exists confidence_set_by text,
  add column if not exists alan_confidence_pct smallint;

alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_confidence_pct_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_confidence_pct_chk
  check (confidence_pct is null or confidence_pct between 0 and 100);
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_alan_confidence_pct_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_alan_confidence_pct_chk
  check (alan_confidence_pct is null or alan_confidence_pct between 0 and 100);
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_confidence_set_by_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_confidence_set_by_chk
  check (confidence_set_by is null or confidence_set_by in ('GPT', 'Alan'));

comment on column public.prospect_enquiry.confidence_pct is 'GPT confidence 0–100. Ignored when alan_confidence_pct is set.';
comment on column public.prospect_enquiry.confidence_reason is 'One line of evidence for the GPT confidence.';
comment on column public.prospect_enquiry.alan_confidence_pct is 'Alan override 0–100. Wins over confidence_pct. Null means no override.';

create or replace function public.prospect_norm_fields(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  n int;
  v text;
  allowed jsonb;
  texts constant jsonb := '{"client_or_org":200,"next_action":300,"status_note":300,"notes":500,"value_basis_note":500,"source_ref":200,"confidence_reason":300}';
  enums constant jsonb := '{"type":["1-2-1","mentoring","commission","corporate training","Academy","voucher / gift","other"],"stage":["qualify","quote","scheduled","allocated","delivered","invoiced","booked_paid","parked","closed_lost"],"owner":["Alan","GPT","Claude"],"customer_market":["D2C","B2B","unclassified"],"value_basis":["agreed","quoted","estimated","unknown"],"review_status":["recent","revalidate"],"source":["email","phone","web form","referral"],"revenue_type":["new_sale","partner_development","committed_work","receivable"],"lost_reason":["not_interested","no_response","went_elsewhere","too_expensive","not_a_fit","duplicate","other"],"confidence_set_by":["GPT","Alan"]}';
  nullable constant text[] := array['source', 'lost_reason', 'confidence_set_by'];
begin
  for k, n in select key, value::int from jsonb_each_text(texts) loop
    if p ? k then o := o || jsonb_build_object(k, left(nullif(btrim(p ->> k), ''), n)); end if;
  end loop;
  for k, allowed in select key, value from jsonb_each(enums) loop
    continue when not p ? k;
    v := nullif(btrim(p ->> k), '');
    if v is null and k = any (nullable) then o := o || jsonb_build_object(k, null); continue; end if;
    if v is null or not allowed ? v then
      raise exception '% must be one of: %', k, (select string_agg(x, ', ') from jsonb_array_elements_text(allowed) x);
    end if;
    o := o || jsonb_build_object(k, v);
  end loop;
  if o ? 'client_or_org' and o ->> 'client_or_org' is null then raise exception 'client_or_org cannot be empty'; end if;
  return o;
end $$;

create or replace function public.prospect_norm_values(p jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  foreach k in array array['enquiry_date', 'next_action_date', 'delivery_due', 'invoice_by', 'revisit_on'] loop
    continue when not p ? k;
    v := nullif(btrim(p ->> k), '');
    if v is not null and v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% must be YYYY-MM-DD', k; end if;
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
  foreach k in array array['confidence_pct', 'alan_confidence_pct'] loop
    continue when not p ? k;
    v := nullif(btrim(p ->> k), '');
    if v is not null and (v !~ '^\d+$' or v::int > 100) then raise exception '% must be a whole number from 0 to 100', k; end if;
    o := o || jsonb_build_object(k, v::int);
  end loop;
  if p ? 'confidence_set_at' then
    begin
      o := o || jsonb_build_object('confidence_set_at', nullif(btrim(p ->> 'confidence_set_at'), '')::timestamptz);
    exception when others then raise exception 'confidence_set_at must be a date or ISO time';
    end;
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
    revenue_type, delivery_due, invoice_by, relates_to_event, revisit_on, status_note,
    confidence_pct, confidence_reason, confidence_set_at, confidence_set_by, alan_confidence_pct,
    created_by, created_at, updated_at)
  values (coalesce(p_id, gen_random_uuid()::text), r.client_or_org, pid, r.type, coalesce(r.value_gbp, 0),
    coalesce(r.stage, case rtype when 'committed_work' then 'allocated' when 'receivable' then 'scheduled' else 'qualify' end), r.cash_month, r.next_action,
    r.next_action_date, coalesce(r.owner, 'Alan'), coalesce(r.last_touch_at, p_now), r.source, r.lost_reason, r.notes, r.enquiry_date,
    coalesce(r.customer_market, 'unclassified'), coalesce(r.value_basis, 'unknown'), r.value_basis_note, coalesce(r.review_status, 'recent'), r.source_ref,
    rtype, r.delivery_due, r.invoice_by, r.relates_to_event, r.revisit_on, r.status_note,
    r.confidence_pct, r.confidence_reason, r.confidence_set_at, r.confidence_set_by, r.alan_confidence_pct,
    p_by, p_now, p_now)
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
    revenue_type = r.revenue_type, delivery_due = r.delivery_due, invoice_by = r.invoice_by, relates_to_event = r.relates_to_event,
    revisit_on = r.revisit_on, status_note = r.status_note,
    confidence_pct = r.confidence_pct, confidence_reason = r.confidence_reason, confidence_set_at = r.confidence_set_at,
    confidence_set_by = r.confidence_set_by, alan_confidence_pct = r.alan_confidence_pct, updated_at = p_now
  where id = prev.id;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (prev.id, p_now, p_by, p_via, prev.stage, r.stage, changes);
  return res || jsonb_build_object('updated', true, 'stage', r.stage, 'revenue_type', r.revenue_type, 'changes', changes);
end $$;

comment on function public.prospect_upsert(jsonb) is 'Prospects load/update. Also accepts confidence_pct, confidence_reason, confidence_set_at, confidence_set_by (GPT/Alan), alan_confidence_pct. History records each changed field. postgres / service_role only.';
