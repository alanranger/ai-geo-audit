/**
 * Acquisition — source-grouped sections (pure functions, no IO).
 *
 * The tab used to lay every channel out in one grid: "Direct/referral 7,046"
 * (GA4 sessions) next to "Google organic 5,761" (Search Console clicks), no
 * labels, same styling, same row. Both numbers were correct and they were not
 * comparable, so the layout itself was the bug — it invited a total that means
 * nothing.
 *
 * The fix is structural rather than cosmetic. Figures are grouped by the tool
 * that measured them, every tile carries its source and unit, and only the GA4
 * section claims to add up. Nothing here places two tools' numbers where they
 * could be read as summable.
 */
import { ga4AttributedView } from './ga4-channels.js';

/**
 * Badge metadata. Text badges deliberately, not brand logos: a coloured word
 * always renders (email clients, print, high-contrast modes) and carries no
 * trademark licensing question. Colours echo each product without copying its
 * mark.
 */
export const SOURCES = {
  GA4: { key: 'GA4', label: 'GA4', name: 'Google Analytics 4', unit: 'visits', colour: '#2a78d6', ink: '#ffffff' },
  GSC: { key: 'GSC', label: 'GSC', name: 'Google Search Console', unit: 'clicks', colour: '#f9ab00', ink: '#3c4043' },
  D4S: { key: 'D4S', label: 'D4S', name: 'DataForSEO', unit: 'mentions', colour: '#10a37f', ink: '#ffffff' },
  YT: { key: 'YT', label: '\u25B6 YT', name: 'YouTube API', unit: 'views', colour: '#ff0000', ink: '#ffffff' },
};

/**
 * Left-edge accent colours.
 *
 * The GA4 section varies its accent per channel so six same-unit tiles stay
 * visually separable; every other section accents with its source colour,
 * because those tiles differ by metric rather than by channel. Unmeasured
 * tiles take the neutral accent — a colour would imply a source reported
 * something.
 */
const GA4_TILE_ACCENTS = ['#378ADD', '#D4537E', '#7F77DD', '#1D9E75', '#D85A30', '#888780'];
const MUTED_ACCENT = '#2a3140';

/** GA4's channel-group names, in the tab's own vocabulary. */
const GA4_TILE_LABELS = {
  'Organic Search': 'Google organic',
  Direct: 'Direct',
  Referral: 'Referral',
  'Organic Social': 'Organic Social',
  'AI Assistant': 'AI Assistant',
};

const tile = (label, value, opts = {}) => ({
  label,
  value: value == null ? null : Number(value),
  kind: opts.kind || 'count',
  unit: opts.unit ?? null,
  sub: opts.sub ?? null,
  text: opts.text ?? null,
  muted: Boolean(opts.muted),
  accent: opts.accent ?? null,
});

/** Stamp each tile with its accent, so the UI never has to guess a colour. */
function withAccents(tiles, sourceKey) {
  const colour = SOURCES[sourceKey]?.colour || MUTED_ACCENT;
  return tiles.map((t) => ({ ...t, accent: t.muted ? MUTED_ACCENT : colour }));
}

function ga4Tiles(view) {
  return view.tiles.map((g, i) => {
    const label = GA4_TILE_LABELS[g.name] || g.name;
    const accent = GA4_TILE_ACCENTS[i % GA4_TILE_ACCENTS.length];
    if (g.name === 'Direct') {
      return tile(label, g.sessions, { unit: 'visits', sub: 'visits · untagged', accent });
    }
    if (g.name === 'Other') {
      return tile('Other', g.sessions, { unit: 'visits', sub: `visits · ${g.groups.join(', ')}`, accent });
    }
    return tile(label, g.sessions, { unit: 'visits', sub: 'visits', accent });
  });
}

/**
 * GA4 sessions, the only section whose tiles are meant to be added together.
 *
 * "Other" is present so that promise holds: without it the named groups fall
 * short of the site total by whatever sits in Email / Organic Shopping / Paid
 * Search, and the reconcile tick would be a lie of a couple of dozen sessions.
 */
export function ga4Section(ga4Rows) {
  if (!ga4Rows?.length) {
    return {
      key: 'ga4_visits',
      source: 'GA4',
      title: 'Site visits',
      unit: 'visits',
      subtitle: 'one ruler, so these add up to your site total',
      tiles: [],
      checks: [{ id: 'no_data', level: 'error', ok: false, message: 'No GA4 channel sessions for this period.' }],
      total: null,
      unattributed_sessions: null,
      attributed_pct: null,
      explainer: null,
    };
  }
  const view = ga4AttributedView(ga4Rows);
  return {
    key: 'ga4_visits',
    source: 'GA4',
    title: 'Site visits',
    unit: 'visits',
    subtitle: 'one ruler, so these add up to your site total',
    tiles: ga4Tiles(view),
    checks: view.checks,
    total: view.total_sessions,
    tile_sum: view.tile_sum,
    reconciles: view.reconciles,
    direct_share_pct: view.direct_share_pct,
    unattributed_sessions: view.unattributed_sessions,
    attributed_pct: view.attributed_pct,
    explainer: 'GA4 counts sessions on alanranger.com. It will not match Squarespace, which counts differently again,'
      + ' and it excludes GA4\'s automated "Unassigned" bucket.',
  };
}

/**
 * Days of data actually present, which is not the same as the days requested.
 *
 * Search Console publishes three to four days behind, so a 28-day filter
 * typically holds ~25 days of clicks. Labelling that "28 days" understates the
 * daily rate and is the likeliest reason a GSC figure quoted from one window
 * fails to match the same window a few days later.
 */
export function gscCoverage(rows) {
  const dates = (rows || []).map((r) => r?.date).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
  if (!dates.length) return null;
  return { first_day: dates[0], last_day: dates.at(-1), days_with_data: new Set(dates).size };
}

export function gscSection(totals, coverage) {
  const clicks = totals?.clicks ?? null;
  const impressions = totals?.impressions ?? null;
  const ctr = clicks != null && impressions ? (clicks / impressions) * 100 : null;
  const span = coverage
    ? `${coverage.days_with_data} days of data (to ${coverage.last_day}) — Search Console publishes a few days behind`
    : 'all pages';
  return {
    key: 'gsc',
    source: 'GSC',
    title: 'Google Search',
    unit: 'clicks',
    subtitle: 'different tool; clicks in Google results only; do NOT add to GA4',
    fenced: true,
    coverage: coverage || null,
    tiles: withAccents([
      tile('Clicks', clicks, { unit: 'clicks', sub: span }),
      tile('Impressions', impressions, { unit: 'impr', sub: 'reach' }),
      tile('CTR', ctr, { kind: 'pct', unit: '%', sub: 'clicks / impressions' }),
    ], 'GSC'),
    explainer: null,
  };
}

/** Filled in by the API, which knows the matching GA4 organic figure. */
export function gscExplainer(gscClicks, ga4OrganicVisits) {
  if (gscClicks == null || ga4OrganicVisits == null) {
    return 'Search Console clicks and GA4 visits count different things and will not match.';
  }
  return `GSC clicks (${gscClicks.toLocaleString()}) \u2260 GA4 Google visits (${ga4OrganicVisits.toLocaleString()}):`
    + ' GSC sees only Google-Search clicks; GA4 counts every visit. Both correct.';
}

const sumMentions = (rows) => (rows || []).reduce((t, r) => t + Number(r.mentions || 0), 0);

/**
 * The citation figure comes from the newest daily snapshot; the tile value is
 * the period's monthly mention total. Two different bases, so the sub-line has
 * to say so — otherwise Google AI reads "274 mentions · cites you in 832 of
 * 832", which looks impossible and undermines every other number on the tab.
 */
function citedSub(cited, of) {
  if (cited == null) return 'mentions this period';
  if (of == null) return `latest snapshot: cites you ${cited.toLocaleString()} times`;
  return `latest snapshot: cited in ${cited.toLocaleString()} of ${of.toLocaleString()} tracked prompts`;
}

function aiTile(label, monthly, latest) {
  const mentions = sumMentions(monthly);
  const sub = citedSub(latest?.own_domain_mentions ?? null, latest?.mentions ?? null);
  return tile(label, mentions, { unit: 'mentions', sub });
}

export function aiSection(llm) {
  return {
    key: 'ai_visibility',
    source: 'D4S',
    title: 'AI visibility',
    unit: 'mentions',
    subtitle: 'citations in AI answers; NOT visits',
    tiles: withAccents([
      aiTile('ChatGPT', llm?.monthly?.chat_gpt, llm?.latest?.chat_gpt),
      aiTile('Google AI (Overviews)', llm?.monthly?.google, llm?.latest?.google),
      tile('Gemini \u00B7 Perplexity', null, { text: 'not available', sub: 'DataForSEO doesn\'t cover these', muted: true }),
    ], 'D4S'),
    explainer: 'A mention is a citation in an AI answer, not a visit. Nobody necessarily clicked.',
  };
}

/**
 * Impressions are the honest reach unit here, and they only arrive from the
 * YouTube Reporting API's first bulk report. Until then the tile says "pending"
 * rather than rendering an empty value — a blank number reads as zero reach.
 */
function youtubePendingTile(engagement) {
  const impressions = engagement?.impressions ?? null;
  const clicks = engagement?.clicks_to_site ?? null;
  if (impressions == null) {
    const sub = clicks == null
      ? 'awaiting the first YouTube Reporting API report'
      : `${clicks.toLocaleString()} clicks to site · impressions awaiting the Reporting API`;
    return tile('Impressions / clicks-to-site', null, { text: 'pending', sub, muted: true });
  }
  return tile('Impressions', impressions, {
    unit: 'impr',
    sub: clicks == null ? 'thumbnail impressions' : `${clicks.toLocaleString()} clicks to site`,
  });
}

export function youtubeSection(reach, context, engagement) {
  const tiles = [
    tile('Views (period)', reach?.unit === 'views' ? reach.value : engagement?.views ?? null, {
      unit: 'views',
      sub: 'channel reach',
    }),
    tile('Subscribers', context?.subscribers ?? null, { unit: 'subs', sub: 'lifetime' }),
    tile('Lifetime views', context?.total_views ?? null, {
      unit: 'views',
      sub: context?.total_videos == null ? 'lifetime' : `${context.total_videos} videos`,
    }),
    youtubePendingTile(engagement),
  ];
  return {
    key: 'youtube',
    source: 'YT',
    title: 'YouTube',
    unit: 'views',
    subtitle: 'channel reach; a view is not a site visit',
    tiles: withAccents(tiles, 'YT'),
    explainer: 'A YouTube view is not a site visit. Clicks-to-site is the only figure here that reaches alanranger.com.',
  };
}

/**
 * Flat rows for the detail table. Source and unit travel as their own columns,
 * so a reader sorting by value cannot end up comparing clicks with sessions
 * without seeing that is what they are doing.
 */
export function detailRows(sections) {
  const rows = [];
  for (const section of sections) {
    for (const t of section.tiles) {
      if (t.value == null) continue;
      rows.push({
        channel: t.label,
        source: section.source,
        unit: t.unit || section.unit,
        kind: t.kind,
        value: t.value,
        section: section.title,
      });
    }
  }
  return rows;
}

/** Merge prior-period values onto tiles for period-over-period deltas. */
export function attachPrevToSections(sections, prevSections) {
  const prevMap = new Map();
  for (const section of prevSections || []) {
    for (const t of section.tiles || []) {
      if (t.value == null) continue;
      prevMap.set(`${section.key}:${t.label}`, Number(t.value));
    }
  }
  return (sections || []).map((section) => ({
    ...section,
    tiles: (section.tiles || []).map((t) => ({
      ...t,
      prev: prevMap.has(`${section.key}:${t.label}`) ? prevMap.get(`${section.key}:${t.label}`) : null,
    })),
  }));
}
