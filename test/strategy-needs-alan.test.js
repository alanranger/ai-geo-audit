/**
 * Strategy "Needs Alan" reads the ONE shared decision state Marketing "Waiting on you" renders: count = Waiting count;
 * target decisions are a separate group; posts the state records as published are never drafts or next actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { needsAlan } from '../lib/strategy-decisions.mjs';
import { markPublished, nextActionOf } from '../lib/strategy-initiatives.mjs';

const dec = (open) => ({ today: '2026-11-09', as_of: '2026-11-09T09:00:00Z', count: open.length, open, plan_approved: { decided_at: '2026-11-08' }, published: [{ step_key: 'li-norfolk', placement: 'linkedin_feed' }], production_queue: [{ step_key: 'x' }] });
const outlook = { type: 'outlook_note', key: 'outlook|s1', step_key: 's1', due: '2026-11-10', what: 'Personal note', channel: 'outlook', why: 'Personal note · approve and send' };
const beginners = { key: 'beginners-dec26', kind: 'target', what: 'Q1 target: 8 non-JLR beginners by Thu 31 Dec', why: 'can\'t be met', options: ['Keep', 'Move to Q2', 'Change'], due: '2026-12-31' };

test('Needs count = Waiting count (0 and 1); target decisions apart, total = both', () => {
  assert.deepEqual([needsAlan(dec([])).count, needsAlan(dec([])).total], [0, 0]);
  const n = needsAlan(dec([outlook]), [beginners]);
  assert.equal(n.count, 1, 'same as Marketing Waiting');
  assert.equal(n.targets, 1);
  assert.equal(n.total, 2);
  assert.deepEqual(n.open.map((o) => o.key), ['outlook|s1']);
  assert.deepEqual(n.published, ['li-norfolk']);
  assert.equal(n.plan_approved, true);
});

test('a failed decision-state read is reported, never a guessed 0', () => {
  const n = needsAlan({ error: 'timeout' }, [beginners]);
  assert.equal(n.count, null);
  assert.equal(n.error, 'timeout');
});

test('a published post is done: never a draft, never the next action', () => {
  const list = [
    { key: 'li-norfolk', day: '2026-11-11', channel: 'LinkedIn', title: 'Norfolk', status: 'pending', draft: true },
    { key: 'fbig-later', day: '2026-11-12', channel: 'Facebook + Instagram', title: 'Later', status: 'pending', draft: true }
  ];
  const out = markPublished(list, ['li-norfolk']);
  assert.deepEqual([out[0].status, out[0].sent, out[0].draft], ['published', true, false]);
  assert.equal(nextActionOf({}, out, '2026-11-09').key, 'fbig-later');
  assert.equal(nextActionOf({}, list, '2026-11-09').key, 'li-norfolk', 'without the shared state it would still read as the next draft');
  assert.equal(markPublished(list, []), list);
});

test('Strategy layout: headline is Needs Alan (count), target decisions shown apart', () => {
  const ctx = { window: {}, document: { addEventListener() {} }, console };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-layout.js', import.meta.url), 'utf8'), ctx);
  const html = ctx.stLayoutParts.decisionsHtml({ decisions: [beginners], needs_alan: needsAlan(dec([]), [beginners]) });
  assert.match(html, /<h3>Needs Alan \(0\)/);
  assert.match(html, /Nothing is waiting on you/);
  assert.match(html, /Target decisions \(1\).*not in the Needs Alan count/);
  const none = ctx.stLayoutParts.decisionsHtml({ decisions: [], needs_alan: needsAlan(dec([outlook]), []) });
  assert.match(none, /Needs Alan \(1\)/);
  assert.doesNotMatch(none, /<h4>Target decisions/);
});
