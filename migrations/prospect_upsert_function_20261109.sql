-- Prospects load function for Claude (QUESTION-2026-11-09 (p), Alan authorised via GPT): public.prospect_upsert(p jsonb).
-- Same rules as POST /api/aigeo/prospects (api/aigeo/prospects.js), for loads made through Supabase SQL so no names or
-- emails pass through Drive. Only postgres / service_role can execute it (no public / anon / authenticated grant).
--
-- Input p (JSON object; only the keys sent are validated and written on an update):
--   id | enquiry_ref     optional: update that enquiry (else de-dupe by source_ref + client, else create)
--   via                 'claude' (default) | 'gpt'
--   enquiry_date        YYYY-MM-DD, the date received: REQUIRED on create, never in the future, never cleared
--   client_or_org       text ≤200: REQUIRED on create
--   client_email        optional; matched exactly first
--   person_id           optional customer_person uuid (must exist)
--   type                '1-2-1' | 'mentoring' | 'commission' | 'corporate training' | 'Academy' | 'voucher / gift' | 'other': REQUIRED on create
--   value_gbp           number ≥0, the FULL order value (stage probability weights it separately)
--   value_basis         'agreed' | 'quoted' | 'estimated' | 'unknown': REQUIRED on create when value_gbp > 0
--   value_basis_note    text ≤500 (rationale and source of the value)
--   customer_market     'D2C' | 'B2B' | 'unclassified' (default unclassified)
--   review_status       'recent' | 'revalidate' (default recent)
--   stage               'qualify' (default) | 'quote' | 'scheduled' | 'closed_lost' (needs lost_reason).
--                       'booked_paid' is refused here: it needs a same-client Booking Sheet match (admin API matched_sale).
--   cash_month          YYYY-MM or YYYY-MM-DD (stored as the 1st) or null = undated potential
--   next_action ≤300, next_action_date YYYY-MM-DD, owner 'Alan' (default) | 'GPT' | 'Claude'
--   last_touch_at       date or ISO time (default now)
--   source              'email' | 'phone' | 'web form' | 'referral' | null
--   source_ref          text ≤200: the source message id (Gmail), unique per client
--   lost_reason ≤300, notes ≤500
-- Client: person_id, else exact email, else an exact full name naming exactly ONE contact with an email, else a new
-- "prospect" customer_person with NO consent fields (no subscription / suppression / audience membership).
-- Returns { id, enquiry_ref, person_short_id, match_method, created: true } or { …, updated: true, changes }
-- or { …, unchanged: true }. Every create / change writes a prospect_enquiry_history row with via.
-- Applied as Supabase migrations prospect_upsert_function_20261109 + prospect_upsert_check_after_dedupe_20261109
-- (the second re-created prospect_upsert only, moving prospect_check after identity + de-dupe); this file is the final state.

create or replace function public.prospect_norm_name(s text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(s, '')), '\(.*?\)', ' ', 'g'), '[^a-z'' -]', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.prospect_short_id(pid uuid) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when pid is null then null else 'C-' || upper(left(replace(pid::text, '-', ''), 6)) end
$$;

-- Text + choice fields (same limits, lists and messages as enquiryPatch in api/aigeo/prospects.js).
create or replace function public.prospect_norm_fields(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  n int;
  v text;
  allowed jsonb;
  texts constant jsonb := '{"client_or_org":200,"next_action":300,"lost_reason":300,"notes":500,"value_basis_note":500,"source_ref":200}';
  enums constant jsonb := '{"type":["1-2-1","mentoring","commission","corporate training","Academy","voucher / gift","other"],"stage":["qualify","quote","scheduled","booked_paid","closed_lost"],"owner":["Alan","GPT","Claude"],"customer_market":["D2C","B2B","unclassified"],"value_basis":["agreed","quoted","estimated","unknown"],"review_status":["recent","revalidate"],"source":["email","phone","web form","referral"]}';
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

-- Dates, money and ids.
create or replace function public.prospect_norm_values(p jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  o jsonb := '{}'::jsonb;
  k text;
  v text;
begin
  foreach k in array array['enquiry_date', 'next_action_date'] loop
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

-- Stage + required-field rules (stageRule / requiredFields in the API); booked_paid is the admin API's job.
create or replace function public.prospect_check(prev public.prospect_enquiry, v jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  stage text := coalesce(v ->> 'stage', prev.stage, 'qualify');
begin
  if prev.id is not null then
    if v ? 'enquiry_date' and v ->> 'enquiry_date' is null then raise exception 'enquiry_date cannot be cleared'; end if;
  else
    if v ->> 'client_or_org' is null or v ->> 'type' is null then raise exception 'a new enquiry needs client_or_org and type'; end if;
    if v ->> 'enquiry_date' is null then raise exception 'a new enquiry needs enquiry_date (the date it was received, YYYY-MM-DD)'; end if;
    if v ->> 'value_basis' is null and coalesce((v ->> 'value_gbp')::numeric, 0) > 0 then raise exception 'a new enquiry with a value needs value_basis (agreed / quoted / estimated / unknown)'; end if;
  end if;
  if stage = 'booked_paid' and prev.stage is distinct from 'booked_paid' then
    raise exception 'booked_paid needs a Booking Sheet sale for the same client: use POST /api/aigeo/prospects with matched_sale';
  end if;
  if stage = 'closed_lost' and coalesce(v ->> 'lost_reason', prev.lost_reason) is null then raise exception 'closed_lost needs lost_reason'; end if;
end $$;

-- Client ID: exact email → exact unique name (with an email) → new "prospect" record with no consent fields.
create or replace function public.prospect_person(p_email text, p_name text, p_now timestamptz, out pid uuid, out how text)
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  ids uuid[];
  n int;
  nname text := public.prospect_norm_name(p_name);
  anchor text;
begin
  if p_email is not null then
    select array_agg(c.person_id) into ids from (select cp.person_id from public.customer_person cp where cp.email = p_email limit 5) c;
    if coalesce(cardinality(ids), 0) = 1 then pid := ids[1]; how := 'email_exact'; return; end if;
  end if;
  select array_agg(c.person_id) into ids
  from (select cp.person_id, cp.display_name, cp.email from public.customer_person cp where lower(cp.display_name) = lower(btrim(coalesce(p_name, ''))) limit 10) c
  where c.email is not null and public.prospect_norm_name(c.display_name) = nname;
  n := coalesce(cardinality(ids), 0);
  if nname <> '' and n = 1 then pid := ids[1]; how := 'name_exact_unique'; return; end if;
  anchor := case when p_email is not null then 'email:' || p_email else 'prospect:' || gen_random_uuid()::text end;
  select cp.person_id into pid from public.customer_person cp where cp.anchor_key = anchor;
  if pid is null then
    insert into public.customer_person (anchor_key, email, display_name, facts, created_at, updated_at)
    values (anchor, p_email, nullif(left(btrim(coalesce(p_name, '')), 200), ''),
      jsonb_build_object('record_type', 'prospect', 'name', nullif(btrim(coalesce(p_name, '')), ''), 'email', p_email, 'prospect', jsonb_build_object('source', 'prospect_enquiry', 'created_at', p_now)),
      p_now, p_now)
    returning person_id into pid;
  end if;
  how := case when n > 1 then format('created_prospect (name matched %s contacts)', n) else 'created_prospect' end;
end $$;

create or replace function public.prospect_insert(v jsonb, p_id text, pid uuid, how text, p_via text, p_by text, p_now timestamptz) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  r public.prospect_enquiry := jsonb_populate_record(null::public.prospect_enquiry, v);
begin
  insert into public.prospect_enquiry (id, client_or_org, person_id, type, value_gbp, stage, cash_month, next_action, next_action_date, owner,
    last_touch_at, source, lost_reason, notes, enquiry_date, customer_market, value_basis, value_basis_note, review_status, source_ref, created_by, created_at, updated_at)
  values (coalesce(p_id, gen_random_uuid()::text), r.client_or_org, pid, r.type, coalesce(r.value_gbp, 0), coalesce(r.stage, 'qualify'), r.cash_month, r.next_action,
    r.next_action_date, coalesce(r.owner, 'Alan'), coalesce(r.last_touch_at, p_now), r.source, r.lost_reason, r.notes, r.enquiry_date,
    coalesce(r.customer_market, 'unclassified'), coalesce(r.value_basis, 'unknown'), r.value_basis_note, coalesce(r.review_status, 'recent'), r.source_ref, p_by, p_now, p_now)
  returning * into r;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (r.id, p_now, p_by, p_via, null, r.stage, jsonb_build_object('created', true, 'client', how));
  return jsonb_build_object('id', r.id, 'enquiry_ref', r.enquiry_ref, 'person_short_id', public.prospect_short_id(pid), 'match_method', how, 'created', true, 'stage', r.stage);
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
    value_basis = r.value_basis, value_basis_note = r.value_basis_note, review_status = r.review_status, source_ref = r.source_ref, updated_at = p_now
  where id = prev.id;
  insert into public.prospect_enquiry_history (enquiry_id, at, by, via, from_stage, to_stage, changes)
  values (prev.id, p_now, p_by, p_via, prev.stage, r.stage, changes);
  return res || jsonb_build_object('updated', true, 'stage', r.stage, 'changes', changes);
end $$;

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

comment on function public.prospect_upsert(jsonb) is 'Prospects load/update for Claude via Supabase SQL (QUESTION-2026-11-09 (p)); same rules as POST /api/aigeo/prospects. Input keys: id|enquiry_ref, via, enquiry_date, client_or_org, client_email, person_id, type, value_gbp, value_basis, value_basis_note, customer_market, review_status, stage, cash_month, next_action, next_action_date, owner, last_touch_at, source, source_ref, lost_reason, notes. Returns {id, enquiry_ref, person_short_id, match_method, created|updated|unchanged}. postgres / service_role only.';

revoke all on function public.prospect_norm_name(text), public.prospect_short_id(uuid), public.prospect_norm_fields(jsonb), public.prospect_norm_values(jsonb),
  public.prospect_check(public.prospect_enquiry, jsonb), public.prospect_person(text, text, timestamptz),
  public.prospect_insert(jsonb, text, uuid, text, text, text, timestamptz), public.prospect_update(public.prospect_enquiry, jsonb, text, text, text, timestamptz),
  public.prospect_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.prospect_upsert(jsonb) to postgres, service_role;
