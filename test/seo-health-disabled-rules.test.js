import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionSeoHealth } from '../lib/ceo-weekly/defSections.js';

function fakeSupabase(tables) {
  return {
    from(name) {
      const result = { data: tables[name] ?? null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: (tables[name] || [])[0] ?? null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
      };
      return chain;
    }
  };
}

const rows = [
  { url: 'https://www.alanranger.com/blog/a', rule_key: 'title_present', status: 'pass' },
  { url: 'https://www.alanranger.com/blog/a', rule_key: 'thin_content_guardrail', status: 'warn' },
  { url: 'https://www.alanranger.com/blog/b', rule_key: 'gsc_url_indexed', status: 'fail' }
];

function rules(enabled) {
  return [
    { rule_key: 'title_present', rule_name: 'Title present', enabled: true, weight: 1 },
    { rule_key: 'thin_content_guardrail', rule_name: 'Thin content guardrail', enabled: enabled.thin, weight: 1 },
    { rule_key: 'gsc_url_indexed', rule_name: 'Indexed in Google', enabled: enabled.gsc, weight: 1 }
  ];
}

function brief(enabled) {
  return sectionSeoHealth(fakeSupabase({
    traditional_seo_rules: rules(enabled),
    traditional_seo_evaluation_cache: [{ evaluation_rows: rows, last_evaluation_at: '2026-11-06T08:00:00Z' }],
    traditional_seo_score_snapshots: [],
    domain_strength_snapshots: []
  }), null);
}

test('a disabled rule never changes the Monday brief score, warn count or open fail', async () => {
  const off = await brief({ thin: false, gsc: false });
  assert.deepEqual(off.hygiene, { enabled: 1, pass: 1, warn: 0, fail: 0 });
  assert.equal(off.score, 100);
  assert.equal(off.open_fail, 'none');
});

test('a site-wide rule is scored from its site-wide row', async () => {
  const out = await sectionSeoHealth(fakeSupabase({
    traditional_seo_rules: [{ rule_key: 'robots_fetchable', rule_name: 'robots.txt fetchable', enabled: true, weight: 1 }],
    traditional_seo_evaluation_cache: [{ evaluation_rows: [{ url: 'https://www.alanranger.com/', tier: 'sitewide', rule_key: 'robots_fetchable', status: 'fail' }] }],
    traditional_seo_score_snapshots: [],
    domain_strength_snapshots: []
  }), null);
  assert.deepEqual(out.hygiene, { enabled: 1, pass: 0, warn: 0, fail: 1 });
  assert.equal(out.open_fail, 'robots.txt fetchable');
});

test('re-enabling the rules brings their saved results back with no re-crawl', async () => {
  const on = await brief({ thin: true, gsc: true });
  assert.deepEqual(on.hygiene, { enabled: 3, pass: 1, warn: 1, fail: 1 });
  assert.equal(on.open_fail, '1 page not indexed in Google');
});
