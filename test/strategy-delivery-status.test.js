/**
 * Strategy next actions use the ONE delivery-status vocabulary (lib/marketing/delivery-status.mjs): status word + icon,
 * and sent / published / done items never appear as next actions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { status } from '../lib/marketing/delivery-status.mjs';
import { attachStatus, statusIndex, statusLine, statusOut } from '../lib/strategy-delivery-status.mjs';
import { nextActionOf } from '../lib/strategy-initiatives.mjs';

const board = {
  as_of: '2026-11-09T10:30:00Z', last_checked: '2026-11-09T10:15:00Z',
  emails: [{ key: 'theme|tue', campaign_key: 'theme|tue', status: status('scheduled', { at: '2026-11-10T10:00:00Z', when: 'Scheduled Tue 10 Nov 10:00am' }) }],
  placements: [
    { step_key: 'li-norfolk', placement: 'linkedin_feed', status: status('published', { at: '2026-11-09T08:00:00Z', when: 'Published Mon 9 Nov 8:00am' }) },
    { step_key: 'fbig-tip', placement: 'facebook_feed', status: status('published', { at: '2026-11-10T18:30:00Z' }) },
    { step_key: 'fbig-tip', placement: 'instagram_feed', status: status('in_preparation', { at: '2026-11-10T18:30:00Z', when: 'Planned 6:30pm', blocker: 'missing rendered asset' }) }
  ],
  tasks: [{ step_key: 'outlook-1', status: status('done', { evidence: 'ticked as done' }) }]
};
const list = [
  { key: 'li-norfolk', day: '2026-11-09', channel: 'LinkedIn', title: 'Norfolk', status: 'pending', draft: true },
  { key: 'send|theme|tue', day: '2026-11-10', channel: 'Squarespace email (targeted)', title: 'Tuesday email', status: 'scheduled' },
  { key: 'fbig-tip', day: '2026-11-10', channel: 'Facebook + Instagram', title: 'Tip', status: 'pending', draft: true },
  { key: 'outlook-1', day: '2026-11-09', channel: 'Outlook personal notes', title: 'Note', status: 'pending' }
];

test('status line: icon + word + dated when ("🕒 Scheduled Tue 10 Nov 10:00am", "📄 In preparation · Planned Tue 10 Nov 6:30pm")', () => {
  assert.equal(statusLine(status('scheduled', { when: 'Scheduled Tue 10 Nov 10:00am' }), '2026-11-10'), '🕒 Scheduled Tue 10 Nov 10:00am');
  assert.equal(statusLine(status('in_preparation', { when: 'Planned 6:30pm' }), '2026-11-10'), '📄 In preparation · Planned Tue 10 Nov 6:30pm');
  assert.equal(statusLine(status('needs_approval', { when: 'Planned Tue 10 Nov' }), '2026-11-10'), '⚠ Needs approval · Planned Tue 10 Nov');
});

test('index: least-advanced placement per step (one published + one in preparation = in preparation); emails by send|campaign', () => {
  const idx = statusIndex(board);
  assert.equal(idx['fbig-tip'].code, 'in_preparation');
  assert.equal(idx['send|theme|tue'].code, 'scheduled');
  assert.equal(idx['li-norfolk'].code, 'published');
  assert.equal(statusIndex({ error: 'x' }), null);
});

test('published / done never a next action; next shows the shared status word + icon', () => {
  const ds = attachStatus(list, statusIndex(board));
  const n = nextActionOf({}, ds, '2026-11-09');
  assert.equal(n.key, 'send|theme|tue');
  assert.equal(n.status.code, 'scheduled');
  assert.equal(n.status_line, '🕒 Scheduled Tue 10 Nov 10:00am');
  assert.equal(n.then.key, 'fbig-tip');
  assert.equal(n.then.status_line, '📄 In preparation · Planned Tue 10 Nov 6:30pm');
  assert.ok(!ds.find((d) => d.key === 'li-norfolk').draft);
});

test('board unavailable: same vocabulary from the plan record, nothing marked sent', () => {
  const n = nextActionOf({}, attachStatus(list, null), '2026-11-09');
  assert.equal(n.key, 'li-norfolk');
  assert.equal(n.status.code, 'in_preparation');
  assert.match(n.status_line, /^📄 In preparation · Planned Mon 9 Nov$/);
  assert.equal(statusOut({ error: 'down' }, null).error, 'down');
});

test('statusOut gives the Next delivery line per key with its day', () => {
  const o = statusOut(board, statusIndex(board));
  assert.equal(o.by_key['send|theme|tue'].line, '🕒 Scheduled Tue 10 Nov 10:00am');
  assert.equal(o.by_key['fbig-tip'].line, '📄 In preparation · Planned Tue 10 Nov 6:30pm');
});
