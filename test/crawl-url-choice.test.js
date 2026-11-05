import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachUrlList, manualUrlsIfChosen, urlListRecord } from '../lib/audit/crawl-url-choice.mjs';

const stale = [
  'https://www.alanranger.com/old-one',
  'https://www.alanranger.com/old-two'
];

test('a saved list is ignored unless this run asks for it', () => {
  assert.equal(manualUrlsIfChosen(stale, false), null);
  assert.equal(manualUrlsIfChosen(stale, undefined), null);
  assert.equal(manualUrlsIfChosen(stale, 'true'), null);
});

test('an explicit choice uses that list and says it is not 06', () => {
  assert.deepEqual(manualUrlsIfChosen(stale, true), stale);
  const record = urlListRecord('manual', stale.length);
  assert.equal(record.source, 'manual');
  assert.equal(record.count, 2);
  assert.equal(record.notice, 'Using manual list of 2 URLs, not 06');
});

test('the default record names 06 and the count', () => {
  const record = urlListRecord('site_urls_06', 443);
  assert.equal(record.source, '06');
  assert.equal(record.notice, 'Using 06 (443 URLs)');
});

test('the saved audit record carries the URL source', () => {
  const foundation = attachUrlList({ Organization: true }, urlListRecord('site_urls_06', 443));
  assert.deepEqual(foundation.urlList, { source: '06', count: 443, notice: 'Using 06 (443 URLs)' });
  assert.equal(attachUrlList({}, null).urlList, undefined);
});
