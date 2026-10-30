import test from 'node:test';
import assert from 'node:assert/strict';
import {
  academyCheck, blocksCheck, blogPostingChecks, canonicalCheck, duplicateTypesCheck, errorTextCheck,
  faqParityCheck, noindexCheck, runPageChecks, siteCodeErrors, statusFault
} from '../lib/fault-monitor/page-checks.js';
import { buildPlan, pageTypeOf, policyFor, rotationSlot } from '../lib/fault-monitor/plan.js';
import { questionLabels, parseJsonLd } from '../lib/fault-monitor/text.js';
import { renderSilentFaultsLine } from '../lib/fault-monitor/brief.js';
import { urlsFromCsv } from '../lib/fault-monitor/sync-check.js';
import { buildRow } from '../api/aigeo/tool-run-report.js';
import { faultKey } from '../lib/fault-monitor/store.js';

const POST = 'https://www.alanranger.com/blog-on-photography/uk-bluebell-photography-guide';
const HEADLINE = 'Bluebell Photography in the UK: A Practical Field Guide';
const INTRO = 'Every April, the UK puts on one of the great natural shows on the planet, half the world\'s bluebells carpet our ancient woods for a few short weeks.';
const REST = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} explains light, timing, lenses and white balance for woodland work in spring.`).join(' ');

function blogHtml(extra = '') {
  return `<html><body><article class="BlogItem"><h1 class="BlogItem-title">${HEADLINE}</h1><div class="BlogItem-meta">27 Oct 2026</div><div class="sqs-html-content"><p>${INTRO}</p><p>${REST}</p>${extra}</div></article></body></html>`;
}

function posting(body, extra = {}) {
  return { '@type': 'BlogPosting', headline: HEADLINE, description: 'A field guide to bluebell woods: when to go, lenses, light and colour.', articleBody: body, ...extra };
}

const byCheck = (results, c) => results.find((r) => r.check === c);

test('A1–A3 pass when the BlogPosting body is the whole post', () => {
  const r = blogPostingChecks(POST, [posting(`${INTRO} ${REST}`)], blogHtml());
  assert.deepEqual(r.map((x) => x.status), ['pass', 'pass', 'pass']);
});

test('A1 + A3 catch the 14 Oct title-only BlogPosting (bluebell, 9 words)', () => {
  const r = blogPostingChecks(POST, [posting(`${HEADLINE}.`)], blogHtml());
  assert.equal(byCheck(r, 'A1').status, 'fault');
  assert.equal(byCheck(r, 'A1').severity, 'red');
  assert.equal(byCheck(r, 'A3').status, 'fault');
});

test('A2 catches a dropped intro ("before you arrive…" start)', () => {
  const cut = REST.split(' ').slice(60).join(' ');
  const r = blogPostingChecks(POST, [posting(cut)], blogHtml());
  assert.equal(byCheck(r, 'A2').status, 'fault');
});

test('A2 tolerates a body that starts with hero text before the intro', () => {
  const r = blogPostingChecks(POST, [posting(`Updated 14 Oct 2026 Field guide ${INTRO} ${REST}`)], blogHtml());
  assert.equal(byCheck(r, 'A2').status, 'pass');
});

test('A1 faults when there is no BlogPosting at all', () => {
  const r = blogPostingChecks(POST, [{ '@type': 'Article' }], blogHtml());
  assert.equal(byCheck(r, 'A1').status, 'fault');
});

const ACADEMY = 'https://www.alanranger.com/free-online-photography-course';
const faqNode = (n, prefix = 'Question number') => ({ '@type': 'FAQPage', mainEntity: Array.from({ length: n }, (_, i) => ({ '@type': 'Question', name: `${prefix} ${i} about the course?` })) });
const labels = (n) => Array.from({ length: n }, (_, i) => `Question number ${i} about the course? +`);
const faqPage = (n) => ({ faqLabels: labels(n), html: '', bodyText: labels(n).join('\n') });

test('questionLabels counts "? +" accordions and ignores numbered HowTo steps', () => {
  assert.equal(questionLabels(['1Pack the night before+', 'When do bluebells flower?+', 'Do I need a tripod?', 'Which direction should my window face?▼', '2 Set up a clean background▼']), 3);
});

test('A4: 12 visible FAQs, no FAQPage on a money page = red', () => {
  const r = faqParityCheck(ACADEMY, 'money', [], { faqLabels: labels(12), html: '' });
  assert.equal(r.status, 'fault');
  assert.equal(r.severity, 'red');
});

test('A4: matching counts pass; mismatch on a blog is amber', () => {
  assert.equal(faqParityCheck(POST, 'blog', [faqNode(8)], faqPage(8)).status, 'pass');
  const r = faqParityCheck(POST, 'blog', [faqNode(5)], faqPage(8));
  assert.equal(r.status, 'fault');
  assert.equal(r.severity, 'amber');
});

test('A4: extra non-FAQ accordion questions do not overcount when FAQ section extracts 10', () => {
  const html = `
<h2>Photography classes near me — frequently asked questions</h2>
${Array.from({ length: 10 }, (_, i) => `<p><strong>Question number ${i} about the course?</strong></p><p>${'Answer text for this FAQ item needs thirty plus characters.'.repeat(1)}</p>`).join('')}
<li class="accordion-item"><span class="accordion-item__title">Which course should I start with?</span><div class="accordion-item__description"><p>Extra accordion.</p></div></li>
<li class="accordion-item"><span class="accordion-item__title">Evening classes, Zoom, and mentoring — which format suits you?</span><div class="accordion-item__description"><p>Extra accordion two.</p></div></li>`;
  const r = faqParityCheck(
    'https://www.alanranger.com/course-finder-photography-classes-near-me',
    'landing',
    [faqNode(10)],
    {
      faqLabels: labels(10).concat(['Which course should I start with?', 'Evening classes, Zoom, and mentoring — which format suits you?']),
      html,
      bodyText: labels(10).join('\n')
    }
  );
  assert.equal(r.status, 'pass');
});

test('A4: stale FAQPage (old questions, /photography-workshops case) and invisible FAQPage (10-basic case)', () => {
  const stale = faqParityCheck(ACADEMY, 'money', [faqNode(8, 'Are workshops worth it')], faqPage(9));
  assert.equal(stale.status, 'fault');
  assert.match(stale.title, /0 of them on the page/);
  const hidden = faqParityCheck(POST, 'blog', [faqNode(15)], { faqLabels: [], html: '', bodyText: 'no faq here' });
  assert.equal(hidden.status, 'fault');
});

test('A5: Service instead of Course is red; full Course passes', () => {
  assert.equal(academyCheck(ACADEMY, [{ '@type': 'Service' }], { reviewStripText: '5.0 out of 5 from 3 reviews' }).status, 'fault');
  const course = {
    '@type': 'Course',
    hasCourseInstance: [{ '@type': 'CourseInstance', offers: [{ '@type': 'Offer' }, { '@type': 'Offer' }] }],
    aggregateRating: { '@type': 'AggregateRating', ratingValue: 5, reviewCount: 3 }
  };
  assert.equal(academyCheck(ACADEMY, [course], { reviewStripText: '5.0 out of 5 from 3 reviews' }).status, 'pass');
  assert.equal(academyCheck(ACADEMY, [course], { reviewStripText: '5.0 out of 5 from 4 reviews' }).status, 'fault');
});

test('A6: two FAQPage blocks or a repeated HowTo id are duplicates', () => {
  assert.equal(duplicateTypesCheck(POST, [faqNode(3), faqNode(3)]).status, 'fault');
  assert.equal(duplicateTypesCheck(POST, [{ '@type': 'HowTo', '@id': '#h' }, { '@type': 'HowTo', '@id': '#h' }]).status, 'fault');
  assert.equal(duplicateTypesCheck(POST, [faqNode(3), { '@type': 'HowTo', '@id': '#h' }]).status, 'pass');
});

test('A6: shared @id with the same type is not a duplicate', () => {
  const id = 'https://www.alanranger.com/#person';
  const a = { '@type': 'Person', '@id': id, name: 'Alan Ranger' };
  const b = { '@type': 'Person', '@id': id, name: 'Alan Ranger' };
  assert.equal(duplicateTypesCheck(POST, [a, b]).status, 'pass');
});

test('A6: Organization+LocalBusiness vs Organization on the same @id passes', () => {
  const id = 'https://www.alanranger.com/#business';
  const a = { '@type': ['Organization', 'LocalBusiness'], '@id': id };
  const b = { '@type': 'Organization', '@id': id };
  assert.equal(duplicateTypesCheck(POST, [a, b]).status, 'pass');
});

test('A6: same @id with a different @type is a conflict', () => {
  const id = 'https://www.alanranger.com/#person';
  const a = { '@type': 'Person', '@id': id };
  const b = { '@type': 'Organization', '@id': id };
  assert.equal(duplicateTypesCheck(POST, [a, b]).status, 'fault');
});

test('B1: noindex respects intentional policy; money page noindex is red', () => {
  const m = { robots: 'noindex, follow' };
  assert.equal(noindexCheck(ACADEMY, 'money', m, {}, { intentionalNoindex: true }).status, 'pass');
  assert.equal(noindexCheck(ACADEMY, 'money', m, {}, {}).severity, 'red');
  assert.equal(noindexCheck(ACADEMY, 'money', { robots: '' }, { xRobots: 'noindex' }, {}).status, 'fault');
});

test('B2: canonical must point at the page (www/slash normalised)', () => {
  assert.equal(canonicalCheck(`${ACADEMY}/`, { canonical: ACADEMY }).status, 'pass');
  assert.equal(canonicalCheck(ACADEMY, { canonical: 'https://www.alanranger.com/photography-academy' }).status, 'fault');
});

test('B4: redirect to a JPG faults; self and planned redirects do not', () => {
  const lee = 'https://www.alanranger.com/blog-on-photography/lee-filter-15-percent-off';
  assert.equal(statusFault(lee, { status: 301, location: 'https://static1.squarespace.com/x/lee-filters-discount.jpg' }, {}).check, 'B4');
  assert.equal(statusFault(ACADEMY, { status: 301, location: `${ACADEMY}/` }, {}), null);
  const old = 'https://www.alanranger.com/one-day-landscape-photography-workshops';
  assert.equal(statusFault(old, { status: 301, location: 'https://www.alanranger.com/landscape-photography-workshops' }, { redirectTarget: '/landscape-photography-workshops' }), null);
  assert.equal(statusFault(POST, { status: 404 }, {}).title, 'Returns 404');
});

test('C1: a block that stops rendering, or an empty section loader, faults', () => {
  const m = { blockClasses: ['ar-hero-wrap'], blocks: {}, unfilledLoaders: [] };
  assert.equal(blocksCheck(ACADEMY, 'money', m, ['ar-hero-wrap', 'ar-rev-wrap']).status, 'fault');
  assert.equal(blocksCheck(ACADEMY, 'money', m, null).status, 'pass');
  assert.equal(blocksCheck(ACADEMY, 'money', { ...m, unfilledLoaders: ['/author-profile'] }, null).status, 'fault');
});

test('C2 + C3: Squarespace error text faults; third-party console noise is dropped', () => {
  assert.equal(errorTextCheck(ACADEMY, { bodyText: 'This block contains embedded code that has been disabled' }).status, 'fault');
  const errs = siteCodeErrors([
    'Cannot create a badge hook in this page! | Error at https://assets.squarespace.com/universal/x.js',
    'Failed to execute loadSproutProductBadge on sprout-api.thegoodapi.com | mobileElement is not defined',
    "Cannot read properties of null (reading 'addEventListener') | TypeError at <anonymous>:1:78"
  ]);
  assert.deepEqual(errs, ["Cannot read properties of null (reading 'addEventListener')"]);
});

test('runPageChecks: a 404 is a B4 fault only (no render needed)', () => {
  const out = runPageChecks({ url: POST, pageType: 'blog', prefetch: { status: 404 }, render: null, policy: {} });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].check, 'B4');
});

test('parseJsonLd flattens @graph and counts bad blocks', () => {
  const { nodes, parseErrors } = parseJsonLd([JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'FAQPage' }] }), '{bad']);
  assert.equal(parseErrors, 1);
  assert.equal(nodes.filter((n) => n['@type']).length, 2);
});

test('plan: full 06 list every run (no 25% blog rotation)', () => {
  const blogs = Array.from({ length: 40 }, (_, i) => `https://www.alanranger.com/blog-on-photography/post-${i}`);
  const urls = [ACADEMY, 'https://www.alanranger.com/photography-courses-coventry', ...blogs];
  const { items } = buildPlan(urls, '2026-10-26');
  assert.ok(items.some((i) => i.u === ACADEMY));
  assert.equal(items.filter((i) => i.t === 'blog').length, blogs.length);
  assert.equal(items.length, urls.length);
  assert.notEqual(rotationSlot('2026-10-26'), rotationSlot('2026-11-02'));
  assert.equal(pageTypeOf(ACADEMY), 'money');
  assert.equal(pageTypeOf(POST), 'blog');
});

test('policyFor: prefix intentional_noindex and retired redirects', () => {
  const rows = [
    { url_or_prefix: '/beginners-photography-lessons', match_type: 'prefix', policy: 'intentional_noindex' },
    { url_or_prefix: '/one-day-landscape-photography-workshops', match_type: 'exact', policy: 'retired_redirect', redirect_target: '/landscape-photography-workshops' }
  ];
  assert.equal(policyFor('https://www.alanranger.com/beginners-photography-lessons/camera-course-x', rows).intentionalNoindex, true);
  assert.equal(policyFor('https://www.alanranger.com/one-day-landscape-photography-workshops', rows).redirectTarget, '/landscape-photography-workshops');
});

test('brief line: nothing when no red faults; names pages when red', () => {
  assert.equal(renderSilentFaultsLine({ red_count: 0, top_red: [] }), '');
  const html = renderSilentFaultsLine({ red_count: 4, top_red: [{ page: 'uk-bluebell-photography-guide', title: 'No page_entities row (blog)' }] });
  assert.match(html, /Traditional SEO: 4 red/);
  assert.match(html, /uk-bluebell-photography-guide/);
  assert.match(html, /\+3 more/);
});

test('D5 source CSV parsing reads the URL column and normalises', () => {
  const csv = 'Title,Url Id,Full Url\n"A, b",a,https://www.alanranger.com/blog-on-photography/a/\nB,b,/blog-on-photography/b\n';
  assert.deepEqual(urlsFromCsv(csv, 'Full Url'), ['alanranger.com/blog-on-photography/a', 'alanranger.com/blog-on-photography/b']);
});

test('tool-run-report rows are capped and typed', () => {
  const row = buildRow({ tool: 'schema-tools', items_processed: '12', supabase_errors: -3, failed: ['https://x', { url: 'https://y', reason: 'z' }], summary: { a: 1 } });
  assert.equal(row.items_processed, 12);
  assert.equal(row.supabase_errors, 0);
  assert.deepEqual(row.failed, [{ url: 'https://x', reason: 'failed' }, { url: 'https://y', reason: 'z' }]);
});

test('fault keys normalise URLs', () => {
  assert.equal(faultKey('A1', `${POST}/`), faultKey('A1', POST.replace('www.', '')));
});
