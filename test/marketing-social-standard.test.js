/**
 * AR-social-v1 (QUESTION-2026-11-08 social standard integration, Part A): the renderer (byte-identical to GPT's
 * masters, photo embedded unchanged), the event facts record and facts check, the Facebook caption-link quota,
 * separate placements (never inferred from each other), generated social rows hidden under GPT's manual rows, and
 * proposals for event dates no social row covers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { FORMATS, embeddedImages, missingFor, renderSvg } from '../lib/social-standard/template.mjs';
import { courseChains, factsRecord, fbLinkQuota, liveOf } from '../lib/social-standard/facts.mjs';

const FIX = new URL('./fixtures/social-template/', import.meta.url);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const NORFOLK = JSON.parse(fs.readFileSync(new URL('norfolk.json', FIX), 'utf8'));
const PHOTO = { bytes: fs.readFileSync(new URL('norfolk-social-photo.jpg', FIX)), mime: 'image/jpeg' };
const GPT_MASTER_SHA = {
  feed: 'b99af2036ff7f33f4101db6c9b62081f7a17857298b2daad2d3036adc3b72584',
  story: 'e4775530ec37226284735b49e520cbf29f08863ef903088935217bfef6c83041',
  linkedin: '7e86e6de31bedbbb2a23005adbf409722c25c49a24ec30973af0eafcea5cba63'
};

test('renderer: Norfolk JSON → feed / Story / LinkedIn masters byte-identical to GPT\'s, photo embedded once and unchanged', () => {
  for (const [format, dims] of Object.entries(FORMATS)) {
    const svg = renderSvg(NORFOLK, PHOTO, format);
    assert.match(svg, new RegExp(`width="${dims.width}" height="${dims.height}"`));
    assert.equal(sha(svg), GPT_MASTER_SHA[format], `${format}: same bytes as GPT's rendered master`);
    const imgs = embeddedImages(svg);
    assert.equal(imgs.length, 1, 'one continuous image object');
    assert.equal(sha(imgs[0].bytes), sha(PHOTO.bytes), 'embedded bytes = original photo');
    assert.match(svg, /preserveAspectRatio="xMidYMid meet"/, 'no crop, no stretch');
  }
  assert.deepEqual([FORMATS.feed, FORMATS.story, FORMATS.linkedin].map((f) => `${f.width}×${f.height}`), ['1080×1350', '1080×1920', '1200×1500']);
});

test('renderer: missing facts are listed, never invented', () => {
  assert.deepEqual(missingFor({ ...NORFOLK, subtitle: '', bookingUrl: 'http://x' }), ['subtitle', 'bookingUrl (verified HTTPS public booking URL)']);
  assert.throws(() => renderSvg({ ...NORFOLK, location: null }, PHOTO, 'feed'), /Missing required event facts: location/);
});

const COURSES = [
  { date: '2027-01-13', title: 'Camera Courses For Beginners - Week 1 of 3 - Coventry- 13-1', url: '/beginners-photography-lessons/camera-courses-for-beginners-coventry-bds4t' },
  { date: '2027-01-20', title: 'Camera Courses For Beginners - Week 2 of 3 - Coventry 20-1', url: '/beginners-photography-lessons/camera-courses-for-beginners-coventry-2sj27' },
  { date: '2027-01-27', title: 'Camera Courses For Beginners - Week 3 of 3 - Coventry 27-1', url: '/beginners-photography-lessons/camera-courses-for-beginners-week-1' },
  { date: '2027-01-12', title: 'Lightroom Classic Photo Editing Classes -Week 1 of 3 -12-1', url: '/beginners-photography-lessons/lightroom-photo-editing-classes-wk1-xx94r' },
  { date: '2027-01-19', title: 'Lightroom Classic Photo Editing Classes -Week 2 of 3 -19-1', url: '/lr-2' }
];
const row = (over) => ({ event_id: 'x', event_date: '2027-01-13', event_url: '/beginners-photography-lessons/camera-courses-for-beginners-coventry-bds4t', booking_url: 'https://www.alanranger.com/photography-courses-coventry', display_title: 'Beginners', outcome: 'o', location_text: 'Coventry', inclusions: 'i', photo_path: 'p.jpg', price_claims: [], template: 'AR-social-v1', ...over });
const LIVE = liveOf({ title: 'Camera Courses For Beginners - Week 1 of 3', startDate: Date.parse('2027-01-13T19:00:00Z'), endDate: Date.parse('2027-01-13T21:00:00Z'), body: '£150 · Only 3 available', fullUrl: '/x' }, '2026-11-08T18:00:00Z');

test('facts: a course series keeps its first session apart from later sessions; 27 Jan is never a start and its "week-1" URL is flagged', () => {
  const { chains, flags } = courseChains(COURSES);
  const rec = factsRecord(row({}), LIVE, null, chains, '2026-11-08');
  assert.deepEqual([rec.series.first.date, rec.series.later.map((x) => x.date)], ['2027-01-13', ['2027-01-20', '2027-01-27']]);
  assert.equal(rec.dates_text, '13, 20 & 27 January 2027');
  assert.equal(rec.start_time, '19:00', 'event time, not the posting time');
  assert.equal(rec.ready, true);
  assert.equal(flags.length, 1);
  assert.match(flags[0].text, /27 Jan 2027 is session 3 of the 13 Jan course but its URL says week 1/);
  const thu = factsRecord(row({ event_id: 'beginners-2027-01-28', event_date: '2027-01-28', event_url: '/beginners-photography-lessons/camera-courses-for-beginners-coventry-2k99k' }), { found: false, checked_at: 't', error: 'event page 404' }, null, chains, '2026-11-08');
  assert.ok(thu.contradictions.some((t) => /2027-01-28: not found in the website course feed/.test(t)), '28 Jan start on hold until the series is reconciled');
  assert.ok(thu.missing.includes('event dates with year'));
});

test('facts: Lake District price, live page vs snapshot vs earlier change, is listed as contradictory and not chosen', () => {
  const lake = row({ event_id: 'lake-district-2027-01-22', event_date: '2027-01-22', event_url: '/photographic-workshops-near-me/lake-district-photography-workshop-winter', price_claims: [{ gbp: 1075, source: 'booking snapshot price' }, { gbp: 1195, source: 'earlier strategy change' }] });
  const live = liveOf({ title: 'Lake District', startDate: Date.parse('2027-01-22T09:30:00Z'), endDate: Date.parse('2027-01-24T14:30:00Z'), body: '£1,075 · Only 2 available' }, 't');
  const rec = factsRecord(lake, live, null, [], '2026-11-08');
  assert.equal(rec.price.live, 1075);
  assert.equal(rec.dates_text, '22–24 January 2027');
  assert.match(rec.contradictions[0], /live page £1,075 · booking snapshot price £1,075 · earlier strategy change £1,195\. These differ: not chosen/);
  assert.equal(rec.ready, false);
});

test('facts: offer code must match the approved offer; an ended offer stops reminders; don\'t-promote is flagged', () => {
  const rec = factsRecord(row({ event_url: '/w', code: 'NORFOLK150' }), LIVE, { offer_code: 'OTHER', offer_ends: '2026-11-01', promote_mode: 'dont_promote' }, [], '2026-11-08');
  assert.ok(rec.contradictions.some((t) => /facts say NORFOLK150, the approved offer says OTHER/.test(t)));
  assert.ok(rec.contradictions.some((t) => /Offer ended 2026-11-01/.test(t)));
  assert.ok(rec.contradictions.some((t) => /don't promote/.test(t)));
});

test('Facebook caption-link quota: counted from our own evidence when Meta exposes none', () => {
  const q = fbLinkQuota([], [{ tick_key: 'a|fb', set_at: '2026-11-08T16:35:00Z', reason: 'Facebook external-link monthly allowance exhausted; link-free CTA used' }], '2026-11-08');
  assert.deepEqual([q.used, q.limit, q.exhausted], [2, 2, true]);
  assert.match(q.basis, /own evidence/);
  assert.deepEqual([fbLinkQuota([{ placement: 'facebook_feed', link_in_caption: true, actual_at: '2026-11-03T10:00:00Z' }], [], '2026-11-08').used, fbLinkQuota([], [], '2026-12-01').used], [1, 0]);
});

/* ---------- browser: placements, de-duplication, proposals ---------- */

function browser() {
  const win = {};
  const ctx = vm.createContext({ window: win, document: undefined, Date, Map, Set, JSON, Math, String, Number, Array, Object, Intl, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/social-standard/schedule-social.js', import.meta.url), 'utf8'), ctx);
  return win;
}
const STEP = { key: 'gpt-8w-social-2026-11-13-fbig', channel: 'Facebook + Instagram', day: '2026-11-13', featured: [{ url: 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk', date: '2026-11-13' }], brief: 'DRAFT — Alan to review. Proposed 2026-11-13 18:30 GMT. Purpose Sell.\n\nIf you have been thinking about the North Norfolk coast, use NORFOLK150.\n\nhttps://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk\n\nAsset: Own existing photo.\n\nEVENT CARD COVERAGE — AR-social-v1\nNorfolk coastal workshop: 20–22 November 2026. Near Cromer.\nSource/booking URL to verify: https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk' };
const LI = { key: 'gpt-event-2026-11-09-norfolk-li', channel: 'LinkedIn', day: '2026-11-09', featured: [{ url: 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk' }], brief: 'DRAFT — planned Monday 9 November 2026, 08:30 GMT.\n\nNorfolk text https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk' };
const FACT = { event_id: 'norfolk-2026-11-20', event_date: '2026-11-20', booking_url: 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk', event_url: 'https://www.alanranger.com/photographic-workshops-near-me/norfolk-photography-workshop', missing: [], contradictions: [], ready: true };
const S = (ticks) => ({ campaign: { weeks: [{ week: '2026-11-09', steps: [STEP, LI] }], carried: {}, ticks, moments: [] } });

test('placements: FB feed, IG feed, IG Story and LinkedIn each read only their own evidence', () => {
  const SS = browser().SocialStandard;
  const ticks = { [`${STEP.key}|fb`]: { is_ticked: true, status: 'done', set_at: '2026-11-13T18:40:00Z', set_by: 'Alan via GPT', reason: 'Facebook published' } };
  const c = SS.context(S(ticks), { facts: [FACT], placements: [], quota: null });
  const p = SS.placementsOf({ row: 'fbig', step_key: STEP.key, day: '2026-11-13' }, c);
  assert.deepEqual(JSON.parse(JSON.stringify(p.map((x) => [x.placement, x.stage]))), [['facebook_feed', 'published'], ['instagram_feed', 'factual_review'], ['instagram_story', 'factual_review']], 'Facebook done does not make Instagram done');
  assert.equal(p[1].in_app, true, 'planned in app');
  const withIg = SS.context(S({ ...ticks, [`${STEP.key}|ig`]: { is_ticked: true, status: 'done', set_at: 't', reason: 'IG feed https://www.instagram.com/p/abc/', history: [{ at: 't2', by: 'Alan via GPT', action: 'instagram_caption_url_and_linked_story_published', evidence: 'Your story has been published' }] } }), { facts: [FACT], placements: [] });
  const q = SS.placementsOf({ row: 'fbig', step_key: STEP.key, day: '2026-11-13' }, withIg);
  assert.deepEqual([q[1].stage, q[1].provider_url, q[2].stage, q[2].source], ['published', 'https://www.instagram.com/p/abc/', 'published', 'Story evidence on the Instagram tick']);
  const noStory = SS.context(S({ [`${STEP.key}|ig`]: { is_ticked: true, status: 'done', set_at: 't', reason: 'feed only', history: [] } }), { facts: [FACT], placements: [] });
  assert.equal(SS.placementsOf({ row: 'fbig', step_key: STEP.key, day: '2026-11-13' }, noStory)[2].stage, 'factual_review', 'IG feed done does not make the Story done');
});

test('placements: "scheduled" needs a provider id or URL; without one it shows as a platform draft', () => {
  const SS = browser().SocialStandard;
  const rows = [{ step_key: LI.key, placement: 'linkedin_feed', stage: 'scheduled', provider_id: null, provider_url: null, evidence: [] }];
  const p = SS.placementsOf({ row: 'linkedin', step_key: LI.key, day: '2026-11-09' }, SS.context(S({}), { facts: [FACT], placements: rows }));
  assert.equal(p[0].stage, 'platform_draft');
  const ok = SS.placementsOf({ row: 'linkedin', step_key: LI.key, day: '2026-11-09' }, SS.context(S({}), { facts: [FACT], placements: [{ ...rows[0], provider_id: 'urn:li:share:1' }] }));
  assert.deepEqual([ok[0].stage, ok[0].stage_label], ['scheduled', 'scheduled on platform']);
});

test('social panel: facts joined from the record, final caption, per-placement links, readiness and the link quota', () => {
  const SS = browser().SocialStandard;
  const quota = { used: 2, limit: 2, exhausted: true, month: '2026-11', basis: 'counted from our own evidence' };
  const p = SS.panelFor({ row: 'fbig', step_key: STEP.key, day: '2026-11-13' }, SS.context(S({}), { facts: [FACT], placements: [], quota }));
  assert.equal(p.facts[0].event_id, 'norfolk-2026-11-20');
  assert.match(p.caption, /^If you have been thinking about the North Norfolk coast/);
  assert.equal(p.proposed_at, '2026-11-13 18:30');
  assert.deepEqual(JSON.parse(JSON.stringify(p.coverage)), ['Norfolk coastal workshop']);
  assert.equal(p.links.facebook_first_comment, FACT.booking_url);
  assert.equal(p.links.instagram_written_in_caption, true);
  assert.deepEqual(JSON.parse(JSON.stringify(p.readiness.map((r) => [r.label, r.ok]))), [['planned time stored', false], ['explicit purpose stored', false], ['event facts complete', true], ['no contradictory facts', true], ['final caption drafted', true], ['rendered preview', false], ['Facebook caption link available', false]]);
});

test('item 5: planned time and purpose come from stored fields only; without them the delivery says "needs time / purpose"', () => {
  const SS = browser().SocialStandard;
  const x = { row: 'linkedin', step_key: LI.key, day: '2026-11-09' };
  const bare = SS.panelFor(x, SS.context(S({}), { facts: [FACT], placements: [] }));
  assert.equal(bare.plan, null, 'the 08:30 in the brief text is not parsed at display time');
  assert.deepEqual(JSON.parse(JSON.stringify(bare.readiness.slice(0, 2).map((r) => [r.label, r.ok]))), [['planned time stored', false], ['explicit purpose stored', false]]);
  const qp = { initiatives: { a: { deliveries: [{ key: LI.key, purpose: { primary: 'sell', secondary: ['inspire'] }, purpose_source: 'set' }] } } };
  const rows = [{ step_key: LI.key, placement: 'linkedin_feed', stage: null, planned_at: '2026-11-09T08:30:00+00:00', planned_tz: 'Europe/London', plan_source: 'GPT brief: "planned Monday 9 November 2026, 08:30 GMT"', assets: {}, evidence: [] }];
  const full = SS.panelFor(x, SS.context({ ...S({}), quarter_plan: qp }, { facts: [FACT], placements: rows }));
  assert.deepEqual(JSON.parse(JSON.stringify([full.plan.planned_at, full.purpose])), ['2026-11-09T08:30:00+00:00', { primary: 'sell', secondary: ['inspire'], source: 'stored' }]);
  assert.equal(full.placements[0].stage, 'factual_review', 'a row with only a planned time records no stage: the stage is still derived');
  const rule = SS.purposeOf(LI.key, { quarter_plan: { initiatives: { a: { deliveries: [{ key: LI.key, purpose: { primary: 'sell', secondary: ['educate'] }, purpose_source: 'rule' }] } } } });
  assert.equal(rule.source, 'rule', 'a channel rule is never shown as stored');
});

test('item 5: one definition of purpose sources for both tabs (stored = explicit tag, rule = channel default; drafts apart)', async () => {
  const { purposeMix } = await import('../lib/strategy-initiatives.mjs');
  const d = (draft, source) => ({ draft, purpose: { primary: 'sell', secondary: [] }, purpose_source: source, modules: [] });
  const m = purposeMix([d(false, 'set'), d(false, 'rule'), d(false, 'rule'), d(true, 'set'), d(true, 'rule')], { from: 'a', to: 'b' });
  assert.equal(m.source_text, 'purpose source: scheduled / approved 1 stored · 2 channel rule; drafts 1 stored · 1 channel rule (stored = explicit tag, rule = channel default)');
});

test('generated social rows on a slot GPT already fills are hidden (not counted), the manual row stays', () => {
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, head: { insertAdjacentHTML: () => {} } }, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-schedule-model.js', import.meta.url), 'utf8'), ctx);
  const item = (key, title) => ({ channel: 'linkedin', key: `${key}|linkedin`, title, planned: '2026-11-11', status: 'prep', step: title });
  const m = win.mkScheduleModel.build({ items: [item('step|2026-11-09|LinkedIn|2026-11-11', 'Post: Lightroom course starts'), item('gpt-8w-social-2026-11-11-li', 'Give your photography a direction')], today: '2026-11-08' });
  const [gen, gpt] = m.items;
  assert.deepEqual([gen.state, gpt.state === 'resolved'], ['resolved', false]);
  assert.deepEqual(JSON.parse(JSON.stringify(gpt.suggested)), ['Generated plan: Post: Lightroom course starts']);
});

test('new event dates: stages proposed at the observed lead times on existing slots, only where no social row covers the event', () => {
  const SS = browser().SocialStandard;
  const ev = (d, url) => ({ date: d, url, title: url, event_key: `${d}|${url}`, promote_mode: 'normal' });
  const s = { ...S({}), campaign: { ...S({}).campaign, moments: [
    { label: 'Announce', week: '2026-11-16', event: ev('2027-03-22', '/kenilworth') },
    { label: 'Main push', week: '2026-12-21', event: ev('2027-03-22', '/kenilworth') },
    { label: 'Last places', week: '2026-11-09', event: ev('2026-11-20', '/photo-workshops-uk/landscape-photography-workshop-norfolk') }
  ] } };
  const props = SS.proposals(s, SS.context(s, { facts: [FACT], placements: [], checks: [] }), '2026-11-08');
  assert.equal(props.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(props[0].stages)), [{ stage: 'Announce', week: '2026-11-16', fbig: '2026-11-17', linkedin: '2026-11-18' }, { stage: 'Main push', week: '2026-12-21', fbig: '2026-12-22', linkedin: '2026-12-23' }]);
});
