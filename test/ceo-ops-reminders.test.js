import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCeoWeeklyHtml } from '../lib/ceo-weekly/email.js';
import {
  loadBriefReminders, reminderState, salePriceCheck, setReminderDone, listOpenReminders, dueLabel
} from '../lib/ceo-weekly/ops-reminders.js';

const BLUEBELL = {
  id: 1,
  reminder_key: 'bluebell-price-rise-2027-02-01',
  due_date: '2027-02-01',
  title: 'Bluebell price rise: change 18 variants to £110 / £165',
  steps: [
    'Open the Squarespace product "BLUEBELL WOODLANDS Photography - Warks - 20 Apr - 29 Apr" (product id 5c2c8834c2241bc8b409723c).',
    '12 half-day variants (the 5:45am–9:45am and 10:30am–2:30pm sessions on each date): change the sale price £99 → £110.',
    '6 all-day variants (one per date): change the sale price £150 → £165.',
    'Keep "on sale" ticked on all 18, so the £125 / £175 list prices still show crossed out.',
  ],
  link: 'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops',
  self_check: {
    kind: 'squarespace_sale_prices', product_id: '5c2c8834c2241bc8b409723c',
    product_url: 'https://www.alanranger.com/photo-workshops-uk/bluebell-woodlands-photography-workshops',
    old_sale_gbp: [99, 150], new_sale_gbp: [110, 165], expected_variants: 18,
  },
  done: false,
  done_at: null,
};

/** Supabase stand-in for the reads / writes ops-reminders.js makes; eq / lte filter like PostgREST. */
function fakeSb(rows) {
  const state = { rows: rows.map((r) => ({ ...r })), updates: [] };
  const query = (list) => {
    const q = {
      select: () => q,
      eq: (col, val) => query(list.filter((r) => r[col] === val)),
      lte: (col, val) => query(list.filter((r) => r[col] <= val)),
      order: (col) => Promise.resolve({ data: [...list].sort((a, b) => String(a[col]).localeCompare(String(b[col]))), error: null }),
    };
    return q;
  };
  return {
    state,
    from: () => ({
      select: () => query(state.rows),
      update: (patch) => ({
        eq: (col, val) => ({
          select: () => ({
            maybeSingle: async () => {
              const row = state.rows.find((r) => r[col] === val);
              if (!row) return { data: null, error: null };
              Object.assign(row, patch);
              state.updates.push({ id: val, patch });
              return { data: { ...row }, error: null };
            },
          }),
        }),
      }),
    }),
  };
}

/** The Bluebell product's public JSON item: 12 half-day + 6 all-day variants at the given sale prices (pounds). */
function product(half, allDay, { onSale = true, id = '5c2c8834c2241bc8b409723c' } = {}) {
  const v = (list, sale) => ({ price: list * 100, salePrice: sale * 100, onSale });
  return { id, variants: [...Array(12).fill(0).map(() => v(125, half)), ...Array(6).fill(0).map(() => v(175, allDay))] };
}

const briefHtml = (ops_reminders) => renderCeoWeeklyHtml({ generated_at: '2027-02-01T07:00:00Z', strategy: { error: 'x' }, section_g: { error: 'x' }, ops_reminders });
const neverRead = { readProduct: async () => { throw new Error('the due-week brief must not read Squarespace'); } };

test('the brief of Mon 1 Feb 2027 shows the Bluebell reminder with its steps and link', async () => {
  const rem = await loadBriefReminders(fakeSb([BLUEBELL]), '2027-02-01', neverRead);
  assert.equal(rem.items.length, 1);
  assert.equal(rem.items[0].state, 'due');
  assert.equal(rem.items[0].check, null);
  const html = briefHtml(rem);
  assert.match(html, /REMINDERS · DATED MANUAL STEPS/);
  assert.match(html, /Bluebell price rise: change 18 variants to £110 \/ £165/);
  assert.match(html, /Due Mon 1 Feb 2027/);
  assert.match(html, /change the sale price £99 → £110/);
  assert.match(html, /href="https:\/\/www\.alanranger\.com\/photo-workshops-uk\/bluebell-woodlands-photography-workshops"/);
  assert.match(html, /Due this week · mark it done on the dashboard/);
  assert.doesNotMatch(html, /Not done yet/);
});

test('the brief of Mon 25 Jan 2027 does not show it (due the week after)', async () => {
  const rem = await loadBriefReminders(fakeSb([BLUEBELL]), '2027-01-25', neverRead);
  assert.deepEqual(rem.items, []);
  const html = briefHtml(rem);
  assert.doesNotMatch(html, /REMINDERS · DATED MANUAL STEPS/);
  assert.doesNotMatch(html, /Bluebell price rise/);
});

test('the brief of Mon 8 Feb with a variant still at £99 shows amber "not done yet" (read-only check)', async () => {
  const p = product(110, 165);
  p.variants[0].salePrice = 9900;
  const rem = await loadBriefReminders(fakeSb([BLUEBELL]), '2027-02-08', { readProduct: async () => p, now: new Date('2027-02-08T06:00:00Z') });
  assert.equal(rem.items[0].state, 'overdue');
  assert.deepEqual({ state: rem.items[0].check.state, still_old: rem.items[0].check.still_old, total: rem.items[0].check.total }, { state: 'not_done', still_old: 1, total: 18 });
  const html = briefHtml(rem);
  assert.match(html, /color:#b45309[^>]*>Not done yet: Squarespace still shows 1 of 18 variants at £99 \/ £150/);
  assert.match(html, />overdue</);
  assert.doesNotMatch(html, /#b42318[^>]*>Not done yet/);
});

test('marked done: it leaves the brief (and the dashboard list) for good', async () => {
  const sb = fakeSb([BLUEBELL]);
  const row = await setReminderDone(sb, 1, true, '2027-02-03T09:00:00Z');
  assert.equal(row.done, true);
  assert.equal(row.done_at, '2027-02-03T09:00:00Z');
  for (const week of ['2027-02-01', '2027-02-08', '2027-03-01']) {
    const rem = await loadBriefReminders(sb, week, neverRead);
    assert.deepEqual(rem.items, [], week);
    assert.doesNotMatch(briefHtml(rem), /Bluebell price rise/);
  }
  assert.deepEqual(await listOpenReminders(sb, '2027-02-08'), []);
  assert.equal(reminderState({ ...BLUEBELL, done: true }, '2027-02-08'), 'done');
});

test('later briefs keep showing it while open; all 18 changed shows green, not on sale asks for a check', async () => {
  const changed = await loadBriefReminders(fakeSb([BLUEBELL]), '2027-03-01', { readProduct: async () => product(110, 165) });
  assert.equal(changed.items[0].check.state, 'changed');
  assert.match(briefHtml(changed), /color:#067647[^>]*>Squarespace shows all 18 variants at £110 \/ £165 · mark it done on the dashboard/);
  assert.equal(salePriceCheck(product(110, 165, { onSale: false }), BLUEBELL.self_check).state, 'check');
  assert.equal(salePriceCheck(product(110, 165, { id: 'other' }), BLUEBELL.self_check).state, 'error');
});

test('a failed Squarespace read stays amber; a failed reminders read is red, never "nothing due"', async () => {
  const failedCheck = await loadBriefReminders(fakeSb([BLUEBELL]), '2027-02-08', { readProduct: async () => { throw new Error('squarespace_http_503'); } });
  assert.match(briefHtml(failedCheck), /color:#b45309[^>]*>Couldn't read the Squarespace prices \(squarespace_http_503\)/);
  const broken = { from: () => ({ select: () => ({ eq: () => ({ lte: () => ({ order: async () => ({ data: null, error: { message: 'relation missing' } }) }) }) }) }) };
  const rem = await loadBriefReminders(broken, '2027-02-01');
  assert.equal(rem.error, 'relation missing');
  assert.match(briefHtml(rem), /color:#b42318[^>]*>relation missing/);
});

test('week states and labels', () => {
  assert.equal(reminderState(BLUEBELL, '2027-01-25'), 'upcoming');
  assert.equal(reminderState({ ...BLUEBELL, due_date: '2027-02-07' }, '2027-02-01'), 'due');
  assert.equal(reminderState(BLUEBELL, '2027-02-08'), 'overdue');
  assert.equal(dueLabel('2027-02-01'), 'Mon 1 Feb 2027');
});

test('API: marking done needs the admin key; GET never writes', async () => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:9';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test';
  process.env.ARP_ADMIN_KEY = 'test-admin-key';
  const { default: handler } = await import('../api/aigeo/ops-reminders.js');
  const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = JSON.parse(b); return this; } };
  await handler({ method: 'PATCH', headers: {}, body: { id: 1, done: true } }, res);
  assert.equal(res.code, 401);
  await handler({ method: 'PATCH', headers: { 'x-arp-admin-key': 'wrong' }, body: { id: 1, done: true } }, res);
  assert.equal(res.code, 401);
  await handler({ method: 'PATCH', headers: { 'x-arp-admin-key': 'test-admin-key' }, body: { id: 'x', done: 'yes' } }, res);
  assert.equal(res.code, 400);
});
