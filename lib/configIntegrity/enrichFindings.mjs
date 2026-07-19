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

function suggestedAction3({ keyword, preferred, assigned, pagesMap, mutualSwap, otherPage }) {
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
    return f;
  });
}

export {
  parseGooglePrefers, pageTypeLabel, tagWorkstream, formatAtStake,
  COURSES_HUB, FREE_COURSE, HIRE_SWAP, WORKSHOP_SWAP
};
