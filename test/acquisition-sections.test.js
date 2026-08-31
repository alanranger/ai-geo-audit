import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ga4AttributedView,
  ga4Checks,
  NAMED_GA4_GROUPS,
  DIRECT_SHARE_WARN_PCT,
  engagementRag,
  ga4PriorComparable,
  ENGAGED_PCT_GREEN,
  DURATION_SEC_GREEN,
} from '../lib/acquisition/ga4-channels.js';
import {
  weekBuckets,
  bucketGa4EngagementSeries,
} from '../lib/acquisition/channels-report.js';
import {
  SOURCES,
  ga4RealVisitsSection,
  ga4Section,
  gscSection,
  gscCoverage,
  gscExplainer,
  aiSection,
  youtubeSection,
  detailRows,
  attachPrevToSections,
} from '../lib/acquisition/acquisition-sections.js';

/** The real 28d shape as at 30 Aug 2026, including the tiny channels. */
const rows = (over = {}) => {
  const groups = {
    'Organic Search': { sessions: 8526, engaged: 4467, avgSec: 172 },
    Direct: { sessions: 6937, engaged: 3344, avgSec: 69 },
    'Organic Social': { sessions: 136, engaged: 40, avgSec: 91 },
    Referral: { sessions: 109, engaged: 66, avgSec: 180 },
    'AI Assistant': { sessions: 105, engaged: 52, avgSec: 198 },
    Email: { sessions: 10, engaged: 6, avgSec: 263 },
    'Organic Shopping': { sessions: 10, engaged: 6, avgSec: 141 },
    'Paid Search': { sessions: 1, engaged: 1, avgSec: 11 },
    ...over,
  };
  const out = Object.entries(groups).map(([channel_group, meta]) => {
    const m = typeof meta === 'number' ? { sessions: meta, engaged: Math.round(meta * 0.5), avgSec: 120 } : meta;
    return {
      date: '2026-08-20',
      channel_group,
      source: '',
      medium: '',
      sessions: m.sessions,
      engaged_sessions: m.engaged,
      avg_session_seconds: m.avgSec,
      is_unattributed: false,
    };
  });
  out.push({
    date: '2026-08-20', channel_group: 'Unassigned', source: '', medium: '', sessions: 42756,
    engaged_sessions: 1496, avg_session_seconds: 5, is_unattributed: true,
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

test('ga4PriorComparable hides 90d deltas until enough prior history exists', () => {
  assert.equal(ga4PriorComparable(2, 90), false);
  assert.equal(ga4PriorComparable(31, 60), true);
  assert.equal(ga4PriorComparable(28, 28), true);
});

test('bucketGa4EngagementSeries returns weekly engaged rate and duration', () => {
  const buckets = weekBuckets(28, new Date('2026-08-30'));
  const rows = [{
    date: '2026-08-20',
    channel_group: 'Organic Search',
    source: 'google',
    medium: 'organic',
    sessions: 100,
    engaged_sessions: 52,
    avg_session_seconds: 180,
    is_unattributed: false,
  }];
  const pct = bucketGa4EngagementSeries(rows, buckets, 'google_organic', 'engaged_pct');
  const sec = bucketGa4EngagementSeries(rows, buckets, 'google_organic', 'avg_session_seconds');
  assert.ok(pct.some((v) => v === 52));
  assert.ok(sec.some((v) => v === 180));
});

test('engagementRag bands human traffic green and bot-like traffic red', () => {
  assert.deepEqual(engagementRag({ engaged_pct: 52.4, avg_session_seconds: 172 }), {
    engaged_band: 'green',
    duration_band: 'green',
  });
  assert.deepEqual(engagementRag({ engaged_pct: 48.2, avg_session_seconds: 69 }), {
    engaged_band: 'green',
    duration_band: 'amber',
  });
  assert.deepEqual(engagementRag({ engaged_pct: 3.5, avg_session_seconds: 5 }), {
    engaged_band: 'red',
    duration_band: 'red',
  });
});

test('ga4Section tiles carry RAG bands for the UI', () => {
  const section = ga4Section(rows());
  const organic = section.tiles.find((t) => t.label === 'Google organic');
  const direct = section.tiles.find((t) => t.label === 'Direct');
  assert.equal(organic.engaged_band, 'green');
  assert.equal(organic.duration_band, 'green');
  assert.equal(direct.engaged_band, 'green');
  assert.equal(direct.duration_band, 'amber');
});

test('ga4AttributedView attaches engaged rate and avg session per channel', () => {
  const view = ga4AttributedView(rows());
  const organic = view.tiles.find((t) => t.name === 'Organic Search');
  const direct = view.tiles.find((t) => t.name === 'Direct');
  assert.equal(organic.engaged_pct, 52.4);
  assert.equal(organic.avg_session_seconds, 172);
  assert.equal(direct.engaged_pct, 48.2);
  assert.equal(direct.avg_session_seconds, 69);
  assert.ok(view.engaged_pct > 48 && view.engaged_pct < 51);
});

test('ga4Section tiles expose engagement metrics for the UI', () => {
  const section = ga4Section(rows());
  const organic = section.tiles.find((t) => t.label === 'Google organic');
  const direct = section.tiles.find((t) => t.label === 'Direct');
  assert.equal(organic.engaged_pct, 52.4);
  assert.equal(organic.avg_session_seconds, 172);
  assert.equal(direct.engaged_pct, 48.2);
  assert.equal(direct.avg_session_seconds, 69);
});

test('ga4RealVisitsSection shows attributed total and names excluded bots', () => {
  const section = ga4RealVisitsSection(rows());
  assert.equal(section.key, 'ga4_real_visits');
  assert.equal(section.tiles.length, 1);
  assert.equal(section.tiles[0].label, 'Total visits');
  assert.equal(section.tiles[0].value, 15834);
  assert.match(section.tiles[0].sub, /excl\. 42,756 bots/);
  assert.ok(section.tiles[0].engaged_pct > 48);
  assert.ok(section.tiles[0].avg_session_seconds > 100);
  assert.equal(section.unattributed_sessions, 42756);
  assert.match(section.explainer, /42,756 Unassigned sessions excluded/);
});

test('attachPrevToSections merges prior totals for period deltas', () => {
  const current = [ga4RealVisitsSection(rows()), ga4Section(rows())];
  const previous = [
    ga4RealVisitsSection(rows({ 'Organic Search': { sessions: 7000, engaged: 3500, avgSec: 160 }, Direct: { sessions: 5000, engaged: 2400, avgSec: 60 } })),
    ga4Section(rows({ 'Organic Search': { sessions: 7000, engaged: 3500, avgSec: 160 }, Direct: { sessions: 5000, engaged: 2400, avgSec: 60 } })),
  ];
  const merged = attachPrevToSections(current, previous);
  const headline = merged[0].tiles[0];
  assert.equal(headline.value, 15834);
  assert.equal(headline.prev, 12371);
  const organic = merged[1].tiles.find((t) => t.label === 'Google organic');
  assert.equal(organic.prev, 7000);
});

test('ga4Section labels Google organic as visits and reconciles', () => {
  const section = ga4Section(rows());
  assert.equal(section.source, 'GA4');
  assert.equal(section.title, 'Visits by channel');
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

test('gscCoverage reports the days actually present, not the days requested', () => {
  const rows = [
    { date: '2026-08-02' }, { date: '2026-08-03' }, { date: '2026-08-26' },
  ];
  const cov = gscCoverage(rows);
  assert.equal(cov.first_day, '2026-08-02');
  assert.equal(cov.last_day, '2026-08-26');
  assert.equal(cov.days_with_data, 3);
  assert.equal(gscCoverage([]), null);
});

test('the clicks tile states its real coverage, since GSC publishes days behind', () => {
  const section = gscSection({ clicks: 5761, impressions: 1505716 }, {
    first_day: '2026-08-02', last_day: '2026-08-26', days_with_data: 25,
  });
  const clicks = section.tiles.find((t) => t.label === 'Clicks');
  assert.match(clicks.sub, /25 days of data/);
  assert.match(clicks.sub, /2026-08-26/);
  assert.equal(section.coverage.days_with_data, 25);
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
  // The citation count comes from the newest snapshot, the value from the
  // period, so the sub-line must name its basis. Google AI otherwise reads
  // "274 mentions · cites you in 832 of 832", which looks impossible.
  assert.match(section.tiles[0].sub, /latest snapshot: cited in 24 of 93 tracked prompts/);
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

test('a measured zero clicks-to-site does not turn impressions into a blank number', () => {
  const section = youtubeSection({ value: 123, unit: 'views' }, null, {
    views: 123, impressions: null, clicks_to_site: 0,
  });
  const pending = section.tiles.find((t) => t.label.startsWith('Impressions'));
  assert.equal(pending.value, null, 'a null impressions figure must not render as an empty tile');
  assert.equal(pending.text, 'pending');
  assert.equal(pending.muted, true);
  assert.match(pending.sub, /0 clicks to site/);
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

test('every tile carries an accent colour, so the UI never guesses one', () => {
  const sections = [
    ga4Section(rows()),
    gscSection({ clicks: 1, impressions: 2 }),
    aiSection({ monthly: {}, latest: {} }),
    youtubeSection(null, null, null),
  ];
  for (const s of sections) {
    for (const t of s.tiles) {
      assert.match(t.accent || '', /^#[0-9a-fA-F]{6}$/, `${s.title} / ${t.label} needs an accent`);
    }
  }
});

test('GA4 tiles vary their accent per channel; other sections use the source colour', () => {
  const ga4 = ga4Section(rows());
  const accents = ga4.tiles.map((t) => t.accent);
  assert.equal(new Set(accents).size, accents.length, 'six same-unit tiles must stay separable');

  const gsc = gscSection({ clicks: 1, impressions: 2 });
  for (const t of gsc.tiles) assert.equal(t.accent, SOURCES.GSC.colour);
});

test('an unmeasured tile takes a neutral accent, not a source colour', () => {
  const section = aiSection({ monthly: {}, latest: {} });
  const unavailable = section.tiles.find((t) => t.muted);
  assert.notEqual(unavailable.accent, SOURCES.D4S.colour, 'colour would imply D4S measured it');
});
