/**
 * QUESTION-2026-11-09 (w): Campaign steps read GPT's delivery records. A step with its own delivery status (GPT's
 * placement, the email a quarter action waits for, a board task) shows that status (List vocabulary) with no tick for
 * GPT's delivery; old generated FB / IG / LinkedIn steps GPT's plan replaced (same week + channel + event) are
 * superseded and hidden by default; "This week" counts the real statuses. Fixture = live w/c 9 Nov 2026.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
  const listeners = [];
  const win = {};
  const document = { getElementById: () => null, addEventListener: (t, fn) => listeners.push([t, fn]), createElement: () => ({}), head: { appendChild: () => {} }, dispatchEvent: () => {}, querySelector: () => null };
  const ctx = vm.createContext({ window: win, document, CustomEvent: class { constructor(t) { this.type = t; } }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/strategy-board.js', import.meta.url), 'utf8'), ctx);
  const click = (target) => listeners.filter(([t]) => t === 'click').forEach(([, fn]) => fn({ target, preventDefault() {} }));
  return { win, click };
}
const st = (status, extra = {}) => ({ status, resolved: false, ...extra });
const F = (name, title, url, date, extra = {}) => ({ name, title, url, date, ...extra });
const NORFOLK = F('Norfolk', 'Norfolk Photography Workshop | Cromer to Hunstanton', '/photographic-workshops-near-me/norfolk-photography-workshop', '2026-11-20', { moment: 'Last chance', offer: { code: 'NORFOLK150' } });
const MACRO = F('Abstract & Macro', 'Abstract and Macro Photography Workshop Warwickshire - Nov', '/photographic-workshops-near-me/abstract-and-macro-photography-workshop-coventry', '2026-11-28', { moment: 'Last chance' });
const LR = F('Lightroom course', 'Lightroom Classic Photo Editing Classes -Week 1 of 3 -12-1', '/beginners-photography-lessons/lightroom-photo-editing-classes-wk1-xx94r', '2027-01-12', { moment: 'Announce' });
const step = (key, channel, d, text, featured = [], extra = {}) => ({ key, channel, day: d, scheduled_day: d, step: text, featured, covers: [], state: st('pending'), ...extra });
const DRAFT = 'DRAFT — Alan review required. Proposed 2026-11-13 18:30 GMT. Purpose Sell.';
const steps = [
  step('step|2026-11-09|Outlook personal notes|2026-11-09', 'Outlook personal notes', '2026-11-09', 'Personal note to past clients: "Last 2 places Norfolk"', [NORFOLK, MACRO]),
  step('step|2026-11-09|Google Business|2026-11-09', 'Google Business', '2026-11-09', 'Google Business check (5–10 min)', [], { gbp: 'check' }),
  step('plan|14', 'Quarter action', '2026-11-10', 'Pick n Mix launch newsletter', [], { plan_id: 14, state: st('awaiting', { rule: 'pick-n-mix-launch' }) }),
  step('step|2026-11-09|Facebook + Instagram|2026-11-10', 'Facebook + Instagram', '2026-11-10', 'Post: Norfolk 20–22 Nov', [NORFOLK]),
  step('step|2026-11-09|LinkedIn|2026-11-11', 'LinkedIn', '2026-11-11', 'Post: Lightroom course starts Tue 12 Jan', [LR]),
  step('step|2026-11-09|Squarespace email|2026-11-12', 'Squarespace email', '2026-11-12', 'Main email of the week: "Norfolk, Abstract & Macro"', [NORFOLK, MACRO], { is_email: true, state: { status: 'superseded', resolved: true, covered_by: ['theme|pick-n-mix-kick-starter-2026-11'], reason: 'fulfilled by 6 campaign send(s) that week' } }),
  step('step|2026-11-09|Facebook + Instagram|2026-11-13', 'Facebook + Instagram', '2026-11-13', 'Post: "Last 2 places" for Norfolk 20–22 Nov', [NORFOLK]),
  step('step|2026-11-09|Facebook + Instagram|2026-11-13|1', 'Facebook + Instagram', '2026-11-13', 'Post: "Last 4 places" for Abstract & Macro Sat 28 Nov', [MACRO]),
  step('step|gbp|2026-11-20|/photographic-workshops-near-me/norfolk-photography-workshop', 'Google Business', '2026-11-13', 'Google Business update: £150 off, book by Sat 14 Nov 23:59', [NORFOLK], { gbp: 'exception', optional: true, owner: 'GPT' }),
  step('gpt-ll-newsletter-2026-11-15', 'LinkedIn', '2026-11-15', 'Light & Logic newsletter (LinkedIn) · November edition', [], { manual: true, brief: 'PLANNED PUBLICATION ROW' }),
  step('gpt-8w-social-2026-11-10-fbig', 'Facebook + Instagram', '2026-11-10', 'What focus bracketing actually helps with', [F('What focus bracketing actually helps with', 'What focus bracketing actually helps with', 'https://www.alanranger.com/photo-workshops-uk/abstract-and-macro-photography-workshops', '2026-11-10')], { manual: true, brief: DRAFT }),
  step('gpt-8w-social-2026-11-11-li', 'LinkedIn', '2026-11-11', 'Give your photography a direction', [F('Give your photography a direction', 'Give your photography a direction', 'https://www.alanranger.com/photography-payment-plan', '2026-11-11')], { manual: true, brief: DRAFT }),
  step('gpt-8w-social-2026-11-13-fbig', 'Facebook + Instagram', '2026-11-13', 'Norfolk: offer ends Saturday', [F('Norfolk: offer ends Saturday', 'Norfolk: offer ends Saturday', 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk', '2026-11-13', { stage: 'drafted' })], { manual: true, brief: DRAFT }),
  step('gpt-event-2026-11-09-norfolk-li', 'LinkedIn', '2026-11-09', 'Norfolk coastal workshop · 20–22 November', [F('Norfolk coastal workshop', undefined, 'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshop-norfolk', '2026-11-20')], { manual: true, brief: DRAFT }),
  step('step|gbp|2026-11-12|/beginners-photography-lessons/lightroom-photo-editing-classes-wk1-kdh5k', 'Google Business', '2026-11-13', 'Google Business update: Last 3 places Lightroom', [], { gbp: 'exception', optional: true, state: { status: 'not_needed', resolved: true, reason: 'Obsolete', by: 'GPT' } })
];
const ds = (code, label, icon, line, extra = {}) => ({ code, label, icon, tone: 'blue', line, ...extra });
const SCH = (line) => ds('scheduled', 'Scheduled on platform', '🕒', line, { approved: true, evidence: 'verified by GPT in the native queue (no ID available)' });
const by_key = {
  'gpt-8w-social-2026-11-10-fbig': SCH('🕒 Scheduled on platform · Instagram Tue 10 Nov 6:30pm'),
  'gpt-8w-social-2026-11-11-li': SCH('🕒 Scheduled on platform · LinkedIn Wed 11 Nov 8:30am'),
  'gpt-8w-social-2026-11-13-fbig': SCH('🕒 Scheduled on platform · Instagram Fri 13 Nov 6:30pm'),
  'gpt-event-2026-11-09-norfolk-li': ds('published', 'Published', '✅', '✅ Published Mon 9 Nov 9:06am'),
  'send|theme|pick-n-mix-kick-starter-2026-11': ds('scheduled', 'Scheduled', '🕒', '🕒 Scheduled Tue 10 Nov 10:00am', { when: 'Scheduled Tue 10 Nov 10:00am', evidence: 'Squarespace Scheduled tab (collector)' }),
  'step|2026-11-09|Outlook personal notes|2026-11-09': ds('deferred', 'Deferred by Alan · Mon 9 Nov', '⏸', '⏸ Deferred by Alan · Mon 9 Nov'),
  'step|2026-11-09|Google Business|2026-11-09': ds('due', 'Due', '📋', '📋 Due Mon 9 Nov')
};
const holds = [{ match: '^gpt-ll-newsletter-', by: 'Alan', at: '2026-11-09', reason: 'deferred until the backlog is cleared', dependency: 'Light & Logic edition and its promotion module' }];
const data = () => ({
  campaign: { weeks: [{ week: '2026-11-09', steps: JSON.parse(JSON.stringify(steps)) }], carried: { late: [], older: [] }, ticks: {}, step_status: { not_needed: 1 }, campaigns: [], sends: { emails_sent: 0 },
    rules: { email: { day: 'Thursday', light_and_logic_day: 15 }, facebook_instagram: { days: ['Tue', 'Fri'] }, linkedin: { days: ['Wed'], angle: 'x' } } },
  delivery_status: { by_key, holds }, actions: [{ id: 14, evidence: { rule: 'pick-n-mix-launch', state: 'waiting', campaign_key: 'theme|pick-n-mix-kick-starter-2026-11' } }]
});
const host = () => ({ dataset: {}, innerHTML: '' });
const views = (win) => Object.fromEntries(win.stStepViews().steps.map((v) => [v.key, v]));

test('GPT steps read the delivery status (Scheduled on platform / Published): no "to do", no tick, stale DRAFT brief hidden', () => {
  const { win } = load();
  const h = host();
  win.mountMarketingCampaign(h, data());
  const v = views(win);
  for (const k of ['gpt-8w-social-2026-11-10-fbig', 'gpt-8w-social-2026-11-11-li', 'gpt-8w-social-2026-11-13-fbig']) assert.deepEqual([v[k].kind, v[k].code, v[k].owner, v[k].stale_draft_hidden], ['delivery', 'scheduled', 'GPT', true], k);
  assert.deepEqual([v['gpt-event-2026-11-09-norfolk-li'].code, v['gpt-event-2026-11-09-norfolk-li'].owner], ['published', 'GPT']);
  const row = h.innerHTML.slice(h.innerHTML.indexOf('Norfolk: offer ends Saturday') - 900, h.innerHTML.indexOf('Norfolk: offer ends Saturday') + 900);
  assert.match(row, /🕒 Scheduled on platform/);
  assert.match(row, /owner GPT/);
  assert.ok(!/st-mo-tick|DRAFT — Alan review required|>to do<|>drafted</.test(row), 'no tick, no stale draft, no "to do", no "drafted" stage tag');
});

test('old steps GPT\'s plan replaced (same week + channel + event) are superseded, hidden by default, linked to the replacing post', () => {
  const { win, click } = load();
  const h = host();
  win.mountMarketingCampaign(h, data());
  const v = views(win);
  assert.equal(v['step|2026-11-09|Facebook + Instagram|2026-11-13'].by, 'gpt-8w-social-2026-11-13-fbig', '"Last 2 places" Norfolk Fri 13 → "Norfolk: offer ends Saturday" Fri 13');
  assert.equal(v['step|2026-11-09|Facebook + Instagram|2026-11-10'].by, 'gpt-8w-social-2026-11-13-fbig', 'Norfolk Tue 10 → GPT\'s Norfolk post that week');
  assert.equal(v['step|2026-11-09|Facebook + Instagram|2026-11-13|1'].by, 'gpt-8w-social-2026-11-10-fbig', 'Abstract & Macro Fri 13 → GPT\'s Macro post that week');
  assert.deepEqual([v['step|2026-11-09|LinkedIn|2026-11-11'].kind, v['step|2026-11-09|LinkedIn|2026-11-11'].owner], ['gpt_open', 'GPT'], 'no replacement: kept, real owner GPT');
  assert.equal(v['step|2026-11-09|Squarespace email|2026-11-12'].kind, 'superseded', 'Main email of the week stays superseded');
  assert.ok(!/Last 2 places&quot; for Norfolk|Main email of the week|Last 4 places&quot;/.test(h.innerHTML), 'hidden by default');
  assert.match(h.innerHTML, /show superseded \(4\)/);
  const btn = { closest: (s) => (s === '[data-st-show-sup]' ? btn : null), getAttribute: () => null };
  click(btn);
  const mk = host();
  win.mountMarketingCampaign(mk, data());
  assert.match(mk.innerHTML, /hide superseded \(4\)/);
  assert.match(mk.innerHTML, /Last 2 places&quot; for Norfolk/, 'shown after "show superseded"');
  assert.match(mk.innerHTML, /replaced by “Norfolk: offer ends Saturday” · Fri 13 Nov →/);
});

test('ownership: Outlook note = Alan (deferred, keeps his controls); Pick n Mix newsletter = Squarespace Scheduled 10:00; Light & Logic = On hold (Alan); Google posts = GPT', () => {
  const { win } = load();
  const h = host();
  win.mountMarketingCampaign(h, data());
  const v = views(win);
  assert.deepEqual([v['step|2026-11-09|Outlook personal notes|2026-11-09'].code, v['step|2026-11-09|Outlook personal notes|2026-11-09'].owner], ['deferred', 'Alan']);
  assert.match(h.innerHTML, /⏸ Deferred by Alan · Mon 9 Nov[\s\S]*?owner Alan[\s\S]*?st-mo-tick/, 'Alan\'s own task keeps its tick');
  assert.equal(v['plan|14'].code, 'scheduled');
  assert.match(h.innerHTML, /🕒 Scheduled Tue 10 Nov 10:00am · Squarespace Scheduled tab \(collector\)/);
  assert.deepEqual([v['gpt-ll-newsletter-2026-11-15'].code, v['gpt-ll-newsletter-2026-11-15'].owner], ['on_hold', 'GPT']);
  assert.match(h.innerHTML, /⏸ On hold \(Alan\)/);
  const gbp = v['step|gbp|2026-11-20|/photographic-workshops-near-me/norfolk-photography-workshop'];
  assert.deepEqual([gbp.kind, gbp.owner], ['gpt_open', 'GPT']);
  assert.deepEqual([v['step|2026-11-09|Google Business|2026-11-09'].code, v['step|2026-11-09|Google Business|2026-11-09'].owner], ['due', 'GPT'], 'weekly Google check: GPT\'s task, from the board');
});

test('"This week" counts real statuses (platform / provider / tasks), never ticks; matches the List (4 scheduled · 1 published)', () => {
  const { win } = load();
  const h = host();
  win.mountMarketingCampaign(h, data());
  const n = win.stStepViews().counts;
  assert.deepEqual([n.scheduled, n.published, n.done, n.deferred, n.on_hold, n.superseded, n.gpt_open], [4, 1, 0, 1, 1, 4, 2]);
  assert.match(h.innerHTML, /This week: 5 on the platform \(4 scheduled · 1 published \/ sent\) · 0 done · 1 deferred \(Alan\) · 1 on hold \(Alan\) · 1 due \(GPT task\) · 2 GPT, optional or not in its schedule · 4 superseded \(hidden\) · 1 not needed\./);
  assert.ok(!/st-chip-todo" title="[^"]*">to do</.test(h.innerHTML), 'no plain "to do" chip on any delivered step');
});

test('without the shared status (summary failed) the plan state is used as before', () => {
  const { win } = load();
  const d = data();
  d.delivery_status = { error: 'unavailable', by_key: {} };
  win.mountMarketingCampaign(host(), d);
  const v = views(win);
  assert.equal(v['gpt-8w-social-2026-11-13-fbig'].kind, 'plan');
  assert.equal(v['step|2026-11-09|Facebook + Instagram|2026-11-13'].kind, 'plan', 'nothing superseded without the GPT post\'s status; controls as before');
});
