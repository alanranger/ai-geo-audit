import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCallPlan, callKey, emptyState, briefAnswers, previousWeekSnapshot,
  reduceCall, runBudget, weekStartUtc
} from '../lib/llm-visibility/run-plan.js';

const prompts = [{ prompt: 'a' }, { prompt: 'b' }];

test('two ticks cover every call once', async () => {
  const plan = buildCallPlan(prompts);
  const asks = plan.filter((item) => item.kind === 'ask');
  assert.equal(asks.length, 16);
  assert.equal(new Set(asks.map(callKey)).size, 16);
  const seen = [];
  const ask = async (item) => {
    seen.push(callKey(item));
    return { ok: true, named: true, cited: false, rivals: [], cost: 0.01 };
  };
  const first = await runBudget(emptyState(), plan, { budgetMs: 5000, maxCalls: 5, ask, setup: async () => ({ cost: 0.1 }) });
  const second = await runBudget(first, plan, { budgetMs: 5000, maxCalls: 20, ask, setup: async () => ({ cost: 0.1 }) });
  assert.equal(second.done, true);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, 16);
});

test('a failed answer skips the rest of that engine and the run finishes only when the plan is done', () => {
  const plan = buildCallPlan([{ prompt: 'a' }]);
  let state = emptyState();
  state = reduceCall(state, plan[0], { cost: 0 }, plan);
  assert.equal(state.done, false);
  state = reduceCall(state, plan[state.cursor], { ok: false, cost: 0.01 }, plan);
  assert.equal(plan[state.cursor].engine, 'gemini');
  assert.equal(state.done, false);
});

test('the weekly brief hides the arrow when the question bank changes', () => {
  const latest = { run_at: '2026-11-18T11:47:00.000Z', meta: { prompt_bank_version: 4, engines: { chat_gpt: { ok: true, named: 10, of: 20 } } } };
  const older = { run_at: '2026-11-09T00:00:00.000Z', meta: { prompt_bank_version: 3, engines: { chat_gpt: { ok: true, named: 7, of: 12 } } } };
  const same = { run_at: '2026-11-11T00:00:00.000Z', meta: { prompt_bank_version: 4, engines: { chat_gpt: { ok: true, named: 8, of: 20 } } } };
  assert.equal(weekStartUtc('2026-11-18T11:47:00.000Z'), '2026-11-16T00:00:00.000Z');
  const broken = briefAnswers(latest, previousWeekSnapshot([latest, older], latest));
  assert.equal(broken.arrow, false);
  assert.match(broken.text, /new question set \(from 18 Nov\)/);
  assert.doesNotMatch(broken.text, /▲|▼/);
  const held = briefAnswers(latest, same);
  assert.equal(held.arrow, true);
  assert.match(held.text, /▲2/);
});
