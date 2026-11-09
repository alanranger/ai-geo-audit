/**
 * QUESTION-2026-11-09 (x): Prospects table email links. Client ID → Gmail, all mail to / from the client (newest first);
 * no email → the quoted name ("no email on file"); Ref → the original enquiry email (source_ref); the client record
 * moves to an ⓘ. Emails are read server-side, only in the admin prospects API; never in the public strategy summary.
 * Fixtures only: example.com addresses, no real client data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CLIENT_MAIL_TITLE, ENQUIRY_MAIL_TITLE, GMAIL, clientMailLink, enquiryMailLink, summarizeProspects } from '../lib/strategy-prospects.mjs';
import { buildSalesGap, monthsFrom } from '../lib/strategy-sales-gap.mjs';
import handler, { clientEntry } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CONFIG = [{ stage: 'qualify', probability: 0.2 }, { stage: 'quote', probability: 0.4 }, { stage: 'scheduled', probability: 0.75 }, { stage: 'booked_paid', probability: 1 }];
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';
const ROWS = [
  { id: 'a', enquiry_ref: 'ENQ-9001', client_or_org: 'Test Person One', person_id: P1, type: '1-2-1', stage: 'quote', value_gbp: 300, cash_month: '2026-12-01', source_ref: '19a2b3c4d5e6f7a8', notes: 'wrote from test.one@example.com', review_status: 'recent', revenue_type: 'new_sale' },
  { id: 'b', enquiry_ref: 'ENQ-9002', client_or_org: 'Test "Org" Two', person_id: P2, type: 'commission', stage: 'qualify', value_gbp: 500, cash_month: null, source_ref: null, review_status: 'revalidate', revenue_type: 'new_sale' }
];

test('Client ID link: Gmail search from:{email} OR to:{email}, URL-encoded, new tab title', () => {
  const m = clientMailLink(' Test.One@Example.com ', 'Test Person One');
  assert.equal(m.href, `${GMAIL}#search/${encodeURIComponent('from:test.one@example.com OR to:test.one@example.com')}`);
  assert.equal(m.href, 'https://mail.google.com/mail/?authuser=info@alanranger.com#search/from%3Atest.one%40example.com%20OR%20to%3Atest.one%40example.com');
  assert.equal(m.title, 'Open all emails with this client (newest first)');
  assert.equal(m.has_email, true);
});

test('no email on file: search the client name in quotes; tooltip says so; nothing at all without a name', () => {
  const m = clientMailLink(null, 'Test "Org" Two');
  assert.equal(m.href, `${GMAIL}#search/${encodeURIComponent('"Test Org Two"')}`);
  assert.match(m.title, /no email on file/);
  assert.equal(m.has_email, false);
  assert.equal(clientMailLink('', ''), null);
  assert.equal(clientEntry({ person_id: P2, display_name: null, email: null }, 'Fallback Name').mail.href, `${GMAIL}#search/${encodeURIComponent('"Fallback Name"')}`, 'the enquiry name when the record has none');
});

test('Ref link: the original enquiry email #all/{source_ref}; no link when source_ref is empty', () => {
  assert.deepEqual(enquiryMailLink('19a2b3c4d5e6f7a8'), { href: `${GMAIL}#all/19a2b3c4d5e6f7a8`, title: ENQUIRY_MAIL_TITLE });
  assert.equal(enquiryMailLink(''), null);
  assert.equal(enquiryMailLink(null), null);
  assert.equal(ENQUIRY_MAIL_TITLE, 'Open the original enquiry email');
});

test('UI: Client ID opens Gmail (new tab), the client record is the ⓘ beside it, Ref links only with a source_ref', () => {
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-prospects.js', import.meta.url), 'utf8'), ctx);
  const clients = { [P1]: clientEntry({ person_id: P1, display_name: 'Test Person One', email: 'test.one@example.com' }), [P2]: clientEntry({ person_id: P2, display_name: 'Test Org Two', email: null }) };
  const rows = ROWS.map((r) => ({ ...r, mail: enquiryMailLink(r.source_ref) }));
  Object.assign(ctx.stProspectsParts.state, { rows, config: CONFIG, clients });
  const s = { prospects: summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) }) };
  const html = ctx.stProspectsParts.sectionHtml(s);
  const a = clients[P1].mail.href.replace(/&/g, '&amp;');
  assert.ok(html.includes(`<a href="${a}" target="_blank" rel="noopener noreferrer" title="${CLIENT_MAIL_TITLE}" data-pp-mail>C-111111</a> <a href="#" class="pp-info" data-pp-client="${P1}"`), 'client ID → Gmail; ⓘ → client record');
  assert.ok(html.includes(`title="${CLIENT_MAIL_TITLE} · no email on file (searches the client name)" data-pp-mail>C-222222</a>`), 'no email: quoted-name search, tooltip');
  assert.ok(html.includes(`<a href="${GMAIL.replace(/&/g, '&amp;')}#all/19a2b3c4d5e6f7a8" target="_blank" rel="noopener noreferrer" title="${ENQUIRY_MAIL_TITLE}" data-pp-mail>ENQ-9001</a>`), 'Ref → original enquiry email');
  assert.match(html, /<td class="left">ENQ-9002<\/td>/, 'no source_ref: plain ref, no link');
  assert.match(html, /aria-label="Client record">ⓘ<\/a>/);
});

test('the PUBLIC strategy summary aggregates contain no email (prospects + sales gap), even when notes hold one', () => {
  const pr = summarizeProspects({ rows: ROWS, config: CONFIG, history: [], today: TODAY, months: monthsFrom(TODAY, 3) });
  const g = buildSalesGap({ today: TODAY, txns: [], targets: Array(12).fill(1000), events: [], fill: null, lead: null, pipeline: pr.by_month, pipeline_open: pr.pipeline, prospects: pr });
  const pub = JSON.stringify({ prospects: pr, sales_gap: g });
  assert.deepEqual(pub.match(EMAIL_RE) || [], [], 'no @-email anywhere in the public prospects / sales-gap JSON');
  assert.doesNotMatch(pub, /mail\.google|Test Person|ENQ-9001|19a2b3c4/, 'no Gmail links, names, refs or message ids');
  const summarySrc = fs.readFileSync(new URL('../lib/strategy-summary.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(summarySrc, /clientMailLink|enquiryMailLink|customer_person'\)\.select\([^)]*email/, 'the summary never builds mail links or reads person emails for prospects');
  const loader = fs.readFileSync(new URL('../lib/strategy-prospects.mjs', import.meta.url), 'utf8').split('export async function loadProspectRows')[1];
  assert.doesNotMatch(loader, /customer_person/, 'the summary loader reads only the prospect tables');
});

test('the admin prospects API refuses a request without the admin key (no rows, no links)', async () => {
  const prev = process.env.ARP_ADMIN_KEY;
  process.env.ARP_ADMIN_KEY = 'test-admin-key';
  let status = null;
  let body = '';
  const res = { setHeader() {}, status(s) { status = s; return this; }, send(b) { body = b; return this; } };
  await handler({ method: 'GET', headers: {}, query: {} }, res);
  process.env.ARP_ADMIN_KEY = prev;
  assert.equal(status, 401);
  assert.doesNotMatch(body, EMAIL_RE);
  assert.doesNotMatch(body, /mail\.google/);
});
