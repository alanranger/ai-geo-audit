import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { analyzeTraditionalSeoHtmlSignals } from '../api/aigeo/content-extractability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gardenUrl = 'https://www.alanranger.com/photo-workshops-uk/garden-photography-workshop';
const shopUrl = 'https://www.alanranger.com/photo-workshops-uk';
const beginnersUrl = 'https://www.alanranger.com/photography-services-near-me/beginners-photography-course';
const LOADER = '<script src="https://schema.alanranger.com/loaders/product-page-loader.js" defer></script>';

function gardenHtml(withLoader, relatedCount = 5) {
  const related = Array.from({ length: relatedCount }, (_, i) =>
    `<h1 class="ProductList-title">Related workshop ${i + 1} WARWICKSHIRE Woodland PHOTOGRAPHY WALKS</h1>`
  ).join('\n');
  return [
    withLoader ? LOADER : '',
    '<h1 class="ProductItem-details-excerpt-mobile ProductItem-details-title">The Art of GARDEN PHOTOGRAPHY - Coventry - May and July</h1>',
    '<h1 class="ProductItem-details-excerpt ProductItem-details-title">The Art of GARDEN PHOTOGRAPHY - Coventry - May and July</h1>',
    related
  ].join('\n');
}

function shopHtml(withLoader, cardCount = 23) {
  const cards = Array.from({ length: cardCount }, (_, i) =>
    `<h1 class="ProductList-title">Workshop card ${i + 1}</h1>`
  ).join('\n');
  return [
    withLoader ? LOADER : '',
    '<h1 class="page-title">Photo Workshops UK - Landscape Photography Workshops</h1>',
    cards
  ].join('\n');
}

test('K3 primary H1 is ProductItem-details-title, not a longer related ProductList-title', () => {
  const html = [
    LOADER,
    '<h1 class="ProductItem-details-excerpt-mobile ProductItem-details-title">Garden Photography Workshops</h1>',
    '<h1 class="ProductItem-details-excerpt ProductItem-details-title">Garden Photography Workshops</h1>',
    '<h1 class="ProductList-title">WARWICKSHIRE Woodland PHOTOGRAPHY WALKS in Coventry</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(html, gardenUrl);
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Garden Photography Workshops');
  assert.equal(seo.firstH1PlainText, 'Garden Photography Workshops');
});

test('shop grid ProductList-title cards are not counted when the product loader is present', () => {
  const seo = analyzeTraditionalSeoHtmlSignals(shopHtml(true, 2), shopUrl);
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Photo Workshops UK - Landscape Photography Workshops');
});

test('gift-voucher style title pair with no related block counts as one H1', () => {
  const html = [
    LOADER,
    '<h1 class="ProductItem-details-title">Photography Gift Vouchers</h1>',
    '<h1 class="ProductItem-details-title">Photography Gift Vouchers</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(
    html,
    'https://www.alanranger.com/photography-services-near-me/photography-gift-vouchers'
  );
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Photography Gift Vouchers');
});

test('dashboard ignores ProductList-title only when the product loader is present', () => {
  const dash = fs.readFileSync(path.join(__dirname, '..', 'audit-dashboard.html'), 'utf8');
  assert.equal(dash.includes('traditionalSeoShouldRelaxSquarespaceMultiH1'), false);
  assert.match(dash, /ProductList-title cards are ignored only when a product-page-loader\.js script tag is in the HTML/);
});

test('garden with loader: H1 is 1 (title pair); without loader: related cards count and single_h1 fails', () => {
  const withLoader = analyzeTraditionalSeoHtmlSignals(gardenHtml(true), gardenUrl);
  assert.equal(withLoader.h1Count, 1);
  assert.equal(withLoader.primaryH1PlainText, 'The Art of GARDEN PHOTOGRAPHY - Coventry - May and July');
  const stripped = analyzeTraditionalSeoHtmlSignals(gardenHtml(false), gardenUrl);
  assert.equal(stripped.h1Count, 6);
  assert.notEqual(stripped.h1Count, 1);
  assert.equal(stripped.primaryH1PlainText, 'The Art of GARDEN PHOTOGRAPHY - Coventry - May and July');
});

test('workshops shop with loader: H1 is 1; without loader: 24 H1s so single_h1 fails', () => {
  const withLoader = analyzeTraditionalSeoHtmlSignals(shopHtml(true), shopUrl);
  assert.equal(withLoader.h1Count, 1);
  const stripped = analyzeTraditionalSeoHtmlSignals(shopHtml(false), shopUrl);
  assert.equal(stripped.h1Count, 24);
});

test('a comment mentioning the loader does not skip ProductList-title H1s', () => {
  const html = [
    '<!-- https://schema.alanranger.com/loaders/product-page-loader.js -->',
    '<h1 class="page-title">Photo Workshops UK - Landscape Photography Workshops</h1>',
    '<h1 class="ProductList-title">Workshop card 1</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(html, shopUrl);
  assert.equal(seo.h1Count, 2);
});

test('beginners product with loader still counts the title pair as one H1', () => {
  const html = [
    LOADER,
    '<h1 class="ProductItem-details-title">Beginners Photography Course | 3 Weekly Evening Classes</h1>',
    '<h1 class="ProductItem-details-title">Beginners Photography Course | 3 Weekly Evening Classes</h1>',
    '<h1 class="ProductList-title">Lightroom Courses for Beginners Photo Editing - Coventry</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(html, beginnersUrl);
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Beginners Photography Course | 3 Weekly Evening Classes');
});
