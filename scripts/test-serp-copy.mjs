import { buildSerpCopyAdvice, proposeTitleExample, pickKeywordForPage } from '../lib/revenue-funnel-serp-copy.js';

const COVENTRY = 'https://www.alanranger.com/photography-courses-coventry';
const keywords = [
  { keyword: 'photography lessons', best_url: COVENTRY, search_volume: 390, best_rank_group: 18 },
  { keyword: 'photography courses', best_url: COVENTRY, search_volume: 6600, best_rank_group: 12 }
];

const title = 'Photography Courses Coventry or Online - Learn from a Pro';
const meta = 'Master photography with courses in Coventry or online. From complete beginners to RPS accreditation. Flexible Options - Book a free consu…';

const picked = pickKeywordForPage(COVENTRY, keywords);
const advice = buildSerpCopyAdvice({
  pageUrl: COVENTRY,
  rankingKw: picked.keyword,
  rank: picked.best_rank_group,
  searchVolume: picked.search_volume,
  title,
  meta: meta.slice(0, 151)
});

let failed = 0;
function ok(c, m) { if (!c) { console.error('FAIL:', m); failed++; } else console.log('OK:', m); }

ok(picked.keyword === 'photography courses', 'Curated pick prefers tier keyword over lessons');
ok(advice.lead && advice.lead.includes('Courses'), 'Lead uses courses noun');
ok(!/Lessons in Coventry/i.test(advice.lead || ''), 'Lead does not swap to lessons');
ok(advice.titleExample && advice.titleExample.length <= 58, 'Title example within ~58ch');
ok(
  advice.reasons.some((r) => /online/i.test(r)) || advice.actions.length > 0,
  'Flags "or Online" in title or suggests meta/title tweak'
);

console.log('Example title:', advice.titleExample);
console.log(failed ? `${failed} failed` : 'All serp-copy checks passed');
process.exit(failed ? 1 : 0);
