/**
 * The 8th Short (question 2026-11-09 (t) add-negative-space-short) on synthetic fixtures: associated uses on EXISTING
 * social placements take that placement's own status (no extra post); the YouTube use shows its evidence label and
 * UTM; the other Shorts' records render as before; the YouTube row carries every Short including Thu 19 Nov 18:00.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { associatedUse, contentView } from '../lib/marketing/delivery-content.mjs';

const T = (iso) => Date.parse(iso);
const URL_NS = 'https://youtube.com/shorts/NP4sBbrdf08';
const EVIDENCE = 'production chat\'s native YouTube scheduling confirmation (9 Nov 2026); not separately re-verified by GPT';
const UTM = 'utm_source=youtube&utm_medium=short&utm_campaign=negative-space-woodland';
const SCHEDULED = { video_id: 'NP4sBbrdf08', read_at: '2026-11-09T19:07:35Z', error: null, privacy: 'private', publish_at: '2026-11-19T18:00:00Z', upload_status: 'processed', processing_status: 'succeeded', duration: '1:07', region_blocked: [], age_restricted: false };
const scheduledSt = { code: 'scheduled', label: 'Scheduled', icon: '🕒', tone: 'blue' };
const previewSt = { code: 'in_preparation', label: 'In preparation', icon: '📄', tone: 'grey' };
const PLACEMENTS = [
  { step_key: 'gpt-8w-social-2026-11-20-fbig', title: 'From small details to winter landscapes', placement: 'facebook_feed', status: scheduledSt },
  { step_key: 'gpt-8w-social-2026-11-20-fbig', title: 'From small details to winter landscapes', placement: 'instagram_story', status: scheduledSt },
  { step_key: 'gpt-8w-social-2027-01-02-fbig', title: 'Make time for winter photography', placement: 'facebook_feed', status: previewSt },
  { step_key: 'gpt-8w-social-2027-01-02-fbig', title: 'Make time for winter photography', placement: 'instagram_feed', status: previewSt },
  { step_key: 'gpt-8w-social-2027-01-02-fbig', title: 'Make time for winter photography', placement: 'instagram_story', status: previewSt }
];
const STORY_USE = { use_key: 'social|gpt-8w-social-2026-11-20-fbig', channel: 'social', role: 'associated', ref: 'gpt-8w-social-2026-11-20-fbig', step_key: 'gpt-8w-social-2026-11-20-fbig', placement: 'instagram_story', planned_at: '2026-11-20T18:30:00Z', module_state: 'proposed', note: 'Woodland / winter window' };
const ASSET = {
  asset_key: 'video|short|negative-space-woodland', format: 'short_video', title: 'How Much Negative Space? | Woodland Photography Composition', url: URL_NS, purpose: 'educate',
  note: 'YouTube Short 1:07 · release 2026-11-19T18:00:00Z', provider_state: SCHEDULED,
  uses: [
    { use_key: 'youtube', channel: 'youtube', ref: 'youtube|NP4sBbrdf08', planned_at: '2026-11-19T18:00:00Z', link: URL_NS, evidence: EVIDENCE, utm: UTM },
    STORY_USE,
    { use_key: 'social|gpt-8w-social-2027-01-02-fbig', channel: 'social', role: 'associated', ref: 'gpt-8w-social-2027-01-02-fbig', step_key: 'gpt-8w-social-2027-01-02-fbig', placement: null, planned_at: '2027-01-02T18:30:00Z' }
  ]
};

test('associated use: the placement\'s own status and step title; only the named placement (the 20 Nov Story, not the Macro feed)', () => {
  const u = associatedUse(STORY_USE, PLACEMENTS);
  assert.deepEqual([u.title, u.status.code, u.placements], ['From small details to winter landscapes', 'scheduled', ['instagram_story']]);
  const step = associatedUse({ channel: 'social', ref: 'gpt-8w-social-2027-01-02-fbig' }, PLACEMENTS);
  assert.deepEqual([step.step_key, step.placements.length, step.status.code], ['gpt-8w-social-2027-01-02-fbig', 3, 'in_preparation'], 'no placement = every placement of the step; ref works as the step key');
  const storyFirst = [{ ...PLACEMENTS[4], status: { code: 'story_ready' } }, PLACEMENTS[3], PLACEMENTS[2]];
  const ordered = associatedUse({ channel: 'social', ref: 'gpt-8w-social-2027-01-02-fbig' }, storyFirst);
  assert.deepEqual([ordered.placements, ordered.status.code], [['facebook_feed', 'instagram_feed', 'instagram_story'], 'in_preparation'], 'feed first: a Story\'s own status never stands in for the post');
  const gone = associatedUse({ channel: 'social', ref: 'missing' }, PLACEMENTS);
  assert.deepEqual([gone.status, gone.placements], [null, []], 'an unknown step is shown as not found, never invented');
});

test('contentView: YouTube use = the video status; associated uses = their placements\' statuses; no email guard from social uses', () => {
  const v = contentView([ASSET], new Map(), { now: T('2026-11-09T20:00:00Z'), placements: PLACEMENTS });
  const c = v.content[0];
  assert.deepEqual([c.status.code, c.release_at, c.duration], ['scheduled', '2026-11-19T18:00:00Z', '1:07']);
  assert.deepEqual(c.uses.map((u) => [u.channel, u.status?.code]), [['youtube', 'scheduled'], ['social', 'scheduled'], ['social', 'in_preparation']]);
  assert.equal(v.shortsByEmail.size, 0);
  assert.equal(contentView([ASSET], new Map(), { now: T('2026-11-09T20:00:00Z') }).content[0].uses[1].status, null, 'no placements given = no status, not a guess');
});

function loadList() {
  const win = { localStorage: { getItem: () => null, setItem: () => {} } };
  const document = { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}), head: { appendChild: () => {}, insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, encodeURIComponent, setTimeout, MutationObserver: class { observe() {} } });
  for (const f of ['../lib/marketing-schedule-model.js', '../lib/marketing-schedule-list.js', '../lib/marketing-schedule.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  return win;
}

test('content record: evidence label + UTM on the YouTube use; each woodland use as "Associated with an existing post"', () => {
  const win = loadList();
  const c = contentView([ASSET], new Map(), { now: T('2026-11-09T20:00:00Z'), placements: PLACEMENTS }).content[0];
  const html = win.mkScheduleList.contentHtml(c);
  assert.match(html, /Uses \(3\)/);
  assert.match(html, /Open on YouTube<\/a><small>evidence: production chat's native YouTube scheduling confirmation \(9 Nov 2026\); not separately re-verified by GPT<\/small>/);
  assert.match(html, /<small>UTM utm_source=youtube&amp;utm_medium=short&amp;utm_campaign=negative-space-woodland<\/small>/);
  assert.match(html, /data-mkl-use="social\|gpt-8w-social-2026-11-20-fbig"><td>Associated with an existing post<\/td><td><span class="mkl-st mkl-sch"><i>🕒<\/i>Scheduled<\/span><\/td><td>Fri 20 Nov 18:30<\/td><td>From small details to winter landscapes<small>Instagram Story · associated asset, no extra post<\/small>/);
  assert.match(html, /Make time for winter photography<small>Facebook feed · Instagram feed · Instagram Story · associated asset, no extra post/);
  assert.match(html, /Native Facebook \/ Instagram \/ LinkedIn uses: none planned or approved yet/, 'associated uses are not native video uploads');
});

test('a Short with no evidence / UTM fields renders its YouTube use exactly as before', () => {
  const win = loadList();
  const plain = { ...ASSET, uses: [{ use_key: 'youtube', channel: 'youtube', ref: 'youtube|x', planned_at: '2026-11-10T18:00:00Z', link: 'https://youtube.com/shorts/x', note: 'YouTube Video scheduled dialog' }] };
  const html = win.mkScheduleList.contentHtml(contentView([plain], new Map(), { now: T('2026-11-09T20:00:00Z') }).content[0]);
  assert.match(html, /<td><a href="https:\/\/youtube.com\/shorts\/x" target="_blank" rel="noopener">Open on YouTube<\/a><\/td><\/tr>/);
});

test('YouTube row: 8 Shorts, the 8th on Thu 19 Nov at 18:00 (the record\'s own release, not a schedule row)', () => {
  const win = loadList();
  const seven = ['2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22'].map((d, i) => ({ asset_key: `video|short|s${i}`, title: `S${i}`, format: 'short_video', url: `https://youtube.com/shorts/v${i}`, status: scheduledSt, uses: [{ use_key: 'youtube', channel: 'youtube', planned_at: `${d}T18:00:00Z`, status: scheduledSt }] }));
  const ns = contentView([ASSET], new Map(), { now: T('2026-11-09T20:00:00Z'), placements: PLACEMENTS }).content[0];
  const m = win.mkScheduleModel.build({ items: [], content: [...seven, ns], today: '2026-11-09' });
  const yt = m.items.filter((x) => x.row === 'youtube');
  assert.equal(yt.length, 8);
  const x = yt.find((i) => i.key === 'video|short|negative-space-woodland');
  assert.deepEqual([x.day, x.time, x.state], ['2026-11-19', '18:00', 'sch']);
  assert.equal(m.items.filter((i) => i.row !== 'youtube').length, 0, 'associated uses add no social / email schedule rows');
});
