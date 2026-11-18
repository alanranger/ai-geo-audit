import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureFrom, engineLine, engineRows, pairClass, groupTotals, keepRival, cleanRivalDomains, clusterLines } from '../lib/acquisition/ai-picture.js';
import { LLM_CLUSTER_TAXONOMY } from '../lib/llm-visibility/cluster-taxonomy.js';
import bank from '../config/llm-strategy-questions.json' with { type: 'json' };
import { SITE_AI_HEALTH_WEIGHTS } from '../lib/audit/siteAiHealthComposite.js';
import { aiSection } from '../lib/acquisition/acquisition-sections.js';

test('tiles use the stored named counts and a missing engine stays empty', () => {
  const picture = pictureFrom([
    {
      run_at: '2026-11-16T00:00:00.000Z',
      meta: { engines: { chat_gpt: { ok: true, named: 7, of: 12, cited: 4, prompts: [
        { prompt: 'photography holidays UK', named: false, rivals: ['example.com'] }
      ] } } },
      prompt_results: []
    },
    { run_at: '2026-11-02T00:00:00.000Z', meta: { engines: { chat_gpt: { ok: true, named: 3, of: 11 } } } }
  ], [
    { ai_engines: { google_aio: { present: true, alan_citations_count: 1 }, google_ai_mode: { present: true, alan_citations_count: 0 } } },
    { ai_engines: { google_aio: { present: true, alan_citations_count: 0 }, google_ai_mode: { present: true, alan_citations_count: 1 } } }
  ], '2026-11-16');
  assert.equal(picture.engines.chat_gpt.named, 7);
  assert.equal(picture.engines.chat_gpt.of, 12);
  assert.equal(picture.engines.chat_gpt.trend, 'was 3 of 11');
  assert.equal(picture.engines.gemini, undefined);
  assert.equal(picture.google_aio.named, 1);
  assert.equal(picture.google_aio.of, 2);
  assert.equal(picture.google_ai_mode.named, 1);
  assert.equal(picture.google_ai_mode.of, 2);
  assert.match(picture.gaps[0], /photography holidays UK/);
  assert.match(picture.rivals[0], /example.com/);
  const tile = aiSection({}, picture).tiles.find((t) => t.label === 'ChatGPT answers naming you');
  assert.equal(tile.text, engineLine(picture.engines.chat_gpt).text);
  assert.equal(engineLine(picture.engines.gemini).text, 'no data this week');
  const row = engineRows(picture)[0];
  assert.equal(row.cells.chat_gpt.named, false);
  assert.equal(row.cells.gemini, null);
  assert.equal(row.rivals[0], 'example.com');
  assert.deepEqual(SITE_AI_HEALTH_WEIGHTS, { surface: 0.4, top: 0.4, brand: 0.2 });
});

test('chat trend uses the previous prompt results when that run stored no engine block', () => {
  const picture = pictureFrom([
    { run_at: '2026-11-18', meta: { engines: { chat_gpt: { ok: true, named: 6, of: 12, prompts: [] } } } },
    { run_at: '2026-11-16', prompt_results: [{ named: true }, { named: false }] }
  ]);
  assert.equal(picture.engines.chat_gpt.trend, 'was 1 of 2');
  assert.equal(picture.engines.gemini, undefined);
});

test('two runs classify as named, sometimes, or not named', () => {
  assert.equal(pairClass([true, true]), 'named');
  assert.equal(pairClass([true, false]), 'sometimes');
  assert.equal(pairClass([false, false]), 'not named');
});

test('group totals add up to the 20-question bank', () => {
  const prompts = [];
  for (let i = 0; i < 6; i += 1) prompts.push({ group: 'local', named: true, prompt: 'l' + i });
  for (let i = 0; i < 5; i += 1) prompts.push({ group: 'regional', named: false, prompt: 'r' + i });
  for (let i = 0; i < 9; i += 1) prompts.push({ group: 'national', named: i === 0, prompt: 'n' + i });
  const totals = groupTotals(prompts);
  assert.equal(totals.local.of + totals.regional.of + totals.national.of, 20);
  assert.equal(totals.local.of, 6);
  assert.equal(totals.regional.of, 5);
  assert.equal(totals.national.of, 9);
  assert.equal(totals.local.named, 6);
  assert.equal(totals.national.named, 1);
});

test('a new question bank suppresses the previous trend', () => {
  const picture = pictureFrom([
    { run_at: '2026-11-18T12:00:00.000Z', meta: { prompt_bank_version: 4, engines: { chat_gpt: { ok: true, named: 4, of: 20, sometimes: 2, prompts: [] } } } },
    { run_at: '2026-11-16T00:00:00.000Z', meta: { prompt_bank_version: 3, engines: { chat_gpt: { ok: true, named: 6, of: 12 } } } }
  ]);
  assert.equal(picture.engines.chat_gpt.trend, undefined);
  assert.equal(picture.breakNote, 'new question set, from 18 Nov');
  assert.equal(engineLine(picture.engines.chat_gpt).text, 'named in 4 of 20');
  assert.equal(engineLine(picture.engines.chat_gpt).sometimes, '+2 sometimes');
});

test('every locked question has a known cluster, including corporate', () => {
  const ids = new Set(LLM_CLUSTER_TAXONOMY.map((c) => c.cluster_id));
  assert.equal(bank.questions.length, 20);
  assert.equal(LLM_CLUSTER_TAXONOMY.length, 16);
  assert.ok(ids.has('CORPORATE-Regional'));
  for (const q of bank.questions) assert.ok(ids.has(q.cluster_id), q.prompt);
});

test('a two-question cluster counts strict names and drops non-rivals', () => {
  assert.equal(keepRival('google.com'), false);
  assert.equal(keepRival('vertexaisearch.cloud.google.com'), false);
  assert.equal(keepRival('alan-ranger.squarespace.com'), false);
  assert.equal(keepRival('yell.com'), true);
  const resolved = cleanRivalDomains('https://vertexaisearch.cloud.google.com/redirect?url=https%3A%2F%2Fyell.com%2Fa');
  assert.deepEqual(resolved, ['yell.com']);
  const lines = clusterLines({
    chat_gpt: { prompts: [
      { cluster_id: 'GIFTS-National', named: true, rivals: ['yell.com', 'google.com'] },
      { cluster_id: 'GIFTS-National', named: false, sometimes: true, rivals: ['alan-ranger.squarespace.com'] }
    ] }
  }, [{ cluster_id: 'GIFTS-National' }, { cluster_id: 'COMMERCIAL-Local-headshots' }]);
  assert.equal(lines[0].summary, 'ChatGPT 1/2 +1 sometimes');
  assert.deepEqual(lines[0].rivals, ['yell.com']);
  assert.equal(lines[1].summary, 'no question in set');
});
