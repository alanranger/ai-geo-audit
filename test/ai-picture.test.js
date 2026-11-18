import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureFrom } from '../lib/acquisition/ai-picture.js';

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
});
