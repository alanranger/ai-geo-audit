/**
 * WS6 — enrich check-2 / check-3 findings with meaning, at_stake, suggested_action, workstream.
 * Presentation only — no check logic changes.
 */
import { isFunnelMoneyPath, pathOnly } from '../audit/moneyPageRoles.js';
import { normKw } from './checks.mjs';

const COURSES_HUB = '/photography-courses-coventry';
const FREE_COURSE = '/free-online-photography-course';
const HIRE_SWAP = new Set([
  '/hire-a-professional-photographer-in-coventry',
  '/professional-photographer-near-me'
]);
const WORKSHOP_SWAP = new Set([
  '/photography-workshops',
  '/landscape-photography-workshops',
  '/photography-workshops-near-me'
]);

function pageTypeLabel(path, pagesMap) {
  const p = pathOnly(path);
  if (!p) return 'page';
  if (p.includes('/blog-on-photography/')) return 'blog post';
  if (p === COURSES_HUB) return 'courses hub';
  if (p === FREE_COURSE || isFunnelMoneyPath(p)) return 'free course';
  const row = pagesMap?.get?.(p);
  const tier = String(row?.tier || '').toLowerCase();
  if (tier === 'd_blog' || tier === 'blog') return 'blog post';
  if (tier === 'e_academy' || tier === 'academy') return 'academy page';
  if (tier === 'b_product' || tier === 'product') return 'product page';
  if (tier === 'a_landing' || tier === 'landing') return 'landing page';
  return 'page';
}

function parseGooglePrefers(detail) {
  const m = String(detail || '').match(/^Google prefers ([^;]+); assigned page (.+)$/);
  if (!m) return null;
  return { preferred: pathOnly(m[1]), assigned: pathOnly(m[2]) };
}

function buildSwapIndex(findings) {
  const pairs = new Map();
  for (const f of findings) {
    if (Number(f.check) !== 3) continue;
    const parsed = parseGooglePrefers(f.detail);
    if (!parsed) continue;
    pairs.set(`${parsed.assigned}|${parsed.preferred}`, parsed.assigned);
  }
  const mutual = new Set();
  for (const f of findings) {
    if (Number(f.check) !== 3) continue;
    const parsed = parseGooglePrefers(f.detail);
    if (!parsed) continue;
    const rev = `${parsed.preferred}|${parsed.assigned}`;
    if (pairs.has(rev)) mutual.add(normKw(f.subject));
  }
  return mutual;
}

function otherSwapPage(preferred, assigned) {
  if (HIRE_SWAP.has(preferred) && HIRE_SWAP.has(assigned)) {
    return preferred === '/hire-a-professional-photographer-in-coventry'
      ? '/professional-photographer-near-me'
      : '/hire-a-professional-photographer-in-coventry';
  }
  if (WORKSHOP_SWAP.has(preferred) || WORKSHOP_SWAP.has(assigned)) {
    for (const p of WORKSHOP_SWAP) {
      if (p !== preferred && p !== assigned) return p;
    }
  }
  return '';
}

function tagWorkstream(keyword, preferred, assigned, mutualSwap) {
  const nk = normKw(keyword);
  if (mutualSwap.has(nk)) return 'WS2';
  if (HIRE_SWAP.has(preferred) && HIRE_SWAP.has(assigned)) return 'WS2';
  if (WORKSHOP_SWAP.has(preferred) || WORKSHOP_SWAP.has(assigned)) return 'WS2';
  if (preferred === COURSES_HUB) return 'WS1';
  if (preferred.includes('/blog-on-photography/')) return 'WS3';
  if (preferred === FREE_COURSE) return 'WS3';
  if (['/photography-mentoring-online-assignments', '/photography-tuition-services'].includes(preferred)) {
    return 'WS3';
  }
  return '';
}

/** Ruling 2 FIGHT terms — keep assigned money page; support links shipped 19 Jul. */
const FIGHT_RULING2 = new Set([
  'online photography lesson',
  'photography classes online',
  'photography lessons online',
  'lightroom editing course'
].map(normKw));

/** Ruling 3b — macro stays on hub; event-collection pointer shipped; awaiting recrawl. */
const RECRAWL_RULING3B = new Set(['macro photography workshops'].map(normKw));

function suggestedAction3({ keyword, preferred, assigned, pagesMap, mutualSwap, otherPage }) {
  if (FIGHT_RULING2.has(normKw(keyword))) {
    return 'FIGHT in progress — support links shipped 19 Jul, awaiting recrawl';
  }
  if (RECRAWL_RULING3B.has(normKw(keyword))) {
    return 'Recrawl watch — event-collection pointer shipped 19 Jul; permanent keyword stays on hub (not event page)';
  }
  const prefType = pageTypeLabel(preferred, pagesMap);
  if (mutualSwap.has(normKw(keyword))) {
    return `Crossed targets with ${otherPage || 'another money page'} — decision needed, see WS2.`;
  }
  if (prefType === 'blog post') {
    return 'Fix shipped/needed: exact-anchor cross-link from blog to money page; awaiting recrawl if shipped.';
  }
  if (preferred === COURSES_HUB && assigned !== COURSES_HUB) {
    return 'Decision needed (accept hub + route, or strengthen specialist) — see WS1.';
  }
  if (preferred === FREE_COURSE || isFunnelMoneyPath(preferred)) {
    return 'Academy interception — cross-links shipped, awaiting recrawl.';
  }
  return "Decision needed: accept Google's page (remap + route) or strengthen the assigned page.";
}

function meaning3(keyword, preferred, assigned, pagesMap) {
  const prefLabel = pageTypeLabel(preferred, pagesMap);
  const assignLabel = pageTypeLabel(assigned, pagesMap);
  return `Searchers for '${keyword}' land on ${preferred} (your ${prefLabel}) instead of ${assigned}, the ${assignLabel} meant to convert them.`;
}

function formatAtStake(searchVolume, gscMetrics) {
  const parts = [];
  if (Number.isFinite(searchVolume) && searchVolume > 0) {
    parts.push(`${searchVolume.toLocaleString()}/mo search volume`);
  }
  const clicks = gscMetrics?.clicks_28d;
  const imps = gscMetrics?.impressions_28d;
  if (Number.isFinite(clicks) || Number.isFinite(imps)) {
    const c = Number.isFinite(clicks) ? clicks : '—';
    const i = Number.isFinite(imps) ? imps : '—';
    parts.push(`${c} clicks / ${i} imps (28d on assigned page)`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function enrichCheck3(finding, ctx) {
  const parsed = parseGooglePrefers(finding.detail);
  if (!parsed) {
    return {
      ...finding,
      meaning: finding.detail || 'Cannibal candidate override — review target assignment.',
      at_stake: '—',
      suggested_action: 'Review cannibal_candidate override and align with LOCKED target or accept Google URL.',
      workstream: 'WS2'
    };
  }
  const { preferred, assigned } = parsed;
  const keyword = String(finding.subject || '');
  const vol = ctx.volumeByKw?.get(normKw(keyword));
  const gsc = ctx.gscByPath?.get(assigned);
  const otherPage = otherSwapPage(preferred, assigned);
  const mutual = ctx.mutualSwap || new Set();
  return {
    ...finding,
    preferred_path: preferred,
    assigned_path: assigned,
    meaning: meaning3(keyword, preferred, assigned, ctx.pagesMap),
    at_stake: formatAtStake(vol, gsc),
    suggested_action: suggestedAction3({
      keyword, preferred, assigned, pagesMap: ctx.pagesMap, mutualSwap: mutual, otherPage
    }),
    workstream: tagWorkstream(keyword, preferred, assigned, mutual)
  };
}

function enrichCheck1(finding, ctx) {
  const keyword = String(finding.subject || '');
  const detail = String(finding.detail || '');
  const vol = ctx.volumeByKw?.get(normKw(keyword));
  let meaning = detail;
  let suggested = 'Review LOCKED target_page and pages_master tier/money_role alignment.';
  if (detail.includes('missing from pages_master')) {
    const tp = detail.match(/target_page (\S+)/)?.[1] || 'the LOCKED URL';
    meaning = `Keyword '${keyword}' points to ${tp} in LOCKED-151, but that URL is not in pages_master.`;
    suggested = 'Add the page to pages_master or remap the LOCKED target to an existing commercial URL.';
  } else if (detail.includes('not commercial-compatible')) {
    meaning = `Keyword '${keyword}' is assigned to a page whose tier/money_role cannot carry commercial intent (${detail.split(' tier=')[1] || detail}).`;
    suggested = 'Reclassify the page tier/money_role or change the LOCKED target to a commercial-compatible page.';
  }
  const tp = detail.match(/target_page (\S+)/)?.[1];
  const gsc = tp ? ctx.gscByPath?.get(pathOnly(tp)) : null;
  return {
    ...finding,
    meaning,
    at_stake: formatAtStake(vol, gsc),
    suggested_action: suggested,
    workstream: 'WS6'
  };
}

function enrichCheck4(finding, ctx) {
  const subject = String(finding.subject || '');
  const detail = String(finding.detail || '');
  let meaning = detail;
  let suggested = 'Fix pages_master tier/money_role or money-metrics input flags so structural rules pass.';
  if (detail.includes('URL in two tiers')) {
    meaning = `${subject} appears under conflicting tiers in pages_master — one URL must not map to multiple tiers.`;
    suggested = 'Deduplicate pages_master rows and keep a single tier/money_role for this path.';
  } else if (detail.includes('utility/none_utility page contributing')) {
    meaning = `${subject} is marked utility but still feeds the money headline input scale.`;
    suggested = 'Remove from money headline input or reclassify if the page should be commercial.';
  } else if (detail.includes('funnel page marked includeInImpactScale')) {
    meaning = `${subject} is a funnel page but is included in impact-scale money metrics.`;
    suggested = 'Clear includeInImpactScale for funnel paths or change money_role if impact should count.';
  }
  const gsc = ctx.gscByPath?.get(pathOnly(subject));
  return {
    ...finding,
    meaning,
    at_stake: formatAtStake(null, gsc),
    suggested_action: suggested,
    workstream: 'WS6'
  };
}

function enrichCheck5(finding, ctx) {
  const detail = String(finding.detail || '');
  const count = detail.match(/count=(\d+)/)?.[1] || finding.subject?.replace(/\D/g, '') || '?';
  const meaning = `${count} pages remain Tier F (unmapped) — they cannot contribute reliably to money metrics until classified.`;
  return {
    ...finding,
    meaning,
    at_stake: '—',
    suggested_action: 'Run Tier F remediation or assign tiers via documented LOCKED rulings; avoid leaving paths unmapped.',
    workstream: 'WS6'
  };
}

function enrichCheck6(finding) {
  const detail = String(finding.detail || '');
  const meaning = detail.includes('missing')
    ? 'Repo copy of config/09-url-target-keywords.csv is missing — overrides export is stale or not checked in.'
    : 'Repo copy of config/09-url-target-keywords.csv is out of sync with the database overrides export.';
  return {
    ...finding,
    meaning,
    at_stake: '—',
    suggested_action: 'Regenerate config/09-url-target-keywords.csv from the DB export script and commit the updated hash.',
    workstream: 'WS6'
  };
}

function enrichCheck2(finding, ctx) {
  const subject = String(finding.subject || '');
  const detail = String(finding.detail || '');
  let keyword = '';
  let meaning = '';
  let suggested = '';
  let ws = 'WS6';

  const cannibal = detail.match(/^CANNIBAL: keyword "([^"]+)" LOCKED target_page=([^ ]+) not this page$/);
  const notLocked = detail.match(/^tracked keyword "([^"]+)" not in LOCKED-151$/);
  if (cannibal) {
    keyword = cannibal[1];
    const lockedTarget = pathOnly(cannibal[2]);
    meaning = `Page ${subject} tracks "${keyword}" but LOCKED assigns that keyword to ${lockedTarget} — two pages compete for the same term.`;
    suggested = lockedTarget.includes('/blog-on-photography/')
      ? 'Remove tracked override or remap LOCKED; if blog owns the term, add cross-link to the money page.'
      : 'Align pages_master target with LOCKED or update LOCKED after a documented ruling.';
    ws = lockedTarget === COURSES_HUB ? 'WS1' : 'WS2';
  } else if (notLocked) {
    keyword = notLocked[1];
    meaning = `Page ${subject} tracks "${keyword}" but that keyword is not in LOCKED-151 — config drift.`;
    suggested = 'Add keyword to LOCKED with a ruled target page, or clear the tracked override on this URL.';
  } else if (detail.includes('no target_keyword')) {
    meaning = `Page ${subject} is marked tracked but has no target keyword — incomplete override row.`;
    suggested = 'Set target_keyword on the override row or change target_class to none_utility.';
  } else {
    meaning = detail;
    suggested = 'Fix pages_master / override row so tracked keywords match LOCKED-151.';
  }

  const vol = keyword ? ctx.volumeByKw?.get(normKw(keyword)) : null;
  const gsc = ctx.gscByPath?.get(pathOnly(subject));
  return {
    ...finding,
    meaning,
    at_stake: formatAtStake(vol, gsc),
    suggested_action: suggested,
    workstream: ws
  };
}

/** @param {object[]} findings @param {object} ctx */
export function enrichFindings(findings, ctx = {}) {
  const mutualSwap = buildSwapIndex(findings);
  const bag = { ...ctx, mutualSwap };
  return (findings || []).map((f) => {
    const check = Number(f.check);
    if (check === 3) return enrichCheck3(f, bag);
    if (check === 2) return enrichCheck2(f, bag);
    if (check === 1) return enrichCheck1(f, bag);
    if (check === 4) return enrichCheck4(f, bag);
    if (check === 5) return enrichCheck5(f, bag);
    if (check === 6) return enrichCheck6(f);
    return f;
  });
}

export {
  parseGooglePrefers, pageTypeLabel, tagWorkstream, formatAtStake,
  COURSES_HUB, FREE_COURSE, HIRE_SWAP, WORKSHOP_SWAP
};
