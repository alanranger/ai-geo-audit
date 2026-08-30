import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ga4AttributedView,
  ga4Checks,
  NAMED_GA4_GROUPS,
  DIRECT_SHARE_WARN_PCT,
} from '../lib/acquisition/ga4-channels.js';
import {
  SOURCES,
  ga4Section,
  gscSection,
  gscExplainer,
  aiSection,
  youtubeSection,
  detailRows,
} from '../lib/acquisition/acquisition-sections.js';

/** The real 28d shape as at 30 Aug 2026, including the tiny channels. */
const rows = (over = {}) => {
  const groups = {
    'Organic Search': 8526,
    Direct: 6937,
    'Organic Social': 136,
    Referral: 109,
    'AI Assistant': 105,
    Email: 10,
    'Organic Shopping': 10,
    'Paid Search': 1,
    ...over,
  };
  const out = Object.entries(groups).map(([channel_group, sessions]) => ({
    date: '2026-08-20', channel_group, source: '', medium: '', sessions, is_unattributed: false,
  }));
  out.push({
    date: '2026-08-20', channel_group: 'Unassigned', source: '', medium: '', sessions: 42756, is_unattributed: true,
  });
  return out;
};

test('ga4AttributedView totals only attributed sessions, holding the bot bucket aside', () => {
  const view = ga4AttributedView(rows());
  assert.equal(view.total_sessions, 15834);
  assert.equal(view.unattributed_sessions, 42756);
  assert.equal(view.attributed_pct, 27);
});

test('tiles sum exactly to the total, because Other absorbs the small channels', () => {
  const view = ga4AttributedView(rows());
  assert.equal(view.tile_sum, view.total_sessions);
  assert.equal(view.reconciles, true);
  const other = view.tiles.find((t) => t.name === 'Other');
  assert.equal(other.sessions, 21, 'Email + Organic Shopping + Paid Search');
  assert.deepEqual(other.groups, ['Email', 'Organic Shopping', 'Paid Search']);
});

test('dropping the small channels would break reconciliation — the check catches it', () => {
  const named = ga4AttributedView(rows()).tiles.filter((t) => t.name !== 'Other');
  const result = ga4Checks({ tiles: named, total: 15834 });
  assert.equal(result.reconciles, false);
  const err = result.checks.find((c) => c.id === 'reconciles');
  assert.equal(err.level, 'error');
  assert.match(err.message, /15,813/);
  assert.match(err.message, /difference of 21/);
  assert.match(err.message, /Do not trust these tiles/);
});

test('Direct above the warn threshold raises the untagged-links flag', () => {
  const view = ga4AttributedView(rows());
  assert.ok(view.direct_share_pct > DIRECT_SHARE_WARN_PCT);
  const flag = view.checks.find((c) => c.id === 'direct_share');
  assert.equal(flag.level, 'warn');
  assert.match(flag.message, /Direct 44% — likely untagged links, verify/);
});

test('Direct below the threshold raises no flag', () => {
  const view = ga4AttributedView(rows({ Direct: 100 }));
  assert.equal(view.checks.some((c) => c.id === 'direct_share'), false);
});

test('a channel larger than the site total is flagged as impossible, not shown as fact', () => {
  const tiles = [{ name: 'Direct', sessions: 900, groups: ['Direct'] }];
  const result = ga4Checks({ tiles, total: 500 });
  const flag = result.checks.find((c) => c.id === 'impossible_value');
  assert.equal(flag.level, 'error');
  assert.match(flag.message, /more than the site total/);
});

test('every named group keeps its own tile so nothing hides inside Other', () => {
  const view = ga4AttributedView(rows());
  for (const name of NAMED_GA4_GROUPS) {
    assert.ok(view.tiles.some((t) => t.name === name), `${name} must have its own tile`);
  }
});

test('ga4Section labels Google organic as visits and reconciles', () => {
  const section = ga4Section(rows());
  assert.equal(section.source, 'GA4');
  assert.equal(section.unit, 'visits');
  const organic = section.tiles.find((t) => t.label === 'Google organic');
  assert.equal(organic.value, 8526, 'GA4 sessions, not the 6,307 GSC clicks');
  assert.equal(organic.unit, 'visits');
  assert.equal(section.reconciles, true);
});

test('ga4Section reports an error rather than an empty-looking zero when there is no data', () => {
  const section = ga4Section([]);
  assert.deepEqual(section.tiles, []);
  assert.equal(section.checks[0].level, 'error');
});

test('gscSection is fenced off, and its CTR derives from its own clicks and impressions', () => {
  const section = gscSection({ clicks: 6307, impressions: 1700000 });
  assert.equal(section.source, 'GSC');
  assert.equal(section.fenced, true);
  assert.match(section.subtitle, /do NOT add to GA4/);
  const ctr = section.tiles.find((t) => t.label === 'CTR');
  assert.equal(ctr.kind, 'pct');
  assert.equal(Number(ctr.value.toFixed(2)), 0.37);
});

test('the GSC explainer names both figures so neither looks wrong', () => {
  const text = gscExplainer(6307, 8526);
  assert.match(text, /6,307/);
  assert.match(text, /8,526/);
  assert.match(text, /Both correct/);
});

test('aiSection labels mentions as citations and says which platforms are missing', () => {
  const section = aiSection({
    monthly: { chat_gpt: [{ mentions: 93 }], google: [{ mentions: 832 }] },
    latest: { chat_gpt: { own_domain_mentions: 24, mentions: 93 } },
  });
  assert.equal(section.source, 'D4S');
  assert.match(section.subtitle, /NOT visits/);
  assert.equal(section.tiles[0].value, 93);
  assert.equal(section.tiles[0].unit, 'mentions');
  assert.match(section.tiles[0].sub, /cites you in 24 of 93/);
  const unavailable = section.tiles.find((t) => t.muted);
  assert.equal(unavailable.text, 'not available');
  assert.equal(unavailable.value, null);
});

test('youtubeSection says a view is not a visit, and marks impressions pending', () => {
  const section = youtubeSection(
    { value: 123, unit: 'views' },
    { subscribers: 154, total_views: 76800, total_videos: 40 },
    { views: 123, impressions: null, clicks_to_site: null }
  );
  assert.equal(section.source, 'YT');
  assert.match(section.subtitle, /a view is not a site visit/);
  assert.equal(section.tiles[0].value, 123);
  assert.equal(section.tiles[1].value, 154);
  assert.equal(section.tiles[2].sub, '40 videos');
  const pending = section.tiles.find((t) => t.muted);
  assert.equal(pending.text, 'pending');
});

test('detailRows carry source and unit per row, and skip unmeasured figures', () => {
  const sections = [
    ga4Section(rows()),
    gscSection({ clicks: 6307, impressions: 1700000 }),
    aiSection({ monthly: { chat_gpt: [{ mentions: 93 }], google: [] }, latest: {} }),
  ];
  const detail = detailRows(sections);
  const organic = detail.find((r) => r.channel === 'Google organic');
  assert.equal(organic.source, 'GA4');
  assert.equal(organic.unit, 'visits');
  const clicks = detail.find((r) => r.channel === 'Clicks');
  assert.equal(clicks.source, 'GSC');
  assert.equal(clicks.unit, 'clicks');
  assert.equal(detail.some((r) => r.value == null), false, 'a null must not become a table row');
});

test('every section badge resolves to a defined source', () => {
  const sections = [
    ga4Section(rows()),
    gscSection({ clicks: 1, impressions: 2 }),
    aiSection({ monthly: {}, latest: {} }),
    youtubeSection(null, null, null),
  ];
  for (const s of sections) assert.ok(SOURCES[s.source], `${s.source} needs badge metadata`);
});
