import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshGoogleAccessToken } from '../lib/google-token.js';

function fakeFetch(replies) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(String(init.body));
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === 'throw') throw new Error('socket hang up');
    return { ok: r.status === 200, status: r.status, json: async () => r.json };
  };
  return { impl, calls };
}

const args = { clientId: 'id', clientSecret: 'sh', refreshToken: 'rt', label: 'youtube', delays: [1, 1] };

test('internal_failure then success: the token is returned after one retry', async () => {
  const f = fakeFetch([{ status: 500, json: { error: 'internal_failure' } }, { status: 200, json: { access_token: 'tok', scope: 'yt-analytics' } }]);
  const r = await refreshGoogleAccessToken({ ...args, fetchImpl: f.impl });
  assert.equal(r.accessToken, 'tok');
  assert.equal(f.calls.length, 2);
});

test('a network error is retried too', async () => {
  const f = fakeFetch(['throw', { status: 200, json: { access_token: 'tok' } }]);
  assert.equal((await refreshGoogleAccessToken({ ...args, fetchImpl: f.impl })).accessToken, 'tok');
});

test('invalid_grant: no retry, and a plain re-connect message', async () => {
  const f = fakeFetch([{ status: 400, json: { error: 'invalid_grant' } }]);
  await assert.rejects(() => refreshGoogleAccessToken({ ...args, fetchImpl: f.impl }), (e) => {
    assert.equal(f.calls.length, 1);
    assert.equal(e.reconnect, true);
    assert.match(e.plain, /^YouTube: .*re-connect/);
    assert.equal(e.message, 'youtube_oauth: invalid_grant');
    return true;
  });
});

test('still failing after the retries: a plain temporary-error message, 3 attempts', async () => {
  const f = fakeFetch([{ status: 500, json: { error: 'internal_failure' } }]);
  await assert.rejects(() => refreshGoogleAccessToken({ ...args, fetchImpl: f.impl }), (e) => {
    assert.equal(f.calls.length, 3);
    assert.match(e.plain, /temporary error — try again in a few minutes/);
    return true;
  });
});
