import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRevenueStreamGscRoles,
  isEligibleProductSlug,
  slugFromCanonicalUrl
} from '../lib/revenue-stream-gsc-roles.js';
import { tierFromProductCategory } from '../lib/revenue-tier-mapping.js';

test('excludes L2 roots and event paths', () => {
  assert.equal(isEligibleProductSlug('photo-workshops-uk'), false);
  assert.equal(isEligibleProductSlug('photography-services-near-me'), false);
  assert.equal(isEligibleProductSlug('photographic-workshops-near-me/foo'), false);
  assert.equal(isEligibleProductSlug('photo-workshops-uk/bluebell-woodlands-photography-workshops'), true);
});

test('print and voucher tiers come from product category not URL parent', () => {
  const lookup = buildRevenueStreamGscRoles([
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/framed-fine-art-photography-prints',
      service_page_url: 'https://www.alanranger.com/fine-art-prints',
      category: 'print'
    },
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/photography-gift-vouchers',
      service_page_url: 'https://www.alanranger.com/photography-gift-vouchers',
      category: 'gift voucher'
    },
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/beginners-photography-course',
      service_page_url: 'https://www.alanranger.com/beginners-photography-classes',
      category: 'course'
    }
  ]);

  const prints = lookup.streams.find((s) => s.tier_key === 'prints_royalties');
  const vouchers = lookup.streams.find((s) => s.tier_key === 'gift_vouchers_inc');
  const courses = lookup.streams.find((s) => s.tier_key === 'courses_masterclasses');

  assert.ok(prints.product_slugs.includes('photography-services-near-me/framed-fine-art-photography-prints'));
  assert.ok(vouchers.product_slugs.includes('photography-services-near-me/photography-gift-vouchers'));
  assert.ok(courses.product_slugs.includes('photography-services-near-me/beginners-photography-course'));
  assert.equal(tierFromProductCategory('print'), 'prints_royalties');
  assert.equal(tierFromProductCategory('gift voucher'), 'gift_vouchers_inc');
});

test('nav hubs derive from service_page_url not hardcoded list', () => {
  const lookup = buildRevenueStreamGscRoles([
    {
      product_url: 'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops',
      service_page_url: 'https://www.alanranger.com/one-day-landscape-photography-workshops',
      category: 'workshop (1-day)'
    }
  ]);
  const stream = lookup.streams.find((s) => s.tier_key === 'workshops_non_residential');
  // /one-day-landscape-photography-workshops is a retired_redirect -> the nav
  // hub canonicalises to /landscape-photography-workshops (consolidation merge).
  assert.deepEqual(stream.nav_hub_slugs, ['landscape-photography-workshops']);
  assert.equal(
    slugFromCanonicalUrl('https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops'),
    'photo-workshops-uk/bluebell-woodlands-photography-workshops'
  );
});

test('commissions pick_n_mix and academy derive from canonical_products categories', () => {
  const lookup = buildRevenueStreamGscRoles([
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/camera-sensor-clean',
      service_page_url: null,
      category: 'service'
    },
    {
      product_url: null,
      service_page_url: 'https://www.alanranger.com/hire-a-professional-photographer-in-coventry',
      category: 'commission'
    },
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/foundation-digital-pack-plus',
      service_page_url: 'https://www.alanranger.com/free-online-photography-course',
      category: 'academy'
    },
    {
      product_url: 'https://www.alanranger.com/photography-services-near-me/monthly-pick-n-mix-subscription',
      service_page_url: 'https://www.alanranger.com/photography-payment-plan',
      category: 'subscription/payment-plan'
    }
  ]);

  const commissions = lookup.streams.find((s) => s.tier_key === 'commissions');
  assert.deepEqual(commissions.nav_hub_slugs, ['hire-a-professional-photographer-in-coventry']);
  assert.deepEqual(commissions.product_slugs, ['photography-services-near-me/camera-sensor-clean']);

  const pickMix = lookup.streams.find((s) => s.tier_key === 'pick_n_mix_inc');
  assert.deepEqual(pickMix.nav_hub_slugs, ['photography-payment-plan']);
  assert.deepEqual(pickMix.product_slugs, ['photography-services-near-me/monthly-pick-n-mix-subscription']);

  const academy = lookup.streams.find((s) => s.tier_key === 'academy');
  assert.deepEqual(academy.nav_hub_slugs, ['free-online-photography-course']);
  assert.ok(academy.product_slugs.includes('photography-services-near-me/foundation-digital-pack-plus'));
  assert.equal(tierFromProductCategory('academy'), 'academy');
});
