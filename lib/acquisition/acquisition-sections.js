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

export const BADGE_LEGEND = [
  { source: 'GA4', text: 'visits' },
  { source: 'GSC', text: 'Google Search clicks' },
  { source: 'D4S', text: 'DataForSEO AI mentions' },
  { source: 'YT', text: 'YouTube views' },
];

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
});

function ga4Tiles(view) {
  return view.tiles.map((g) => {
    const label = GA4_TILE_LABELS[g.name] || g.name;
    if (g.name === 'Direct') return tile(label, g.sessions, { unit: 'visits', sub: 'visits · untagged' });
    if (g.name === 'Other') {
      return tile('Other', g.sessions, { unit: 'visits', sub: `visits · ${g.groups.join(', ')}` });
    }
    return tile(label, g.sessions, { unit: 'visits', sub: 'visits' });
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

export function gscSection(totals) {
  const clicks = totals?.clicks ?? null;
  const impressions = totals?.impressions ?? null;
  const ctr = clicks != null && impressions ? (clicks / impressions) * 100 : null;
  return {
    key: 'gsc',
    source: 'GSC',
    title: 'Google Search',
    unit: 'clicks',
    subtitle: 'different tool; clicks in Google results only; do NOT add to GA4',
    fenced: true,
    tiles: [
      tile('Clicks', clicks, { unit: 'clicks', sub: 'all pages' }),
      tile('Impressions', impressions, { unit: 'impr', sub: 'reach' }),
      tile('CTR', ctr, { kind: 'pct', unit: '%', sub: 'clicks / impressions' }),
    ],
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

function citedSub(cited, of) {
  if (cited == null) return 'mentions tracked';
  if (of == null) return `cites you in ${cited.toLocaleString()}`;
  return `cites you in ${cited.toLocaleString()} of ${of.toLocaleString()}`;
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
    tiles: [
      aiTile('ChatGPT', llm?.monthly?.chat_gpt, llm?.latest?.chat_gpt),
      aiTile('Google AI (Overviews)', llm?.monthly?.google, llm?.latest?.google),
      tile('Gemini \u00B7 Perplexity', null, { text: 'not available', sub: 'DataForSEO doesn\'t cover these', muted: true }),
    ],
    explainer: 'A mention is a citation in an AI answer, not a visit. Nobody necessarily clicked.',
  };
}

function youtubePendingTile(engagement) {
  const impressions = engagement?.impressions ?? null;
  const clicks = engagement?.clicks_to_site ?? null;
  if (impressions == null && clicks == null) {
    return tile('Impressions / clicks-to-site', null, {
      text: 'pending',
      sub: 'awaiting the first YouTube Reporting API report',
      muted: true,
    });
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
    tiles,
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
