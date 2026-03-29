/**
 * Mirrors dashboard traditionalSeoAggregateRuleStatus (audit-dashboard.html).
 * Proves why the rules row can show PASS/WARN while many URLs differ: one rule
 * with any FAIL aggregates to FAIL for the whole ruleset row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

function aggregateRuleStatus(rows, ruleKey) {
  const statuses = rows
    .filter((row) => String(row.rule_key) === String(ruleKey))
    .map((row) => String(row.status || 'fail').toLowerCase());
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return statuses.length ? 'pass' : 'warn';
}

test('gsc_url_indexed: 504 warn + 2 fail => rule aggregates to fail (not warn)', () => {
  const rows = [];
  for (let i = 0; i < 504; i += 1) rows.push({ rule_key: 'gsc_url_indexed', status: 'warn' });
  for (let i = 0; i < 2; i += 1) rows.push({ rule_key: 'gsc_url_indexed', status: 'fail' });
  assert.equal(aggregateRuleStatus(rows, 'gsc_url_indexed'), 'fail');
});

test('gsc_url_indexed: all fail => rule fail', () => {
  const rows = Array.from({ length: 20 }, () => ({ rule_key: 'gsc_url_indexed', status: 'fail' }));
  assert.equal(aggregateRuleStatus(rows, 'gsc_url_indexed'), 'fail');
});

test('other rule: all pass => pass', () => {
  const rows = Array.from({ length: 509 }, () => ({ rule_key: 'title_tag_present', status: 'pass' }));
  assert.equal(aggregateRuleStatus(rows, 'title_tag_present'), 'pass');
});
