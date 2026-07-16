/**
 * Extract SERP surface ownership / pack position from DataForSEO
 * Google Organic Live Advanced `result.items[]`.
 *
 * Field paths documented in dfs-serp-field-map.md (Phase 0 probes).
 * Pure helpers — keep cyclomatic complexity low.
 */

import { getBusinessCid } from './business-location.js';

const OUR_BRAND_NAME = /alan\s*ranger/i;
const OUR_DOMAIN_ROOT = 'alanranger.com';

/** Pack row ownership: CID first (DFS returns cid, not place_id), then name/domain. */
export function isOurPackListing(biz, targetRoot = OUR_DOMAIN_ROOT) {
  const ourCid = getBusinessCid();
  const cid = biz?.cid != null ? String(biz.cid) : '';
  if (ourCid && cid && cid === ourCid) return true;
  const title = biz?.title || '';
  const domain = biz?.domain || biz?.url || '';
  return isOurBrandTitle(title) || isOurDomain(domain, targetRoot);
}

export function normalizeDomain(value) {
  if (!value) return null;
  try {
    if (String(value).includes('://')) {
      return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    }
  } catch {
    /* ignore */
  }
  return String(value)
    .replace(/^www\./, '')
    .toLowerCase();
}

export function isOurDomain(domainOrUrl, targetRoot = OUR_DOMAIN_ROOT) {
  const d = normalizeDomain(domainOrUrl);
  if (!d) return false;
  const root = String(targetRoot || OUR_DOMAIN_ROOT)
    .replace(/^www\./, '')
    .toLowerCase();
  return d === root || d.endsWith('.' + root);
}

function isOurBrandTitle(title) {
  return OUR_BRAND_NAME.test(String(title || ''));
}

/** Local pack: Alan's position (1..) or null if pack absent / Alan not listed. */
export function extractLocalPackPosition(items, targetRoot = OUR_DOMAIN_ROOT) {
  const packEntries = (items || []).filter((it) => it && it.type === 'local_pack');
  if (!packEntries.length) {
    return { local_pack_present: false, local_pack_position: null };
  }

  for (const biz of packEntries) {
    if (!isOurPackListing(biz, targetRoot)) continue;
    const pos =
      biz.rank_group != null
        ? Number(biz.rank_group)
        : biz.rank_absolute != null
          ? Number(biz.rank_absolute)
          : null;
    return {
      local_pack_present: true,
      local_pack_position: Number.isFinite(pos) ? pos : null,
    };
  }
  return { local_pack_present: true, local_pack_position: null };
}

/** Knowledge graph / panel presence + ownership. */
export function extractKnowledgePanel(items, targetRoot = OUR_DOMAIN_ROOT) {
  const kg = (items || []).find(
    (it) => it && (it.type === 'knowledge_graph' || it.type === 'knowledge_panel')
  );
  if (!kg) return { kp_present: false, kp_ours: false };

  const title = kg.title || kg.subtitle || '';
  const website = kg.website || kg.url || kg.domain || '';
  const ours = isOurBrandTitle(title) || isOurDomain(website, targetRoot);
  return { kp_present: true, kp_ours: ours };
}

/** Featured snippet ownership. */
export function extractFeaturedSnippetOurs(items, targetRoot = OUR_DOMAIN_ROOT) {
  const fs = (items || []).find((it) => it && it.type === 'featured_snippet');
  if (!fs) {
    return { featured_snippet_present: false, featured_snippet_ours: false, featured_snippet_domain: null };
  }
  const domain = fs.domain || fs.url || null;
  const ours = isOurDomain(domain, targetRoot);
  return {
    featured_snippet_present: true,
    featured_snippet_ours: ours,
    featured_snippet_domain: normalizeDomain(domain),
  };
}

/** PAA: true if any expanded answer cites our domain. */
export function extractPaaOurs(items, targetRoot = OUR_DOMAIN_ROOT) {
  const paa = (items || []).find((it) => it && it.type === 'people_also_ask');
  if (!paa) return { paa_present: false, paa_ours: false };

  const questions = Array.isArray(paa.items) ? paa.items : [];
  for (const q of questions) {
    const expanded = Array.isArray(q.expanded_element)
      ? q.expanded_element
      : q.expanded_element
        ? [q.expanded_element]
        : [];
    for (const el of expanded) {
      const domain = el?.domain || el?.url || el?.source?.domain || el?.source?.url;
      if (isOurDomain(domain, targetRoot)) {
        return { paa_present: true, paa_ours: true };
      }
    }
  }
  return { paa_present: true, paa_ours: false };
}

/**
 * Bundle all surface fields for one SERP result.
 * @returns {object}
 */
export function extractSerpSurfaces(items, targetRoot = OUR_DOMAIN_ROOT) {
  const pack = extractLocalPackPosition(items, targetRoot);
  const kp = extractKnowledgePanel(items, targetRoot);
  const fs = extractFeaturedSnippetOurs(items, targetRoot);
  const paa = extractPaaOurs(items, targetRoot);
  return {
    local_pack_position: pack.local_pack_position,
    kp_present: kp.kp_present,
    kp_ours: kp.kp_ours,
    featured_snippet_ours: fs.featured_snippet_ours,
    paa_ours: paa.paa_ours,
    serp_features_extra: {
      featured_snippet_domain: fs.featured_snippet_domain,
      featured_snippet_ours: fs.featured_snippet_ours,
      paa_ours: paa.paa_ours,
      kp_present: kp.kp_present,
      kp_ours: kp.kp_ours,
      local_pack_position: pack.local_pack_position,
    },
  };
}
