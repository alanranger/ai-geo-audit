-- Prospects (QUESTION-2026-11-09 (p)): re-creates public.prospect_upsert only, moving prospect_check after identity +
-- de-dupe so a partial update by source_ref (+ client_email) finds its enquiry before the create-only rules run. The call
-- is one transaction, so a refused create also undoes any new "prospect" customer_person. Applied after
-- prospect_upsert_function_20261109 (that file already shows this final state). Grants unchanged: postgres / service_role only.
create or replace function public.prospect_upsert(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v jsonb := public.prospect_norm_fields(p) || public.prospect_norm_values(p);
  via text := coalesce(nullif(btrim(p ->> 'via'), ''), 'claude');
  p_id text := nullif(btrim(p ->> 'id'), '');
  email text := lower(nullif(btrim(p ->> 'client_email'), ''));
  now_ts timestamptz := now();
  prev public.prospect_enquiry;
  pid uuid;
  how text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'p must be a JSON object'; end if;
  if via not in ('claude', 'gpt') then raise exception 'via must be claude or gpt'; end if;
  if p_id is not null and p_id !~ '^[A-Za-z0-9._:-]{3,80}$' then raise exception 'id: 3–80 letters, digits, . _ : -'; end if;
  if email is not null and email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'client_email must be an email address'; end if;
  select * into prev from public.prospect_enquiry e where e.id = p_id or e.enquiry_ref = nullif(btrim(p ->> 'enquiry_ref'), '');
  if v ->> 'person_id' is not null then
    select cp.person_id into pid from public.customer_person cp where cp.person_id = (v ->> 'person_id')::uuid;
    if pid is null then raise exception 'person_id not found in customer_person'; end if;
    how := 'given';
  elsif prev.id is not null and email is null then
    pid := prev.person_id; how := 'kept';
  else
    select x.pid, x.how into pid, how from public.prospect_person(email, coalesce(v ->> 'client_or_org', prev.client_or_org), now_ts) x;
  end if;
  v := v || jsonb_build_object('person_id', pid);
  if prev.id is null and v ->> 'source_ref' is not null then
    select * into prev from public.prospect_enquiry e where e.source_ref = v ->> 'source_ref' and e.person_id = pid;
  end if;
  -- after identity + de-dupe: the call is one transaction, so a refused create also undoes any new prospect record
  perform public.prospect_check(prev, v);
  if prev.id is null then
    return public.prospect_insert(v, p_id, pid, how, via, format('Alan via %s (prospect_upsert)', case via when 'gpt' then 'GPT' else 'Claude' end), now_ts);
  end if;
  return public.prospect_update(prev, v, how, via, format('Alan via %s (prospect_upsert)', case via when 'gpt' then 'GPT' else 'Claude' end), now_ts);
end $$;
revoke all on function public.prospect_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.prospect_upsert(jsonb) to postgres, service_role;
