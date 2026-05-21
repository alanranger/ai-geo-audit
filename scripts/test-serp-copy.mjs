import {
  buildHubMeta,
  buildHubTitle,
  buildSerpCopyAdvice,
  fitMetaDescription,
  normalizeSerpText,
  serpLength,
  META_MIN,
  META_MAX
} from '../lib/revenue-funnel-serp-copy.js';

const COVENTRY = 'https://www.alanranger.com/photography-courses-coventry';

let failed = 0;
function ok(c, m) {
  if (!c) { console.error('FAIL:', m); failed++; }
  else console.log('OK:', m);
}

const meta = buildHubMeta(COVENTRY);
ok(meta.valid && meta.length >= META_MIN && meta.length <= META_MAX, `Coventry hub meta ${meta.length} in ${META_MIN}-${META_MAX}`);
ok(!meta.text.includes('\u2014'), 'Meta has no em dash');
ok(meta.text.includes(' - '), 'Meta uses ASCII hyphen');

const title = buildHubTitle(COVENTRY);
ok(title.valid && title.length <= 58, `Coventry title ${title.length}ch`);

const advice = buildSerpCopyAdvice({
  pageUrl: COVENTRY,
  rankingKw: 'photography lessons',
  rank: 18,
  searchVolume: 390,
  title: 'Photography Courses Coventry or Online - Learn from a Pro',
  meta: 'Master photography with courses in Coventry or online. From complete beginners to RPS accreditation. Flexible Options - Book a free consultation today.'
});
ok(advice.isHub, 'Coventry detected as hub');
ok(advice.metaExample && advice.metaExampleLength >= META_MIN && advice.metaExampleLength <= META_MAX, 'Hub advice includes verified meta');
ok(advice.h1Recommendation && advice.h1Recommendation.includes('Coventry'), 'Hub keeps H1');

const em = normalizeSerpText('Coventry — test');
ok(em === 'Coventry - test', 'normalizeSerpText fixes em dash');

const fitted = fitMetaDescription('x'.repeat(200));
ok(fitted.valid && fitted.length <= META_MAX, 'fitMetaDescription clamps long text');

console.log('Coventry meta:', meta.text);
console.log(failed ? `${failed} failed` : 'All serp-copy checks passed');
process.exit(failed ? 1 : 0);
