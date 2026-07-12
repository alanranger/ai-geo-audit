/**
 * Unit smoke tests for SERP surface extractors (no DFS network).
 */
import {
  extractLocalPackPosition,
  extractKnowledgePanel,
  extractFeaturedSnippetOurs,
  extractPaaOurs,
  extractSerpSurfaces,
} from '../lib/keyword-ranking/serp-surface-extract.js';
import { resolveKeywordClass } from '../lib/keyword-ranking/tracking-class.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const packItems = [
  {
    type: 'local_pack',
    items: [
      { title: 'Other Studio', domain: 'other.com', rank_group: 1 },
      { title: 'Alan Ranger Photography', domain: 'alanranger.com', rank_group: 2 },
    ],
  },
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

const surfaces = extractSerpSurfaces([...packItems, { type: 'knowledge_graph', title: 'Alan Ranger' }]);
assert(surfaces.local_pack_position === 2, 'bundle pack');
assert(surfaces.kp_ours === true, 'bundle kp');

const brand = resolveKeywordClass('alan ranger');
assert(brand.keyword_class === 'brand' && !brand.class_unmapped, 'brand class');
const unmapped = resolveKeywordClass('totally unknown keyword zz');
assert(unmapped.keyword_class === 'national-money' && unmapped.class_unmapped, 'unmapped class');

console.log('surface-extract + class smoke tests OK');
