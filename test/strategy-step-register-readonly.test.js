/**
 * Viewing writes nothing (questions 2026-11-08): the plan build registers this week's steps insert-only, so an
 * unchanged read never rewrites a row or bumps last_seen_at; only a genuinely missing step is added.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveStepRegister } from '../lib/strategy-step-status.mjs';

test('step register: insert-only (ON CONFLICT DO NOTHING), done steps never registered', async () => {
  const calls = [];
  const sb = { from: (t) => ({ upsert: (rows, opts) => { calls.push({ t, rows, opts }); return Promise.resolve({ error: null }); } }) };
  const week = { week: '2026-11-09', steps: [{ key: 'step|2026-11-09|LinkedIn|2026-11-11', day: '2026-11-11', channel: 'LinkedIn', step: 'Post' }, { key: 'step|x|done', day: '2026-11-10', channel: 'Squarespace email (targeted)', step: 'sent', fixed_state: { status: 'done' } }] };
  assert.equal(await saveStepRegister(sb, 'https://www.alanranger.com', week), 1);
  assert.deepEqual(calls.map((c) => [c.t, c.rows.length, c.opts]), [['strategy_campaign_steps', 1, { onConflict: 'property_url,step_key', ignoreDuplicates: true }]]);
});
