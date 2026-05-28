// Verify production §9 role GSC overlay + spot-check slugs.

const BASE = 'https://ai-geo-audit.vercel.app';
const SPOT = [
  { label: 'Bluebell', tier: 'workshops_non_residential', hub: 'one-day-landscape-photography-workshops', product: 'photo-workshops-uk/bluebell-woodlands-photography-workshops', hubImp: 7218, prodImp: 1902 },
  { label: 'Peak heather', tier: 'workshops_non_residential', hub: 'landscape-photography-workshops', product: 'photo-workshops-uk/peak-district-heather-photography-workshop', hubImp: 110874, prodImp: 1104 },
  { label: 'Hartland', tier: 'workshops_residential', hub: 'photography-workshops', product: 'photo-workshops-uk/landscape-photography-devon-hartland-quay', hubImp: 56320, prodImp: 2869 },
  { label: 'Beginners course', tier: 'courses_masterclasses', hub: 'beginners-photography-classes', product: 'photography-services-near-me/beginners-photography-course', hubImp: 11796, prodImp: 19900 },
  { label: 'Intermediates Lightroom', tier: 'courses_masterclasses', hub: 'photo-editing-course-coventry', product: 'photography-services-near-me/intermediates-lightroom-photography-course', hubImp: 10066, prodImp: 0 }
];

const url = `${BASE}/api/aigeo/revenue-funnel-diagnosis?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`;

function slugRow(overlay, slug) {
  return (overlay?.slugs || []).find((r) => r.slug === slug) || null;
}

const res = await fetch(url, { cache: 'no-store' });
if (!res.ok) {
  console.error('API fail', res.status, await res.text());
  process.exit(1);
}
const p = await res.json();

const sample = p.tier_rollup?.find((t) => t.tier_key === 'workshops_non_residential');
console.log('deploy check: hub_gsc_trend=', !!sample?.hub_gsc_trend, 'product_gsc_trend=', !!sample?.product_gsc_trend, 'gsc_trend=', !!sample?.gsc_trend);

const rec = p.tier_reconciliation || {};
console.log('reconciliation passes:', rec.passes, rec.tier_sum_non_jlr);

console.log('\n=== spot-check slug numbers (production API) ===');
for (const s of SPOT) {
  const tier = p.tier_rollup.find((t) => t.tier_key === s.tier);
  const hub = slugRow(tier?.hub_gsc_trend, s.hub);
  const prod = slugRow(tier?.product_gsc_trend, s.product);
  const hubOk = (hub?.impressions ?? -1) === s.hubImp;
  const prodOk = (prod?.impressions ?? -1) === s.prodImp;
  console.log(`${s.label}: hub ${hub?.impressions}/${s.hubImp} ${hubOk ? 'OK' : 'MISMATCH'} | product ${prod?.impressions}/${s.prodImp} ${prodOk ? 'OK' : 'MISMATCH'}`);
}

console.log('\n=== tier role totals shown in UI ===');
for (const t of p.tier_rollup || []) {
  const h = t.hub_gsc_trend?.totals || {};
  const pr = t.product_gsc_trend?.totals || {};
  console.log(`${t.tier_key}: hub imp=${h.impressions ?? 0} clicks=${h.clicks ?? 0} | product imp=${pr.impressions ?? 0} clicks=${pr.clicks ?? 0}`);
}

console.log('\n=== page_count unchanged sample ===');
for (const t of p.tier_rollup || []) {
  console.log(`${t.tier_key}: page_count=${t.page_count}`);
}
