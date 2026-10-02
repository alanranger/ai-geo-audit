/**
 * Live integration: extractability + check-url-status + evaluatePageBrokenLinks
 * against known Ahrefs-style broken internal destinations still present on site.
 *
 * Run: node --test test/traditional-seo-broken-links.live.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePageBrokenLinks } from '../lib/traditional-seo-broken-links.js';

const API = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';

const EXPECT_FAIL = [
  {
    url: 'https://www.alanranger.com/blog-on-photography/tripods-gitzo-vs-benro-review',
    mustIncludeBroken: [/\/blog-page$/]
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/delete-duplicate-photos-in-lightroom',
    mustIncludeBroken: [/\/blog-page$/]
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/how-to-become-a-better-photographer',
    mustIncludeBroken: [/\/blog-page$/]
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/photo-print-sizes-resize-photos',
    mustIncludeBroken: [/\/blog-page$/, /photo-print-preparation-service-30min/]
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/what-is-framing-in-photography',
    mustIncludeBroken: [/composition-settings-photography-field-checklists/]
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/photography-composition-framework',
    mustIncludeBroken: [/composition-settings-photography-field-checklists/]
  },
  {
    url: 'https://www.alanranger.com/photo-editing-course-coventry',
    mustIncludeBroken: [/\/about-reviews$/]
  },
  {
    url: 'https://www.alanranger.com/jaguar-land-rover-els',
    mustIncludeBroken: [/somerset-landscape-photography-workshops/]
  }
];

const EXPECT_PASS = [
  'https://www.alanranger.com/blog-on-photography/5-stages-to-improve-your-photography',
  'https://www.alanranger.com/beginners-photography-classes'
];

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || String(json?.status || '').toLowerCase() !== 'ok') {
    throw new Error(`${path} failed: HTTP ${res.status} ${json?.message || ''}`.trim());
  }
  return json;
}

async function buildStatusMap(targets) {
  const map = new Map();
  const uniq = [...new Set(targets.map((t) => String(t || '').trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 20) {
    const chunk = uniq.slice(i, i + 20);
    const payload = await postJson('/api/aigeo/check-url-status', { urls: chunk });
    (payload.results || []).forEach((row) => {
      const url = String(row?.url || '').trim();
      if (!url) return;
      map.set(url, { kind: String(row?.kind || 'unknown'), statusCode: row?.statusCode ?? null, url });
      try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./i, '');
        const path = u.pathname.replace(/\/+$/, '') || '/';
        map.set(`${u.protocol}//${host}${path}`, map.get(url));
        map.set(`${u.protocol}//www.${host}${path}`, map.get(url));
      } catch {
        /* ignore */
      }
    });
  }
  return map;
}

function resolveFromMap(map) {
  return (url) => {
    if (map.has(url)) return map.get(url);
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./i, '');
      const path = u.pathname.replace(/\/+$/, '') || '/';
      const key = `${u.protocol}//${host}${path}`;
      if (map.has(key)) return map.get(key);
      const www = `${u.protocol}//www.${host}${path}`;
      if (map.has(www)) return map.get(www);
    } catch {
      /* ignore */
    }
    return { kind: 'unknown' };
  };
}

test('live: Ahrefs-style broken destinations still fail for 8 source pages', async () => {
  const urls = EXPECT_FAIL.map((x) => x.url).concat(EXPECT_PASS);
  const extract = await postJson('/api/aigeo/content-extractability', {
    mode: 'full',
    tier: 'all',
    urls
  });
  const rows = Array.isArray(extract?.data?.rows) ? extract.data.rows : [];
  assert.ok(rows.length >= urls.length - 1, `expected extract rows, got ${rows.length}`);

  const byUrl = new Map(rows.map((r) => [String(r.url || '').trim(), r]));
  const allTargets = [];
  rows.forEach((r) => {
    (Array.isArray(r.seoInternalLinkTargets) ? r.seoInternalLinkTargets : []).forEach((t) => allTargets.push(t));
  });
  const statusMap = await buildStatusMap(allTargets);
  const resolve = resolveFromMap(statusMap);

  const failResults = [];
  for (const spec of EXPECT_FAIL) {
    const row = byUrl.get(spec.url);
    assert.ok(row, `missing extract row for ${spec.url}`);
    const targets = Array.isArray(row.seoInternalLinkTargets) ? row.seoInternalLinkTargets : [];
    const evaluated = evaluatePageBrokenLinks(targets, resolve);
    assert.equal(evaluated.status, 'fail', `${spec.url} expected fail, got ${evaluated.status}: ${evaluated.note}`);
    for (const re of spec.mustIncludeBroken) {
      assert.ok(
        evaluated.brokenUrls.some((u) => re.test(u)),
        `${spec.url} missing broken match ${re}: ${evaluated.brokenUrls.join(', ')}`
      );
    }
    failResults.push(spec.url);
  }

  for (const url of EXPECT_PASS) {
    const row = byUrl.get(url);
    assert.ok(row, `missing extract row for ${url}`);
    const targets = Array.isArray(row.seoInternalLinkTargets) ? row.seoInternalLinkTargets : [];
    const evaluated = evaluatePageBrokenLinks(targets, resolve);
    assert.notEqual(evaluated.status, 'fail', `${url} should not fail: ${evaluated.note}`);
    assert.ok(
      evaluated.status === 'pass' || evaluated.status === 'warn',
      `${url} unexpected status ${evaluated.status}`
    );
  }

  assert.equal(failResults.length, 8);
});

test('live: Ahrefs broken destinations return HTTP 404 from check-url-status', async () => {
  const destinations = [
    'https://www.alanranger.com/about-reviews',
    'https://www.alanranger.com/blog-page',
    'https://www.alanranger.com/photo-workshops-uk/somerset-landscape-photography-workshops',
    'https://www.alanranger.com/photography-services-near-me/composition-settings-photography-field-checklists',
    'https://www.alanranger.com/photography-services-near-me/photo-print-preparation-service-30min'
  ];
  const payload = await postJson('/api/aigeo/check-url-status', { urls: destinations });
  const byUrl = new Map((payload.results || []).map((r) => [r.url, r]));
  destinations.forEach((url) => {
    const row = byUrl.get(url);
    assert.ok(row, `missing result for ${url}`);
    assert.equal(row.kind, 'broken', `${url} kind=${row.kind} code=${row.statusCode}`);
    assert.equal(Number(row.statusCode), 404);
  });
});
