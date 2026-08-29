import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ga4DateToIso,
  normaliseRow,
  normaliseReport,
  summariseRows,
  missingGa4Setup,
  UNATTRIBUTED_GROUP,
} from '../lib/acquisition/ga4-channels.js';

const row = (date, group, source, medium, sessions, engaged = 0, secs = 0, pps = 1) => ({
  dimensionValues: [{ value: date }, { value: group }, { value: source }, { value: medium }],
  metricValues: [
    { value: String(sessions) },
    { value: String(engaged) },
    { value: String(secs) },
    { value: String(pps) },
  ],
});

test('ga4DateToIso converts GA4 compact dates and rejects anything else', () => {
  assert.equal(ga4DateToIso('20260829'), '2026-08-29');
  assert.equal(ga4DateToIso('2026-08-29'), null);
  assert.equal(ga4DateToIso(''), null);
  assert.equal(ga4DateToIso(undefined), null);
});

test('normaliseRow flags the Unassigned bucket as unattributed', () => {
  const bot = normaliseRow(row('20260829', UNATTRIBUTED_GROUP, '(not set)', '(not set)', 9304));
  assert.equal(bot.is_unattributed, true);
  assert.equal(bot.sessions, 9304);

  const real = normaliseRow(row('20260829', 'AI Assistant', 'chatgpt.com', 'ai-assistant', 69));
  assert.equal(real.is_unattributed, false);
  assert.equal(real.source, 'chatgpt.com');
  assert.equal(real.medium, 'ai-assistant');
});

test('normaliseRow drops rows with an unusable date rather than defaulting one', () => {
  assert.equal(normaliseRow(row('', 'Direct', '(direct)', '(none)', 10)), null);
});

test('normaliseReport skips unusable rows but keeps the rest', () => {
  const rows = normaliseReport({
    rows: [
      row('20260829', 'Direct', '(direct)', '(none)', 100),
      row('bogus', 'Direct', '(direct)', '(none)', 50),
      row('20260828', 'Organic Search', 'google', 'organic', 200),
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.sessions), [100, 200]);
});

test('normaliseReport tolerates an empty payload', () => {
  assert.deepEqual(normaliseReport({}), []);
  assert.deepEqual(normaliseReport(null), []);
});

test('summariseRows separates real traffic from the bot bucket', () => {
  const summary = summariseRows([
    { sessions: 8479, is_unattributed: false },
    { sessions: 6917, is_unattributed: false },
    { sessions: 43407, is_unattributed: true },
  ]);
  assert.equal(summary.attributed_sessions, 15396);
  assert.equal(summary.unattributed_sessions, 43407);
  assert.equal(summary.attributed_pct, 26);
});

test('summariseRows reports null coverage rather than a fake 0% on no data', () => {
  assert.equal(summariseRows([]).attributed_pct, null);
});

test('missingGa4Setup names each absent credential', () => {
  const missing = missingGa4Setup({ propertyId: '289575590', clientId: 'a', clientSecret: '', refreshToken: '' });
  assert.deepEqual(missing, ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
  assert.deepEqual(
    missingGa4Setup({ propertyId: '1', clientId: 'a', clientSecret: 'b', refreshToken: 'c' }),
    [],
  );
});
