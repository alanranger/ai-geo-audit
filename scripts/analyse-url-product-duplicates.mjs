/** One-off: landing page / product URL duplicate analysis for Booking Sheet import. */
import fs from 'fs';
import { readWorkbookFromBuffer, parseBookingSheetTruth } from '../lib/booking-sheet-truth-parser.mjs';

function normUrl(u) {
  if (!u) return '';
  let s = String(u).trim().toLowerCase();
  s = s.replace(/^https?:\/\/(www\.)?alanranger\.com/i, '');
  s = s.replace(/\/$/, '');
  s = s.split('?')[0].split('#')[0];
  return s || '/';
}

function slugFromUrl(u) {
  const n = normUrl(u);
  if (!n || n === '/') return '(home)';
  return n.replace(/^\//, '');
}

function analyseYear(txns) {
  const productToUrls = new Map();
  const urlToProducts = new Map();
  const productTotals = new Map();
  const urlTotals = new Map();

  for (const t of txns) {
    const p = (t.canonical_product || '').trim();
    const u = normUrl(t.landing_page_url);
    if (p) {
      productTotals.set(p, (productTotals.get(p) || 0) + t.amount);
      if (u) {
        if (!productToUrls.has(p)) productToUrls.set(p, new Map());
        const m = productToUrls.get(p);
        m.set(u, (m.get(u) || 0) + 1);
      }
    }
    if (u) {
      urlTotals.set(u, (urlTotals.get(u) || 0) + t.amount);
      if (p) {
        if (!urlToProducts.has(u)) urlToProducts.set(u, new Map());
        const m = urlToProducts.get(u);
        m.set(p, (m.get(p) || 0) + 1);
      }
    }
  }

  const multiUrlProducts = [...productToUrls.entries()]
    .filter(([, urls]) => urls.size > 1)
    .map(([p, urls]) => ({
      product: p,
      urls: [...urls.entries()].sort((a, b) => b[1] - a[1]),
      total: productTotals.get(p)
    }))
    .sort((a, b) => b.total - a.total);

  const multiProductUrls = [...urlToProducts.entries()]
    .filter(([, prods]) => prods.size > 1)
    .map(([u, prods]) => ({
      url: u,
      products: [...prods.entries()].sort((a, b) => b[1] - a[1]),
      total: urlTotals.get(u)
    }))
    .sort((a, b) => b.total - a.total);

  return {
    multiUrlProducts,
    multiProductUrls,
    productCount: productTotals.size,
    urlCount: urlTotals.size,
    txnCount: txns.length,
    noPage: txns.filter((t) => !t.landing_page_url).length
  };
}

function crossYearUrlDrift(allTxns) {
  const urlYearProducts = new Map();
  for (const t of allTxns) {
    const u = normUrl(t.landing_page_url);
    const p = (t.canonical_product || '').trim();
    if (!u || !p) continue;
    const key = u;
    if (!urlYearProducts.has(key)) urlYearProducts.set(key, new Map());
    const ym = urlYearProducts.get(key);
    if (!ym.has(t.year)) ym.set(t.year, new Set());
    ym.get(t.year).add(p);
  }

  const drift = [];
  for (const [url, yearMap] of urlYearProducts) {
    const years = [...yearMap.keys()].sort();
    if (years.length < 2) continue;
    const allProds = new Set();
    for (const s of yearMap.values()) for (const p of s) allProds.add(p);
    if (allProds.size <= 1) continue;
    drift.push({
      url,
      byYear: Object.fromEntries([...yearMap.entries()].map(([y, s]) => [y, [...s]]))
    });
  }
  drift.sort((a, b) => a.url.localeCompare(b.url));
  return drift;
}

function hubVsProductSlugs(txns) {
  const HUB_HINTS = [
    '/landscape-photography-workshops',
    '/photography-courses',
    '/photography-workshops',
    '/1-2-1-photography-lessons',
    '/mentoring',
    '/academy',
    '/gift-vouchers'
  ];
  const hits = [];
  for (const t of txns) {
    const u = normUrl(t.landing_page_url);
    if (!u) continue;
    const isHub = HUB_HINTS.some((h) => u === h || u.startsWith(h + '/'));
    if (isHub) hits.push({ year: t.year, url: u, product: t.canonical_product, amount: t.amount });
  }
  return hits;
}

const buf = fs.readFileSync(
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/files/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING.xlsm'
);
const r = parseBookingSheetTruth(readWorkbookFromBuffer(buf), { minYear: 2024 });
const byYear = {};
for (const t of r.transactionRows) {
  (byYear[t.year] ||= []).push(t);
}

for (const y of [2024, 2025, 2026]) {
  const a = analyseYear(byYear[y] || []);
  console.log(`\n=== ${y} ===`);
  console.log(`txns ${a.txnCount} | products ${a.productCount} | urls ${a.urlCount} | no page ${a.noPage}`);
  console.log(`products with >1 URL: ${a.multiUrlProducts.length}`);
  console.log(`URLs with >1 product: ${a.multiProductUrls.length}`);
  console.log('\nProducts with multiple URLs:');
  for (const x of a.multiUrlProducts.slice(0, 20)) {
    console.log(`  ${x.product.slice(0, 75)} | £${x.total.toFixed(2)}`);
    for (const [u, c] of x.urls) console.log(`    ${c}x ${u}`);
  }
  console.log('\nURLs with multiple products:');
  for (const x of a.multiProductUrls.slice(0, 20)) {
    console.log(`  ${x.url} | £${x.total.toFixed(2)}`);
    for (const [p, c] of x.products) console.log(`    ${c}x ${p.slice(0, 75)}`);
  }
}

console.log('\n=== CROSS-YEAR URL -> PRODUCT DRIFT ===');
const drift = crossYearUrlDrift(r.transactionRows);
console.log(`URLs used with different products across years: ${drift.length}`);
for (const d of drift.slice(0, 30)) {
  console.log(`  ${d.url}`);
  for (const [y, prods] of Object.entries(d.byYear)) console.log(`    ${y}: ${prods.join(' | ')}`);
}

console.log('\n=== HUB URL BOOKINGS (possible hub vs product double-count risk) ===');
const hubHits = hubVsProductSlugs(r.transactionRows);
console.log(`Total hub-url bookings: ${hubHits.length}`);
const hubByUrl = new Map();
for (const h of hubHits) {
  const k = `${h.year}|${h.url}`;
  if (!hubByUrl.has(k)) hubByUrl.set(k, { count: 0, sum: 0, products: new Set() });
  const b = hubByUrl.get(k);
  b.count++;
  b.sum += h.amount;
  b.products.add(h.product);
}
for (const [k, b] of [...hubByUrl.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 25)) {
  const [y, url] = k.split('|');
  console.log(`  ${y} ${url} | ${b.count} txns £${b.sum.toFixed(2)} | ${[...b.products].slice(0, 3).join('; ')}`);
}

function productUrlDrift24425(allTxns) {
  const prodYearUrl = new Map();
  for (const t of allTxns) {
    const p = (t.canonical_product || '').trim();
    const u = normUrl(t.landing_page_url);
    if (!p || !u) continue;
    if (!prodYearUrl.has(p)) prodYearUrl.set(p, new Map());
    const ym = prodYearUrl.get(p);
    if (!ym.has(t.year)) ym.set(t.year, new Map());
    ym.get(t.year).set(u, (ym.get(t.year).get(u) || 0) + 1);
  }
  const changed = [];
  for (const [p, ym] of prodYearUrl) {
    const u24 = ym.get(2024) ? [...ym.get(2024).keys()] : [];
    const u25 = ym.get(2025) ? [...ym.get(2025).keys()] : [];
    if (!u24.length || !u25.length) continue;
    const set24 = new Set(u24);
    const set25 = new Set(u25);
    const only24 = u24.filter((u) => !set25.has(u));
    const only25 = u25.filter((u) => !set24.has(u));
    if (!only24.length && !only25.length) continue;
    const sum24 = allTxns.filter((t) => t.canonical_product === p && t.year === 2024).reduce((s, t) => s + t.amount, 0);
    const sum25 = allTxns.filter((t) => t.canonical_product === p && t.year === 2025).reduce((s, t) => s + t.amount, 0);
    changed.push({ product: p, only24, only25, sum24, sum25 });
  }
  return changed.sort((a, b) => (b.sum24 + b.sum25) - (a.sum24 + a.sum25));
}

console.log('\n=== PRODUCT URL CHANGES 2024 -> 2025 (keyword realignment risk) ===');
const urlChanged = productUrlDrift24425(r.transactionRows);
console.log(`Products with different landing URL between 2024 and 2025: ${urlChanged.length}`);
for (const x of urlChanged) {
  console.log(`\n  ${x.product.slice(0, 80)} | £2024 ${x.sum24.toFixed(2)} | £2025 ${x.sum25.toFixed(2)}`);
  if (x.only24.length) console.log(`    2024 only: ${x.only24.join(', ')}`);
  if (x.only25.length) console.log(`    2025 only: ${x.only25.join(', ')}`);
}

const allUrls = new Set(r.transactionRows.map((t) => normUrl(t.landing_page_url)).filter(Boolean));
const newStyle = [...allUrls].filter((u) => u.includes('/photo-workshops-uk/') || u.includes('/photography-services-near-me/'));
console.log('\n=== NEW-STYLE PRODUCT URLS IN BOOKING SHEET ===');
console.log(`Count: ${newStyle.length}`);
for (const u of newStyle.sort()) console.log(`  ${u}`);
