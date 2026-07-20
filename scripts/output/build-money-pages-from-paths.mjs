import fs from 'fs';

// Money URLs from latest audit_results.money_page_priority_data (2026-07-18 snapshot).
// Paths only; segment via same rules as lib/audit/moneyPages.js classifyMoneyPageSubSegment.
const paths = `
/academy/login
/batsford-arboretum-photography
/beginners-photography-classes
/beginners-portrait-photography-course
/bluebell-woods-near-me
/contact-us-alan-ranger-photography
/copyright-policy-alan-ranger
/corporate-photography-training
/course-finder-photography-classes-near-me
/data-privacy-policy
/free-online-photography-course
/hire-a-professional-photographer-in-coventry
/home
/jaguar-land-rover-els
/landscape-photography-workshops
/my-ethical-policy
/photo-editing-course-coventry
/photo-workshops-uk/abstract-and-macro-photography-workshops
/photo-workshops-uk/batsford-arboretum-photography-workshops
/photo-workshops-uk/bluebell-woodlands-photography-workshops
/photo-workshops-uk/christmas-photography-workshops
/photo-workshops-uk/coastal-northumberland-photography-workshops
/photo-workshops-uk/dartmoor-photography-landscape-workshop
/photo-workshops-uk/dorset-landscape-photography-workshop
/photo-workshops-uk/exmoor-photography-workshops-lynmouth
/photo-workshops-uk/fireworks-photography-workshop-kenilworth
/photo-workshops-uk/garden-photography-workshop
/photo-workshops-uk/ireland-photography-workshops-dingle
/photo-workshops-uk/lake-district-photography-workshop
/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire
/photo-workshops-uk/landscape-photography-devon-hartland-quay
/photo-workshops-uk/landscape-photography-snowdonia-workshops
/photo-workshops-uk/landscape-photography-wales-photo-workshop
/photo-workshops-uk/landscape-photography-workshop-norfolk
/photo-workshops-uk/landscape-photography-workshops-anglesey
/photo-workshops-uk/landscape-photography-workshops-nant-mill
/photo-workshops-uk/long-exposure-photography-kenilworth
/photo-workshops-uk/long-exposure-photography-workshop-fairy-glen
/photo-workshops-uk/long-exposure-photography-workshops-burnham
/photo-workshops-uk/north-yorkshire-landscape-photography
/photo-workshops-uk/peak-district-heather-photography-workshop
/photo-workshops-uk/photography-workshops-chesterton-windmill
/photo-workshops-uk/photography-workshops-lavender-fields
/photo-workshops-uk/poppy-fields-photography-workshops
/photo-workshops-uk/secrets-of-woodland-photography-workshop
/photo-workshops-uk/sezincote-garden-photography-workshop
/photo-workshops-uk/suffolk-landscape-photography-workshops
/photo-workshops-uk/urban-architecture-photography-workshops-coventry
/photo-workshops-uk/wales-photography-workshop-pistyll-rhaeadr
/photo-workshops-uk/woodland-photography-walk-warwickshire
/photo-workshops-uk/yorkshire-dales-photography-workshops
/photographic-workshops-near-me
/photographic-workshops-near-me/abstract-and-macro-photography-workshop
/photographic-workshops-near-me/abstract-and-macro-photography-workshop-coventry
/photographic-workshops-near-me/anglesey-photography-workshop-wales
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-1nov
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-29oct
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-2nov
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-30oct
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-31oct
/photographic-workshops-near-me/batsford-arboretum-autumn-photography-3nov
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-01
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-17
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-18
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-19
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-20
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-21
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-22
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-23
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-24
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-25
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-29
/photographic-workshops-near-me/bluebell-photography-photo-workshop-warwickshire-30
/photographic-workshops-near-me/christmas-photography-walk-warwickshire
/photographic-workshops-near-me/dartmoor-photography-workshop-woodlands
/photographic-workshops-near-me/dingle-kerry-ireland-photography-workshop
/photographic-workshops-near-me/dorset-photography-workshop
/photographic-workshops-near-me/exmoor-photography-workshops-seascapes-lynmouth
/photographic-workshops-near-me/fairy-glen-betws-y-coed-photography
/photographic-workshops-near-me/fairy-glen-photography-betws-y-coed
/photographic-workshops-near-me/fairy-glen-photography-wales
/photographic-workshops-near-me/garden-photography-workshop
/photographic-workshops-near-me/garden-photography-workshop-mxyms
/photographic-workshops-near-me/hartland-quay-devon-seascapes-ynfcl
/photographic-workshops-near-me/hartland-quay-photography-devon-seascapes
/photographic-workshops-near-me/lake-district-photography-workshop-autumn
/photographic-workshops-near-me/lake-district-photography-workshop-late-summer
/photographic-workshops-near-me/lake-district-photography-workshop-spring
/photographic-workshops-near-me/lake-district-photography-workshop-winter
/photographic-workshops-near-me/landscape-photography-snowdonia-workshop
/photographic-workshops-near-me/landscape-photography-wales-gower-peninsular
/photographic-workshops-near-me/landscape-photography-workshops-yorkshire
/photographic-workshops-near-me/landscape-photography-workshops-yorkshire-coast
/photographic-workshops-near-me/lavender-photography-workshop-sunset
/photographic-workshops-near-me/lavender-photography-workshop-sunset-19
/photographic-workshops-near-me/leamington-spa-night-shoot
/photographic-workshops-near-me/long-exposure-photo-workshop-sunset-kenilworth
/photographic-workshops-near-me/long-exposure-photography-burnham-on-sea
/photographic-workshops-near-me/long-exposure-photography-workshop-kenilworth1
/photographic-workshops-near-me/long-exposure-photography-workshop-kenilworth2
/photographic-workshops-near-me/long-exposure-photography-workshop-kenilworth4
/photographic-workshops-near-me/nant-mill-woodlands
/photographic-workshops-near-me/norfolk-photography-workshop
/photographic-workshops-near-me/northumberland-landscape-photography-workshop
/photographic-workshops-near-me/peak-district-photography-workshops-autumn
/photographic-workshops-near-me/peak-district-photography-workshops-autumn-2
/photographic-workshops-near-me/peak-district-photography-workshops-heathers-sunrise
/photographic-workshops-near-me/peak-district-photography-workshops-heathers-sunset
/photographic-workshops-near-me/peak-district-photography-workshops-spring
/photographic-workshops-near-me/peak-district-photography-workshops-sunrise-heathers
/photographic-workshops-near-me/peak-district-photography-workshops-winter
/photographic-workshops-near-me/poppy-fields-photography-workshop-sunrise
/photographic-workshops-near-me/poppy-fields-photography-workshop-sunset
/photographic-workshops-near-me/secrets-of-woodland-photography-masterclass-autumn
/photographic-workshops-near-me/secrets-of-woodland-photography-masterclass-spring
/photographic-workshops-near-me/secrets-of-woodland-photography-masterclass-summer
/photographic-workshops-near-me/secrets-of-woodland-photography-masterclass-winter
/photographic-workshops-near-me/sezincote-garden-photography-workshop
/photographic-workshops-near-me/somerset-photography-workshop
/photographic-workshops-near-me/suffolk-landscape-photography-workshop
/photographic-workshops-near-me/sunset-chesterton-windmill-photography-workshop
/photographic-workshops-near-me/sunset-chesterton-windmill-spring
/photographic-workshops-near-me/sunset-chesterton-windmill-spring-7gw7j
/photographic-workshops-near-me/sunset-chesterton-windmill-spring-7gw7j-9akd5
/photographic-workshops-near-me/urban-architecture-photography-workshop-coventry
/photographic-workshops-near-me/wales-photography-workshop-vyrnwy-pistyll-rhaeadr
/photographic-workshops-near-me/woodland-photography-walk-coventry-cv4
/photographic-workshops-near-me/woodland-photography-walk-coventry-piles-coppice
/photographic-workshops-near-me/woodland-photography-walk-coventry-tile-hill
/photographic-workshops-near-me/woodland-photography-walk-hay-woods
/photographic-workshops-near-me/woodland-photography-walk-kenilworth-crackley-woods
/photographic-workshops-near-me/woodland-photography-walk-leamington-oakley-wood
/photographic-workshops-near-me/woodland-photography-walk-meriden-millisons-wood
/photographic-workshops-near-me/woodland-photography-walk-solihull-hay-woods
/photographic-workshops-near-me/yorkshire-dales-photography-workshop
/photography-courses-coventry
/photography-gift-vouchers
/photography-lessons-online-121
/photography-mentoring-online-assignments
/photography-payment-plan
/photography-services-near-me/annual-pick-n-mix-subscription
/photography-services-near-me/beginners-photography-course
/photography-services-near-me/beginners-portrait-photography-course
/photography-services-near-me/camera-sensor-clean
/photography-services-near-me/four-private-photography-classes
/photography-services-near-me/intermediates-intentions-photography-project-course
/photography-services-near-me/lightroom-courses-for-beginners-coventry
/photography-services-near-me/monthly-pick-n-mix-subscription
/photography-services-near-me/photography-gift-vouchers
/photography-services-near-me/private-online-photography-classes-zoom
/photography-services-near-me/quarterly-pick-n-mix-subscription
/photography-services-near-me/rps-mentoring-photography-course
/photography-special-offers
/photography-tuition-services
/photography-workshops
/photography-workshops-near-me
/private-photography-lessons
/professional-commercial-photographer-coventry
/professional-photographer-near-me
/property-photographer-coventry
/rps-courses-mentoring-distinctions
/schedule-an-appointment
/terms-and-conditions
/website-cookie-policy
/website-terms-and-conditions
`.trim().split(/\n/).map((s) => s.trim()).filter(Boolean);

function segment(path) {
  const u = path.toLowerCase();
  if (u.includes('/beginners-photography-lessons') || u.includes('/photographic-workshops-near-me')) return 'event';
  if (u.includes('/photo-workshops-uk') || u.includes('/photography-services-near-me')) return 'product';
  return 'landing';
}

const pages = paths.map((p) => ({
  page_url: `https://www.alanranger.com${p}`,
  segment: segment(p),
}));

const out = 'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/scripts/output/money-pages-165.json';
fs.writeFileSync(out, JSON.stringify(pages, null, 2));
const counts = pages.reduce((a, p) => {
  a[p.segment] = (a[p.segment] || 0) + 1;
  return a;
}, {});
console.log({ n: pages.length, counts });
