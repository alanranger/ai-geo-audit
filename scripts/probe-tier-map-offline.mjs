// Offline sanity check that doesn't need Supabase creds.
// Hand-builds a small map matching what csv_metadata would return and
// confirms title-prefix fallback works when SQ omits productUrl.
import { setProductTierMap, classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

setProductTierMap({
  slugToTier: new Map([
    ['/photo-workshops-uk/landscape-photography-snowdonia-workshops', 'workshops_residential'],
    ['/photo-workshops-uk/bluebell-woodlands-photography-workshops', 'workshops_nonres'],
    ['/photo-workshops-uk/long-exposure-photography-workshop-fairy-glen', 'workshops_nonres'],
    ['/photography-services-near-me/premium-photography-academy-membership', 'academy'],
  ]),
  titleToTier: new Map([
    ['bluebell woodlands photography', 'workshops_nonres'],
    ['fairy glen and fairy falls long exposure photography', 'workshops_nonres'],
    ['the secret of woodland photography', 'workshops_nonres'],
    ['warwickshire woodland photography walks', 'workshops_nonres'],
    ['landscape photography snowdonia', 'workshops_residential'],
    ['landscape photography devon workshops', 'workshops_residential'],
    ['premium photography academy membership subscription', 'academy'],
    ['foundation digital pack', 'academy'],
  ]),
});

const CASES = [
  // 1. URL present -> slug match wins
  ['/photo-workshops-uk/landscape-photography-snowdonia-workshops', 'whatever',           'workshops_residential'],
  // 2. URL missing -> title prefix wins
  ['', 'BLUEBELL WOODLANDS Photography - Warks - 20 Apr- 30 Apr',                          'workshops_nonres'],
  ['', 'FAIRY GLEN and Fairy Falls Long Exposure Photography',                             'workshops_nonres'],
  ['', 'WARWICKSHIRE Woodland PHOTOGRAPHY WALKS - Monthly - 2hrs',                         'workshops_nonres'],
  ['', 'Landscape Photography SNOWDONIA - Sat 7 - Sun 8 Mar 2026',                         'workshops_residential'],
  ['', 'Landscape Photography DEVON Workshops - Various Dates',                            'workshops_residential'],
  ['', 'Foundation Digital Pack \u2013 60 Modules, Checklists & Exams',                    'academy'],
  // 3. Neither -> falls through to legacy rules
  ['', 'Photography Consultation - 1hr',                                                   'hire'],
  ['', 'Some unknown thing',                                                               'unidentified'],
];

let ok = 0, fail = 0;
for (const [url, title, expected] of CASES) {
  const got = classifyCommercialTier(url, title);
  const pass = got === expected;
  if (pass) ok++; else fail++;
  console.log(pass ? 'OK ' : 'FAIL', got.padEnd(24), 'expected:', expected.padEnd(24), '|', (url || '<no url>').padEnd(60), '|', title);
}
console.log(`\nTotals: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
