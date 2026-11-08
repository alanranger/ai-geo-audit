/**
 * Social channel tiles + Meta connect button (questions 2026-11-08 build-social-channel-tiles-and-recent-posts and
 * meta-connect-button-oauth), on an in-memory store and a mocked Meta Graph API:
 * not connected = "Not connected" + nothing collected; the OAuth callback stores the Page token encrypted and the
 * token never appears in a response or a log; status shows Connected and the collector runs; Disconnect removes the
 * token row only; the LinkedIn manual entry writes one row; YouTube / Google Business tiles match their tables.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeHandler } from '../api/aigeo/social.js';
import { makeCallbackHandler } from '../api/aigeo/social-oauth-callback.js';
import { decryptToken, hashState } from '../lib/social/crypto.mjs';
import { READ_SCOPES } from '../lib/social/meta.mjs';
import { keepGood } from '../lib/social/collect.mjs';
import { gbpTile, vsChannelAvg, youtubeTile, youtubeVs, ga4Visits, compare, windowCoverage, pointCompare, sameAgeVs } from '../lib/social/summary.mjs';
import { evidencedRows, igCode } from '../lib/social/evidence.mjs';
import { linkedinPostId } from '../lib/social/linkedin.mjs';

const ADMIN = 'test-admin-key';
process.env.ARP_ADMIN_KEY = ADMIN;
process.env.CRON_SECRET = 'test-cron';
const ENV = { META_APP_ID: '1234567890', META_APP_SECRET: 'app-secret-value', SOCIAL_TOKEN_KEY: crypto.randomBytes(32).toString('base64') };
const NOW = Date.parse('2026-11-08T16:30:00Z');
const DAY = 864e5;
const SECRETS = ['PAGE-TOKEN-SECRET-123', 'LONG-USER-TOKEN-xyz', 'SHORT-USER-TOKEN-abc', 'app-secret-value'];

/* ---------- in-memory store with the same interface as lib/social/repo.mjs ---------- */

function memRepo(seed = {}) {
  const t = { social_connections: [], social_oauth_states: [], social_account_daily: [], social_posts: [], social_post_snapshots: [], ...structuredClone(seed.tables || {}) };
  const writes = [];
  const upsert = (table, keyOf) => async (rows) => {
    for (const r of rows) {
      const i = t[table].findIndex((x) => keyOf(x) === keyOf(r));
      if (i >= 0) t[table][i] = { ...t[table][i], ...r }; else t[table].push({ ...r });
      writes.push(table);
    }
  };
  const strip = (c) => { if (!c) return null; const { token_encrypted: _t, ...rest } = c; return rest; };
  return {
    t, writes,
    getConnection: async () => (t.social_connections[0] ? { ...t.social_connections[0] } : null),
    getConnectionStatus: async () => strip(t.social_connections[0]),
    saveConnection: async (row) => { t.social_connections = [{ ...row, channel: 'meta' }]; writes.push('social_connections'); },
    updateConnection: async (patch) => { if (t.social_connections[0]) Object.assign(t.social_connections[0], patch); },
    deleteConnection: async () => { const n = t.social_connections.length; t.social_connections = []; writes.push('social_connections:delete'); return n; },
    createState: async (state_hash, expires_at) => { t.social_oauth_states.push({ state_hash, expires_at, used_at: null }); },
    consumeState: async (h, nowIso) => {
      const s = t.social_oauth_states.find((x) => x.state_hash === h && !x.used_at && x.expires_at > nowIso);
      if (s) s.used_at = nowIso;
      return !!s;
    },
    readDaily: async (ch, since) => t.social_account_daily.filter((r) => ch.includes(r.channel) && r.date >= since),
    readPosts: async (ch, since) => t.social_posts.filter((r) => ch.includes(r.channel) && r.posted_at >= since).sort((a, b) => b.posted_at.localeCompare(a.posted_at)),
    upsertDaily: upsert('social_account_daily', (r) => `${r.channel}|${r.date}`),
    upsertPosts: upsert('social_posts', (r) => `${r.channel}|${r.post_id}`),
    readYoutube: async () => seed.youtube || { channel: [], videos: [] },
    readGbpMonths: async () => seed.gbp || [],
    upsertSnapshots: upsert('social_post_snapshots', (r) => `${r.channel}|${r.post_id}|${r.captured_date}`),
    readSnapshots: async (ch, since) => t.social_post_snapshots.filter((r) => ch.includes(r.channel) && r.captured_date >= since),
    readEvidence: async (since) => (seed.ticks || []).filter((x) => x.set_at >= since),
    readSteps: async (keys) => (seed.steps || []).filter((s) => keys.includes(s.step_key)),
    readDeliveryPurposes: async (keys) => (seed.tags || []).filter((s) => keys.includes(s.ref_key)),
    ga4Days: async (from, to) => (seed.ga4Days || []).filter((d) => d >= from && d <= to),
    readGa4Social: async () => seed.ga4 || [],
    ga4LatestDate: async () => seed.ga4Latest || null
  };
}

/* ---------- mocked Graph API ---------- */

const day = (n) => new Date(NOW - n * DAY).toISOString().replace(/\.\d+Z$/, '+0000');
function metaFetch({ failInsights = false, tokenDead = false, granted = READ_SCOPES } = {}) {
  const calls = [];
  const routes = [
    [/oauth\/access_token$/, (q) => ({ access_token: q.get('code') ? 'SHORT-USER-TOKEN-abc' : 'LONG-USER-TOKEN-xyz', expires_in: 5184000 })],
    [/me\/permissions$/, () => ({ data: [...granted, 'public_profile'].map((permission) => ({ permission, status: 'granted' })) })],
    [/me\/accounts$/, () => ({ data: [{ id: '111', name: 'Alan Ranger Photography', access_token: 'PAGE-TOKEN-SECRET-123', instagram_business_account: { id: '999', username: 'alanrangerphoto' } }] })],
    [/debug_token$/, () => ({ data: { is_valid: !tokenDead, expires_at: 0, data_access_expires_at: Math.floor((NOW + 90 * DAY) / 1000) } })],
    [/\/111$/, () => ({ followers_count: 1240 })],
    [/\/111\/insights$/, () => ({ data: [{ name: 'page_impressions_unique', values: [{ value: 140, end_time: day(1) }, { value: 150, end_time: day(0) }] }, { name: 'page_impressions', values: [{ value: 300, end_time: day(0) }] }] })],
    [/\/111\/posts$/, () => ({ data: [{ id: '111_1', created_time: day(2), message: 'Last 2 places Norfolk\nmore text', permalink_url: 'https://fb/1', shares: { count: 2 }, reactions: { summary: { total_count: 24 } }, comments: { summary: { total_count: 5 } } }, { id: '111_2', created_time: day(5), message: 'Norfolk carousel', reactions: { summary: { total_count: 19 } }, comments: { summary: { total_count: 4 } } }] })],
    [/\/111_\d\/insights$/, (q, path) => (failInsights ? { error: { code: 100, message: 'Invalid metric' } } : { data: [{ name: 'post_impressions_unique', values: [{ value: path.endsWith('111_1/insights') ? 410 : 380 }] }, { name: 'post_impressions', values: [{ value: 500 }] }] })],
    [/\/999$/, () => ({ username: 'alanrangerphoto', followers_count: 2180, media_count: 300 })],
    [/\/999\/insights$/, () => ({ data: [{ name: 'reach', values: [{ value: 90, end_time: day(0) }] }] })],
    [/\/999\/media$/, () => ({ data: [{ id: 'm1', caption: 'Last 2 places Norfolk', timestamp: day(2), permalink: 'https://ig/1', media_type: 'IMAGE', like_count: 31, comments_count: 2 }] })],
    [/\/m1\/insights$/, () => ({ data: [{ name: 'reach', values: [{ value: 280 }] }, { name: 'saved', values: [{ value: 1 }] }, { name: 'shares', values: [{ value: 0 }] }] })]
  ];
  const impl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    if (tokenDead && !/oauth|debug_token/.test(u.pathname)) return { ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'Session has expired' } }) };
    const hit = routes.find(([re]) => re.test(u.pathname));
    const body = hit ? hit[1](u.searchParams, u.pathname) : { error: { code: 803, message: 'unknown' } };
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { impl, calls };
}

/* ---------- harness ---------- */

function fakeRes() {
  return { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } };
}
function harness(repo, { env = ENV, fetchMock = metaFetch() } = {}) {
  const runs = [];
  const deps = { repo: () => repo, env, fetchImpl: fetchMock.impl, now: () => NOW, gbpStatus: async () => null, runLog: { start: async (job) => { runs.push({ job }); return runs.length; }, finish: async (id, p) => Object.assign(runs[id - 1], p) } };
  const api = makeHandler(deps);
  const cb = makeCallbackHandler(deps);
  const call = async (method, query, body, headers = { 'x-arp-admin-key': ADMIN }) => {
    const res = fakeRes();
    await api({ method, query, body, headers }, res);
    return { status: res.statusCode, json: JSON.parse(res.body || '{}'), raw: res.body };
  };
  const callback = async (query) => { const res = fakeRes(); await cb({ method: 'GET', query, headers: {} }, res); return res; };
  return { call, callback, runs, fetchMock };
}
async function captureLogs(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { return { out: await fn(), lines }; } finally { Object.assign(console, orig); }
}
const tile = (summary, key) => summary.channels.find((c) => c.key === key);
const noSecrets = (text, label) => { for (const s of SECRETS) assert.ok(!String(text).includes(s), `${label} contains a secret`); };

async function connect(h) {
  const start = await h.call('POST', {}, { action: 'connect-start' });
  const state = new URL(start.json.url).searchParams.get('state');
  return { start, res: await h.callback({ code: 'auth-code', state }) };
}

/* ---------- tests ---------- */

test('not connected: Facebook and Instagram say "Not connected" plus what is needed, and nothing is collected', async () => {
  const repo = memRepo();
  const h = harness(repo);
  const s = (await h.call('GET', { action: 'summary' })).json;
  for (const key of ['facebook', 'instagram']) {
    const t = tile(s, key);
    assert.equal(t.state, 'not_connected');
    assert.match(t.needs, /Connect Facebook & Instagram/);
    assert.equal(t.headline, undefined, 'no headline number without data');
  }
  const r = await h.call('POST', {}, { action: 'collect' });
  assert.equal(r.json.skipped, 'not_connected');
  assert.equal(h.fetchMock.calls.length, 0, 'no call to Meta');
  assert.deepEqual(repo.writes, [], 'nothing written');
  assert.equal(h.runs[0].status, 'skipped');
  const missing = harness(memRepo(), { env: {} });
  const s2 = (await missing.call('GET', { action: 'summary' })).json;
  assert.equal(tile(s2, 'facebook').state, 'not_configured');
  assert.match(tile(s2, 'facebook').needs, /META_APP_ID, META_APP_SECRET, SOCIAL_TOKEN_KEY/);
  assert.equal((await missing.call('POST', {}, { action: 'connect-start' })).json.error, 'not_configured');
});

test('connect-start: admin key only, read-only scopes, one-use state stored as a hash', async () => {
  const repo = memRepo();
  const h = harness(repo);
  assert.equal((await h.call('POST', {}, { action: 'connect-start' }, {})).status, 401);
  assert.equal((await h.call('POST', {}, { action: 'connect-start' }, { authorization: 'Bearer test-cron' })).status, 401, 'cron may only collect');
  const { json } = await h.call('POST', {}, { action: 'connect-start' });
  const u = new URL(json.url);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://ai-geo-audit.vercel.app/api/aigeo/social-oauth-callback');
  assert.deepEqual(u.searchParams.get('scope').split(','), READ_SCOPES);
  assert.ok(!/publish|manage_posts|messag|ads_|pages_manage/.test(u.searchParams.get('scope')));
  const state = u.searchParams.get('state');
  assert.equal(repo.t.social_oauth_states[0].state_hash, hashState(state));
  assert.ok(!JSON.stringify(repo.t.social_oauth_states).includes(state), 'raw state never stored');
  const biz = (await h.call('POST', {}, { action: 'connect-start', with_business: true })).json.url;
  assert.match(new URL(biz).searchParams.get('scope'), /business_management$/);
});

test('OAuth callback (mocked): Page token stored encrypted, never in a response or log; status Connected; collector runs', async () => {
  const repo = memRepo();
  const h = harness(repo);
  const { out, lines } = await captureLogs(async () => {
    const { res } = await connect(h);
    const status = (await h.call('GET', { action: 'status' })).raw;
    const collected = await h.call('POST', {}, { action: 'collect' });
    const summary = (await h.call('GET', { action: 'summary' })).raw;
    return { res, status, collected, summary };
  });
  assert.equal(out.res.statusCode, 302);
  assert.equal(out.res.headers.location, '/audit-dashboard.html?social_connect=ok#marketing');
  const row = repo.t.social_connections[0];
  assert.equal(row.page_id, '111');
  assert.equal(row.ig_user_id, '999');
  assert.ok(!row.token_encrypted.includes('PAGE-TOKEN'), 'stored encrypted');
  assert.equal(decryptToken(row.token_encrypted, ENV), 'PAGE-TOKEN-SECRET-123', 'decrypts with SOCIAL_TOKEN_KEY');
  assert.ok(!JSON.stringify(row).includes('LONG-USER-TOKEN'), 'the user token is not stored');
  const status = JSON.parse(out.status).connection;
  assert.deepEqual([status.state, status.page_name, status.ig_username], ['connected', 'Alan Ranger Photography', 'alanrangerphoto']);
  assert.equal(out.collected.json.ok, true);
  assert.equal(out.collected.json.results.length, 5);
  assert.ok(repo.t.social_posts.length === 3 && repo.t.social_account_daily.length >= 3);
  const s = JSON.parse(out.summary);
  assert.equal(tile(s, 'facebook').state, 'live');
  assert.equal(tile(s, 'facebook').headline.value, 1240);
  assert.equal(tile(s, 'instagram').headline.value, 2180);
  assert.equal(tile(s, 'facebook').latest.title, 'Last 2 places Norfolk');
  for (const [label, text] of [['callback Location', out.res.headers.location], ['callback body', out.res.body], ['status', out.status], ['collect', out.collected.raw], ['summary', out.summary], ['logs', lines.join('\n')]]) noSecrets(text, label);
  assert.ok(!out.summary.includes(row.token_encrypted) && !out.status.includes('token_encrypted'), 'encrypted token never returned either');
  assert.ok(h.fetchMock.calls.every((p) => !/feed$|photos$|media_publish|messages|conversations|adaccounts/.test(p)), 'read-only Graph calls only');
});

test('callback refuses a bad or replayed state, a declined login and extra permissions, storing nothing', async () => {
  const repo = memRepo();
  const h = harness(repo);
  assert.match((await h.callback({ code: 'x', state: 'forged' })).headers.location, /reason=state_invalid/);
  assert.match((await h.callback({ error: 'access_denied', state: 'x' })).headers.location, /reason=declined/);
  const { start, res } = await connect(h);
  assert.match(res.headers.location, /social_connect=ok/);
  const replay = await h.callback({ code: 'again', state: new URL(start.json.url).searchParams.get('state') });
  assert.match(replay.headers.location, /reason=state_invalid/, 'a state works once');
  const repo2 = memRepo();
  const h2 = harness(repo2, { fetchMock: metaFetch({ granted: [...READ_SCOPES, 'pages_manage_posts'] }) });
  assert.match((await connect(h2)).res.headers.location, /reason=extra_permissions/);
  assert.equal(repo2.t.social_connections.length, 0);
});

test('Disconnect removes the token row only; collected figures stay', async () => {
  const repo = memRepo();
  const h = harness(repo);
  await connect(h);
  await h.call('POST', {}, { action: 'collect' });
  const before = { daily: repo.t.social_account_daily.length, posts: repo.t.social_posts.length };
  const r = await h.call('POST', {}, { action: 'disconnect' });
  assert.deepEqual([r.json.ok, r.json.removed], [true, 1]);
  assert.equal(repo.t.social_connections.length, 0);
  assert.deepEqual({ daily: repo.t.social_account_daily.length, posts: repo.t.social_posts.length }, before);
  const s = (await h.call('GET', { action: 'summary' })).json;
  assert.equal(tile(s, 'facebook').state, 'stale', 'old figures still shown, labelled');
  assert.equal(s.connection.state, 'not_connected');
});

test('a failed read never overwrites good data; a rejected token marks the connection expired and writes nothing', async () => {
  const repo = memRepo();
  const h = harness(repo);
  await connect(h);
  await h.call('POST', {}, { action: 'collect' });
  assert.equal(repo.t.social_posts.find((p) => p.post_id === '111_1').reach, 410);
  const h2 = harness(repo, { fetchMock: metaFetch({ failInsights: true }) });
  await h2.call('POST', {}, { action: 'collect', step: 'facebook_posts' });
  assert.equal(repo.t.social_posts.find((p) => p.post_id === '111_1').reach, 410, 'kept when the insight read failed');
  const writesBefore = repo.writes.length;
  const h3 = harness(repo, { fetchMock: metaFetch({ tokenDead: true }) });
  const r = await h3.call('POST', {}, { action: 'collect' });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.results.length, 1, 'stopped at the health check');
  assert.equal(repo.t.social_connections[0].status, 'expired');
  assert.equal(repo.writes.length, writesBefore, 'nothing written');
  assert.deepEqual(keepGood([{ k: 1, a: 5, b: 2 }], [{ k: 1, a: null, b: 3 }], (x) => x.k, ['a', 'b']), [{ k: 1, a: 5, b: 3 }]);
});

test('LinkedIn manual entry writes one row (source manual) and nothing else; the tile goes amber after 10 days', async () => {
  const repo = memRepo();
  const h = harness(repo);
  assert.equal(tile((await h.call('GET', { action: 'summary' })).json, 'linkedin').state, 'not_entered');
  assert.equal((await h.call('POST', {}, { action: 'linkedin-entry', week_ending: '2026-11-08', followers: 3050 }, {})).status, 401);
  const bad = await h.call('POST', {}, { action: 'linkedin-entry', week_ending: '2026-11-08', followers: -3 });
  assert.equal(bad.status, 400);
  assert.deepEqual(repo.writes, []);
  const r = await h.call('POST', {}, { action: 'linkedin-entry', week_ending: '2026-11-08', followers: 3050, impressions_7d: 1400, reactions: 30, comments: 4, reposts: 1 });
  assert.deepEqual([r.json.ok, r.json.daily_rows, r.json.post_rows], [true, 1, 0]);
  assert.deepEqual(repo.writes, ['social_account_daily'], 'exactly one row, one table');
  assert.deepEqual([repo.t.social_account_daily[0].source, repo.t.social_account_daily[0].period_days, repo.t.social_account_daily[0].channel], ['manual', 7, 'linkedin']);
  const t = tile((await h.call('GET', { action: 'summary' })).json, 'linkedin');
  assert.equal(t.state, 'manual');
  assert.match(t.source.text, /^manual · last entered 2026-11-08$/);
  assert.equal(t.headline.value, 3050);
  const later = makeHandler({ repo: () => repo, env: ENV, fetchImpl: null, now: () => NOW + 11 * DAY, gbpStatus: async () => null, runLog: { start: async () => null, finish: async () => {} } });
  const res = fakeRes();
  await later({ method: 'GET', query: { action: 'summary' }, headers: { 'x-arp-admin-key': ADMIN } }, res);
  assert.equal(tile(JSON.parse(res.body), 'linkedin').state, 'manual_stale');
});

test('YouTube and Google Business tiles match their tables; GA4 visits by source; viewing writes nothing', async () => {
  const yt = {
    channel: [
      { captured_date: '2026-11-08', subscribers: 356, total_videos: 49, views_window: 4401, impressions_ctr_window: '2.9662899949212798', watch_time_minutes_window: 12318, created_at: '2026-11-08T07:55:52Z' },
      { captured_date: '2026-10-11', subscribers: 286, total_videos: 46, views_window: 6459, impressions_ctr_window: '2.1', watch_time_minutes_window: 14816, created_at: '2026-10-11T07:55:51Z' }
    ],
    videos: [
      { video_id: 'sWIDyUVp260', title: 'How to Find Your Photography Style (Without Choosing One)', published_at: '2026-10-29T11:22:19Z', views: 187, likes: 2, comments: 0 },
      { video_id: 'AIG_P5A1cSk', title: 'Why Your Photos Have No Story', published_at: '2026-10-16T14:17:07Z', views: 301, likes: 7, comments: 6 }
    ]
  };
  const gbp = [
    { month: '2026-11-01', impressions_search_mobile: 145, impressions_search_desktop: 0, impressions_maps_mobile: 0, impressions_maps_desktop: 0, interactions: 11, website_clicks: 3, direction_requests: 8, call_clicks: 0 },
    { month: '2026-10-01', impressions_search_mobile: 1000, impressions_search_desktop: 161, impressions_maps_mobile: 100, impressions_maps_desktop: 0, interactions: 106, website_clicks: 43, direction_requests: 58, call_clicks: 5 },
    { month: '2026-09-01', impressions_search_mobile: 1307, impressions_search_desktop: 0, impressions_maps_mobile: 0, impressions_maps_desktop: 0, interactions: 85, website_clicks: 40, direction_requests: 43, call_clicks: 2 }
  ];
  const ga4 = [{ date: '2026-11-05', source: 'm.facebook.com', medium: 'referral', sessions: 10 }, { date: '2026-11-01', source: 'facebook.com', medium: 'referral', sessions: 14 }, { date: '2026-10-01', source: 'facebook.com', medium: 'referral', sessions: 19 }, { date: '2026-11-06', source: 'youtube.com', medium: 'referral', sessions: 28 }, { date: '2026-11-02', source: 'ig', medium: 'social', sessions: 3 }];
  const ga4Days = Array.from({ length: 56 }, (_, i) => new Date(Date.parse('2026-11-07T00:00:00Z') - i * DAY).toISOString().slice(0, 10));
  const repo = memRepo({ youtube: yt, gbp, ga4, ga4Latest: '2026-11-07', ga4Days });
  const h = harness(repo);
  const s = (await h.call('GET', { action: 'summary' })).json;
  const y = tile(s, 'youtube');
  assert.deepEqual([y.headline.value, y.headline.delta.abs, y.headline.delta.pct, y.headline.delta.dir], [356, 70, 24.48, 'up']);
  assert.deepEqual(y.rows.slice(0, 3).map((r) => r.value), [4401, 205, 3]);
  assert.equal(y.latest.title, 'How to Find Your Photography Style (Without Choosing One)');
  assert.match(y.latest.line, /187 views/);
  const g = tile(s, 'gbp');
  assert.deepEqual([g.headline.value, g.headline.unit, g.headline.delta.pct, g.headline.delta.dir], [1261, 'views (Oct)', -3.52, 'down']);
  assert.deepEqual([g.rows[0].value, g.rows[1].value], [106, 43]);
  assert.match(g.rows.find((r) => /to date/.test(r.label)).label, /^Nov to date$/);
  assert.equal(g.rows.find((r) => /Reviews/.test(r.label)).text, '—', 'no reviews feed → dash, never 0');
  assert.match(g.rows.find((r) => /GA4/.test(r.label)).note, /not tagged/);
  const fb = tile(s, 'facebook').rows.find((r) => /GA4/.test(r.label));
  assert.deepEqual([fb.value, fb.delta.abs], [24, 5]);
  assert.equal(tile(s, 'youtube').rows.find((r) => /GA4/.test(r.label)).value, 28);
  assert.deepEqual(repo.writes, [], 'viewing writes nothing');
  assert.deepEqual(s.posts.map((p) => p.channel), ['youtube', 'youtube']);
  assert.equal(ga4Visits([], null).facebook, null, 'no GA4 read → no figure');
  assert.equal(youtubeTile({ channel: [], videos: [] }, ga4Visits([], null)).state, 'no_data');
  assert.equal(gbpTile([], null, ga4Visits([], null), '2026-11-08').state, 'no_data');
});

test('"vs channel avg" compares a post only with its own channel', () => {
  const p = (channel, reach, d) => ({ channel, reach, posted_at: new Date(NOW - d * DAY).toISOString() });
  const fb = [p('facebook', 100, 1), p('facebook', 50, 5), p('facebook', 50, 9)];
  const yt = [p('youtube', 5000, 3)];
  assert.deepEqual(vsChannelAvg(fb[0], fb), { pct: 50, badge: 'above', avg: 67, n: 3 });
  assert.equal(vsChannelAvg(fb[0], [...fb, ...yt].filter((x) => x.channel === 'facebook')).pct, 50);
  assert.equal(vsChannelAvg(yt[0], yt), null, 'one post → no average yet');
});

test('YouTube "vs channel avg" compares views at the same age (daily snapshots), not views to date', () => {
  const v = (id, pub, views) => ({ channel: 'youtube', post_id: id, posted_at: `${pub}T11:00:00Z`, reach: views });
  const vids = [v('new', '2026-10-29', 187), v('a', '2026-10-16', 301), v('b', '2026-10-06', 592)];
  const snaps = [{ video_id: 'a', captured_date: '2026-10-26', views: 242 }, { video_id: 'b', captured_date: '2026-10-16', views: 447 }];
  const r = youtubeVs(vids[0], vids, snaps, '2026-11-08');
  assert.deepEqual([r.avg, r.n, r.badge, r.basis], [292, 3, 'below', 'views at 10 days old']);
  assert.equal(r.pct, Math.round(((187 - 292) / 292) * 100));
  assert.equal(youtubeVs(vids[0], vids, [], '2026-11-08'), null, 'no same-age snapshots → no comparison');
});

/* ---------- 8 Nov follow-ups: 90% rule, null-not-0, GPT LinkedIn entry, evidenced posts ---------- */

const days = (n, from, value) => Array.from({ length: n }, (_, i) => ({ channel: 'instagram', date: new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10), reach: value, period_days: 1 }));

test('90% rule: a change only when ≥ 90% of the earlier 28 days have non-null data; otherwise "not comparable yet"', () => {
  const today = '2026-11-08';
  const sparse = [...days(3, '2026-10-09', 30), ...days(28, '2026-10-12', 50)];
  const cov = windowCoverage(sparse, 'reach', today, 28, 56);
  assert.deepEqual([cov.covered, cov.of, cov.ok], [3, 28, false]);
  const nc = compare(1436, 92, cov);
  assert.equal(nc.not_comparable, true);
  assert.match(nc.note, /3 have data \(needs 26\)/);
  const full = [...days(26, '2026-09-14', 3), ...days(28, '2026-10-12', 50)];
  assert.equal(windowCoverage(full, 'reach', today, 28, 56).ok, true, '26 of 28 days = 93%');
  assert.equal(compare(1400, 78, windowCoverage(full, 'reach', today, 28, 56)).dir, 'up');
  const nulls = [...days(28, '2026-09-14', null), ...days(28, '2026-10-12', 50)];
  assert.equal(compare(1400, null, windowCoverage(nulls, 'reach', today, 28, 56)).not_comparable, true, 'null days are not data');
  const weekly = [7, 14, 21, 28].map((d) => ({ date: new Date(Date.parse('2026-10-11T00:00:00Z') - (28 - d) * DAY).toISOString().slice(0, 10), impressions: 100, period_days: 7 }));
  assert.equal(windowCoverage(weekly, 'impressions', today, 28, 56).covered, 28, 'four weekly rows cover the 28 days');
  const f = pointCompare(2180, [{ date: '2026-11-08', followers: 2180 }], 'followers', 'date', '2026-11-08', 3);
  assert.equal(f.not_comparable, true, 'followers first read today → not comparable');
  assert.match(f.note, /first reading 2026-11-08/);
  assert.equal(pointCompare(356, [{ d: '2026-11-08', v: 356 }, { d: '2026-10-10', v: 286 }], 'v', 'd', '2026-11-08', 3).abs, 70, 'a reading within 3 days of 28 days back is comparable');
  const g = ga4Visits([{ date: '2026-11-01', source: 'ig', medium: 'social', sessions: 8 }], '2026-11-07', ['2026-11-01']);
  assert.equal(g.prev_coverage.ok, false);
});

test('null, not 0: a Facebook post without a shares field stores null; the tile never turns missing into 0', async () => {
  const repo = memRepo();
  const h = harness(repo);
  await connect(h);
  await h.call('POST', {}, { action: 'collect' });
  const noShares = repo.t.social_posts.find((p) => p.post_id === '111_2');
  assert.equal(noShares.shares, null, 'Meta omitted shares → null');
  assert.equal(repo.t.social_posts.find((p) => p.post_id === '111_1').shares, 2);
  assert.ok(repo.t.social_post_snapshots.length === 3, 'one same-age snapshot per collected post');
  const s = (await h.call('GET', { action: 'summary' })).json;
  const reach = tile(s, 'instagram').rows.find((r) => /Reach/.test(r.label));
  assert.equal(reach.delta.not_comparable, true, 'only 1–2 days of earlier reach → not comparable yet');
});

const GPT_WEEK = {
  action: 'linkedin-gpt', week_ending: '2026-11-08', followers: 3050, impressions_7d: 1400, reactions: 30, comments: 4, reposts: 1,
  posts: [{ posted_at: '2026-11-08T16:20:00Z', title: 'Lightroom course starts Thu 12 Nov', permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7525230995168509952/', impressions: 920, reactions: 18, comments: 3, reposts: 1 }]
};

test('GPT LinkedIn entry: one week row + its post rows, idempotent by week and permalink; tile says "GPT · entered"', async () => {
  const repo = memRepo();
  const h = harness(repo);
  const r = await h.call('POST', {}, GPT_WEEK);
  assert.deepEqual([r.status, r.json.ok, r.json.source, r.json.daily_rows, r.json.post_rows], [200, true, 'gpt', 1, 1]);
  assert.deepEqual(repo.writes, ['social_account_daily', 'social_posts', 'social_post_snapshots'], 'week row, its post row, that post\'s same-age snapshot');
  assert.equal(repo.t.social_posts[0].post_id, 'li:7525230995168509952');
  assert.deepEqual([repo.t.social_account_daily[0].source, repo.t.social_account_daily[0].entered_by], ['gpt', 'GPT']);
  await h.call('POST', {}, { ...GPT_WEEK, followers: 3055, posts: [{ ...GPT_WEEK.posts[0], impressions: 990, permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:7525230995168509952' }] });
  assert.deepEqual([repo.t.social_account_daily.length, repo.t.social_posts.length, repo.t.social_post_snapshots.length], [1, 1, 1], 'updated, never duplicated');
  assert.deepEqual([repo.t.social_account_daily[0].followers, repo.t.social_posts[0].impressions], [3055, 990]);
  const t = tile((await h.call('GET', { action: 'summary' })).json, 'linkedin');
  assert.match(t.source.text, /^GPT · entered 2026-11-08$/);
  assert.equal(linkedinPostId('https://www.linkedin.com/feed/update/urn:li:share:7525230995168509952?utm=x'), 'li:7525230995168509952');
  assert.equal((await h.call('POST', {}, GPT_WEEK, {})).status, 401, 'admin key required');
});

test('GPT LinkedIn entry: invalid bodies are refused and write nothing', async () => {
  const repo = memRepo();
  const h = harness(repo);
  const bad = [
    [{ ...GPT_WEEK, followers: -1 }, /followers must be a whole number/],
    [{ ...GPT_WEEK, reactions: '12abc' }, /reactions must be a whole number/],
    [{ ...GPT_WEEK, comments: 2.5 }, /comments must be a whole number/],
    [{ ...GPT_WEEK, impressions_7d: 20 }, /impressions must be at least reactions \+ comments/],
    [{ ...GPT_WEEK, posts: [{ ...GPT_WEEK.posts[0], impressions: 10 }] }, /post 1: impressions must be at least/],
    [{ ...GPT_WEEK, posts: [{ ...GPT_WEEK.posts[0], permalink: null }] }, /permalink is required/],
    [{ ...GPT_WEEK, posts: [{ ...GPT_WEEK.posts[0], permalink: 'https://example.com/x' }] }, /linkedin\.com/],
    [{ ...GPT_WEEK, week_ending: '2026-12-01' }, /future/],
    [{ action: 'linkedin-gpt', week_ending: '2026-11-08' }, /at least followers or impressions/],
    [{ ...GPT_WEEK, posts: [GPT_WEEK.posts[0], GPT_WEEK.posts[0]] }, /twice/]
  ];
  for (const [body, re] of bad) {
    const r = await h.call('POST', {}, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match(r.json.error, re);
  }
  assert.deepEqual(repo.writes, [], 'nothing written');
});

test('evidenced posts: joined by permalink (IG shortcode, LinkedIn activity), Facebook by the matched IG caption, Stories stay unknown', () => {
  const at = '2026-11-08T16:35:09Z';
  const ticks = [
    { tick_key: 'step|2026-11-02|Facebook + Instagram|2026-11-06|ig', status: 'done', set_by: 'GPT', set_at: at, reason: 'Norfolk published on Instagram https://www.instagram.com/alanrangerphotography/p/DffMdBLkVlZ/ on 8 Nov.', history: [{ at, action: 'done', evidence: 'Norfolk published on Instagram https://www.instagram.com/alanrangerphotography/p/DffMdBLkVlZ/ on 8 Nov.' }, { at: '2026-11-08T16:53:04Z', action: 'instagram_caption_url_and_linked_story_published', evidence: 'Meta confirmation: Your story has been published.' }] },
    { tick_key: 'step|2026-11-02|Facebook + Instagram|2026-11-06|fb', status: 'done', set_by: 'GPT', set_at: at, reason: 'Norfolk published on Facebook (Your post has been published confirmation).', history: [{ at, action: 'done', evidence: 'Norfolk published on Facebook.' }] },
    { tick_key: 'step|2026-11-02|LinkedIn|2026-11-04', status: 'done', set_by: 'GPT', set_at: '2026-11-08T16:22:20Z', reason: 'Published and verified on LinkedIn: https://www.linkedin.com/feed/update/urn:li:activity:7525230995168509952/', history: [] }
  ];
  const steps = [{ step_key: 'step|2026-11-02|Facebook + Instagram|2026-11-06', channel: 'Facebook + Instagram', step: 'Post: "Last 2 places" for Norfolk 20–22 Nov', featured: [{ title: 'Norfolk' }] }, { step_key: 'step|2026-11-02|LinkedIn|2026-11-04', channel: 'LinkedIn', step: 'Post: Lightroom course starts Thu 12 Nov', featured: [] }];
  const posts = [
    { channel: 'instagram', post_id: '18108', posted_at: '2026-11-08T16:33:11Z', title: 'A few days with your camera, changing coastal light', permalink: 'https://www.instagram.com/p/DffMdBLkVlZ/', reach: 41, source: 'api' },
    { channel: 'facebook', post_id: '1715715080112405', posted_at: '2026-11-08T16:34:33Z', title: 'A few days with your camera, changing coastal light', permalink: 'https://www.facebook.com/x/posts/1715715080112405', reach: 22, source: 'api' },
    { channel: 'facebook', post_id: 'other', posted_at: '2026-11-08T16:33:17Z', title: 'Editing your photographs', reach: 24, source: 'api' }
  ];
  assert.equal(igCode('https://www.instagram.com/alanrangerphotography/p/DffMdBLkVlZ/'), igCode(posts[0].permalink));
  const { rows, replaced } = evidencedRows({ ticks, steps, tags: [], posts });
  const by = (ch, pl) => rows.find((r) => r.channel === ch && r.placement === pl);
  assert.equal(by('instagram', 'feed').post_id, '18108');
  assert.equal(by('instagram', 'feed').reach, 41);
  assert.equal(by('facebook', 'feed').post_id, '1715715080112405', 'Facebook matched through the Instagram caption');
  assert.match(by('facebook', 'feed').match_basis, /first line as the matched Instagram post/);
  const story = by('instagram', 'story');
  assert.deepEqual([story.reach, story.likes, story.comments, story.matched], [null, null, null, false], 'Story figures unknown, never 0');
  const li = by('linkedin', 'feed');
  assert.deepEqual([li.matched, li.reach, li.provider_url], [false, null, 'https://www.linkedin.com/feed/update/urn:li:activity:7525230995168509952/']);
  assert.equal(by('instagram', 'feed').purpose, 'sell', 'purpose by the channel rule when no tag is stored');
  assert.equal(by('instagram', 'feed').purpose_source, 'rule');
  assert.deepEqual([...replaced].sort(), ['facebook|1715715080112405', 'instagram|18108'], 'matched posts are not listed twice');
  const tagged = evidencedRows({ ticks, steps, tags: [{ ref_key: 'step|2026-11-02|LinkedIn|2026-11-04', purpose_primary: 'educate' }], posts });
  assert.deepEqual([tagged.rows.find((r) => r.channel === 'linkedin').purpose, tagged.rows.find((r) => r.channel === 'linkedin').purpose_source], ['educate', 'set']);
});

test('equal-age comparison for Facebook / Instagram / LinkedIn uses the daily post snapshots', () => {
  const p = (id, d, reach) => ({ channel: 'facebook', post_id: id, posted_at: `${d}T10:00:00Z`, reach, source: 'api' });
  const posts = [p('new', '2026-11-08', 22), p('old', '2026-11-01', 300)];
  assert.equal(sameAgeVs(posts[0], posts, [], '2026-11-08'), null, 'no snapshot of the older post at age 0 → no comparison');
  const r = sameAgeVs(posts[0], posts, [{ channel: 'facebook', post_id: 'old', captured_date: '2026-11-01', reach: 20 }], '2026-11-08');
  assert.deepEqual([r.avg, r.n, r.basis], [21, 2, 'reach at 0 days old']);
});
