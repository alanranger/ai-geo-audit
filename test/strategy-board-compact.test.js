/**
 * Marketing → Campaign results → Campaign steps (lib/strategy-board.js): one status chip per row (full reason in the
 * tooltip, never in the cell), the same controls in one actions row, at most 3 feature chips then "+N more", and the
 * billing cycle as one compact chip. Layout only: same data attributes / classes the handlers read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function board() {
  const win = { mkMeter: { state: 'fresh', used: 2979, quota: 5000, reserved: 766, after_reservations: 1255, cycle: { reset: '2026-11-12T12:51:00Z' }, captured_at: '2026-11-08T20:17:00Z' }, mkSegmentsList: [] };
  const document = { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} }, addEventListener: () => {}, dispatchEvent: () => {} };
  const c = vm.createContext({ window: win, document, CustomEvent: class {}, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, console, navigator: {} });
  vm.runInContext(fs.readFileSync(new URL('../lib/strategy-board.js', import.meta.url), 'utf8'), c);
  return win;
}
const REASON = 'Closed with Alan approval on 8 Nov: generic catch-up note superseded by targeted email sends and published social posts. No Outlook message sent';
const F = (name, when, moment, offer) => ({ name, when, moment, date: '2026-11-20', offer });
const steps = [
  { key: 'step|2026-11-02|Outlook personal notes|2026-11-02', week: '2026-11-02', day: '2026-11-02', scheduled_day: '2026-11-02', channel: 'Outlook personal notes', step: 'Personal note to past clients', brief: 'Short, personal, after you approve the names', covers: [],
    featured: [F('Norfolk', '20–22 Nov', 'Last chance', { note: '£150 off', ends: '2026-11-14' }), F('Lightroom course', 'Thu 12 Nov', 'Last chance'), F('Abstract & Macro', 'Sat 28 Nov', 'Last places'), F('Lake District', '22–24 Jan', 'Main push'), F('Kenilworth', 'Mon 22 Mar', 'Announce')],
    state: { status: 'not_needed', reason: REASON, by: 'gpt', at: '2026-11-08T17:41:00Z', resolved: true } },
  { key: 'step|2026-11-02|Facebook + Instagram|2026-11-10', week: '2026-11-02', day: '2026-11-10', scheduled_day: '2026-11-10', channel: 'Facebook + Instagram', step: 'Post: Norfolk 20–22 Nov', brief: 'Carousel', covers: ['m1'], featured: [], state: { status: 'pending' } }
];

test('compact steps table: status chip with actor + date, reason only in the tooltip; controls in one actions row', () => {
  const win = board();
  const host = { dataset: {}, innerHTML: '' };
  win.mountMarketingCampaign(host, { campaign: { weeks: [{ week: '2026-11-02', steps }], carried: { late: [], older: [] }, ticks: {}, rules: { email: { day: 'Thu' }, facebook_instagram: { days: ['Tue'] }, linkedin: { days: ['Wed'] } }, sends: {}, campaigns: [] } });
  const h = host.innerHTML;
  assert.match(h, /<th class="left">Status<\/th>.*<th class="left">Actions<\/th>/);
  assert.match(h, /<span class="st-chip st-chip-nn" title="[^"]*Closed with Alan approval[^"]*">not needed<\/span><div class="st-chip-by">GPT · 8 Nov<\/div>/);
  assert.ok(!/>[^<]*Closed with Alan approval/.test(h), 'the reason is never cell text');
  assert.match(h, /\+2 more/, 'at most 3 feature chips');
  assert.match(h, /Norfolk 20–22 Nov · offer to 14 Nov/);
  assert.match(h, /<div class="st-actrow"><label class="st-pub"><input type="checkbox" class="st-mo-tick"[^>]*> Prep<\/label>.*FB.*IG.*st-skip-save.*class="st-move".*st-brief-btn/, 'same tick / skip / move / brief controls, one row');
  assert.match(h, /Billing cycle: <b>2,979<\/b> \/ 5,000 used · 766 reserved · <b>1,255 free<\/b> · resets/);
});
