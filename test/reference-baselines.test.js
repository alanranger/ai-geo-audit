import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchReferenceBaselines, REFERENCE_BASELINE_DATES } from '../lib/keyword-ranking/load-rank-baselines.js';

function withMockedSupabase(rowsByDate, fn) {
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.SUPABASE_URL;
  const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  const asked = [];
  globalThis.fetch = async (url) => {
    const date = new URL(url).searchParams.get('audit_date').replace('eq.', '');
    asked.push(date);
    return { ok: true, json: async () => rowsByDate[date] || [] };
  };
  return fn(asked).finally(() => {
    globalThis.fetch = prevFetch;
    process.env.SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
  });
}

test('cron baselines come from the first reference audit with data (app parity)', async () => {
  const rows = {
    '2026-09-21': [
      { keyword: 'Photography Lessons Near Me', audit_date: '2026-09-21', best_rank_group: 1, location_code: 9215523, serp_features: {} },
      { keyword: 'corporate photography training', audit_date: '2026-09-21', best_rank_group: 3, location_code: 2826, serp_features: {} },
      { keyword: 'unranked one', audit_date: '2026-09-21', best_rank_group: null, location_code: 2826, serp_features: {} },
      { keyword: 'pending one', audit_date: '2026-09-21', best_rank_group: 2, location_code: 2826, serp_features: { confirmation_state: 'unconfirmed_unstable' } },
      { keyword: 'city one', audit_date: '2026-09-21', best_rank_group: 2, location_code: 9215523, serp_features: { geo_method: 'coventry_city_code' } },
    ],
  };
  await withMockedSupabase(rows, async (asked) => {
    const map = await fetchReferenceBaselines({
      propertyUrl: 'https://www.alanranger.com/',
      keywords: ['photography lessons near me', 'corporate photography training', 'unranked one', 'pending one', 'city one'],
    });
    assert.deepEqual(Object.keys(map).sort(), ['corporate photography training', 'photography lessons near me']);
    const local = map['photography lessons near me'];
    assert.equal(local.serp_features.geo_method, 'gbp_pin');
    assert.equal(local.location_coordinate, '52.3991769,-1.5937149,14z');
    assert.equal(map['corporate photography training'].serp_features.geo_method, 'uk_national');
    assert.equal(asked[0], REFERENCE_BASELINE_DATES[0]);
  });
});

test('falls back to the next reference date when the first has no rows', async () => {
  const rows = {
    '2026-09-14': [{ keyword: 'basic photography course', audit_date: '2026-09-14', best_rank_group: 7, location_code: 2826, serp_features: {} }],
  };
  await withMockedSupabase(rows, async () => {
    const map = await fetchReferenceBaselines({ propertyUrl: 'https://www.alanranger.com', keywords: ['basic photography course'] });
    assert.equal(map['basic photography course'].audit_date, '2026-09-14');
  });
});
