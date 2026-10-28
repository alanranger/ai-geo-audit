import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { analyzeTraditionalSeoHtmlSignals } from '../api/aigeo/content-extractability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gardenUrl = 'https://www.alanranger.com/photo-workshops-uk/garden-photography-workshop';
const shopUrl = 'https://www.alanranger.com/photo-workshops-uk';

test('K3 primary H1 is ProductItem-details-title, not a longer related ProductList-title', () => {
  const html = [
    '<h1 class="ProductItem-details-excerpt-mobile ProductItem-details-title">Garden Photography Workshops</h1>',
    '<h1 class="ProductItem-details-excerpt ProductItem-details-title">Garden Photography Workshops</h1>',
    '<h1 class="ProductList-title">WARWICKSHIRE Woodland PHOTOGRAPHY WALKS in Coventry</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(html, gardenUrl);
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Garden Photography Workshops');
  assert.equal(seo.firstH1PlainText, 'Garden Photography Workshops');
});

test('shop grid ProductList-title cards are not counted toward the page H1', () => {
  const html = [
    '<h1 class="page-title">Photography Workshops UK</h1>',
    '<h1 class="ProductList-title">Garden Photography Workshops</h1>',
    '<h1 class="ProductList-title">Peak District Photography Workshops</h1>'
  ].join('\n');
  const seo = analyzeTraditionalSeoHtmlSignals(html, shopUrl);
  assert.equal(seo.h1Count, 1);
  assert.equal(seo.primaryH1PlainText, 'Photography Workshops UK');
});

test('gift-voucher style title pair with no related block counts as one H1', () => {
  const html = [
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

test('dashboard no longer relaxes Squarespace multi-H1 on shop paths', () => {
  const dash = fs.readFileSync(path.join(__dirname, '..', 'audit-dashboard.html'), 'utf8');
  assert.equal(dash.includes('traditionalSeoShouldRelaxSquarespaceMultiH1'), false);
  assert.match(dash, /ProductList-title cards are ignored/);
});
