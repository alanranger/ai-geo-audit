import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKING_REFRESH_STEPS, BOOKING_REFRESH_PLAN, runBookingUploadRefresh,
  refreshStepLine, refreshSummaryLine, refreshFunnelSummary
} from '../lib/booking-upload-refresh.mjs';

const ok = () => Promise.resolve();

test('plan covers every step once, Survival Cockpit included', () => {
  const keys = BOOKING_REFRESH_PLAN.flat();
  assert.deepEqual([...keys].sort(), Object.keys(BOOKING_REFRESH_STEPS).sort());
  assert.ok(BOOKING_REFRESH_STEPS['funnel-summary'].sections.some((s) => /Survival Cockpit/.test(s)));
  assert.ok(BOOKING_REFRESH_STEPS['revenue-truth'].sections.some((s) => /Category breakdown/.test(s)));
});

test('all steps succeed: every section listed as refreshed, nothing failed', async () => {
  const seen = [];
  const out = await runBookingUploadRefresh(
    { 'revenue-truth': ok, diagnosis: ok, 'funnel-summary': ok, 'sync-banner': ok },
    { onStep: (r) => seen.push(r.key) }
  );
  const all = Object.values(BOOKING_REFRESH_STEPS).flatMap((s) => s.sections);
  assert.equal(out.failed.length, 0);
  assert.deepEqual([...out.refreshed].sort(), [...all].sort());
  assert.equal(seen.length, 4);
});

test('steps in a lane run in order; lanes run concurrently', async () => {
  const order = [];
  let releaseTruth;
  const truthGate = new Promise((r) => { releaseTruth = r; });
  const run = runBookingUploadRefresh({
    'revenue-truth': async () => { await truthGate; order.push('revenue-truth'); },
    diagnosis: async () => { order.push('diagnosis'); },
    'funnel-summary': async () => { order.push('funnel-summary'); },
    'sync-banner': ok
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, ['funnel-summary']);
  releaseTruth();
  await run;
  assert.deepEqual(order, ['funnel-summary', 'revenue-truth', 'diagnosis']);
});

test('a failed or missing step is reported, the rest still refresh, never throws', async () => {
  const out = await runBookingUploadRefresh({
    'revenue-truth': ok,
    diagnosis: () => Promise.reject(new Error('diagnosis failed')),
    'funnel-summary': ok
  });
  assert.deepEqual(out.failed.map((f) => [f.key, f.error]), [['diagnosis', 'diagnosis failed'], ['sync-banner', 'no refresher available']]);
  assert.ok(out.refreshed.some((s) => /Survival Cockpit/.test(s)));
  assert.match(refreshSummaryLine(out), /not refreshed/);
});

test('result-window lines name the sections', () => {
  const sections = BOOKING_REFRESH_STEPS['funnel-summary'].sections;
  assert.match(refreshStepLine({ ok: true, sections }), /^Refreshed: Survival Cockpit/);
  assert.match(refreshStepLine({ ok: false, sections, error: 'x' }), /^Not refreshed \(x\): Survival Cockpit/);
  assert.equal(refreshSummaryLine({ refreshed: ['a', 'b'], failed: [] }), 'Booking Sheet imported — 2 sections refreshed (listed below).');
});

test('refreshFunnelSummary: passes only when the summary payload was replaced', async () => {
  const win = { rfLatestSummary: { mtd: 250 } };
  win.rfFetchSummary = async () => { win.rfLatestSummary = { mtd: 850 }; };
  await refreshFunnelSummary(win);
  assert.equal(win.rfLatestSummary.mtd, 850);

  const stale = { rfLatestSummary: { mtd: 250 }, rfFetchSummary: async () => {} };
  await assert.rejects(refreshFunnelSummary(stale), /did not reload/);
  await assert.rejects(refreshFunnelSummary({}), /not loaded/);
});
