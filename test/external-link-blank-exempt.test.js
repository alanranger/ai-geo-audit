import test from 'node:test';
import assert from 'node:assert/strict';
import { isExternalLinkTargetBlankExemptHost } from '../api/aigeo/content-extractability.js';

test('LinkedIn and Acuity schedule hosts are exempt (treated as first-party for blank rule)', () => {
  assert.equal(isExternalLinkTargetBlankExemptHost('linkedin.com'), true);
  assert.equal(isExternalLinkTargetBlankExemptHost('www.linkedin.com'), true);
  assert.equal(isExternalLinkTargetBlankExemptHost('schedule-me-alan-ranger.as.me'), true);
  assert.equal(isExternalLinkTargetBlankExemptHost('acuityscheduling.com'), true);
});

test('unrelated third-party hosts are still external for blank rule', () => {
  assert.equal(isExternalLinkTargetBlankExemptHost('naturefirst.org'), false);
  assert.equal(isExternalLinkTargetBlankExemptHost('moretrees.eco'), false);
});
