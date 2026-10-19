/**
 * Unit smoke tests for SERP surface extractors (no DFS network).
 */
import {
  extractLocalPackPosition,
  extractKnowledgePanel,
  extractFeaturedSnippetOurs,
  extractPaaOurs,
  extractSerpSurfaces,
  domainsFromPaaExpandedElement,
  collectPaaOwnerDomains,
} from '../lib/keyword-ranking/serp-surface-extract.js';
import { resolveKeywordClass } from '../lib/keyword-ranking/tracking-class.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const packItems = [
  { type: 'local_pack', title: 'Other Studio', domain: 'other.com', rank_group: 1 },
  { type: 'local_pack', title: 'Alan Ranger Photography', domain: null, rank_group: 2 },
];
const pack = extractLocalPackPosition(packItems);
assert(pack.local_pack_present === true, 'pack present');
assert(pack.local_pack_position === 2, 'pack pos 2');

const kp = extractKnowledgePanel([
  { type: 'knowledge_graph', title: 'Alan Ranger Photography', website: 'https://www.alanranger.com' },
]);
assert(kp.kp_present && kp.kp_ours, 'kp ours');

const fs = extractFeaturedSnippetOurs([
  { type: 'featured_snippet', domain: 'alanranger.com', url: 'https://www.alanranger.com/x' },
]);
assert(fs.featured_snippet_ours, 'fs ours');

const paa = extractPaaOurs([
  {
    type: 'people_also_ask',
    items: [
      {
        expanded_element: { domain: 'wikipedia.org' },
      },
      {
        expanded_element: [{ url: 'https://www.alanranger.com/blog/foo' }],
      },
    ],
  },
]);
assert(paa.paa_ours, 'paa ours');

// Fix 3: AIO-in-PAA ownership via items[].references[] (when DFS hydrates them)
const aioInPaaEl = {
  type: 'ai_overview',
  references: null,
  items: [
    {
      type: 'ai_overview_element',
      references: [
        { domain: 'other.com', url: 'https://other.com/a' },
        { domain: 'www.alanranger.com', url: 'https://www.alanranger.com/courses' },
      ],
    },
  ],
};
const aioDomains = domainsFromPaaExpandedElement(aioInPaaEl);
assert(aioDomains.includes('alanranger.com'), 'aio-in-paa refs');
const paaAioOurs = extractPaaOurs([
  {
    type: 'people_also_ask',
    items: [{ expanded_element: aioInPaaEl }],
  },
]);
assert(paaAioOurs.paa_ours === true, 'paa ours via aio-in-paa refs');
const emptyAsync = domainsFromPaaExpandedElement({
  type: 'asynchronous_ai_overview',
  references: null,
  items: null,
});
assert(emptyAsync.length === 0, 'async stub yields no owners');
assert(collectPaaOwnerDomains({ items: [{ expanded_element: aioInPaaEl }] }).length >= 2, 'collect owners');

const surfaces = extractSerpSurfaces([...packItems, { type: 'knowledge_graph', title: 'Alan Ranger' }]);
assert(surfaces.local_pack_present === true, 'bundle pack present');
assert(surfaces.local_pack_position === 2, 'bundle pack');
assert(surfaces.serp_features_extra?.local_pack === true, 'serp_features local_pack');
assert(surfaces.kp_ours === true, 'bundle kp');

const brand = resolveKeywordClass('alan ranger');
assert(brand.keyword_class === 'brand' && !brand.class_unmapped, 'brand class');
const unmapped = resolveKeywordClass('totally unknown keyword zz');
assert(unmapped.keyword_class === 'national-money' && unmapped.class_unmapped, 'unmapped class');

console.log('surface-extract + class smoke tests OK');
