-- Booking Sheet attendee tables hold client names and (since 9 Nov 2026) emails: service role only.
-- Checked before enabling (9 Nov 2026): every reader is server-side with the service-role client (marketing rebuild /
-- results, strategy summary / snapshots, CEO weekly, booking-sheet-upload); no browser or anon-key code reads them, and
-- the last 24 h of API logs show only the secret key on both tables. RLS on with no policies; anon / authenticated
-- grants removed. The service role bypasses RLS, so nothing server-side changes.

alter table public.booking_sheet_workshop_attendees enable row level security;
alter table public.booking_sheet_course_attendees enable row level security;

revoke all on public.booking_sheet_workshop_attendees from anon, authenticated;
revoke all on public.booking_sheet_course_attendees from anon, authenticated;
