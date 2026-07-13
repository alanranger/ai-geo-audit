/**
 * Build ordered SERP surface stack from DataForSEO Live Advanced items[].
 * See dfs-serp-field-map.md § serp_surface_stack.
 */

import { extractCitationsFromAiOverviewItem } from '../ai-citation-extract.js';
import {
  extractKnowledgePanel,
  isOurDomain,
  normalizeDomain,
} from './serp-surface-extract.js';

const OUR_BRAND_NAME = /alan\s*ranger/i;
const KP_TYPES = new Set(['knowledge_graph', 'knowledge_panel']);
const PAA_OWNER_LIMIT = 6;

function isOurBrandTitle(title) {
  return OUR_BRAND_NAME.test(String(title || ''));
}

function itemSortKey(item) {
  const ra = item?.rank_absolute;
  return Number.isFinite(Number(ra)) ? Number(ra) : 99999;
}

function sortByPagePosition(items) {
  return [...(items || [])].sort((a, b) => itemSortKey(a) - itemSortKey(b));
}

function organicOurPosition(block, targetRoot) {
  let best = null;
  for (const it of block) {
    if (!isOurDomain(it.domain || it.url, targetRoot)) continue;
    const rg = it.rank_group != null ? Number(it.rank_group) : null;
    if (rg != null && Number.isFinite(rg) && (best == null || rg < best)) best = rg;
  }
  return best;
}

function organicOwners(block, targetRoot) {
  const sorted = [...block].sort((a, b) => {
    const pa = a.rank_group ?? a.rank_absolute ?? 99;
    const pb = b.rank_group ?? b.rank_absolute ?? 99;
    return pa - pb;
  });
  return sorted.slice(0, 3).map((it) => ({
    domain: normalizeDomain(it.domain || it.url),
    position: it.rank_group != null ? Number(it.rank_group) : null,
    ours: isOurDomain(it.domain || it.url, targetRoot),
  })).filter((o) => o.domain);
}

function packOwners(packItems, targetRoot) {
  const sorted = [...packItems].sort((a, b) => {
    const pa = a.rank_group ?? a.rank_absolute ?? 99;
    const pb = b.rank_group ?? b.rank_absolute ?? 99;
    return pa - pb;
  });
  return sorted.slice(0, 3).map((biz) => {
    const name = biz.title || '';
    const domain = biz.domain || biz.url || '';
    const pos = biz.rank_group ?? biz.rank_absolute ?? null;
    return {
      name: name || null,
      position: Number.isFinite(Number(pos)) ? Number(pos) : null,
      ours: isOurBrandTitle(name) || isOurDomain(domain, targetRoot),
    };
  });
}

function packOurPosition(owners) {
  const ours = owners.find((o) => o.ours);
  return ours?.position ?? null;
}

function paaOwnerDomains(paaItem) {
  const domains = [];
  const questions = Array.isArray(paaItem?.items) ? paaItem.items : [];
  for (const q of questions) {
    if (domains.length >= PAA_OWNER_LIMIT) break;
    const expanded = Array.isArray(q.expanded_element)
      ? q.expanded_element
      : q.expanded_element ? [q.expanded_element] : [];
    for (const el of expanded) {
      const d = normalizeDomain(el?.domain || el?.url || el?.source?.domain || el?.source?.url);
      if (d && !domains.includes(d)) domains.push(d);
      if (domains.length >= PAA_OWNER_LIMIT) break;
    }
  }
  return domains;
}

function paaOurs(paaItem, targetRoot) {
  return paaOwnerDomains(paaItem).some((d) => isOurDomain(d, targetRoot));
}

function aioCitedDomains(aiItem) {
  const slot = extractCitationsFromAiOverviewItem(aiItem);
  const domains = [];
  const refs = [
    ...(slot.alan_citations || []),
    ...(slot.sample_citations || []),
  ];
  for (const ref of refs) {
    const d = normalizeDomain(ref?.domain || ref?.url);
    if (d && !domains.includes(d)) domains.push(d);
  }
  if (aiItem?.references) {
    for (const ref of aiItem.references) {
      const d = normalizeDomain(ref?.domain || ref?.url);
      if (d && !domains.includes(d)) domains.push(d);
    }
  }
  return domains;
}

function aioOurs(aiItem, targetRoot) {
  return aioCitedDomains(aiItem).some((d) => isOurDomain(d, targetRoot));
}

function groupVerticalItems(sorted) {
  const groups = [];
  let i = 0;
  while (i < sorted.length) {
    const item = sorted[i];
    if (KP_TYPES.has(item.type)) {
      i += 1;
      continue;
    }
    if (item.type === 'organic') {
      const block = [item];
      i += 1;
      while (i < sorted.length && sorted[i].type === 'organic') {
        block.push(sorted[i]);
        i += 1;
      }
      groups.push({ type: 'organic', items: block, rank_absolute: itemSortKey(block[0]) });
      continue;
    }
    if (item.type === 'local_pack') {
      const block = [item];
      i += 1;
      while (i < sorted.length && sorted[i].type === 'local_pack') {
        block.push(sorted[i]);
        i += 1;
      }
      groups.push({ type: 'local_pack', items: block, rank_absolute: itemSortKey(block[0]) });
      continue;
    }
    groups.push({ type: item.type, items: [item], rank_absolute: itemSortKey(item) });
    i += 1;
  }
  return groups;
}

function buildStackElement(group, slot, targetRoot) {
  const type = group.type;
  const first = group.items[0];
  const base = { slot, type, ours: null, our_position: null, owners: [] };

  if (type === 'organic') {
    const owners = organicOwners(group.items, targetRoot);
    const ourPos = organicOurPosition(group.items, targetRoot);
    return {
      ...base,
      ours: ourPos != null,
      our_position: ourPos,
      owners,
    };
  }
  if (type === 'local_pack') {
    const owners = packOwners(group.items, targetRoot);
    const ourPos = packOurPosition(owners);
    return {
      ...base,
      ours: ourPos != null,
      our_position: ourPos,
      owners,
    };
  }
  if (type === 'featured_snippet') {
    const domain = normalizeDomain(first.domain || first.url);
    const ours = isOurDomain(domain, targetRoot);
    return { ...base, ours, owners: domain ? [domain] : [] };
  }
  if (type === 'people_also_ask') {
    const domains = paaOwnerDomains(first);
    const ours = paaOurs(first, targetRoot);
    return { ...base, ours, owners: domains };
  }
  if (type === 'ai_overview') {
    const domains = aioCitedDomains(first);
    const ours = aioOurs(first, targetRoot);
    return { ...base, ours, owners: domains };
  }
  return base;
}

/**
 * @param {object[]} items DFS result.items
 * @param {string} [targetRoot]
 * @returns {object[]}
 */
export function buildSerpSurfaceStack(items, targetRoot = 'alanranger.com') {
  const sorted = sortByPagePosition(items || []);
  const groups = groupVerticalItems(sorted);
  const stack = [];
  let slot = 1;
  for (const group of groups) {
    stack.push(buildStackElement(group, slot, targetRoot));
    slot += 1;
  }
  const kp = extractKnowledgePanel(items, targetRoot);
  if (kp.kp_present) {
    stack.push({
      slot: null,
      type: 'knowledge_panel',
      ours: kp.kp_ours,
      our_position: null,
      owners: [],
    });
  }
  return stack;
}
