import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLeadTimes, buildMoments, weekSteps, campaignRules, sendsThisMonth, mondayOf } from '../lib/strategy-moments.mjs';

test('lead times: booking transaction → course Week 1, quartiles in weeks, JLR excluded', () => {
  const txns = [7, 14, 21, 28, 35].map((d, i) => ({ client_name: `C${i}`, category_order: 1, txn_date: new Date(Date.parse('2026-10-01') - d * 864e5).toISOString().slice(0, 10) }));
  txns.push({ client_name: 'J', category_order: 1, txn_date: '2026-01-01', is_jlr: true });
  const courses = [0, 1, 2, 3, 4].map((i) => ({ client_name: `C${i}`, from_date: '2026-10-01' })).concat([{ client_name: 'J', from_date: '2026-10-01', source_bucket: 'JLR' }]);
  const lt = computeLeadTimes({ txns, courses, workshops: [] }, '2026-11-06');
  assert.equal(lt.course.n, 5);
  assert.deepEqual([lt.course.announce_weeks, lt.course.main_push_weeks, lt.course.last_places_weeks], [4, 3, 2]);
});

test('moments: missed ones collapse into one Catch-up this week; sold-out events dropped', () => {
  const lt = { day: { announce_weeks: 6, main_push_weeks: 3, last_places_weeks: 1 } };
  const events = [
    { title: 'Walk A', date: '2026-11-20', kind: 'day', places_left: 4 },
    { title: 'Walk B', date: '2026-11-21', kind: 'day', places_left: 0 }
  ];
  const ms = buildMoments(events, lt, '2026-11-06');
  assert.ok(ms.every((m) => m.event.title === 'Walk A'));
  const catchUp = ms.find((m) => m.moment === 'catch_up');
  assert.equal(catchUp.week, mondayOf('2026-11-06'));
  assert.match(catchUp.label, /Announce, Main push/);
  assert.ok(ms.some((m) => m.moment === 'last_places'));
});

test('week steps: Thu email with Light & Logic in the week of the 15th, FB+IG Tue/Fri, LinkedIn Wed, Christmas by 23 Dec', () => {
  const rules = campaignRules();
  const s = weekSteps('2026-11-09', [], rules);
  assert.deepEqual(s.map((x) => `${x.day}|${x.channel}`), ['2026-11-10|Facebook + Instagram', '2026-11-11|LinkedIn', '2026-11-12|Squarespace email (full list)', '2026-11-13|Facebook + Instagram']);
  assert.match(s[2].step, /Light & Logic/);
  const xmas = weekSteps('2026-12-21', [], rules).find((x) => x.channel.startsWith('Squarespace'));
  assert.equal(xmas.day, '2026-12-23');
});

test('sends counter = email steps ticked as sent this month × list size', () => {
  const rules = campaignRules({ email: { list_size: 900 } });
  const ticks = { 'step|2026-11-02|Squarespace email (full list)|2026-11-05': { is_ticked: true }, 'step|2026-10-26|Squarespace email (full list)|2026-10-29': { is_ticked: true } };
  assert.deepEqual(sendsThisMonth(ticks, '2026-11-06', rules), { emails_sent: 1, sends: 900, cap: 5000, list_size: 900, month: '2026-11' });
});
