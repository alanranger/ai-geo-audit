import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureFrom, engineLine, engineRows } from '../lib/acquisition/ai-picture.js';
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
