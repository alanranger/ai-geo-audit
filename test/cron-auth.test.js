import test from 'node:test';
import assert from 'node:assert/strict';
import { cronHeaders, cronOrAdmin } from '../lib/api/cronAuth.js';
import { authoriseCron } from '../lib/ceo-weekly/shared.js';
import { isRequestAuthorized } from '../lib/acquisition/sync-runs.js';

const withEnv = (env, fn) => {
  const keep = { CRON_SECRET: process.env.CRON_SECRET, ARP_ADMIN_KEY: process.env.ARP_ADMIN_KEY };
  Object.assign(process.env, env);
  try { fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const req = (headers = {}, method = 'GET', query = {}) => ({ method, headers, query });

test('only Bearer CRON_SECRET or the admin key pass; header-only, x-cron-secret, ?secret= and open POST are refused', () => {
  withEnv({ CRON_SECRET: 's'.repeat(40), ARP_ADMIN_KEY: 'admin-key-test' }, () => {
    assert.equal(cronOrAdmin(req({ authorization: `Bearer ${'s'.repeat(40)}` })), 'cron');
    assert.equal(cronOrAdmin(req({ 'x-arp-admin-key': 'admin-key-test' }, 'POST')), 'admin');
    assert.equal(cronOrAdmin(req({ 'x-vercel-cron': '1' })), null);
    assert.equal(cronOrAdmin(req({ 'x-cron-secret': 's'.repeat(40) })), null);
    assert.equal(cronOrAdmin(req({}, 'GET', { secret: 's'.repeat(40) })), null);
    assert.equal(cronOrAdmin(req({}, 'POST')), null);
    assert.equal(cronOrAdmin(req({ authorization: 'Bearer wrong' })), null);
    assert.equal(authoriseCron(req({}, 'POST')), false);
    assert.equal(isRequestAuthorized(req({ 'x-vercel-cron': '1' })), false);
    assert.deepEqual(cronHeaders(), { Authorization: `Bearer ${'s'.repeat(40)}` });
  });
});

test('with no CRON_SECRET set nothing passes as cron (no open fallback)', () => {
  withEnv({ CRON_SECRET: '', ARP_ADMIN_KEY: 'admin-key-test' }, () => {
    assert.equal(cronOrAdmin(req({ authorization: 'Bearer ' })), null);
    assert.equal(cronOrAdmin(req({ 'x-vercel-cron': '1' })), null);
    assert.deepEqual(cronHeaders(), {});
  });
});
