/**
 * Clean-up real execution (QUESTION-2026-11-08 first-cleanup-unsubscribe-never-openers) on synthetic fixtures:
 * the cohort, the protection re-check right before acting, the approval gate, idempotent batches (a re-run or a
 * repeated report never double-acts), partial failures retrying only the failed items, and the PC runner.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH, MAX_ATTEMPTS, REAL_APPROVALS, RETRY_AFTER_MS, SENDING_STALE_MS, SUPPRESSION_REASON, approvalOf, claimBatch, classify, cohortProfiles, decide, executeManifest, liveReason, personByEmail, realRefusal, recordResult, retryable, verifyOk, verifyReport } from '../lib/marketing/cleanup-exec.mjs';
import { approvalText } from '../lib/marketing/cleanup.mjs';
import { cleanupExecJob } from '../lib/marketing/cleanup-runner.mjs';
import { emailHash } from '../lib/marketing/store.mjs';

const TODAY = '2026-11-08';
const APPROVAL = REAL_APPROVALS[0].text;
const silent = { email: 'a@x.test', value: { c: { orders: 0, net: 0 }, cp: { orders: 0 } }, booking_count: 0, future: [], cats: {}, record_type: 'person' };
const emptyLive = (over = {}) => ({ profiles: new Map(), suppressed: new Set(), engaged: new Set(), buyers: new Set(), holds: new Set(), credit: new Set(), owners: new Set(), ...over });
const prof = (id, email, accepts = true) => ({ profile_id: id, email, accepts_marketing: accepts, missing_since: null });

/** In-memory stand-in for the Supabase query builder calls these modules make. */
function fakeDb(tables) {
  const db = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let seq = 0;
  const from = (table) => {
    db[table] ||= [];
    const st = { mode: 'select', preds: [], want: false };
    const run = () => {
      const hit = db[table].filter((r) => st.preds.every((p) => p(r)));
      if (st.mode === 'update') { hit.forEach((r) => Object.assign(r, st.patch)); return { data: st.want ? hit.map((r) => ({ ...r })) : null, error: null }; }
      if (st.mode === 'insert') { const rows = st.rows.map((r) => ({ run_id: `run-${seq += 1}`, ...r })); db[table].push(...rows); return { data: st.single ? rows[0] : rows, error: null }; }
      if (st.mode === 'upsert') {
        const keys = String(st.key).split(',');
        for (const r of st.rows) { const old = db[table].find((x) => keys.every((k) => x[k] === r[k])); if (old) Object.assign(old, r); else db[table].push({ ...r }); }
        return { data: null, error: null };
      }
      let out = st.range ? hit.slice(st.range[0], st.range[1] + 1) : hit;
      if (st.limit) out = out.slice(0, st.limit);
      return { data: st.single ? (out[0] ? { ...out[0] } : null) : out.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { if (st.mode !== 'select') st.want = true; return b; },
      eq(c, v) { st.preds.push((r) => r[c] === v); return b; },
      in(c, vs) { st.preds.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { st.preds.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      order() { return b; },
      limit(n) { st.limit = n; return b; },
      range(a, z) { st.range = [a, z]; return b; },
      maybeSingle() { st.single = true; return b; },
      single() { st.single = true; return b; },
      update(p) { st.mode = 'update'; st.patch = p; return b; },
      insert(r) { st.mode = 'insert'; st.rows = [].concat(r); return b; },
      upsert(r, o) { st.mode = 'upsert'; st.rows = [].concat(r); st.key = o?.onConflict; return b; },
      then(ok) { return Promise.resolve(run()).then(ok); }
    };
    return b;
  };
  return { db, from };
}

test('cohort: subscribed, present, unsuppressed, 4+ delivered, never opened or clicked', () => {
  const def = { min_delivered: 4 };
  const profiles = [prof('p1', 'a@x.test'), prof('p2', 'b@x.test'), prof('p3', 'c@x.test'), prof('p4', 'd@x.test', false), { ...prof('p5', 'e@x.test'), missing_since: '2026-11-01' }, prof('p6', 'f@x.test'), prof('p7', 'g@x.test')];
  const exposure = [
    { email: 'a@x.test', delivered_campaigns: 4, engaged_events: 0 }, { email: 'b@x.test', delivered_campaigns: 3, engaged_events: 0 },
    { email: 'c@x.test', delivered_campaigns: 12, engaged_events: 1 }, { email: 'd@x.test', delivered_campaigns: 9, engaged_events: 0 },
    { email: 'e@x.test', delivered_campaigns: 9, engaged_events: 0 }, { email: 'f@x.test', delivered_campaigns: 9, engaged_events: 0 }
  ];
  const out = cohortProfiles(profiles, exposure, new Set([emailHash('f@x.test')]), def).map((p) => p.profile_id);
  assert.deepEqual(out, ['p1'], '3 delivered, an open/click, unsubscribed, deleted, suppressed or no tracked deliveries all stay out');
  const people = [{ person_id: 'A', facts: { email: 'a@x.test', record_type: 'person' } }, { person_id: 'S', facts: { email: 'b@x.test', stale: true } }, { person_id: 'N', facts: { email: 'c@x.test', attached_to: 'x' } }];
  assert.deepEqual([...personByEmail(people).keys()], ['a@x.test'], 'only listed records (not stale, not attached)');
});

test('protection re-check right before acting: every reason skips; a clean record may act', () => {
  const item = { person_id: 'A', profile_id: 'p1', email: 'a@x.test', outcome: null, attempts: 0 };
  const live = emptyLive({ profiles: new Map([['p1', prof('p1', 'a@x.test')]]) });
  assert.deepEqual(decide(item, silent, live, TODAY), { kind: 'act' });
  const cases = [
    [{ ...silent, value: { c: { orders: 1, net: 95 }, cp: { orders: 1 } } }, live, 'buyer'],
    [{ ...silent, cats: { lightroom: { c: 0, p: 1 } } }, live, 'probable_buyer'],
    [{ ...silent, history_incomplete: true }, live, 'unknown_history'],
    [{ ...silent, future: [{ date: '2026-12-01' }] }, live, 'booking'],
    [{ ...silent, academy_detail: { status: 'trial_active' } }, live, 'academy_member'],
    [{ ...silent, plans: [{ starts: '2026-10-01', ends: '2027-09-30' }] }, live, 'active_plan'],
    [{ ...silent, relationship_hold: { reason: 'x' } }, live, 'relationship_hold'],
    [{ ...silent, record_type: 'organisation' }, live, 'organisation'],
    [{ ...silent, owner: true }, live, 'owner'],
    [silent, emptyLive({ ...live, owners: new Set(['a@x.test']) }), 'owner'],
    [silent, emptyLive({ ...live, holds: new Set(['A']) }), 'relationship_hold'],
    [silent, emptyLive({ ...live, credit: new Set(['A']) }), 'credit_held'],
    [silent, emptyLive({ ...live, buyers: new Set(['a@x.test']) }), 'squarespace_order'],
    [silent, emptyLive({ ...live, engaged: new Set(['a@x.test']) }), 'opened_or_clicked'],
    [silent, emptyLive({ ...live, suppressed: new Set([emailHash('a@x.test')]) }), 'suppressed_now'],
    [silent, emptyLive(), 'profile_missing'],
    [silent, emptyLive({ profiles: new Map([['p1', prof('p1', 'a@x.test', false)]]) }), 'already_unsubscribed'],
    [{ stale: true }, live, 'record_missing'],
    [null, live, 'record_missing']
  ];
  for (const [f, l, want] of cases) assert.equal(liveReason(item, f, l, TODAY), want, want);
  assert.equal(liveReason({ ...item, email: 'me@alanranger.com' }, silent, emptyLive({ profiles: new Map([['p1', prof('p1', 'me@alanranger.com')]]) }), TODAY), 'owner', 'Alan\'s own addresses');
  const off = emptyLive({ profiles: new Map([['p1', prof('p1', 'a@x.test', false)]]) });
  assert.equal(decide({ ...item, outcome: 'sending', attempts: 1 }, silent, off, TODAY).kind, 'done', 'a claimed opt-out that landed before the report (crash) is confirmed, not redone');
  assert.equal(decide({ ...item, outcome: 'failed', attempts: 1 }, silent, off, TODAY).kind, 'done', 'a late-landing opt-out is confirmed on retry');
  assert.equal(decide(item, silent, off, TODAY).reason, 'already_unsubscribed', 'never attempted: someone who unsubscribed themselves is skipped');
});

test('gate: real execution only with Alan\'s exact recorded approval, the right cohort and the frozen count within ±5', () => {
  const m = { manifest_id: 'm1', mode: 'review', action: 'unsubscribe', query: { cohort: 'never_opened_4plus' }, counts: { eligible: 249 }, items_hash: 'h', query_version: 1 };
  const text = approvalText(m, 'APPROVE 249', APPROVAL);
  assert.ok(text.includes(APPROVAL) && text.startsWith('APPROVE 249 · unsubscribe · items h · query v1'));
  const ok = { ...m, approval_text: text };
  assert.equal(realRefusal(ok), null);
  assert.equal(approvalOf(ok), REAL_APPROVALS[0]);
  assert.match(realRefusal({ ...m, approval_text: approvalText(m, 'APPROVE 249', '') }), /recorded approval/);
  assert.match(realRefusal({ ...m, approval_text: approvalText(m, 'APPROVE 249', 'Alan via Claude, 8 Nov 2026 11:12, option B') }), /recorded approval/);
  assert.match(realRefusal({ ...ok, mode: 'test' }), /dry run/);
  assert.match(realRefusal({ ...ok, action: 'delete_record' }), /only for/);
  assert.match(realRefusal({ ...ok, query: { root: {} } }), /different clean-up/);
  assert.equal(realRefusal({ ...ok, counts: { eligible: 245 } }), null);
  assert.equal(realRefusal({ ...ok, counts: { eligible: 255 } }), null);
  assert.match(realRefusal({ ...ok, counts: { eligible: 244 } }), /stop and report: the frozen count 244/);
  assert.match(realRefusal({ ...ok, counts: { eligible: 260 } }), /stop and report/);
  assert.match(realRefusal(ok, 1), /already been used/);
});

test('retry rules: never-tried and old failures retry; done / skipped / fresh claims / used-up attempts do not', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const ago = (msAgo) => new Date(now - msAgo).toISOString();
  const e = { state: 'eligible' };
  assert.equal(retryable({ ...e, outcome: null }, now), true);
  assert.equal(retryable({ state: 'protected', outcome: null }, now), false);
  assert.equal(retryable({ ...e, outcome: 'done' }, now), false);
  assert.equal(retryable({ ...e, outcome: 'skipped' }, now), false);
  assert.equal(retryable({ ...e, outcome: 'failed', attempts: 1, last_try_at: ago(60000) }, now), false, 'a fresh failure waits for a later run');
  assert.equal(retryable({ ...e, outcome: 'failed', attempts: 1, last_try_at: ago(RETRY_AFTER_MS) }, now), true);
  assert.equal(retryable({ ...e, outcome: 'failed', attempts: MAX_ATTEMPTS, last_try_at: ago(3600000) }, now), false);
  assert.equal(retryable({ ...e, outcome: 'sending', attempts: 1, last_try_at: ago(60000) }, now), false, 'in flight on the PC');
  assert.equal(retryable({ ...e, outcome: 'sending', attempts: 1, last_try_at: ago(SENDING_STALE_MS + 1000) }, now), true, 'claimed and never reported (crash)');
  assert.deepEqual(classify(['a', 'b', 'c'], { a: 'UNSUBSCRIBED', b: 'SUBSCRIBED', c: null }), { confirmed: ['a'], failed: [{ id: 'b', error: 'still subscribed after the opt-out' }], unread: ['c'] });
});

function scenario() {
  const t0 = '2026-11-08T12:00:00.000Z';
  const people = ['A', 'B', 'C', 'D', 'E'].map((k) => ({ person_id: k, email: `${k.toLowerCase()}@x.test`, profile_id: `p${k}` }));
  const m = { manifest_id: 'm1', created_at: '2026-11-08T11:58:00.000Z', mode: 'review', action: 'unsubscribe', status: 'executing', query: { cohort: 'never_opened_4plus' }, counts: { eligible: 250 }, approval_text: `APPROVE 250 · unsubscribe · items h · query v1 · ${APPROVAL}`, status_history: [], exec_state: {} };
  const sb = fakeDb({
    marketing_cleanup_manifests: [m],
    marketing_cleanup_items: people.map((p) => ({ manifest_id: 'm1', ...p, state: p.person_id === 'E' ? 'protected' : 'eligible', protected_reason: p.person_id === 'E' ? 'buyer' : null, op_key: `m1|${p.person_id}|unsubscribe`, outcome: null, attempts: 0, last_try_at: null })),
    customer_person: people.map((p) => ({ person_id: p.person_id, facts: { ...silent, email: p.email } })),
    sqs_profiles: people.map((p) => prof(p.profile_id, p.email)),
    sqs_email_campaigns: [{ email_id: 'c1', sent_on: '2026-11-08T09:55:00Z', events_complete: true }],
    sqs_email_events: [{ email: 'c@x.test', event_type: 'OPENED', email_id: 'c1' }],
    marketing_suppression: [], marketing_collector_runs: [{ run_id: 'r1', kind: 'cleanup-exec', status: 'running' }]
  });
  return { sb, t0, at: (plusMs) => new Date(Date.parse(t0) + plusMs).toISOString() };
}
const outcomes = (sb) => Object.fromEntries(sb.db.marketing_cleanup_items.map((i) => [i.person_id, i.outcome]));

test('execution: re-check skips the changed, partial failure retries only the failed, repeats never double-act', async () => {
  const { sb, t0, at } = scenario();
  const b1 = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r1' }, t0);
  assert.deepEqual(b1.act.map((a) => a.profile_id), ['pA', 'pB', 'pD'], 'C opened since the freeze → skipped; protected E never offered');
  assert.equal(sb.db.marketing_cleanup_items.find((i) => i.person_id === 'C').skip_reason, 'opened_or_clicked');
  const again = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r1' }, at(1000));
  assert.deepEqual(again.act, [], 'a second claim while the batch is in flight hands nobody out twice');
  const r1 = await recordResult(sb, { manifest_id: 'm1', run_id: 'r1', sent: ['pA', 'pB', 'pD'], status: { pA: 'UNSUBSCRIBED', pB: 'UNSUBSCRIBED', pD: 'SUBSCRIBED' } }, at(20000));
  assert.deepEqual([r1.done, r1.failed], [2, 1]);
  assert.deepEqual(outcomes(sb), { A: 'done', B: 'done', C: 'skipped', D: 'failed', E: null });
  const sup = sb.db.marketing_suppression;
  assert.deepEqual(sup.map((s) => [s.email_hash, s.reason, s.source]), [[emailHash('a@x.test'), SUPPRESSION_REASON, 'm1'], [emailHash('b@x.test'), SUPPRESSION_REASON, 'm1']]);
  const dup = await recordResult(sb, { manifest_id: 'm1', run_id: 'r1', sent: ['pA', 'pB', 'pE'], status: { pA: 'UNSUBSCRIBED', pB: 'UNSUBSCRIBED', pE: 'UNSUBSCRIBED' } }, at(30000));
  assert.deepEqual([dup.done, dup.failed, dup.ignored], [0, 0, 3], 'a repeated report (or an ID not handed out) changes nothing');
  sb.db.sqs_profiles.filter((p) => ['pA', 'pB'].includes(p.profile_id)).forEach((p) => { p.accepts_marketing = false; });
  const early = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r1' }, at(60000));
  assert.deepEqual([early.act.length, early.finished], [0, false], 'the failure waits for a later run; the manifest is not finished');
  const b2 = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r2' }, at(RETRY_AFTER_MS + 60000));
  assert.deepEqual(b2.act.map((a) => a.profile_id), ['pD'], 'only the failed item is retried');
  assert.equal(sb.db.marketing_cleanup_items.find((i) => i.person_id === 'D').attempts, 2);
  await recordResult(sb, { manifest_id: 'm1', run_id: 'r2', sent: ['pD'], status: { pD: 'UNSUBSCRIBED' } }, at(RETRY_AFTER_MS + 80000));
  const end = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r2' }, at(RETRY_AFTER_MS + 90000));
  assert.deepEqual([end.act.length, end.finished, end.outcomes], [0, true, { done: 3, skipped: 1 }]);
  assert.equal(sb.db.marketing_cleanup_manifests[0].status, 'executed');
  assert.equal(sb.db.marketing_suppression.length, 3, 'one suppression row per person, never duplicated');
  assert.ok(sb.db.marketing_cleanup_items.every((i) => i.person_id !== 'E' || (i.outcome === null && i.attempts === 0)), 'the protected buyer was never touched');
  await assert.rejects(claimBatch(sb, { manifest_id: 'm1', run_id: 'r3' }, at(RETRY_AFTER_MS + 99000)), /executed, not executing/);
});

test('execution refuses without the exact approval, or when the count is off, and pauses when coverage is incomplete', async () => {
  const { sb, t0 } = scenario();
  const m = sb.db.marketing_cleanup_manifests[0];
  m.approval_text = 'APPROVE 250 · unsubscribe · items h · query v1 · Alan';
  await assert.rejects(claimBatch(sb, { manifest_id: 'm1' }, t0), /recorded approval/);
  m.status = 'approved';
  await assert.rejects(executeManifest(sb, { manifest_id: 'm1' }, 'test'), /recorded approval/);
  m.approval_text = `APPROVE 240 · ${APPROVAL}`;
  m.counts = { eligible: 240 };
  await assert.rejects(executeManifest(sb, { manifest_id: 'm1' }, 'test'), /stop and report/);
  m.counts = { eligible: 250 };
  sb.db.sqs_email_campaigns.push({ email_id: 'c2', sent_on: t0, events_complete: false });
  await assert.rejects(executeManifest(sb, { manifest_id: 'm1' }, 'test'), /coverage incomplete/);
  sb.db.sqs_email_campaigns.pop();
  const q = await executeManifest(sb, { manifest_id: 'm1' }, 'test');
  assert.equal(q.status, 'executing');
  assert.ok(sb.db.marketing_cleanup_items.every((i) => i.outcome === null), 'queueing acts on nobody');
});

test('batches are bounded', async () => {
  const { sb, t0 } = scenario();
  const extra = Array.from({ length: 40 }, (_, n) => ({ person_id: `Z${n}`, email: `z${n}@x.test`, profile_id: `pZ${n}` }));
  sb.db.marketing_cleanup_items.push(...extra.map((p) => ({ manifest_id: 'm1', ...p, state: 'eligible', protected_reason: null, op_key: `m1|${p.person_id}|unsubscribe`, outcome: null, attempts: 0 })));
  sb.db.customer_person.push(...extra.map((p) => ({ person_id: p.person_id, facts: { ...silent, email: p.email } })));
  sb.db.sqs_profiles.push(...extra.map((p) => prof(p.profile_id, p.email)));
  const b = await claimBatch(sb, { manifest_id: 'm1', run_id: 'r1' }, t0);
  assert.equal(b.act.length + (b.counts.skipped || 0), BATCH);
  assert.equal(b.more, true);
});

test('verification: done unsubscribed, buyers kept, no other contact changed', () => {
  const before = { subscribed: 5, can_email: 5, all_subscribers_sqs: 5, subscribed_ids: ['pA', 'pB', 'pC', 'pE', 'pX'] };
  const items = [
    { profile_id: 'pA', email: 'a@x.test', state: 'eligible', outcome: 'done' }, { profile_id: 'pB', email: 'b@x.test', state: 'eligible', outcome: 'done' },
    { profile_id: 'pC', email: 'c@x.test', state: 'eligible', outcome: 'skipped', skip_reason: 'opened_or_clicked' }, { profile_id: 'pE', email: 'e@x.test', state: 'protected', protected_reason: 'buyer' }
  ];
  const profiles = [prof('pA', 'a@x.test', false), prof('pB', 'b@x.test', false), prof('pC', 'c@x.test'), prof('pE', 'e@x.test'), prof('pX', 'x@x.test')];
  const suppressed = new Set([emailHash('a@x.test'), emailHash('b@x.test')]);
  const r = verifyReport({ before, items, profiles, suppressed, manifestId: 'm1', sqsAfter: 3 });
  assert.deepEqual([r.done_unsubscribed_now, r.buyers_still_subscribed, r.others_unsubscribed, r.others_subscribed, r.all_subscribers.after, r.can_email.after], [2, 1, 0, 0, 3, 3]);
  assert.equal(verifyOk(r), true);
  const bad = verifyReport({ before, items, profiles: profiles.map((p) => (p.profile_id === 'pX' ? { ...p, accepts_marketing: false } : p)), suppressed, manifestId: 'm1' });
  assert.deepEqual([bad.others_unsubscribed, verifyOk(bad)], [1, false], 'any other contact changing fails the check');
  const buyerLost = verifyReport({ before, items, profiles: profiles.map((p) => (p.profile_id === 'pE' ? { ...p, accepts_marketing: false } : p)), suppressed, manifestId: 'm1' });
  assert.equal(verifyOk(buyerLost), false);
});

test('PC runner: opts out only the IDs handed over, reads consent back, reports; a dry run never claims', async () => {
  const calls = [];
  const batches = [{ act: [{ person_id: 'A', profile_id: 'pA' }, { person_id: 'B', profile_id: 'pB' }], more: true, counts: { act: 2 } }, { act: [], more: true, counts: { skipped: 1 } }, { act: [], more: false, finished: true }];
  const api = async (method, body, query) => {
    calls.push(body?.action || query);
    if (query) return { job: { run_id: 'r1', manifest_id: 'm1', batch: 25 } };
    if (body.action === 'cleanup-exec-batch') return batches.shift();
    if (body.action === 'cleanup-exec-result') return { done: body.sent.length, failed: 0, done_total: body.sent.length, seen: body };
    return {};
  };
  const opted = [];
  const page = { evaluate: async (fn, arg) => fn(arg) };
  const pageFns = { optOut: async (ids) => { opted.push(...ids); return { status: 200 }; }, consentStatus: async (ids) => ({ status: Object.fromEntries(ids.map((id) => [id, 'UNSUBSCRIBED'])) }), subscribedTotal: async () => 925 };
  let closed = false;
  const r = await cleanupExecJob({ api, open: async () => ({ page, ctx: { close: async () => { closed = true; } } }), pageFns, wait: async () => {}, log: () => {} });
  assert.deepEqual(opted, ['pA', 'pB']);
  assert.deepEqual([r.done, r.skipped, r.finished, closed], [2, 1, true, true]);
  assert.deepEqual(calls, ['?action=cleanup-exec-next', 'cleanup-exec-start', 'cleanup-exec-batch', 'cleanup-exec-result', 'cleanup-exec-batch', 'cleanup-exec-batch', 'cleanup-exec-finish']);
  const none = [];
  assert.equal(await cleanupExecJob({ api: async (...a) => { none.push(a); return {}; }, dry: true }), null);
  assert.equal(none.length, 0);
});

test('PC runner: an opt-out error is reported with the consent read (some may have landed), never hidden', async () => {
  const sent = [];
  const api = async (method, body, query) => {
    if (query) return { job: { run_id: 'r1', manifest_id: 'm1' } };
    if (body.action === 'cleanup-exec-batch') return sent.length ? { act: [], more: false } : { act: [{ profile_id: 'pA' }, { profile_id: 'pB' }], more: false };
    if (body.action === 'cleanup-exec-result') { sent.push(body); return { done: 1, failed: 1 }; }
    return {};
  };
  const pageFns = { optOut: async () => { throw new Error('OPT_OUT 500'); }, consentStatus: async () => ({ status: { pA: 'UNSUBSCRIBED', pB: 'SUBSCRIBED' } }), subscribedTotal: async () => 925 };
  const page = { evaluate: async (fn, arg) => fn(arg) };
  await cleanupExecJob({ api, open: async () => ({ page, ctx: { close: async () => {} } }), pageFns, wait: async () => {}, log: () => {} });
  assert.equal(sent[0].error, 'OPT_OUT 500');
  assert.deepEqual(sent[0].status, { pA: 'UNSUBSCRIBED', pB: 'SUBSCRIBED' });
});
