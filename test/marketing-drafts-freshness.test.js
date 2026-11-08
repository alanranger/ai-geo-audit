/**
 * Final fix round items 10 and 11 (8 Nov 2026) on synthetic fixtures: Squarespace Drafts inventory (read-only, linked by
 * ids, unmatched shown, gone kept, partial reads refused) and one collector-freshness message ("2 new sends awaiting next
 * collector" when only new sends are uncollected; "failed" + recovery only on a real failed / partial / stale run).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftRow, ingestDrafts } from '../lib/marketing/delivery-schedule.mjs';
import { coverageOf, freshnessOf } from '../lib/marketing/overview.mjs';

const NOW = '2026-11-08T20:50:00Z';
const collected = (k) => Array.from({ length: k }, (_, i) => ({ email_id: `c${i}`, sent_on: '2026-10-01T10:00:00Z', events_complete: true }));
const uncollected = (k) => Array.from({ length: k }, (_, i) => ({ email_id: `u${i}`, sent_on: '2026-11-08T17:00:00Z', events_complete: false, uncollected: true }));
const OK = { kind: 'collector:scheduled', status: 'ok' };

test('164 collected of 166 known, collector OK: "2 new sends awaiting next collector", no failure, no re-run', () => {
  const cov = coverageOf([...collected(164), ...uncollected(2)], NOW);
  assert.deepEqual([cov.complete, cov.campaigns, cov.awaiting_collector, cov.incomplete_older, cov.covered], [164, 166, 2, 0, true]);
  const f = freshnessOf(cov, { kind: 'collector', status: 'ok' }, { status: 'ok' });
  assert.deepEqual([f.state, f.text, f.action], ['awaiting', '2 new sends awaiting next collector', null]);
  assert.doesNotMatch(f.text, /incomplete|re-run|failed/);
});

test('a real failure shows "failed" with the recovery step; an expired login says so; complete says complete', () => {
  const cov = coverageOf([...collected(164), ...uncollected(2)], NOW);
  const failed = freshnessOf(cov, { status: 'failed', error: 'INCOMPLETE delivered list' }, null);
  assert.equal(failed.state, 'failed');
  assert.match(failed.action, /npm run marketing:collector/);
  assert.match(freshnessOf(cov, { status: 'partial' }, null).action, /resumes where it stopped/);
  assert.match(freshnessOf(cov, { status: 'stale' }, null).action, /collector-login/);
  assert.deepEqual(freshnessOf(coverageOf(collected(166), NOW), OK, null), { state: 'complete', text: 'all 166 campaigns collected', action: null });
});

test('older campaigns not fully read: "collecting" while the backfill runs; otherwise a non-failure backfill step', () => {
  const older = [...collected(160), ...Array.from({ length: 4 }, (_, i) => ({ email_id: `o${i}`, sent_on: '2026-09-01T10:00:00Z', events_complete: false }))];
  const cov = coverageOf(older, NOW);
  assert.equal(cov.incomplete_older, 4);
  assert.match(freshnessOf(cov, OK, { status: 'running' }).text, /4 older campaigns being read \(backfill running\)/);
  const idle = freshnessOf(cov, OK, { status: 'ok' });
  assert.deepEqual([idle.state, /not a failure/.test(idle.action)], ['incomplete', true]);
});

/** Minimal in-memory Supabase stand-in (select / not / eq / upsert / update.eq). */
function fakeDb(seed = {}) {
  const t = { sqs_draft_emails: [], strategy_campaigns: [], marketing_segment_exports: [], ...structuredClone(seed) };
  const done = (data) => Promise.resolve({ data, error: null });
  return {
    t,
    from(name) {
      const rows = () => t[name];
      const q = { then: (ok, bad) => done(rows().map((r) => ({ ...r }))).then(ok, bad), not: () => q, eq: () => q };
      return {
        select: () => q,
        upsert: (list) => { for (const r of list) { const i = rows().findIndex((x) => x.email_id === r.email_id); if (i >= 0) rows()[i] = { ...rows()[i], ...r }; else rows().push({ ...r }); } return done(null); },
        update: (patch) => {
          const conds = [];
          const u = { eq: (k, v) => { conds.push([k, v]); return u; }, then: (ok, bad) => { for (const r of rows()) if (conds.every(([k, v]) => r[k] === v)) Object.assign(r, patch); return done(null).then(ok, bad); } };
          return u;
        }
      };
    }
  };
}

test('Drafts read: linked by draft id, the Academy-return draft unmatched, a later read marks a gone draft (kept), partial refused', async () => {
  const db = fakeDb({ strategy_campaigns: [{ campaign_key: 'theme|gifts-12nov', stage: 'drafted', sqs_draft_id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }] });
  const drafts = [{ email_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', subject: 'Gift', mailing_list_ids: [] }, { email_id: 'bbbbbbbbbbbbbbbbbbbbbbbb', subject: 'Academy return — review draft, no audience', mailing_list_ids: [] }];
  const r1 = await ingestDrafts(db, { complete: true, read_at: '2026-11-08T21:00:00Z', drafts });
  assert.deepEqual([r1.drafts, r1.linked, r1.unmatched], [2, 1, 1]);
  const academy = db.t.sqs_draft_emails.find((x) => x.email_id.startsWith('b'));
  assert.deepEqual([academy.state, academy.link_state, academy.campaign_key], ['draft', 'unlinked', null]);
  const r2 = await ingestDrafts(db, { complete: true, read_at: '2026-11-08T22:00:00Z', drafts: [drafts[1]] });
  assert.deepEqual([r2.gone, db.t.sqs_draft_emails.length, db.t.sqs_draft_emails.find((x) => x.email_id.startsWith('a')).state], [1, 2, 'gone']);
  await assert.rejects(ingestDrafts(db, { complete: false, drafts: [] }), /partial reads are never posted/);
  assert.throws(() => draftRow({}, NOW), /needs email_id/);
  assert.equal(db.t.strategy_campaigns.length, 1, 'no campaign is created from a draft');
});
