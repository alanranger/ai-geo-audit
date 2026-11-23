import test from 'node:test';
import assert from 'node:assert/strict';
import { aiAnswersTile } from '../lib/ceo-weekly/front-page.js';
import { briefAnswers } from '../lib/llm-visibility/run-plan.js';

test('the headline tile uses the 20-question bank and judges 10 of 20', () => {
  const latest = { meta: { prompt_bank_version: 4, engines: {
    chat_gpt: { ok: true, named: 10, of: 20 },
    gemini: { ok: true, named: 16, of: 20 },
    perplexity: { ok: true, named: 17, of: 20 },
    claude: { ok: true, named: 11, of: 20 }
  } } };
  const prior = { meta: { prompt_bank_version: 4, engines: {
    chat_gpt: { ok: true, named: 10, of: 20 },
    gemini: { ok: true, named: 15, of: 20 },
    perplexity: { ok: true, named: 17, of: 20 },
    claude: { ok: true, named: 12, of: 20 }
  } } };
  const brief = briefAnswers(latest, prior);
  const tile = aiAnswersTile({ llm: { prompts_named: 10, prompts_total: 20, score_line: brief.score_line } });
  assert.equal(tile.value, '10 of 20');
  assert.equal(tile.tone, 'green');
  assert.match(tile.sub, /ChatGPT 10 →0/);
  assert.match(tile.sub, /Gemini 16 ▲1/);
  assert.match(tile.sub, /Claude 11 ▼1/);
  assert.match(tile.sub, /target 10 of 20 by end of March/);
  assert.doesNotMatch(tile.sub, /new set from next run|12 strategy/);
});
