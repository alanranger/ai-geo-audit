/**
 * "Is this us?" on real 9 Nov 2026 DataForSEO responses, where every organic and local-pack result is a
 * google.com/goto redirect (domain "google.com") and some AI-overview references are too.
 * Fixtures: stored task results from the 9 Nov overnight scan (see each file's _provenance).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSerpResult } from '../lib/keyword-ranking/parse-serp-result.js';
import { extractCitationsFromAiOverviewItem } from '../lib/ai-citation-extract.js';
import { getBusinessCid } from '../lib/keyword-ranking/business-location.js';

const ROOT = 'alanranger.com';
const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/dfs-serp-goto-20261109-${name}.json`, import.meta.url), 'utf8'));
const coventry = load('photography-classes-coventry');
const evening = load('photography-evening-classes');
const isGoto = (it) => /^https:\/\/google\.com\/goto\?/.test(String(it.url || '')) && it.domain === 'google.com';

test('fixtures are the goto format: no organic or local-pack result carries our real domain', () => {
  for (const f of [coventry, evening]) {
    const organic = f.result.items.filter((i) => i.type === 'organic');
    assert.ok(organic.length >= 40);
    assert.ok(organic.every(isGoto), 'every organic url is google.com/goto');
    assert.equal(f.result.items.filter((i) => i.type !== 'ai_overview' && /alanranger\.com/.test(String(i.domain || ''))).length, 0);
  }
  const ourPack = coventry.result.items.find((i) => i.type === 'local_pack' && String(i.cid) === getBusinessCid());
  assert.ok(ourPack && isGoto(ourPack), 'our local-pack entry is a goto link with only title/cid to identify it');
});

test('organic: found at #1 via breadcrumb, never via the google.com domain', () => {
  for (const f of [coventry, evening]) {
    const p = parseSerpResult(f.result, ROOT);
    assert.equal(p.best_rank_group, 1, f.result.keyword);
    assert.match(p.best_url, /^https:\/\/www\.alanranger\.com\//);
    const ours = p.items.filter((i) => i.type === 'organic' && /alanranger\.com$/.test(i.domain));
    assert.ok(ours.every((i) => i.redirect_resolved === 'breadcrumb' || i.redirect_resolved === 'website_name'));
  }
});

test('local pack: found at #1 by our cid (config), and by title when url/domain are absent', () => {
  assert.equal(parseSerpResult(coventry.result, ROOT).surfaces.local_pack_position, 1);
  const bare = coventry.result.items.map((i) => {
    if (i.type !== 'local_pack') return i;
    const { url, domain, ...rest } = i;
    return rest;
  });
  assert.equal(parseSerpResult({ ...coventry.result, items: bare }, ROOT).surfaces.local_pack_position, 1);
  const noCid = bare.map((i) => (i.type === 'local_pack' ? { ...i, cid: null } : i));
  assert.equal(parseSerpResult({ ...coventry.result, items: noCid }, ROOT).surfaces.local_pack_position, 1, 'title "Alan Ranger Photography" fallback');
});

test('AI overview: our citation found directly and through a goto link resolved by `source`', () => {
  const direct = parseSerpResult(coventry.result, ROOT).ai_overview_citations;
  assert.ok(direct.alan_citations_count >= 1);
  const viaGoto = parseSerpResult(evening.result, ROOT);
  assert.ok(viaGoto.ai_overview_citations.alan_citations_count >= 1);
  assert.ok(viaGoto.ai_overview_citations.alan_citations.every((c) => /alanranger\.com$/.test(c.domain)));
  assert.equal(viaGoto.serp_surface_stack.find((e) => e.type === 'ai_overview')?.ours, true);
  const raw = evening.result.items.find((i) => i.type === 'ai_overview');
  assert.equal(extractCitationsFromAiOverviewItem(raw, ROOT).alan_citations_count, 0, 'unresolved, the goto reference is not countable');
});

test('never ours: google.com references (GBP searchviewer) and review pages quoting our URL', () => {
  const aio = {
    references: [
      { source: 'Google', domain: 'www.google.com', url: 'https://www.google.com/searchviewer/10?svid=x', title: 'Alan Ranger Photography' },
      { source: 'Trustpilot', domain: null, url: 'https://uk.trustpilot.com/review/www.alanranger.com?page=6', title: 'Alan Ranger Photography Reviews' },
    ],
  };
  const r = parseSerpResult({ items: [{ type: 'ai_overview', ...aio }] }, ROOT).ai_overview_citations;
  assert.equal(r.total_citations, 2);
  assert.equal(r.alan_citations_count, 0);
});
