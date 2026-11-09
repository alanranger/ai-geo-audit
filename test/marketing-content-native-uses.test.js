/**
 * Native Facebook / Instagram uses on a content record (GPT added them to the negative-space-woodland Short for the
 * 4 Dec and 2 Jan feed posts): each shows its placement's authoritative status and its own platform link, never
 * "In preparation" with the video's YouTube link. Display only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { contentView, nativeUse } from '../lib/marketing/delivery-content.mjs';

const YT = 'https://youtube.com/shorts/NP4sBbrdf08';
const QUEUE = 'https://business.facebook.com/latest/posts/scheduled_posts?asset_id=1';
const SCHED = { code: 'scheduled', label: 'Scheduled on platform', icon: '🕒', tone: 'blue', when: 'Facebook Fri 4 Dec 6:30pm', link: QUEUE };
const WINDOW = { code: 'waiting_window', label: 'Ready, waiting for Meta\'s window', icon: '⏳', tone: 'neutral', when: 'schedule from Sat 5 Dec 6:30pm' };
const PLACEMENTS = [
  { step_key: 'gpt-8w-social-2026-12-04-fbig', title: 'Choose your January course', placement: 'facebook_feed', status: SCHED },
  { step_key: 'gpt-8w-social-2026-12-04-fbig', title: 'Choose your January course', placement: 'instagram_feed', status: { ...SCHED, when: 'Instagram Fri 4 Dec 6:30pm' } },
  { step_key: 'gpt-8w-social-2027-01-02-fbig', title: 'Make time for winter photography', placement: 'facebook_feed', status: WINDOW },
  { step_key: 'gpt-8w-social-2027-01-02-fbig', title: 'Make time for winter photography', placement: 'instagram_feed', status: WINDOW }
];
const use = (channel, step, placement, day) => ({ use_key: `${channel}|${step}`, ref: step, channel, step_key: step, placement, planned_at: `${day}T18:30:00Z`, link: YT, module_state: 'inserted', note: 'Film exercise and title saved in existing scheduled post' });
const ASSET = {
  asset_key: 'video|short|negative-space-woodland', format: 'short_video', title: 'How Much Negative Space?', url: YT, purpose: 'educate', note: 'YouTube Short 1:07',
  provider_state: { read_at: '2026-11-09T19:07:35Z', privacy: 'private', publish_at: '2026-11-19T18:00:00Z', upload_status: 'processed', processing_status: 'succeeded' },
  uses: [
    { use_key: 'youtube', channel: 'youtube', ref: 'youtube|NP4sBbrdf08', planned_at: '2026-11-19T18:00:00Z', link: YT },
    use('facebook', 'gpt-8w-social-2026-12-04-fbig', 'facebook_feed', '2026-12-04'), use('instagram', 'gpt-8w-social-2026-12-04-fbig', 'instagram_feed', '2026-12-04'),
    use('facebook', 'gpt-8w-social-2027-01-02-fbig', 'facebook_feed', '2027-01-02'), use('instagram', 'gpt-8w-social-2027-01-02-fbig', 'instagram_feed', '2027-01-02')
  ]
};

test('native use: the named placement\'s status and its own link; the YouTube link kept apart', () => {
  const u = nativeUse(ASSET.uses[1], PLACEMENTS);
  assert.deepEqual([u.status.code, u.status.label, u.link, u.video_link, u.title, u.placements], ['scheduled', 'Scheduled on platform', QUEUE, YT, 'Choose your January course', ['facebook_feed']]);
  const later = nativeUse(ASSET.uses[3], PLACEMENTS);
  assert.deepEqual([later.status.code, later.link], ['waiting_window', null], 'not scheduled yet: its real status, no link invented');
});

test('contentView: every native use reads its placement (4 Dec scheduled, 2 Jan waiting for the window); YouTube use unchanged', () => {
  const { content } = contentView([ASSET], new Map(), { now: Date.parse('2026-11-09T20:00:00Z'), placements: PLACEMENTS });
  const by = Object.fromEntries(content[0].uses.map((u) => [u.use_key, u]));
  assert.equal(by['facebook|gpt-8w-social-2026-12-04-fbig'].status.code, 'scheduled');
  assert.equal(by['instagram|gpt-8w-social-2026-12-04-fbig'].status.when, 'Instagram Fri 4 Dec 6:30pm');
  assert.equal(by['facebook|gpt-8w-social-2027-01-02-fbig'].status.code, 'waiting_window');
  assert.equal(by.youtube.status.code, 'scheduled');
  assert.equal(by.youtube.link, YT);
});

test('content record panel: native rows show "Scheduled on platform" and "Open in Meta", never "In preparation" + "Open on YouTube"', () => {
  const win = {};
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } }, Intl, Date, Number, String, Map, Set, JSON, Math, Array, Object, RegExp, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-schedule-list.js', import.meta.url), 'utf8'), ctx);
  const { content } = contentView([ASSET], new Map(), { now: Date.parse('2026-11-09T20:00:00Z'), placements: PLACEMENTS });
  const html = win.mkScheduleList.contentHtml(content[0]);
  const row = (key) => (html.match(new RegExp(`<tr data-mkl-use="${key.replace(/\|/g, '\\|')}">[\\s\\S]*?</tr>`)) || [''])[0];
  const fb = row('facebook|gpt-8w-social-2026-12-04-fbig');
  assert.match(fb, /🕒<\/i>Scheduled on platform/);
  assert.match(fb, new RegExp(`href="${QUEUE.replace(/[?.]/g, '\\$&')}"[^>]*>Open in Meta`));
  assert.ok(!/Open on YouTube|In preparation/.test(fb));
  assert.match(row('instagram|gpt-8w-social-2027-01-02-fbig'), /Ready, waiting for Meta&#39;s window|Ready, waiting for Meta's window/);
  assert.ok(!/Open on YouTube/.test(row('instagram|gpt-8w-social-2027-01-02-fbig')));
  assert.match(row('youtube'), /Open on YouTube/, 'the YouTube release keeps its own link');
  const stale = win.mkScheduleList.contentHtml({ ...content[0], uses: [{ ...content[0].uses[1], link: YT }] });
  assert.ok(!/Open on YouTube|Open in Meta/.test(stale), 'a YouTube URL is never shown as the post\'s platform link');
});
