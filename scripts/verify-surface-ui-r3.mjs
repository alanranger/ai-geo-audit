import fs from 'fs';
const h = fs.readFileSync('audit-dashboard.html', 'utf8');
const checks = [
  ['census', 'surface-ownership-census'],
  ['rowOwns', 'function rowOwnsAnswerSurface'],
  ['censusFn', 'function computeSurfaceOwnershipCensus'],
  ['conv', 'function computeRankToSurfaceConversion'],
  ['render', 'function renderSurfaceOwnershipCensus'],
  ['filt', 'rankingFiltersAreActive()'],
  ['bannerHide', 'total > 0 && rankingFiltersAreActive()'],
  ['bannerActive', 'classList.add(\'is-active\')'],
  ['bannerEarly', 'Sync pills + filter banner immediately'],
  ['rank', 'Rank → surface conversion'],
  ['aio', 'AI Overview citations (one surface of five)'],
  ['hide', 'Merged into Surface ownership census'],
  ['css', 'display: none !important'],
  ['dash', 'AI Overview citations (money share)'],
];
let miss = 0;
for (const [n, s] of checks) {
  const ok = h.includes(s);
  console.log(ok ? 'OK' : 'MISS', n);
  if (!ok) miss++;
}
process.exit(miss ? 1 : 0);
