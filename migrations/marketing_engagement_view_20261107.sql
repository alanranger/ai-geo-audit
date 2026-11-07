-- Release 2 (7 Nov 2026): per-recipient engagement from the email-report collector. Only campaigns whose recipient
-- lists were read to the end (events_complete) count. event_at is each recipient's FIRST open / click of an email
-- (proved 7 Nov: on a re-read, open counts rose while timestamps stayed). last_open_at / last_click_at = the latest of
-- those real times; the campaign send dates are kept as separate fields.
create or replace view public.marketing_engagement_v with (security_invoker = true) as
with d as (
  select lower(e.email) as email, e.email_id, c.sent_on,
         row_number() over (partition by lower(e.email) order by c.sent_on desc) as rn
  from public.sqs_email_events e join public.sqs_email_campaigns c using (email_id)
  where e.event_type = 'DELIVERED' and e.email is not null and c.events_complete
),
o as (select lower(email) as email, email_id, min(event_at) as first_at from public.sqs_email_events where event_type = 'OPENED' and email is not null group by 1, 2),
k as (select lower(email) as email, email_id, min(event_at) as first_at from public.sqs_email_events where event_type = 'CLICKED' and url = '' and email is not null group by 1, 2)
select d.email,
  count(*) as delivered_campaigns,
  count(o.email_id) as opened_campaigns,
  count(k.email_id) as clicked_campaigns,
  count(*) filter (where d.rn <= 5) as last5_delivered,
  count(o.email_id) filter (where d.rn <= 5) as last5_opened,
  count(k.email_id) filter (where d.rn <= 5) as last5_clicked,
  max(d.sent_on) as last_delivered_at,
  max(d.sent_on) filter (where o.email_id is not null) as last_open_campaign_at,
  max(d.sent_on) filter (where k.email_id is not null) as last_click_campaign_at,
  max(o.first_at) as last_open_at,
  max(k.first_at) as last_click_at
from d
left join o on o.email = d.email and o.email_id = d.email_id
left join k on k.email = d.email and k.email_id = d.email_id
group by d.email;
revoke all on public.marketing_engagement_v from anon, authenticated;
