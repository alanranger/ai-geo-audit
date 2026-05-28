// Analysis-only: event-page backlink value check. NOT for commit.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const PROPERTY = 'https://www.alanranger.com';
const GSC_FROM = '2025-01-13';
const GSC_TO = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const OUT = path.join('logs', 'event-backlink-value-check.out.txt');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function log(...a) { const s = a.join(' '); console.log(s); lines.push(s); }
const lines = [];

async function getEventUrls() {
  const { data, error } = await supabase.rpc('exec_sql', {
    query: `SELECT DISTINCT ON (event_slug)
      normalize_gsc_page_slug(url_to) AS event_slug,
      url_to AS canonical_url_to
    FROM dfs_domain_backlink_rows
    WHERE url_from ILIKE '%wherecanwego%'
      AND dofollow = true
      AND (
        normalize_gsc_page_slug(url_to) LIKE 'photographic-workshops-near-me/%'
        OR normalize_gsc_page_slug(url_to) LIKE 'beginners-photography-lessons/%'
      )
    ORDER BY event_slug, last_seen DESC`
  });
  if (error) throw error;
  return data;
}

// fallback direct query via REST not available - use known SQL through MCP output
// Query via supabase from dfs table with filter - postgrest can't do normalize easily
async function getWcwDofollowRows() {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('dfs_domain_backlink_rows')
      .select('url_to,url_from,dofollow,first_seen,last_seen')
      .ilike('url_from', '%wherecanwego%')
      .eq('dofollow', true)
      .range(from, from + 999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

function targetType(slug) {
  if (slug.startsWith('photographic-workshops-near-me/') || slug.startsWith('beginners-photography-lessons/')) return 'event';
  if (slug.startsWith('photo-workshops-uk/')) return 'product';
  return 'other';
}

async function getTargetUrlsDirect(type) {
  const map = new Map();
  for (const r of await getWcwDofollowRows()) {
    const slug = normalizeSlug(r.url_to);
    if (targetType(slug) !== type) continue;
    if (!map.has(slug)) map.set(slug, `https://www.alanranger.com/${slug}`);
  }
  return [...map.entries()].map(([slug, url]) => ({ slug, url }));
}

async function getEventUrlsDirect() {
  return (await getTargetUrlsDirect('event')).map(({ slug, url }) => ({ event_slug: slug, url }));
}

async function getProductUrlsDirect() {
  return getTargetUrlsDirect('product');
}

function normalizeSlug(url) {
  let s = (url || '').toLowerCase().trim();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const slash = s.indexOf('/');
  s = slash >= 0 ? s.slice(slash + 1) : s;
  s = s.split('#')[0].split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

async function checkUrl(url) {
  try {
    let r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'AI-GEO-Audit-Analysis/1.0' } });
    let status = r.status;
    let redirectTarget = '';
    if ([301, 302, 307, 308].includes(status)) {
      redirectTarget = r.headers.get('location') || '';
      if (redirectTarget.startsWith('/')) redirectTarget = 'https://www.alanranger.com' + redirectTarget;
    }
    let html = '';
    let noindex = null;
    if (status === 200) {
      html = await r.text();
      noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
        || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(html);
    } else if (redirectTarget && [301, 302, 307, 308].includes(status)) {
      const r2 = await fetch(redirectTarget, { redirect: 'follow', headers: { 'User-Agent': 'AI-GEO-Audit-Analysis/1.0' } });
      if (r2.status === 200) {
        html = await r2.text();
        noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
          || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots["']/i.test(html);
      }
    }
    return { status, redirectTarget, noindex, html };
  } catch (e) {
    return { status: 'ERR', redirectTarget: '', noindex: null, html: '', error: e.message };
  }
}

function extractInternalLinks(html, baseUrl) {
  const links = new Set();
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (!abs.hostname.replace(/^www\./, '').includes('alanranger.com')) continue;
      const slug = normalizeSlug(abs.href);
      if (slug.startsWith('photo-workshops-uk/')
        || slug === 'photography-workshops'
        || slug === 'landscape-photography-workshops'
        || slug === 'one-day-landscape-photography-workshops'
        || slug === 'photography-workshops-near-me'
        || slug.startsWith('photography-workshops-near-me/')
        || slug.startsWith('photographic-workshops-near-me/')) {
        links.add('/' + slug);
      }
    } catch { /* skip */ }
  }
  return [...links].sort();
}

async function getToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).access_token;
}

async function gscQueries(token, pageUrl) {
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: GSC_FROM,
        endDate: GSC_TO,
        dimensions: ['query'],
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }],
        rowLimit: 25000,
        dataState: 'final'
      })
    }
  );
  if (!r.ok) throw new Error(await r.text());
  const j = await r.json();
  const rows = (j.rows || []).map((x) => ({
    query: x.keys[0], impressions: x.impressions, clicks: x.clicks,
    position: +x.position.toFixed(2)
  }));
  const under20 = rows.filter((x) => x.position < 20);
  return { totalRows: rows.length, under20, bestPosition: rows.length ? Math.min(...rows.map((x) => x.position)) : null };
}

async function getGscAgg(slugs) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('gsc_page_timeseries')
      .select('page_url,date,impressions,clicks,position')
      .eq('property_url', PROPERTY)
      .gte('date', GSC_FROM)
      .in('page_url', slugs)
      .range(from, from + 9999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 10000) break;
    from += 10000;
  }
  const agg = new Map();
  for (const r of all) {
    const a = agg.get(r.page_url) || { imp: 0, clicks: 0, posImp: 0, minPos: null };
    a.imp += r.impressions || 0;
    a.clicks += r.clicks || 0;
    if (r.impressions > 0) {
      a.posImp += (r.position || 0) * r.impressions;
      if (a.minPos == null || r.position < a.minPos) a.minPos = r.position;
    }
    agg.set(r.page_url, a);
  }
  return agg;
}

async function getBacklinkAgg(type) {
  return (await getWcwDofollowRows()).filter((r) => targetType(normalizeSlug(r.url_to)) === type);
}

async function getEventProductPairs() {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('v_event_product_links_workshops')
      .select('event_url,product_url,method')
      .range(from, from + 9999);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < 10000) break;
    from += 10000;
  }
  const map = new Map();
  for (const r of all) {
    const eventSlug = normalizeSlug(r.event_url);
    if (!map.has(eventSlug)) map.set(eventSlug, { product_slug: normalizeSlug(r.product_url), method: r.method });
  }
  return map;
}

function workshopLabel(productSlug, eventSlug) {
  if (productSlug) return productSlug.replace(/^photo-workshops-uk\//, '');
  return eventSlug.replace(/^(photographic-workshops-near-me|beginners-photography-lessons)\//, '');
}

function backlinkAssetSummary(bl, statusBySlug) {
  const slugs = [...new Set(bl.map((r) => normalizeSlug(r.url_to)))];
  let live200 = 0, dead404 = 0, redirect301 = 0, other = 0;
  for (const slug of slugs) {
    const st = statusBySlug.get(slug);
    if (st === 200) live200++;
    else if (st === 404) dead404++;
    else if ([301, 302, 307, 308].includes(st)) redirect301++;
    else other++;
  }
  const firstSeen = bl.map((r) => r.first_seen).filter(Boolean).sort()[0];
  const lastSeen = bl.map((r) => r.last_seen).filter(Boolean).sort().slice(-1)[0];
  return {
    rows: bl.length,
    sources: new Set(bl.map((r) => r.url_from)).size,
    targets: slugs.length,
    firstSeen,
    lastSeen,
    live200,
    dead404,
    redirect301,
    other,
    rows200: bl.filter((r) => statusBySlug.get(normalizeSlug(r.url_to)) === 200).length,
    rows404: bl.filter((r) => statusBySlug.get(normalizeSlug(r.url_to)) === 404).length,
    rows3xx: bl.filter((r) => [301, 302, 307, 308].includes(statusBySlug.get(normalizeSlug(r.url_to)))).length
  };
}

const events = await getEventUrlsDirect();
const products = await getProductUrlsDirect();
log('EVENT URL COUNT:', events.length);
log('PRODUCT URL COUNT:', products.length);
log('Fetch timestamp:', new Date().toISOString());

log('\n=== DELIVERABLE 1 — Live status (event targets) ===');
log('target_type\ttarget_url\thttp_status\tredirect_target\tnoindex_present');
const d1 = [];
for (const e of events) {
  const c = await checkUrl(e.url);
  const noindexStr = c.noindex === null ? '' : (c.noindex ? 'yes' : 'no');
  d1.push({ ...e, ...c, noindexStr });
  log(['event', e.url, c.status, c.redirectTarget || '', noindexStr].join('\t'));
  await new Promise((r) => setTimeout(r, 120));
}

log('\n=== DELIVERABLE 1 — Live status (product targets) ===');
const d1Products = [];
for (const p of products) {
  const c = await checkUrl(p.url);
  const noindexStr = c.noindex === null ? '' : (c.noindex ? 'yes' : 'no');
  d1Products.push({ ...p, ...c, noindexStr });
  log(['product', p.url, c.status, c.redirectTarget || '', noindexStr].join('\t'));
  await new Promise((r) => setTimeout(r, 120));
}

const gscAgg = await getGscAgg(events.map((e) => e.event_slug));
const token = await getToken();

log('\n=== DELIVERABLE 2 — GSC organic strength ===');
log('event_url\ttotal_impressions\ttotal_clicks\tavg_position_imp_weighted\tbest_daily_position\tquery_rows\tqueries_position_lt_20\texample_queries_lt_20');
for (const e of events) {
  const a = gscAgg.get(e.event_slug) || { imp: 0, clicks: 0, posImp: 0, minPos: null };
  const avg = a.imp > 0 ? +(a.posImp / a.imp).toFixed(2) : '';
  let qinfo = { totalRows: 0, under20: [], bestPosition: null };
  try {
    qinfo = await gscQueries(token, e.url);
  } catch (err) {
    qinfo.error = err.message;
  }
  const examples = (qinfo.under20 || []).slice(0, 3).map((x) => `${x.query} (pos ${x.position})`).join('; ');
  log([
    e.url, a.imp, a.clicks, avg, a.minPos ?? '', qinfo.totalRows ?? 0,
    (qinfo.under20 || []).length,
    examples
  ].join('\t'));
  await new Promise((r) => setTimeout(r, 100));
}

const sampleSlugs = [
  'photographic-workshops-near-me/hartland-quay-photography-devon-seascapes',
  'photographic-workshops-near-me/landscape-photography-snowdonia-workshop',
  'photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21',
  'photographic-workshops-near-me/peak-district-photography-workshops-autumn',
  'photographic-workshops-near-me/northumberland-photography-workshops-coast',
  'beginners-photography-lessons/lightroom-photo-editing-classes-wk2',
  'beginners-photography-lessons/camera-courses-for-beginners-coventry-7zghm',
  'beginners-photography-lessons/rps-courses-rps-distinctions-mentoring-2',
  'photographic-workshops-near-me/garden-photography-workshop-mxyms',
  'photographic-workshops-near-me/secrets-of-woodland-photography-masterclass-spring'
];

log('\n=== DELIVERABLE 3 — Internal links (sample 10) ===');
for (const slug of sampleSlugs) {
  const url = 'https://www.alanranger.com/' + slug;
  const row = d1.find((x) => x.event_slug === slug);
  let links = [];
  if (row?.html) links = extractInternalLinks(row.html, url);
  else {
    const c = await checkUrl(url);
    if (c.html) links = extractInternalLinks(c.html, url);
  }
  log(url + ' -> ' + (links.length ? links.join(', ') : '[none found]'));
}

const blEvent = await getBacklinkAgg('event');
const blProduct = await getBacklinkAgg('product');
const statusBySlug = new Map([
  ...d1.map((x) => [x.event_slug, x.status]),
  ...d1Products.map((x) => [x.slug, x.status])
]);
const productBlSlugs = new Set(blProduct.map((r) => normalizeSlug(r.url_to)));
const eventSummary = backlinkAssetSummary(blEvent, statusBySlug);
const productSummary = backlinkAssetSummary(blProduct, statusBySlug);
const pairs = await getEventProductPairs();

log('\n=== DELIVERABLE 4 — wherecanwego link asset (by target type) ===');
log('metric\ttarget_type\tvalue');
for (const [prefix, s] of [['event', eventSummary], ['product', productSummary]]) {
  log(`${prefix}_dofollow_link_rows\t${prefix}\t${s.rows}`);
  log(`${prefix}_distinct_wherecanwego_source_pages\t${prefix}\t${s.sources}`);
  log(`${prefix}_distinct_target_urls\t${prefix}\t${s.targets}`);
  log(`${prefix}_first_seen_min\t${prefix}\t${s.firstSeen ? s.firstSeen.slice(0, 10) : ''}`);
  log(`${prefix}_last_seen_max\t${prefix}\t${s.lastSeen ? s.lastSeen.slice(0, 10) : ''}`);
  log(`${prefix}_target_urls_http_200_now\t${prefix}\t${s.live200}`);
  log(`${prefix}_target_urls_http_404_now\t${prefix}\t${s.dead404}`);
  log(`${prefix}_target_urls_http_3xx_now\t${prefix}\t${s.redirect301}`);
  log(`${prefix}_target_urls_other_status_now\t${prefix}\t${s.other}`);
  log(`${prefix}_dofollow_rows_targeting_200_urls\t${prefix}\t${s.rows200}`);
  log(`${prefix}_dofollow_rows_targeting_404_urls\t${prefix}\t${s.rows404}`);
  log(`${prefix}_dofollow_rows_targeting_3xx_urls\t${prefix}\t${s.rows3xx}`);
}
log('combined_dofollow_link_rows\tboth\t' + (eventSummary.rows + productSummary.rows));
log('combined_distinct_wherecanwego_source_pages\tboth\t' + new Set([...blEvent, ...blProduct].map((r) => r.url_from)).size);

log('\n=== DELIVERABLE 5 — Event vs product backlink pairs (per event URL with WCW backlink) ===');
log('workshop\tevent_url\tevent_http_status\tproduct_url_with_own_wcw_backlink\tproduct_http_status\tproduct_has_own_wcw_backlink\tboth_live_200');
const d1BySlug = new Map(d1.map((x) => [x.event_slug, x]));
let d5BothLive = 0, d5ProductOwnBl = 0, d5EventOnly = 0;
for (const e of [...d1BySlug.values()].sort((a, b) => a.event_slug.localeCompare(b.event_slug))) {
  const mapped = pairs.get(e.event_slug);
  const mappedProductSlug = mapped?.product_slug || '';
  const productSlug = productBlSlugs.has(mappedProductSlug) ? mappedProductSlug : '';
  const productUrl = productSlug ? `https://www.alanranger.com/${productSlug}` : '';
  const eventStatus = e.status;
  const productStatus = productSlug ? (statusBySlug.get(productSlug) ?? '') : '';
  const hasOwn = productSlug ? 'yes' : 'no';
  const bothLive = eventStatus === 200 && productStatus === 200 ? 'yes' : 'no';
  if (productSlug) d5ProductOwnBl++;
  else d5EventOnly++;
  if (bothLive === 'yes') d5BothLive++;
  log([
    workshopLabel(productSlug || mappedProductSlug, e.event_slug),
    e.url,
    eventStatus,
    productUrl || '[none — product page has no separate WCW backlink]',
    productStatus || '',
    hasOwn,
    bothLive
  ].join('\t'));
}
log('\nD5 summary\tevents_with_own_product_wcw_backlink\t' + d5ProductOwnBl);
log('D5 summary\tevents_without_own_product_wcw_backlink\t' + d5EventOnly);
log('D5 summary\trows_both_live_200\t' + d5BothLive);

log('\n=== DELIVERABLE 5b — Product WCW backlinks without mapped event WCW backlink ===');
log('workshop\tproduct_url\tproduct_http_status\twcw_dofollow_rows');
const eventSlugs = new Set(events.map((e) => e.event_slug));
for (const p of products.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const mappedEvents = [...pairs.entries()]
    .filter(([eventSlug, v]) => v.product_slug === p.slug && eventSlugs.has(eventSlug))
    .map(([k]) => k);
  if (mappedEvents.length) continue;
  const rows = blProduct.filter((r) => normalizeSlug(r.url_to) === p.slug).length;
  log([workshopLabel(p.slug, ''), p.url, statusBySlug.get(p.slug), rows].join('\t'));
}

fs.mkdirSync('logs', { recursive: true });
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
log('\nWrote', OUT);
