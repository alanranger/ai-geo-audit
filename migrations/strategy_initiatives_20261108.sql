-- Quarter plan + initiatives as the canonical programme records (Claude build question 2026-11-08, approved v2 plan).
-- Chain: business objective + KPI (Targets panel roadmap) → initiative → campaign (strategy_campaigns, or a derived
-- weekly-email / event record) → channel delivery (campaign step key, or send|<campaign_key> for a theme campaign's own
-- send) → content asset. Quarters REFERENCE initiatives (strategy_quarter_plans.initiative_keys); an initiative can span
-- quarters and is never copied. strategy_quarter_actions / strategy_campaigns / strategy_campaign_steps are not altered:
-- every existing quarter action is mapped once (ref_type 'action') under an initiative or Housekeeping, with its ticks,
-- dates and history left where they are. Written only by api/aigeo/strategy-initiatives.js (admin key, service role).

create table if not exists public.strategy_initiatives (
  property_url text not null,
  initiative_key text not null,
  kind text not null default 'initiative' check (kind in ('initiative', 'programme', 'housekeeping')),
  title text not null,
  quarter_keys text[] not null default '{}',
  start_date date,
  end_date date,
  summary text,
  delivery_plan text,
  why_now text,
  measure text check (measure in ('gift', 'pnm', 'dated', 'academy', 'milestones', 'lead_times', 'purpose')),
  focus jsonb not null default '{}'::jsonb,
  target jsonb,
  forecast jsonb,
  status_rule jsonb not null default '{"type": "not_set"}'::jsonb,
  status_label text,
  owner text not null check (owner in ('Claude', 'GPT', 'Alan')),
  owner_detail text,
  next_action text,
  next_action_date date,
  review_date date,
  sort_order integer not null default 0,
  history jsonb not null default '[]'::jsonb,
  set_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_url, initiative_key),
  check (kind = 'housekeeping' or (next_action_date is not null and review_date is not null))
);

create table if not exists public.strategy_quarter_plans (
  property_url text not null,
  quarter_key text not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  theme text not null,
  review_note text,
  milestone_key text,
  initiative_keys text[] not null default '{}',
  programme_key text,
  housekeeping_key text,
  history jsonb not null default '[]'::jsonb,
  set_by text not null,
  updated_at timestamptz not null default now(),
  primary key (property_url, quarter_key),
  check (end_date >= start_date)
);

create table if not exists public.strategy_initiative_links (
  property_url text not null,
  ref_type text not null check (ref_type in ('campaign', 'delivery', 'action')),
  ref_key text not null,
  initiative_key text not null,
  role text not null default 'primary' check (role in ('primary', 'supporting')),
  purpose_primary text check (purpose_primary in ('sell', 'educate', 'inspire', 'nurture')),
  purpose_secondary text[] not null default '{}',
  module_purposes jsonb,
  related_ref text,
  note text,
  history jsonb not null default '[]'::jsonb,
  set_by text not null,
  set_at timestamptz not null default now(),
  primary key (property_url, ref_type, ref_key, initiative_key),
  foreign key (property_url, initiative_key) references public.strategy_initiatives (property_url, initiative_key),
  check (purpose_secondary <@ array['sell', 'educate', 'inspire', 'nurture']::text[]),
  check (role = 'primary' or (purpose_primary is null and purpose_secondary = '{}'))
);
create unique index if not exists strategy_initiative_links_one_primary
  on public.strategy_initiative_links (property_url, ref_type, ref_key) where role = 'primary';
create index if not exists strategy_initiative_links_initiative on public.strategy_initiative_links (property_url, initiative_key);

-- used_in: delivery keys (step|… / send|…) or initiative|<initiative_key> for an asset that serves a whole initiative.
create table if not exists public.strategy_content_assets (
  property_url text not null,
  asset_key text not null,
  kind text not null check (kind in ('page', 'email', 'newsletter', 'video', 'blog', 'image', 'post', 'document')),
  title text not null,
  url text,
  status text not null default 'existing' check (status in ('existing', 'draft', 'planned', 'retired')),
  reuse boolean not null default true,
  used_in text[] not null default '{}',
  note text,
  history jsonb not null default '[]'::jsonb,
  set_by text not null,
  set_at timestamptz not null default now(),
  primary key (property_url, asset_key)
);

alter table public.strategy_initiatives enable row level security;
alter table public.strategy_quarter_plans enable row level security;
alter table public.strategy_initiative_links enable row level security;
alter table public.strategy_content_assets enable row level security;
revoke all on public.strategy_initiatives, public.strategy_quarter_plans, public.strategy_initiative_links, public.strategy_content_assets from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Seed (approved v2, 8 Nov 2026). Editable afterwards through the admin API; "on conflict do nothing" never overwrites.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.strategy_initiatives (property_url, initiative_key, kind, title, quarter_keys, start_date, end_date, summary, delivery_plan, why_now, measure, focus, target, forecast, status_rule, status_label, owner, owner_detail, next_action, next_action_date, review_date, sort_order, set_by, history)
select 'https://www.alanranger.com', v.k, v.kind, v.title, v.qs::text[], v.sd::date, v.ed::date, v.summary, v.dplan, v.why, v.measure, v.focus::jsonb, v.target::jsonb, v.forecast::jsonb, v.rule::jsonb, v.slabel, v.owner, v.odetail, v.next, v.nd::date, v.rd::date, v.so,
  'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)',
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)', 'note', 'migration seed strategy_initiatives_20261108'))
from (values
  ('q1-gifts-christmas', 'initiative', 'Gifts & Christmas revenue', '{q1-2026}', '2026-11-01', '2026-12-31',
   'Digital gift vouchers · gift tuition (1-to-1) · January beginners as a gift. Black Friday / Cyber Monday (27–30 Nov) is a promotion moment; no offer is approved. December reminders use the real delivery terms (digital vouchers arrive by email).',
   'gift story now → main push before the Black Friday noise → BF/CM 27–30 Nov → December reminders with true delivery terms',
   'Nov–Dec is the gift season; the gift story starts before the Black Friday noise.',
   'gift', '{"bfcm": {"start": "2026-11-27", "end": "2026-11-30", "offer_approved": false}}',
   '{"approved": {"by": "Alan", "at": "2026-11-08T12:29:00Z", "source": "Alan approved the base gift target with the v2 quarter plan, 8 Nov 2026 12:29"}, "window": {"start": "2026-11-01", "end": "2026-12-31"}, "total": 2100, "lines": [{"key": "vouchers", "label": "Gift voucher issue receipts", "amount": 1100, "actual": "booking_sheet_category", "category": 8}, {"key": "gift_121", "label": "Gift 1-to-1 sales", "amount": 1000, "actual": "evidence", "evidence": []}], "stretch": {"approved": false, "label": "Stretch (unapproved reference only)", "lines": [{"key": "vouchers", "amount": 1600}, {"key": "gift_121", "amount": 2000}]}, "baselines": [{"label": "Gift voucher issue receipts, Nov–Dec", "note": "context only", "values": [{"year": 2023, "amount": 1615, "units": 11}, {"year": 2024, "amount": 1100, "units": 6}, {"year": 2025, "amount": 100, "units": 2}]}, {"label": "1-to-1 sales, Nov–Dec", "note": "all non-JLR 1-to-1, context only, not like-for-like gift actuals", "values": [{"year": 2024, "amount": 3420}, {"year": 2025, "amount": 305}]}]}',
   null, '{"type": "target", "benchmark": "straight-line pace through the target window", "needs_known_actuals": true}', null,
   'GPT', 'GPT (gift story, timing) · Claude (actuals)', 'Gift email', '2026-11-16', '2026-11-16', 1),
  ('q1-pnm-repeat', 'initiative', 'Pick n Mix plans & repeat clients', '{q1-2026}', '2026-11-08', '2026-12-31',
   'Kick-Starter (up to 45 min, completed by 15 Dec) · launch email to 126 clients (incl. 23 former plan clients) plus one business copy = 127 sends · course-end progression with the plan sheet on beginners last nights. A promised January restart is an opportunity, not a sale.',
   'launch email (scheduled) · social follow-through · former-plan returners · plan sheet on last nights',
   'Relaunch with the new terms; plans are the repeat-revenue base for 2027.',
   'pnm', '{"campaign_key": "theme|pick-n-mix-kick-starter-2026-11", "course_last_nights": true}',
   '{"milestone": "plans", "note": "cumulative plans since the relaunch date (Targets panel); plan receipts counted once, never instalments plus contracted value"}',
   null, '{"type": "milestone_pace", "metric": "plans", "start": "relaunch", "benchmark": "straight-line pace from the relaunch date to the milestone date"}', 'In progress',
   'GPT', 'GPT (campaign) · Alan (plan conversations)', 'Launch email goes out (scheduled)', '2026-11-10', '2026-11-17', 2),
  ('q1-near-term-workshops', 'initiative', 'Near-term workshop revenue', '{q1-2026}', '2026-11-08', '2027-01-31',
   'Prioritised by GP and booking likelihood. Macro: promote now with the full practical journey (focus bracketing → stacking → reviewing results, taught end to end). January courses and the Lake District are visible now.',
   'targeted sends, not one email per event',
   'Dated places to the end of January are the nearest cash; each product sells on its own lead time.',
   'dated', '{"events": ["macro", "norfolk", "lake district"], "courses_from": "2027-01-01", "courses_to": "2027-01-31", "window_end": "2027-01-31", "event_rule": {"from": "2026-11-08", "to": "2027-01-31"}, "rule_priority": 20}',
   null, '{"source": "Strategy money tile (Next 3 months)", "note": "full-price potential and the likely forecast are shown separately and never added"}',
   '{"type": "not_set"}', null,
   'GPT', 'GPT (targeting, timing) · Claude (capacity, GP)', 'Macro email + posts', '2026-11-12', '2026-11-16', 3),
  ('q1-academy-progression', 'initiative', 'Academy & supported progression', '{q1-2026}', '2026-10-01', '2026-12-31',
   'Convert suitable learners and trial users to paid membership, mentoring, Zoom or RPS support where relevant; keep existing members; find where trials drop off. No conversion target until a trial cohort is defined.',
   'trial drop-off review · member retention note',
   'Academy is a revenue and relationship line, not an aside; trial starts have fallen and the cause is not known yet.',
   'academy', '{}', null, null, '{"type": "not_set"}', null,
   'Claude', 'Claude (insight) · GPT (messages)', 'Trial drop-off review', '2026-11-23', '2026-11-30', 4),
  ('prog-learning-relationships', 'programme', 'Learning & client relationships (ongoing)', '{q1-2026,q2-2027,q3-2027,q4-2027}', '2026-10-01', '2027-09-30',
   'Light & Logic (15th, folded into the weekly email) · reused YouTube lessons and blog posts · client stories (with permission). Sell / Educate / Inspire / Nurture tag on each delivery. No production quotas, no new video spend and no bulk blog rework without Alan''s approval.',
   'next 4 weeks'' content mix proposed by GPT for Alan''s approval',
   'Trust, enjoyment, learning and return visits support every initiative; they are not counted as separate revenue.',
   'purpose', '{"light_and_logic_day": 15}', null, null, '{"type": "not_set"}', 'Ongoing',
   'GPT', 'GPT (4-week mix proposal) · Alan (approves)', 'Next 4 weeks'' content mix proposed for Alan''s approval', '2026-11-16', '2026-11-30', 90),
  ('housekeeping', 'housekeeping', 'Housekeeping', '{q1-2026,q2-2027,q3-2027,q4-2027}', '2026-10-01', '2027-09-30',
   'Listing, page and tooling tasks that support the plan but are not an initiative.', null, null,
   null, '{}', null, null, '{"type": "none"}', null,
   'Alan', 'Alan (decisions) · Cursor (builds)', 'Review open housekeeping items', '2026-11-16', '2026-11-30', 99),
  ('q2-spring-summer-bookings', 'initiative', 'Spring & summer bookings', '{q1-2026,q2-2027}', '2026-11-08', '2027-03-31',
   'Long-lead residentials announced in Q1 (plan clients first); an early-January programme presentation; main pushes and last places follow each product''s own lead time, not one quarter-wide date.',
   'announce long-lead dates now · plan clients first · early-January programme presentation',
   'Long-lead residentials sell months ahead; waiting until January loses them.',
   'lead_times', '{"event_rule": {"from": "2027-02-01", "to": "2027-09-30"}, "rule_priority": 40}', null, null, '{"type": "not_set"}', 'Start in Q1',
   'GPT', 'GPT (timing, channels) · Claude (lead times, capacity)', 'Announce long-lead 2027 residentials to plan clients first', '2026-11-30', '2026-12-07', 11),
  ('q2-new-year-learners', 'initiative', 'New-year learners & progression', '{q2-2027}', '2027-01-01', '2027-03-31',
   'Jan & Mar beginners → next course / workshop / Academy / 1-to-1 → plans. Useful learning and confidence are the message; each progression step is measured rather than forcing everyone into a plan.',
   'beginners → next step sequence · measure each step', 'New-year learners are the front door for the year''s repeat clients.',
   'milestones', '{"metrics": ["beginners"], "event_rule": {"from": "2027-02-01", "to": "2027-03-31", "kinds": ["course"]}, "rule_priority": 30}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (sequence, messages) · Claude (progression data)', 'Brief the January beginners progression sequence', '2026-12-14', '2027-01-04', 12),
  ('q2-academy-mentoring-rps', 'initiative', 'Academy, mentoring & RPS', '{q2-2027}', '2027-01-01', '2027-03-31',
   'Participation, conversion and retention; mentoring, Zoom and RPS support as year-round non-dated services.',
   null, 'Year-round services carry the quieter months.',
   'academy', '{}', null, null, '{"type": "not_set"}', 'Planned',
   'Claude', 'Claude (cohort data) · GPT (messages)', 'Define the 90-day trial cohort for a conversion measure', '2026-12-14', '2027-01-11', 13),
  ('q2-returning-clients', 'initiative', 'Returning clients', '{q2-2027}', '2027-01-01', '2027-03-31',
   'Planned re-engagement · reviews and referrals after real experiences · remaining winter places as support, not the whole pillar.',
   null, 'Returning revenue is the rolling-12-month measure of the relationship work.',
   'milestones', '{"metrics": ["returning"]}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (re-engagement) · Claude (returning data)', 'Plan the post-event review and referral asks', '2026-12-14', '2027-01-11', 14),
  ('q3-learn-from-spring', 'initiative', 'Deliver & learn from spring', '{q3-2027}', '2027-04-01', '2027-06-30',
   'Review what the spring programmes produced in revenue, GP and repeat bookings; adjust the summer and autumn programme.',
   null, null, null, '{}', null, null, '{"type": "not_set"}', 'Planned',
   'Claude', 'Claude (review) · Alan (decisions)', 'Spring programme review (revenue, GP, repeat)', '2027-04-12', '2027-04-26', 21),
  ('q3-summer-autumn-bookings', 'initiative', 'Summer creative days & autumn bookings', '{q3-2027}', '2027-04-01', '2027-06-30',
   'Sell summer creative and day workshops; autumn residential and woodland places early enough for their lead times. No unsupported dates or prices on the card.',
   null, null, 'lead_times', '{}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (timing, channels) · Claude (lead times)', 'Autumn residential announcement plan', '2027-04-05', '2027-04-26', 22),
  ('q3-client-reviews-academy', 'initiative', 'Mid-year client reviews, mentoring & Academy', '{q3-2027}', '2027-04-01', '2027-06-30',
   'Mid-year client development reviews, suitable mentoring / 1-to-1 and Academy participation and retention.',
   null, null, 'academy', '{}', null, null, '{"type": "not_set"}', 'Planned',
   'Claude', 'Claude (client data) · GPT (messages)', 'Mid-year client development review list', '2027-05-03', '2027-05-31', 23),
  ('q3-plans-returning', 'initiative', 'Plan conversion & returning clients', '{q3-2027}', '2027-04-01', '2027-06-30',
   'Plan conversion and retention; permission-appropriate returner activity; learn which programmes produce repeat revenue and sustainable GP.',
   null, null, 'milestones', '{"metrics": ["plans", "returning"]}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (returner activity) · Claude (conversion data)', 'Plan conversion & credit-use review', '2027-06-01', '2027-06-28', 24),
  ('q4-autumn-winter-january', 'initiative', 'Autumn, winter & January programme', '{q4-2027}', '2027-07-01', '2027-09-30',
   'Sell autumn, winter and January dates against lead-time evidence.',
   null, null, 'lead_times', '{}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (timing, channels) · Claude (lead times)', 'Autumn / winter programme push plan', '2027-07-05', '2027-07-26', 31),
  ('q4-christmas-gifting-prep', 'initiative', 'Prepare Christmas gifting', '{q4-2027}', '2027-07-01', '2027-09-30',
   'Build Christmas assets, audiences and any offer proposal early; early gifting only where useful. Any offer goes to Alan first.',
   null, null, null, '{}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (assets, audiences) · Alan (offers)', 'Gift assets and audiences drafted', '2027-08-30', '2027-09-13', 32),
  ('q4-renewals-academy', 'initiative', 'Pick n Mix renewals & Academy retention', '{q4-2027}', '2027-07-01', '2027-09-30',
   'Relevant renewals from month 10 for real plan cohorts (not a fixed calendar date); Academy retention and year-ahead development.',
   null, null, 'milestones', '{"metrics": ["plans"]}', null, null, '{"type": "not_set"}', 'Planned',
   'GPT', 'GPT (renewal messages) · Alan (conversations)', 'Renewal list from month-10 plan cohorts', '2027-07-12', '2027-08-02', 33),
  ('q4-reviews-next-year', 'initiative', 'Reviews, client stories & next-year targets', '{q4-2027}', '2027-07-01', '2027-09-30',
   'Summer and autumn reviews, client stories and referrals; next year''s targets set from actuals and capacity (Strategy owns the commercial review).',
   null, null, 'milestones', '{"metrics": ["returning"]}', null, null, '{"type": "not_set"}', 'Planned',
   'Claude', 'Claude (actuals, targets proposal) · Alan (approves)', 'Next-year targets proposal from actuals', '2027-09-06', '2027-09-27', 34)
) as v(k, kind, title, qs, sd, ed, summary, dplan, why, measure, focus, target, forecast, rule, slabel, owner, odetail, next, nd, rd, so)
on conflict (property_url, initiative_key) do nothing;

insert into public.strategy_quarter_plans (property_url, quarter_key, label, start_date, end_date, theme, review_note, milestone_key, initiative_keys, programme_key, housekeeping_key, set_by, history)
select 'https://www.alanranger.com', v.k, v.label, v.sd::date, v.ed::date, v.theme, 'review weekly (Monday brief)', v.ms, v.inis::text[], 'prog-learning-relationships', 'housekeeping',
  'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)',
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)', 'note', 'migration seed strategy_initiatives_20261108'))
from (values
  ('q1-2026', 'Q1 · Oct–Dec 2026', '2026-10-01', '2026-12-31', 'Christmas giving, a year of development, and winter photography', 'dec26', '{q1-gifts-christmas,q1-pnm-repeat,q1-near-term-workshops,q1-academy-progression}'),
  ('q2-2027', 'Q2 · Jan–Mar 2027', '2027-01-01', '2027-03-31', 'Spring into Summer — a clear next step for every learner', 'mar27', '{q2-spring-summer-bookings,q2-new-year-learners,q2-academy-mentoring-rps,q2-returning-clients}'),
  ('q3-2027', 'Q3 · Apr–Jun 2027', '2027-04-01', '2027-06-30', 'Summer creativity and autumn bookings', 'jun27', '{q3-learn-from-spring,q3-summer-autumn-bookings,q3-client-reviews-academy,q3-plans-returning}'),
  ('q4-2027', 'Q4 · Jul–Sep 2027', '2027-07-01', '2027-09-30', 'Autumn and winter ahead; renew and prepare gifting', 'sep27', '{q4-autumn-winter-january,q4-christmas-gifting-prep,q4-renewals-academy,q4-reviews-next-year}')
) as v(k, label, sd, ed, theme, ms, inis)
on conflict (property_url, quarter_key) do nothing;

-- Every existing strategy_quarter_actions row (24 on 8 Nov 2026: Q1 15, Q2 5, Q3 2, Q4 2), mapped once by its stable
-- action_key. The Pick n Mix launch newsletter task points at its delivery (scheduled, not sent); its tick is derived
-- from the collected send evidence (lib/strategy-action-evidence.mjs), never set by hand.
insert into public.strategy_initiative_links (property_url, ref_type, ref_key, initiative_key, role, related_ref, note, set_by, history)
select 'https://www.alanranger.com', 'action', v.ak, v.ik, 'primary', v.rel, v.note, 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)',
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)', 'initiative_key', v.ik, 'note', 'migration seed strategy_initiatives_20261108'))
from (values
  ('q1-remove-beg-12-14', 'housekeeping', null, null),
  ('q1-batsford-30-31', 'housekeeping', null, null),
  ('q1-rename-batsford', 'housekeeping', null, null),
  ('q1-batsford-email', 'housekeeping', null, null),
  ('q1-plans-tab', 'housekeeping', null, null),
  ('q1-drop-listings', 'housekeeping', null, null),
  ('q1-strategy-brief', 'housekeeping', null, null),
  ('q1-vyrnwy-date', 'housekeeping', null, null),
  ('q1-xmas-decide', 'housekeeping', null, null),
  ('q1-pnm-page', 'housekeeping', null, null),
  ('q1-max4-copy', 'housekeeping', null, null),
  ('q1-ld-3nights', 'q1-near-term-workshops', null, null),
  ('q1-pnm-newsletter', 'q1-pnm-repeat', 'send|theme|pick-n-mix-kick-starter-2026-11', 'the newsletter is a delivery: its state comes from the campaign record'),
  ('q1-plan-sheet', 'q1-pnm-repeat', null, null),
  ('q1-xmas-gift', 'q1-gifts-christmas', null, null),
  ('q2-res-calendar', 'q2-spring-summer-bookings', null, null),
  ('q2-offer-plans', 'q2-spring-summer-bookings', null, null),
  ('q3-vyrnwy-run', 'q2-spring-summer-bookings', null, null),
  ('q2-reviews', 'q2-returning-clients', null, null),
  ('q2-spring-beg', 'q2-new-year-learners', null, null),
  ('q3-review-conv', 'q3-plans-returning', null, null),
  ('q3-referrals', 'q3-plans-returning', null, null),
  ('q4-renewals', 'q4-renewals-academy', null, null),
  ('q4-next-targets', 'q4-reviews-next-year', null, null)
) as v(ak, ik, rel, note)
on conflict (property_url, ref_type, ref_key, initiative_key) do nothing;

-- Stored campaign records and the Pick n Mix scheduled send (one delivery, 127 sends reserved on the campaign record).
insert into public.strategy_initiative_links (property_url, ref_type, ref_key, initiative_key, role, purpose_primary, purpose_secondary, related_ref, note, set_by, history)
select 'https://www.alanranger.com', v.rt, v.rk, v.ik, 'primary', v.pp, v.ps::text[], v.rel, v.note, 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)',
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)', 'initiative_key', v.ik, 'note', 'migration seed strategy_initiatives_20261108'))
from (values
  ('campaign', 'theme|pick-n-mix-kick-starter-2026-11', 'q1-pnm-repeat', null, '{}', null, null),
  ('campaign', 'event|2026-11-12|/beginners-photography-lessons/lightroom-photo-editing-classes-wk1-kdh5k', 'q1-near-term-workshops', null, '{}', null, null),
  ('delivery', 'send|theme|pick-n-mix-kick-starter-2026-11', 'q1-pnm-repeat', 'sell', '{nurture}', 'theme|pick-n-mix-kick-starter-2026-11', 'Pick n Mix Kick-Starter launch email: one delivery')
) as v(rt, rk, ik, pp, ps, rel, note)
on conflict (property_url, ref_type, ref_key, initiative_key) do nothing;

insert into public.strategy_content_assets (property_url, asset_key, kind, title, url, status, reuse, used_in, note, set_by, history)
select 'https://www.alanranger.com', v.k, v.kind, v.title, v.url, v.st, v.reuse, v.used::text[], v.note, 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)',
  jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude (approved v2 quarter plan, 8 Nov 2026)', 'note', 'migration seed strategy_initiatives_20261108'))
from (values
  ('email|pnm-kick-starter-2026-11', 'email', 'Pick n Mix Kick-Starter email (Squarespace draft, scheduled)', null, 'existing', false, '{send|theme|pick-n-mix-kick-starter-2026-11}', 'the scheduled Squarespace campaign itself'),
  ('page|pick-n-mix-plans', 'page', 'Pick n Mix plans pages (monthly / quarterly / annual)', 'https://www.alanranger.com/photography-services-near-me/monthly-pick-n-mix-subscription', 'existing', true, '{send|theme|pick-n-mix-kick-starter-2026-11}', 'linked from the launch email'),
  ('page|gift-vouchers', 'page', 'Photography gift vouchers (digital eCard, email delivery)', 'https://www.alanranger.com/photography-services-near-me/photography-gift-vouchers', 'existing', true, '{initiative|q1-gifts-christmas}', 'for the gift story'),
  ('newsletter|light-and-logic', 'newsletter', 'Light & Logic (monthly edition, folded into the weekly email on the 15th)', null, 'existing', true, '{initiative|prog-learning-relationships}', 'Learning & client relationships programme')
) as v(k, kind, title, url, st, reuse, used, note)
on conflict (property_url, asset_key) do nothing;
