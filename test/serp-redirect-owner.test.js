/**
 * Google redirect links in DataForSEO items (2 Nov 2026 ranking collapse). Fixtures are real items captured from
 * DataForSEO live advanced on 2 Nov ("photography lessons near me", Coventry pin, mobile) with the goto token
 * shortened; the decodable /url?q= case is the documented Google form (no decodable item was seen in the capture).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedirectItem, resolveSerpRedirects, googleOwnerShare, breadcrumbTarget, decodeRedirectTarget } from '../lib/keyword-ranking/serp-redirect-owner.js';
import { assessRankingAcceptance } from '../lib/keyword-ranking/ranking-acceptance-gate.js';

const T = 'alanranger.com';
const ours = { type: 'organic', rank_group: 1, rank_absolute: 6, url: 'https://google.com/goto?url=CAESswEB6zswFdSGiU9fV20ZDFJ0vLV5', domain: 'google.com',
  breadcrumb: 'https://www.alanranger.com', website_name: 'Alan Ranger Photography', title: 'Photography Courses Coventry — Beginners, 1-2-1, RPS' };
const rival = { type: 'organic', rank_group: 2, rank_absolute: 7, url: 'https://google.com/goto?url=CAESiwEB6zswFQiBb7r9', domain: 'google.com',
  breadcrumb: 'https://www.intotheblue.co.uk', website_name: 'Into The Blue | Experience Days', title: 'Beginners Photography Course Coventry' };
const social = { type: 'organic', rank_group: 10, rank_absolute: 17, url: 'https://google.com/goto?url=CAESggEB6zswFXes', domain: 'google.com',
  breadcrumb: '10+ comments', website_name: 'Facebook\u00a0·\u00a0Sitting Rooms of Culture', title: 'What digital photography courses are available in Coventry…' };
const normal = { type: 'organic', rank_group: 13, rank_absolute: 20, url: 'https://www.craftcourses.com/categories/photography?location=Coventry', domain: 'www.craftcourses.com',
  breadcrumb: 'https://www.craftcourses.com', website_name: 'Craft Courses', title: 'Photography courses…' };

test('a goto link with our breadcrumb resolves to alanranger.com (ours again)', () => {
  const r = resolveRedirectItem(ours, T);
  assert.equal(r.domain, 'www.alanranger.com');
  assert.equal(r.url, 'https://www.alanranger.com/');
  assert.equal(r.redirect_resolved, 'breadcrumb');
  assert.equal(r.rank_group, 1);
});

test('a decodable /url?q= target wins over the breadcrumb', () => {
  const item = { ...ours, url: 'https://www.google.com/url?q=https://www.alanranger.com/photography-courses-coventry&sa=U', domain: 'google.com' };
  const r = resolveRedirectItem(item, T);
  assert.equal(r.url, 'https://www.alanranger.com/photography-courses-coventry');
  assert.equal(r.redirect_resolved, 'decoded');
  assert.equal(decodeRedirectTarget(ours.url), null, "Google's opaque goto token is not decodable");
});

test('competitors resolve too (no "google.com" competitor), platforms by name, normal items untouched', () => {
  assert.equal(resolveRedirectItem(rival, T).domain, 'www.intotheblue.co.uk');
  assert.equal(resolveRedirectItem(social, T).domain, 'facebook.com');
  assert.equal(resolveRedirectItem(normal, T), normal);
  assert.deepEqual(breadcrumbTarget('https://www.alanranger.com › beginners-photography-lessons › 2026'), { host: 'www.alanranger.com', url: 'https://www.alanranger.com/beginners-photography-lessons/2026' });
  assert.deepEqual(breadcrumbTarget('https://www.timeout.com › london › pho...'), { host: 'www.timeout.com', url: 'https://www.timeout.com/london' });
});

test('website_name is the last resort for our site; nested owners (local pack, AIO references) are resolved', () => {
  const noBc = { ...ours, breadcrumb: '' };
  assert.equal(resolveRedirectItem(noBc, T).domain, T);
  const tree = [{ type: 'local_pack', items: [{ ...ours }] }, { type: 'ai_overview', references: [{ ...rival }] }];
  const out = resolveSerpRedirects(tree, T);
  assert.equal(out[0].items[0].domain, 'www.alanranger.com');
  assert.equal(out[1].references[0].domain, 'www.intotheblue.co.uk');
});

test('guard: more than 10% of owner slots on google.com marks the ranking run incomplete', () => {
  const row = (domains) => ({ keyword: 'k', serp_surface_stack: [{ type: 'organic', owners: domains.map((d, i) => ({ domain: d, position: i + 1, ours: false })) }] });
  assert.equal(googleOwnerShare([row(['google.com', 'google.com', 'a.com', 'b.com'])]).share, 0.5);
  const bad = assessRankingAcceptance([row(['google.com', 'google.com', 'a.com', 'b.com'])]);
  assert.equal(bad.checks.find((c) => c.id === 'owner_domain_google').ok, false);
  assert.equal(bad.ranking_quality, 'incomplete');
  const ok = assessRankingAcceptance([row(Array.from({ length: 20 }, (_, i) => (i === 0 ? 'google.com' : `s${i}.com`)))]);
  assert.equal(ok.checks.find((c) => c.id === 'owner_domain_google').ok, true, '1 of 20 (5%) passes');
});
