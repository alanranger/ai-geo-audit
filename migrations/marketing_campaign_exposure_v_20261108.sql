-- Customer query Stage B (8 Nov 2026): per address, which of the latest 40 fully collected campaigns were delivered,
-- opened and clicked. Read by the customer rebuild into facts.camps; older campaigns are outside the stored window and
-- make "received / opened campaign X" unknown rather than "no".
create or replace view public.marketing_campaign_exposure_v as
with recent as (
  select email_id, sent_on from public.sqs_email_campaigns where events_complete order by sent_on desc limit 40
), ev as (
  select lower(e.email) as email, e.email_id, e.event_type, r.sent_on
  from public.sqs_email_events e join recent r using (email_id)
  where e.email is not null and e.event_type in ('DELIVERED','OPENED','CLICKED')
  group by 1, 2, 3, 4
)
select email,
  coalesce(array_agg(email_id order by sent_on desc) filter (where event_type = 'DELIVERED'), '{}') as d,
  coalesce(array_agg(email_id order by sent_on desc) filter (where event_type = 'OPENED'), '{}') as o,
  coalesce(array_agg(email_id order by sent_on desc) filter (where event_type = 'CLICKED'), '{}') as k
from ev group by email;
revoke all on public.marketing_campaign_exposure_v from anon, authenticated;
