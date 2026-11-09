/**
 * YouTube Shorts as shared content records (question 2026-11-09 (f)) on synthetic fixtures: time never marks a video
 * Public, only YouTube does; a restriction gives Needs attention (Waiting only when Alan must act); a failed read keeps
 * the last state; the email guard; one record per video with its uses (YouTube + the email module, each its own status).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortCheck, videoStatus } from '../lib/marketing/delivery-status.mjs';
import { contentView, isoSeconds, mmss, normaliseVideo, readShortsStatus, shortRecord, videoIdOf } from '../lib/marketing/delivery-content.mjs';

const T = (iso) => Date.parse(iso);
const ITEM = { key: 'check-whole-frame', title: 'Check the Whole Frame | A Quick Photography Composition Tip', url: 'https://youtube.com/shorts/GHVCQAm7r-w', date: '2026-11-10T18:00:00Z', email: '2026-11-19', duration: '0:24', state: 'scheduled', timezone: 'Europe/London', format: 'short_video', email_link_state: 'proposed mapping, not yet inserted', confirmation: 'YouTube Video scheduled dialog' };
const SCHEDULED = { video_id: 'GHVCQAm7r-w', read_at: '2026-11-09T11:50:00Z', error: null, privacy: 'private', publish_at: '2026-11-10T18:00:00Z', upload_status: 'processed', processing_status: 'succeeded', duration: '0:24', region_blocked: [], age_restricted: false, embeddable: true };
const rec = (state) => ({ asset_key: 'video|short|check-whole-frame', title: ITEM.title, url: ITEM.url, release_at: ITEM.date, duration: '0:24', provider_state: state });

test('time passing never marks a Short Public: after 18:00 it is "checking" until YouTube reports it public', () => {
  assert.equal(videoStatus(rec(SCHEDULED), { now: T('2026-11-09T12:00:00Z') }).code, 'scheduled');
  const due = videoStatus(rec(SCHEDULED), { now: T('2026-11-10T18:20:00Z') });
  assert.equal(due.code, 'checking');
  assert.notEqual(videoStatus(rec(SCHEDULED), { now: T('2026-11-20T18:00:00Z') }).code, 'published', 'ten days later, still not Public without YouTube saying so');
  const late = videoStatus(rec({ ...SCHEDULED, read_at: '2026-11-10T19:30:00Z' }), { now: T('2026-11-10T19:31:00Z') });
  assert.deepEqual([late.code, /still reported it private/.test(late.evidence)], ['late', true]);
  const pub = videoStatus(rec({ ...SCHEDULED, read_at: '2026-11-10T18:12:00Z', privacy: 'public', publish_at: null, public_at: '2026-11-10T18:00:03Z' }), { now: T('2026-11-10T18:15:00Z') });
  assert.deepEqual([pub.code, pub.label, pub.tone, pub.at, pub.link], ['published', 'Public', 'green', '2026-11-10T18:00:03Z', ITEM.url]);
});

test('before the first collector read, GPT\'s Studio confirmation shows as Scheduled (operator-verified)', () => {
  const s = videoStatus(rec(null), { now: T('2026-11-09T11:00:00Z') });
  assert.deepEqual([s.code, /operator-verified \(GPT, YouTube Studio\)/.test(s.evidence)], ['scheduled', true]);
});

test('a restriction from YouTube = Needs attention; Waiting (needs_alan) only for a rejection / block', () => {
  const claim = rec({ ...SCHEDULED, upload_status: 'rejected', rejection_reason: 'copyright' });
  const s = videoStatus(claim, { now: T('2026-11-09T12:00:00Z') });
  assert.deepEqual([s.code, s.tone, s.blocker], ['needs_attention', 'amber', 'rejected by YouTube (copyright)']);
  const asset = { asset_key: 'a', format: 'short_video', title: 't', url: ITEM.url, uses: [{ channel: 'youtube', planned_at: ITEM.date }], provider_state: claim.provider_state };
  assert.equal(contentView([asset], new Map(), { now: T('2026-11-09T12:00:00Z') }).content[0].needs_alan, true);
  const age = { ...asset, provider_state: { ...SCHEDULED, age_restricted: true } };
  const v = contentView([age], new Map(), { now: T('2026-11-09T12:00:00Z') }).content[0];
  assert.deepEqual([v.status.code, v.needs_alan], ['needs_attention', false], 'an age limit is shown, not put in Alan\'s queue');
});

test('a failed read keeps the last state (scheduled), and after the release says verification unavailable', () => {
  const failed = { ...SCHEDULED, error: 'quota exceeded', error_at: '2026-11-10T18:10:00Z' };
  assert.equal(videoStatus(rec(failed), { now: T('2026-11-09T12:00:00Z') }).code, 'scheduled');
  const s = videoStatus(rec(failed), { now: T('2026-11-10T18:15:00Z') });
  assert.deepEqual([s.code, s.last_verified.code], ['verification_unavailable', 'scheduled']);
});

test('email guard: "Short not public yet ⚠" before release, "Short public ✓" once YouTube says public', () => {
  const before = shortCheck(rec(SCHEDULED), videoStatus(rec(SCHEDULED), { now: T('2026-11-09T12:00:00Z') }));
  assert.deepEqual([before.public, before.label, before.status, before.title, before.duration], [false, 'Short not public yet ⚠', 'scheduled', ITEM.title, '0:24']);
  const pubRec = rec({ ...SCHEDULED, privacy: 'public', public_at: '2026-11-10T18:00:03Z', read_at: '2026-11-10T18:12:00Z' });
  const after = shortCheck(pubRec, videoStatus(pubRec, { now: T('2026-11-10T18:15:00Z') }));
  assert.deepEqual([after.public, after.label], [true, 'Short public ✓']);
});

test('one content record per video: format Short video / reel, its own purpose, uses = YouTube + the email module', () => {
  const row = shortRecord(ITEM, { campaign_key: 'theme|gpt-8w-2026-11-19' }, null, 'test', '2026-11-09T12:00:00Z');
  assert.deepEqual([row.kind, row.format, row.purpose, row.status], ['video', 'short_video', 'educate', 'existing']);
  assert.deepEqual(row.uses.map((u) => [u.channel, u.ref]), [['youtube', 'youtube|GHVCQAm7r-w'], ['email', 'send|theme|gpt-8w-2026-11-19']]);
  assert.equal(row.uses[1].module_state, 'proposed', '"proposed mapping, not yet inserted" is not shown as inserted');
  assert.deepEqual(row.used_in, ['youtube|GHVCQAm7r-w', 'send|theme|gpt-8w-2026-11-19']);
  const again = shortRecord(ITEM, { campaign_key: 'theme|gpt-8w-2026-11-19' }, { purpose: 'nurture', purpose_source: 'set', history: [{ at: 'x' }] }, 'test', '2026-11-09T13:00:00Z');
  assert.deepEqual([again.purpose, again.history.length], ['nurture', 2], 'a purpose set by hand is kept; history appended');
  assert.equal(shortRecord({ ...ITEM, key: 'z' }, null, null, 't', 'n').uses.length, 1, 'no email day = YouTube use only; no social uses invented');
});

test('each use keeps its own status: the email module is the email\'s own Draft, not YouTube\'s Scheduled', () => {
  const asset = { asset_key: 'video|short|check-whole-frame', format: 'short_video', title: ITEM.title, url: ITEM.url, uses: shortRecord(ITEM, { campaign_key: 'theme|gpt-8w-2026-11-19' }, null, 't', 'n').uses, provider_state: SCHEDULED };
  const email = { key: 'theme|gpt-8w-2026-11-19', campaign_key: 'theme|gpt-8w-2026-11-19', title: 'Small details', status: { code: 'in_preparation', label: 'In preparation' } };
  const v = contentView([asset], new Map([[email.campaign_key, email]]), { now: T('2026-11-09T12:00:00Z') });
  const c = v.content[0];
  assert.deepEqual([c.format_label, c.status.code, c.uses[0].status.code, c.uses[1].status.code], ['Short video / reel', 'scheduled', 'scheduled', 'in_preparation']);
  assert.deepEqual(v.shortsByEmail.get(email.campaign_key)[0].label, 'Short not public yet ⚠');
});

test('YouTube read: normalised from videos.list; a failed read keeps the last good state with the error', async () => {
  const item = { id: 'GHVCQAm7r-w', snippet: { publishedAt: '2026-11-09T11:28:02Z' }, status: { uploadStatus: 'processed', privacyStatus: 'private', publishAt: '2026-11-10T18:00:00Z', embeddable: true }, processingDetails: { processingStatus: 'succeeded' }, contentDetails: { duration: 'PT24S', contentRating: {} } };
  const s = normaliseVideo(item, '2026-11-09T12:00:00Z');
  assert.deepEqual([s.privacy, s.publish_at, s.public_at, s.duration, s.duration_s], ['private', '2026-11-10T18:00:00Z', null, '0:24', 24]);
  assert.deepEqual([isoSeconds('PT2M40S'), mmss(61), videoIdOf('https://youtube.com/shorts/lDj8aE0jOhM')], [160, '1:01', 'lDj8aE0jOhM']);
  const saved = [];
  const sb = {
    from: () => ({
      select: () => ({ eq: () => ({ not: () => ({ limit: async () => ({ data: [{ asset_key: 'a', format: 'short_video', url: ITEM.url, provider_state: SCHEDULED }], error: null }) }) }) }),
      update: (patch) => ({ eq: () => ({ eq: async () => { saved.push(patch.provider_state); return { error: null }; } }) })
    })
  };
  const bad = await readShortsStatus(sb, { now: T('2026-11-10T18:10:00Z'), token: 't', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'quotaExceeded' } }) }) });
  assert.deepEqual([bad.ok, saved[0].privacy, saved[0].read_at, saved[0].error], [false, 'private', SCHEDULED.read_at, 'quotaExceeded'], 'last state kept, error recorded, nothing zeroed');
  const good = await readShortsStatus(sb, { now: T('2026-11-10T18:12:00Z'), token: 't', fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{ ...item, status: { ...item.status, privacyStatus: 'public' }, snippet: { publishedAt: '2026-11-10T18:00:03Z' } }] }) }) });
  assert.deepEqual([good.ok, saved[1].privacy, saved[1].public_at], [true, 'public', '2026-11-10T18:00:03Z']);
});
