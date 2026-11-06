import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLeadTimes, buildMoments, campaignRules, campaignWeeks, mondayOf } from '../lib/strategy-moments.mjs';
import { shortName, whenLabel } from '../lib/strategy-board-rows.mjs';

const TODAY = '2026-11-06';
const LT = { day: { announce_weeks: 6, main_push_weeks: 3, last_places_weeks: 1 }, course: { announce_weeks: 9, main_push_weeks: 5, last_places_weeks: 3 } };

test('lead times: booking transaction → course Week 1, quartiles in weeks, JLR excluded', () => {
  const txns = [7, 14, 21, 28, 35].map((d, i) => ({ client_name: `C${i}`, category_order: 1, txn_date: new Date(Date.parse('2026-10-01') - d * 864e5).toISOString().slice(0, 10) }));
  txns.push({ client_name: 'J', category_order: 1, txn_date: '2026-01-01', is_jlr: true });
  const courses = [0, 1, 2, 3, 4].map((i) => ({ client_name: `C${i}`, from_date: '2026-10-01' })).concat([{ client_name: 'J', from_date: '2026-10-01', source_bucket: 'JLR' }]);
  const lt = computeLeadTimes({ txns, courses, workshops: [] }, TODAY);
  assert.equal(lt.course.n, 5);
  assert.deepEqual([lt.course.announce_weeks, lt.course.main_push_weeks, lt.course.last_places_weeks], [4, 3, 2]);
});

test('missed moments are dropped while a later one is still to come; no Catch-up label', () => {
  const ms = buildMoments([{ title: 'Walk A', date: '2026-11-20', kind: 'day', event_key: 'a' }], LT, TODAY);
  assert.deepEqual(ms.map((m) => m.moment), ['last_places']);
  assert.ok(ms.every((m) => !/catch/i.test(m.label)));
});

test('all moments past + event ahead → one "Last chance" row this week', () => {
  const ms = buildMoments([{ title: 'Course', date: '2026-11-09', kind: 'course', event_key: 'c' }], LT, TODAY);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].moment, 'last_chance');
  assert.equal(ms[0].label, 'Last chance');
  assert.equal(ms[0].week, mondayOf(TODAY));
});

test('events dated today / past, with no places left (Booking Sheet), or not promoted never appear', () => {
  const places = new Map([['full', { booked: 4, cap: 4 }], ['stock', { booked: 0, cap: 6 }]]);
  const evs = [
    { title: 'Today', date: TODAY, kind: 'day', event_key: 't' },
    { title: 'Full', date: '2026-12-20', kind: 'day', event_key: 'full' },
    { title: 'Stock says 2', date: '2026-12-20', kind: 'day', event_key: 'stock', places_left: 2 },
    { title: 'No', date: '2026-12-20', kind: 'day', event_key: 'n', promote_mode: 'dont_promote' }
  ];
  const ms = buildMoments(evs, LT, TODAY, places);
  assert.deepEqual([...new Set(ms.map((m) => m.event.title))], ['Stock says 2']);
});

test('never more than one row per event per week (the most urgent wins)', () => {
  const lt = { day: { announce_weeks: 3, main_push_weeks: 3, last_places_weeks: 1 } };
  const ms = buildMoments([{ title: 'X', date: '2026-12-10', kind: 'day', event_key: 'x' }], lt, TODAY);
  const weeks = ms.map((m) => m.week);
  assert.equal(new Set(weeks).size, weeks.length);
  assert.ok(ms.some((m) => m.moment === 'main_push') && !ms.some((m) => m.moment === 'announce'));
});

test('board: ≤6 rows a week, far announcements share one row, rest under +N more lowest £ first; channels per timetable', () => {
  const rules = campaignRules();
  const evs = Array.from({ length: 9 }, (_, i) => ({ title: `Event ${i}`, date: `2026-12-${String(10 + i).padStart(2, '0')}`, kind: 'day', event_key: `e${i}` }))
    .concat([{ title: 'Far A', date: '2027-04-01', kind: 'day', event_key: 'fa' }, { title: 'Far B', date: '2027-04-02', kind: 'day', event_key: 'fb' }]);
  const lt = { day: { announce_weeks: 5, main_push_weeks: 2, last_places_weeks: 1 } };
  const places = new Map(evs.map((e, i) => [e.event_key, { booked: 0, cap: 6, gain: 100 * (i + 1) }]));
  const ms = buildMoments(evs, lt, TODAY, places).map((m) => (m.event.title.startsWith('Far') ? { ...m, week: mondayOf(TODAY), moment: 'announce' } : m));
  const weeks = campaignWeeks(ms, TODAY, 4, rules, { places, actions: [] });
  for (const w of weeks) assert.ok(w.rows.length <= 6);
  const all = weeks.flatMap((w) => [...w.rows, ...w.more]);
  assert.equal(all.filter((r) => r.type === 'announce_group').length, 1);
  const busy = weeks.find((w) => w.more.length);
  if (busy) assert.ok(Math.max(...busy.more.map((r) => r.gain || 0)) <= Math.min(...busy.rows.filter((r) => r.type !== 'plan').map((r) => r.gain || 0)));
  const chips = all.flatMap((r) => r.chips);
  assert.ok(!chips.includes('Google Business'));
  assert.ok(all.every((r) => r.chips[0] === 'Email'));
});

test('campaign steps come from the same rows: Thu email (Light & Logic week of the 15th), FB+IG Tue/Fri, LinkedIn Wed, Christmas by 23 Dec', () => {
  const rules = campaignRules();
  const w = campaignWeeks([], '2026-11-09', 1, rules)[0];
  assert.deepEqual(w.steps.map((x) => `${x.day}|${x.channel}`), ['2026-11-10|Facebook + Instagram', '2026-11-11|LinkedIn', '2026-11-12|Squarespace email (full list)', '2026-11-13|Facebook + Instagram']);
  assert.match(w.steps[2].step, /Light & Logic/);
  const xmas = campaignWeeks([], '2026-12-21', 1, rules)[0].steps.find((x) => x.channel.startsWith('Squarespace'));
  assert.equal(xmas.day, '2026-12-23');
});

test('this week: steps only use the days left (earlier days move to today), tick key keeps the scheduled day', () => {
  const w = campaignWeeks([], TODAY, 1, campaignRules())[0];
  assert.ok(w.steps.every((s) => s.day >= TODAY));
  assert.ok(w.steps.some((s) => s.key.endsWith('2026-11-05') && s.day === TODAY));
});

test('short names and UK dates (no ISO dates, no raw product titles)', () => {
  const cases = [
    [{ title: 'Camera Courses For Beginners - Week 1 of 3 - Coventry 1-12', kind: 'course', date: '2026-12-01' }, 'Beginners course', 'starts Tue 1 Dec'],
    [{ title: 'Lightroom Classic Photo Editing Classes - Week 1 of 3 -12-11', kind: 'course', date: '2026-11-12' }, 'Lightroom course', 'starts Thu 12 Nov'],
    [{ title: 'Norfolk Photography Workshop | Cromer to Hunstanton', date: '2026-11-20', end: '2026-11-22' }, 'Norfolk', '20–22 Nov'],
    [{ title: 'Abstract and Macro Photography Workshop Warwickshire - Nov', date: '2026-11-28' }, 'Abstract & Macro', 'Sat 28 Nov'],
    [{ title: 'Woodland Photography Walk | Solihull | Hay Woods - Winter', date: '2026-12-04' }, 'Hay Woods walk', 'Fri 4 Dec'],
    [{ title: 'Woodland Photography Walk - Solihull - Hay Woods - Winter', date: '2027-01-02' }, 'Hay Woods walk', 'Sat 2 Jan'],
    [{ title: 'The Secrets of Woodland Photography - 1-Day Masterclass 10-1', date: '2027-01-10' }, 'Woodland masterclass', 'Sun 10 Jan'],
    [{ title: 'Lake District Photography Workshop | Winter in Cumbria', date: '2027-01-22', end: '2027-01-24' }, 'Lake District', '22–24 Jan'],
    [{ title: 'Suffolk Landscape Photography Workshop - Long Exposure', date: '2027-02-05', end: '2027-02-07' }, 'Suffolk', '5–7 Feb'],
    [{ title: 'Hartland Quay, Devon Seascape Photography Workshop', date: '2027-02-25', end: '2027-02-28' }, 'Hartland Quay', '25–28 Feb'],
    [{ title: 'Wales Photography Workshop Pistyll Rhaeadr and Lake Vyrnwy ', date: '2027-03-13', end: '2027-03-14' }, 'Lake Vyrnwy', '13–14 Mar'],
    [{ title: 'Long Exposure Photography Workshop - Kenilworth 22-3', date: '2027-03-22' }, 'Kenilworth long exposure', 'Mon 22 Mar'],
    [{ title: 'Sunset Photographic Workshop - Chesterton Windmill 13/4', date: '2027-04-13' }, 'Chesterton Windmill sunset', 'Tue 13 Apr'],
    [{ title: 'Long Exposure Photo Workshop - Sunset - Kenilworth - Apr', date: '2027-04-14' }, 'Kenilworth long exposure', 'Wed 14 Apr'],
    [{ title: 'Fairy Glen Betws-y-Coed Photography Workshop -  Wales', date: '2027-03-06' }, 'Fairy Glen Betws-y-Coed', 'Sat 6 Mar'],
    [{ title: 'Batsford Arboretum Autumn Photography Workshop - 23/10', date: '2027-10-23' }, 'Batsford Arboretum', 'Sat 23 Oct']
  ];
  for (const [e, name, when] of cases) {
    assert.equal(shortName(e), name, e.title);
    assert.equal(whenLabel(e), when, e.title);
  }
});
